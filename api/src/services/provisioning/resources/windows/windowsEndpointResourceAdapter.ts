import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type {
  DeploymentConfig,
  ResourceConfig,
  ResourceRecord,
  WindowsApplicationConfig,
  WindowsEndpointResource,
} from "../../types/index.js";
import type { LogFn } from "../../types/logging.js";
import type { ProviderStagedLocalArtifactSet } from "../../types/providerAdapter.js";
import type { ResourceAdapter, ResourceAdapterContext, ResourceUpResult } from "../types.js";
import { GenericTerraformResourceAdapter } from "../genericTerraformResourceAdapter.js";
import { expandWindowsAppProfiles } from "./appProfiles.js";

export class WindowsEndpointResourceAdapter implements ResourceAdapter<ResourceConfig> {
  readonly kind = "windows-endpoint";

  constructor(
    private readonly terraformResource = new GenericTerraformResourceAdapter<ResourceConfig>(),
  ) {}

  async prepareDeployment(
    deployment: DeploymentConfig,
    configLoader: ResourceAdapterContext["configLoader"],
    configRef: string,
    params?: Record<string, unknown>,
  ): Promise<DeploymentConfig> {
    const withAppProfiles = await expandWindowsAppProfiles(deployment, configLoader, configRef, params);
    return await this.inlineKoiScripts(withAppProfiles, configLoader, configRef);
  }

