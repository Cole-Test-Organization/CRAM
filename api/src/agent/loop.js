// Agent orchestration loop. Replaces what `spawn('claude', ...)` was doing
// in api/src/routes/agent/agent.js before the rewrite: own the conversation, call
// the LLM, dispatch tool calls through MCP, loop until the model stops asking
// for tools, persist the result.
//
// Emits Server-Sent Events via the provided `send` callback. Event shape
// matches what the GUI's Agent.tsx already consumes — keep symmetric with
// `messagesToEvents` in services/agent/agent-sessions.js.

import {
    createSession,
    loadSessionRaw,
    saveMessages,
    deriveTitle,
    NUDGE_NOTICE,
} from "../services/agent/agent-sessions.js";
import { buildMcpSession } from "./mcp-client.js";
import { getProvider, listProviders } from "./providers/index.js";
import { FALLBACK_MODEL, DEFAULT_PROVIDER } from "./defaults.js";
import { AgentSettingsService } from "../services/agent/agent-settings.js";
import { logger } from "../lib/logger.js";

const MAX_ITERATIONS = 25;

const MAX_THINKING_ONLY_NUDGES = 3;
const THINKING_ONLY_NUDGE = [
    "You replied with internal reasoning only — no tool call and no written answer.",
    "Internal reasoning is never shown to the user and does not count as responding.",
    "Now do exactly ONE of these: (a) call the appropriate tool to actually perform the action you described, or (b) write a direct, user-facing reply.",
    "Do not produce another reasoning-only turn.",
].join(" ");

// The agent's base system prompt is per-user and configurable (Settings →
// Agent, or PATCH /api/agent/settings). A null stored value falls back to the
// built-in default — see defaultSystemPrompt() in ./defaults.js. Resolved per
// turn (below) so saved edits take effect on the next run without a restart.
const agentSettings = new AgentSettingsService();

function buildUserContent(prompt, notes) {
    if (notes && notes.trim()) {
        return `${prompt}\n\n--- ATTACHED NOTES/EMAILS ---\n${notes}`;
    }
    return prompt;
}

function stringifyMcpResult(result) {
    const parts = (result?.content || []).map((c) => {
        if (typeof c === "string") return c;
        if (c?.type === "text") return c.text;
        return JSON.stringify(c);
    });
    return parts.join("\n");
}

/**
 * Run one agent turn (which may internally fan out into many LLM calls as the
 * model uses tools and we feed results back).
 *
 * @param {object} args
 * @param {number} args.userId       authenticated user
 * @param {string} args.prompt       latest user prompt
 * @param {string} [args.notes]      optional attached notes/emails
 * @param {string} [args.sessionId]  resume an existing session if provided
 * @param {string} [args.provider]   override default provider
 * @param {string} [args.model]      override default model
 * @param {string[]} [args.allowedTools]  restrict MCP tools the model sees.
 *   undefined → all tools; [] → no tools (forces a text-only answer);
 *   ['x','y'] → only those tool names are exposed.
 * @param {(evt:any)=>void} args.
 * send  SSE emitter
 * @param {AbortSignal} [args.signal] cancel from the route when the client disconnects
 */
