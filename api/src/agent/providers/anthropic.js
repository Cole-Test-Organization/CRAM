// Anthropic Messages API adapter. Streams a single LLM turn (one call —
// possibly returning multiple content blocks including text, thinking, and
// tool_use). The loop wraps this in a while(toolCalls > 0) cycle.
//
// Prompt caching: the system prompt and full tool list get a cache breakpoint.
// The conversation history is not currently cached per-turn — easy follow-up
// when sessions start getting long enough to matter.

import Anthropic from '@anthropic-ai/sdk';

let client = null;
function getClient() {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  client = new Anthropic({ apiKey });
  return client;
}

function attachLastCacheBreakpoint(items) {
  if (!items.length) return items;
  const copy = items.slice(0, -1);
  const last = items[items.length - 1];
  copy.push({ ...last, cache_control: { type: 'ephemeral' } });
  return copy;
}

// Convert MCP tool descriptors → Anthropic tool definitions.
function toAnthropicTools(mcpTools) {
  return mcpTools.map((t) => ({
    name: t.name,
    description: t.description ?? '',
    input_schema: t.inputSchema || { type: 'object', properties: {} },
  }));
}

/**
 * Stream one LLM turn.
 *
 * @param {object} args
 * @param {string} args.model
 * @param {string} args.system
 * @param {Array}  args.messages   Anthropic-format messages array
 * @param {Array}  args.mcpTools   Raw tools from MCP listTools()
 * @param {(block:any)=>void} args.onBlock  Called once per completed content block
 * @returns {Promise<{ stopReason: string, content: any[] }>}
 */
export async function streamTurn({ model, system, messages, mcpTools, onBlock }) {
  const anthropic = getClient();
  // Anthropic rejects an empty `tools` array — omit the field entirely when
  // the caller restricted tools to none.
  const hasTools = Array.isArray(mcpTools) && mcpTools.length > 0;
  const tools = hasTools ? attachLastCacheBreakpoint(toAnthropicTools(mcpTools)) : null;
  const systemBlocks = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];

  const content = [];
  let stopReason = null;
  let current = null;
  let toolJsonBuf = '';

  const streamRequest = {
    model,
    max_tokens: 4096,
    system: systemBlocks,
    messages,
  };
  if (tools) streamRequest.tools = tools;

  const stream = anthropic.messages.stream(streamRequest);

  for await (const evt of stream) {
    switch (evt.type) {
      case 'content_block_start':
        current = { ...evt.content_block };
        toolJsonBuf = '';
        if (current.type === 'text' && current.text === undefined) current.text = '';
        if (current.type === 'thinking' && current.thinking === undefined) current.thinking = '';
        break;

      case 'content_block_delta':
        if (!current) break;
        if (evt.delta.type === 'text_delta') {
          current.text += evt.delta.text;
        } else if (evt.delta.type === 'thinking_delta') {
          current.thinking += evt.delta.thinking;
        } else if (evt.delta.type === 'input_json_delta') {
          toolJsonBuf += evt.delta.partial_json;
        }
        break;

      case 'content_block_stop':
        if (current?.type === 'tool_use') {
          try {
            current.input = toolJsonBuf ? JSON.parse(toolJsonBuf) : {};
          } catch {
            current.input = {};
          }
        }
        if (current) {
          content.push(current);
          onBlock?.(current);
        }
        current = null;
        toolJsonBuf = '';
        break;

      case 'message_delta':
        if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
        break;

      default:
        break;
    }
  }

  return { stopReason, content };
}
