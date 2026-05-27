// Provider registry. Each provider exports streamTurn({ model, system, messages, mcpTools, onBlock }).
// Adding a new provider = drop a sibling file and add a case here.

import * as anthropic from "./anthropic.js";
import * as local from "./local.js";

const PROVIDERS = {
    anthropic,
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
