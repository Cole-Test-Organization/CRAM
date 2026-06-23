import { readFile, mkdir, writeFile } from "node:fs/promises";
import { get as httpsGet } from "node:https";
import { homedir } from "node:os";
import path from "node:path";
import { projectRoot, resolveProjectPath, toProjectRelativePath, workDir } from "../utils/paths.js";
import type {
  DeploymentConfig,
  ResourceConfig,
  ResourceRecord,
  TerraformRunContext,
  TerraformResourceProfile,
  TerraformValueResolver,
  TerraformValueSpec,
} from "../types/index.js";
import type { LogFn } from "../types/logging.js";
import { captureCommand, ensureDir, optionalEnv, requireEnv, runCommand } from "../utils/index.js";
import type { ProviderApplyResult, ProviderResourceContext } from "../types/providerAdapter.js";

export class TerraformRunner {
  async apply<TResource extends ResourceConfig>(
    context: ProviderResourceContext<TResource>,
    log: LogFn,
  ): Promise<ProviderApplyResult> {
    return await applyTerraformResource(context, log);
  }

  async destroy<TResource extends ResourceConfig>(
    context: ProviderResourceContext<TResource>,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<void> {
    await destroyTerraformResource(context, record, log);
  }

  async readOutputs<TResource extends ResourceConfig>(
    context: ProviderResourceContext<TResource>,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<Record<string, unknown>> {
    return await readTerraformResourceOutputs(context, record, log);
  }
}

export async function applyTerraformResource<TResource extends ResourceConfig>(
  context: ProviderResourceContext<TResource>,
  log: LogFn,
): Promise<ProviderApplyResult> {
  const profile = await context.configLoader.loadTerraformResourceProfile(
    context.deployment,
    context.resource,
  );
  assertProfileMatches(profile, context.deployment, context.resource);

  const tfWorkDir = path.join(workDir, context.resource.hostname, "terraform");
  await ensureDir(tfWorkDir);

  const varsPath = path.join(tfWorkDir, "terraform.tfvars.json");
  const statePath = path.join(tfWorkDir, "terraform.tfstate");
  const vars = await resolveTerraformVars(profile, context);
  await writeFile(
    varsPath,
    `${JSON.stringify(vars, null, 2)}\n`,
  );

  const env = withPgBackend(await resolveTerraformEnv(profile, context, tfWorkDir));
  const workspace = terraformWorkspace(context.deployment.name, context.resource.hostname);
  await terraformInit(profile.terraform.stack, env, log);
  await terraformSelectWorkspace(profile.terraform.stack, workspace, env, log);
  await runCommand(
    "terraform",
    [
      `-chdir=${profile.terraform.stack}`,
      "apply",
      "-input=false",
      "-auto-approve",
      `-var-file=${varsPath}`,
    ],
    {
      cwd: projectRoot,
      env,
      log,
    },
  );

  const outputJson = await captureCommand(
    "terraform",
    [`-chdir=${profile.terraform.stack}`, "output", "-json"],
    {
      cwd: projectRoot,
      env,
      log,
    },
  );
  const outputs = parseTerraformOutputs(outputJson);

  return {
    providerResourceId: resolveOutputPath(outputs, profile.terraform.outputs?.providerResourceId),
    // State lives in the Terraform pg backend now, one workspace per resource. The
    // workspace name is persisted in the terraformStatePath field (mapped to the
    // terraform_workspace column) transitionally.
    terraformStatePath: workspace,
    outputs,
  };
}

const TF_STATE_SCHEMA = "terraform_state";

// Terraform pg backend: state lives in Postgres (schema terraform_state), one
// workspace per resource — replacing the per-resource -state=<file> the broker used,
// so any replica can read/lock state and `destroy` survives a restart. The connection
// string is passed via env (PG_CONN_STR), never on the command line, so it can't leak
// into job logs.
export function withPgBackend(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const conn = process.env.PROVISIONING_TF_PG_CONN ?? process.env.DATABASE_URL;
  if (!conn) {
    throw new Error("Set PROVISIONING_TF_PG_CONN or DATABASE_URL for the Terraform pg backend");
  }
  return { ...env, PG_CONN_STR: conn, PG_SCHEMA_NAME: TF_STATE_SCHEMA };
}

export function terraformWorkspace(deploymentName: string, hostname: string): string {
  return `${deploymentName}__${hostname}`.replace(/[^A-Za-z0-9_-]/g, "-");
}

export async function terraformInit(stack: string, env: NodeJS.ProcessEnv, log?: LogFn): Promise<void> {
  // -reconfigure so a stack that previously used local state adopts the pg backend.
  await runCommand("terraform", [`-chdir=${stack}`, "init", "-input=false", "-reconfigure"], {
    cwd: projectRoot,
    env,
    log,
  });
}

export async function terraformSelectWorkspace(
  stack: string,
  workspace: string,
  env: NodeJS.ProcessEnv,
  log?: LogFn,
): Promise<void> {
  // -or-create requires Terraform >= 1.4.
  await runCommand("terraform", [`-chdir=${stack}`, "workspace", "select", "-or-create", workspace], {
    cwd: projectRoot,
    env,
    log,
  });
}

export async function destroyTerraformResource<TResource extends ResourceConfig>(
  context: ProviderResourceContext<TResource>,
  record: ResourceRecord,
  log: LogFn,
): Promise<void> {
  const profile = await context.configLoader.loadTerraformResourceProfile(
    context.deployment,
    context.resource,
  );
  assertProfileMatches(profile, context.deployment, context.resource);

  const workspace = record.terraformStatePath ?? terraformWorkspace(context.deployment.name, context.resource.hostname);
  if (!record.terraformStatePath) {
    log(`No Terraform workspace recorded for ${record.hostname}; using expected workspace ${workspace}.`);
  }
  const tfWorkDir = path.join(workDir, context.resource.hostname, "terraform");
  const varsPath = path.join(tfWorkDir, "terraform.tfvars.json");
  await mkdir(tfWorkDir, { recursive: true });
  const vars = await resolveTerraformVars(profile, context);
  await writeFile(
    varsPath,
    `${JSON.stringify(vars, null, 2)}\n`,
  );

  const env = withPgBackend(await resolveTerraformEnv(profile, context, tfWorkDir));
  await terraformInit(profile.terraform.stack, env, log);
  await terraformSelectWorkspace(profile.terraform.stack, workspace, env, log);
  await runCommand(
    "terraform",
    [
      `-chdir=${profile.terraform.stack}`,
      "destroy",
      "-input=false",
      "-auto-approve",
      `-var-file=${varsPath}`,
    ],
    {
      cwd: projectRoot,
      env,
      log,
    },
  );
}

export async function readTerraformResourceOutputs<TResource extends ResourceConfig>(
  context: ProviderResourceContext<TResource>,
  record: ResourceRecord,
  log: LogFn,
): Promise<Record<string, unknown>> {
  const profile = await context.configLoader.loadTerraformResourceProfile(
    context.deployment,
    context.resource,
  );
  assertProfileMatches(profile, context.deployment, context.resource);

  const workspace = record.terraformStatePath ?? terraformWorkspace(context.deployment.name, context.resource.hostname);
  if (!record.terraformStatePath) {
    log(`No Terraform workspace recorded for ${record.hostname}; using expected workspace ${workspace}.`);
  }
  const tfWorkDir = path.join(workDir, context.resource.hostname, "terraform");
  const env = withPgBackend(await resolveTerraformEnv(profile, context, tfWorkDir));
  await terraformInit(profile.terraform.stack, env, log);
  await terraformSelectWorkspace(profile.terraform.stack, workspace, env, log);
  const outputJson = await captureCommand(
    "terraform",
    [`-chdir=${profile.terraform.stack}`, "output", "-json"],
    {
      cwd: projectRoot,
      env,
      log,
    },
  );

  return parseTerraformOutputs(outputJson);
}

function assertProfileMatches(
  profile: TerraformResourceProfile,
  deployment: DeploymentConfig,
  resource: ResourceConfig,
): void {
  if (profile.provider !== deployment.provider.type) {
    throw new Error(
      `Terraform profile ${profile.name} is for provider ${profile.provider}, not ${deployment.provider.type}`,
    );
  }
  if (profile.kind !== resource.kind) {
    throw new Error(
      `Terraform profile ${profile.name} is for resource kind ${profile.kind}, not ${resource.kind}`,
    );
  }
}

async function resolveTerraformVars<TResource extends ResourceConfig>(
  profile: TerraformResourceProfile,
  context: ProviderResourceContext<TResource>,
): Promise<Record<string, unknown>> {
  const runContext = toRunContext(context);
  const entries = await Promise.all(
    Object.entries(profile.terraform.vars).map(async ([name, spec]) => [
      name,
      await resolveValue(spec, runContext, name),
    ]),
  );
  return Object.fromEntries(entries);
}

async function resolveTerraformEnv<TResource extends ResourceConfig>(
  profile: TerraformResourceProfile,
  context: ProviderResourceContext<TResource>,
  tfWorkDir: string,
): Promise<NodeJS.ProcessEnv> {
  const runContext = toRunContext(context);
  const env: NodeJS.ProcessEnv = {
    TF_DATA_DIR: path.join(tfWorkDir, ".terraform"),
  };

  for (const [name, spec] of Object.entries(profile.terraform.environment ?? {})) {
    const value = await resolveValue(spec, runContext, name);
    if (value === null || value === undefined || value === "") continue;
    if (typeof value !== "string") throw new Error(`Terraform environment ${name} must resolve to a string`);
    env[name] = value;
  }

  return env;
}

function toRunContext<TResource extends ResourceConfig>(
  context: ProviderResourceContext<TResource>,
): TerraformRunContext<TResource> {
  return {
    configPath: context.configPath,
    configLoader: context.configLoader,
    stateRepository: context.stateRepository,
    deployment: context.deployment,
    provider: context.deployment.provider,
    resource: context.resource,
    placement: context.resource.placement,
  };
}

async function resolveValue(
  spec: TerraformValueSpec,
  context: TerraformRunContext<ResourceConfig>,
  name: string,
  allowMissing = false,
): Promise<unknown> {
  if (!isSpecObject(spec)) return spec;

  if (spec.first) {
    let fallbackValue: unknown = null;
    for (const candidate of spec.first) {
      const value = await resolveValue(candidate, context, name, true);
      fallbackValue = value;
      if (value !== null && value !== undefined && value !== "") return value;
    }
    return fallbackValue ?? null;
  }

  if ("value" in spec) return spec.value;
  if (spec.fromResource) return await resolveResourceReference(spec, context, name);

  let value: unknown = undefined;
  if (spec.resolver) {
    value = await resolveDynamicValue(spec.resolver);
  } else if (spec.envPath) {
    const envName = resolveStringPath(spec.envPath, context, name, spec.optional || allowMissing);
    value = envName ? (spec.optional || allowMissing ? optionalEnv(envName) : requireEnv(envName)) : undefined;
  } else if (spec.envListPath) {
    const envName = resolveStringPath(spec.envListPath, context, name, spec.optional || allowMissing);
    const raw = envName ? (allowMissing ? optionalEnv(envName) : requireEnv(envName)) : undefined;
    value = raw ? parseEnvList(raw) : undefined;
  } else if (spec.path) {
    value = getPath(context, spec.path);
  }

  const hasDefault = "default" in spec;
  if ((value === undefined || value === null || value === "") && spec.defaultPath) {
    value = getPath(context, spec.defaultPath);
  }
  if ((value === undefined || value === null || value === "") && hasDefault) {
    value = spec.default;
  }
  if (isReferenceValue(value)) {
    value = await resolveResourceReference(value, context, name);
  }
  if (
    (value === undefined || value === null || value === "") &&
    !spec.optional &&
    !hasDefault &&
    !allowMissing
  ) {
    throw new Error(`Terraform value ${name} did not resolve from profile mapping`);
  }

  return value ?? null;
}

async function resolveResourceReference(
  spec: { fromResource?: string; output?: string; state?: string },
  context: TerraformRunContext<ResourceConfig>,
  name: string,
): Promise<unknown> {
  const fromResource = spec.fromResource;
  if (!fromResource) throw new Error(`Terraform value ${name} has an empty fromResource reference`);
  const targetResource = context.deployment.resources.find(
    (candidate) => candidate.hostname === fromResource || candidate.name === fromResource,
  );
  const targetHostname = targetResource?.hostname ?? fromResource;
  const record = await resolveReferencedResourceRecord(context, targetResource, targetHostname, fromResource);
  if (!record) {
    throw new Error(`Terraform value ${name} references ${fromResource}, but no broker state record exists for it`);
  }

  if (spec.state) {
    const value = getPath(record, spec.state);
    if (value === undefined || value === null || value === "") {
      throw new Error(`Terraform value ${name} reference ${fromResource}.state.${spec.state} is empty`);
    }
    return value;
  }

  if (spec.output) {
    const outputs = record.outputs ?? await readReferencedTerraformOutputs(context, targetResource, record);
    const value = getPath(outputs, spec.output);
    if (value === undefined || value === null || value === "") {
      throw new Error(`Terraform value ${name} reference ${fromResource}.output.${spec.output} is empty`);
    }
    return value;
  }

  throw new Error(`Terraform value ${name} reference ${fromResource} must specify output or state`);
}

async function resolveReferencedResourceRecord(
  context: TerraformRunContext<ResourceConfig>,
  targetResource: ResourceConfig | undefined,
  targetHostname: string,
  fromResource: string,
): Promise<ResourceRecord | null> {
  const records = await context.stateRepository.listResources();
  const matches = records.filter((record) => (
    record.hostname === targetHostname ||
    record.hostname === fromResource ||
    Boolean(targetResource?.name && record.name === targetResource.name) ||
    record.name === fromResource
  ));

  const sameDeployment = matches.filter((record) => record.deploymentId === context.deployment.name);
  const sameConfig = sameDeployment.filter((record) => sameConfigPath(record.configPath, context.configPath));
  return (
    sameConfig.find((record) => record.lifecycleStatus !== "destroyed") ??
    sameConfig[0] ??
    sameDeployment.find((record) => record.lifecycleStatus !== "destroyed") ??
    sameDeployment[0] ??
    await context.stateRepository.getResource(targetHostname)
  );
}

function sameConfigPath(left: string, right: string): boolean {
  return (toProjectRelativePath(left) ?? left) === (toProjectRelativePath(right) ?? right);
}

async function readReferencedTerraformOutputs(
  context: TerraformRunContext<ResourceConfig>,
  targetResource: ResourceConfig | undefined,
  record: ResourceRecord,
): Promise<Record<string, unknown>> {
  if (!targetResource) {
    throw new Error(`Cannot read Terraform outputs for ${record.hostname}: resource is not in deployment config`);
  }

  const profile = await context.configLoader.loadTerraformResourceProfile(
    context.deployment,
    targetResource,
  );
  const workspace = record.terraformStatePath ?? terraformWorkspace(context.deployment.name, targetResource.hostname);
  const tfWorkDir = path.join(workDir, targetResource.hostname, "terraform");
  const env = withPgBackend(await resolveTerraformEnv(profile, {
    configPath: context.configPath,
    configLoader: context.configLoader,
    stateRepository: context.stateRepository,
    deployment: context.deployment,
    resource: targetResource,
  }, tfWorkDir));
  await terraformInit(profile.terraform.stack, env);
  await terraformSelectWorkspace(profile.terraform.stack, workspace, env);
  const outputJson = await captureCommand(
    "terraform",
    [`-chdir=${profile.terraform.stack}`, "output", "-json"],
    {
      cwd: projectRoot,
      env,
    },
  );
  return parseTerraformOutputs(outputJson);
}

async function resolveDynamicValue(resolver: TerraformValueResolver): Promise<unknown> {
  switch (resolver) {
    case "currentPublicIpCidrList": {
      const ip = (await fetchText("https://checkip.amazonaws.com/")).trim();
      if (!isIpv4Address(ip)) {
        throw new Error(`Current public IP resolver returned a non-IPv4 value: ${ip}`);
      }
      return [`${ip}/32`];
    }
    case "localSshPublicKey": {
      const publicKey = process.env.PANOS_SSH_PUBLIC_KEY?.trim();
      if (publicKey) return publicKey;

      const candidates = [
        process.env.PANOS_SSH_PUBLIC_KEY_FILE,
        process.env.PANOS_SSH_PRIVATE_KEY ? `${process.env.PANOS_SSH_PRIVATE_KEY}.pub` : null,
        path.join(homedir(), ".ssh", "panw-broker-bootstrap.pub"),
        path.join(homedir(), ".ssh", "id_rsa.pub"),
      ].filter((candidate): candidate is string => Boolean(candidate));

      for (const publicKeyPath of candidates) {
        try {
          const filePublicKey = (await readFile(publicKeyPath, "utf8")).trim();
          if (!filePublicKey) throw new Error(`${publicKeyPath} is empty`);
          return filePublicKey;
        } catch (error) {
          if (!isMissingFileError(error)) throw error;
        }
      }

      throw new Error(`Could not find a local SSH public key. Checked: ${candidates.join(", ")}`);
    }
    default:
      throw new Error(`Unknown Terraform value resolver ${String(resolver)}`);
  }
}

async function fetchText(url: string, timeoutMs = 10_000): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const request = httpsGet(url, { timeout: timeoutMs }, (response) => {
      const statusCode = response.statusCode ?? 0;
      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new Error(`GET ${url} returned HTTP ${statusCode}`));
        return;
      }

      response.setEncoding("utf8");
      let body = "";
      response.on("data", (chunk: string) => {
        body += chunk;
      });
      response.on("end", () => resolve(body));
    });

    request.on("timeout", () => {
      request.destroy(new Error(`Timed out resolving current public IP from ${url}`));
    });
    request.on("error", reject);
  });
}

