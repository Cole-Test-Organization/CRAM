// Diagnostic: list the provisioning secrets currently loaded for the default user and
// prove they decrypt — the exact path the job worker uses (SecretResolver.hydrateAll()).
// Prints names + value lengths only; secret values are never printed.
//
//   npm --prefix api run provisioning:list-secrets
import { initDb, closeDb } from "../../../db/connection.js";
import { getDefaultUserId } from "../../../auth.js";
import { SecretsService, SecretResolver, BROKER_SECRET_KEYS } from "../secrets/index.js";

async function main(): Promise<void> {
  await initDb();
  try {
    const userId = await getDefaultUserId();
    const secrets = new SecretsService();
    const summaries = await secrets.listSecrets(userId);
    const hydrated = await new SecretResolver(userId, secrets).hydrateAll();

    console.log(`Default user id: ${userId}`);
    console.log(`Stored secrets (${summaries.length}) — name + value length (values never printed):`);
    for (const s of summaries) {
      const len = hydrated[s.name]?.length ?? 0;
      const status = len > 0 ? "decrypts OK" : "DECRYPT FAILED";
      console.log(`  ${s.name.padEnd(34)} len=${String(len).padStart(4)}  ${status}`);
    }

    const present = new Set(summaries.map((s) => s.name));
    const missing = BROKER_SECRET_KEYS.filter((k) => !present.has(k));
    console.log(`\nBroker allowlist coverage: ${BROKER_SECRET_KEYS.length - missing.length}/${BROKER_SECRET_KEYS.length} keys present`);
    if (missing.length) console.log(`  not set (no value in source .env): ${missing.join(", ")}`);
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
  void closeDb();
});
