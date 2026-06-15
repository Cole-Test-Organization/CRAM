import type {
  DeploymentConfig,
  ResourceConfig,
  WindowsApplicationConfig,
  WindowsAppProfileLoader,
  WindowsEndpointResource,
} from "../../types/index.js";

export async function expandWindowsAppProfiles(
  deployment: DeploymentConfig,
  profileLoader: WindowsAppProfileLoader,
  configRef: string,
): Promise<DeploymentConfig> {
  const resources = await Promise.all(
    deployment.resources.map(async (resource) => {
      if (resource.kind !== "windows-endpoint") return resource;
      return await expandWindowsEndpointResource(resource, profileLoader, configRef);
    }),
  );

  return {
    ...deployment,
    resources,
  };
}

async function expandWindowsEndpointResource(
  resource: WindowsEndpointResource,
  profileLoader: WindowsAppProfileLoader,
  configRef: string,
): Promise<ResourceConfig> {
  const profileNames = stringList(resource.appProfiles, `${configRef} ${resource.hostname}.appProfiles`);
  const profileApps: WindowsApplicationConfig[] = [];

  for (const profileName of profileNames) {
    const profile = await profileLoader.loadAppProfile<{
      name: string;
      apps: WindowsApplicationConfig[];
    }>("windows", profileName);
    if (profile.name !== profileName) {
      throw new Error(
        `Windows app profile ${profileName} has mismatched name field ${profile.name}`,
      );
    }
    if (!Array.isArray(profile.apps)) {
      throw new Error(`Windows app profile ${profileName} apps must be an array`);
    }
    profileApps.push(
      ...profile.apps.map((app) => validateApplication(app, `profile ${profileName}`)),
    );
  }

  const inlineApps = appList(resource.applications, `${configRef} ${resource.hostname}.applications`);
  const applications = dedupeApplications([...profileApps, ...inlineApps]);

  return {
    ...resource,
    applications,
  };
}

function stringList(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item)) {
    throw new Error(`${label} must be a string array`);
  }
  return value;
}

function appList(value: unknown, label: string): WindowsApplicationConfig[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((app) => validateApplication(app, label));
}

function validateApplication(value: unknown, label: string): WindowsApplicationConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} application entries must be objects`);
  }

  const app = value as WindowsApplicationConfig;
  if (!app.id || typeof app.id !== "string") {
    throw new Error(`${label} application id is required`);
  }
  if (!["chocolatey", "exe", "msi", "powershell"].includes(app.method)) {
    throw new Error(`${label} application ${app.id} has unsupported method ${String(app.method)}`);
  }
  if (app.method === "chocolatey" && !app.package) {
    throw new Error(`${label} application ${app.id} requires package for chocolatey method`);
  }
  if (app.url !== undefined && (typeof app.url !== "string" || !app.url)) {
    throw new Error(`${label} application ${app.id} url must be a non-empty string`);
  }
  if (app.sourcePath !== undefined && (typeof app.sourcePath !== "string" || !app.sourcePath)) {
    throw new Error(`${label} application ${app.id} sourcePath must be a non-empty string`);
  }
  if (app.sourcePath && app.method !== "exe" && app.method !== "msi") {
    throw new Error(`${label} application ${app.id} sourcePath is only supported for exe or msi methods`);
  }
  if ((app.method === "exe" || app.method === "msi")) {
    if (!app.url && !app.sourcePath) {
      throw new Error(`${label} application ${app.id} requires url or sourcePath for ${app.method} method`);
    }
    if (app.url && app.sourcePath) {
      throw new Error(`${label} application ${app.id} must not define both url and sourcePath`);
    }
  }
  if (
    app.allowedExitCodes !== undefined &&
    (
      !Array.isArray(app.allowedExitCodes) ||
      !app.allowedExitCodes.every((code) => Number.isInteger(code) && code >= 0)
    )
  ) {
    throw new Error(`${label} application ${app.id} allowedExitCodes must be a non-negative integer array`);
  }
  if (app.method === "powershell" && !app.command) {
    throw new Error(`${label} application ${app.id} requires command for powershell method`);
  }

  return {
    ...app,
    args: app.args ?? [],
  };
}

function dedupeApplications(apps: WindowsApplicationConfig[]): WindowsApplicationConfig[] {
  const seen = new Set<string>();
  const deduped: WindowsApplicationConfig[] = [];

  for (const app of apps) {
    if (seen.has(app.id)) continue;
    seen.add(app.id);
    deduped.push(app);
  }

  return deduped;
}
