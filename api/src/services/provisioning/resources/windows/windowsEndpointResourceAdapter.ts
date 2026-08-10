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
import { optionalEnv } from "../../utils/index.js";
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
      const provisionedRecord = {
        ...record,
        ...result.resourcePatch,
      };
      if (bootstrapMethod(stagedContext.resource) === "qemu-agent") {
        await this.bootstrapViaQemuAgent(stagedContext, provisionedRecord, log);
      }
      // Always wait for the Windows bootstrap to truly finish before reporting ready.
      // The SSM bootstrap renames the host, reboots, then resumes to install apps and run
      // Koi under the corrected hostname; the success marker is the only reliable end signal.
      await this.waitForBootstrapCompletion(
        stagedContext,
        provisionedRecord,
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

  private async bootstrapViaQemuAgent(
    context: ResourceAdapterContext<ResourceConfig>,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<void> {
    if (!record.providerResourceId) {
      throw new Error(`Cannot bootstrap ${record.hostname}: no provider resource id is recorded`);
    }
    if (!context.provider.capturePowerShellCommand || !context.provider.runPowerShellCommand) {
      throw new Error(
        `Provider ${context.provider.type} cannot run the qemu-agent Windows bootstrap for ${record.hostname}`,
      );
    }
    if (applicationList((context.resource as WindowsEndpointResource).applications).length || hasKoiConfig(context.resource)) {
      throw new Error(
        `qemu-agent bootstrap for ${record.hostname} currently supports the base Windows endpoint only; ` +
          `application profiles and Koi require a provider artifact transport`,
      );
    }

    const settings = qemuAgentBootstrapSettings(context.resource);
    const password = resolveWindowsAdminPassword(context.resource);
    if (password) {
      if (!context.provider.setWindowsUserPassword) {
        throw new Error(
          `Provider ${context.provider.type} cannot set the Windows credential for ${record.hostname} ` +
            `through a write-only guest channel`,
        );
      }
      await context.provider.setWindowsUserPassword(
        context,
        record,
        settings.adminUsername,
        password,
        `apply broker-managed credential for ${settings.adminUsername}`,
        log,
      );
    }

    const timeoutSeconds = bootstrapTimeoutSeconds(context.resource);
    const output = await context.provider.capturePowerShellCommand(
      context,
      record,
      qemuAgentBootstrapCommands(settings),
      `configure base Windows guest services and hostname ${settings.computerName}`,
      log,
      { timeoutSeconds: Math.min(timeoutSeconds, 900) },
    );

    if (/RESTART_SCHEDULED/i.test(output)) {
      log(`Windows endpoint ${record.hostname} scheduled a restart to apply hostname ${settings.computerName}.`);
      await waitForQemuAgentHostname(context, record, settings.computerName, timeoutSeconds, log);
    }

    await context.provider.runPowerShellCommand(
      context,
      record,
      qemuAgentFinalizeCommands(),
      `write Windows bootstrap success marker for ${record.hostname}`,
      log,
      { timeoutSeconds: 120 },
    );
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
    if (!["ssm", "qemu-agent"].includes(bootstrapMethod(context.resource))) {
      log(`Skipping Windows bootstrap wait for ${record.hostname}: bootstrap method has no broker-observed marker.`);
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
          log(
            hasKoiConfig(context.resource)
              ? `Windows bootstrap completed on ${record.hostname}; Koi registered under hostname ${status.hostname}.`
              : `Windows bootstrap completed on ${record.hostname} under hostname ${status.hostname}.`,
          );
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
    if (!hasKoiConfig(context.resource)) {
      log(`Skipping Koi rollback for ${record.hostname}: no Koi configuration is present.`);
      return;
    }
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

function hasKoiConfig(resource: ResourceConfig): boolean {
  const koi = (resource as { koi?: unknown }).koi;
  return Boolean(koi && typeof koi === "object" && !Array.isArray(koi));
}

interface QemuAgentBootstrapSettings {
  adminUsername: string;
  computerName: string;
  enableRdp: boolean;
  enableSsh: boolean;
}

function qemuAgentBootstrapSettings(resource: ResourceConfig): QemuAgentBootstrapSettings {
  const bootstrap = (resource as { bootstrap?: unknown }).bootstrap;
  const values = bootstrap && typeof bootstrap === "object" && !Array.isArray(bootstrap)
    ? bootstrap as Record<string, unknown>
    : {};
  const adminUsername = stringSetting(values.adminUsername) ?? "Administrator";
  const computerName = stringSetting(values.computerName) ?? hostnameOf(resource);
  if (!computerName) throw new Error(`A Windows computer name is required for ${resource.hostname}`);
  if (computerName.length > 15) {
    throw new Error(`Windows computer name ${computerName} exceeds the 15-character NetBIOS limit`);
  }
  return {
    adminUsername,
    computerName,
    enableRdp: values.enableRdp === true,
    enableSsh: values.enableSsh === true,
  };
}

function resolveWindowsAdminPassword(resource: ResourceConfig): string | null {
  const bootstrap = (resource as { bootstrap?: unknown }).bootstrap;
  if (!bootstrap || typeof bootstrap !== "object" || Array.isArray(bootstrap)) return null;
  const values = bootstrap as Record<string, unknown>;
  const direct = stringSetting(values.adminPassword);
  if (direct) return direct;
  const envName = stringSetting(values.adminPasswordEnv);
  if (!envName) return null;
  const value = optionalEnv(envName);
  if (!value) throw new Error(`Missing required Windows credential secret ${envName}`);
  return value;
}

function qemuAgentBootstrapCommands(settings: QemuAgentBootstrapSettings): string[] {
  const computerName = powershellLiteral(settings.computerName);
  const commands = [
    "$ErrorActionPreference = 'Stop'",
    "$Root = 'C:\\ProgramData\\panw-broker'",
    "New-Item -ItemType Directory -Path $Root -Force | Out-Null",
    "Remove-Item (Join-Path $Root 'koi.success'), (Join-Path $Root 'koi.failed') -Force -ErrorAction SilentlyContinue",
    `if (-not (Get-LocalUser -Name ${powershellLiteral(settings.adminUsername)} -ErrorAction SilentlyContinue)) { throw 'Configured local Windows user does not exist' }`,
    "Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object IPv4Connectivity -ne 'Disconnected' | Set-NetConnectionProfile -NetworkCategory Private -ErrorAction SilentlyContinue",
  ];

  if (settings.enableSsh) {
    commands.push(
      "$SshCapability = Get-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0'",
      "if ($SshCapability.State -ne 'Installed') { Add-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0' | Out-Null }",
      "Set-Service -Name sshd -StartupType Automatic",
      "Start-Service -Name sshd",
      "if (-not (Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue)) { New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null } else { Enable-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' }",
    );
  }
  if (settings.enableRdp) {
    commands.push(
      "$RdpRules = Get-NetFirewallRule -DisplayGroup 'Remote Desktop' -ErrorAction SilentlyContinue",
      "if (-not $RdpRules) { throw 'This Windows edition does not expose the inbound Remote Desktop firewall rules' }",
      "Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server' -Name fDenyTSConnections -Value 0",
      "$RdpRules | Enable-NetFirewallRule",
    );
  }

  commands.push(
    `$TargetComputerName = ${computerName}`,
    "if ($env:COMPUTERNAME -ine $TargetComputerName) {",
    "  Rename-Computer -NewName $TargetComputerName -Force",
    "  Set-Content -Path (Join-Path $Root 'rename-pending') -Value (Get-Date).ToString('o')",
    "  Start-Process shutdown.exe -ArgumentList '/r','/t','5','/f' -WindowStyle Hidden",
    "  Write-Output 'RESTART_SCHEDULED'",
    "} else { Write-Output 'RESTART_NOT_REQUIRED' }",
  );
  return commands;
}

function qemuAgentFinalizeCommands(): string[] {
  return [
    "$ErrorActionPreference = 'Stop'",
    "$Root = 'C:\\ProgramData\\panw-broker'",
    "New-Item -ItemType Directory -Path $Root -Force | Out-Null",
    "Remove-Item (Join-Path $Root 'rename-pending'), (Join-Path $Root 'koi.failed') -Force -ErrorAction SilentlyContinue",
    "Set-Content -Path (Join-Path $Root 'koi.success') -Value \"Windows endpoint bootstrap completed at $(Get-Date -Format o).\"",
  ];
}

async function waitForQemuAgentHostname(
  context: ResourceAdapterContext<ResourceConfig>,
  record: ResourceRecord,
  expectedHostname: string,
  timeoutSeconds: number,
  log: LogFn,
): Promise<void> {
  if (!context.provider.capturePowerShellCommand) return;
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    try {
      const output = await context.provider.capturePowerShellCommand(
        context,
        record,
        ["Write-Output ([System.Net.Dns]::GetHostName())"],
        `wait for Windows hostname ${expectedHostname}`,
        () => undefined,
        { timeoutSeconds: 30 },
      );
      if (hostnameOk(output.trim(), expectedHostname)) return;
    } catch (error) {
      log(`QEMU guest agent is not ready after the Windows restart: ${errorMessage(error)}`);
    }
    await sleep(5_000);
  }
  throw new Error(`Timed out waiting for ${record.hostname} to restart as ${expectedHostname}`);
}

function powershellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function stringSetting(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
  const bootstrap = (resource as { bootstrap?: unknown }).bootstrap;
  if (bootstrap && typeof bootstrap === "object" && !Array.isArray(bootstrap)) {
    const computerName = (bootstrap as { computerName?: unknown }).computerName;
    if (typeof computerName === "string" && computerName) return computerName;
  }
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
