import type { z } from "zod";
import type { DeploymentConfig, ProviderConfig, ResourceConfig } from "../types/index.js";
import {
  appProfileSchemaByGroup,
  configProfileSchemaByGroup,
  deploymentConfigSchema,
  providerProfileSchema,
  resourceProfileSchema,
} from "./schemas.js";
import { collectDeploymentReferenceProblems, type ReferenceConfigSource } from "./validateReferences.js";
import {
  appProfiles as registryAppProfiles,
  configProfiles as registryConfigProfiles,
  deployments as registryDeployments,
  providerProfiles as registryProviderProfiles,
  resourceProfiles as registryResourceProfiles,
} from "./modules/index.js";
import type {
  AppProfileModule,
  ConfigProfileModule,
  DeploymentModule,
  GroupedProfile,
  ProviderProfileModule,
  ResourceProfileModule,
} from "./modules/types.js";

export interface Catalog {
  providerProfiles: ProviderProfileModule[];
  resourceProfiles: ResourceProfileModule[];
  deployments: DeploymentModule[];
  appProfiles: GroupedProfile<AppProfileModule>[];
  configProfiles: GroupedProfile<ConfigProfileModule>[];
}

const defaultCatalog: Catalog = {
  providerProfiles: registryProviderProfiles,
  resourceProfiles: registryResourceProfiles,
  deployments: registryDeployments,
  appProfiles: registryAppProfiles,
  configProfiles: registryConfigProfiles,
};

// Maps a resource kind to the app/config-profile group its `appProfiles` /
// `configProfiles` references draw from. The mapping otherwise lives implicitly in
// each resource adapter; centralizing it here lets the catalog check validate that
// every named profile exists before anything is seeded or deployed.
const APP_PROFILE_GROUP_BY_KIND: Record<string, string> = {
  "windows-endpoint": "windows",
  "ubuntu-server": "linux",
};
const CONFIG_PROFILE_GROUP_BY_KIND: Record<string, string> = {
  "panw-vmseries": "panw-vmseries",
};

/**
 * Validates the whole config catalog up front: every module's shape (Zod) and every
 * by-name reference between modules (provider/terraform/app/config profiles, step
 * targets, fromResource). Throws one Error listing every problem across the catalog.
 *
 * This is the author-time twin of {@link validateDeploymentReferences}: the seed runs
 * it before inserting (a broken catalog can't be seeded) and the catalog test runs it
 * in CI (a broken module fails the suite without a DB).
 */
export async function validateCatalog(catalog: Catalog = defaultCatalog): Promise<void> {
  const problems: string[] = [];

  // ── Shape (Zod) ─────────────────────────────────────────────────────────────
  for (const m of catalog.providerProfiles) {
    pushShape(problems, providerProfileSchema, m, `provider profile "${m.name}"`);
  }
  for (const m of catalog.resourceProfiles) {
    pushShape(problems, resourceProfileSchema, m, `resource profile "${m.name}"`);
  }
  for (const m of catalog.deployments) {
    pushShape(problems, deploymentConfigSchema, m, `deployment "${m.name}"`);
  }
  for (const { group, profile } of catalog.appProfiles) {
    const schema = appProfileSchemaByGroup[group];
    if (!schema) problems.push(`app profile "${profile.name}": unknown group "${group}"`);
    else pushShape(problems, schema, profile, `app profile ${group}/${profile.name}`);
  }
  for (const { group, profile } of catalog.configProfiles) {
    const schema = configProfileSchemaByGroup[group];
    if (!schema) problems.push(`config profile "${profile.name}": unknown group "${group}"`);
    else pushShape(problems, schema, profile, `config profile ${group}/${profile.name}`);
  }

  // ── References ──────────────────────────────────────────────────────────────
  const source = referenceSource(catalog);
  const hasApp = (group: string, name: string) =>
    catalog.appProfiles.some((e) => e.group === group && e.profile.name === name);
  const hasConfig = (group: string, name: string) =>
    catalog.configProfiles.some((e) => e.group === group && e.profile.name === name);

  for (const mod of catalog.deployments) {
    // Terraform profiles, step targets, fromResource — shared with the deploy preflight.
    for (const problem of await collectDeploymentReferenceProblems(resolveDeployment(mod, catalog), source)) {
      problems.push(`deployment "${mod.name}": ${problem}`);
    }

    // App-profile option values (inputs annotated with appProfileGroup).
    for (const input of mod.inputs ?? []) {
      if (!input.appProfileGroup) continue;
      for (const option of input.options ?? []) {
        if (typeof option.value === "string" && option.value && !hasApp(input.appProfileGroup, option.value)) {
          problems.push(
            `deployment "${mod.name}" input "${input.name}": option "${option.value}" names no ${input.appProfileGroup} app profile`,
          );
        }
      }
    }

    // Profiles named directly on a resource (resource.appProfiles / configProfiles).
    for (const resource of mod.resources ?? []) {
      const appGroup = APP_PROFILE_GROUP_BY_KIND[resource.kind];
      for (const name of stringArray(resource.appProfiles)) {
        if (appGroup && !hasApp(appGroup, name)) {
          problems.push(`deployment "${mod.name}" resource "${resource.hostname}": app profile "${name}" not found in group "${appGroup}"`);
        }
      }
      const configGroup = CONFIG_PROFILE_GROUP_BY_KIND[resource.kind];
      for (const name of stringArray(resource.configProfiles)) {
        if (configGroup && !hasConfig(configGroup, name)) {
          problems.push(`deployment "${mod.name}" resource "${resource.hostname}": config profile "${name}" not found in group "${configGroup}"`);
        }
      }
    }
  }

  if (problems.length) {
    throw new Error(
      `Provisioning config catalog has ${problems.length} problem${problems.length === 1 ? "" : "s"}:\n` +
        problems.map((problem) => `  - ${problem}`).join("\n"),
    );
  }
}

function pushShape(problems: string[], schema: z.ZodType<unknown>, value: unknown, label: string): void {
  const result = schema.safeParse(value);
  if (result.success) return;
  for (const issue of result.error.issues) {
    const path = issue.path.length ? ` (${issue.path.join(".")})` : "";
    problems.push(`${label}: ${issue.message}${path}`);
  }
}

function referenceSource(catalog: Catalog): ReferenceConfigSource {
  return {
    async getProviderProfile(name) {
      const mod = catalog.providerProfiles.find((p) => p.name === name);
      if (!mod) return null;
      const { name: _name, ...providerConfig } = mod;
      return providerConfig as ProviderConfig;
    },
    async getResourceProfile(name) {
      return catalog.resourceProfiles.find((p) => p.name === name) ?? null;
    },
    async listResourceProfileProviders() {
      return [...new Set(catalog.resourceProfiles.map((p) => p.provider))];
    },
  };
}

function resolveDeployment(mod: DeploymentModule, catalog: Catalog): DeploymentConfig {
  const inlineType = typeof mod.provider?.type === "string" ? mod.provider.type : undefined;
  const profileType = mod.providerProfile
    ? catalog.providerProfiles.find((p) => p.name === mod.providerProfile)?.type
    : undefined;
  return {
    name: mod.name,
    providerProfile: mod.providerProfile ?? null,
    provider: { ...(mod.provider ?? {}), type: inlineType ?? profileType ?? "unknown" } as ProviderConfig,
    resources: mod.resources as ResourceConfig[],
    inputs: mod.inputs,
    steps: mod.steps,
    templateName: mod.templateName ?? null,
    displayName: mod.displayName ?? null,
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
