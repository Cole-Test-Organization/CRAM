// Per-user agent config — provider, model, local inference server URL, and the
// agent's base system prompt. Read by the agent loop (as defaults; the request
// body still wins for per-call overrides) and by background workers like the
// contact-enrichment formatter that have no request context.
//
// The only provider is `local` (an OpenAI-compatible inference server such as
// Ollama). Provider and server URL fall back to env-backed defaults
// (AGENT_PROVIDER / LOCAL_BASE_URL). The default *model*, when the user hasn't
// chosen one, is resolved from the server's installed models — see getEffective.

import { withUser } from '../db/connection.js';
import {
  DEFAULT_PROVIDER,
  DEFAULT_LOCAL_BASE_URL,
  FALLBACK_MODEL,
  defaultSystemPrompt,
} from '../agent/defaults.js';
import { listModels } from '../agent/providers/local.js';

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
  if (patch.system_prompt !== undefined) {
    // Empty/whitespace-only clears the customization → null → built-in default
    // applies. Same "null means use the default" contract as the fields above.
    const v = patch.system_prompt == null ? null : String(patch.system_prompt).trim();
    out.system_prompt = v || null;
  }
  return out;
}

// Resolve a default model from what the server actually has installed — no OS
// guessing. Preference order:
//   1. `${FALLBACK_MODEL}-mlx` — the MLX build. Its presence means an Apple
//      Silicon server (you can't pull/run MLX elsewhere), so it's the faster
//      build exactly where it exists.
//   2. `${FALLBACK_MODEL}` exact — the plain GGUF build (e.g. on Linux).
//   3. any other variant/quant of the base tag.
//   4. whatever's installed first.
// null if nothing is installed or the server can't be reached.
async function pickInstalledModel(baseUrl) {
  const models = await listModels(baseUrl);
  if (!models.length) return null;
  return (
    models.find((m) => m === `${FALLBACK_MODEL}-mlx`) ||
    models.find((m) => m === FALLBACK_MODEL) ||
    models.find((m) => m.startsWith(FALLBACK_MODEL)) ||
    models[0]
  );
}

export class AgentSettingsService {
  // Returns the raw stored row (or a row of all-nulls if none exists yet),
  // plus `default_system_prompt` — the built-in default rendered live — so the
  // GUI/MCP can show the user what they'd get if they reset (system_prompt null
  // → the default applies). The stored `system_prompt` stays null until the
  // user actually customizes it.
  async get(userId) {
    const default_system_prompt = defaultSystemPrompt();
    return withUser(userId, async (client) => {
      const row = (await client.query(
        `SELECT provider, model, local_base_url, system_prompt, updated_at
         FROM user_agent_settings
         WHERE user_id = current_setting('app.current_user_id')::bigint`
      )).rows[0];
      if (!row) {
        return {
          provider: null, model: null, local_base_url: null,
          system_prompt: null, default_system_prompt, updated_at: null,
        };
      }
      return { ...row, default_system_prompt };
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
    const local_base_url = stored.local_base_url || DEFAULT_LOCAL_BASE_URL;
    // Model: the user's saved choice wins; otherwise resolve it from what the
    // configured server actually has installed (correct on Mac/Linux/remote
    // without guessing), falling back to a static tag only if it's unreachable.
    const model = stored.model || (await pickInstalledModel(local_base_url)) || FALLBACK_MODEL;
    return {
      provider,
      model,
      local_base_url,
      // The base system prompt the agent loop should run with: the user's saved
      // text, or the built-in default when they haven't customized it.
      system_prompt: stored.system_prompt || stored.default_system_prompt,
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
        `SELECT provider, model, local_base_url, system_prompt
         FROM user_agent_settings
         WHERE user_id = current_setting('app.current_user_id')::bigint`
      )).rows[0] || { provider: null, model: null, local_base_url: null, system_prompt: null };

      const merged = { ...existing, ...fields };
      await client.query(
        `INSERT INTO user_agent_settings (user_id, provider, model, local_base_url, system_prompt)
         VALUES (current_setting('app.current_user_id')::bigint, $1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE
           SET provider = EXCLUDED.provider,
               model = EXCLUDED.model,
               local_base_url = EXCLUDED.local_base_url,
               system_prompt = EXCLUDED.system_prompt`,
        [merged.provider, merged.model, merged.local_base_url, merged.system_prompt]
      );
      return this.get(userId);
    });
  }
}
