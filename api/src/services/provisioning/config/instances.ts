import type { PoolClient } from "pg";
import { withUser } from "../../../db/connection.js";
import { httpError } from "../../../lib/http-error.js";

// Deployment *instances*: clone a seeded template deployment into a fresh row under a
// user-chosen name so the same blueprint can be launched any number of times, each
// fully isolated. Isolation falls out of the broker's existing keying:
//   - Terraform workspace is `${deployment.name}__${hostname}` → a unique instance
//     slug gives every clone its own workspace/state.
//   - provisioned_resources is unique per (deployment_id, hostname) → no record clash
//     even when two instances keep the template's hostname.
//   - AWS resource names are `${project_name}-${hostname}-...`, so we override the
//     clone's projectName to the instance slug → unique IAM roles / key pairs / SGs.
// Instances carry a non-null template_name, which is exactly what the boot reseed keys
// off (it only ever touches code-defined template rows), so they survive restarts.

// Keep the slug short enough that `${slug}-${hostname}-ssm-role` stays under AWS's
// 64-char IAM name limit for typical hostnames, and valid as an AWS name prefix.
const MAX_SLUG_LEN = 28;

export interface CreateInstanceInput {
  /** Operator-typed label; slugified into the durable deployment name. */
  name: string;
}

export interface CreateInstanceResult {
  slug: string;
  displayName: string;
  templateName: string;
}

interface TemplateRow {
  id: number;
  name: string;
  provider_type: string;
  provider_profile: string | null;
  provider_config: Record<string, unknown> | null;
  inputs: unknown;
  steps: unknown;
  template_name: string | null;
}

export async function createDeploymentInstance(
  userId: number,
  templateSlug: string,
  input: CreateInstanceInput,
): Promise<CreateInstanceResult> {
  const displayName = input.name?.trim();
  if (!displayName) throw httpError(400, "instance name is required");

  return withUser(userId, async (client) => {
    const templateResult = await client.query<TemplateRow>(
      `SELECT id, name, provider_type, provider_profile, provider_config, inputs, steps, template_name
         FROM deployments WHERE name = $1`,
      [templateSlug],
    );
    const templateDeployment = templateResult.rows[0];
    if (!templateDeployment) {
      throw httpError(404, `deployment "${templateSlug}" is not seeded — POST /api/provisioning/seed first`);
    }

    const slug = await uniqueSlug(client, userId, displayName);
    // Record the *original* template even when cloning from another instance.
    const templateOrigin = templateDeployment.template_name ?? templateDeployment.name;
    const providerConfig = { ...(templateDeployment.provider_config ?? {}), projectName: slug };

    const insertedDeploymentResult = await client.query<{ id: number }>(
      `INSERT INTO deployments
         (user_id, name, provider_type, provider_profile, provider_config, inputs, steps, template_name, display_name)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9)
       RETURNING id`,
      [
        userId,
        slug,
        templateDeployment.provider_type,
        templateDeployment.provider_profile,
        JSON.stringify(providerConfig),
        JSON.stringify(templateDeployment.inputs ?? []),
        JSON.stringify(templateDeployment.steps ?? []),
        templateOrigin,
        displayName,
      ],
    );
    const instanceDeploymentId = insertedDeploymentResult.rows[0].id;

    await client.query(
      `INSERT INTO deployment_resources (deployment_id, ordinal, kind, name, hostname, terraform_profile, config)
       SELECT $1, ordinal, kind, name, hostname, terraform_profile, config
         FROM deployment_resources WHERE deployment_id = $2`,
      [instanceDeploymentId, templateDeployment.id],
    );

    return { slug, displayName, templateName: templateOrigin };
  });
}

export async function deleteDeploymentInstance(userId: number, slug: string): Promise<{ deleted: boolean }> {
  return withUser(userId, async (client) => {
    const deploymentResult = await client.query<{ id: number; template_name: string | null }>(
      `SELECT id, template_name FROM deployments WHERE name = $1`,
      [slug],
    );
    const deployment = deploymentResult.rows[0];
    if (!deployment) throw httpError(404, `no deployment "${slug}"`);
    if (deployment.template_name == null) {
      throw httpError(400, `"${slug}" is a catalog template, not an instance — templates are managed via the config-module seed`);
    }

    const liveResourceResult = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM provisioned_resources
        WHERE deployment_id = $1 AND lifecycle_status <> 'destroyed'`,
      [deployment.id],
    );
    if ((liveResourceResult.rows[0]?.n ?? 0) > 0) {
      throw httpError(409, `"${slug}" still has live resources — deprovision it before deleting`);
    }

    // provisioned_resources is ON DELETE RESTRICT, so clear the (destroyed) records
    // first; deployment_resources CASCADEs and provisioning_jobs SET NULL on the row delete.
    await client.query(`DELETE FROM provisioned_resources WHERE deployment_id = $1`, [deployment.id]);
    await client.query(`DELETE FROM deployments WHERE id = $1`, [deployment.id]);
    return { deleted: true };
  });
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LEN)
    .replace(/-+$/g, "");
}

async function uniqueSlug(client: PoolClient, userId: number, displayName: string): Promise<string> {
  const base = slugify(displayName) || "instance";
  // RLS already scopes to this user, but pass user_id explicitly for clarity.
  const existingDeploymentResult = await client.query<{ name: string }>(
    `SELECT name FROM deployments WHERE user_id = $1 AND (name = $2 OR name LIKE $2 || '-%')`,
    [userId, base],
  );
  const takenSlugs = new Set(existingDeploymentResult.rows.map((deployment) => deployment.name));
  if (!takenSlugs.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!takenSlugs.has(candidate)) return candidate;
  }
}
