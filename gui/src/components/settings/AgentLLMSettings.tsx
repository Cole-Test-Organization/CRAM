import { createEffect, createResource, createSignal, Show } from "solid-js";
import { api } from "../../lib/api";
import Button from "../Button";

// Ollama on the machine hosting the app, reached from inside the container.
const DEVICE_URL = "http://host.docker.internal:11434";

export default function AgentLLMSettings() {
    const [agentSettings, { refetch: refetchAgentSettings }] = createResource(
        () => api.getAgentSettings(),
    );

    // "local" is the only provider (an OpenAI-compatible server). What varies
    // is *where* it runs: on this device, or on another machine on the LAN.
    const [location, setLocation] = createSignal<"device" | "lan">("device");
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
        const url = s.local_base_url || "";
        setAgentModel(s.model || "");
        setAgentLocalUrl(url);
        // No URL, or the on-device URL → "this device"; anything else is LAN/remote.
        setLocation(!url || url === DEVICE_URL ? "device" : "lan");
    });

    const saveAgentSettings = async () => {
        setAgentSaving(true);
        setAgentMsg(null);
        try {
            // Device mode always persists the on-device Ollama URL; LAN mode
            // persists whatever address the user typed.
            const url =
                location() === "device" ? DEVICE_URL : agentLocalUrl().trim();
            await api.patchAgentSettings({
                provider: "local",
                model: agentModel().trim() || null,
                local_base_url: url || null,
            });
            setAgentLocalUrl(url);
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
                The in-app agent and background workers (contact enrichment
                formatter, etc.) run on a <strong>local LLM</strong>. By default
                that's <strong>Ollama running on this device</strong> — the
                machine hosting the app. No API keys, and nothing leaves your
                network. Point it at another machine on your LAN instead, or set
                a specific model, below. Stored server-side per user.
            </p>

            <Show
                when={!agentSettings.loading}
                fallback={<div class="text-base-300 text-sm">Loading…</div>}
            >
                <div class="flex flex-col gap-4">
                    <label class="flex flex-col gap-1">
                        <span class="text-[11px] uppercase tracking-wider text-base-300">
                            Where the model runs
                        </span>
                        <select
                            class="input-vintage cursor-pointer"
                            value={location()}
                            onChange={(e) => {
                                const v = e.currentTarget.value as
                                    | "device"
                                    | "lan";
                                setLocation(v);
                                if (v === "device") {
                                    setAgentLocalUrl(DEVICE_URL);
                                } else if (agentLocalUrl() === DEVICE_URL) {
                                    // Clear the device URL so the LAN field starts empty.
                                    setAgentLocalUrl("");
                                }
                            }}
                        >
                            <option value="device">
                                This device (Ollama)
                            </option>
                            <option value="lan">
                                Another machine on my LAN
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
                            onInput={(e) => setAgentModel(e.currentTarget.value)}
                            placeholder="gemma4:e4b"
                        />
                        <span class="text-[10px] text-base-500 mt-1">
                            Any model you've pulled (e.g.{" "}
                            <code class="text-surf-300">gemma4:e4b</code>,{" "}
                            <code class="text-surf-300">gemma4:e4b-mlx</code>,{" "}
                            <code class="text-surf-300">qwen2.5:14b</code>).
                            Leave blank and the app auto-selects one of the
                            models your server has installed.
                        </span>
                    </label>

                    <Show when={location() === "device"}>
                        <div class="text-[10px] text-base-500 border-2 border-base-700 bg-base-950 px-3 py-2">
                            Using Ollama on this device →{" "}
                            <code class="text-surf-300">{DEVICE_URL}</code>. Make
                            sure Ollama is running on the host and the model is
                            pulled (
                            <code class="text-surf-300">
                                ollama pull gemma4:e4b
                            </code>
                            ). Works out of the box on Docker Desktop
                            (Mac/Windows); on Linux the compose file needs the{" "}
                            <code class="text-surf-300">extra_hosts</code>{" "}
                            directive.
                        </div>
                    </Show>

                    <Show when={location() === "lan"}>
                        <label class="flex flex-col gap-1">
                            <span class="text-[11px] uppercase tracking-wider text-base-300">
                                Server URL (LAN / remote)
                            </span>
                            <input
                                type="text"
                                class="input-vintage font-mono"
                                value={agentLocalUrl()}
                                onInput={(e) =>
                                    setAgentLocalUrl(e.currentTarget.value)
                                }
                                placeholder="http://192.168.1.50:11434"
                            />
                            <span class="text-[10px] text-base-500 mt-1">
                                Address of the OpenAI-compatible server (Ollama,
                                LM Studio, llama.cpp, vLLM) on your network.
                                POSTed to{" "}
                                <code class="text-surf-300">
                                    {"{url}/v1/chat/completions"}
                                </code>
                                . Set{" "}
                                <code class="text-surf-300">LOCAL_API_KEY</code>{" "}
                                on the server if your endpoint requires a bearer
                                token.
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
