import { withUser } from "../../../db/connection.js";
import { deployments, providerProfiles, resourceProfiles } from "./modules/index.js";
import { validateCatalog } from "./validateCatalog.js";

export interface SeedResult {
  providerProfiles: number;
  resourceProfiles: number;
  deployments: number;
  deploymentResources: number;
}

// Seeds the code-defined config modules (config/modules/**) into the provisioning_*
// config tables for a user. Idempotent: profiles + deployments upsert by
// (user_id, name); a deployment's resource children are replaced. deployments.name is
// the module's name (the broker's deploymentId and join key). It only ever upserts
// template rows (name == module name), so cloned instances are untouched.
//
// App profiles + config profiles are NOT seeded — they resolve straight from the
// registry at runtime (PostgresConfigRepository.read{App,Config}Profile), the same way
// the broker reads them. Only deployments / provider / resource profiles need rows
// (so they're queryable, instanceable, and FK targets for provisioned_resources).
export async function seedProvisioningConfig(userId: number): Promise<SeedResult> {
  // Validate the whole catalog (shape + cross-references) before writing anything, so
  // a malformed or dangling module fails loudly here instead of mid-deploy.
  await validateCatalog();

  const result: SeedResult = {
    providerProfiles: 0,
    resourceProfiles: 0,
    deployments: 0,
    deploymentResources: 0,
  };

  for (const mod of providerProfiles) {
    const { type, ...config } = mod;
    await withUser(userId, async (c) => {
      await c.query(
        `INSERT INTO provider_profiles (user_id, name, type, config)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (user_id, name) DO UPDATE SET type = EXCLUDED.type, config = EXCLUDED.config`,
        [userId, mod.name, type, JSON.stringify(config)],
      );
    });
    result.providerProfiles++;
  }

  for (const mod of resourceProfiles) {
    await withUser(userId, async (c) => {
      await c.query(
        `INSERT INTO resource_profiles (user_id, name, provider, kind, terraform)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (user_id, name) DO UPDATE SET
           provider = EXCLUDED.provider, kind = EXCLUDED.kind, terraform = EXCLUDED.terraform`,
        [userId, mod.name, mod.provider, mod.kind, JSON.stringify(mod.terraform)],
      );
    });
    result.resourceProfiles++;
  }

  for (const mod of deployments) {
    const provider = mod.provider ?? {};
    const inlineType = typeof provider.type === "string" ? provider.type : undefined;
    const profileType = mod.providerProfile
      ? providerProfiles.find((p) => p.name === mod.providerProfile)?.type
      : undefined;
    const resources = mod.resources ?? [];
    await withUser(userId, async (c) => {
      const depRow = await c.query<{ id: number }>(
        `INSERT INTO deployments (user_id, name, provider_type, provider_profile, provider_config, inputs, steps)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)
         ON CONFLICT (user_id, name) DO UPDATE SET
           provider_type = EXCLUDED.provider_type, provider_profile = EXCLUDED.provider_profile,
           provider_config = EXCLUDED.provider_config, inputs = EXCLUDED.inputs, steps = EXCLUDED.steps
         RETURNING id`,
        [
          userId,
          mod.name,
          inlineType ?? profileType ?? "unknown",
          mod.providerProfile ?? null,
          JSON.stringify(provider),
          JSON.stringify(mod.inputs ?? []),
          JSON.stringify(mod.steps ?? []),
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
            res.kind,
            typeof res.name === "string" ? res.name : null,
            res.hostname || `${mod.name}-${ordinal}`,
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
