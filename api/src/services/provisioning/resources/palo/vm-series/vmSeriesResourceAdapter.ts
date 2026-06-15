import { readFile } from "node:fs/promises";
import type {
  DeploymentConfig,
  PanoramaConfigAddOnConfig,
  PanwVmseriesResourceConfig,
  ResourceRecord,
} from "../../../types/index.js";
import type { LogFn } from "../../../types/logging.js";
import type { ProviderAdapter, ProviderApplyResult } from "../../../types/providerAdapter.js";
import type {
  ResourceActionRequest,
  ResourceAdapter,
  ResourceAdapterContext,
  ResourceUpResult,
} from "../../types.js";
import { GenericTerraformResourceAdapter } from "../../genericTerraformResourceAdapter.js";
import { buildBootstrapIso, resolveAuthCode } from "./bootstrap.js";
import { PanwBootstrapService } from "../shared/bootstrapService.js";
import { deactivateLicenseIfPossible } from "../shared/panw.js";
import { toProxmoxFirewallConfig } from "../../../providers/proxmox/config.js";
import { terraformApplyVm, terraformDestroyVm } from "../../../providers/proxmox/terraform.js";
import { toProjectRelativePath } from "../../../utils/paths.js";
import { expandVmSeriesConfigProfiles } from "./configProfiles.js";

export class VmSeriesResourceAdapter implements ResourceAdapter<PanwVmseriesResourceConfig> {
  readonly kind = "panw-vmseries";

  constructor(
    private readonly panwBootstrap = new PanwBootstrapService(),
    private readonly terraformResource = new GenericTerraformResourceAdapter<PanwVmseriesResourceConfig>(),
  ) {}

  async prepareDeployment(
    deployment: DeploymentConfig,
    configLoader: ResourceAdapterContext<PanwVmseriesResourceConfig>["configLoader"],
    configRef: string,
  ): Promise<DeploymentConfig> {
    return await expandVmSeriesConfigProfiles(deployment, configLoader, configRef);
  }

  initialState(
    _deployment: DeploymentConfig,
    resource: PanwVmseriesResourceConfig,
  ): Partial<ResourceRecord> {
    return {
      authCode: resolveAuthCode(resource),
    };
  }

