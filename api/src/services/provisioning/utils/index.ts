import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import type { LogFn } from "../types/logging.js";
import { lookupSecretOverlay } from "./secretSource.js";
import { currentJobSignal } from "./jobSignal.js";

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export function nowIso(): string {
  return new Date().toISOString();
}

// Resolves an env-var reference: the primed secret overlay (encrypted secrets table)
// first, then process.env. undefined when neither has it.
export function optionalEnv(name: string): string | undefined {
  return lookupSecretOverlay(name) ?? process.env[name];
}

export function requireEnv(name: string): string {
  const value = optionalEnv(name);
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

// terraform shells out to provider plugins (and some stacks run local-exec →
// bash/gcc/docker). SIGTERM to just the direct child would orphan those grandchildren,
// so we spawn the child as its own process-group leader (detached) and, on cancel,
// signal the whole group (-pid). Jobs are serialized, so this is unambiguous.
function killProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // already exited
    }
  }
}

function watchForAbort(
  child: ChildProcess,
  signal: AbortSignal | undefined,
  log: LogFn,
): () => void {
  if (!signal) return () => undefined;
  const onAbort = (): void => {
    log("Cancellation requested — terminating the process group…");
    killProcessGroup(child, "SIGTERM");
    const escalate = setTimeout(() => killProcessGroup(child, "SIGKILL"), 5_000);
    escalate.unref();
  };
  if (signal.aborted) onAbort();
  else signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}

export async function runCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    log?: LogFn;
    signal?: AbortSignal;
  } = {},
): Promise<void> {
  const log = options.log ?? (() => undefined);
  // Defaults to the job worker's process-global signal so a user cancellation
  // (which aborts it) terminates the spawned child — no need to thread the signal
  // through every adapter. Jobs are serialized, so the global is unambiguous.
  const signal = options.signal ?? currentJobSignal() ?? undefined;
  log(`$ ${command} ${args.join(" ")}`);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const unwatch = watchForAbort(child, signal, log);

    child.stdout.on("data", (chunk: Buffer) => {
      chunk
        .toString()
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => log(line));
    });

    child.stderr.on("data", (chunk: Buffer) => {
      chunk
        .toString()
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => log(line));
    });

    child.on("error", (err) => {
      unwatch();
      reject(err);
    });
    child.on("close", (code, sig) => {
      unwatch();
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with ${sig ? `signal ${sig}` : `code ${code}`}`));
      }
    });
  });
}

export async function captureCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    log?: LogFn;
    signal?: AbortSignal;
  } = {},
): Promise<string> {
  const log = options.log ?? (() => undefined);
  const signal = options.signal ?? currentJobSignal() ?? undefined;
  log(`$ ${command} ${args.join(" ")}`);

  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const unwatch = watchForAbort(child, signal, log);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      text
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => log(line));
    });

    child.on("error", (err) => {
      unwatch();
      reject(err);
    });
    child.on("close", (code, sig) => {
      unwatch();
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`${command} exited with ${sig ? `signal ${sig}` : `code ${code}`}: ${stderr}`));
      }
    });
  });
}
