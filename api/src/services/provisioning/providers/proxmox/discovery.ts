import https from "node:https";
import type {
  DiscoveredNetwork,
  DiscoveredNode,
  DiscoveredStorage,
  DiscoveredTemplate,
  DiscoveredVm,
  ProxmoxApiResponse,
  ProxmoxConnection,
  ProxmoxDiagnostics,
  ProxmoxDiscovery,
  RawNetwork,
  RawNode,
  RawStorage,
  RawVm,
} from "../../types/proxmoxDiscovery.js";
import { requireEnv } from "../../utils/index.js";

export function proxmoxConnectionFromEnv(options: {
  endpointEnv?: string;
  apiTokenEnv?: string;
  insecure?: boolean;
} = {}): ProxmoxConnection {
  const endpointEnv = options.endpointEnv ?? "PROXMOX_VE_ENDPOINT";
  const apiTokenEnv = options.apiTokenEnv ?? "PROXMOX_VE_API_TOKEN";

  return {
    endpoint: requireEnv(endpointEnv),
    apiToken: requireEnv(apiTokenEnv),
    insecure: options.insecure ?? parseBool(process.env.PROXMOX_VE_INSECURE, true),
  };
}

export async function discoverProxmox(
  connection: ProxmoxConnection,
): Promise<ProxmoxDiscovery> {
  const errors: string[] = [];
  const rawNodes = await proxmoxGet<RawNode[]>(connection, "/nodes");
  const nodes: DiscoveredNode[] = [];

  for (const rawNode of rawNodes) {
    const nodeName = rawNode.node;
    const [rawStorages, rawNetworks, rawVms] = await Promise.all([
      proxmoxGetSafe<RawStorage[]>(connection, `/nodes/${encodeURIComponent(nodeName)}/storage`, errors),
      proxmoxGetSafe<RawNetwork[]>(connection, `/nodes/${encodeURIComponent(nodeName)}/network`, errors),
      proxmoxGetSafe<RawVm[]>(connection, `/nodes/${encodeURIComponent(nodeName)}/qemu`, errors),
    ]);

    const storages = rawStorages.map((storage) => normalizeStorage(nodeName, storage));
    const networks = rawNetworks.map((network) => normalizeNetwork(nodeName, network));
    const vms = rawVms.map((vm) => normalizeVm(nodeName, vm));
    const templates = vms.filter((vm): vm is DiscoveredTemplate => vm.template);

    nodes.push({
      name: nodeName,
      status: rawNode.status,
      cpu: rawNode.cpu,
      memoryBytes: rawNode.mem,
      maxMemoryBytes: rawNode.maxmem,
      storages,
      networks,
      vms,
      templates,
    });
  }

  const templates = nodes.flatMap((node) => node.templates);
  const usedVmIds = Array.from(
    new Set(nodes.flatMap((node) => node.vms.map((vm) => vm.vmid))),
  ).sort((left, right) => left - right);

  return {
    endpoint: redactEndpoint(connection.endpoint),
    nodes,
    templates,
    usedVmIds,
    recommendations: {
      targetNodes: nodes.filter((node) => node.status !== "offline").map((node) => node.name),
      templateVmIds: templates,
      isoDatastoresByNode: Object.fromEntries(
        nodes.map((node) => [
          node.name,
          node.storages.filter((storage) => storage.content.includes("iso")),
        ]),
      ),
      vmDatastoresByNode: Object.fromEntries(
        nodes.map((node) => [
          node.name,
          node.storages.filter((storage) => storage.content.includes("images")),
        ]),
      ),
      bridgesByNode: Object.fromEntries(
        nodes.map((node) => [
          node.name,
          node.networks.filter((network) => network.isBridge),
        ]),
      ),
    },
    errors,
    permissionHints: buildPermissionHints(nodes, templates),
  };
}

