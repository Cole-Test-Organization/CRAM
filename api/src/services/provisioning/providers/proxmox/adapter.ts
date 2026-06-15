import type {
  PanwVmseriesResourceConfig,
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
import {
  proxmoxConnectionFromRuntimeConfig,
  proxmoxGet,
  proxmoxPost,
} from "./client.js";
import { toProxmoxFirewallConfig } from "./config.js";

export class ProxmoxProviderAdapter implements ProviderAdapter {
  readonly type = "proxmox" as const;
  readonly requiresBootstrapIso = true;

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
