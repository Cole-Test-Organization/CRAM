import type { ConnectConfig } from "ssh2";
import type { LogFn } from "./logging.js";

export interface InitialPasswordOptions {
  host: string;
  port?: number;
  username: string;
  initialPassword?: string | null;
  privateKeyPath?: string | null;
  agentSocket?: string | null;
  newPassword: string;
  timeoutMs?: number;
  log?: LogFn;
}

export interface AuthAttempt {
  label: string;
  connectConfig: Pick<ConnectConfig, "password" | "privateKey" | "agent">;
}
