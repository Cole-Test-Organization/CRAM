// Centralized agent LLM defaults.
//
// The app ships pointed at a LOCAL LLM — Ollama running on the device itself
// (the machine hosting the app, reached from the container at
// host.docker.internal) — so it works out of the box with no API keys and
// nothing leaving the network. `local` is the only provider: an
// OpenAI-compatible inference server (Ollama, LM Studio, llama.cpp, vLLM).
//
// Precedence at runtime: a user's saved Agent LLM settings (DB) win, then these
// env-backed defaults for the provider and server URL. Point LOCAL_BASE_URL at
// a LAN address to use an inference server on another machine.
//
// The default *model* is deliberately NOT an env knob: when a user hasn't
// chosen one, it's resolved from whatever the configured server actually has
// installed (see getEffective in services/agent/agent-settings.js), with
// FALLBACK_MODEL below as the last resort if the server can't be reached.

import { getConfig } from '../config.js';

export const DEFAULT_PROVIDER = process.env.AGENT_PROVIDER || 'local';
export const DEFAULT_LOCAL_BASE_URL =
  process.env.LOCAL_BASE_URL || 'http://host.docker.internal:11434';

// Last-resort model tag, used only if the user hasn't picked one AND the
// server's installed models can't be listed. The model is a per-user DB
// setting or resolved live from the server — never a deploy-time env var.
export const FALLBACK_MODEL = 'gemma4:e4b';

// The built-in agent system prompt — the base persona/instructions the in-app
// agent runs with when the user hasn't customized it. Stored per-user (nullable
// system_prompt column on user_agent_settings); NULL falls back to this.
//
// Computed live (not seeded into the DB) so it always reflects the deployment's
// VENDOR_NAME / USER_ROLE. Deliberately carries NO date — the current date is
// injected separately at runtime in loop.js so it stays fresh even when the user
// fully customizes this text. Keep it free of volatile/runtime context for the
// same reason.
export function defaultSystemPrompt() {
  const { vendorName, userRole } = getConfig();
  return [
    `You are a CRM assistant for a ${userRole} at ${vendorName}.`,
    '',
    'Use the available tools for all data access and updates — never instruct the user to do something a tool can do directly. Workflow guidance for each tool family is delivered by the MCP server itself.',
    '',
    'Respond concisely — no process narration.',
  ].join('\n');
}