function isIpv4Address(value: string): boolean {
  const octets = value.split(".");
  return (
    octets.length === 4 &&
    octets.every((octet) => {
      if (!/^\d+$/.test(octet)) return false;
      const parsed = Number(octet);
      return parsed >= 0 && parsed <= 255;
    })
  );
}

function resolveStringPath(
  pathValue: string,
  context: TerraformRunContext<ResourceConfig>,
  name: string,
  allowMissing = false,
): string {
  const value = getPath(context, pathValue);
  if (typeof value !== "string" || !value) {
    if (allowMissing) return "";
    throw new Error(`Terraform value ${name} expected ${pathValue} to resolve to a string`);
  }
  return value;
}

function parseEnvList(raw: string): string[] {
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
  } catch {
    // Fall through to comma/whitespace splitting.
  }

  const values = trimmed
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (!values.length) throw new Error("Environment list value must contain at least one item");
  return values;
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT",
  );
}

function parseTerraformOutputs(outputJson: string): Record<string, unknown> {
  const parsed = JSON.parse(outputJson) as Record<string, { value: unknown }>;
  return Object.fromEntries(Object.entries(parsed).map(([name, output]) => [name, output.value]));
}

function resolveOutputPath(outputs: Record<string, unknown>, pathValue?: string | null): string | null {
  if (!pathValue) return null;
  const value = getPath(outputs, pathValue);
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`Terraform output ${pathValue} must resolve to a string or number`);
  }
  return String(value);
}

function getPath(root: unknown, pathValue: string): unknown {
  return pathValue.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[key];
  }, root);
}

function isSpecObject(
  value: TerraformValueSpec,
): value is Exclude<TerraformValueSpec, null | string | number | boolean | unknown[]> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isReferenceValue(value: unknown): value is { fromResource: string; output?: string; state?: string } {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (value as { fromResource?: unknown }).fromResource === "string",
  );
}
