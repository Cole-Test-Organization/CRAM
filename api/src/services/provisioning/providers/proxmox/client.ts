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
): Promise<T> {
  return await proxmoxRequest<T>(connection, "POST", apiPath);
}

async function proxmoxRequest<T>(
  connection: ProxmoxConnection,
  method: "GET" | "POST",
  apiPath: string,
): Promise<T> {
  const endpoint = connection.endpoint.replace(/\/+$/, "");
  const url = new URL(`/api2/json${apiPath}`, endpoint);

  return await new Promise<T>((resolve, reject) => {
    const request = https.request(
      url,
      {
        method,
        headers: {
          Authorization: `PVEAPIToken=${connection.apiToken}`,
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
    request.end();
  });
}
