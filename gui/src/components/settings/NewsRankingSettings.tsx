import { createEffect, createResource, createSignal, Show } from "solid-js";
import { api } from "../../lib/api";
import Button from "../Button";

// Editor for the GLOBAL news-ranking prompt — the instructions handed to the
// local LLM when it orders an account's news headlines. Stored per-user; an
// empty/unset value means "use the built-in default" (rendered live by the API
// as default_ranking_prompt). Any account can still override this from its News
// tab. Mirrors SystemPromptSettings.
export default function NewsRankingSettings() {
    const [settings, { mutate }] = createResource(() => api.getNewsSettings());

    const [value, setValue] = createSignal("");
    const [saving, setSaving] = createSignal(false);
    const [msg, setMsg] = createSignal<{ kind: "ok" | "err"; text: string } | null>(null);

    const def = () => settings()?.default_ranking_prompt ?? "";
    const isCustomized = () => settings()?.ranking_prompt != null;
    const dirty = () => value() !== (settings()?.ranking_prompt ?? def());
    const wouldBeDefault = () => {
        const v = value().trim();
        return v === "" || v === def().trim();
    };

    // Seed the box once, when the resource first lands; after that we setValue()
    // explicitly on save/reset so refetches never clobber edits.
    let seeded = false;
    createEffect(() => {
        const s = settings();
        if (!s || seeded) return;
        setValue(s.ranking_prompt ?? s.default_ranking_prompt);
        seeded = true;
    });

    const flash = (kind: "ok" | "err", text: string) => {
        setMsg({ kind, text });
        if (kind === "ok") setTimeout(() => setMsg(null), 4000);
    };

    const save = async () => {
        setSaving(true);
        setMsg(null);
        try {
            const payload = wouldBeDefault() ? null : value();
            // The service reads back inside the same transaction, so the response
            // reflects the write — mutate the resource with it directly.
            const fresh = await api.patchNewsSettings({ ranking_prompt: payload });
            mutate(fresh);
            setValue(fresh.ranking_prompt ?? fresh.default_ranking_prompt);
            flash("ok", payload == null ? "Reset to the built-in default" : "Ranking prompt saved");
        } catch (err: any) {
            flash("err", err?.message || "Save failed");
        } finally {
            setSaving(false);
        }
    };

    const resetToDefault = async () => {
        setSaving(true);
        setMsg(null);
        try {
            const fresh = await api.patchNewsSettings({ ranking_prompt: null });
            mutate(fresh);
            setValue(fresh.default_ranking_prompt);
            flash("ok", "Reset to the built-in default");
        } catch (err: any) {
            flash("err", err?.message || "Reset failed");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div class="panel panel-accent p-5">
            <h2 class="text-[15px] font-bold uppercase tracking-widest text-surf-300 mb-4 font-[family-name:var(--font-display)]">
                News Ranking
            </h2>

            <p class="text-base-300 text-[12px] mb-4">
                Instructions the local LLM uses to order each account's news
                headlines (most relevant first). This is the global default; any
                account can override it from its <strong>News</strong> tab. Clear
                the box or use <strong>Reset to default</strong> to go back to the
                built-in prompt.
            </p>

            <Show
                when={!settings.loading}
                fallback={<div class="text-base-300 text-sm">Loading…</div>}
            >
                <div class="flex flex-col gap-3">
                    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span
                            class={`text-[10px] uppercase tracking-wider font-semibold ${
                                isCustomized() ? "text-amber-300" : "text-base-400"
                            }`}
                        >
                            {isCustomized() ? "Customized" : "Using built-in default"}
                        </span>
                        <Show when={dirty()}>
                            <span class="text-[10px] uppercase tracking-wider text-base-500">
                                · unsaved changes
                            </span>
                        </Show>
                    </div>

                    <textarea
                        value={value()}
                        onInput={(e) => setValue(e.currentTarget.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                e.preventDefault();
                                save();
                            }
                        }}
                        rows={14}
                        spellcheck={false}
                        placeholder="How should news headlines be prioritized?…"
                        class="input-vintage resize-y font-mono text-[13px] leading-relaxed"
                    />

                    <Show when={msg()}>
                        {(m) => (
                            <div
                                class={`text-[12px] font-semibold ${
                                    m().kind === "ok" ? "text-surf-300" : "text-scarlet-400"
                                }`}
                            >
                                {m().text}
                            </div>
                        )}
                    </Show>

                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <span class="text-base-400 text-[10px] uppercase tracking-widest">
                            ⌘ / ctrl + ↵ to save
                        </span>
                        <div class="flex flex-wrap gap-2">
                            <button
                                type="button"
                                class="press press-ghost press-sm"
                                onClick={resetToDefault}
                                disabled={saving() || (!isCustomized() && !dirty())}
                            >
                                Reset to default
                            </button>
                            <Button
                                variant="primary"
                                size="sm"
                                disabled={saving() || !dirty()}
                                onClick={save}
                            >
                                {saving() ? "Saving…" : "Save"}
                            </Button>
                        </div>
                    </div>
                </div>
            </Show>
        </div>
    );
}
