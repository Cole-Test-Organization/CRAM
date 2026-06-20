import { readFileSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "./paths.js";

// Parse a .env-style string into a key→value map. Supports `#` comments, blank
// lines, and single/double-quoted values. No interpolation — values are literal,
// and only the FIRST `=` splits (so a value may itself contain `=`, e.g. a Proxmox
// token `root@pam!tok=secret`).
export function parseDotEnv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key) continue;
    out[key] = unquoteEnvValue(trimmed.slice(separatorIndex + 1).trim());
  }
  return out;
}

// Read + parse a .env file into a map. Returns {} when the file does not exist, so
// callers can treat "no file" the same as "no overrides".
export function readDotEnvFile(filePath = path.join(projectRoot, ".env")): Record<string, string> {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  return parseDotEnv(raw);
}

// Load a .env file into process.env WITHOUT clobbering values already set (a shell
// export / docker-compose env_file / systemd value wins). Local-dev convenience.
export function loadDotEnv(filePath = path.join(projectRoot, ".env")): void {
  for (const [key, value] of Object.entries(readDotEnvFile(filePath))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
