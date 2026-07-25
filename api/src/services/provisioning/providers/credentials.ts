import type { ProviderCredentialState } from "../types/index.js";
import { optionalEnv } from "../utils/index.js";

// Shared plumbing for the provider credential/existence probes. Provider CLIs report
// failures only as stderr text, so classification is pattern-based per provider; what
// is common is how the patterns are applied and how an env indirection is resolved.

export interface CredentialErrorRule {
  state: ProviderCredentialState;
  pattern: RegExp;
  remediation?: string;
}

export interface ClassifiedCredentialError {
  state: ProviderCredentialState;
  detail: string;
  remediation?: string;
}

/** First matching rule wins, so order rules most-specific first. */
export function classifyCredentialError(
  error: unknown,
  rules: CredentialErrorRule[],
): ClassifiedCredentialError {
  const detail = trimCliMessage(errorMessage(error));
  if (isMissingExecutableError(error)) {
    return { state: "error", detail };
  }
  for (const rule of rules) {
    if (rule.pattern.test(detail)) {
      return { state: rule.state, detail, ...(rule.remediation ? { remediation: rule.remediation } : {}) };
    }
  }
  return { state: "error", detail };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** True when the CLI binary itself is not installed in the API container. */
export function isMissingExecutableError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ENOENT" || /\bENOENT\b/.test(errorMessage(error));
}

/**
 * Collapse a captured CLI failure into one readable line. captureCommand rejects with
 * "<cmd> exited with code N: <stderr>", and provider CLIs pad stderr with banners and
 * blank lines that make a report unreadable.
 */
export function trimCliMessage(message: string, maxLength = 400): string {
  const collapsed = message.replace(/\s+/g, " ").trim();
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength - 1)}…` : collapsed;
}

/**
 * Resolve one level of the config's env indirection: `provider.<key>Env` names an env
 * var, whose *value* is what the provider needs. Reads the job's secret overlay first,
 * exactly like Terraform var resolution does, then process.env.
 */
export function resolveEnvIndirection(
  providerConfig: Record<string, unknown>,
  key: string,
): string | undefined {
  const envName = providerConfig[key];
  if (typeof envName !== "string" || !envName) return undefined;
  return optionalEnv(envName)?.trim() || undefined;
}

/** A literal config value, falling back to its `<key>Env` indirection. */
export function resolveConfigValue(
  providerConfig: Record<string, unknown>,
  key: string,
): string | undefined {
  const direct = providerConfig[key];
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  return resolveEnvIndirection(providerConfig, `${key}Env`);
}
