import { SecretsService } from "./secretsService.js";

// Resolves the broker's *Env references to concrete values: encrypted-secret table
// first (scoped to one user), then process.env fallback for local dev or values not
// yet migrated. hydrateAll() returns every stored secret as a name->value map, which
// the broker installs as a job's *Env overlay (see utils/secretSource) so the existing
// requireEnv/optionalEnv call sites resolve secrets transparently.
export class SecretResolver {
  constructor(
    private readonly userId: number,
    private readonly secrets: SecretsService = new SecretsService(),
  ) {}

  async resolve(name: string): Promise<string | undefined> {
    const fromTable = await this.secrets.resolveSecret(this.userId, name);
    return fromTable ?? process.env[name];
  }

  async hydrateAll(): Promise<Record<string, string>> {
    const summaries = await this.secrets.listSecrets(this.userId);
    const out: Record<string, string> = {};
    for (const summary of summaries) {
      const value = await this.secrets.resolveSecret(this.userId, summary.name);
      if (value != null) out[summary.name] = value;
    }
    return out;
  }
}
