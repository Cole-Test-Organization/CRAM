import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type {
  BaseResourceConfig,
  DeploymentConfig,
  ResourceRecord,
} from "../../types/index.js";
import type { LogFn } from "../../types/logging.js";
import { captureCommand } from "../../utils/index.js";
import { GenericTerraformResourceAdapter } from "../genericTerraformResourceAdapter.js";
import type {
  ResourceActionRequest,
  ResourceAdapter,
  ResourceAdapterContext,
  ResourceUpResult,
} from "../types.js";

interface LinuxAppProfile {
  packages?: unknown;
  commands?: unknown;
}

// Koi enrollment for a Linux endpoint. Mirrors the Windows koi block: the broker inlines the
// script from `scriptPath` at prepare time (adding scriptInline + scriptSha256 + interpreter),
// the bootstrap runs it once at first boot, and teardown re-runs it with the rollback arguments
// to unregister the host. NOTE: the Windows local-artifacts/windows/koi.py is a PowerShell shim
// and does NOT run on Linux — supply Koi's own Linux enrollment artifact (bash or python).
interface UbuntuKoiConfig {
  scriptPath?: unknown;
  scriptInline?: unknown;
  scriptSha256?: unknown;
  interpreter?: unknown;
  arguments?: unknown;
  environment?: unknown;
  rollbackArguments?: unknown;
  requireRollbackOnDestroy?: unknown;
}

interface UbuntuServerResourceConfig extends BaseResourceConfig {
  kind: "ubuntu-server";
  appProfiles?: unknown;
  koi?: UbuntuKoiConfig;
  bootstrap?: {
    packages?: unknown;
    commands?: unknown;
    verifyTimeoutSeconds?: unknown;
  };
}

export class UbuntuServerResourceAdapter implements ResourceAdapter<UbuntuServerResourceConfig> {
  readonly kind = "ubuntu-server";

  constructor(
    private readonly terraformResource = new GenericTerraformResourceAdapter<UbuntuServerResourceConfig>(),
  ) {}

  async prepareDeployment(
    deployment: DeploymentConfig,
    configLoader: ResourceAdapterContext<UbuntuServerResourceConfig>["configLoader"],
    configRef: string,
  ): Promise<DeploymentConfig> {
    const resources = await Promise.all(
      deployment.resources.map(async (resource) => {
        if (resource.kind !== this.kind) return resource;
        const withProfiles = await expandLinuxAppProfiles(
          resource as UbuntuServerResourceConfig,
          configLoader,
          configRef,
        );
        return await this.inlineKoiScript(withProfiles, configLoader, configRef);
      }),
    );

    return {
      ...deployment,
      resources,
    };
  }

  // Read the Koi enrollment artifact off disk and inline it into the resource (base64-agnostic
  // UTF-8 body + SHA-256 + resolved interpreter) so the Terraform bootstrap can embed and verify
  // it, exactly like the Windows adapter does. No koi.scriptPath => Koi is disabled for this host.
  private async inlineKoiScript(
    resource: UbuntuServerResourceConfig,
    configLoader: ResourceAdapterContext<UbuntuServerResourceConfig>["configLoader"],
    configRef: string,
  ): Promise<UbuntuServerResourceConfig> {
    const koi = objectValue(resource.koi);
    const scriptPath = koi.scriptPath;
    if (scriptPath === undefined || scriptPath === null || scriptPath === "") return resource;
    if (typeof scriptPath !== "string") {
      throw new Error(`Invalid config ${configRef}: ${resource.hostname}.koi.scriptPath must be a string`);
    }

    const scriptBytes = await readFile(configLoader.resolveProjectPath(scriptPath));
    const scriptSha256 =
      typeof koi.scriptSha256 === "string" && koi.scriptSha256
        ? koi.scriptSha256
        : createHash("sha256").update(scriptBytes).digest("hex");

    return {
      ...resource,
      koi: {
        ...koi,
        scriptInline: scriptBytes.toString("utf8"),
        scriptSha256,
        interpreter: koiInterpreter(resource),
      },
    };
  }

