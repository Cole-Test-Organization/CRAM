import net, { type Server, type Socket } from "node:net";
import type { ResourceRecord } from "./types/index.js";
import type { LogFn } from "./types/logging.js";
import type {
  ProviderPortForward,
  ProviderPortForwardRequest,
} from "./types/providerAdapter.js";

/**
 * Opens a provider-managed port-forward for a resource. Implemented by the
 * ResourceBroker; the provider adapter owns the actual transport (e.g. AWS SSM),
 * so this manager stays cloud-agnostic — it only does ports, proxying and TTLs.
 */
export interface ResourcePortForwarder {
  openResourcePortForward(
    record: ResourceRecord,
    request: ProviderPortForwardRequest,
    log?: LogFn,
  ): Promise<ProviderPortForward>;
}

const DEFAULT_PUBLIC_PORTS = "13389-13399";
const DEFAULT_INTERNAL_PORTS = "23389-23399";
const DEFAULT_REMOTE_PORT = 3389;
const DEFAULT_TTL_SECONDS = 8 * 60 * 60;
const TCP_WAIT_MS = 30_000;

export interface RdpTunnelOpenOptions {
  port?: number | null;
  remotePort?: number | null;
  ttlSeconds?: number | null;
  advertisedHost?: string | null;
}

export interface RdpTunnelView {
  id: string;
  resourceId: string;
  hostname: string;
  providerResourceId: string;
  status: "opening" | "running" | "closed";
  bindAddress: string;
  advertisedHost: string;
  publicPort: number;
  internalPort: number;
  remotePort: number;
  rdpEndpoint: string;
  username: string | null;
  startedAt: string;
  expiresAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
  logs: string[];
}

interface RdpTunnelRecord extends RdpTunnelView {
  forward: ProviderPortForward | null;
  proxy: Server;
  ttlTimer: NodeJS.Timeout | null;
}

export class RdpTunnelManager {
  constructor(private readonly forwarder: ResourcePortForwarder) {}

  private readonly publicPorts = parsePortList(
    process.env.PROVISIONING_RDP_TUNNEL_PORTS,
    DEFAULT_PUBLIC_PORTS,
  );
  private readonly internalPorts = parsePortList(
    process.env.PROVISIONING_RDP_TUNNEL_INTERNAL_PORTS,
    DEFAULT_INTERNAL_PORTS,
  );
  private readonly bindAddress = process.env.PROVISIONING_RDP_TUNNEL_BIND_ADDRESS || "0.0.0.0";
  private readonly configuredAdvertisedHost =
    normalizeAdvertisedHost(process.env.PROVISIONING_RDP_TUNNEL_HOST) ||
    normalizeAdvertisedHost(process.env.PROVISIONING_BROKER_HOST);
  private readonly fallbackAdvertisedHost = this.configuredAdvertisedHost ?? fallbackAdvertisedHost(this.bindAddress);
  private readonly defaultTtlSeconds = parsePositiveInteger(
    process.env.PROVISIONING_RDP_TUNNEL_TTL_SECONDS,
    DEFAULT_TTL_SECONDS,
  );
  private readonly tunnels = new Map<string, RdpTunnelRecord>();

  list(): RdpTunnelView[] {
    return [...this.tunnels.values()].map(toView);
  }

