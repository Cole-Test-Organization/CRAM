import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { withUser } from "../../../db/connection.js";
import {
  databaseDeploymentsDir,
  databaseProviderProfilesDir,
  databaseResourceProfilesDir,
} from "../utils/paths.js";

export interface SeedResult {
  providerProfiles: number;
  resourceProfiles: number;
  deployments: number;
  deploymentResources: number;
}

type Dict = Record<string, unknown>;

// Seeds the broker's database/*.yaml config into the provisioning_* config tables for
// a user. Idempotent: profiles + deployments upsert by (user_id, name); a deployment's
// resource children are replaced. deployments.name is stored as the file slug (the
// broker's deploymentId and join key). App profiles + config add-ons are NOT seeded —
// they stay as shipped file artifacts (PostgresConfigRepository reads them from disk).
export async function seedProvisioningConfig(userId: number): Promise<SeedResult> {
  const result: SeedResult = {
    providerProfiles: 0,
    resourceProfiles: 0,
    deployments: 0,
    deploymentResources: 0,
  };

  for (const name of await listYamlNames(databaseProviderProfilesDir)) {
    const profile = await readYaml(databaseProviderProfilesDir, name);
    if (!profile) continue;
    const { type, ...config } = profile;
    await withUser(userId, async (c) => {
      await c.query(
        `INSERT INTO provider_profiles (user_id, name, type, config)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (user_id, name) DO UPDATE SET type = EXCLUDED.type, config = EXCLUDED.config`,
        [userId, name, str(type, "unknown"), JSON.stringify(config)],
      );
    });
    result.providerProfiles++;
  }

  for (const name of await listYamlNames(databaseResourceProfilesDir)) {
    const profile = await readYaml(databaseResourceProfilesDir, name);
    if (!profile) continue;
    await withUser(userId, async (c) => {
      await c.query(
        `INSERT INTO resource_profiles (user_id, name, provider, kind, terraform)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (user_id, name) DO UPDATE SET
           provider = EXCLUDED.provider, kind = EXCLUDED.kind, terraform = EXCLUDED.terraform`,
        [userId, name, str(profile.provider, "unknown"), str(profile.kind, "unknown"), JSON.stringify(profile.terraform ?? {})],
      );
    });
    result.resourceProfiles++;
  }

  for (const slug of await listYamlNames(databaseDeploymentsDir)) {
    const dep = await readYaml(databaseDeploymentsDir, slug);
    if (!dep) continue;
    const provider = (dep.provider ?? {}) as Dict;
    let providerType = typeof provider.type === "string" ? provider.type : undefined;
    if (!providerType && typeof dep.providerProfile === "string") {
      const prof = await readYaml(databaseProviderProfilesDir, dep.providerProfile);
      providerType = typeof prof?.type === "string" ? prof.type : undefined;
    }
    const resources = Array.isArray(dep.resources) ? (dep.resources as Dict[]) : [];
    await withUser(userId, async (c) => {
      const depRow = await c.query<{ id: number }>(
        `INSERT INTO deployments (user_id, name, provider_type, provider_profile, provider_config, steps)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
         ON CONFLICT (user_id, name) DO UPDATE SET
           provider_type = EXCLUDED.provider_type, provider_profile = EXCLUDED.provider_profile,
           provider_config = EXCLUDED.provider_config, steps = EXCLUDED.steps
         RETURNING id`,
        [
          userId,
          slug,
          providerType ?? "unknown",
          typeof dep.providerProfile === "string" ? dep.providerProfile : null,
          JSON.stringify(provider),
          JSON.stringify(dep.steps ?? []),
        ],
      );
      const deploymentId = depRow.rows[0].id;
      await c.query(`DELETE FROM deployment_resources WHERE deployment_id = $1`, [deploymentId]);
      let ordinal = 0;
      for (const res of resources) {
        await c.query(
          `INSERT INTO deployment_resources (deployment_id, ordinal, kind, name, hostname, terraform_profile, config)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
          [
            deploymentId,
            ordinal,
            str(res.kind, "unknown"),
            typeof res.name === "string" ? res.name : null,
            str(res.hostname, `${slug}-${ordinal}`),
            typeof res.terraformProfile === "string" ? res.terraformProfile : null,
            JSON.stringify(res),
          ],
        );
        ordinal++;
        result.deploymentResources++;
      }
    });
    result.deployments++;
  }

  return result;
}

async function listYamlNames(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    return entries.filter((e) => /\.ya?ml$/i.test(e)).map((e) => e.replace(/\.ya?ml$/i, ""));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readYaml(dir: string, name: string): Promise<Dict | null> {
  try {
    const parsed = YAML.parse(await readFile(path.join(dir, `${name}.yaml`), "utf8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Dict) : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? value : fallback;
}