  async up(
    context: ResourceAdapterContext<UbuntuServerResourceConfig>,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<ResourceUpResult> {
    return await this.terraformResource.up(context, record, log);
  }

  async down(
    context: ResourceAdapterContext<UbuntuServerResourceConfig>,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<void> {
    await this.rollbackKoi(context, record, log);
    await this.terraformResource.down(context, record, log);
  }

  // Best-effort Koi unregister before the instance is destroyed, mirroring the Windows adapter.
  // Re-runs the on-box enrollment script with the rollback arguments over SSM. A flaky Koi backend
  // must not strand the AWS teardown, so failures are logged and swallowed unless the resource sets
  // koi.requireRollbackOnDestroy: true.
  private async rollbackKoi(
    context: ResourceAdapterContext<UbuntuServerResourceConfig>,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<void> {
    if (!koiEnabled(context.resource)) return;
    if (context.provider.type !== "aws") {
      log(`Skipping Koi rollback for ${record.hostname}: provider ${context.provider.type} is not aws.`);
      return;
    }
    if (!record.providerResourceId) {
      log(`Skipping Koi rollback for ${record.hostname}: no provider resource id is recorded.`);
      return;
    }

    const region = stringValue(context.deployment.provider.region, "provider.region");
    const instanceId = record.providerResourceId;
    const command = koiRollbackShellCommand(
      koiInterpreter(context.resource),
      koiRollbackArguments(context.resource),
    );

    const attempts = 3;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const commandId = await sendSsmShellCommand(
          region,
          instanceId,
          [command],
          `rollback Koi before destroying ${record.hostname} (attempt ${attempt}/${attempts})`,
          600,
          log,
        );
        const result = await waitForSsmCommandResult(region, commandId, instanceId, 600, log);
        if (result.status === "Success") {
          log(`Koi rollback completed for ${record.hostname}: ${result.stdout.trim()}`);
          return;
        }
        throw new Error(`SSM rollback command ended with ${result.status}${formatSsmMessage(result.stderr)}`);
      } catch (error) {
        lastError = error;
        log(`Koi rollback attempt ${attempt}/${attempts} for ${record.hostname} failed: ${errorMessage(error)}`);
        if (attempt < attempts) {
          await sleep(15_000 * attempt);
        }
      }
    }

    if (requireRollbackOnDestroy(context.resource)) {
      throw new Error(
        `Koi rollback failed for ${record.hostname} after ${attempts} attempts and koi.requireRollbackOnDestroy is set: ${errorMessage(lastError)}`,
      );
    }
    log(
      `Koi rollback did not succeed for ${record.hostname} after ${attempts} attempts ` +
        `(${errorMessage(lastError)}); proceeding with Terraform destroy as Koi rollback is best-effort. ` +
        `The endpoint may still appear registered in Koi and may need manual cleanup.`,
    );
  }

  async runAction(
    context: ResourceAdapterContext<UbuntuServerResourceConfig>,
    record: ResourceRecord,
    request: ResourceActionRequest,
    log: LogFn,
  ): Promise<Partial<ResourceRecord>> {
    if (request.action !== "verify-internet-access") {
      throw new Error(`Ubuntu server action ${request.action} is not supported`);
    }
    await this.verifyInternetAccess(context, record, log);
    return {};
  }

  private async verifyInternetAccess(
    context: ResourceAdapterContext<UbuntuServerResourceConfig>,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<void> {
    if (context.provider.type !== "aws") {
      log(`Skipping Ubuntu verification for non-AWS provider ${context.provider.type}`);
      return;
    }

    const instanceId = requireProviderResourceId(record);
    const region = stringValue(context.deployment.provider.region, "provider.region");
    const timeoutSeconds = numberValue(
      context.resource.bootstrap?.verifyTimeoutSeconds,
      1800,
    );
    const koiOn = koiEnabled(context.resource);

    await waitForSsmOnline(region, instanceId, timeoutSeconds, log);
    await waitForUbuntuBootstrap(region, instanceId, koiOn, timeoutSeconds, log);
    const checks = [
      "set -euo pipefail",
      "test -f /var/lib/panw-broker/bootstrap.success",
      ...(koiOn ? ["test -f /var/lib/panw-broker/koi.success"] : []),
      "curl -fsSL --max-time 20 https://checkip.amazonaws.com/",
      "codex --version",
      "claude --version || true",
    ];
    const commandId = await sendSsmShellCommand(
      region,
      instanceId,
      [bashCommand(checks.join("; "))],
      "Verify Ubuntu internet access and CLI bootstrap",
      timeoutSeconds,
      log,
    );
    const output = await waitForSsmCommand(region, commandId, instanceId, timeoutSeconds, log);
    log(`Ubuntu verification output for ${record.hostname}: ${output.trim()}`);
  }
}

async function expandLinuxAppProfiles(
  resource: UbuntuServerResourceConfig,
  configLoader: ResourceAdapterContext<UbuntuServerResourceConfig>["configLoader"],
  configRef: string,
): Promise<UbuntuServerResourceConfig> {
  const profileNames = stringList(resource.appProfiles);
  if (!profileNames.length) return resource;

  const bootstrap = objectValue(resource.bootstrap);
  const packages = new Set(stringList(bootstrap.packages));
  const commands = [...stringList(bootstrap.commands)];

  for (const profileName of profileNames) {
    const profile = await configLoader.loadAppProfile<LinuxAppProfile>("linux", profileName);
    for (const packageName of stringList(profile.packages)) packages.add(packageName);
    commands.push(...stringList(profile.commands));
  }

  if (!packages.size && !commands.length) {
    throw new Error(`Invalid config ${configRef}: ${resource.hostname}.appProfiles did not expand to packages or commands`);
  }

  return {
    ...resource,
    bootstrap: {
      ...bootstrap,
      packages: [...packages],
      commands,
    },
  };
}

async function waitForSsmOnline(
  region: string,
  instanceId: string,
  timeoutSeconds: number,
  log: LogFn,
): Promise<void> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const raw = await captureCommand(
      "aws",
      [
        "ssm",
        "describe-instance-information",
        "--region",
        region,
        "--filters",
        `Key=InstanceIds,Values=${instanceId}`,
      ],
      { log },
    );
    const info = JSON.parse(raw) as { InstanceInformationList?: Array<{ PingStatus?: string }> };
    if (info.InstanceInformationList?.some((item) => item.PingStatus === "Online")) {
      log(`AWS SSM agent is online for ${instanceId}`);
      return;
    }
    log(`Waiting for AWS SSM agent on ${instanceId}`);
    await sleep(15_000);
  }

