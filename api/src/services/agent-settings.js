// Per-user agent provider config — provider name, default model, local
// inference server URL. Read by the agent loop (as defaults; the request
// body still wins for per-call overrides) and by background workers like
// the contact-enrichment formatter that have no request context.
//
// The only provider is `local` (an OpenAI-compatible inference server such as
// Ollama). Env vars (AGENT_PROVIDER, AGENT_MODEL, LOCAL_BASE_URL), surfaced
// via ../agent/defaults.js, act as a bootstrap fallback for fresh installs
// that haven't curated the row yet.

import { withUser } from '../db/connection.js';
import {
  DEFAULT_PROVIDER,
  DEFAULT_MODEL,
  DEFAULT_LOCAL_BASE_URL,
} from '../agent/defaults.js';

const VALID_PROVIDERS = new Set(['local']);

function normalize(patch) {
  const out = {};
  if (patch.provider !== undefined) {
    const v = patch.provider == null ? null : String(patch.provider).trim().toLowerCase();
    if (v && !VALID_PROVIDERS.has(v)) {
      throw Object.assign(new Error(`Invalid provider: "${v}". Must be "local" — a self-hosted OpenAI-compatible inference server (Ollama, LM Studio, llama.cpp, vLLM) reachable at local_base_url. Pass null to clear.`), { statusCode: 400 });
    }
    out.provider = v || null;
  }
  if (patch.model !== undefined) {
    const v = patch.model == null ? null : String(patch.model).trim();
    out.model = v || null;
  }
  if (patch.local_base_url !== undefined) {
    let v = patch.local_base_url == null ? null : String(patch.local_base_url).trim();
    if (v) {
      // Strip trailing slash so the consumer can append /v1/chat/completions
      // without double-slashing.
      v = v.replace(/\/+$/, '');
    }
    out.local_base_url = v || null;
  }
  return out;
}

export class AgentSettingsService {
  // Returns the raw stored row (or a row of all-nulls if none exists yet).
  async get(userId) {
    return withUser(userId, async (client) => {
      const row = (await client.query(
        `SELECT provider, model, local_base_url, updated_at
         FROM user_agent_settings
         WHERE user_id = current_setting('app.current_user_id')::bigint`
      )).rows[0];
      if (!row) {
        return { provider: null, model: null, local_base_url: null, updated_at: null };
      }
      return row;
    });
  }

  // Returns the effective config a worker should use — merging the user's
  // stored values over env defaults. Workers (loop.js, contact enrichment)
  // call this so they don't have to re-implement the fallback chain.
  async getEffective(userId) {
    const stored = await this.get(userId);
    // Coerce any legacy/unknown stored provider (e.g. a value from before the
    // local-only switch) to the default so the provider registry never throws.
    const provider = VALID_PROVIDERS.has(stored.provider) ? stored.provider : DEFAULT_PROVIDER;
    return {
      provider,
      model:    stored.model    || DEFAULT_MODEL,
      local_base_url: stored.local_base_url || DEFAULT_LOCAL_BASE_URL,
    };
  }

  // Patch-style upsert: only fields present in the input are touched.
  async update(userId, patch) {
    const fields = normalize(patch || {});
    if (Object.keys(fields).length === 0) {
      return this.get(userId);
    }
    return withUser(userId, async (client) => {
      // Read existing, merge, then upsert. Simpler than constructing a
      // dynamic UPDATE with conditional COALESCE per field.
      const existing = (await client.query(
        `SELECT provider, model, local_base_url
         FROM user_agent_settings
         WHERE user_id = current_setting('app.current_user_id')::bigint`
      )).rows[0] || { provider: null, model: null, local_base_url: null };

      const merged = { ...existing, ...fields };
      await client.query(
        `INSERT INTO user_agent_settings (user_id, provider, model, local_base_url)
         VALUES (current_setting('app.current_user_id')::bigint, $1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE
           SET provider = EXCLUDED.provider,
               model = EXCLUDED.model,
               local_base_url = EXCLUDED.local_base_url`,
        [merged.provider, merged.model, merged.local_base_url]
      );
      return this.get(userId);
    });
  }
}
