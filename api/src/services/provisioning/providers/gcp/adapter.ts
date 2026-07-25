import { spawn, type ChildProcess } from "node:child_process";
import type {
  ProviderConfig,
  ProviderCredentialStatus,
  ProviderResourceExistence,
  ResourcePowerState,
  ResourceRecord,
} from "../../types/index.js";
import type { LogFn } from "../../types/logging.js";
import type {
  ProviderAdapter,
  ProviderGenericResourceContext,
  ProviderPortForward,
  ProviderPortForwardRequest,
  ProviderPowerControlResult,
} from "../../types/providerAdapter.js";
import { captureCommand } from "../../utils/index.js";
import {
  classifyCredentialError,
  errorMessage,
  resolveConfigValue,
  trimCliMessage,
  type CredentialErrorRule,
} from "../credentials.js";

// GCP provider adapter. Shares the AWS shape — Terraform provisions, the adapter owns
// the out-of-band operations (power, credentials, existence, tunnels) — with the
// gcloud CLI in place of the AWS CLI and IAP in place of SSM.
//
// GCP resources are project- and zone-scoped, so every call needs a (project, zone)
// pair. The zone comes from the resource's Terraform outputs (the stacks emit it) and
// falls back to placement/provider config; the project comes from the provider profile.
export class GcpProviderAdapter implements ProviderAdapter {
  readonly type = "gcp" as const;
  readonly requiresBootstrapIso = false;

  credentialScope(providerConfig: ProviderConfig): string {
    const project = resolveProject(providerConfig) ?? "unset";
    const region = resolveRegion(providerConfig) ?? "default";
    return `gcp:${project}:${region}`;
  }

  // Two probes: the active account (cheap, local) and a real API call against the
  // configured project. A locally-cached account with a dead refresh token passes the
  // first and fails the second — which is exactly the expired case that matters here.
  async checkCredentials(
    providerConfig: ProviderConfig,
    log: LogFn,
  ): Promise<ProviderCredentialStatus> {
    const project = resolveProject(providerConfig);
    if (!project) {
      return {
        state: "missing",
        detail: "no GCP project is configured",
        remediation: "set `project` on the provider profile (or the env var named by projectEnv)",
      };
    }

    let account: string | null = null;
    try {
      account = (await captureCommand(
        "gcloud",
        ["auth", "list", "--filter=status:ACTIVE", "--format=value(account)"],
        { env: gcloudEnv(providerConfig), log },
      )).trim() || null;
    } catch (error) {
      const classified = classifyCredentialError(error, GCP_CREDENTIAL_RULES);
      return { state: classified.state, identity: null, detail: classified.detail, remediation: classified.remediation };
    }

    if (!account) {
      return {
        state: "missing",
        detail: "gcloud has no active account",
        remediation: "run `gcloud auth login` and `gcloud auth application-default login` on the host",
      };
    }

    try {
      await captureCommand(
        "gcloud",
        ["projects", "describe", project, "--format=value(projectId)"],
        { env: gcloudEnv(providerConfig), log },
      );
      return { state: "ok", identity: account, detail: `project ${project}` };
    } catch (error) {
      const classified = classifyCredentialError(error, GCP_CREDENTIAL_RULES);
      return {
        state: classified.state,
        identity: account,
        detail: classified.detail,
        remediation: classified.remediation,
      };
    }
  }