  throw new Error(`Timed out waiting for AWS SSM agent on ${instanceId}`);
}

async function waitForUbuntuBootstrap(
  region: string,
  instanceId: string,
  koiEnabledFlag: boolean,
  timeoutSeconds: number,
  log: LogFn,
): Promise<void> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    let status: UbuntuMarkerStatus | null = null;
    try {
      const commandId = await sendSsmShellCommand(
        region,
        instanceId,
        [bashCommand(bootstrapMarkerProbeScript())],
        "Inspect Ubuntu bootstrap markers",
        120,
        log,
      );
      const result = await waitForSsmCommandResult(region, commandId, instanceId, 120, log);
      if (result.status === "Success") {
        status = parseUbuntuMarkerStatus(result.stdout);
      } else {
        // The SSM agent comes online before cloud-init finishes; a probe that runs during the
        // apt/npm work can be TimedOut/Failed transiently. Treat that as "still booting".
        log(`Waiting for Ubuntu bootstrap on ${instanceId}: probe ${result.status}${formatSsmMessage(result.stderr)}`);
      }
    } catch (error) {
      log(`Ubuntu bootstrap marker probe on ${instanceId} not ready yet: ${errorMessage(error)}`);
    }

    if (status) {
      // bootstrap.success is written only after Koi succeeds, so it is the definitive done signal.
      // koi.failed lets us fail fast with the real reason instead of waiting out the full timeout.
      if (koiEnabledFlag && status.koiFailed && !status.bootstrap) {
        throw new Error(
          `Koi enrollment failed on ${instanceId}: ${status.failureMessage || "see /var/lib/panw-broker/koi.log"}`,
        );
      }
      if (status.bootstrap) {
        log(`Ubuntu bootstrap is ready on ${instanceId}.`);
        return;
      }
      log(
        `Waiting for Ubuntu bootstrap on ${instanceId} ` +
          `(bootstrap=${status.bootstrap}, koi_success=${status.koiSuccess}).`,
      );
    }

    await sleep(30_000);
  }

  throw new Error(`Timed out waiting for Ubuntu bootstrap on ${instanceId}`);
}

