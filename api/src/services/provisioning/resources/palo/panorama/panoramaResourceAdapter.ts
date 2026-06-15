import { readFile } from "node:fs/promises";
import type {
  PanoramaConfigAddOnConfig,
  PanoramaResourceConfig,
  PanwVmseriesResourceConfig,
  ResourceConfig,
  ResourceRecord,
} from "../../../types/index.js";
import type { LogFn } from "../../../types/logging.js";
import type {
  ResourceActionRequest,
  ResourceAdapter,
  ResourceAdapterContext,
  ResourceUpResult,
} from "../../types.js";
import { GenericTerraformResourceAdapter } from "../../genericTerraformResourceAdapter.js";
import { PanwBootstrapService } from "../shared/bootstrapService.js";

export class PanoramaResourceAdapter implements ResourceAdapter<PanoramaResourceConfig> {
  readonly kind = "panorama";

  constructor(
    private readonly panwBootstrap = new PanwBootstrapService(),
    private readonly terraformResource = new GenericTerraformResourceAdapter<PanoramaResourceConfig>(),
  ) {}

  initialState(
    _deployment: ResourceAdapterContext<PanoramaResourceConfig>["deployment"],
    resource: PanoramaResourceConfig,
  ): Partial<ResourceRecord> {
    return {
      serial: resolvePanoramaSerial(resource),
    };
  }

