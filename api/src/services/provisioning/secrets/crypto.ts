import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Shared app-side encryption-at-rest for provisioning secrets and the agent LLM
// bearer token. AES-256-GCM uses the existing 32-byte
// PROVISIONING_SECRETS_KEY master key (hex or base64); the credentials themselves
// are never read from env. Only ciphertext + IV + auth tag reach Postgres.

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length
const KEY_BYTES = 32; // AES-256

export const SECRETS_KEY_ENV = "PROVISIONING_SECRETS_KEY";

function masterKey(): Buffer {
  const raw = process.env[SECRETS_KEY_ENV];
  if (!raw) {
    throw new Error(
      `${SECRETS_KEY_ENV} is not set — it is required to encrypt/decrypt stored secrets. ` +
        "Generate one with: openssl rand -base64 32",
    );
  }
  const trimmed = raw.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `${SECRETS_KEY_ENV} must decode to ${KEY_BYTES} bytes (got ${key.length}). ` +
        "Use a 64-char hex string or a base64 value of 32 bytes (openssl rand -base64 32).",
    );
  }
  return key;
}

export interface EncryptedSecret {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  algo: string;
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag(), algo: ALGO };
}

export function decryptSecret(enc: { ciphertext: Buffer; iv: Buffer; authTag: Buffer }): string {
  const decipher = createDecipheriv(ALGO, masterKey(), enc.iv);
  decipher.setAuthTag(enc.authTag);
  return Buffer.concat([decipher.update(enc.ciphertext), decipher.final()]).toString("utf8");
}

// True when the master key is configured. Lets surfaces fail fast with a clear
// message instead of attempting an operation that will throw deep in crypto.
export function secretsKeyConfigured(): boolean {
  return Boolean(process.env[SECRETS_KEY_ENV]);
}