  async up(
    context: ResourceAdapterContext<PanwVmseriesResourceConfig>,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<ResourceUpResult> {
    const authCode = resolveAuthCode(context.resource);
    const bootstrap = context.provider.requiresBootstrapIso === false
      ? null
      : await buildBootstrapIso(context.resource, authCode, log);
    if (bootstrap) {
      await context.stateRepository.patchResource(record.id, {
        lifecycleStatus: "iso_built",
        bootstrapIsoPath: toProjectRelativePath(bootstrap.isoPath),
      });
    }

    let applyResult: ProviderApplyResult;
    if (isLegacyProxmoxVmSeries(context.provider)) {
      if (!bootstrap?.isoPath) {
        throw new Error("Proxmox VM-Series provisioning requires a bootstrap ISO path");
      }
      const config = toProxmoxFirewallConfig(
        context.deployment,
        context.resource,
        context.configPath,
      );
      log("Applying Proxmox Terraform module");
      applyResult = await terraformApplyVm(config, bootstrap.isoPath, log);
    } else {
      applyResult = await context.terraform.apply(context, log);
    }

    await context.stateRepository.patchResource(record.id, {
      lifecycleStatus: "vm_created",
      bootstrapIsoFileId: applyResult.bootstrapIsoFileId,
      terraformStatePath: applyResult.terraformStatePath,
      providerResourceId: applyResult.providerResourceId,
      outputs: applyResult.outputs,
    });

    return {
      resourcePatch: {
        ...applyResult,
        bootstrapIsoPath: toProjectRelativePath(bootstrap?.isoPath) ?? record.bootstrapIsoPath,
      },
    };
  }

  async down(
    context: ResourceAdapterContext<PanwVmseriesResourceConfig>,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<void> {
    const outputs = await this.readOutputsForTeardown(context, record, log);
    await deactivateLicenseIfPossible(context.resource, record, outputs, log, this.panwBootstrap);

    if (isLegacyProxmoxVmSeries(context.provider)) {
      if (!record.terraformStatePath) {
        throw new Error(`No Terraform state path recorded for ${record.hostname}`);
      }
      const config = toProxmoxFirewallConfig(
        context.deployment,
        context.resource,
        context.configPath,
      );
      await terraformDestroyVm(config, record.terraformStatePath, log);
      return;
    }

    await this.terraformResource.down(context, record, log);
  }

  async runAction(
    context: ResourceAdapterContext<PanwVmseriesResourceConfig>,
    record: ResourceRecord,
    request: ResourceActionRequest,
    log: LogFn,
  ): Promise<Partial<ResourceRecord>> {
    switch (request.action) {
      case "bootstrap": {
        await context.stateRepository.patchResource(record.id, {
          lifecycleStatus: "panos_bootstrapping",
        });
        const outputs = await context.terraform.readOutputs(context, record, log);
        return await this.bootstrapFirewall(context, record, outputs, log);
      }
      case "apply-config-addon":
      case "apply-config-addons": {
        await context.stateRepository.patchResource(record.id, {
          lifecycleStatus: "panos_configuring",
        });
        return await this.applyConfigAddOns(context, record, request, log);
      }
      default:
        throw new Error(`Resource kind ${this.kind} does not support action ${request.action}`);
    }
  }

  /**
   * Read Terraform outputs for the teardown delicense step. Never throws: if the
   * outputs are unavailable (no recorded state path, destroyed stack, etc.) we
   * return an empty map so the destroy still proceeds — deactivation is
   * best-effort and gated by destroy.allowWithoutDelicense.
   */
  private async readOutputsForTeardown(
    context: ResourceAdapterContext<PanwVmseriesResourceConfig>,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<Record<string, unknown>> {
    if (!record.terraformStatePath) return {};
    try {
      return await context.terraform.readOutputs(context, record, log);
    } catch (error) {
      log(
        `Could not read Terraform outputs for ${record.hostname} before delicense: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return {};
    }
  }

  private async bootstrapFirewall(
    context: ResourceAdapterContext<PanwVmseriesResourceConfig>,
    record: ResourceRecord,
    outputs: Record<string, unknown>,
    log: LogFn,
  ): Promise<Partial<ResourceRecord>> {
    const authCode = resolveAuthCode(context.resource);
    const result = await this.panwBootstrap.bootstrapFirewall(context.resource, outputs, authCode, log);
    return {
      // Persist the serial so it is visible in state and available for reporting;
      // delicense-on-destroy still reads it live from the firewall at teardown.
      ...(result.serial ? { serial: result.serial } : {}),
      panos: {
        ...record.panos,
        managementAddress: result.managementAddress,
        vmLicense: result.vmLicense,
      },
    };
  }

  private async applyConfigAddOns(
    context: ResourceAdapterContext<PanwVmseriesResourceConfig>,
    record: ResourceRecord,
    request: ResourceActionRequest,
    log: LogFn,
  ): Promise<Partial<ResourceRecord>> {
    const addOns = selectConfigAddOns(context.resource.configAddOns, request.params);
    const loadedAddOns = await Promise.all(
      addOns.map(async (addOn) => {
        const filePath = context.configLoader.resolveProjectPath(addOn.file);
        return {
          name: addOn.name ?? addOn.file,
          file: addOn.file,
          content: await readFile(filePath, "utf8"),
          commit: addOn.commit,
        };
      }),
    );

    const outputs = await context.terraform.readOutputs(context, record, log);
    const result = await this.panwBootstrap.applyFirewallConfigAddOns(
      context.deployment,
      context.resource,
      outputs,
      loadedAddOns,
      log,
    );

    return {
      panos: {
        ...record.panos,
        managementAddress: result.managementAddress,
        configAddOns: result.appliedAddOns,
      },
    };
  }
}

function isLegacyProxmoxVmSeries(provider: ProviderAdapter): boolean {
  return provider.type === "proxmox";
}

function selectConfigAddOns(
  configuredAddOns: PanoramaConfigAddOnConfig[] | null | undefined,
  params: Record<string, unknown> | undefined,
): PanoramaConfigAddOnConfig[] {
  if (!Array.isArray(configuredAddOns) || !configuredAddOns.length) {
    throw new Error("VM-Series apply-config-addons requires resource.configAddOns or resource.configProfiles");
  }

  for (const addOn of configuredAddOns) {
    if (!addOn || typeof addOn !== "object" || typeof addOn.file !== "string" || !addOn.file) {
      throw new Error("VM-Series configAddOns entries must include a file");
    }
    if (addOn.push !== undefined && addOn.push !== null) {
      throw new Error("VM-Series configAddOns do not support Panorama push settings");
    }
  }

  const requested = requestedConfigAddOns(params);
  if (!requested.length) return configuredAddOns;

  const byName = new Map<string, PanoramaConfigAddOnConfig>();
  for (const addOn of configuredAddOns) {
    byName.set(addOn.file, addOn);
    if (addOn.name) byName.set(addOn.name, addOn);
  }

  return requested.map((name) => {
    const addOn = byName.get(name);
    if (!addOn) throw new Error(`Unknown VM-Series config add-on ${name}`);
    return addOn;
  });
}

function requestedConfigAddOns(params: Record<string, unknown> | undefined): string[] {
  const value = params?.addOn ?? params?.addOns;
  if (value === undefined || value === null) return [];
  if (typeof value === "string" && value) return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === "string" && item)) return value;
  throw new Error("VM-Series apply-config-addons params.addOn/addOns must be a string or string array");
}
