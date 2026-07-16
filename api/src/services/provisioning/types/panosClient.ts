export interface PanosApiClientOptions {
  host: string;
  port?: number;
  rejectUnauthorized?: boolean;
  timeoutMs?: number;
  /**
   * Optional logger. When provided, long-running operations (commit/commit-all
   * job polling) emit progress lines so a stalled push is diagnosable from
   * broker output alone.
   */
  log?: (message: string) => void;
}

export interface SystemInfo {
  hostname?: string | null;
  serial?: string | null;
  vmLicense?: string | null;
}

export interface VmAuthKeyResult {
  authKey: string;
  expiresAt?: string | null;
}

export interface ConnectedDevice {
  serial?: string | null;
  hostname?: string | null;
  connected?: string | null;
}

export interface PanoramaConnectionStatus {
  connected: boolean;
  server?: string | null;
}
