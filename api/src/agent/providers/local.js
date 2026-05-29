// OpenAI-compatible local LLM adapter (Ollama, llama-cpp, vLLM, LM Studio, etc.).
// Converts the loop's canonical message/tool shape to the OpenAI Chat
// Completions shape at the boundary so the loop and persisted sessions stay
// backend-agnostic.
//
// Streaming UX: OpenAI's streaming format lacks an explicit block-boundary
// event, so blocks are emitted via onBlock at end-of-stream. The GUI sees no
// incremental output for a local-provider turn — acceptable for now.
//
// Env: LOCAL_BASE_URL (required, e.g. http://192.168.1.50:8080),
//      LOCAL_API_KEY (optional, sent as Bearer if set).
//
// TLS: we use an undici dispatcher with rejectUnauthorized:false so HTTPS
// endpoints with self-signed or wrong-hostname certs work on a LAN. HTTP URLs
// are unaffected. This is deliberate for personal/LAN use — DO NOT reuse this
// dispatcher for any provider that hits a public endpoint.

import { Agent } from 'undici';

let insecureDispatcher = null;
function getInsecureDispatcher() {
  if (!insecureDispatcher) {
    insecureDispatcher = new Agent({
      connect: { rejectUnauthorized: false },
      // LAN inference servers advertise a short keep-alive (llama.cpp sends
      // `Keep-Alive: timeout=5`). Keep our idle window well under that so *we*
      // retire pooled sockets before the server does — otherwise undici can
      // write the next turn onto a socket the server has already closed, which
      // surfaces as `read ECONNRESET`. keepAliveMaxTimeout also clamps the
      // server's hint down (undici would otherwise honor it up to 10min). This
      // narrows the idle-reuse race; the retry in streamTurn() is what actually
      // recovers the post-stream-close case, which no timeout tuning prevents.
      keepAliveTimeout: 2500,
      keepAliveMaxTimeout: 2500,
    });
  }
  return insecureDispatcher;
}

// Different local backends expose context size differently:
//   - llama.cpp:  GET /props → n_ctx
//   - Ollama:     POST /api/show {name} → parameters' num_ctx (loaded) or
//                 model_info["<arch>.context_length"] (model max)
//   - vLLM / LM Studio / OpenAI proper: no portable way → null
//
// Cache by baseUrl + model: different Ollama models on the same daemon have
// different context windows, so the model has to be part of the key. null
// means "we tried and got nothing" — still cached to avoid retry storms.
const contextSizeCache = new Map();

function cacheKey(baseUrl, model) {
  return `${baseUrl}|${model || ''}`;
}

// List the model ids the configured server has available, via the
// OpenAI-standard GET /v1/models (Ollama, LM Studio, vLLM, llama.cpp all
// expose it). Lets us resolve a default from what's actually installed instead
// of guessing by OS. Cached briefly per baseUrl; returns [] on any failure so
// the caller can fall back to a static tag.
const MODELS_TTL_MS = 60_000;
const modelsCache = new Map();

export async function listModels(baseUrl) {
  if (!baseUrl) return [];
  const root = baseUrl.replace(/\/+$/, '');
  const hit = modelsCache.get(root);
  if (hit && Date.now() - hit.at < MODELS_TTL_MS) return hit.models;
  const headers = {};
  if (process.env.LOCAL_API_KEY) headers['Authorization'] = `Bearer ${process.env.LOCAL_API_KEY}`;
  let models = [];
  try {
    const res = await fetch(`${root}/v1/models`, {
      headers,
      dispatcher: getInsecureDispatcher(),
    });
    if (res.ok) {
      const json = await res.json();
      models = Array.isArray(json?.data)
        ? json.data.map((m) => m?.id).filter((id) => typeof id === 'string' && id)
        : [];
    }
  } catch {
    models = [];
  }
  modelsCache.set(root, { at: Date.now(), models });
  return models;
}