export async function runAgent({
    userId,
    prompt,
    notes,
    sessionId,
    provider,
    model,
    localBaseUrl,
    allowedTools,
    send,
    signal,
}) {
    const startedAt = Date.now();

    let session = sessionId
        ? await loadSessionRaw(userId, sessionId)
        : await createSession(userId, {
              provider: provider || DEFAULT_PROVIDER,
              model: model || FALLBACK_MODEL,
          });

    send({ type: "session", sessionId: session.id });

    const userContent = buildUserContent(prompt, notes);
    const messages = session.messages.slice();
    messages.push({ role: "user", content: userContent });

    const derivedTitle = session.title ? null : deriveTitle(userContent);

    const { client: mcp, instructions: mcpInstructions } =
        await buildMcpSession({ userId });
    const { tools: allMcpTools } = await mcp.listTools();

    // Compose the system prompt: the user's base prompt (their customization or
    // the built-in default), then today's date injected fresh at runtime — never
    // stored, so it can't go stale even if the user rewrites everything else —
    // then the MCP server's tool/workflow instructions.
    const { system_prompt: baseSystemPrompt } =
        await agentSettings.getEffective(userId);
    const today = new Date().toISOString().slice(0, 10);
    const composedSystem = [
        baseSystemPrompt,
        `Today is ${today}.`,
        mcpInstructions,
    ]
        .filter(Boolean)
        .join("\n\n");

    const mcpTools = Array.isArray(allowedTools)
        ? allMcpTools.filter((t) => allowedTools.includes(t.name))
        : allMcpTools;

    // Resume safety: an older session may carry a provider that's no longer
    // registered (e.g. a legacy value from before the local-only switch).
    // Fall back to the default rather than throwing from getProvider().
    const providerName = listProviders().includes(session.provider)
        ? session.provider
        : DEFAULT_PROVIDER;
    const providerImpl = getProvider(providerName);

    const providerConfig = { baseUrl: localBaseUrl };

    let iter = 0;
    let stopReason = null;
    let consecutiveThinkingOnly = 0;

    try {
        while (iter < MAX_ITERATIONS) {
            iter++;
            if (signal?.aborted) throw new Error("aborted");

            const {
                stopReason: turnStop,
                content,
                usage,
            } = await providerImpl.streamTurn({
                model: session.model,
                system: composedSystem,
                messages,
                mcpTools,
                providerConfig,
                onBlock: (block) => {
                    logger.info(
                        {
                            event: "agent_block",
                            component: "agent_loop",
                            sessionId: session.id,
                            iter,
                            blockType: block.type,
                            blockKeys: Object.keys(block),
                            hasText: !!block.text,
                            textLen: block.text?.length ?? 0,
                            hasThinking: !!block.thinking,
                            thinkingLen: block.thinking?.length ?? 0,
                            toolName: block.name,
                            toolInputKeys: block.input
                                ? Object.keys(block.input)
                                : undefined,
                            preview: (block.text || block.thinking || "").slice(
                                0,
                                120,
                            ),
                        },
                        `agent_block type=${block.type} hasText=${!!block.text} hasThinking=${!!block.thinking} toolName=${block.name || "n/a"}`,
                    );
                    if (block.type === "text" && block.text) {
                        send({ type: "assistant_text", text: block.text });
                    } else if (block.type === "thinking" && block.thinking) {
                        send({ type: "thinking", text: block.thinking });
                    } else if (block.type === "tool_use") {
                        send({
                            type: "tool_use",
                            id: block.id,
                            name: block.name,
                            input: block.input,
                        });
                    }
                },
            });

            // Providers that surface token counts (currently local llama.cpp/vLLM)
            // emit a usage event the GUI uses to render a context-window meter.
            if (usage) {
                send({
                    type: "usage",
                    promptTokens: usage.promptTokens ?? null,
                    completionTokens: usage.completionTokens ?? null,
                    totalTokens: usage.totalTokens ?? null,
                    contextMax: usage.contextMax ?? null,
                });
            }

            messages.push({ role: "assistant", content });
            stopReason = turnStop;

            const toolCalls = content.filter((b) => b.type === "tool_use");
            if (toolCalls.length === 0) {
                // No action this turn. Only accept it as "done" if the model
                // actually produced a user-facing answer. A thinking-only (or
                // empty) turn is the model quitting mid-task — refuse to end on
                // it and nudge it to act or answer.
                const hasVisibleText = content.some(
                    (b) => b.type === "text" && b.text && b.text.trim(),
                );
                if (hasVisibleText) break;

                if (consecutiveThinkingOnly >= MAX_THINKING_ONLY_NUDGES) {
                    logger.warn(
                        {
                            event: "agent_nudge_exhausted",
                            component: "agent_loop",
                            sessionId: session.id,
                            iter,
                            nudges: consecutiveThinkingOnly,
                        },
                        `agent_nudge_exhausted after ${consecutiveThinkingOnly} nudges`,
                    );
                    send({
                        type: "error",
                        message: `The model kept responding with only internal reasoning — no answer or tool call — after ${MAX_THINKING_ONLY_NUDGES} prompts to act. Try a more capable model (Settings → Agent LLM).`,
                    });
                    break;
                }

                consecutiveThinkingOnly++;
                logger.warn(
                    {
                        event: "agent_nudge",
                        component: "agent_loop",
                        sessionId: session.id,
                        iter,
                        nudge: consecutiveThinkingOnly,
                    },
                    `agent_nudge: thinking-only turn, nudging model (${consecutiveThinkingOnly}/${MAX_THINKING_ONLY_NUDGES})`,
                );
                send({ type: "notice", level: "nudge", message: NUDGE_NOTICE });
                messages.push({
                    role: "user",
                    content: THINKING_ONLY_NUDGE,
                    // Synthetic prompt the loop injected — not user-authored.
                    // Persisted so a resumed session replays the same context to
                    // the model, but messagesToEvents renders it as a `notice`,
                    // never a "You" bubble. The provider sees it as a plain user
                    // turn (it reads role+content only; `internal` is ignored).
                    internal: true,
                });
                continue;
            }

            // Reached only when the model made a real tool call — that's
            // progress, so clear the reasoning-only stall counter.
            consecutiveThinkingOnly = 0;

            // Dispatch tool calls through the MCP client. Sequential for now — the
            // model rarely fans out and parallelizing would complicate per-call
            // RLS/state if we ever needed it.
            const toolResults = [];
            for (const call of toolCalls) {
                if (signal?.aborted) throw new Error("aborted");
                let text;
                let isError = false;
                try {
                    const result = await mcp.callTool({
                        name: call.name,
                        arguments: call.input,
                    });
                    text = stringifyMcpResult(result);
                    isError = result?.isError === true;
                } catch (err) {
                    text = `Tool error: ${err.message || String(err)}`;
                    isError = true;
                }
                send({
                    type: "tool_result",
                    toolUseId: call.id,
                    content: text,
                    isError,
                });
                toolResults.push({
                    type: "tool_result",
                    tool_use_id: call.id,
                    content: text,
                    is_error: isError,
                });
            }
            messages.push({ role: "user", content: toolResults });
        }

        if (iter >= MAX_ITERATIONS) {
            send({
                type: "error",
                message: `Stopped: hit max iterations (${MAX_ITERATIONS})`,
            });
        }
    } finally {
        try {
            await saveMessages(userId, session.id, messages, derivedTitle);
        } catch (err) {
            send({
                type: "error",
                message: `Failed to save session: ${err.message || String(err)}`,
            });
        }
    }

    send({
        type: "done",
        durationMs: Date.now() - startedAt,
        stopReason: stopReason || undefined,
    });
}
