import type {
  PanwVmseriesResourceConfig,
  ProviderConfig,
  ProviderCredentialStatus,
  ProviderResourceExistence,
  ResourcePowerState,
  ResourceRecord,
} from "../../types/index.js";
import type { LogFn } from "../../types/logging.js";
import type {
  ProviderGenericResourceContext,
  ProviderAdapter,
  ProviderPowerControlResult,
} from "../../types/providerAdapter.js";
import type { ProxmoxPowerRuntime, ProxmoxVmStatus } from "../../types/proxmoxAdapter.js";
import { optionalEnv } from "../../utils/index.js";
import { errorMessage, trimCliMessage } from "../credentials.js";
import {
  proxmoxConnectionFromRuntimeConfig,
  proxmoxGet,
  proxmoxPost,
} from "./client.js";
import { toProxmoxFirewallConfig } from "./config.js";

export class ProxmoxProviderAdapter implements ProviderAdapter {
  readonly type = "proxmox" as const;
  readonly requiresBootstrapIso = true;

  credentialScope(providerConfig: ProviderConfig): string {
    const endpoint = resolveProxmoxEndpoint(providerConfig) ?? "unset";
    return `proxmox:${endpoint}`;
  }

  // Proxmox API tokens do not expire on their own, but they are revoked/rotated and the
  // LAN endpoint is often simply unreachable from the container — all three present the
  // same way to a caller, so name which one it is.
  async checkCredentials(
    providerConfig: ProviderConfig,
    log: LogFn,
  ): Promise<ProviderCredentialStatus> {
    const endpoint = resolveProxmoxEndpoint(providerConfig);
    const apiToken = resolveProxmoxToken(providerConfig);
    if (!endpoint || !apiToken) {
      const missing = [!endpoint && "endpoint", !apiToken && "API token"].filter(Boolean).join(" and ");
      return {
        state: "missing",
        detail: `Proxmox ${missing} not configured`,
        remediation: "set PROXMOX_VE_ENDPOINT and PROXMOX_VE_API_TOKEN on the Secrets page",
      };
    }

    log(`Checking Proxmox credentials against ${endpoint}`);
    try {
      const version = await proxmoxGet<{ version?: string; release?: string }>(
        { endpoint, apiToken, insecure: resolveProxmoxInsecure(providerConfig) },
        "/version",
      );
      return {
        state: "ok",
        identity: endpoint,
        detail: version.version ? `Proxmox VE ${version.version}` : null,
      };
    } catch (error) {
      const detail = trimCliMessage(errorMessage(error));
      if (/^401|authentication failure|invalid token|no such token/i.test(detail)) {
        return {
          state: "expired",
          detail,
          remediation: "the API token was revoked or rotated — issue a new PROXMOX_VE_API_TOKEN",
        };
      }
      if (/^403|permission denied/i.test(detail)) {
        return { state: "denied", detail, remediation: "grant the token PVEAuditor (or higher) on /" };
      }
      return {
        state: "error",
        detail,
        remediation: `could not reach ${endpoint} from the API container — check the LAN route and TLS settings`,
      };
    }
  }