  async open(resource: ResourceRecord, options: RdpTunnelOpenOptions = {}): Promise<RdpTunnelView> {
    const existing = this.findByResource(resource.id) ?? this.findByResource(resource.hostname);
    if (existing?.status === "running" || existing?.status === "opening") {
      return toView(existing);
    }

    if (resource.lifecycleStatus === "destroyed") {
      throw httpError(409, `${resource.hostname} has been destroyed`);
    }
    if (resource.kind !== "windows-endpoint") {
      throw httpError(400, `${resource.hostname} is not a Windows endpoint`);
    }
    if (!resource.providerResourceId) {
      throw httpError(400, `${resource.hostname} has not been provisioned yet (no provider resource id)`);
    }
    if (!this.publicPorts.length || !this.internalPorts.length) {
      throw httpError(500, "RDP tunnel port pools are empty");
    }

    const publicPort = await this.selectPublicPort(options.port ?? null);
    const internalPort = await this.selectInternalPort();
    const remotePort = sanitizePort(options.remotePort ?? DEFAULT_REMOTE_PORT, "remotePort");
    const ttlSeconds = options.ttlSeconds == null
      ? this.defaultTtlSeconds
      : sanitizeNonNegativeInteger(options.ttlSeconds, "ttlSeconds");
    const advertisedHost = this.configuredAdvertisedHost ??
      normalizeAdvertisedHost(options.advertisedHost) ??
      this.fallbackAdvertisedHost;
    const id = `rdp_${safeId(resource.hostname)}`;
    const startedAt = new Date().toISOString();
    const expiresAt = ttlSeconds > 0
      ? new Date(Date.now() + ttlSeconds * 1000).toISOString()
      : null;
    const username = extractRdpUsername(resource.outputs);

    const proxy = createProxyServer(internalPort);
    const tunnel: RdpTunnelRecord = {
      id,
      resourceId: resource.id,
      hostname: resource.hostname,
      providerResourceId: resource.providerResourceId,
      status: "opening",
      bindAddress: this.bindAddress,
      advertisedHost,
      publicPort,
      internalPort,
      remotePort,
      rdpEndpoint: `${formatEndpointHost(advertisedHost)}:${publicPort}`,
      username,
      startedAt,
      expiresAt,
      closedAt: null,
      closeReason: null,
      logs: [],
      forward: null,
      proxy,
      ttlTimer: null,
    };
    this.tunnels.set(id, tunnel);

    try {
      // The provider adapter owns the transport (e.g. AWS SSM) and forwards the
      // remote port to 127.0.0.1:internalPort; we just proxy the public port to it.
      const forward = await this.forwarder.openResourcePortForward(
        resource,
        {
          remotePort,
          localPort: internalPort,
          onExit: (reason) => {
            if (tunnel.status !== "closed") {
              void this.stop(tunnel, reason, { closeForward: false });
            }
          },
        },
        (line) => appendLog(tunnel, line),
      );
      tunnel.forward = forward;

      await waitForTcp("127.0.0.1", internalPort, TCP_WAIT_MS, () => forward.closed);
      await listen(proxy, publicPort, this.bindAddress);
      tunnel.status = "running";
      if (ttlSeconds > 0) {
        tunnel.ttlTimer = setTimeout(() => {
          void this.stop(tunnel, "ttl expired");
        }, ttlSeconds * 1000);
        tunnel.ttlTimer.unref();
      }
      return toView(tunnel);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.stop(tunnel, message);
      // Preserve a status code the provider/broker already set (e.g. 400 for a
      // provider that can't port-forward); otherwise it's an open failure (500).
      if (hasStatusCode(error)) throw error;
      throw httpError(
        500,
        `failed to open RDP tunnel for ${resource.hostname}: ${message}${formatRecentLogs(tunnel)}`,
      );
    }
  }

  async close(idOrResource: string): Promise<RdpTunnelView | null> {
    const tunnel = this.tunnels.get(idOrResource) ?? this.findByResource(idOrResource);
    if (!tunnel) return null;
    await this.stop(tunnel, "closed by request");
    return toView(tunnel);
  }

  private findByResource(idOrHostname: string): RdpTunnelRecord | null {
    return [...this.tunnels.values()].find((tunnel) => (
      tunnel.resourceId === idOrHostname || tunnel.hostname === idOrHostname
    )) ?? null;
  }

  private async selectPublicPort(requested: number | null): Promise<number> {
    if (requested != null) {
      const port = sanitizePort(requested, "port");
      if (!this.publicPorts.includes(port)) {
        throw httpError(
          400,
          `port ${port} is not in PROVISIONING_RDP_TUNNEL_PORTS (${this.publicPorts.join(", ")})`,
        );
      }
      if (this.isManagedPortInUse(port) || !(await isPortAvailable(port, this.bindAddress))) {
        throw httpError(409, `RDP tunnel port ${port} is already in use`);
      }
      return port;
    }

    for (const port of this.publicPorts) {
      if (!this.isManagedPortInUse(port) && await isPortAvailable(port, this.bindAddress)) {
        return port;
      }
    }
    throw httpError(409, "no configured RDP tunnel public ports are available");
  }

  private async selectInternalPort(): Promise<number> {
    for (const port of this.internalPorts) {
      if (!this.isManagedInternalPortInUse(port) && await isPortAvailable(port, "127.0.0.1")) {
        return port;
      }
    }
    throw httpError(409, "no configured RDP tunnel internal ports are available");
  }

  private isManagedPortInUse(port: number): boolean {
    return [...this.tunnels.values()].some((tunnel) => tunnel.publicPort === port && tunnel.status !== "closed");
  }

  private isManagedInternalPortInUse(port: number): boolean {
    return [...this.tunnels.values()].some((tunnel) => tunnel.internalPort === port && tunnel.status !== "closed");
  }

