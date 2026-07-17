// Per-user agent config — provider, model, local inference server URL, encrypted
// bearer token, and the agent's base system prompt. Read by the agent loop and
// background workers so every local-LLM call uses the same saved configuration.
//
// The bearer token is write-only at the HTTP/MCP boundary. It is encrypted with
// AES-256-GCM before being written to user_agent_settings and decrypted only for
// an outbound request to the configured inference server.

import { withUser } from '../../db/connection.js';
import {
  DEFAULT_PROVIDER,
  DEFAULT_LOCAL_BASE_URL,
  FALLBACK_MODEL,
  defaultSystemPrompt,
} from '../../agent/defaults.js';
import { listModels } from '../../agent/providers/local.js';
import { badRequest } from '../../lib/http-error.js';
import { decryptSecret, encryptSecret } from '../provisioning/secrets/crypto.js';

const VALID_PROVIDERS = new Set(['local']);
const MAX_API_KEY_LENGTH = 8192;

interface StoredAgentSettings {
  provider: string | null;
  model: string | null;
  local_base_url: string | null;
  system_prompt: string | null;
  local_api_key_ciphertext: Buffer | null;
  local_api_key_iv: Buffer | null;
  local_api_key_auth_tag: Buffer | null;
  local_api_key_algo: string | null;
  local_api_key_key_version: number | null;
  updated_at: Date | string | null;
}

interface AgentSettingsPatch {
  provider?: string | null;
  model?: string | null;
  local_base_url?: string | null;
  local_api_key?: string | null;
  system_prompt?: string | null;
}

const EMPTY_STORED_SETTINGS: StoredAgentSettings = {
  provider: null,
  model: null,
  local_base_url: null,
  system_prompt: null,
  local_api_key_ciphertext: null,
  local_api_key_iv: null,
  local_api_key_auth_tag: null,
  local_api_key_algo: null,
  local_api_key_key_version: null,
  updated_at: null,
};

