import { withUser } from "../../../db/connection.js";
import { decryptSecret, encryptSecret } from "./crypto.js";

export interface SecretSummary {
  name: string;
  description: string | null;
  updatedAt: string;
}

// Per-user CRUD over provisioning_secrets (migration 042). Values are encrypted on
// write and decrypted on read; list() never exposes plaintext. RLS is forced and
// withUser() pins the session user, so reads/deletes are auto-scoped — only the
// NOT NULL user_id on insert is passed explicitly (it also satisfies the policy
// WITH CHECK).
export class SecretsRepository {
  async set(
    userId: number,
    name: string,
    value: string,
    description?: string | null,
  ): Promise<void> {
    const enc = encryptSecret(value);
    await withUser(userId, async (client) => {
      await client.query(
        `INSERT INTO provisioning_secrets
           (user_id, name, description, ciphertext, iv, auth_tag, algo)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id, name) DO UPDATE SET
           ciphertext  = EXCLUDED.ciphertext,
           iv          = EXCLUDED.iv,
           auth_tag    = EXCLUDED.auth_tag,
           algo        = EXCLUDED.algo,
           description = COALESCE(EXCLUDED.description, provisioning_secrets.description)`,
        [userId, name, description ?? null, enc.ciphertext, enc.iv, enc.authTag, enc.algo],
      );
    });
  }

  async get(userId: number, name: string): Promise<string | null> {
    return withUser(userId, async (client) => {
      const { rows } = await client.query(
        `SELECT ciphertext, iv, auth_tag FROM provisioning_secrets WHERE name = $1`,
        [name],
      );
      if (rows.length === 0) return null;
      const row = rows[0];
      return decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag });
    });
  }

  async has(userId: number, name: string): Promise<boolean> {
    return withUser(userId, async (client) => {
      const { rows } = await client.query(
        `SELECT 1 FROM provisioning_secrets WHERE name = $1`,
        [name],
      );
      return rows.length > 0;
    });
  }

  async list(userId: number): Promise<SecretSummary[]> {
    return withUser(userId, async (client) => {
      const { rows } = await client.query(
        `SELECT name, description, updated_at FROM provisioning_secrets ORDER BY name`,
      );
      return rows.map((r) => ({
        name: r.name as string,
        description: (r.description ?? null) as string | null,
        updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
      }));
    });
  }

  async delete(userId: number, name: string): Promise<boolean> {
    return withUser(userId, async (client) => {
      const res = await client.query(`DELETE FROM provisioning_secrets WHERE name = $1`, [name]);
      return (res.rowCount ?? 0) > 0;
    });
  }
}
