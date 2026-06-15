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

interface UbuntuServerResourceConfig extends BaseResourceConfig {
  kind: "ubuntu-server";
  appProfiles?: unknown;
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
        return await expandLinuxAppProfiles(resource as UbuntuServerResourceConfig, configLoader, configRef);
      }),
    );

    return {
      ...deployment,
      resources,
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
    await this.terraformResource.down(context, record, log);
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

    await waitForSsmOnline(region, instanceId, timeoutSeconds, log);
    await waitForUbuntuBootstrap(region, instanceId, timeoutSeconds, log);
    const commandId = await sendSsmShellCommand(region, instanceId, [
      [
        "bash",
        "-lc",
        [
          "set -euo pipefail",
          "test -f /var/lib/panw-broker/bootstrap.success",
          "curl -fsSL --max-time 20 https://checkip.amazonaws.com/",
          "codex --version",
          "claude --version || true",
        ].join("; "),
      ].map(shellQuote).join(" "),
    ], "Verify Ubuntu internet access and CLI bootstrap", timeoutSeconds, log);
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
  timeoutSeconds: number,
  log: LogFn,
): Promise<void> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const commandId = await sendSsmShellCommand(region, instanceId, [
      [
        "bash",
        "-lc",
        [
          "set -euo pipefail",
          "test -f /var/lib/panw-broker/bootstrap.success",
          "codex --version",
          "claude --version || true",
        ].join("; "),
      ].map(shellQuote).join(" "),
    ], "Wait for Ubuntu CLI bootstrap", 120, log);

    const result = await waitForSsmCommandResult(region, commandId, instanceId, 120, log);
    if (result.status === "Success") {
      log(`Ubuntu bootstrap is ready on ${instanceId}: ${result.stdout.trim()}`);
      return;
    }

    log(`Waiting for Ubuntu bootstrap on ${instanceId}: ${result.status}${formatSsmMessage(result.stderr)}`);
    await sleep(30_000);
  }

  throw new Error(`Timed out waiting for Ubuntu bootstrap on ${instanceId}`);
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

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
