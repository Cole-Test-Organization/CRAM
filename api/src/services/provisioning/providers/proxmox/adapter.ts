import { connect, createServer, type Socket } from "node:net";
import type {
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
  ProviderPortForward,
  ProviderPortForwardRequest,
  ProviderPowerShellCommandOptions,
  ProviderPowerControlResult,
} from "../../types/providerAdapter.js";
import type { ProxmoxPowerRuntime, ProxmoxVmStatus } from "../../types/proxmoxAdapter.js";
import { optionalEnv } from "../../utils/index.js";
import { errorMessage, trimCliMessage } from "../credentials.js";
import { proxmoxGet, proxmoxPost } from "./client.js";

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
    return proxmoxVmKinds.has(context.resource.kind) && Boolean(resolveProxmoxVmId(record));
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

  async runPowerShellCommand(
    context: ProviderGenericResourceContext,
    record: ResourceRecord,
    commands: string[],
    description: string,
    log: LogFn,
    options: ProviderPowerShellCommandOptions = {},
  ): Promise<void> {
    await this.capturePowerShellCommand(context, record, commands, description, log, options);
  }

  async capturePowerShellCommand(
    context: ProviderGenericResourceContext,
    record: ResourceRecord,
    commands: string[],
    description: string,
    log: LogFn,
    options: ProviderPowerShellCommandOptions = {},
  ): Promise<string> {
    if (context.resource.kind !== "windows-endpoint") {
      throw new Error(`Proxmox PowerShell execution does not support ${context.resource.kind} resources`);
    }
    const runtime = proxmoxPowerRuntime(context, record);
    const timeoutSeconds = options.timeoutSeconds ?? 600;
    const encodedCommand = Buffer.from(commands.join("\r\n"), "utf16le").toString("base64");
    log(`Running Proxmox QEMU guest-agent PowerShell command for ${record.hostname}: ${description}`);

    const started = await proxmoxPost<ProxmoxAgentExecStart>(
      runtime.connection,
      `/nodes/${encodeURIComponent(runtime.targetNode)}/qemu/${runtime.vmId}/agent/exec`,
      {
        command: [
          "powershell.exe",
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          encodedCommand,
        ],
      },
    );
    if (!Number.isInteger(started.pid)) {
      throw new Error(`Proxmox did not return a guest-agent PID for ${record.hostname}`);
    }

    const deadline = Date.now() + timeoutSeconds * 1000;
    while (Date.now() < deadline) {
      const status = await proxmoxGet<ProxmoxAgentExecStatus>(
        runtime.connection,
        `/nodes/${encodeURIComponent(runtime.targetNode)}/qemu/${runtime.vmId}/agent/exec-status?pid=${started.pid}`,
      );
      if (status.exited === 1) {
        if (status.exitcode !== 0) {
          const detail = trimCliMessage(status["err-data"] || status["out-data"] || "no guest output");
          throw new Error(
            `Proxmox QEMU guest-agent PowerShell command failed for ${record.hostname} ` +
              `(exit ${status.exitcode ?? "unknown"}): ${detail}`,
          );
        }
        return status["out-data"] ?? "";
      }
      await sleep(1_000);
    }

    throw new Error(
      `Timed out after ${timeoutSeconds}s waiting for Proxmox QEMU guest-agent command ` +
        `${started.pid} on ${record.hostname}`,
    );
  }

  async setWindowsUserPassword(
    context: ProviderGenericResourceContext,
    record: ResourceRecord,
    username: string,
    password: string,
    description: string,
    log: LogFn,
  ): Promise<void> {
    if (context.resource.kind !== "windows-endpoint") {
      throw new Error(`Proxmox Windows password updates do not support ${context.resource.kind} resources`);
    }
    const runtime = proxmoxPowerRuntime(context, record);
    log(`Updating the Windows credential for ${record.hostname} through QEMU guest agent: ${description}`);
    await proxmoxPost<unknown>(
      runtime.connection,
      `/nodes/${encodeURIComponent(runtime.targetNode)}/qemu/${runtime.vmId}/agent/set-user-password`,
      { username, password },
    );
  }

  async openPortForward(
    _context: ProviderGenericResourceContext,
    record: ResourceRecord,
    request: ProviderPortForwardRequest,
    log: LogFn,
  ): Promise<ProviderPortForward> {
    const guestAddress = resolveProxmoxGuestIpv4(record);
    const localHost = request.localHost ?? "127.0.0.1";
    log(
      `Starting direct Proxmox port-forward for ${record.hostname}: ` +
        `${localHost}:${request.localPort} -> ${guestAddress}:${request.remotePort}`,
    );

    let closed = false;
    let closedByRequest = false;
    let exitNotified = false;
    const notifyExit = (reason: string) => {
      closed = true;
      if (closedByRequest || exitNotified) return;
      exitNotified = true;
      request.onExit?.(reason);
    };

    const sockets = new Set<Socket>();
    const server = createServer((client) => {
      const remote = connect({ host: guestAddress, port: request.remotePort });
      sockets.add(client);
      sockets.add(remote);
      client.once("close", () => sockets.delete(client));
      remote.once("close", () => sockets.delete(remote));
      client.once("error", () => remote.destroy());
      remote.once("error", (error) => {
        log(`Proxmox port-forward connection to ${guestAddress}:${request.remotePort} failed: ${error.message}`);
        client.destroy();
      });
      client.pipe(remote);
      remote.pipe(client);
    });
    server.once("error", (error) => notifyExit(`Proxmox port-forward listener failed: ${error.message}`));
    server.once("close", () => notifyExit("Proxmox port-forward listener closed"));

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(request.localPort, localHost);
    });

    return {
      localPort: request.localPort,
      get closed() {
        return closed || !server.listening;
      },
      close: async () => {
        if (closed) return;
        closedByRequest = true;
        closed = true;
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
      },
    };
  }
}

