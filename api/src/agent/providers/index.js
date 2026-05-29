// Provider registry. Each provider exports streamTurn({ model, system, messages, mcpTools, onBlock }).
// Adding a new provider = drop a sibling file and add a case here.

import * as local from "./local.js";

// `local` is the only provider: an OpenAI-compatible inference server
// (Ollama, LM Studio, llama.cpp, vLLM). Add a sibling file + entry to support
// another backend.
const PROVIDERS = {
    local,
};

export function getProvider(name) {
    const p = PROVIDERS[name];
    if (!p) throw new Error(`Unknown provider: ${name}`);
    return p;
}

export function listProviders() {
    return Object.keys(PROVIDERS);
}
