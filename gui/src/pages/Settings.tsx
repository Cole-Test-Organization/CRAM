import { createSignal, Show } from "solid-js";
import AgentLLMSettings from "../components/settings/AgentLLMSettings";
import SystemPromptSettings from "../components/settings/SystemPromptSettings";
import NewsRankingSettings from "../components/settings/NewsRankingSettings";
import InternalDomainsSettings from "../components/settings/InternalDomainsSettings";
import BackupSettings from "../components/settings/BackupSettings";
import ThemePicker from "../components/settings/ThemePicker";
import MemoryManager from "../components/settings/MemoryManager";
import { isCramMobile, openMobileSettings } from "../lib/mobile";

export default function Settings() {
    const [statusMsg, setStatusMsg] = createSignal<{
        kind: "ok" | "err";
        text: string;
    } | null>(null);

    const flash = (kind: "ok" | "err", text: string) => {
        setStatusMsg({ kind, text });
        setTimeout(() => setStatusMsg(null), 5000);
    };

    return (
        <div>
            <div class="flex flex-col gap-3 mb-6 md:flex-row md:justify-between md:items-center">
                <h1 class="text-[26px] font-bold font-[family-name:var(--font-display)]">
                    Settings
                </h1>
            </div>

            <Show when={statusMsg()}>
                {(msg) => (
                    <div
                        class={`mb-4 p-3 border-2 text-[12px] ${
                            msg().kind === "ok"
                                ? "border-surf-500/50 bg-surf-500/10 text-surf-300"
                                : "border-scarlet-500/50 bg-scarlet-500/10 text-scarlet-300"
                        }`}
                    >
                        {msg().text}
                    </div>
                )}
            </Show>

            <div class="grid grid-cols-1 gap-6 md:grid-cols-2">
                <Show when={isCramMobile()}>
                    <section class="panel p-5">
                        <h2 class="text-[15px] font-bold mb-2">Mobile app</h2>
                        <p class="text-[12px] text-base-300 leading-relaxed mb-4">
                            Change the CRAM server used by this device or review its endpoint-specific offline storage.
                        </p>
                        <button
                            type="button"
                            class="press press-primary press-sm"
                            onClick={() => {
                                void openMobileSettings().catch((error: unknown) => {
                                    flash("err", error instanceof Error ? error.message : "Could not open mobile settings.");
                                });
                            }}
                        >
                            Open mobile settings
                        </button>
                    </section>
                </Show>
                <AgentLLMSettings />
                <SystemPromptSettings />
                <NewsRankingSettings />
                <MemoryManager />
                <InternalDomainsSettings />
                <BackupSettings flash={flash} />
                <ThemePicker />
            </div>
        </div>
    );
}