const proxmoxVmKinds = new Set(["panorama", "panw-vmseries", "ubuntu-server", "windows-endpoint"]);

interface ProxmoxAgentExecStart {
  pid?: number;
}

interface ProxmoxAgentExecStatus {
  exited?: number;
  exitcode?: number;
  "out-data"?: string;
  "err-data"?: string;
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
  if (!proxmoxVmKinds.has(context.resource.kind)) {
    throw new Error(`Proxmox power control does not support ${context.resource.kind} resources`);
  }
  const endpoint = resolveProxmoxEndpoint(context.deployment.provider);
  const apiToken = resolveProxmoxToken(context.deployment.provider);
  if (!endpoint || !apiToken) {
    throw new Error(`Proxmox endpoint and API token are required for ${record.hostname}`);
  }
  const placement = context.resource.placement as { targetNode?: unknown };
  const targetNode = stringValue(placement.targetNode) ??
    stringValue(context.deployment.provider.defaultTargetNode);
  if (!targetNode) throw new Error(`No Proxmox target node is configured for ${record.hostname}`);
  const vmId = resolveProxmoxVmId(record);
  if (!vmId) throw new Error(`No Proxmox VMID is recorded for ${record.hostname}`);
  return {
    connection: {
      endpoint,
      apiToken,
      insecure: resolveProxmoxInsecure(context.deployment.provider),
    },
    targetNode,
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

function resolveProxmoxGuestIpv4(record: ResourceRecord): string {
  const endpoint = record.outputs?.endpoint;
  if (endpoint && typeof endpoint === "object" && !Array.isArray(endpoint)) {
    const privateIp = (endpoint as { private_ip?: unknown }).private_ip;
    if (isUsableIpv4(privateIp)) return privateIp;
    const addresses = (endpoint as { ipv4_addresses?: unknown }).ipv4_addresses;
    if (Array.isArray(addresses)) {
      const address = addresses.find(isUsableIpv4);
      if (address) return address;
    }
  }
  throw new Error(
    `No usable Proxmox guest IPv4 address is recorded for ${record.hostname}; refresh its Terraform outputs first`,
  );
}

function isUsableIpv4(value: unknown): value is string {
  if (typeof value !== "string" || value.startsWith("127.") || value.startsWith("169.254.")) return false;
  const octets = value.split(".");
  return octets.length === 4 && octets.every((octet) => {
    if (!/^\d+$/.test(octet)) return false;
    const parsed = Number(octet);
    return parsed >= 0 && parsed <= 255;
  });
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
