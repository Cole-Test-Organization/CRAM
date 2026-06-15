import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import type {
  BaseResourceConfig,
  ResourceRecord,
} from "../../types/index.js";
import type { LogFn } from "../../types/logging.js";
import { nowIso } from "../../utils/index.js";
import { GenericTerraformResourceAdapter } from "../genericTerraformResourceAdapter.js";
import type {
  ResourceActionRequest,
  ResourceAdapter,
  ResourceAdapterContext,
  ResourceUpResult,
} from "../types.js";

interface EksClusterResourceConfig extends BaseResourceConfig {
  kind: "eks-cluster";
  app?: {
    verifyPath?: unknown;
    verifyTimeoutSeconds?: unknown;
  };
}

interface HttpResult {
  statusCode: number;
  body: string;
}

export class EksClusterResourceAdapter implements ResourceAdapter<EksClusterResourceConfig> {
  readonly kind = "eks-cluster";

  constructor(
    private readonly terraformResource = new GenericTerraformResourceAdapter<EksClusterResourceConfig>(),
  ) {}

  async up(
    context: ResourceAdapterContext<EksClusterResourceConfig>,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<ResourceUpResult> {
    return await this.terraformResource.up(context, record, log);
  }

  async down(
    context: ResourceAdapterContext<EksClusterResourceConfig>,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<void> {
    await this.terraformResource.down(context, record, log);
  }

  async runAction(
    context: ResourceAdapterContext<EksClusterResourceConfig>,
    record: ResourceRecord,
    request: ResourceActionRequest,
    log: LogFn,
  ): Promise<Partial<ResourceRecord>> {
    if (request.action !== "verify-http-200") {
      throw new Error(`EKS cluster action ${request.action} is not supported`);
    }

    const outputs = record.outputs ?? await context.terraform.readOutputs(context, record, log);
    const healthUrl = resolveHealthUrl(outputs, context.resource, request);
    const timeoutSeconds = resolveTimeoutSeconds(outputs, context.resource, request);
    const result = await waitForHttp200(healthUrl, timeoutSeconds, log);
    log(`EKS application verification succeeded: ${healthUrl} returned HTTP ${result.statusCode}`);
    if (result.body.trim()) {
      log(`EKS application response body: ${truncate(result.body.trim(), 500)}`);
    }

    return {
      outputs: {
        ...outputs,
        app: {
          ...objectValue(outputs.app),
          verified_url: healthUrl,
          verified_status_code: result.statusCode,
          verified_at: nowIso(),
        },
      },
    };
  }
}

function resolveHealthUrl(
  outputs: Record<string, unknown>,
  resource: EksClusterResourceConfig,
  request: ResourceActionRequest,
): string {
  const params = objectValue(request.params);
  const explicitUrl = stringValue(params.url);
  if (explicitUrl) return explicitUrl;

  const app = objectValue(outputs.app);
  const healthUrl = stringValue(app.health_url);
  if (healthUrl) return healthUrl;

  const baseUrl = stringValue(app.url);
  if (!baseUrl) {
    throw new Error("EKS Terraform outputs do not include app.health_url or app.url");
  }

  const path = stringValue(params.path) ?? stringValue(resource.app?.verifyPath) ?? "/healthz";
  return `${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

function resolveTimeoutSeconds(
  outputs: Record<string, unknown>,
  resource: EksClusterResourceConfig,
  request: ResourceActionRequest,
): number {
  const params = objectValue(request.params);
  return (
    positiveNumber(params.timeoutSeconds) ??
    positiveNumber(objectValue(outputs.app).verify_timeout_seconds) ??
    positiveNumber(resource.app?.verifyTimeoutSeconds) ??
    900
  );
}

async function waitForHttp200(
  url: string,
  timeoutSeconds: number,
  log: LogFn,
): Promise<HttpResult> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let lastError = "";

  while (Date.now() < deadline) {
    try {
      const result = await httpRequest(url, 15_000);
      if (result.statusCode === 200) return result;
      lastError = `HTTP ${result.statusCode}: ${truncate(result.body.trim(), 200)}`;
      log(`Waiting for EKS application HTTP 200 from ${url}; latest response was ${lastError}`);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      log(`Waiting for EKS application HTTP 200 from ${url}; latest error was ${lastError}`);
    }

    await sleep(Math.min(15_000, Math.max(0, deadline - Date.now())));
  }

  throw new Error(`Timed out after ${timeoutSeconds}s waiting for ${url} to return HTTP 200: ${lastError}`);
}

async function httpRequest(url: string, timeoutMs: number): Promise<HttpResult> {
  const parsed = new URL(url);
  const get = parsed.protocol === "https:" ? httpsGet : httpGet;

  return await new Promise<HttpResult>((resolve, reject) => {
    const request = get(parsed, { timeout: timeoutMs }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        if (body.length < 8192) body += chunk;
      });
      response.on("end", () => {
        resolve({
          statusCode: response.statusCode ?? 0,
          body,
        });
      });
    });

    request.on("timeout", () => {
      request.destroy(new Error(`Timed out after ${timeoutMs}ms`));
    });
    request.on("error", reject);
  });
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