  async describeResource(
    context: ProviderGenericResourceContext,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<ProviderResourceExistence> {
    const vmId = resolveProxmoxVmId(record);
    if (!vmId) return { presence: "unknown", detail: "no Proxmox VMID is recorded" };

    try {
      const runtime = proxmoxPowerRuntime(context, record);
      const status = await getProxmoxVmStatus(runtime, log);
      return { presence: "present", powerState: mapProxmoxPowerState(status) };
    } catch (error) {
      const detail = trimCliMessage(errorMessage(error));
      // Proxmox answers a request for a VMID it does not have with 500 "does not exist".
      if (/does not exist|no such vm|not found|Configuration file .* does not exist/i.test(detail)) {
        return { presence: "missing", detail };
      }
      if (/^401|^403|authentication failure|permission denied/i.test(detail)) {
        return { presence: "unknown", detail, credentialFailure: true };
      }
      return { presence: "unknown", detail };
    }
  }

  supportsPowerControl(
    context: ProviderGenericResourceContext,
    record: ResourceRecord,
  ): boolean {
    return context.resource.kind === "panw-vmseries" && Boolean(resolveProxmoxVmId(record));
  }

  async getResourcePowerState(
    context: ProviderGenericResourceContext,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<ResourcePowerState> {
    const runtime = proxmoxPowerRuntime(context, record);
    const status = await getProxmoxVmStatus(runtime, log);
    return mapProxmoxPowerState(status);
  }

  async startResource(
    context: ProviderGenericResourceContext,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<ProviderPowerControlResult> {
    const runtime = proxmoxPowerRuntime(context, record);
    const currentState = mapProxmoxPowerState(await getProxmoxVmStatus(runtime, log));
    if (currentState === "running") {
      log(`${record.hostname} is already running.`);
      return { powerState: currentState };
    }

    log(`Starting Proxmox VM ${runtime.vmId} for ${record.hostname}`);
    await proxmoxPost<unknown>(
      runtime.connection,
      `/nodes/${encodeURIComponent(runtime.targetNode)}/qemu/${runtime.vmId}/status/start`,
    );
    return { powerState: await waitForProxmoxPowerState(runtime, "running", log) };
  }

  async stopResource(
    context: ProviderGenericResourceContext,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<ProviderPowerControlResult> {
    const runtime = proxmoxPowerRuntime(context, record);
    const currentState = mapProxmoxPowerState(await getProxmoxVmStatus(runtime, log));
    if (currentState === "stopped") {
      log(`${record.hostname} is already stopped.`);
      return { powerState: currentState };
    }

    log(`Shutting down Proxmox VM ${runtime.vmId} for ${record.hostname}`);
    await proxmoxPost<unknown>(
      runtime.connection,
      `/nodes/${encodeURIComponent(runtime.targetNode)}/qemu/${runtime.vmId}/status/shutdown`,
    );
    return { powerState: await waitForProxmoxPowerState(runtime, "stopped", log) };
  }
}

// Provider-profile fields are env indirections (endpointEnv/apiTokenEnv), resolved out of
// the job's secret overlay first, matching how the deployment path reads them.
function resolveProxmoxEndpoint(providerConfig: ProviderConfig): string | undefined {
  const envName = typeof providerConfig.endpointEnv === "string" ? providerConfig.endpointEnv : "PROXMOX_VE_ENDPOINT";
  return optionalEnv(envName)?.trim() || undefined;
}

function resolveProxmoxToken(providerConfig: ProviderConfig): string | undefined {
  const envName = typeof providerConfig.apiTokenEnv === "string" ? providerConfig.apiTokenEnv : "PROXMOX_VE_API_TOKEN";
  return optionalEnv(envName)?.trim() || undefined;
}

function resolveProxmoxInsecure(providerConfig: ProviderConfig): boolean {
  if (typeof providerConfig.insecure === "boolean") return providerConfig.insecure;
  const raw = optionalEnv("PROXMOX_VE_INSECURE");
  return raw === undefined ? true : ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function proxmoxPowerRuntime(
  context: ProviderGenericResourceContext,
  record: ResourceRecord,
): ProxmoxPowerRuntime {
  if (context.resource.kind !== "panw-vmseries") {
    throw new Error(`Proxmox power control only supports panw-vmseries resources`);
  }

  const config = toProxmoxFirewallConfig(
    context.deployment,
    context.resource as PanwVmseriesResourceConfig,
    context.configPath,
  );
  const vmId = resolveProxmoxVmId(record);
  if (!vmId) throw new Error(`No Proxmox VMID is recorded for ${record.hostname}`);
  return {
    connection: proxmoxConnectionFromRuntimeConfig(config.proxmox),
    targetNode: config.proxmox.targetNode,
    vmId,
    hostname: record.hostname,
  };
}

async function getProxmoxVmStatus(
  runtime: ProxmoxPowerRuntime,
  log: LogFn,
): Promise<string> {
  log(`Checking Proxmox VM ${runtime.vmId} power state for ${runtime.hostname}`);
  const status = await proxmoxGet<ProxmoxVmStatus>(
    runtime.connection,
    `/nodes/${encodeURIComponent(runtime.targetNode)}/qemu/${runtime.vmId}/status/current`,
  );
  return status.status ?? "unknown";
}

async function waitForProxmoxPowerState(
  runtime: ProxmoxPowerRuntime,
  expected: "running" | "stopped",
  log: LogFn,
): Promise<ResourcePowerState> {
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const state = mapProxmoxPowerState(await getProxmoxVmStatus(runtime, log));
    if (state === expected) return state;
    await sleep(5_000);
  }

  throw new Error(`Timed out waiting for Proxmox VM ${runtime.vmId} to become ${expected}`);
}

function mapProxmoxPowerState(status: string): ResourcePowerState {
  switch (status) {
    case "running":
      return "running";
    case "stopped":
      return "stopped";
    default:
      return "unknown";
  }
}

function resolveProxmoxVmId(record: ResourceRecord): number | null {
  if (typeof record.vmId === "number") return record.vmId;
  if (record.providerResourceId && /^\d+$/.test(record.providerResourceId)) {
    return Number(record.providerResourceId);
  }
  return null;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