  async describeResource(
    context: ProviderGenericResourceContext,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<ProviderResourceExistence> {
    const providerResourceId = record.providerResourceId?.trim();
    if (!providerResourceId) {
      return { presence: "unknown", detail: "no provider resource id is recorded" };
    }
    const project = resolveProject(context.deployment.provider);
    if (!project) return { presence: "unknown", detail: "deployment has no GCP project" };
    const env = gcloudEnv(context.deployment.provider);

    try {
      if (isComputeInstanceKind(record.kind)) {
        const target = resolveInstanceTarget(context, record, project);
        if (!target.zone) {
          return { presence: "unknown", detail: `no zone recorded for ${record.hostname}` };
        }
        const status = (await captureCommand(
          "gcloud",
          [
            "compute", "instances", "describe", target.name,
            `--project=${target.project}`,
            `--zone=${target.zone}`,
            "--format=value(status)",
          ],
          { env, log },
        )).trim();
        return { presence: "present", powerState: mapGcpPowerState(status) };
      }

      if (record.kind === "network") {
        await captureCommand(
          "gcloud",
          ["compute", "networks", "describe", networkName(providerResourceId), `--project=${project}`, "--format=value(name)"],
          { env, log },
        );
        return { presence: "present" };
      }

      return {
        presence: "unknown",
        detail: `no existence probe for GCP resource kind ${record.kind ?? "unknown"}`,
      };
    } catch (error) {
      const detail = trimCliMessage(errorMessage(error));
      if (GCP_NOT_FOUND.test(detail)) return { presence: "missing", detail };
      if (GCP_AUTH_FAILURE.test(detail)) return { presence: "unknown", detail, credentialFailure: true };
      return { presence: "unknown", detail };
    }
  }

  supportsPowerControl(
    _context: ProviderGenericResourceContext,
    record: ResourceRecord,
  ): boolean {
    return record.provider === "gcp" && isComputeInstanceKind(record.kind) && Boolean(record.providerResourceId);
  }

  async getResourcePowerState(
    context: ProviderGenericResourceContext,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<ResourcePowerState> {
    const target = requireInstanceTarget(context, record);
    const status = (await captureCommand(
      "gcloud",
      [
        "compute", "instances", "describe", target.name,
        `--project=${target.project}`,
        `--zone=${target.zone}`,
        "--format=value(status)",
      ],
      { env: gcloudEnv(context.deployment.provider), log },
    )).trim();
    return mapGcpPowerState(status);
  }

  async startResource(
    context: ProviderGenericResourceContext,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<ProviderPowerControlResult> {
    const target = requireInstanceTarget(context, record);
    const current = await this.getResourcePowerState(context, record, log);
    if (current === "running") {
      log(`${record.hostname} is already running.`);
      return { powerState: current };
    }

    log(`Starting GCP instance ${target.name} for ${record.hostname}`);
    await captureCommand(
      "gcloud",
      ["compute", "instances", "start", target.name, `--project=${target.project}`, `--zone=${target.zone}`],
      { env: gcloudEnv(context.deployment.provider), log },
    );
    return { powerState: await this.getResourcePowerState(context, record, log) };
  }

  async stopResource(
    context: ProviderGenericResourceContext,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<ProviderPowerControlResult> {
    const target = requireInstanceTarget(context, record);
    const current = await this.getResourcePowerState(context, record, log);
    if (current === "stopped") {
      log(`${record.hostname} is already stopped.`);
      return { powerState: current };
    }

    log(`Stopping GCP instance ${target.name} for ${record.hostname}`);
    await captureCommand(
      "gcloud",
      ["compute", "instances", "stop", target.name, `--project=${target.project}`, `--zone=${target.zone}`],
      { env: gcloudEnv(context.deployment.provider), log },
    );
    return { powerState: await this.getResourcePowerState(context, record, log) };
  }

  // IAP TCP forwarding is GCP's equivalent of SSM port forwarding: it reaches an
  // instance with no public IP, so the tunnel manager's proxy/port/TTL handling works
  // unchanged. Needs the IAP range (35.235.240.0/20) allowed to the target port.
  async openPortForward(
    context: ProviderGenericResourceContext,
    record: ResourceRecord,
    request: ProviderPortForwardRequest,
    log: LogFn,
  ): Promise<ProviderPortForward> {
    const target = requireInstanceTarget(context, record);
    const localHost = request.localHost ?? "127.0.0.1";

    log(
      `Starting GCP IAP tunnel for ${record.hostname} (${target.name}): ` +
        `${localHost}:${request.localPort} -> instance port ${request.remotePort}`,
    );

    const child = spawn(
      "gcloud",
      [
        "compute", "start-iap-tunnel", target.name, String(request.remotePort),
        `--project=${target.project}`,
        `--zone=${target.zone}`,
        `--local-host-port=${localHost}:${request.localPort}`,
      ],
      { env: { ...process.env, ...gcloudEnv(context.deployment.provider) }, stdio: ["ignore", "pipe", "pipe"] },
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

    child.stdout?.on("data", (chunk: Buffer) => logProcessOutput(chunk, log));
    child.stderr?.on("data", (chunk: Buffer) => logProcessOutput(chunk, log));
    child.once("error", (error) => {
      const message = `gcloud iap tunnel process error: ${error.message}`;
      log(message);
      notifyExit(message);
    });
    child.once("exit", (code, signal) => {
      const detail = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
      notifyExit(`gcloud iap tunnel ended (${detail})`);
    });

    return {
      localPort: request.localPort,
      get closed() {
        return closed || child.exitCode != null;
      },
      close: async () => {
        closedByRequest = true;
        closed = true;
        terminateChild(child);
      },
    };
  }
}

const computeInstanceKinds = new Set(["ubuntu-server", "windows-endpoint", "panw-vmseries", "panorama"]);

const GCP_NOT_FOUND = /was not found|NOT_FOUND|notFound|does not exist|\(404\)|HTTPError 404/i;
const GCP_AUTH_FAILURE =
  /Reauthentication|invalid_grant|expired or (?:been )?revoked|do not currently have an active account|PERMISSION_DENIED|UNAUTHENTICATED|\(40[13]\)|credentials were not found/i;

const GCP_CREDENTIAL_RULES: CredentialErrorRule[] = [
  {
    state: "expired",
    pattern: /Reauthentication (?:required|failed)|invalid_grant|expired or (?:been )?revoked|problem refreshing your current auth|credentials? (?:have )?expired/i,
    remediation: "run `gcloud auth login` and `gcloud auth application-default login` on the host",
  },
  {
    state: "missing",
    pattern: /do not currently have an active account|no active account|Application Default Credentials .*(?:not found|were not found)|could not (?:automatically )?determine credentials|was not found in the credentials/i,
    remediation: "run `gcloud auth login` and `gcloud auth application-default login` on the host",
  },
  {
    state: "denied",
    pattern: /PERMISSION_DENIED|does not have permission|caller does not have|\(403\)|Required '[^']+' permission/i,
    remediation: "the account authenticates but lacks IAM permission on the project",
  },
  {
    state: "error",
    pattern: /was not found|NOT_FOUND|\(404\)/i,
    remediation: "the configured GCP project does not exist or is not visible to this account",
  },
];

interface GcpInstanceTarget {
  project: string;
  zone: string;
  name: string;
}

function isComputeInstanceKind(kind: string | null | undefined): boolean {
  return Boolean(kind && computeInstanceKinds.has(kind));
}

function requireInstanceTarget(
  context: ProviderGenericResourceContext,
  record: ResourceRecord,
): GcpInstanceTarget & { zone: string } {
  const project = resolveProject(context.deployment.provider);
  if (!project) throw new Error(`GCP project is required for ${record.hostname}`);
  const target = resolveInstanceTarget(context, record, project);
  if (!target.zone) {
    throw new Error(
      `No GCP zone recorded for ${record.hostname} — set placement.zone or provider.zone`,
    );
  }
  if (!target.name) throw new Error(`${record.hostname} has no recorded GCP instance name`);
  return { ...target, zone: target.zone };
}

/**
 * Locate the instance. Terraform may hand back either a bare instance name or the full
 * `projects/<p>/zones/<z>/instances/<n>` path, and the stacks also emit the zone as an
 * output — parse whichever is available before falling back to placement/provider config.
 */
function resolveInstanceTarget(
  context: ProviderGenericResourceContext,
  record: ResourceRecord,
  project: string,
): { project: string; zone: string | null; name: string } {
  const id = record.providerResourceId?.trim() ?? "";
  const parsed = /projects\/([^/]+)\/zones\/([^/]+)\/instances\/([^/]+)/.exec(id);
  if (parsed) {
    return { project: parsed[1], zone: parsed[2], name: parsed[3] };
  }

  return {
    project,
    zone: resolveZone(context, record),
    name: id || record.hostname,
  };
}

function resolveZone(
  context: ProviderGenericResourceContext,
  record: ResourceRecord,
): string | null {
  const fromOutputs =
    outputString(record.outputs, ["server", "zone"]) ??
    outputString(record.outputs, ["zone"]);
  if (fromOutputs) return fromOutputs;

  const placement = context.resource.placement as Record<string, unknown> | undefined;
  if (typeof placement?.zone === "string" && placement.zone) return placement.zone;

  const providerZone = context.deployment.provider.zone;
  if (typeof providerZone === "string" && providerZone) return providerZone;

  // A regional profile with no zone still resolves: GCP zone names are `<region>-<letter>`.
  const region = resolveRegion(context.deployment.provider);
  return region ? `${region}-a` : null;
}

function networkName(providerResourceId: string): string {
  const parsed = /networks\/([^/]+)$/.exec(providerResourceId);
  return parsed ? parsed[1] : providerResourceId;
}

function resolveProject(providerConfig: ProviderConfig): string | undefined {
  return resolveConfigValue(providerConfig as Record<string, unknown>, "project");
}

function resolveRegion(providerConfig: ProviderConfig): string | undefined {
  return resolveConfigValue(providerConfig as Record<string, unknown>, "region");
}

/**
 * Env for every gcloud call. GOOGLE_APPLICATION_CREDENTIALS / GOOGLE_CREDENTIALS resolve
 * through the same env indirection Terraform uses, so the CLI probes authenticate as the
 * deployment does; CLOUDSDK_CORE_PROJECT keeps `--project`-less calls on the right project.
 */
function gcloudEnv(providerConfig: ProviderConfig): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { CLOUDSDK_CORE_DISABLE_PROMPTS: "1" };
  const project = resolveProject(providerConfig);
  if (project) env.CLOUDSDK_CORE_PROJECT = project;
  const region = resolveRegion(providerConfig);
  if (region) env.CLOUDSDK_COMPUTE_REGION = region;
  const credentials = resolveConfigValue(
    providerConfig as Record<string, unknown>,
    "credentialsFile",
  );
  if (credentials) env.GOOGLE_APPLICATION_CREDENTIALS = credentials;
  return env;
}

// GCP calls a stopped instance TERMINATED; the broker reserves "terminated" for a
// resource that no longer exists, so it maps to "stopped" here.
function mapGcpPowerState(value: string): ResourcePowerState {
  switch (value.toUpperCase()) {
    case "PROVISIONING":
    case "STAGING":
      return "pending";
    case "RUNNING":
    case "REPAIRING":
      return "running";
    case "STOPPING":
    case "SUSPENDING":
      return "stopping";
    case "TERMINATED":
    case "STOPPED":
    case "SUSPENDED":
      return "stopped";
    default:
      return "unknown";
  }
}

function outputString(
  outputs: Record<string, unknown> | null | undefined,
  pathParts: string[],
): string | null {
  let current: unknown = outputs;
  for (const key of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" && current ? current : null;
}

function logProcessOutput(chunk: Buffer, log: LogFn): void {
  for (const line of chunk.toString("utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) log(trimmed);
  }
}

function terminateChild(child: ChildProcess): void {
  if (child.exitCode != null || child.killed) return;
  child.kill("SIGTERM");
  const timer = setTimeout(() => {
    if (child.exitCode == null && !child.killed) child.kill("SIGKILL");
  }, 5000);
  timer.unref();
}
