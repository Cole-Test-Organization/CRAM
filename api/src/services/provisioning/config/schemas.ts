import { z } from "zod";

/**
 * Runtime schemas for the code-defined config modules (config/modules/**). Each
 * module also declares `satisfies <Type>` for compile-time checking; these schemas
 * are the runtime gate the seed and the catalog test run every module through, so a
 * malformed module can't be seeded or merged.
 *
 * Strictness follows the broker's own types: envelopes whose key set is closed
 * (deployment, step, input, terraform profile) are `.strict()` so a typo'd key is
 * rejected; shapes the broker deliberately keeps open (provider config, resource
 * bodies, placement — read by arbitrary `path:` lookups during var resolution) are
 * `.passthrough()` so authoring isn't over-constrained.
 */

// ── Terraform value spec (recursive) ─────────────────────────────────────────
const terraformValueResolverSchema = z.enum(["currentPublicIpCidrList", "localSshPublicKey"]);

export const terraformValueSpecSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.null(),
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.unknown()),
    z
      .object({
        value: z.unknown().optional(),
        path: z.string().optional(),
        default: z.unknown().optional(),
        defaultPath: z.string().optional(),
        envPath: z.string().optional(),
        envListPath: z.string().optional(),
        resolver: terraformValueResolverSchema.optional(),
        fromResource: z.string().optional(),
        output: z.string().optional(),
        state: z.string().optional(),
        optional: z.boolean().optional(),
        first: z.array(terraformValueSpecSchema).optional(),
      })
      .strict(),
  ]),
);

// ── Provider profile (provider-profiles/*) ───────────────────────────────────
export const providerProfileSchema = z
  .object({
    name: z.string().min(1),
    type: z.string().min(1),
  })
  .passthrough(); // region, vpcCidr, *Env indirection, proxmox endpoints, etc.

// ── Resource (terraform) profile (resource-profiles/*) ───────────────────────
export const resourceProfileSchema = z
  .object({
    name: z.string().min(1),
    provider: z.string().min(1),
    kind: z.string().min(1),
    terraform: z
      .object({
        stack: z.string().min(1),
        outputs: z
          .object({ providerResourceId: z.string().nullable().optional() })
          .passthrough()
          .optional(),
        environment: z.record(terraformValueSpecSchema).optional(),
        vars: z.record(terraformValueSpecSchema),
      })
      .strict(),
  })
  .strict();

// ── Deployment (deployments/*) ───────────────────────────────────────────────
const providerConfigSchema = z
  .object({ type: z.string().min(1) })
  .passthrough();

const placementSchema = z
  .object({
    provider: z.string().nullable().optional(),
    network: z.unknown().optional(),
  })
  .passthrough();

const resourceConfigSchema = z
  .object({
    kind: z.string().min(1),
    name: z.string().nullable().optional(),
    hostname: z.string().min(1),
    terraformProfile: z.string().nullable().optional(),
    placement: placementSchema.optional(), // broker enforces presence at deploy time
  })
  .passthrough(); // vm, bootstrap, license, applications, appProfiles, configProfiles…

const deploymentInputOptionSchema = z
  .object({
    label: z.string().optional(),
    value: z.union([z.string(), z.number(), z.boolean()]),
  })
  .strict();

const deploymentInputSchema = z
  .object({
    name: z.string().min(1),
    label: z.string().optional(),
    description: z.string().optional(),
    type: z.enum(["boolean", "string", "number"]),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    options: z.array(deploymentInputOptionSchema).optional(),
    appProfileGroup: z.string().optional(),
  })
  .strict();

const deploymentStepSchema = z
  .object({
    name: z.string().min(1),
    action: z.string().min(1),
    resourceAction: z.string().optional(),
    targets: z.array(z.string()).optional(),
    enabled: z.boolean().optional(),
    when: z
      .object({
        param: z.string().min(1),
        equals: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
      })
      .strict()
      .optional(),
    params: z.record(z.unknown()).optional(),
    description: z.string().optional(),
  })
  .strict();

export const deploymentConfigSchema = z
  .object({
    name: z.string().min(1),
    providerProfile: z.string().nullable().optional(),
    provider: providerConfigSchema,
    resources: z.array(resourceConfigSchema).min(1),
    inputs: z.array(deploymentInputSchema).optional(),
    steps: z.array(deploymentStepSchema).optional(),
    templateName: z.string().nullable().optional(),
    displayName: z.string().nullable().optional(),
  })
  .strict();

// ── App profiles (app-profiles/<group>/*) ────────────────────────────────────
const windowsApplicationSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().optional(),
    method: z.enum(["chocolatey", "exe", "msi", "powershell"]),
    package: z.string().optional(),
    url: z.string().optional(),
    sourcePath: z.string().optional(),
    args: z.array(z.string()).optional(),
    command: z.string().optional(),
    allowedExitCodes: z.array(z.number().int().nonnegative()).optional(),
    verify: z.object({ command: z.string() }).passthrough().optional(),
  })
  .passthrough();

export const windowsAppProfileSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    apps: z.array(windowsApplicationSchema),
  })
  .strict();

export const linuxAppProfileSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    packages: z.array(z.string()).optional(),
    commands: z.array(z.string()).optional(),
  })
  .strict();

// ── Config profiles (config-profiles/<group>/*) ──────────────────────────────
const configAddOnSchema = z
  .object({
    name: z.string().optional(),
    file: z.string().min(1),
    commit: z.boolean().optional(),
  })
  .passthrough();

export const configProfileSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    configAddOns: z.array(configAddOnSchema),
  })
  .strict();

/** App-profile schema keyed by group, for the generic app-profile loader/validator. */
export const appProfileSchemaByGroup: Record<string, z.ZodType<unknown>> = {
  windows: windowsAppProfileSchema,
  linux: linuxAppProfileSchema,
};

/** Config-profile schema keyed by group. */
export const configProfileSchemaByGroup: Record<string, z.ZodType<unknown>> = {
  "panw-vmseries": configProfileSchema,
};