  private async stop(
    tunnel: RdpTunnelRecord,
    reason: string,
    options: { closeForward?: boolean } = {},
  ): Promise<void> {
    if (tunnel.status === "closed") return;
    tunnel.status = "closed";
    tunnel.closedAt = new Date().toISOString();
    tunnel.closeReason = reason;
    if (tunnel.ttlTimer) {
      clearTimeout(tunnel.ttlTimer);
      tunnel.ttlTimer = null;
    }
    await closeServer(tunnel.proxy);
    if (options.closeForward !== false && tunnel.forward) {
      await tunnel.forward.close();
    }
    this.tunnels.delete(tunnel.id);
  }
}

function createProxyServer(internalPort: number): Server {
  return net.createServer((client) => {
    const upstream = net.connect({ host: "127.0.0.1", port: internalPort });
    bindSocketPair(client, upstream);
  });
}

function bindSocketPair(client: Socket, upstream: Socket): void {
  client.on("error", () => upstream.destroy());
  upstream.on("error", () => client.destroy());
  client.on("close", () => upstream.destroy());
  upstream.on("close", () => client.destroy());
  client.pipe(upstream);
  upstream.pipe(client);
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onListening = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      server.off("error", onError);
      server.off("listening", onListening);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve) => server.close(() => resolve()));
}

function isPortAvailable(port: number, host: string): Promise<boolean> {
  const server = net.createServer();
  return new Promise((resolve) => {
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function waitForTcp(
  host: string,
  port: number,
  timeoutMs: number,
  shouldStop: () => boolean,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (shouldStop()) break;
    if (await canConnect(host, port)) return;
    await sleep(500);
  }
  throw new Error(`local port-forward listener did not open on ${host}:${port}`);
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1000);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function parsePortList(value: string | undefined, fallback: string): number[] {
  const raw = (value && value.trim()) || fallback;
  const out = new Set<number>();
  for (const part of raw.split(",")) {
    const token = part.trim();
    if (!token) continue;
    const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const start = sanitizePort(Number(range[1]), "port range start");
      const end = sanitizePort(Number(range[2]), "port range end");
      if (end < start) throw new Error(`invalid port range ${token}`);
      for (let port = start; port <= end; port += 1) out.add(port);
      continue;
    }
    out.add(sanitizePort(Number(token), "port"));
  }
  return [...out].sort((a, b) => a - b);
}

function sanitizePort(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw httpError(400, `${label} must be an integer between 1 and 65535`);
  }
  return value;
}

function sanitizeNonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw httpError(400, `${label} must be a non-negative integer`);
  }
  return value;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function appendLog(tunnel: RdpTunnelRecord, line: string): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  tunnel.logs.push(trimmed);
  if (tunnel.logs.length > 80) tunnel.logs.splice(0, tunnel.logs.length - 80);
}

function formatRecentLogs(tunnel: RdpTunnelRecord): string {
  const recent = tunnel.logs.slice(-5);
  return recent.length ? `; recent output: ${recent.join(" | ")}` : "";
}

function extractRdpUsername(outputs: Record<string, unknown> | null | undefined): string | null {
  const endpoint = outputs?.endpoint;
  if (!endpoint || typeof endpoint !== "object" || Array.isArray(endpoint)) return null;
  const username = (endpoint as { rdp_username?: unknown }).rdp_username;
  return typeof username === "string" && username ? username : null;
}

function toView(tunnel: RdpTunnelRecord): RdpTunnelView {
  const { forward: _forward, proxy: _proxy, ttlTimer: _ttlTimer, ...view } = tunnel;
  return { ...view, logs: [...view.logs] };
}

function fallbackAdvertisedHost(bindAddress: string): string {
  if (bindAddress && bindAddress !== "0.0.0.0" && bindAddress !== "::") return bindAddress;
  return "localhost";
}

function normalizeAdvertisedHost(value: string | null | undefined): string | null {
  const host = value?.trim();
  if (!host) return null;
  const withoutProtocol = host.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const authority = withoutProtocol.split("/")[0]?.trim();
  if (!authority) return null;
  if (authority.startsWith("[")) {
    const end = authority.indexOf("]");
    return end > 0 ? authority.slice(1, end) : authority;
  }
  const hasSingleColon = authority.indexOf(":") === authority.lastIndexOf(":");
  return hasSingleColon && authority.includes(":")
    ? authority.slice(0, authority.lastIndexOf(":"))
    : authority;
}

function formatEndpointHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "resource";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpError(statusCode: number, message: string): Error {
  return Object.assign(new Error(message), { statusCode });
}

function hasStatusCode(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      typeof (error as { statusCode?: unknown }).statusCode === "number",
  );
}
