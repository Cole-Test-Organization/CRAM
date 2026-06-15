// Process-global overlay for *Env lookups. The provisioning service primes this with
// decrypted values from the encrypted provisioning_secrets table for the duration of a
// single job (jobs are serialized by the active-job guard), so requireEnv/optionalEnv
// resolve secrets-first and fall back to process.env. Dependency-free on purpose so
// utils/ can consult it without an import cycle.

let overlay: Record<string, string> | null = null;

export function installSecretOverlay(values: Record<string, string>): void {
  overlay = values;
}

export function clearSecretOverlay(): void {
  overlay = null;
}

export function lookupSecretOverlay(name: string): string | undefined {
  return overlay?.[name];
}
