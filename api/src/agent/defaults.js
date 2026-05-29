// Centralized agent LLM defaults.
//
// The app ships pointed at a LOCAL LLM — Ollama running on the device itself
// (the machine hosting the app, reached from the container at
// host.docker.internal) — so it works out of the box with no API keys and
// nothing leaving the network. `local` is the only provider: an
// OpenAI-compatible inference server (Ollama, LM Studio, llama.cpp, vLLM).
//
// Precedence at runtime: a user's saved Agent LLM settings win, then these
// env-backed defaults. Override per-deployment with AGENT_PROVIDER /
// AGENT_MODEL / LOCAL_BASE_URL. Point LOCAL_BASE_URL at a LAN address to use
// an inference server on another machine instead of this device.

export const DEFAULT_PROVIDER = process.env.AGENT_PROVIDER || 'local';
export const DEFAULT_MODEL = process.env.AGENT_MODEL || 'gemma4:e4b';
export const DEFAULT_LOCAL_BASE_URL =
  process.env.LOCAL_BASE_URL || 'http://host.docker.internal:11434';
