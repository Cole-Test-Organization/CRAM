import { createEffect, createResource, createSignal, Show } from "solid-js";
import { api } from "../../lib/api";
import Button from "../Button";

export default function AgentLLMSettings() {
    const [agentSettings, { refetch: refetchAgentSettings }] = createResource(
        () => api.getAgentSettings(),
    );

    const [agentProvider, setAgentProvider] = createSignal<
        "anthropic" | "local" | ""
    >("");
    const [agentModel, setAgentModel] = createSignal("");
    const [agentLocalUrl, setAgentLocalUrl] = createSignal("");
    const [agentSaving, setAgentSaving] = createSignal(false);
    const [agentMsg, setAgentMsg] = createSignal<{
        kind: "ok" | "err";
        text: string;
    } | null>(null);

    createEffect(() => {
        const s = agentSettings();
        if (!s) return;
        setAgentProvider((s.provider as any) || "");
        setAgentModel(s.model || "");
        setAgentLocalUrl(s.local_base_url || "");
    });

    const saveAgentSettings = async () => {
        setAgentSaving(true);
        setAgentMsg(null);
        try {
            await api.patchAgentSettings({
                provider: agentProvider() || null,
                model: agentModel().trim() || null,
                local_base_url: agentLocalUrl().trim() || null,
            });
            await refetchAgentSettings();
            setAgentMsg({ kind: "ok", text: "Agent settings saved" });
            setTimeout(() => setAgentMsg(null), 4000);
        } catch (err: any) {
            setAgentMsg({ kind: "err", text: err?.message || "Save failed" });
        } finally {
            setAgentSaving(false);
        }
    };

    return (
        <div class="panel panel-accent p-5">
            <h2 class="text-[15px] font-bold uppercase tracking-widest text-surf-300 mb-4 font-[family-name:var(--font-display)]">
                Agent LLM
            </h2>

            <p class="text-base-300 text-[12px] mb-4">
                Provider + model used by the in-app agent and by background
                workers (contact enrichment formatter, etc.). Stored
                server-side per user — replaces the old browser-localStorage
                state on the Agent page.
            </p>

            <Show
                when={!agentSettings.loading}
                fallback={<div class="text-base-300 text-sm">Loading…</div>}
            >
                <div class="flex flex-col gap-4">
                    <label class="flex flex-col gap-1">
                        <span class="text-[11px] uppercase tracking-wider text-base-300">
                            Provider
                        </span>
                        <select
                            class="input-vintage cursor-pointer"
                            value={agentProvider()}
                            onChange={(e) =>
                                setAgentProvider(e.currentTarget.value as any)
                            }
                        >
                            <option value="">(server default)</option>
                            <option value="anthropic">Anthropic</option>
                            <option value="local">
                                Local (OpenAI-compatible)
                            </option>
                        </select>
                    </label>

                    <label class="flex flex-col gap-1">
                        <span class="text-[11px] uppercase tracking-wider text-base-300">
                            Model
                        </span>
                        <input
                            type="text"
                            class="input-vintage font-mono"
                            value={agentModel()}
                            onInput={(e) =>
                                setAgentModel(e.currentTarget.value)
                            }
                            placeholder={
                                agentProvider() === "local"
                                    ? "e.g. qwen2.5-coder:32b"
                                    : agentProvider() === "anthropic"
                                      ? "claude-sonnet-4-6"
                                      : "(server default)"
                            }
                        />
                    </label>

                    <Show when={agentProvider() === "local"}>
                        <label class="flex flex-col gap-1">
                            <span class="text-[11px] uppercase tracking-wider text-base-300">
                                Local server URL
                            </span>
                            <input
                                type="text"
                                class="input-vintage font-mono"
                                value={agentLocalUrl()}
                                onInput={(e) =>
                                    setAgentLocalUrl(e.currentTarget.value)
                                }
                                placeholder="http://host.docker.internal:11434"
                            />
                            <div class="flex flex-wrap gap-2 mt-1">
                                <button
                                    type="button"
                                    class="border-2 border-base-500 bg-base-950 hover:border-surf-300 hover:text-surf-200 text-base-300 text-[10px] uppercase tracking-widest px-2 py-1 transition-colors"
                                    onClick={() =>
                                        setAgentLocalUrl(
                                            "http://host.docker.internal:11434",
                                        )
                                    }
                                >
                                    Docker host · Ollama
                                </button>
                                <button
                                    type="button"
                                    class="border-2 border-base-500 bg-base-950 hover:border-surf-300 hover:text-surf-200 text-base-300 text-[10px] uppercase tracking-widest px-2 py-1 transition-colors"
                                    onClick={() =>
                                        setAgentLocalUrl(
                                            "http://host.docker.internal:1234",
                                        )
                                    }
                                >
                                    Docker host · LM Studio
                                </button>
                                <Show when={agentLocalUrl()}>
                                    <button
                                        type="button"
                                        class="border-2 border-base-700 bg-base-950 hover:border-base-400 text-base-500 hover:text-base-300 text-[10px] uppercase tracking-widest px-2 py-1 transition-colors"
                                        onClick={() => setAgentLocalUrl("")}
                                    >
                                        Clear
                                    </button>
                                </Show>
                            </div>
                            <span class="text-[10px] text-base-500 mt-1">
                                POSTed to{" "}
                                <code class="text-surf-300">
                                    {"{url}/v1/chat/completions"}
                                </code>
                                .{" "}
                                <strong class="text-base-300">
                                    Docker host
                                </strong>{" "}
                                presets target an inference server running on
                                the Docker host machine (works on Docker
                                Desktop; on Linux requires the{" "}
                                <code class="text-surf-300">extra_hosts</code>{" "}
                                directive in compose).
                            </span>
                        </label>
                    </Show>

                    <Show when={agentMsg()}>
                        {(msg) => (
                            <div
                                class={`text-[12px] font-semibold ${msg().kind === "ok" ? "text-surf-300" : "text-scarlet-400"}`}
                            >
                                {msg().text}
                            </div>
                        )}
                    </Show>

                    <div>
                        <Button
                            variant="primary"
                            disabled={agentSaving()}
                            onClick={saveAgentSettings}
                        >
                            {agentSaving() ? "Saving…" : "Save"}
                        </Button>
                    </div>
                </div>
            </Show>
        </div>
    );
}