  async up(
    context: ResourceAdapterContext<ResourceConfig>,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<ResourceUpResult> {
    const { context: stagedContext, stagedArtifacts } = await this.stageLocalApplicationArtifacts(
      context,
      log,
    );

    try {
      const result = await this.terraformResource.up(stagedContext, record, log);
      // Always wait for the Windows bootstrap to truly finish before reporting ready.
      // The SSM bootstrap renames the host, reboots, then resumes to install apps and run
      // Koi under the corrected hostname; the success marker is the only reliable end signal.
      await this.waitForBootstrapCompletion(
        stagedContext,
        {
          ...record,
          ...result.resourcePatch,
        },
        log,
      );
      return result;
    } finally {
      if (stagedArtifacts) {
        await stagedArtifacts.cleanup(log).catch((error: unknown) => {
          log(`Failed to clean temporary application artifacts for ${context.resource.hostname}: ${errorMessage(error)}`);
        });
      }
    }
  }

  async down(
    context: ResourceAdapterContext<ResourceConfig>,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<void> {
    await this.rollbackKoi(context, record, log);
    await this.terraformResource.down(context, record, log);
  }

  private async inlineKoiScripts(
    deployment: DeploymentConfig,
    configLoader: ResourceAdapterContext["configLoader"],
    configRef: string,
  ): Promise<DeploymentConfig> {
    const resources = await Promise.all(
      deployment.resources.map(async (resource) => {
        if (resource.kind !== this.kind) return resource;
        const koi = (resource as { koi?: unknown }).koi;
        if (!koi || typeof koi !== "object" || Array.isArray(koi)) return resource;

        const scriptPath = (koi as { scriptPath?: unknown }).scriptPath;
        if (scriptPath === undefined || scriptPath === null || scriptPath === "") return resource;
        if (typeof scriptPath !== "string") {
          throw new Error(`Invalid config ${configRef}: ${resource.hostname}.koi.scriptPath must be a string`);
        }

        const scriptBytes = await readFile(configLoader.resolveProjectPath(scriptPath));
        const scriptSha256 =
          typeof (koi as { scriptSha256?: unknown }).scriptSha256 === "string" &&
          (koi as { scriptSha256?: string }).scriptSha256
            ? (koi as { scriptSha256: string }).scriptSha256
            : createHash("sha256").update(scriptBytes).digest("hex");

        return {
          ...resource,
          koi: {
            ...koi,
            scriptInline: scriptBytes.toString("utf8"),
            scriptSha256,
          },
        };
      }),
    );

    return {
      ...deployment,
      resources,
    };
  }

  private async stageLocalApplicationArtifacts(
    context: ResourceAdapterContext<ResourceConfig>,
    log: LogFn,
  ): Promise<{
    context: ResourceAdapterContext<ResourceConfig>;
    stagedArtifacts?: ProviderStagedLocalArtifactSet;
  }> {
    const resource = context.resource as WindowsEndpointResource;
    const applications = applicationList(resource.applications);
    const localApps = applications.filter(hasSourcePath);
    if (!localApps.length) return { context };

    if (!context.provider.stageLocalArtifacts) {
      throw new Error(
        `Provider ${context.provider.type} cannot stage local Windows application artifacts for ${resource.hostname}`,
      );
    }

    const artifactRequests = await Promise.all(
      localApps.map(async (app) => {
        const sourcePath = context.configLoader.resolveProjectPath(app.sourcePath);
        const sourceStats = await stat(sourcePath);
        if (!sourceStats.isFile()) {
          throw new Error(`Windows application ${app.id} sourcePath ${app.sourcePath} is not a file`);
        }
        return {
          id: app.id,
          sourcePath,
          fileName: path.basename(sourcePath),
        };
      }),
    );

    const stagedArtifacts = await context.provider.stageLocalArtifacts(
      context,
      artifactRequests,
      log,
    );
    const urlsById = new Map(stagedArtifacts.artifacts.map((artifact) => [artifact.id, artifact.url]));
    const stagedApplications = applications.map((app) => {
      const url = urlsById.get(app.id);
      if (!url) return app;
      const { sourcePath: _sourcePath, ...withoutSourcePath } = app;
      return {
        ...withoutSourcePath,
        url,
      };
    });
    const stagedResource: ResourceConfig = {
      ...resource,
      applications: stagedApplications,
    };
    const stagedDeployment: DeploymentConfig = {
      ...context.deployment,
      resources: context.deployment.resources.map((candidate) =>
        candidate.kind === resource.kind && candidate.hostname === resource.hostname
          ? stagedResource
          : candidate,
      ),
    };

    return {
      context: {
        ...context,
        deployment: stagedDeployment,
        resource: stagedResource,
      },
      stagedArtifacts,
    };
  }

  private async waitForBootstrapCompletion(
    context: ResourceAdapterContext<ResourceConfig>,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<void> {
    if (bootstrapMethod(context.resource) !== "ssm") {
      log(`Skipping Windows bootstrap wait for ${record.hostname}: bootstrap method is not ssm.`);
      return;
    }
    if (!record.providerResourceId) {
      throw new Error(
        `Cannot wait for Windows bootstrap on ${record.hostname}: no provider resource id is recorded`,
      );
    }
    if (!context.provider.capturePowerShellCommand) {
      throw new Error(
        `Provider ${context.provider.type} cannot inspect Windows bootstrap markers on ${record.hostname}`,
      );
    }

    const timeoutSeconds = bootstrapTimeoutSeconds(context.resource);
    const expectedHostname = hostnameOf(context.resource);
    const deadline = Date.now() + timeoutSeconds * 1000;
    log(
      `Waiting up to ${timeoutSeconds}s for the Windows bootstrap markers on ${record.hostname} ` +
        `(rename to ${expectedHostname || "<unchanged>"} -> reboot -> apps + Koi).`,
    );

    let pollIntervalMs = 20_000;
    while (Date.now() < deadline) {
      let status: BootstrapMarkerStatus | null = null;
      try {
        const output = await context.provider.capturePowerShellCommand(
          context,
          record,
          bootstrapMarkerProbeCommands(),
          `inspect Windows bootstrap markers on ${record.hostname}`,
          () => undefined,
          { timeoutSeconds: 120 },
        );
        status = parseBootstrapMarkerStatus(output);
      } catch (error) {
        // The host reboots after the rename; SSM commands issued during that window fail
        // transiently. Treat probe failures as "still booting" and keep polling.
        log(`Bootstrap marker probe for ${record.hostname} not ready yet: ${errorMessage(error)}`);
      }

      if (status) {
        if (status.success && hostnameOk(status.hostname, expectedHostname)) {
          log(`Windows bootstrap completed on ${record.hostname}; Koi registered under hostname ${status.hostname}.`);
          return;
        }
        if (status.success && !hostnameOk(status.hostname, expectedHostname)) {
          throw new Error(
            `Windows bootstrap on ${record.hostname} reported success but the host name is ${status.hostname}, ` +
              `expected ${expectedHostname}. Koi may have registered under the wrong hostname.`,
          );
        }
        if (status.failed && !status.renamePending) {
          throw new Error(
            `Windows bootstrap failed on ${record.hostname}: ${status.failureMessage || "see C:\\ProgramData\\panw-broker\\bootstrap.log"}`,
          );
        }
        if (status.renamePending) {
          log(`Windows endpoint ${record.hostname} is renaming and rebooting before Koi; continuing to wait.`);
        } else if (!status.success) {
          log(`Windows bootstrap on ${record.hostname} still in progress (hostname=${status.hostname}); continuing to wait.`);
        }
      }

      await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
      pollIntervalMs = Math.min(pollIntervalMs + 5_000, 30_000);
    }

    throw new Error(
      `Timed out after ${timeoutSeconds}s waiting for the Windows bootstrap success marker on ${record.hostname}.`,
    );
  }

  private async rollbackKoi(
    context: ResourceAdapterContext<ResourceConfig>,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<void> {
    if (!record.providerResourceId) {
      log(`Skipping Koi rollback for ${record.hostname}: no provider resource id is recorded.`);
      return;
    }
    if (!context.provider.runPowerShellCommand) {
      throw new Error(
        `Provider ${context.provider.type} cannot run PowerShell rollback commands for ${record.hostname}`,
      );
    }

    // Koi rollback unregisters the endpoint from the Koi backend. It depends on Koi's API,
    // which can return transient upstream connection errors. Retry the whole SSM command a
    // couple of times; if it still fails, do not let best-effort Koi cleanup block the AWS
    // teardown (otherwise a flaky Koi backend permanently strands the stack). Set
    // resource.koi.requireRollbackOnDestroy: true to make a failed rollback fatal instead.
    const attempts = 3;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await context.provider.runPowerShellCommand(
          context,
          record,
          koiRollbackCommands(),
          `rollback Koi before destroying ${record.hostname} (attempt ${attempt}/${attempts})`,
          log,
        );
        return;
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
}

function requireRollbackOnDestroy(resource: ResourceConfig): boolean {
  const koi = (resource as { koi?: unknown }).koi;
  if (!koi || typeof koi !== "object" || Array.isArray(koi)) return false;
  return (koi as { requireRollbackOnDestroy?: unknown }).requireRollbackOnDestroy === true;
}

function koiRollbackCommands(): string[] {
  return [
    "$ErrorActionPreference = \"Stop\"",
    "$Root = \"C:\\ProgramData\\panw-broker\"",
    "$KoiScriptPath = Join-Path $Root \"koi.py\"",
    "$RollbackLog = Join-Path $Root \"koi-rollback.log\"",
    "if (-not (Test-Path $KoiScriptPath)) { Write-Host \"Koi script not found at $KoiScriptPath; skipping rollback.\"; exit 0 }",
    "$PythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue",
    "$PythonPath = $null",
    "if ($PythonCommand -and $PythonCommand.Source -notlike \"*\\WindowsApps\\python.exe\") { $PythonPath = $PythonCommand.Source }",
    "if (-not $PythonPath) { foreach ($Candidate in @(\"C:\\Program Files\\Python314\\python.exe\", \"C:\\Program Files\\Python313\\python.exe\", \"C:\\Program Files\\Python312\\python.exe\", \"C:\\Program Files\\Python311\\python.exe\", \"C:\\Python314\\python.exe\", \"C:\\Python313\\python.exe\", \"C:\\Python312\\python.exe\", \"C:\\Python311\\python.exe\")) { if (Test-Path $Candidate) { $PythonPath = $Candidate; break } } }",
    "if (-not $PythonPath) { throw \"python.exe was not found for Koi rollback\" }",
    "Write-Host \"Running Koi rollback with $PythonPath\"",
    // Koi's rollback fetches a signed script from its API and can hit transient upstream
    // connection resets. Retry a few times with backoff before giving up so a flaky Koi
    // backend does not fail an otherwise-clean teardown.
    "$ExitCode = 1",
    "for ($Attempt = 1; $Attempt -le 3; $Attempt++) {",
    "  Write-Host \"Koi rollback attempt $Attempt of 3\"",
    "  & $PythonPath $KoiScriptPath --rollback *> $RollbackLog",
    "  $ExitCode = $LASTEXITCODE",
    "  if ($ExitCode -eq 0) { break }",
    "  Write-Host \"Koi rollback attempt $Attempt failed with exit code $ExitCode.\"",
    "  if ($Attempt -lt 3) { Start-Sleep -Seconds (10 * $Attempt) }",
    "}",
    "if (Test-Path $RollbackLog) { Get-Content -Path $RollbackLog -Tail 120 }",
    "if ($ExitCode -ne 0) { throw \"Koi rollback exited with code $ExitCode after 3 attempts. See $RollbackLog\" }",
    "Write-Host \"Koi rollback completed successfully. Log: $RollbackLog\"",
  ];
}

function bootstrapTimeoutSeconds(resource: ResourceConfig): number {
  const value = (resource.placement as { bootstrapTimeoutSeconds?: unknown } | undefined)?.bootstrapTimeoutSeconds;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.ceil(value);
  return 1800;
}

function bootstrapMethod(resource: ResourceConfig): string {
  const value = (resource.placement as { bootstrapMethod?: unknown } | undefined)?.bootstrapMethod;
  return typeof value === "string" && value ? value : "ssm";
}

function hostnameOf(resource: ResourceConfig): string {
  const value = (resource as { hostname?: unknown }).hostname;
  return typeof value === "string" ? value : "";
}

interface BootstrapMarkerStatus {
  hostname: string;
  success: boolean;
  failed: boolean;
  renamePending: boolean;
  failureMessage: string;
}

function bootstrapMarkerProbeCommands(): string[] {
  // Read-only inspection of the bootstrap markers and the current hostname. Emits parseable
  // key=value lines plus the bootstrap failure message (if any) so the adapter can decide
  // whether the bootstrap is done, still rebooting for the rename, or genuinely failed.
  return [
    "$ErrorActionPreference = \"SilentlyContinue\"",
    "$Root = \"C:\\ProgramData\\panw-broker\"",
    "Write-Output \"HOSTNAME=$([System.Net.Dns]::GetHostName())\"",
    "Write-Output \"SUCCESS=$([bool](Test-Path (Join-Path $Root 'koi.success')))\"",
    "Write-Output \"FAILED=$([bool](Test-Path (Join-Path $Root 'koi.failed')))\"",
    "Write-Output \"RENAME_PENDING=$([bool](Test-Path (Join-Path $Root 'rename-pending')))\"",
    "if (Test-Path (Join-Path $Root 'koi.failed')) { Write-Output \"FAILMSG_BEGIN\"; Get-Content (Join-Path $Root 'koi.failed') -Raw; Write-Output \"FAILMSG_END\" }",
  ];
}

function parseBootstrapMarkerStatus(output: string): BootstrapMarkerStatus | null {
  if (!output || !/HOSTNAME=/.test(output)) return null;
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
    hostname: get("HOSTNAME"),
    success: isTrue(get("SUCCESS")),
    failed: isTrue(get("FAILED")),
    renamePending: isTrue(get("RENAME_PENDING")),
    failureMessage,
  };
}

function hostnameOk(actual: string, expected: string): boolean {
  if (!expected) return true;
  return actual.toLowerCase() === expected.toLowerCase();
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function applicationList(value: unknown): WindowsApplicationConfig[] {
  return Array.isArray(value) ? value as WindowsApplicationConfig[] : [];
}

function hasSourcePath(app: WindowsApplicationConfig): app is WindowsApplicationConfig & { sourcePath: string } {
  return typeof app.sourcePath === "string" && app.sourcePath.length > 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