function normalize(patch: Record<string, unknown>): AgentSettingsPatch {
  const out: AgentSettingsPatch = {};
  if (patch.provider !== undefined) {
    const v = patch.provider == null ? null : String(patch.provider).trim().toLowerCase();
    if (v && !VALID_PROVIDERS.has(v)) {
      throw badRequest(`Invalid provider: "${v}". Must be "local" — a self-hosted OpenAI-compatible inference server (Ollama, LM Studio, llama.cpp, vLLM) reachable at local_base_url. Pass null to clear.`);
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
  if (patch.local_api_key !== undefined) {
    let v = patch.local_api_key == null ? null : String(patch.local_api_key).trim();
    // Be forgiving when a user pastes the complete header value into the token
    // field. Only the credential itself is encrypted; the provider adds Bearer.
    if (v) v = v.replace(/^Bearer\s+/i, '').trim();
    if (v && /[\r\n]/.test(v)) {
      throw badRequest('local_api_key must not contain line breaks.');
    }
    if (v && v.length > MAX_API_KEY_LENGTH) {
      throw badRequest(`local_api_key must be ${MAX_API_KEY_LENGTH} characters or fewer.`);
    }
    out.local_api_key = v || null;
  }
  if (patch.system_prompt !== undefined) {
    // Empty/whitespace-only clears the customization → null → built-in default
    // applies. Same "null means use the default" contract as the fields above.
    const v = patch.system_prompt == null ? null : String(patch.system_prompt).trim();
    out.system_prompt = v || null;
  }
  return out;
}

// Resolve a default model from what the authenticated server actually exposes.
// The bearer token must be used here too: llama.cpp can protect /v1/models as
// well as /v1/chat/completions.
async function pickInstalledModel(baseUrl: string, apiKey: string | null) {
  const models: string[] = await listModels(baseUrl, apiKey);
  if (!models.length) return null;
  return (
    models.find((m) => m === `${FALLBACK_MODEL}-mlx`) ||
    models.find((m) => m === FALLBACK_MODEL) ||
    models.find((m) => m.startsWith(FALLBACK_MODEL)) ||
    models[0]
  );
}

function decryptApiKey(stored: StoredAgentSettings): string | null {
  if (!stored.local_api_key_ciphertext) return null;
  if (!stored.local_api_key_iv || !stored.local_api_key_auth_tag) {
    throw new Error('Stored local LLM API key is missing encryption metadata.');
  }
  return decryptSecret({
    ciphertext: stored.local_api_key_ciphertext,
    iv: stored.local_api_key_iv,
    authTag: stored.local_api_key_auth_tag,
  });
}

export class AgentSettingsService {
  private async getStored(userId: number): Promise<StoredAgentSettings> {
    return withUser(userId, async (client) => {
      const row = (await client.query(
        `SELECT provider, model, local_base_url, system_prompt,
                local_api_key_ciphertext, local_api_key_iv,
                local_api_key_auth_tag, local_api_key_algo,
                local_api_key_key_version, updated_at
         FROM user_agent_settings
         WHERE user_id = current_setting('app.current_user_id')::bigint`
      )).rows[0] as StoredAgentSettings | undefined;
      return row || { ...EMPTY_STORED_SETTINGS };
    });
  }

  // Public settings are deliberately write-only for the token. Callers learn
  // only whether one is saved, never its plaintext or ciphertext.
  async get(userId: number) {
    const stored = await this.getStored(userId);
    return {
      provider: stored.provider,
      model: stored.model,
      local_base_url: stored.local_base_url,
      has_local_api_key: Boolean(stored.local_api_key_ciphertext),
      system_prompt: stored.system_prompt,
      default_system_prompt: defaultSystemPrompt(),
      updated_at: stored.updated_at,
    };
  }

  // Internal-only effective config. The decrypted credential must never be
  // returned from an HTTP/MCP handler or written to a log.
  async getEffective(userId: number) {
    const stored = await this.getStored(userId);
    const provider = VALID_PROVIDERS.has(stored.provider || '') ? stored.provider! : DEFAULT_PROVIDER;
    const local_base_url = stored.local_base_url || DEFAULT_LOCAL_BASE_URL;
    const local_api_key = decryptApiKey(stored);
    const model = stored.model || (await pickInstalledModel(local_base_url, local_api_key)) || FALLBACK_MODEL;
    return {
      provider,
      model,
      local_base_url,
      local_api_key,
      system_prompt: stored.system_prompt || defaultSystemPrompt(),
    };
  }

  // Patch-style upsert: omitted fields are preserved. local_api_key is encrypted
  // when non-empty and all encrypted columns are cleared when it is null/blank.
  async update(userId: number, patch: Record<string, unknown>) {
    const fields = normalize(patch || {});
    if (Object.keys(fields).length === 0) return this.get(userId);

    return withUser(userId, async (client) => {
      const existing = ((await client.query(
        `SELECT provider, model, local_base_url, system_prompt,
                local_api_key_ciphertext, local_api_key_iv,
                local_api_key_auth_tag, local_api_key_algo,
                local_api_key_key_version, updated_at
         FROM user_agent_settings
         WHERE user_id = current_setting('app.current_user_id')::bigint`
      )).rows[0] as StoredAgentSettings | undefined) || { ...EMPTY_STORED_SETTINGS };

      const merged = { ...existing, ...fields };
      if (fields.local_api_key !== undefined) {
        if (fields.local_api_key) {
          const encrypted = encryptSecret(fields.local_api_key);
          merged.local_api_key_ciphertext = encrypted.ciphertext;
          merged.local_api_key_iv = encrypted.iv;
          merged.local_api_key_auth_tag = encrypted.authTag;
          merged.local_api_key_algo = encrypted.algo;
          merged.local_api_key_key_version = 1;
        } else {
          merged.local_api_key_ciphertext = null;
          merged.local_api_key_iv = null;
          merged.local_api_key_auth_tag = null;
          merged.local_api_key_algo = null;
          merged.local_api_key_key_version = null;
        }
      }

      const updated = (await client.query(
        `INSERT INTO user_agent_settings
           (user_id, provider, model, local_base_url, system_prompt,
            local_api_key_ciphertext, local_api_key_iv, local_api_key_auth_tag,
            local_api_key_algo, local_api_key_key_version)
         VALUES (current_setting('app.current_user_id')::bigint,
                 $1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (user_id) DO UPDATE
           SET provider = EXCLUDED.provider,
               model = EXCLUDED.model,
               local_base_url = EXCLUDED.local_base_url,
               system_prompt = EXCLUDED.system_prompt,
               local_api_key_ciphertext = EXCLUDED.local_api_key_ciphertext,
               local_api_key_iv = EXCLUDED.local_api_key_iv,
               local_api_key_auth_tag = EXCLUDED.local_api_key_auth_tag,
               local_api_key_algo = EXCLUDED.local_api_key_algo,
               local_api_key_key_version = EXCLUDED.local_api_key_key_version
         RETURNING updated_at`,
        [
          merged.provider,
          merged.model,
          merged.local_base_url,
          merged.system_prompt,
          merged.local_api_key_ciphertext,
          merged.local_api_key_iv,
          merged.local_api_key_auth_tag,
          merged.local_api_key_algo,
          merged.local_api_key_key_version,
        ]
      )).rows[0];

      return {
        provider: merged.provider,
        model: merged.model,
        local_base_url: merged.local_base_url,
        has_local_api_key: Boolean(merged.local_api_key_ciphertext),
        system_prompt: merged.system_prompt,
        default_system_prompt: defaultSystemPrompt(),
        updated_at: updated?.updated_at ?? null,
      };
    });
  }
}