  async up(
    context: ResourceAdapterContext<PanoramaResourceConfig>,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<ResourceUpResult> {
    const applyResult = await context.terraform.apply(context, log);
    await context.stateRepository.patchResource(record.id, {
      lifecycleStatus: "panos_bootstrapping",
      terraformStatePath: applyResult.terraformStatePath,
      providerResourceId: applyResult.providerResourceId,
      outputs: applyResult.outputs,
    });

    const patch = await this.bootstrapPanorama(
      context,
      {
        ...record,
        terraformStatePath: applyResult.terraformStatePath,
        providerResourceId: applyResult.providerResourceId,
        outputs: applyResult.outputs,
      },
      applyResult.outputs ?? {},
      log,
    );

    return {
      resourcePatch: {
        ...applyResult,
        ...patch,
      },
    };
  }

  async down(
    context: ResourceAdapterContext<PanoramaResourceConfig>,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<void> {
    await this.terraformResource.down(context, record, log);
  }

  async runAction(
    context: ResourceAdapterContext<PanoramaResourceConfig>,
    record: ResourceRecord,
    request: ResourceActionRequest,
    log: LogFn,
  ): Promise<Partial<ResourceRecord>> {
    switch (request.action) {
      case "bootstrap":
        await context.stateRepository.patchResource(record.id, {
          lifecycleStatus: "panos_bootstrapping",
        });
        return await this.bootstrapFromState(context, record, log);
      case "verify-connected-resources":
        await context.stateRepository.patchResource(record.id, {
          lifecycleStatus: "panos_verifying",
        });
        return await this.verifyConnectedResources(context, record, log);
      case "onboard-firewalls":
        await context.stateRepository.patchResource(record.id, {
          lifecycleStatus: "panos_onboarding",
        });
        return await this.onboardFirewalls(context, record, log);
      case "apply-config-addons":
      case "apply-config-addon":
        await context.stateRepository.patchResource(record.id, {
          lifecycleStatus: "panos_configuring",
        });
        return await this.applyConfigAddOns(context, record, request, log);
      default:
        throw new Error(`Resource kind ${this.kind} does not support action ${request.action}`);
    }
  }

  private async bootstrapFromState(
    context: ResourceAdapterContext<PanoramaResourceConfig>,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<Partial<ResourceRecord>> {
    const outputs = await context.terraform.readOutputs(context, record, log);
    return await this.bootstrapPanorama(context, record, outputs, log);
  }

  private async bootstrapPanorama(
    context: ResourceAdapterContext<PanoramaResourceConfig>,
    record: ResourceRecord,
    outputs: Record<string, unknown>,
    log: LogFn,
  ): Promise<Partial<ResourceRecord>> {
    const result = await this.panwBootstrap.bootstrapPanorama(
      context.deployment,
      context.resource,
      record,
      outputs,
      log,
    );

    return {
      panos: {
        ...record.panos,
        managementAddress: result.managementAddress,
        vmAuthKey: result.vmAuthKey,
        vmAuthKeyExpiresAt: result.vmAuthKeyExpiresAt,
      },
    };
  }

  private async verifyConnectedResources(
    context: ResourceAdapterContext<PanoramaResourceConfig>,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<Partial<ResourceRecord>> {
    const expectedFirewalls = context.deployment.resources.filter(isPanwVmseriesResource);
    if (!expectedFirewalls.length) {
      throw new Error(`Deployment ${context.deployment.name} has no panw-vmseries resources to verify`);
    }

    const outputs = await context.terraform.readOutputs(context, record, log);
    const result = await this.panwBootstrap.verifyFirewallsConnected(
      context.resource,
      outputs,
      expectedFirewalls,
      log,
    );

    return {
      panos: {
        ...record.panos,
        managementAddress: result.managementAddress,
        connectedDeviceCount: result.connectedDeviceCount,
      },
    };
  }

  private async onboardFirewalls(
    context: ResourceAdapterContext<PanoramaResourceConfig>,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<Partial<ResourceRecord>> {
    const expectedFirewalls = context.deployment.resources.filter(isPanwVmseriesResource);
    if (!expectedFirewalls.length) {
      throw new Error(`Deployment ${context.deployment.name} has no panw-vmseries resources to onboard`);
    }

    const outputs = await context.terraform.readOutputs(context, record, log);
    const result = await this.panwBootstrap.onboardFirewalls(
      context.deployment,
      context.resource,
      outputs,
      expectedFirewalls,
      log,
    );

    return {
      panos: {
        ...record.panos,
        managementAddress: result.managementAddress,
        connectedDeviceCount: result.connectedDeviceCount,
        deviceGroup: result.deviceGroup,
        template: result.template,
        templateStack: result.templateStack,
        onboardedFirewallSerials: result.firewallSerials,
      },
    };
  }

  private async applyConfigAddOns(
    context: ResourceAdapterContext<PanoramaResourceConfig>,
    record: ResourceRecord,
    request: ResourceActionRequest,
    log: LogFn,
  ): Promise<Partial<ResourceRecord>> {
    const expectedFirewalls = context.deployment.resources.filter(isPanwVmseriesResource);
    if (!expectedFirewalls.length) {
      throw new Error(`Deployment ${context.deployment.name} has no panw-vmseries resources for config pushes`);
    }

    const addOns = selectConfigAddOns(context.resource.configAddOns, request.params);
    const loadedAddOns = await Promise.all(
      addOns.map(async (addOn) => {
        const filePath = context.configLoader.resolveProjectPath(addOn.file);
        return {
          name: addOn.name ?? addOn.file,
          file: addOn.file,
          content: await readFile(filePath, "utf8"),
          commit: addOn.commit,
          push: addOn.push,
        };
      }),
    );

    const outputs = await context.terraform.readOutputs(context, record, log);
    const result = await this.panwBootstrap.applyConfigAddOns(
      context.deployment,
      context.resource,
      outputs,
      expectedFirewalls,
      loadedAddOns,
      log,
    );

    return {
      panos: {
        ...record.panos,
        managementAddress: result.managementAddress,
        configAddOns: result.appliedAddOns,
        onboardedFirewallSerials: result.firewallSerials.length
          ? result.firewallSerials
          : record.panos?.onboardedFirewallSerials,
        templateStack: result.pushedTemplateStack ?? record.panos?.templateStack,
        deviceGroup: result.pushedDeviceGroup ?? record.panos?.deviceGroup,
      },
    };
  }
}

function resolvePanoramaSerial(resource: PanoramaResourceConfig): string | null {
  if (resource.license.serial) return resource.license.serial;
  if (resource.license.serialEnv) return process.env[resource.license.serialEnv] ?? null;
  return null;
}

function isPanwVmseriesResource(resource: ResourceConfig): resource is PanwVmseriesResourceConfig {
  return resource.kind === "panw-vmseries";
}

function selectConfigAddOns(
  configuredAddOns: PanoramaConfigAddOnConfig[] | null | undefined,
  params: Record<string, unknown> | undefined,
): PanoramaConfigAddOnConfig[] {
  if (!Array.isArray(configuredAddOns) || !configuredAddOns.length) {
    throw new Error("Panorama apply-config-addons requires resource.configAddOns");
  }

  for (const addOn of configuredAddOns) {
    if (!addOn || typeof addOn !== "object" || typeof addOn.file !== "string" || !addOn.file) {
      throw new Error("Panorama configAddOns entries must include a file");
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
    if (!addOn) throw new Error(`Unknown Panorama config add-on ${name}`);
    return addOn;
  });
}

function requestedConfigAddOns(params: Record<string, unknown> | undefined): string[] {
  const value = params?.addOn ?? params?.addOns;
  if (value === undefined || value === null) return [];
  if (typeof value === "string" && value) return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === "string" && item)) return value;
  throw new Error("Panorama apply-config-addons params.addOn/addOns must be a string or string array");
}
