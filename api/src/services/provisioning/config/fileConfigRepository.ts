import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import {
  databaseDeploymentsDir,
  databaseDir,
  databaseProviderProfilesDir,
  databaseResourceProfilesDir,
} from "../utils/paths.js";
import type { DeploymentConfig, ProviderConfig, TerraformResourceProfile } from "../types/index.js";
import { ConfigRepository } from "./configRepository.js";

/**
 * Reads deployment configuration from the `database/**` YAML tree.
 *
 * Transitional: when deployments move to the database, a `SqlConfigRepository`
 * implements the same four raw reads against rows and the discovery contract is
 * unchanged.
 */
export class FileConfigRepository extends ConfigRepository {
  protected async readDeploymentIds(): Promise<string[]> {
    let entries: string[];
    try {
      entries = await readdir(databaseDeploymentsDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return entries
      .filter((entry) => entry.endsWith(".yaml") || entry.endsWith(".yml"))
      .map((entry) => entry.replace(/\.ya?ml$/, ""));
  }

  protected async readDeploymentConfig(id: string): Promise<DeploymentConfig | null> {
    return (await this.readYaml(databaseDeploymentsDir, id)) as DeploymentConfig | null;
  }

  protected async readProviderProfile(name: string): Promise<ProviderConfig | null> {
    return (await this.readYaml(databaseProviderProfilesDir, name)) as ProviderConfig | null;
  }

  protected async readAppProfile(group: string, name: string): Promise<unknown | null> {
    return this.readYaml(path.join(databaseDir, "app-profiles", group), name);
  }

  protected async readConfigProfile(group: string, name: string): Promise<unknown | null> {
    return this.readYaml(path.join(databaseDir, "config-profiles", group), name);
  }

  protected async readResourceProfile(name: string): Promise<TerraformResourceProfile | null> {
    return (await this.readYaml(databaseResourceProfilesDir, name)) as TerraformResourceProfile | null;
  }

  protected deploymentRef(id: string): string {
    return path.posix.join("database", "deployments", `${id}.yaml`);
  }

  private async readYaml(dir: string, name: string): Promise<unknown> {
    try {
      const raw = await readFile(path.join(dir, `${name}.yaml`), "utf8");
      return YAML.parse(raw) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
}
