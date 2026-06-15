import type {
  PanwVmseriesConfig,
  ResourceValueReference,
} from "../../../types/index.js";

export function validatePanwVmseriesCommon(
  config: Pick<PanwVmseriesConfig, "hostname" | "license" | "management" | "managementServer">,
  prefix: string,
): void {
  if (!config.hostname) throw new Error(`${prefix} hostname is required`);
  if (!config.license?.authCode && !config.license?.authCodeEnv) {
    throw new Error(`${prefix} license.authCode or license.authCodeEnv is required`);
  }
  if (!config.management?.type) {
    throw new Error(`${prefix} management.type is required`);
  }
  if (config.management.type === "static") {
    for (const key of ["ipAddress", "netmask", "defaultGateway"] as const) {
      if (!config.management[key]) throw new Error(`${prefix} management.${key} is required`);
    }
  }
  if (!config.managementServer?.mode) {
    throw new Error(`${prefix} managementServer.mode is required`);
  }
  if (!["panorama", "scm", "none"].includes(config.managementServer.mode)) {
    throw new Error(`${prefix} managementServer.mode must be panorama, scm, or none`);
  }
  if (config.managementServer.mode === "panorama") {
    if (!config.managementServer.panoramaServer) {
      throw new Error(`${prefix} managementServer.panoramaServer is required for panorama mode`);
    }
    if (
      !isReferenceValue(config.managementServer.panoramaServer) &&
      typeof config.managementServer.panoramaServer === "string" &&
      isPlaceholder(config.managementServer.panoramaServer)
    ) {
      throw new Error(`${prefix} managementServer.panoramaServer still has a placeholder value`);
    }
    if (!config.managementServer.vmAuthKey && !config.managementServer.vmAuthKeyEnv) {
      throw new Error(
        `${prefix} managementServer.vmAuthKey or vmAuthKeyEnv is required for panorama mode`,
      );
    }
    for (const key of ["vmAuthKey"] as const) {
      if (!config.managementServer[key]) {
        continue;
      }
      if (
        !isReferenceValue(config.managementServer[key]) &&
        typeof config.managementServer[key] === "string" &&
        isPlaceholder(config.managementServer[key])
      ) {
        throw new Error(`${prefix} managementServer.${key} still has a placeholder value`);
      }
    }
    if (
      config.managementServer.vmAuthKey &&
      typeof config.managementServer.vmAuthKey === "string"
    ) {
      validateBootstrapVmAuthKey(config.managementServer.vmAuthKey, prefix);
    }
    if (
      config.managementServer.templateStack &&
      isPlaceholder(config.managementServer.templateStack)
    ) {
      throw new Error(`${prefix} managementServer.templateStack still has a placeholder value`);
    }
    if (config.managementServer.deviceGroup && isPlaceholder(config.managementServer.deviceGroup)) {
      throw new Error(`${prefix} managementServer.deviceGroup still has a placeholder value`);
    }
  }
}

// NOTE: Panorama disk-size validation was removed here. The previous
// validatePanoramaCommon/validatePanoramaDiskPlacement pair was unreferenced
// dead code, and its rootVolumeGb >= 224 GiB threshold contradicted the working
// AWS GP-lab deployment, which boots Panorama on the AWS-default 81 GiB system
// disk (verified live). Keeping a contradictory, unused guard was a landmine, so
// it is gone. If Panorama disk validation is reintroduced, the AWS root-disk
// floor is 81 GiB (the AWS Panorama image default), not 224 GiB.

function validateBootstrapVmAuthKey(value: string | number, prefix: string): void {
  const trimmed = String(value).trim();
  if (trimmed.startsWith("2:")) {
    throw new Error(
      `${prefix} managementServer.vmAuthKey looks like a Panorama Device Registration Auth Key. ` +
        "For VM-Series bootstrap, generate a VM auth key on Panorama with " +
        "`request bootstrap vm-auth-key generate lifetime <1-8760>` and use that numeric key.",
    );
  }
  if (trimmed.startsWith("_AQ")) {
    throw new Error(
      `${prefix} managementServer.vmAuthKey looks like a Panorama Software Firewall License Plugin auth-key. ` +
        "This broker currently renders vm-auth-key=, so use the numeric bootstrap VM auth key instead.",
    );
  }
}

function isPlaceholder(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized === "change_me" ||
    normalized.includes("example.local") ||
    normalized.includes("example.com")
  );
}

function isReferenceValue(value: unknown): value is ResourceValueReference {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (value as { fromResource?: unknown }).fromResource === "string",
  );
}