export async function diagnoseProxmox(
  connection: ProxmoxConnection,
): Promise<ProxmoxDiagnostics> {
  const [version, effectivePermissions, rawNodes] = await Promise.all([
    proxmoxGet<unknown>(connection, "/version"),
    proxmoxGet<Record<string, unknown>>(connection, "/access/permissions"),
    proxmoxGet<RawNode[]>(connection, "/nodes"),
  ]);
  const firstOnlineNode = rawNodes.find((node) => node.status !== "offline")?.node;

  if (!firstOnlineNode) {
    return {
      endpoint: redactEndpoint(connection.endpoint),
      version,
      effectivePermissions,
    };
  }

  const [storages, qemu, networks] = await Promise.all([
    proxmoxGet<unknown[]>(connection, `/nodes/${encodeURIComponent(firstOnlineNode)}/storage`),
    proxmoxGet<unknown[]>(connection, `/nodes/${encodeURIComponent(firstOnlineNode)}/qemu`),
    proxmoxGet<unknown[]>(connection, `/nodes/${encodeURIComponent(firstOnlineNode)}/network`),
  ]);

  return {
    endpoint: redactEndpoint(connection.endpoint),
    version,
    effectivePermissions,
    firstOnlineNode,
    sampleNodeInventory: {
      storages,
      qemu,
      networks,
    },
  };
}

async function proxmoxGetSafe<T>(
  connection: ProxmoxConnection,
  apiPath: string,
  errors: string[],
): Promise<T> {
  try {
    return await proxmoxGet<T>(connection, apiPath);
  } catch (error) {
    errors.push(`${apiPath}: ${error instanceof Error ? error.message : String(error)}`);
    return [] as T;
  }
}

async function proxmoxGet<T>(
  connection: ProxmoxConnection,
  apiPath: string,
): Promise<T> {
  const endpoint = connection.endpoint.replace(/\/+$/, "");
  const url = new URL(`/api2/json${apiPath}`, endpoint);

  return await new Promise<T>((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "GET",
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

function normalizeStorage(node: string, storage: RawStorage): DiscoveredStorage {
  return {
    node,
    storage: storage.storage,
    type: storage.type,
    content: storage.content?.split(",").map((item) => item.trim()).filter(Boolean) ?? [],
    active: numberToBool(storage.active),
    enabled: numberToBool(storage.enabled),
    shared: numberToBool(storage.shared),
    availableBytes: storage.avail,
    totalBytes: storage.total,
  };
}

function normalizeNetwork(node: string, network: RawNetwork): DiscoveredNetwork {
  return {
    node,
    iface: network.iface,
    type: network.type,
    active: numberToBool(network.active),
    autostart: numberToBool(network.autostart),
    bridgePorts: network.bridge_ports,
    address: network.address,
    cidr: network.cidr,
    gateway: network.gateway,
    vlanAware: numberToBool(network.vlan_aware),
    isBridge: network.type === "bridge" || network.iface.startsWith("vmbr"),
  };
}

function normalizeVm(node: string, vm: RawVm): DiscoveredVm | DiscoveredTemplate {
  return {
    node,
    vmid: vm.vmid,
    name: vm.name,
    status: vm.status,
    template: vm.template === 1,
  } as DiscoveredVm | DiscoveredTemplate;
}

function buildPermissionHints(
  nodes: DiscoveredNode[],
  templates: DiscoveredTemplate[],
): string[] {
  const hints: string[] = [];
  const onlineNodes = nodes.filter((node) => node.status !== "offline");

  if (onlineNodes.length > 0 && onlineNodes.every((node) => node.storages.length === 0)) {
    hints.push(
      "No storage inventory was returned. The token likely needs a role with Datastore.Audit, such as PVEAuditor with propagation, on the relevant path.",
    );
  }

  if (onlineNodes.length > 0 && onlineNodes.every((node) => node.vms.length === 0)) {
    hints.push(
      "No QEMU VM/template inventory was returned. The token likely needs VM.Audit, such as PVEAuditor with propagation, on /vms or /.",
    );
  }

  if (onlineNodes.length > 0 && onlineNodes.every((node) => !node.networks.some((network) => network.isBridge))) {
    hints.push(
      "No Linux bridges were returned. If bridges exist in the Proxmox UI, the token likely needs Sys.Audit on the nodes.",
    );
  }

  if (templates.length === 0) {
    hints.push(
      "No template candidates were found. After permissions are fixed, make sure the PANW VM-Series source VM is converted to a Proxmox template.",
    );
  }

  return hints;
}

function numberToBool(value?: number): boolean | undefined {
  if (value === undefined) return undefined;
  return value === 1;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function redactEndpoint(endpoint: string): string {
  const url = new URL(endpoint);
  url.username = "";
  url.password = "";
  return url.toString();
}
