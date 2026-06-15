import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Client } from "ssh2";
import type { AuthAttempt, InitialPasswordOptions } from "../../../types/panwSsh.js";
import type { LogFn } from "../../../types/logging.js";

const promptNudgeDelayMs = 120_000;

export async function setInitialAdminPassword(options: InitialPasswordOptions): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 900_000;
  const log = options.log ?? (() => undefined);
  const attempts = authAttempts(options);
  if (attempts.length === 0) {
    throw new Error(
      "PAN-OS first-login SSH bootstrap needs an initial admin password, PANOS_SSH_PRIVATE_KEY, ~/.ssh/id_rsa, or SSH_AUTH_SOCK.",
    );
  }

  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      await runPasswordFlow(options, attempt, timeoutMs, log);
      return;
    } catch (error) {
      lastError = error;
      log(`PAN-OS SSH ${attempt.label} auth did not complete first-login bootstrap: ${errorMessage(error)}`);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function authAttempts(options: InitialPasswordOptions): AuthAttempt[] {
  const attempts: AuthAttempt[] = [];
  if (options.initialPassword) {
    attempts.push({
      label: "password",
      connectConfig: { password: options.initialPassword },
    });
  }

  const privateKeyPath = resolvePrivateKeyPath(options.privateKeyPath);
  if (privateKeyPath) {
    attempts.push({
      label: "private-key",
      connectConfig: { privateKey: readFileSync(privateKeyPath) },
    });
  }

  const agent = options.agentSocket ?? process.env.SSH_AUTH_SOCK;
  if (agent) {
    attempts.push({
      label: "ssh-agent",
      connectConfig: { agent },
    });
  }

  return attempts;
}

function resolvePrivateKeyPath(configuredPath?: string | null): string | null {
  if (configuredPath) return configuredPath;

  for (const candidate of [
    join(homedir(), ".ssh", "panw-broker-bootstrap"),
    join(homedir(), ".ssh", "id_rsa"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function runPasswordFlow(
  options: InitialPasswordOptions,
  attempt: AuthAttempt,
  timeoutMs: number,
  log: LogFn,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const conn = new Client();
    let settled = false;
    let stage:
      | "detect"
      | "configuring"
      | "configuring-for-commit"
      | "setting-password"
      | "confirming-password"
      | "waiting-config-prompt"
      | "committing"
      | "exiting" = "detect";
    let buffer = "";
    let promptNudgeTimer: ReturnType<typeof setTimeout> | null = null;

    const timer = setTimeout(() => {
      finish(new Error(`Timed out waiting for PAN-OS first-login password flow on ${options.host}`));
    }, timeoutMs);

    function finish(error?: Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (promptNudgeTimer) clearTimeout(promptNudgeTimer);
      conn.end();
      if (error) reject(error);
      else resolve();
    }

    function sendLine(stream: NodeJS.WritableStream, line: string): void {
      stream.write(`${line}\r`);
    }

    function transition(nextStage: typeof stage, message: string): void {
      if (stage !== nextStage) log(message);
      stage = nextStage;
    }

    conn
      .on("ready", () => {
        log(`SSH connected to ${options.host} with ${attempt.label} auth; setting initial admin password`);
        conn.shell({ term: "vt100" }, (error, stream) => {
          if (error) {
            finish(error);
            return;
          }

          if (timeoutMs > promptNudgeDelayMs) {
            promptNudgeTimer = setTimeout(() => {
              if (settled || stage !== "detect") return;
              log("PAN-OS first-login shell has not shown a prompt yet; pressing Enter twice");
              stream.write("\r\r");
            }, promptNudgeDelayMs);
          }

          stream.on("data", (chunk: Buffer) => {
            buffer += chunk.toString("utf8");
            const lower = buffer.toLowerCase();

            if (stage === "detect" && /old password\s*:?/i.test(lower)) {
              sendLine(stream, "admin");
              buffer = "";
              return;
            }

            if (stage === "detect" && /new password\s*:?|enter password\s*:?/i.test(lower)) {
              sendLine(stream, options.newPassword);
              buffer = "";
              transition("confirming-password", "PAN-OS requested a new password during first login");
              return;
            }

            if (stage === "detect" && />\s*$/.test(buffer)) {
              sendLine(stream, "configure");
              buffer = "";
              transition("configuring", "PAN-OS CLI prompt detected; entering configuration mode");
              return;
            }

            if (stage === "configuring" && /#\s*$/.test(buffer)) {
              sendLine(stream, "set mgt-config users admin password");
              buffer = "";
              transition("setting-password", "PAN-OS configuration mode ready; setting admin password");
              return;
            }

            if (stage === "configuring-for-commit" && /#\s*$/.test(buffer)) {
              sendLine(stream, "commit");
              buffer = "";
              transition("committing", "PAN-OS admin password accepted; committing configuration");
              return;
            }

            if (stage === "setting-password" && /enter password\s*:?|password\s*:?/i.test(lower)) {
              sendLine(stream, options.newPassword);
              buffer = "";
              transition("confirming-password", "PAN-OS requested the new admin password");
              return;
            }

            if (stage === "confirming-password" && /(confirm|retype|again)/i.test(lower)) {
              sendLine(stream, options.newPassword);
              buffer = "";
              transition("waiting-config-prompt", "PAN-OS requested admin password confirmation");
              return;
            }

            if (stage === "waiting-config-prompt" && />\s*$/.test(buffer)) {
              sendLine(stream, "configure");
              buffer = "";
              transition("configuring-for-commit", "PAN-OS returned to operational mode; entering configuration mode to commit");
              return;
            }

            if (stage === "waiting-config-prompt" && /#\s*$/.test(buffer)) {
              sendLine(stream, "commit");
              buffer = "";
              transition("committing", "PAN-OS admin password accepted; committing configuration");
              return;
            }

            if (stage === "committing" && /#\s*$/.test(buffer)) {
              sendLine(stream, "exit");
              buffer = "";
              transition("exiting", "PAN-OS commit returned to prompt; exiting configuration mode");
              return;
            }

            if (stage === "exiting" && />\s*$/.test(buffer)) {
              sendLine(stream, "exit");
              finish();
            }
          });

          stream.stderr.on("data", (chunk: Buffer) => {
            buffer += chunk.toString("utf8");
          });

          stream.on("close", () => {
            if (stage === "exiting") finish();
          });
        });
      })
      .on("error", finish)
      .connect({
        host: options.host,
        port: options.port ?? 22,
        username: options.username,
        ...attempt.connectConfig,
        readyTimeout: timeoutMs,
        keepaliveInterval: 10_000,
      });
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
