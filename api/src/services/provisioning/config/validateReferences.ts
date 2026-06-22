import type {
  DeploymentConfig,
  ProviderConfig,
  ResourceConfig,
  TerraformResourceProfile,
  TerraformValueSpec,
} from "../types/index.js";

/**
 * The slice of {@link ConfigRepository} the reference check needs. Narrow on
 * purpose: the broker passes its real `config`, and the catalog cross-ref check
 * (Phase 5) and tests pass a lightweight in-memory source built from the same
 * accessors — no need to subclass the abstract repository.
 */
export interface ReferenceConfigSource {
  getProviderProfile(name: string): Promise<ProviderConfig | null>;
  getResourceProfile(name: string): Promise<TerraformResourceProfile | null>;
  /**
   * Distinct providers that have at least one Terraform resource profile. A provider
   * with none provisions via a non-Terraform adapter (e.g. Proxmox clones VMs through
   * its own API), so a derived `${provider}-${kind}` profile is not expected for it —
   * the check skips those to avoid false positives.
   */
  listResourceProfileProviders(): Promise<string[]>;
}

/**
 * Pre-flight validation of every by-name reference a deployment makes, run
 * BEFORE any provisioning step executes.
 *
 * The broker resolves these references lazily, deep inside step execution:
 *   - a resource's terraform profile (default `${provider}-${kind}`) is loaded
 *     during `terraform apply` (see resources/terraformRunner.ts),
 *   - step `targets` are matched to resources as each step runs (deploy loop),
 *   - cross-resource `fromResource` outputs resolve during var resolution.
 * A missing one therefore fails several steps in, after earlier resources are
 * already provisioned. This walks all three up front so a broken deployment is
 * rejected before the first resource is touched.
 *
 * Provider/app/config profiles are already resolved eagerly in the broker's
 * prepareDeploymentConfig (applyProviderProfile + each adapter's
 * prepareDeployment) before step 1, so they can't fail late; the provider
 * profile is re-checked here only because this function is also called
 * standalone (catalog validation), where that earlier path hasn't run.
 *
 * Throws a single Error listing EVERY problem found (not just the first) so the
 * operator can fix them in one pass. Resolves silently when everything checks out.
 */
export async function validateDeploymentReferences(
  deployment: DeploymentConfig,
  config: ReferenceConfigSource,
): Promise<void> {
  const problems = await collectDeploymentReferenceProblems(deployment, config);
  if (problems.length) {
    const plural = problems.length === 1 ? "" : "s";
    throw new Error(
      `Deployment "${deployment.name}" has ${problems.length} unresolved reference${plural}:\n` +
        problems.map((problem) => `  - ${problem}`).join("\n"),
    );
  }
}

/**
 * The reference checks behind {@link validateDeploymentReferences}, returning the
 * list of problems instead of throwing. The catalog validator uses this to aggregate
 * problems across every deployment into one report.
 */
export async function collectDeploymentReferenceProblems(
  deployment: DeploymentConfig,
  config: ReferenceConfigSource,
): Promise<string[]> {
  const problems: string[] = [];
  const resources = deployment.resources ?? [];

  // Identifiers a reference may use to name a resource: hostname or explicit name.
  const resourceIds = new Set<string>();
  for (const resource of resources) {
    if (resource.hostname) resourceIds.add(resource.hostname);
    if (resource.name) resourceIds.add(resource.name);
  }

  // Provider profile (belt-and-suspenders for standalone callers; the broker's
  // applyProviderProfile already throws on a missing one before this runs).
  if (typeof deployment.providerProfile === "string" && deployment.providerProfile) {
    if (!(await config.getProviderProfile(deployment.providerProfile))) {
      problems.push(`provider profile "${deployment.providerProfile}" not found`);
    }
  }

  // Per-resource: terraform profile exists, agrees on provider+kind, and any
  // fromResource references inside it name a real resource in this deployment.
  const terraformProviders = new Set(await config.listResourceProfileProviders());
  for (const resource of resources) {
    const where = resourceLabel(resource);
    const explicitProfile =
      typeof resource.terraformProfile === "string" && resource.terraformProfile
        ? resource.terraformProfile
        : null;
    // Only validate a derived profile for providers that use Terraform at all; a
    // provider with no resource profiles (e.g. Proxmox) provisions another way.
    if (!explicitProfile && !terraformProviders.has(deployment.provider.type)) continue;
    const profileName = explicitProfile ?? `${deployment.provider.type}-${resource.kind}`;
    const profile = await config.getResourceProfile(profileName);
    if (!profile) {
      problems.push(`${where}: terraform resource profile "${profileName}" not found`);
      continue;
    }
    if (profile.provider !== deployment.provider.type) {
      problems.push(
        `${where}: terraform profile "${profileName}" is for provider ${profile.provider}, not ${deployment.provider.type}`,
      );
    }
    if (profile.kind !== resource.kind) {
      problems.push(
        `${where}: terraform profile "${profileName}" is for resource kind ${profile.kind}, not ${resource.kind}`,
      );
    }
    for (const ref of collectResourceReferences(profile.terraform)) {
      if (!resourceIds.has(ref)) {
        problems.push(
          `${where}: terraform profile "${profileName}" references resource "${ref}" via fromResource, ` +
            `but deployment "${deployment.name}" has no such resource`,
        );
      }
    }
  }

  // Step targets must resolve to a resource (hostname or name).
  for (const step of deployment.steps ?? []) {
    for (const target of step.targets ?? []) {
      if (!resourceIds.has(target)) {
        problems.push(
          `step "${step.name}": target "${target}" matches no resource in deployment "${deployment.name}"`,
        );
      }
    }
  }

  return problems;
}

/** Every `fromResource` name referenced anywhere in a profile's vars/environment specs. */
function collectResourceReferences(terraform: TerraformResourceProfile["terraform"]): string[] {
  const refs = new Set<string>();
  for (const spec of Object.values(terraform.vars ?? {})) walkSpec(spec, refs);
  for (const spec of Object.values(terraform.environment ?? {})) walkSpec(spec, refs);
  return [...refs];
}

function walkSpec(spec: TerraformValueSpec, refs: Set<string>): void {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return;
  if (typeof spec.fromResource === "string" && spec.fromResource) refs.add(spec.fromResource);
  if (Array.isArray(spec.first)) {
    for (const candidate of spec.first) walkSpec(candidate, refs);
  }
}

function resourceLabel(resource: ResourceConfig): string {
  return `resource ${resource.hostname ?? resource.name ?? resource.kind}`;
}
