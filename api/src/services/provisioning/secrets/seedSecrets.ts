import path from "node:path";
import { projectRoot } from "../utils/paths.js";
import { readDotEnvFile } from "../utils/dotenv.js";
import { secretsKeyConfigured } from "./crypto.js";
import { SecretsService } from "./secretsService.js";

// The genuine input secrets/credentials a deploy needs that have NO runtime source.
// Deliberately MINIMAL — NOT "every env var the broker references." A local .env also
// holds the AES master key (PROVISIONING_SECRETS_KEY), infra config (DATABASE_URL,
// PROVISIONING_*) and host bind (HOST/PORT) — none of which are secrets to seed.
//
// Just as important, these are EXCLUDED because the broker already sources them itself,
// so persisting them as secrets would be wrong (verified against the adapters/config):
//   • PANW_VM_AUTH_KEY              — generated on Panorama at deploy time (`request
//     bootstrap vm-auth-key generate`); firewalls read it via a resource reference, not
//     env. (Only a Panorama-less Proxmox firewall supplies it as input — set via the GUI.)
//   • PANOS_INITIAL_ADMIN_PASSWORD — first-login bootstrap password; the adapter already
//     defaults it ("admin"), so it isn't a stored secret.
//   • PANOS_SSH_PRIVATE_KEY / _PUBLIC_KEY / _PUBLIC_KEY_FILE — read from the host
//     (~/.ssh/… or an explicit file path), never raw secret strings.
//   • AWS_GP_LAB_ALLOWED_SOURCE_CIDRS — auto-detected from the deploy host's public IP
//     (checkip.amazonaws.com) when unset.
//   • AWS_GP_LAB_SSH_PUBLIC_KEY     — read from the host's ~/.ssh/*.pub when unset.
//   • KOI_SCRIPT_URL               — vestigial; Koi ships from a local file
//     (resource.koi.scriptPath, inlined + hashed), not a URL.
//   • AWS_ACCESS_KEY_ID / _SECRET   — Terraform reads these from ~/.aws or the process env.
export const BROKER_SECRET_KEYS: readonly string[] = [
  // PAN-OS / PANW licensing — proof-of-purchase from the CSP, no runtime source
  "PANW_NGFW_AUTH_CODE",
  "PANW_PANORAMA_AUTH_CODE",
  "PANW_PANORAMA_SERIAL",
  // Optional VM-Series device-certificate registration PIN (CSP)
  "PANW_DEVICE_CERT_PIN_ID",
  "PANW_DEVICE_CERT_PIN_VALUE",
  // Programmatic delicensing API key (CSP) — used on destroy/deactivate
  "PANW_LICENSE_DEACTIVATION_API_KEY",
  // Device credential set on the firewalls/Panorama
  "PANOS_ADMIN_PASSWORD",
  // Proxmox provider connection (the token is the secret; endpoint/insecure ride along)
  "PROXMOX_VE_ENDPOINT",
  "PROXMOX_VE_API_TOKEN",
  "PROXMOX_VE_INSECURE",
  // AWS Windows endpoint RDP credential
  "WINDOWS_ENDPOINT_ADMIN_PASSWORD",
];

const SECRETS_ENV_FILE = "PROVISIONING_SECRETS_ENV_FILE";

// Where the local bootstrap reads values from. Point PROVISIONING_SECRETS_ENV_FILE at
// your existing broker .env (e.g. the old panw-broker/.env); otherwise we read a .env
// dropped in the provisioning service dir. Per key, a real process.env value still
// wins (compose env_file / shell exports), with the file as the fallback layer.
export function resolveSecretsEnvFile(): string {
  const override = process.env[SECRETS_ENV_FILE];
  return override && override.trim()
    ? path.resolve(override.trim())
    : path.join(projectRoot, ".env");
}

export interface SeedSecretsOptions {
  /** .env to read (default: resolveSecretsEnvFile()). Per key, process.env wins. */
  envFile?: string;
  /** Re-write a key even if it already exists. Default false (seed-if-absent). */
  overwrite?: boolean;
  /** Restrict to these keys (defaults to the full broker allowlist). */
  keys?: readonly string[];
  secrets?: SecretsService;
}

export interface SeedSecretsResult {
  envFile: string;
  keyConfigured: boolean;
  /** Names written this run. */
  seeded: string[];
  /** Names already present (overwrite=false). */
  skipped: string[];
  /** Allowlist keys with no value in the file/env. */
  absent: string[];
}

// Local-dev bootstrap: copy the broker's deployment secrets from a .env file (and the
// process env) into the encrypted provisioning_secrets table for `userId`. The secrets
// analogue of seedProvisioningConfig() — run the broker locally off the same .env you've
// always used, while production keeps these as encrypted rows only. Seed-if-absent by
// default (won't clobber a value edited via the GUI); pass overwrite to force a re-sync.
// No-op when the AES master key is unset. NEVER logs values — returns names only.
export async function seedProvisioningSecrets(
  userId: number,
  options: SeedSecretsOptions = {},
): Promise<SeedSecretsResult> {
  const envFile = options.envFile ?? resolveSecretsEnvFile();
  const keys = options.keys ?? BROKER_SECRET_KEYS;
  const result: SeedSecretsResult = {
    envFile,
    keyConfigured: secretsKeyConfigured(),
    seeded: [],
    skipped: [],
    absent: [],
  };
  // Without the master key, encryption throws deep in crypto. Treat it as a no-op and
  // let the caller report it, rather than failing the whole bootstrap.
  if (!result.keyConfigured) return result;

  const fileMap = readDotEnvFile(envFile);
  const secrets = options.secrets ?? new SecretsService();

  for (const key of keys) {
    const candidate = process.env[key] ?? fileMap[key];
    const value = typeof candidate === "string" ? candidate.trim() : "";
    if (!value) {
      result.absent.push(key);
      continue;
    }
    if (!options.overwrite && (await secrets.hasSecret(userId, key))) {
      result.skipped.push(key);
      continue;
    }
    await secrets.setSecret(userId, key, value, "Seeded from .env (local bootstrap)");
    result.seeded.push(key);
  }
  return result;
}
