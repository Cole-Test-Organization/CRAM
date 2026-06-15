import type {
  DeploymentConfig,
  PanoramaConfigAddOnConfig,
  PanwVmseriesResourceConfig,
  PanwVmseriesConfigProfileConfig,
  ResourceConfig,
  ResourceConfigLoader,
} from "../../../types/index.js";

export async function expandVmSeriesConfigProfiles(
  deployment: DeploymentConfig,
  profileLoader: ResourceConfigLoader,
  configRef: string,
): Promise<DeploymentConfig> {
  const resources = await Promise.all(
    deployment.resources.map(async (resource) => {
      if (!isPanwVmseriesResource(resource)) return resource;
      return await expandVmSeriesResource(resource, profileLoader, configRef);
    }),
  );

  return {
    ...deployment,
    resources,
  };
}

async function expandVmSeriesResource(
  resource: PanwVmseriesResourceConfig,
  profileLoader: ResourceConfigLoader,
  configRef: string,
): Promise<ResourceConfig> {
  const profileNames = stringList(resource.configProfiles, `${configRef} ${resource.hostname}.configProfiles`);
  const profileAddOns: PanoramaConfigAddOnConfig[] = [];

  for (const profileName of profileNames) {
    const profile = await profileLoader.loadConfigProfile<PanwVmseriesConfigProfileConfig>(
      "panw-vmseries",
      profileName,
    );
    if (profile.name !== profileName) {
      throw new Error(
        `VM-Series config profile ${profileName} has mismatched name field ${profile.name}`,
      );
    }
    if (!Array.isArray(profile.configAddOns)) {
      throw new Error(`VM-Series config profile ${profileName} configAddOns must be an array`);
    }
    profileAddOns.push(
      ...profile.configAddOns.map((addOn) => validateConfigAddOn(addOn, `profile ${profileName}`)),
    );
  }

  const inlineAddOns = configAddOnList(
    resource.configAddOns,
    `${configRef} ${resource.hostname}.configAddOns`,
  );
  const configAddOns = dedupeConfigAddOns([...profileAddOns, ...inlineAddOns]);

  return {
    ...resource,
    configAddOns,
  };
}

function isPanwVmseriesResource(resource: ResourceConfig): resource is PanwVmseriesResourceConfig {
  return resource.kind === "panw-vmseries";
}

function stringList(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item)) {
    throw new Error(`${label} must be a string array`);
  }
  return value;
}

function configAddOnList(value: unknown, label: string): PanoramaConfigAddOnConfig[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((addOn) => validateConfigAddOn(addOn, label));
}

function validateConfigAddOn(value: unknown, label: string): PanoramaConfigAddOnConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} configAddOns entries must be objects`);
  }

  const addOn = value as PanoramaConfigAddOnConfig;
  if (addOn.name !== undefined && addOn.name !== null && (typeof addOn.name !== "string" || !addOn.name)) {
    throw new Error(`${label} config add-on name must be a non-empty string`);
  }
  if (typeof addOn.file !== "string" || !addOn.file) {
    throw new Error(`${label} config add-on file is required`);
  }
  if (addOn.commit !== undefined && addOn.commit !== null && typeof addOn.commit !== "boolean") {
    throw new Error(`${label} config add-on commit must be a boolean`);
  }
  if (addOn.push !== undefined && addOn.push !== null) {
    throw new Error(`${label} VM-Series config add-ons do not support Panorama push settings`);
  }

  return addOn;
}

function dedupeConfigAddOns(addOns: PanoramaConfigAddOnConfig[]): PanoramaConfigAddOnConfig[] {
  const seen = new Set<string>();
  const deduped: PanoramaConfigAddOnConfig[] = [];

  for (const addOn of addOns) {
    const key = addOn.name ?? addOn.file;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(addOn);
  }

  return deduped;
}