interface UbuntuMarkerStatus {
  bootstrap: boolean;
  koiSuccess: boolean;
  koiFailed: boolean;
  failureMessage: string;
}

// Read-only probe of the bootstrap markers. Always exits 0 (even when nothing is written yet) and
// emits parseable key=value lines plus any Koi failure message, so the adapter can distinguish
// "still booting" from "Koi failed" from "done" without relying on the probe's own exit code.
function bootstrapMarkerProbeScript(): string {
  return [
    "set -uo pipefail",
    "ROOT=/var/lib/panw-broker",
    'echo "BOOTSTRAP=$([ -f "$ROOT/bootstrap.success" ] && echo true || echo false)"',
    'echo "KOI_SUCCESS=$([ -f "$ROOT/koi.success" ] && echo true || echo false)"',
    'echo "KOI_FAILED=$([ -f "$ROOT/koi.failed" ] && echo true || echo false)"',
    'if [ -f "$ROOT/koi.failed" ]; then echo "FAILMSG_BEGIN"; cat "$ROOT/koi.failed"; echo; echo "FAILMSG_END"; fi',
  ].join("\n");
}

function parseUbuntuMarkerStatus(output: string): UbuntuMarkerStatus | null {
  if (!output || !/BOOTSTRAP=/.test(output)) return null;
  const lines = output.split(/\r?\n/);
  const get = (key: string): string => {
    const line = lines.find((candidate) => candidate.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim() : "";
  };
  const isTrue = (value: string): boolean => value.toLowerCase() === "true";

  let failureMessage = "";
  const begin = lines.findIndex((line) => line.trim() === "FAILMSG_BEGIN");
  const end = lines.findIndex((line) => line.trim() === "FAILMSG_END");
  if (begin >= 0 && end > begin) {
    failureMessage = lines.slice(begin + 1, end).join(" ").trim();
  }

  return {
    bootstrap: isTrue(get("BOOTSTRAP")),
    koiSuccess: isTrue(get("KOI_SUCCESS")),
    koiFailed: isTrue(get("KOI_FAILED")),
    failureMessage,
  };
}

async function sendSsmShellCommand(
  region: string,
  instanceId: string,
  commands: string[],
  comment: string,
  timeoutSeconds: number,
  log: LogFn,
): Promise<string> {
  const raw = await captureCommand(
    "aws",
    [
      "ssm",
      "send-command",
      "--region",
      region,
      "--instance-ids",
      instanceId,
      "--document-name",
      "AWS-RunShellScript",
      "--comment",
      comment,
      "--timeout-seconds",
      String(timeoutSeconds),
      "--parameters",
      JSON.stringify({ commands }),
    ],
    { log },
  );
  const response = JSON.parse(raw) as { Command?: { CommandId?: string } };
  const commandId = response.Command?.CommandId;
  if (!commandId) throw new Error(`AWS SSM send-command did not return a command id for ${instanceId}`);
  return commandId;
}

async function waitForSsmCommand(
  region: string,
  commandId: string,
  instanceId: string,
  timeoutSeconds: number,
  log: LogFn,
): Promise<string> {
  const result = await waitForSsmCommandResult(region, commandId, instanceId, timeoutSeconds, log);
  if (result.status === "Success") return result.stdout;

  throw new Error(
    `AWS SSM command ${commandId} ended with ${result.status}: ${result.stderr}`,
  );
}

async function waitForSsmCommandResult(
  region: string,
  commandId: string,
  instanceId: string,
  timeoutSeconds: number,
  log: LogFn,
): Promise<{ status: string; stdout: string; stderr: string }> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const raw = await captureCommand(
      "aws",
      [
        "ssm",
        "get-command-invocation",
        "--region",
        region,
        "--command-id",
        commandId,
        "--instance-id",
        instanceId,
      ],
      { log },
    );
    const invocation = JSON.parse(raw) as {
      Status?: string;
      StandardOutputContent?: string;
      StandardErrorContent?: string;
    };
    if (invocation.Status === "Success") {
      return {
        status: "Success",
        stdout: invocation.StandardOutputContent ?? "",
        stderr: invocation.StandardErrorContent ?? "",
      };
    }
    if (["Cancelled", "TimedOut", "Failed", "Cancelling"].includes(invocation.Status ?? "")) {
      return {
        status: invocation.Status ?? "unknown",
        stdout: invocation.StandardOutputContent ?? "",
        stderr: invocation.StandardErrorContent ?? "",
      };
    }
    log(`Waiting for AWS SSM command ${commandId} on ${instanceId}: ${invocation.Status ?? "unknown"}`);
    await sleep(10_000);
  }

  throw new Error(`Timed out waiting for AWS SSM command ${commandId} on ${instanceId}`);
}

function formatSsmMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return "";
  return ` - ${trimmed}`;
}

function requireProviderResourceId(record: ResourceRecord): string {
  if (!record.providerResourceId) throw new Error(`${record.hostname} does not have a provider resource id`);
  return record.providerResourceId;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

// Wrap a script so SSM's AWS-RunShellScript runs it under bash (a login shell), matching how the
// bootstrap ran it. AWS-RunShellScript defaults to /bin/sh, which lacks pipefail and login PATH.
function bashCommand(script: string): string {
  return ["bash", "-lc", script].map(shellQuote).join(" ");
}

function koiConfig(resource: UbuntuServerResourceConfig): Record<string, unknown> {
  return objectValue(resource.koi);
}

function koiEnabled(resource: UbuntuServerResourceConfig): boolean {
  const scriptPath = koiConfig(resource).scriptPath;
  return typeof scriptPath === "string" && scriptPath.length > 0;
}

// Resolve the interpreter used to run the Koi script. Explicit koi.interpreter wins; otherwise a
// .py artifact runs under python3 and anything else (a .sh installer) runs under bash. Recomputed
// on teardown because prepareDeployment (which stamps it in) does not run in the destroy path.
function koiInterpreter(resource: UbuntuServerResourceConfig): string {
  const koi = koiConfig(resource);
  if (typeof koi.interpreter === "string" && koi.interpreter) return koi.interpreter;
  const scriptPath = koi.scriptPath;
  if (typeof scriptPath === "string" && scriptPath.endsWith(".py")) return "python3";
  return "bash";
}

// Arguments passed to the enrollment script on teardown. Defaults to --rollback (the Koi
// convention); an explicit array — including [] — overrides it.
function koiRollbackArguments(resource: UbuntuServerResourceConfig): string[] {
  const rollbackArguments = koiConfig(resource).rollbackArguments;
  if (Array.isArray(rollbackArguments)) {
    return rollbackArguments.filter((item): item is string => typeof item === "string");
  }
  return ["--rollback"];
}

function requireRollbackOnDestroy(resource: UbuntuServerResourceConfig): boolean {
  return koiConfig(resource).requireRollbackOnDestroy === true;
}

// Build the SSM shell command that unregisters Koi from a still-running instance. Skips cleanly if
// the on-box script is gone (Koi never ran, or an earlier rollback already removed it).
function koiRollbackShellCommand(interpreter: string, rollbackArguments: string[]): string {
  const root = "/var/lib/panw-broker";
  const scriptPath = `${root}/koi-script`;
  const runLine = [interpreter, scriptPath, ...rollbackArguments].map(shellQuote).join(" ");
  return bashCommand(
    [
      "set -uo pipefail",
      `SCRIPT=${shellQuote(scriptPath)}`,
      `LOG=${shellQuote(`${root}/koi-rollback.log`)}`,
      'if [ ! -f "$SCRIPT" ]; then echo "Koi script not found at $SCRIPT; skipping rollback."; exit 0; fi',
      `${runLine} > "$LOG" 2>&1`,
      "rc=$?",
      'tail -n 120 "$LOG" 2>/dev/null || true',
      "exit $rc",
    ].join("\n"),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