async function probeLlamaCpp(baseUrl, headers) {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/props`, {
      headers,
      dispatcher: getInsecureDispatcher(),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const candidate =
      json?.n_ctx ??
      json?.default_generation_settings?.n_ctx ??
      json?.default_generation_settings?.ctx_size ??
      null;
    return typeof candidate === 'number' && candidate > 0 ? candidate : null;
  } catch {
    return null;
  }
}

// Ollama reports the model's architectural max (often 128k+), but at runtime
// it loads with a much smaller `num_ctx` (2048/4096 by default) unless the
// modelfile overrides it. Cap so the meter reflects something closer to what
// the GPU can actually hold rather than the theoretical ceiling. Override
// with the OLLAMA_CONTEXT_CAP env var if you've allocated more.
//
// This cap is Ollama-only on purpose: llama.cpp's /props returns the actual
// loaded n_ctx (you set it at server startup with -c), so there's nothing to
// cap there — the reported number already matches reality.
const OLLAMA_CONTEXT_CAP = Number(process.env.OLLAMA_CONTEXT_CAP) || 65536;

async function probeOllama(baseUrl, headers, model) {
  if (!model) return null;
  const root = baseUrl.replace(/\/$/, '');
  try {
    // Cheap signature check — confirms this is Ollama before we POST.
    const ver = await fetch(`${root}/api/version`, {
      headers,
      dispatcher: getInsecureDispatcher(),
    });
    if (!ver.ok) return null;
  } catch {
    return null;
  }
  try {
    const res = await fetch(`${root}/api/show`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model }),
      dispatcher: getInsecureDispatcher(),
    });
    if (!res.ok) return null;
    const json = await res.json();
    // `parameters` is a newline-separated text blob like `num_ctx 4096\nstop "[INST]"`.
    // If num_ctx is set in the modelfile it overrides the model's architectural
    // max, so prefer it.
    if (typeof json?.parameters === 'string') {
      const m = json.parameters.match(/^\s*num_ctx\s+(\d+)\s*$/m);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > 0) return Math.min(n, OLLAMA_CONTEXT_CAP);
      }
    }
    // Otherwise fall back to the architectural context length. The key is
    // namespaced by arch (e.g. `llama.context_length`, `qwen2.context_length`),
    // so look for any key ending in `.context_length`.
    const info = json?.model_info;
    if (info && typeof info === 'object') {
      for (const [k, v] of Object.entries(info)) {
        if (k.endsWith('.context_length') && typeof v === 'number' && v > 0) {
          return Math.min(v, OLLAMA_CONTEXT_CAP);
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchContextSize(baseUrl, headers, model) {
  const key = cacheKey(baseUrl, model);
  if (contextSizeCache.has(key)) return contextSizeCache.get(key);
  let n = await probeLlamaCpp(baseUrl, headers);
  if (n == null) n = await probeOllama(baseUrl, headers, model);
  contextSizeCache.set(key, n);
  return n;
}

function toOpenAIMessages(system, messages) {
  const out = [];
  if (system) out.push({ role: 'system', content: system });

  for (const msg of messages) {
    const content = msg.content;

    if (msg.role === 'user') {
      if (typeof content === 'string') {
        out.push({ role: 'user', content });
        continue;
      }
      if (Array.isArray(content)) {
        // tool_result blocks become their own role:tool messages; text blocks
        // are joined into one role:user message.
        const textParts = [];
        for (const c of content) {
          if (c?.type === 'tool_result') {
            const text = typeof c.content === 'string' ? c.content : JSON.stringify(c.content);
            out.push({ role: 'tool', tool_call_id: c.tool_use_id, content: text });
          } else if (c?.type === 'text' && c.text) {
            textParts.push(c.text);
          }
        }
        if (textParts.length > 0) out.push({ role: 'user', content: textParts.join('\n') });
      }
      continue;
    }

    if (msg.role === 'assistant' && Array.isArray(content)) {
      const textParts = [];
      const toolCalls = [];
      for (const c of content) {
        if (c?.type === 'text' && c.text) {
          textParts.push(c.text);
        } else if (c?.type === 'tool_use') {
          toolCalls.push({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: JSON.stringify(c.input || {}) },
          });
        }
        // thinking blocks: not representable in OpenAI, drop silently.
      }
      const assistant = {
        role: 'assistant',
        // OpenAI permits null content only when tool_calls is present. A bare
        // assistant turn with neither text nor tool calls — e.g. a thinking-only
        // turn whose reasoning was dropped just above — must carry a string, or
        // stricter servers (vLLM) 400 the next request. These turns now get
        // re-sent within a run: loop.js's thinking-only guard injects a nudge
        // and continues instead of ending on them.
        content: textParts.length
          ? textParts.join('\n')
          : toolCalls.length
            ? null
            : '',
      };
      if (toolCalls.length) assistant.tool_calls = toolCalls;
      out.push(assistant);
    }
  }
  return out;
}

function toOpenAITools(mcpTools) {
  return mcpTools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description || '',
      parameters: t.inputSchema || { type: 'object', properties: {} },
    },
  }));
}

// Translate OpenAI finish_reason → the loop's canonical stop_reason.
// Unknown values pass through unchanged.
const FINISH_REASON_MAP = {
  stop: 'end_turn',
  tool_calls: 'tool_use',
  length: 'max_tokens',
  content_filter: 'stop_sequence',
};

// Socket-level failures that are safe to retry on a fresh connection. They come
// from undici/Node *before* the model produces any tokens, so re-issuing the
// identical request is idempotent. The case that bit session 44462ea7: the LAN
// llama.cpp box closes a keep-alive socket right after a streamed response and
// undici reuses it before noticing the close → `read ECONNRESET`.
const RETRYABLE_NET_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
]);

function isRetryableNetworkError(err) {
  // fetch() reports `TypeError: fetch failed` and stashes the real socket error
  // (which carries .code) on err.cause.
  const code = err?.cause?.code || err?.code;
  if (code && RETRYABLE_NET_CODES.has(code)) return true;
  // Some resets only surface as a message with no code.
  return /fetch failed|other side closed|socket hang up/i.test(err?.message || '');
}

const MAX_STREAM_ATTEMPTS = 3; // 1 try + 2 retries

// Public entry point. Retries transient transport resets against the local
// inference server, re-sending the *same* system + messages each attempt — the
// full conversation up to this turn is replayed, not restarted (the caller's
// `messages` array is only appended to after a turn succeeds, so a thrown turn
// leaves it untouched). Only genuine socket failures are retried; HTTP 4xx/5xx
// and aborts pass straight through. Retrying the whole turn is safe because
// streamTurnOnce has no observable side effects until it succeeds — onBlock
// fires only after the stream fully drains.
export async function streamTurn(args) {
  for (let attempt = 1; attempt <= MAX_STREAM_ATTEMPTS; attempt++) {
    try {
      return await streamTurnOnce(args);
    } catch (err) {
      const code = err?.cause?.code || err?.message;
      if (!isRetryableNetworkError(err) || attempt === MAX_STREAM_ATTEMPTS) {
        if (attempt > 1) {
          console.error(`[local provider] stream failed after ${attempt} attempt(s): ${code}`);
        }
        throw err;
      }
      const backoffMs = 300 * attempt; // 300ms, then 600ms
      console.warn(
        `[local provider] stream reset (${code}); retry ${attempt}/${MAX_STREAM_ATTEMPTS - 1} ` +
        `with full context after ${backoffMs}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
}

