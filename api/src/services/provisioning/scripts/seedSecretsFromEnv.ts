// Standalone local-dev "staging" step: load the broker's deployment secrets from a
// .env file into the encrypted provisioning_secrets table. The secrets analogue of
// seeding the database with fixture data — run it once to bootstrap, then manage
// secrets via the GUI. Mirrors the boot-time hook in api/src/index.ts.
//
//   npm --prefix api run provisioning:seed-secrets
//   npm --prefix api run provisioning:seed-secrets -- --env-file ../terraform/panw-broker/.env
//   npm --prefix api run provisioning:seed-secrets -- --overwrite
//
// Reads PROVISIONING_SECRETS_ENV_FILE when --env-file is omitted. Requires
// PROVISIONING_SECRETS_KEY (the AES master key) and DATABASE_URL — both are pulled
// from the --env-file too when not already exported. Prints names only, never values.
import { loadDotEnv } from "../utils/dotenv.js";
import { resolveSecretsEnvFile, seedProvisioningSecrets } from "../secrets/index.js";
import { initDb, closeDb } from "../../../db/connection.js";
import { getDefaultUserId } from "../../../auth.js";

interface Args {
  envFile?: string;
  overwrite: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { overwrite: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--overwrite") args.overwrite = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--env-file") args.envFile = argv[++i];
    else if (a.startsWith("--env-file=")) args.envFile = a.slice("--env-file=".length);
  }
  return args;
}

const USAGE = `Seed broker secrets from a .env file into the encrypted provisioning_secrets table.

Usage:
  tsx src/services/provisioning/scripts/seedSecretsFromEnv.ts [--env-file <path>] [--overwrite]

Options:
  --env-file <path>   .env to read (default: $PROVISIONING_SECRETS_ENV_FILE or the
                      provisioning service .env). Per key, a real process.env value wins.
  --overwrite         Re-write keys that already exist (default: seed-if-absent).
  -h, --help          Show this help.

Requires PROVISIONING_SECRETS_KEY and DATABASE_URL (also read from the --env-file).`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const envFile = args.envFile ?? resolveSecretsEnvFile();
  // Pull DATABASE_URL / PROVISIONING_SECRETS_KEY (and the secrets) from the file when
  // they aren't already exported, so a single .env drives the whole bootstrap.
  loadDotEnv(envFile);

  await initDb();
  try {
    const userId = await getDefaultUserId();
    const result = await seedProvisioningSecrets(userId, { envFile, overwrite: args.overwrite });
    if (!result.keyConfigured) {
      console.error(
        "PROVISIONING_SECRETS_KEY is not set — cannot encrypt secrets. " +
          "Generate one with: openssl rand -base64 32",
      );
      process.exitCode = 1;
      return;
    }
    console.log(`Secrets bootstrap from ${result.envFile}`);
    console.log(`  seeded (${result.seeded.length}):         ${result.seeded.join(", ") || "—"}`);
    console.log(`  already present (${result.skipped.length}): ${result.skipped.join(", ") || "—"}`);
    console.log(`  no value in env (${result.absent.length}):  ${result.absent.join(", ") || "—"}`);
    if (result.seeded.length === 0 && result.skipped.length === 0) {
      console.log("\nNothing found to seed — check that --env-file points at a .env with the broker keys.");
    }
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
  void closeDb();
});
