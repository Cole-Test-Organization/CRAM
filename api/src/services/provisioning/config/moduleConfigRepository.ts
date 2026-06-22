import type {
  DeploymentConfig,
  ProviderConfig,
  ResourceConfig,
  TerraformResourceProfile,
} from "../types/index.js";
import { ConfigRepository } from "./configRepository.js";
import {
  deployments,
  findAppProfile,
  findConfigProfile,
  providerProfiles,
  resourceProfiles,
} from "./modules/index.js";

/**
 * ConfigRepository backed entirely by the in-code module registry (config/modules).
 * The file-less successor to the old YAML-reading repository: no disk, no DB. It's
 * the broker's default config source for standalone/test use; the API runtime injects
 * {@link PostgresConfigRepository} instead (deployments are seeded into Postgres so
 * they're queryable and instanceable), while app/config profiles resolve from this
 * same registry in both.
 */
export class ModuleConfigRepository extends ConfigRepository {
  protected async readDeploymentIds(): Promise<string[]> {
    return deployments.map((d) => d.name);
  }

  protected async readDeploymentConfig(id: string): Promise<DeploymentConfig | null> {
    const mod = deployments.find((d) => d.name === id);
    if (!mod) return null;
    // Resolve provider type the same way the seed does: inline, else from the
    // referenced provider profile. The base class still merges the full profile.
    const inlineType = typeof mod.provider?.type === "string" ? mod.provider.type : undefined;
    const profileType = mod.providerProfile
      ? providerProfiles.find((p) => p.name === mod.providerProfile)?.type
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

  protected async readProviderProfile(name: string): Promise<ProviderConfig | null> {
    const mod = providerProfiles.find((p) => p.name === name);
    if (!mod) return null;
    const { name: _name, ...providerConfig } = mod;
    return providerConfig as ProviderConfig;
  }

  protected async readResourceProfile(name: string): Promise<TerraformResourceProfile | null> {
    return resourceProfiles.find((p) => p.name === name) ?? null;
  }

  protected async readResourceProfileProviders(): Promise<string[]> {
    return [...new Set(resourceProfiles.map((p) => p.provider))];
  }

  protected async readAppProfile(group: string, name: string): Promise<unknown | null> {
    return findAppProfile(group, name);
  }

  protected async readConfigProfile(group: string, name: string): Promise<unknown | null> {
    return findConfigProfile(group, name);
  }

  protected deploymentRef(id: string): string {
    return id;
  }
}
