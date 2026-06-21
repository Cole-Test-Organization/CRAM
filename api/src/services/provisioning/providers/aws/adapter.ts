import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import type { ResourcePowerState, ResourceRecord } from "../../types/index.js";
import type { LogFn } from "../../types/logging.js";
import { captureCommand, runCommand } from "../../utils/index.js";
import type {
  ProviderGenericResourceContext,
  ProviderAdapter,
  ProviderLocalArtifactRequest,
  ProviderPortForward,
  ProviderPortForwardRequest,
  ProviderPowerControlResult,
  ProviderPowerShellCommandOptions,
  ProviderStagedLocalArtifact,
  ProviderStagedLocalArtifactSet,
  ProviderWindowsBootstrapWaitOptions,
} from "../../types/providerAdapter.js";
import { awsPanoramaFirewallSteps } from "./phases.js";

export class AwsProviderAdapter implements ProviderAdapter {
  readonly type = "aws" as const;
  readonly requiresBootstrapIso = false;
  readonly steps = awsPanoramaFirewallSteps;

  supportsPowerControl(
    _context: ProviderGenericResourceContext,
    record: ResourceRecord,
  ): boolean {
    return isEc2BackedResource(record);
  }

  async getResourcePowerState(
    context: ProviderGenericResourceContext,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<ResourcePowerState> {
    const instanceId = assertEc2InstanceId(record);
    const region = stringConfig(context.deployment.provider.region, "provider.region");
    return await getEc2PowerState(region, instanceId, log);
  }

  async startResource(
    context: ProviderGenericResourceContext,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<ProviderPowerControlResult> {
    const instanceId = assertEc2InstanceId(record);
    const region = stringConfig(context.deployment.provider.region, "provider.region");
    const currentState = await getEc2PowerState(region, instanceId, log);

    if (currentState === "running") {
      log(`${record.hostname} is already running.`);
      return { powerState: currentState };
    }
    if (currentState === "terminated") {
      throw new Error(`${record.hostname} cannot be started because AWS instance ${instanceId} is terminated`);
    }
    if (currentState === "stopping") {
      log(`${record.hostname} is stopping; waiting for AWS instance ${instanceId} to stop before starting.`);
      await waitForEc2State(region, instanceId, "instance-stopped", log);
    }

    log(`Starting AWS instance ${instanceId} for ${record.hostname}`);
    await captureCommand(
      "aws",
      ["ec2", "start-instances", "--region", region, "--instance-ids", instanceId],
      { log },
    );
    await waitForEc2State(region, instanceId, "instance-running", log);
    return { powerState: await getEc2PowerState(region, instanceId, log) };
  }

  async stopResource(
    context: ProviderGenericResourceContext,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<ProviderPowerControlResult> {
    const instanceId = assertEc2InstanceId(record);
    const region = stringConfig(context.deployment.provider.region, "provider.region");
    const currentState = await getEc2PowerState(region, instanceId, log);

    if (currentState === "stopped") {
      log(`${record.hostname} is already stopped.`);
      return { powerState: currentState };
    }
    if (currentState === "terminated") {
      throw new Error(`${record.hostname} cannot be stopped because AWS instance ${instanceId} is terminated`);
    }

    log(`Stopping AWS instance ${instanceId} for ${record.hostname}`);
    await captureCommand(
      "aws",
      ["ec2", "stop-instances", "--region", region, "--instance-ids", instanceId],
      { log },
    );
    await waitForEc2State(region, instanceId, "instance-stopped", log);
    return { powerState: await getEc2PowerState(region, instanceId, log) };
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
    const instanceId = assertEc2InstanceId(record);
    const region = stringConfig(context.deployment.provider.region, "provider.region");
    const timeoutSeconds = options.timeoutSeconds ?? 600;
    log(`Running AWS SSM PowerShell command for ${record.hostname}: ${description}`);
    const commandId = await sendSsmPowerShellCommand(
      region,
      instanceId,
      commands,
      description,
      timeoutSeconds,
      log,
    );

    return await waitForSsmCommand(region, commandId, instanceId, description, timeoutSeconds, log);
  }

  async waitForWindowsBootstrap(
    context: ProviderGenericResourceContext,
    record: ResourceRecord,
    log: LogFn,
    options: ProviderWindowsBootstrapWaitOptions = {},
  ): Promise<void> {
    const instanceId = assertEc2InstanceId(record);
    const region = stringConfig(context.deployment.provider.region, "provider.region");
    const timeoutSeconds = options.timeoutSeconds ?? 1800;
    const documentName = resolveWindowsBootstrapDocumentName(context, record);

    log(`Waiting for AWS SSM bootstrap document ${documentName} on ${instanceId}`);
    await waitForSsmDocumentCommand(region, instanceId, documentName, timeoutSeconds, log);
  }

  async stageLocalArtifacts(
    context: ProviderGenericResourceContext,
    artifacts: ProviderLocalArtifactRequest[],
    log: LogFn,
  ): Promise<ProviderStagedLocalArtifactSet> {
    if (!artifacts.length) {
      return {
        artifacts: [],
        cleanup: async () => undefined,
      };
    }

    const region = stringConfig(context.deployment.provider.region, "provider.region");
    const bucket = temporaryArtifactBucketName(context);
    const prefix = `windows/${sanitizePathPart(context.resource.hostname)}/${Date.now().toString(36)}`;
    const staged: ProviderStagedLocalArtifact[] = [];
    const keys: string[] = [];
    let bucketCreated = false;

    try {
      log(`Creating temporary AWS artifact bucket ${bucket} for ${context.resource.hostname}`);
      await createS3Bucket(region, bucket, log);
      bucketCreated = true;
      await runCommand(
        "aws",
        [
          "s3api",
          "put-public-access-block",
          "--region",
          region,
          "--bucket",
          bucket,
          "--public-access-block-configuration",
          JSON.stringify({
            BlockPublicAcls: true,
            IgnorePublicAcls: true,
            BlockPublicPolicy: true,
            RestrictPublicBuckets: true,
          }),
        ],
        { log },
      );

      for (const artifact of artifacts) {
        const key = `${prefix}/${sanitizePathPart(artifact.id)}-${sanitizePathPart(
          artifact.fileName ?? path.basename(artifact.sourcePath),
        )}`;
        log(`Uploading local artifact ${artifact.id} to temporary S3 object s3://${bucket}/${key}`);
        await runCommand(
          "aws",
          [
            "s3",
            "cp",
            artifact.sourcePath,
            `s3://${bucket}/${key}`,
            "--region",
            region,
            "--only-show-errors",
          ],
          { log },
        );
        keys.push(key);

        const url = (await captureCommand(
          "aws",
          [
            "s3",
            "presign",
            `s3://${bucket}/${key}`,
            "--region",
            region,
            "--expires-in",
            "21600",
          ],
          { log },
        )).trim();
        staged.push({
          id: artifact.id,
          sourcePath: artifact.sourcePath,
          url,
        });
      }
    } catch (error) {
      if (bucketCreated) {
        await cleanupS3ArtifactBucket(region, bucket, keys, log).catch((cleanupError: unknown) => {
          log(`Failed to clean temporary AWS artifact bucket ${bucket}: ${errorMessage(cleanupError)}`);
        });
      }
      throw error;
    }

    return {
      artifacts: staged,
      cleanup: async (cleanupLog) => {
        await cleanupS3ArtifactBucket(region, bucket, keys, cleanupLog);
      },
    };
  }

  async openPortForward(
    context: ProviderGenericResourceContext,
    record: ResourceRecord,
    request: ProviderPortForwardRequest,
    log: LogFn,
  ): Promise<ProviderPortForward> {
    const instanceId = assertEc2InstanceId(record);
    const region = stringConfig(context.deployment.provider.region, "provider.region");
    const localHost = request.localHost ?? "127.0.0.1";

    log(
      `Starting AWS SSM port-forward for ${record.hostname} (${instanceId}): ` +
        `${localHost}:${request.localPort} -> instance port ${request.remotePort}`,
    );

    const child = spawn(
      "aws",
      [
        "ssm",
        "start-session",
        "--region",
        region,
        "--target",
        instanceId,
        "--document-name",
        "AWS-StartPortForwardingSession",
        "--parameters",
        JSON.stringify({
          portNumber: [String(request.remotePort)],
          localPortNumber: [String(request.localPort)],
        }),
      ],
      { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
    );

    // closed flips true on either an intentional close() or a self-exit; onExit
    // fires only for self-exit, so an intentional close() is silent (matches the
    // documented ProviderPortForward contract).
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
      const message = `aws ssm process error: ${error.message}`;
      log(message);
      notifyExit(message);
    });
    child.once("exit", (code, signal) => {
      const detail = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
      notifyExit(`aws ssm session ended (${detail})`);
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

const ec2BackedKinds = new Set(["panorama", "panw-vmseries", "ubuntu-server", "windows-endpoint"]);

function temporaryArtifactBucketName(context: ProviderGenericResourceContext): string {
  const projectName =
    typeof context.deployment.provider.projectName === "string" && context.deployment.provider.projectName
      ? context.deployment.provider.projectName
      : context.deployment.name;
  const base = sanitizeBucketPart(`${projectName}-${context.resource.hostname}`) || "artifact";
  const suffix = randomBytes(8).toString("hex");
  return `panw-broker-${base.slice(0, 32)}-${suffix}`;
}

async function createS3Bucket(region: string, bucket: string, log: LogFn): Promise<void> {
  const args = [
    "s3api",
    "create-bucket",
    "--bucket",
    bucket,
    "--region",
    region,
  ];
  if (region !== "us-east-1") {
    args.push(
      "--create-bucket-configuration",
      JSON.stringify({ LocationConstraint: region }),
    );
  }
  await runCommand("aws", args, { log });
}

async function cleanupS3ArtifactBucket(
  region: string,
  bucket: string,
  keys: string[],
  log: LogFn,
): Promise<void> {
  for (const key of [...keys].reverse()) {
    await runCommand(
      "aws",
      [
        "s3api",
        "delete-object",
        "--region",
        region,
        "--bucket",
        bucket,
        "--key",
        key,
      ],
      { log },
    );
  }

  log(`Deleting temporary AWS artifact bucket ${bucket}`);
  await runCommand(
    "aws",
    [
      "s3api",
      "delete-bucket",
      "--region",
      region,
      "--bucket",
      bucket,
    ],
    { log },
  );
}

function sanitizeBucketPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function sanitizePathPart(value: string): string {
  return value
    .replace(/[^A-Za-z0-9_.-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "artifact";
}

function isEc2BackedResource(record: Pick<ResourceRecord, "provider" | "kind" | "providerResourceId">): boolean {
  return Boolean(
    record.provider === "aws" &&
      record.kind &&
      ec2BackedKinds.has(record.kind) &&
      typeof record.providerResourceId === "string" &&
      record.providerResourceId.startsWith("i-"),
  );
}

function assertEc2InstanceId(
  record: Pick<ResourceRecord, "hostname" | "provider" | "kind" | "providerResourceId">,
): string {
  if (!isEc2BackedResource(record)) {
    throw new Error(
      `${record.hostname} is not an AWS EC2-backed resource with a recorded instance id`,
    );
  }
  return record.providerResourceId!;
}

async function getEc2PowerState(
  region: string,
  instanceId: string,
  log: LogFn,
): Promise<ResourcePowerState> {
  const raw = await captureCommand(
    "aws",
    [
      "ec2",
      "describe-instances",
      "--region",
      region,
      "--instance-ids",
      instanceId,
      "--query",
      "Reservations[0].Instances[0].State.Name",
      "--output",
      "text",
    ],
    { log },
  );
  return mapAwsPowerState(raw.trim());
}

async function waitForEc2State(
  region: string,
  instanceId: string,
  waiter: "instance-running" | "instance-stopped",
  log: LogFn,
): Promise<void> {
  await captureCommand(
    "aws",
    ["ec2", "wait", waiter, "--region", region, "--instance-ids", instanceId],
    { log },
  );
}

function mapAwsPowerState(value: string): ResourcePowerState {
  switch (value) {
    case "pending":
      return "pending";
    case "running":
      return "running";
    case "stopping":
    case "shutting-down":
      return "stopping";
    case "stopped":
      return "stopped";
    case "terminated":
      return "terminated";
    default:
      return "unknown";
  }
}

async function sendSsmPowerShellCommand(
  region: string,
  instanceId: string,
  commands: string[],
  description: string,
  timeoutSeconds: number,
  log: LogFn,
): Promise<string> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  const args = [
    "ssm",
    "send-command",
    "--region",
    region,
    "--instance-ids",
    instanceId,
    "--document-name",
    "AWS-RunPowerShellScript",
    "--comment",
    description,
    "--parameters",
    JSON.stringify({ commands }),
    "--timeout-seconds",
    String(timeoutSeconds),
    "--query",
    "Command.CommandId",
    "--output",
    "text",
  ];

  while (Date.now() < deadline) {
    try {
      return (await captureCommand("aws", args)).trim();
    } catch (error) {
      if (!isSsmInstanceNotReadyError(error)) {
        throw error;
      }
      log(`AWS SSM is not ready for ${instanceId}; waiting before retrying ${description}.`);
      await sleep(10_000);
    }
  }

  throw new Error(`Timed out waiting for AWS SSM to accept command on ${instanceId}: ${description}`);
}

async function waitForSsmCommand(
  region: string,
  commandId: string,
  instanceId: string,
  description: string,
  timeoutSeconds: number,
  log: LogFn,
): Promise<string> {
  const deadline = Date.now() + (timeoutSeconds + 60) * 1000;

  while (Date.now() < deadline) {
    let raw: string;
    try {
      raw = await captureCommand(
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
      );
    } catch (error) {
      if (String(error).includes("InvocationDoesNotExist")) {
        await sleep(5_000);
        continue;
      }
      throw error;
    }

    const invocation = JSON.parse(raw) as {
      Status?: string;
      StandardOutputContent?: string;
      StandardErrorContent?: string;
    };
    const status = invocation.Status ?? "Unknown";
    if (status === "Success") {
      log(`AWS SSM PowerShell command completed: ${description}`);
      logTail(invocation.StandardOutputContent, log);
      return invocation.StandardOutputContent ?? "";
    }
    if (["Cancelled", "Cancelling", "Failed", "TimedOut"].includes(status)) {
      logTail(invocation.StandardOutputContent, log);
      logTail(invocation.StandardErrorContent, log);
      throw new Error(`AWS SSM PowerShell command ${commandId} ended with status ${status}: ${description}`);
    }

    await sleep(10_000);
  }

  throw new Error(`Timed out waiting for AWS SSM PowerShell command ${commandId}: ${description}`);
}

async function waitForSsmDocumentCommand(
  region: string,
  instanceId: string,
  documentName: string,
  timeoutSeconds: number,
  log: LogFn,
): Promise<void> {
  const deadline = Date.now() + (timeoutSeconds + 120) * 1000;
  let loggedPending = false;

  while (Date.now() < deadline) {
    const raw = await captureCommand(
      "aws",
      [
        "ssm",
        "list-command-invocations",
        "--region",
        region,
        "--instance-id",
        instanceId,
        "--details",
      ],
    );
    const response = JSON.parse(raw) as {
      CommandInvocations?: SsmCommandInvocation[];
    };
    const invocation = latestDocumentInvocation(response.CommandInvocations ?? [], documentName);

    if (!invocation) {
      if (!loggedPending) {
        log(`Waiting for AWS SSM bootstrap document ${documentName} to start on ${instanceId}.`);
        loggedPending = true;
      }
      await sleep(10_000);
      continue;
    }

    const status = invocation.Status ?? "Unknown";
    if (status === "Success") {
      log(`AWS SSM bootstrap document completed: ${documentName}`);
      logTail(invocation.CommandPlugins?.map((plugin) => plugin.Output).filter(Boolean).join("\n"), log);
      return;
    }
    if (["Cancelled", "Cancelling", "Failed", "TimedOut"].includes(status)) {
      logTail(invocation.CommandPlugins?.map((plugin) => plugin.Output).filter(Boolean).join("\n"), log);
      throw new Error(`AWS SSM bootstrap document ${documentName} ended with status ${status}`);
    }

    await sleep(10_000);
  }

  throw new Error(`Timed out waiting for AWS SSM bootstrap document ${documentName} on ${instanceId}`);
}

interface SsmCommandInvocation {
  DocumentName?: string;
  RequestedDateTime?: string;
  Status?: string;
  CommandPlugins?: Array<{
    Output?: string;
  }>;
}

function latestDocumentInvocation(
  invocations: SsmCommandInvocation[],
  documentName: string,
): SsmCommandInvocation | undefined {
  const matches = invocations
    .filter((invocation) => invocation.DocumentName === documentName)
    .sort((left, right) => Date.parse(right.RequestedDateTime ?? "") - Date.parse(left.RequestedDateTime ?? ""));
  return matches[0];
}

function resolveWindowsBootstrapDocumentName(
  context: ProviderGenericResourceContext,
  record: ResourceRecord,
): string {
  const fromOutputs = getOutputString(record.outputs, ["endpoint", "ssm_document"]);
  if (fromOutputs) return fromOutputs;

  const projectName =
    typeof context.deployment.provider.projectName === "string" && context.deployment.provider.projectName
      ? context.deployment.provider.projectName
      : context.deployment.name;
  return sanitizeSsmDocumentName(`${projectName}-${context.resource.hostname}-koi-bootstrap`);
}

function getOutputString(outputs: Record<string, unknown> | null | undefined, pathParts: string[]): string | null {
  let current: unknown = outputs;
  for (const pathPart of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[pathPart];
  }
  return typeof current === "string" && current ? current : null;
}

function sanitizeSsmDocumentName(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, "-");
}

function logTail(output: string | undefined, log: LogFn): void {
  const lines = (output ?? "").split(/\r?\n/).filter(Boolean).slice(-20);
  for (const line of lines) log(line);
}

function stringConfig(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`AWS ${name} is required`);
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isSsmInstanceNotReadyError(error: unknown): boolean {
  const message = errorMessage(error);
  return (
    message.includes("InvalidInstanceId") ||
    message.includes("TargetNotConnected") ||
    message.includes("not in a valid state") ||
    message.includes("not managed")
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
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
