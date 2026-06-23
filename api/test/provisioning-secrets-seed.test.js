import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDotEnv } from "../src/services/provisioning/utils/dotenv.js";
import { BROKER_SECRET_KEYS, resolveSecretsEnvFile } from "../src/services/provisioning/secrets/seedSecrets.js";

// These guard the pure logic of the local secret bootstrap without touching Postgres.
// The allowlist test is the safety-critical one: the local .env holds the AES master
// key and infra config that must NEVER be copied into the secrets table.

test("parseDotEnv parses keys, skips comments/blanks, unquotes, first '=' splits", () => {
  const map = parseDotEnv(
    [
      "# a comment",
      "",
      "PANW_VM_AUTH_KEY=abc123",
      'WINDOWS_ENDPOINT_ADMIN_PASSWORD="p@ss=word!"',
      "PROXMOX_VE_API_TOKEN=root@pam!tok=secret-with=equals",
      "  line without an equals sign  ",
    ].join("\n"),
  );
  assert.equal(map.PANW_VM_AUTH_KEY, "abc123");
  assert.equal(map.WINDOWS_ENDPOINT_ADMIN_PASSWORD, "p@ss=word!");
  assert.equal(map.PROXMOX_VE_API_TOKEN, "root@pam!tok=secret-with=equals");
  assert.ok(!("line" in map));
});

test("broker allowlist excludes the master key and infra config", () => {
  for (const forbidden of [
    "PROVISIONING_SECRETS_KEY",
    "DATABASE_URL",
    "HOST",
    "PORT",
    "AWS_PROFILE",
    "PROVISIONING_ROOT",
    "PROVISIONING_TF_PG_CONN",
  ]) {
    assert.ok(!BROKER_SECRET_KEYS.includes(forbidden), `${forbidden} must not be seeded as a secret`);
  }
});

test("broker allowlist includes the real deployment secrets", () => {
  for (const present of [
    "PANW_NGFW_AUTH_CODE",
    "PANW_PANORAMA_AUTH_CODE",
    "PANW_PANORAMA_SERIAL",
    "PANOS_ADMIN_PASSWORD",
    "PROXMOX_VE_API_TOKEN",
    "WINDOWS_ENDPOINT_ADMIN_PASSWORD",
  ]) {
    assert.ok(BROKER_SECRET_KEYS.includes(present), `${present} should be in the allowlist`);
  }
});

test("allowlist excludes runtime-generated / machine-derived / vestigial keys", () => {
  // The broker sources each of these itself at deploy time, so they must NOT be seeded
  // as secrets (see the exclusion notes in secrets/seedSecrets.ts).
  for (const excluded of [
    "PANW_VM_AUTH_KEY", // generated on Panorama at deploy time
    "PANOS_INITIAL_ADMIN_PASSWORD", // adapter defaults it ("admin")
    "PANOS_SSH_PRIVATE_KEY", // read from the host filesystem
    "PANOS_SSH_PUBLIC_KEY",
    "PANOS_SSH_PUBLIC_KEY_FILE",
    "AWS_GP_LAB_ALLOWED_SOURCE_CIDRS", // auto-detected public IP
    "AWS_GP_LAB_SSH_PUBLIC_KEY", // read from ~/.ssh
  ]) {
    assert.ok(!BROKER_SECRET_KEYS.includes(excluded), `${excluded} is sourced at runtime — must not be a seeded secret`);
  }
});

test("every allowlisted key is a valid UPPER_SNAKE secret name", () => {
  const re = /^[A-Z][A-Z0-9_]*$/;
  for (const key of BROKER_SECRET_KEYS) {
    assert.ok(re.test(key), `${key} must match the secret-name rule`);
  }
});

test("resolveSecretsEnvFile honors the override env var", () => {
  const prev = process.env.PROVISIONING_SECRETS_ENV_FILE;
  process.env.PROVISIONING_SECRETS_ENV_FILE = "/tmp/custom-broker.env";
  try {
    assert.equal(resolveSecretsEnvFile(), "/tmp/custom-broker.env");
  } finally {
    if (prev === undefined) delete process.env.PROVISIONING_SECRETS_ENV_FILE;
    else process.env.PROVISIONING_SECRETS_ENV_FILE = prev;
  }
});
