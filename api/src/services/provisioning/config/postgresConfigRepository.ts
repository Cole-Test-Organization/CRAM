import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { withUser } from "../../../db/connection.js";
import { databaseDir } from "../utils/paths.js";
import type {
  DeploymentConfig,
  ProviderConfig,
  ResourceConfig,
  TerraformResourceProfile,
} from "../types/index.js";
import { ConfigRepository } from "./configRepository.js";

// Postgres-backed ConfigRepository (Phase 2 of the broker migration). It implements
// the same raw-read hooks the file repo does, so the discovery contract and the
// broker's lifecycle loaders are unchanged. Storage split:
//   - deployments / provider_profiles / resource_profiles come from rows seeded out
//     of database/*.yaml (readDeploymentConfig reassembles a DeploymentConfig from
//     the parent deployment row + ordered deployment_resources children).
//   - app profiles and config profiles have NO Phase 0 tables; they stay as shipped
//     file artifacts (code-like, baked into the image alongside the terraform stacks).
// All row reads run under withUser(); forced RLS scopes them to this user.
export class PostgresConfigRepository extends ConfigRepository {
  constructor(private readonly userId: number) {
    super();
  }

  protected async readDeploymentIds(): Promise<string[]> {
    return withUser(this.userId, async (c) => {
      const { rows } = await c.query<{ name: string }>(`SELECT name FROM deployments ORDER BY name`);
      return rows.map((r) => r.name);
    });
  }

  protected async readDeploymentConfig(id: string): Promise<DeploymentConfig | null> {
    return withUser(this.userId, async (c) => {
      const dep = await c.query(
        `SELECT id, name, provider_type, provider_profile, provider_config, inputs, steps,
                template_name, display_name
           FROM deployments WHERE name = $1`,
        [id],
      );
      if (!dep.rows.length) return null;
      const d = dep.rows[0];
      const res = await c.query<{ config: ResourceConfig }>(
        `SELECT config FROM deployment_resources WHERE deployment_id = $1 ORDER BY ordinal, id`,
        [d.id],
      );
      const providerConfig = (d.provider_config ?? {}) as Record<string, unknown>;
      return {
        // name is the broker's slug/deploymentId (the seed stores it here); the join
        // key resources resolve against.
        name: d.name,
        providerProfile: d.provider_profile ?? null,
        provider: { type: d.provider_type, ...providerConfig } as ProviderConfig,
        resources: res.rows.map((r) => r.config),
        inputs: (d.inputs ?? []) as DeploymentConfig["inputs"],
        steps: (d.steps ?? []) as DeploymentConfig["steps"],
        templateName: (d.template_name as string | null) ?? null,
        displayName: (d.display_name as string | null) ?? null,
      };
    });
  }

  protected async readProviderProfile(name: string): Promise<ProviderConfig | null> {
    return withUser(this.userId, async (c) => {
      const { rows } = await c.query(`SELECT type, config FROM provider_profiles WHERE name = $1`, [name]);
      if (!rows.length) return null;
      const config = (rows[0].config ?? {}) as Record<string, unknown>;
      return { type: rows[0].type, ...config } as ProviderConfig;
    });
  }

  protected async readResourceProfile(name: string): Promise<TerraformResourceProfile | null> {
    return withUser(this.userId, async (c) => {
      const { rows } = await c.query(
        `SELECT name, provider, kind, terraform FROM resource_profiles WHERE name = $1`,
        [name],
      );
      if (!rows.length) return null;
      const r = rows[0];
      return { name: r.name, provider: r.provider, kind: r.kind, terraform: r.terraform } as TerraformResourceProfile;
    });
  }

  protected async readAppProfile(group: string, name: string): Promise<unknown | null> {
    return readYamlArtifact(path.join(databaseDir, "app-profiles", group, `${name}.yaml`));
  }

  protected async readConfigProfile(group: string, name: string): Promise<unknown | null> {
    return readYamlArtifact(path.join(databaseDir, "config-profiles", group, `${name}.yaml`));
  }

  protected deploymentRef(id: string): string {
    // PG's logical ref is just the slug — there is no file path.
    return id;
  }
}

async function readYamlArtifact(filePath: string): Promise<unknown | null> {
  try {
    return YAML.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
