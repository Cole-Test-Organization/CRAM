import https from "node:https";
import { requireEnv } from "../../utils/index.js";
import type { ProxmoxFirewallRuntimeConfig } from "../../types/index.js";
import type { ProxmoxApiResponse, ProxmoxConnection } from "../../types/proxmoxClient.js";

export function proxmoxConnectionFromRuntimeConfig(
  config: ProxmoxFirewallRuntimeConfig,
): ProxmoxConnection {
  return {
    endpoint: requireEnv(config.endpointEnv),
    apiToken: requireEnv(config.apiTokenEnv),
    insecure: config.insecure,
  };
}

export async function proxmoxGet<T>(
  connection: ProxmoxConnection,
  apiPath: string,
): Promise<T> {
  return await proxmoxRequest<T>(connection, "GET", apiPath);
}

export async function proxmoxPost<T>(
  connection: ProxmoxConnection,
  apiPath: string,
  form?: ProxmoxForm,
): Promise<T> {
  return await proxmoxRequest<T>(connection, "POST", apiPath, form);
}

async function proxmoxRequest<T>(
  connection: ProxmoxConnection,
  method: "GET" | "POST",
  apiPath: string,
  form?: ProxmoxForm,
): Promise<T> {
  const endpoint = connection.endpoint.replace(/\/+$/, "");
  const url = new URL(`/api2/json${apiPath}`, endpoint);
  const body = form ? encodeProxmoxForm(form) : "";

  return await new Promise<T>((resolve, reject) => {
    const request = https.request(
      url,
      {
        method,
        headers: {
          Authorization: `PVEAPIToken=${connection.apiToken}`,
          ...(body ? {
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": Buffer.byteLength(body),
          } : {}),
        },
        rejectUnauthorized: !(connection.insecure ?? false),
        timeout: 15_000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if ((response.statusCode ?? 500) >= 400) {
            reject(new Error(`${response.statusCode}: ${body}`));
            return;
          }

          try {
            const parsed = JSON.parse(body) as ProxmoxApiResponse<T>;
            resolve(parsed.data);
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    request.on("timeout", () => {
      request.destroy(new Error(`Timed out calling ${url.origin}${url.pathname}`));
    });
    request.on("error", reject);
    request.end(body || undefined);
  });
}

type ProxmoxFormScalar = string | number | boolean;
type ProxmoxForm = Record<string, ProxmoxFormScalar | readonly ProxmoxFormScalar[]>;

function encodeProxmoxForm(form: ProxmoxForm): string {
  const params = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(form)) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) params.append(key, String(value));
  }
  return params.toString();
}
