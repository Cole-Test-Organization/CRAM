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
// off (it only ever touches YAML-named template rows), so they survive restarts.

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

  return withUser(userId, async (c) => {
    const tplRes = await c.query<TemplateRow>(
      `SELECT id, name, provider_type, provider_profile, provider_config, inputs, steps, template_name
         FROM deployments WHERE name = $1`,
      [templateSlug],
    );
    const tpl = tplRes.rows[0];
    if (!tpl) {
      throw httpError(404, `deployment "${templateSlug}" is not seeded — POST /api/provisioning/seed first`);
    }

    const slug = await uniqueSlug(c, userId, displayName);
    // Record the *original* template even when cloning from another instance.
    const templateOrigin = tpl.template_name ?? tpl.name;
    const providerConfig = { ...(tpl.provider_config ?? {}), projectName: slug };

    const depRow = await c.query<{ id: number }>(
      `INSERT INTO deployments
         (user_id, name, provider_type, provider_profile, provider_config, inputs, steps, template_name, display_name)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9)
       RETURNING id`,
      [
        userId,
        slug,
        tpl.provider_type,
        tpl.provider_profile,
        JSON.stringify(providerConfig),
        JSON.stringify(tpl.inputs ?? []),
        JSON.stringify(tpl.steps ?? []),
        templateOrigin,
        displayName,
      ],
    );
    const instanceId = depRow.rows[0].id;

    await c.query(
      `INSERT INTO deployment_resources (deployment_id, ordinal, kind, name, hostname, terraform_profile, config)
       SELECT $1, ordinal, kind, name, hostname, terraform_profile, config
         FROM deployment_resources WHERE deployment_id = $2`,
      [instanceId, tpl.id],
    );

    return { slug, displayName, templateName: templateOrigin };
  });
}

export async function deleteDeploymentInstance(userId: number, slug: string): Promise<{ deleted: boolean }> {
  return withUser(userId, async (c) => {
    const dep = await c.query<{ id: number; template_name: string | null }>(
      `SELECT id, template_name FROM deployments WHERE name = $1`,
      [slug],
    );
    const row = dep.rows[0];
    if (!row) throw httpError(404, `no deployment "${slug}"`);
    if (row.template_name == null) {
      throw httpError(400, `"${slug}" is a catalog template, not an instance — templates are managed via the YAML seed`);
    }

    const live = await c.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM provisioned_resources
        WHERE deployment_id = $1 AND lifecycle_status <> 'destroyed'`,
      [row.id],
    );
    if ((live.rows[0]?.n ?? 0) > 0) {
      throw httpError(409, `"${slug}" still has live resources — deprovision it before deleting`);
    }

    // provisioned_resources is ON DELETE RESTRICT, so clear the (destroyed) records
    // first; deployment_resources CASCADEs and provisioning_jobs SET NULL on the row delete.
    await c.query(`DELETE FROM provisioned_resources WHERE deployment_id = $1`, [row.id]);
    await c.query(`DELETE FROM deployments WHERE id = $1`, [row.id]);
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

async function uniqueSlug(c: PoolClient, userId: number, displayName: string): Promise<string> {
  const base = slugify(displayName) || "instance";
  // RLS already scopes to this user, but pass user_id explicitly for clarity.
  const { rows } = await c.query<{ name: string }>(
    `SELECT name FROM deployments WHERE user_id = $1 AND (name = $2 OR name LIKE $2 || '-%')`,
    [userId, base],
  );
  const taken = new Set(rows.map((r) => r.name));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
