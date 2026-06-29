import { SecretsRepository, type SecretSummary } from "./secretsRepository.js";

const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]*$/;

export const READABLE_PROVISIONING_SECRET_NAMES = [
  "PANW_DEVICE_CERT_PIN_ID",
  "PANW_NGFW_AUTH_CODE",
  "PANW_PANORAMA_AUTH_CODE",
  "PANW_PANORAMA_SERIAL",
] as const;

const READABLE_PROVISIONING_SECRET_SET = new Set<string>(READABLE_PROVISIONING_SECRET_NAMES);

export interface ListedSecretSummary extends SecretSummary {
  readable: boolean;
  value?: string | null;
  valueSuffix?: string | null;
}

export function isReadableProvisioningSecret(name: string): boolean {
  return READABLE_PROVISIONING_SECRET_SET.has(name);
}

function badRequest(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function secretValueSuffix(value: string | null): string | null {
  if (!value || value.length <= 4) return null;
  return value.slice(-4);
}

// User-facing secrets management for the provisioning service. Names follow the
// broker's *Env convention (UPPER_SNAKE, e.g. PANW_PANORAMA_AUTH_CODE) so deployment
// config keeps referencing a secret by name while the value lives encrypted at rest.
// list/delete/has are safe to expose over HTTP+MCP; list returns only suffixes for
// write-only values. resolveSecret returns plaintext and is for internal deploy-time
// resolution only — never wire it to a surface.
export class SecretsService {
  constructor(private readonly repo: SecretsRepository = new SecretsRepository()) {}

  async setSecret(
    userId: number,
    name: string,
    value: string,
    description?: string | null,
  ): Promise<{ name: string }> {
    const key = (name ?? "").trim();
    if (!SECRET_NAME_RE.test(key)) {
      throw badRequest(`invalid secret name "${name}" — use UPPER_SNAKE_CASE (e.g. PANW_PANORAMA_AUTH_CODE)`);
    }
    if (typeof value !== "string" || value.length === 0) {
      throw badRequest("secret value must be a non-empty string");
    }
    await this.repo.set(userId, key, value, description ?? null);
    return { name: key };
  }

  async listSecrets(userId: number): Promise<ListedSecretSummary[]> {
    const rows = await this.repo.list(userId);
    return Promise.all(rows.map(async (secret) => {
      const readable = isReadableProvisioningSecret(secret.name);
      const value = await this.repo.get(userId, secret.name);
      if (!readable) return { ...secret, readable, valueSuffix: secretValueSuffix(value) };
      return {
        ...secret,
        readable,
        value,
      };
    }));
  }

  async deleteSecret(userId: number, name: string): Promise<boolean> {
    return this.repo.delete(userId, name);
  }

  async hasSecret(userId: number, name: string): Promise<boolean> {
    return this.repo.has(userId, name);
  }

  // Internal: decrypted value for deploy-time resolution. Never expose over a surface.
  async resolveSecret(userId: number, name: string): Promise<string | null> {
    return this.repo.get(userId, name);
  }
}
