import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BootstrapResult, PanwVmseriesConfig } from "../../../types/index.js";
import type { LogFn } from "../../../types/logging.js";
import { ensureDir, optionalEnv, requireEnv, runCommand } from "../../../utils/index.js";
import { workDir } from "../../../utils/paths.js";

export function resolveAuthCode(config: Pick<PanwVmseriesConfig, "license">): string {
  if (config.license.authCode) return config.license.authCode;
  if (config.license.authCodeEnv) return requireEnv(config.license.authCodeEnv);
  throw new Error("No auth code configured");
}

export async function buildBootstrapIso(
  config: PanwVmseriesConfig,
  authCode: string,
  log: LogFn,
): Promise<BootstrapResult> {
  const vmWorkDir = path.join(workDir, config.hostname, "bootstrap");
  const rootDir = path.join(vmWorkDir, "root");
  const isoPath = path.join(vmWorkDir, `${config.hostname}-bootstrap.iso`);
  const initCfgPath = path.join(rootDir, "config", "init-cfg.txt");

  await rm(vmWorkDir, { recursive: true, force: true });
  await ensureDir(path.join(rootDir, "config"));
  await ensureDir(path.join(rootDir, "license"));
  await ensureDir(path.join(rootDir, "content"));
  await ensureDir(path.join(rootDir, "software"));
  await ensureDir(path.join(rootDir, "plugins"));

  await writeFile(initCfgPath, renderInitCfg(config));
  await writeFile(path.join(rootDir, "license", "authcodes"), `${authCode.trim()}\n`);

  log(`Rendered bootstrap package at ${rootDir}`);
  await makeIso(rootDir, isoPath, log);
  log(`Built bootstrap ISO at ${isoPath}`);

  return {
    bootstrapDir: rootDir,
    isoPath,
    initCfgPath,
  };
}

export function renderInitCfg(config: PanwVmseriesConfig): string {
  const lines: string[] = [];
  lines.push(`type=${config.management.type}`);

  if (config.management.type === "static") {
    lines.push(`ip-address=${config.management.ipAddress}`);
    lines.push(`netmask=${config.management.netmask}`);
    lines.push(`default-gateway=${config.management.defaultGateway}`);
  }

  lines.push(`hostname=${config.hostname}`);
  if (config.management.dnsPrimary) lines.push(`dns-primary=${config.management.dnsPrimary}`);
  if (config.management.dnsSecondary) lines.push(`dns-secondary=${config.management.dnsSecondary}`);

  if (config.managementServer.mode === "none") {
    // No Panorama/SCM bootstrap for local-only bring-up and licensing tests.
  } else if (config.managementServer.mode === "scm") {
    lines.push("panorama-server=cloud");
  } else {
    lines.push(`panorama-server=${resolvedBootstrapString(config.managementServer.panoramaServer, "panoramaServer")}`);
    if (config.managementServer.panoramaServer2) {
      lines.push(`panorama-server-2=${resolvedBootstrapString(config.managementServer.panoramaServer2, "panoramaServer2")}`);
    }
    const vmAuthKey = resolveOptionalSecret(
      resolvedBootstrapString(config.managementServer.vmAuthKey, "vmAuthKey", true),
      config.managementServer.vmAuthKeyEnv,
    );
    if (vmAuthKey) {
      lines.push(`vm-auth-key=${vmAuthKey}`);
    }
    if (config.managementServer.templateStack) {
      lines.push(`tplname=${config.managementServer.templateStack}`);
    }
    if (config.managementServer.deviceGroup) {
      lines.push(`dgname=${config.managementServer.deviceGroup}`);
    }
  }

  const pinId = resolveOptionalSecret(
    config.deviceCertificate?.pinId,
    config.deviceCertificate?.pinIdEnv,
  );
  const pinValue = resolveOptionalSecret(
    config.deviceCertificate?.pinValue,
    config.deviceCertificate?.pinValueEnv,
  );
  if (pinId && pinValue) {
    lines.push(`vm-series-auto-registration-pin-id=${pinId}`);
    lines.push(`vm-series-auto-registration-pin-value=${pinValue}`);
  }

  if (config.pluginCommands?.length) {
    lines.push(`plugin-op-commands=${config.pluginCommands.join(",")}`);
  }

  return `${lines.join("\n")}\n`;
}

function resolvedBootstrapString(
  value: unknown,
  fieldName: string,
  optional = false,
): string | null {
  if (value === undefined || value === null || value === "") {
    if (optional) return null;
    throw new Error(`Cannot render bootstrap field ${fieldName}: value is empty`);
  }
  if (typeof value === "string") return value;
  throw new Error(
    `Cannot render bootstrap field ${fieldName}: resource references must be resolved before bootstrap ISO rendering`,
  );
}

function resolveOptionalSecret(value?: string | null, envName?: string | null): string | null {
  if (value) return value;
  if (envName) return optionalEnv(envName) ?? null;
  return null;
}

async function makeIso(sourceDir: string, isoPath: string, log: LogFn): Promise<void> {
  if (process.platform === "darwin") {
    await runCommand("hdiutil", ["makehybrid", "-iso", "-joliet", "-o", isoPath, sourceDir], { log });
    return;
  }

  try {
    await runCommand(
      "xorriso",
      ["-as", "mkisofs", "-J", "-R", "-o", isoPath, sourceDir],
      { log },
    );
  } catch {
    await runCommand("mkisofs", ["-J", "-R", "-o", isoPath, sourceDir], { log });
  }
}
