import { createEffect, createResource, createSignal, Show } from "solid-js";
import { api } from "../../lib/api";
import Button from "../Button";

// Editor for the agent's base system prompt — its core instructions/persona.
// Separate from Agent Memories (discrete facts/rules): this is the single base
// block the agent always runs with. Stored per-user server-side; an empty/unset
// value means "use the built-in default", which the API renders live in
// `default_system_prompt`. The current date is injected by the agent loop at
// runtime, so it deliberately isn't part of the editable text here.
export default function SystemPromptSettings() {
    const [settings, { refetch }] = createResource(() => api.getAgentSettings());

    const [value, setValue] = createSignal("");
    const [saving, setSaving] = createSignal(false);
    const [msg, setMsg] = createSignal<{ kind: "ok" | "err"; text: string } | null>(null);

    const def = () => settings()?.default_system_prompt ?? "";
    // Server truth: a non-null stored value means the user has customized it.
    const isCustomized = () => settings()?.system_prompt != null;
    // What's in the box differs from what's saved.
    const dirty = () => value() !== (settings()?.system_prompt ?? def());
    // Saving the current text would resolve back to the default (empty, or an
    // exact match) → we persist null so the prompt keeps tracking the live
    // default (fresh vendor/role) instead of freezing a copy.
    const wouldBeDefault = () => {
        const v = value().trim();
        return v === "" || v === def().trim();
    };

    // Seed the editable box once, when the resource first lands. After that we
    // setValue() explicitly on save/reset, so refetches never clobber edits.
    let seeded = false;
    createEffect(() => {
        const s = settings();
        if (!s || seeded) return;
        setValue(s.system_prompt ?? s.default_system_prompt);
        seeded = true;
    });

    const flash = (kind: "ok" | "err", text: string) => {
        setMsg({ kind, text });
        if (kind === "ok") setTimeout(() => setMsg(null), 4000);
    };

    // Note: we re-sync from a fresh GET (refetch), not from the PATCH response.
    // The settings service's update() returns its read inside the same
    // transaction as the write, so the PATCH body reflects the *pre-write* row
    // — trusting it would show the default right after saving a custom prompt.
    // AgentLLMSettings.tsx works around the same quirk the same way.
    const save = async () => {
        setSaving(true);
        setMsg(null);
        try {
            const payload = wouldBeDefault() ? null : value();
            await api.patchAgentSettings({ system_prompt: payload });
            const fresh = await refetch();
            setValue(fresh?.system_prompt ?? fresh?.default_system_prompt ?? "");
            flash("ok", payload == null ? "Reset to the built-in default" : "System prompt saved");
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
            await api.patchAgentSettings({ system_prompt: null });
            const fresh = await refetch();
            setValue(fresh?.default_system_prompt ?? "");
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
                Agent System Prompt
            </h2>

            <p class="text-base-300 text-[12px] mb-4">
                The agent's base instructions and persona — the single block it
                always runs with. This is separate from{" "}
                <strong>Agent Memories</strong> (individual facts and rules
                layered on top). Edit and save to customize; clear the box or use{" "}
                <strong>Reset to default</strong> to go back to the built-in
                prompt. Today's date is added automatically at run time, so you
                don't need to include it.
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
                        placeholder="The agent's base system prompt…"
                        class="input-vintage resize-y font-mono text-[13px] leading-relaxed"
                    />

                    <Show when={msg()}>
                        {(m) => (
                            <div
                                class={`text-[12px] font-semibold ${
                                    m().kind === "ok"
                                        ? "text-surf-300"
                                        : "text-scarlet-400"
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