async function streamTurnOnce({ model, system, messages, mcpTools, onBlock, providerConfig, timeoutMs }) {
  // Per-request override (set from the GUI Settings panel) takes precedence
  // over the env var so users can point at their own LAN box without restart.
  const baseUrl = providerConfig?.baseUrl || process.env.LOCAL_BASE_URL;
  if (!baseUrl) throw new Error('No local LLM base URL — set LOCAL_BASE_URL env or pass localBaseUrl in the request');

  const url = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.LOCAL_API_KEY) {
    headers['Authorization'] = `Bearer ${process.env.LOCAL_API_KEY}`;
  }

  const openaiMessages = toOpenAIMessages(system, messages);
  const tools = toOpenAITools(mcpTools);

  const body = {
    model,
    messages: openaiMessages,
    stream: true,
    // Asks the server to emit a final SSE chunk with token counts. llama.cpp
    // and vLLM both honor this; servers that don't will just ignore it and we
    // get no usage data (the GUI hides the meter in that case).
    stream_options: { include_usage: true },
    // Ollama-specific: thinking-capable models strip <think>…</think> from the
    // /v1/chat/completions response by default. Set think:true to receive it
    // in delta.reasoning_content (which the parser below already handles).
    // Non-Ollama servers (vLLM, LM Studio, llama.cpp) ignore unknown fields,
    // so this is safe to leave on for everyone.
    think: true,
  };
  if (tools.length > 0) body.tools = tools;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    dispatcher: getInsecureDispatcher(),
    // Opt-in overall timeout. When set, an unresponsive server (no headers, or
    // a stalled stream mid-response) aborts so the caller can retry instead of
    // hanging forever. Aborting the fetch also cancels the body stream below,
    // so reader.read() rejects. Left unset by the interactive agent loop, whose
    // turns can legitimately run long while the user watches.
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Local LLM error ${res.status}: ${text.slice(0, 300)}`);
  }
  if (!res.body) throw new Error('Local LLM returned no response body');

  let textBuf = '';
  // llama.cpp (and other DeepSeek-style servers) split <think>…</think> off
  // into delta.reasoning_content. Vanilla OpenAI doesn't send this field, so
  // it stays empty there.
  //
  // Ollama's /v1/chat/completions doesn't emit reasoning_content either; for
  // thinking-capable models it inlines <think>…</think> directly in
  // delta.content. We split those out into thinkingBuf below so the GUI gets a
  // proper thinking block. Tags may be split across deltas, so we run a small
  // state machine: `inThink` tracks which buffer we're filling, and
  // `tagPending` holds the trailing bytes of the current delta-tail that
  // could be the prefix of a tag (so we don't accidentally flush half of
  // "</think>" into the wrong bucket).
  let thinkingBuf = '';
  let inThink = false;
  let tagPending = '';
  const OPEN = '<think>';
  const CLOSE = '</think>';

  function consumeContent(chunk) {
    tagPending += chunk;
    while (true) {
      if (inThink) {
        const idx = tagPending.indexOf(CLOSE);
        if (idx !== -1) {
          thinkingBuf += tagPending.slice(0, idx);
          tagPending = tagPending.slice(idx + CLOSE.length);
          inThink = false;
          continue;
        }
        const safe = Math.max(0, tagPending.length - (CLOSE.length - 1));
        thinkingBuf += tagPending.slice(0, safe);
        tagPending = tagPending.slice(safe);
        return;
      }
      const idx = tagPending.indexOf(OPEN);
      if (idx !== -1) {
        textBuf += tagPending.slice(0, idx);
        tagPending = tagPending.slice(idx + OPEN.length);
        inThink = true;
        continue;
      }
      const safe = Math.max(0, tagPending.length - (OPEN.length - 1));
      textBuf += tagPending.slice(0, safe);
      tagPending = tagPending.slice(safe);
      return;
    }
  }

  // tool_calls stream as deltas keyed by `index`; accumulate until end-of-stream.
  const toolCallAcc = new Map();
  let finishReason = null;
  let usage = null;
  // Diagnostic: collect the union of keys seen across all `delta` objects in
  // this turn so we can tell whether the server is sending us
  // `reasoning_content`, an inline `<think>` in `content`, something exotic,
  // or nothing at all. Surfaced in the turn-done log line below.
  const deltaKeysSeen = new Set();
  let firstChunkRaw = null;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let sseBuf = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    sseBuf += decoder.decode(value, { stream: true });

    const lines = sseBuf.split('\n');
    sseBuf = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      let chunk;
      try { chunk = JSON.parse(payload); } catch { continue; }

      // The final include_usage chunk carries usage at the top level and an
      // empty choices array. Grab it before the no-choice early-out below.
      if (chunk.usage && typeof chunk.usage === 'object') {
        usage = chunk.usage;
      }

      const choice = chunk.choices?.[0];
      if (!choice) continue;

      const delta = choice.delta || {};
      for (const k of Object.keys(delta)) deltaKeysSeen.add(k);
      if (firstChunkRaw === null) firstChunkRaw = JSON.stringify(chunk).slice(0, 400);
      if (typeof delta.content === 'string') consumeContent(delta.content);
      // Thinking shows up under different field names depending on the server:
      //   - llama.cpp / vLLM (DeepSeek convention): `reasoning_content`
      //   - Ollama (/v1/chat/completions with think:true): `reasoning`
      // Accept both; servers that emit neither just leave thinkingBuf empty.
      if (typeof delta.reasoning_content === 'string') thinkingBuf += delta.reasoning_content;
      if (typeof delta.reasoning === 'string') thinkingBuf += delta.reasoning;
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          let acc = toolCallAcc.get(idx);
          if (!acc) {
            acc = { id: '', name: '', argsBuf: '' };
            toolCallAcc.set(idx, acc);
          }
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name += tc.function.name;
          if (typeof tc.function?.arguments === 'string') acc.argsBuf += tc.function.arguments;
        }
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
  }

  // Flush any trailing bytes that were held back in case they were a partial
  // tag (they weren't — the stream ended).
  if (tagPending.length > 0) {
    if (inThink) thinkingBuf += tagPending;
    else textBuf += tagPending;
    tagPending = '';
  }

  console.log(`[local provider] turn done: text=${textBuf.length}ch thinking=${thinkingBuf.length}ch toolCalls=${toolCallAcc.size} finishReason=${finishReason} deltaKeys=[${[...deltaKeysSeen].join(',')}] firstChunk=${firstChunkRaw}`);

  const content = [];

  // Order matters: thinking before text so the GUI renders the reasoning
  // bubble above the answer.
  if (thinkingBuf) {
    const block = { type: 'thinking', thinking: thinkingBuf };
    content.push(block);
    onBlock?.(block);
  }

  if (textBuf) {
    const block = { type: 'text', text: textBuf };
    content.push(block);
    onBlock?.(block);
  }

  const sortedToolCalls = [...toolCallAcc.entries()].sort(([a], [b]) => a - b);
  for (const [, tc] of sortedToolCalls) {
    let input;
    try { input = tc.argsBuf ? JSON.parse(tc.argsBuf) : {}; } catch { input = {}; }
    const block = {
      type: 'tool_use',
      id: tc.id || `local_${Math.random().toString(36).slice(2, 12)}`,
      name: tc.name,
      input,
    };
    content.push(block);
    onBlock?.(block);
  }

  let usageOut = null;
  if (usage) {
    const contextMax = await fetchContextSize(baseUrl, headers, model);
    usageOut = {
      promptTokens: usage.prompt_tokens ?? null,
      completionTokens: usage.completion_tokens ?? null,
      totalTokens: usage.total_tokens ?? null,
      contextMax,
    };
  }

  return { stopReason: FINISH_REASON_MAP[finishReason] || finishReason, content, usage: usageOut };
}
