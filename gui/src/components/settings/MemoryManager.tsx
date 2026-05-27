import { createResource, createSignal, For, Show } from "solid-js";
import { api } from "../../lib/api";
import Button from "../Button";

type Memory = {
    id: number;
    title: string | null;
    content: string;
    enabled: boolean;
    created_at: string;
    updated_at: string;
};

export default function MemoryManager() {
    const [data, { refetch }] = createResource(() => api.listMemories());

    const [newTitle, setNewTitle] = createSignal("");
    const [newContent, setNewContent] = createSignal("");
    const [adding, setAdding] = createSignal(false);
    const [err, setErr] = createSignal("");

    const [editId, setEditId] = createSignal<number | null>(null);
    const [editTitle, setEditTitle] = createSignal("");
    const [editContent, setEditContent] = createSignal("");
    const [savingEdit, setSavingEdit] = createSignal(false);

    const startEdit = (m: Memory) => {
        setEditId(m.id);
        setEditTitle(m.title || "");
        setEditContent(m.content);
        setErr("");
    };

    const cancelEdit = () => {
        setEditId(null);
        setEditTitle("");
        setEditContent("");
    };

    const saveEdit = async () => {
        const id = editId();
        if (id == null) return;
        const content = editContent().trim();
        if (!content) {
            setErr("Content is required.");
            return;
        }
        setSavingEdit(true);
        setErr("");
        try {
            await api.patchMemory(id, {
                title: editTitle().trim() || null,
                content,
            });
            cancelEdit();
            await refetch();
        } catch (e: any) {
            setErr(e?.message || "Failed to save memory");
        } finally {
            setSavingEdit(false);
        }
    };

    const add = async () => {
        const content = newContent().trim();
        if (!content) {
            setErr("Content is required.");
            return;
        }
        setAdding(true);
        setErr("");
        try {
            await api.createMemory({
                title: newTitle().trim() || null,
                content,
            });
            setNewTitle("");
            setNewContent("");
            await refetch();
        } catch (e: any) {
            setErr(e?.message || "Failed to add memory");
        } finally {
            setAdding(false);
        }
    };

    const toggle = async (m: Memory) => {
        try {
            await api.patchMemory(m.id, { enabled: !m.enabled });
            await refetch();
        } catch (e: any) {
            setErr(e?.message || "Failed to toggle memory");
        }
    };

    const remove = async (m: Memory) => {
        const label = m.title || m.content.slice(0, 60);
        if (!confirm(`Delete memory "${label}"?`)) return;
        try {
            await api.deleteMemory(m.id);
            await refetch();
        } catch (e: any) {
            setErr(e?.message || "Failed to delete memory");
        }
    };

    return (
        <div class="panel panel-accent p-5">
            <h2 class="text-[15px] font-bold uppercase tracking-widest text-surf-300 mb-4 font-[family-name:var(--font-display)]">
                Agent Memories
            </h2>

            <p class="text-base-300 text-[12px] mb-4">
                Long-lived preferences, rules, and facts injected into the
                agent's system prompt at session start. Disable to soft-mute
                without losing the entry. The agent may save these via tool
                when you explicitly ask it to remember something.
            </p>

            <div class="flex flex-col gap-2 mb-3">
                <input
                    type="text"
                    value={newTitle()}
                    onInput={(e) => setNewTitle(e.currentTarget.value)}
                    placeholder="Title (optional)"
                    class="input-vintage"
                />
                <textarea
                    value={newContent()}
                    onInput={(e) => setNewContent(e.currentTarget.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            add();
                        }
                    }}
                    placeholder="What should the agent remember? (cmd/ctrl+Enter to save)"
                    rows={3}
                    class="input-vintage resize-y"
                />
                <div class="flex justify-end">
                    <Button
                        variant="primary"
                        disabled={adding()}
                        onClick={add}
                    >
                        {adding() ? "Adding…" : "Add Memory"}
                    </Button>
                </div>
            </div>

            <Show when={err()}>
                <div class="text-[12px] text-scarlet-400 mb-2 font-semibold">
                    {err()}
                </div>
            </Show>

            <Show
                when={!data.loading}
                fallback={<div class="text-base-300 text-sm">Loading…</div>}
            >
                <Show
                    when={(data()?.memories || []).length > 0}
                    fallback={
                        <div class="text-[11px] text-base-400 italic">
                            No memories yet. Add one above, or ask the agent to
                            remember something during a conversation.
                        </div>
                    }
                >
                    <div class="border-2 border-base-600 bg-base-950 flex flex-col">
                        <For each={data()?.memories || []}>
                            {(m) => (
                                <div
                                    class={`flex flex-col gap-2 p-3 border-b border-base-700 last:border-b-0 ${
                                        m.enabled ? "" : "opacity-50"
                                    }`}
                                >
                                    <Show
                                        when={editId() === m.id}
                                        fallback={
                                            <>
                                                <div class="flex flex-wrap items-start justify-between gap-2">
                                                    <div class="flex-1 min-w-0">
                                                        <Show when={m.title}>
                                                            <div class="text-sm font-bold text-base-50 break-words">
                                                                {m.title}
                                                            </div>
                                                        </Show>
                                                        <div class="text-[13px] text-base-200 whitespace-pre-wrap break-words font-mono">
                                                            {m.content}
                                                        </div>
                                                        <div class="text-[10px] text-base-500 mt-1 uppercase tracking-wider">
                                                            {m.enabled
                                                                ? "Active"
                                                                : "Disabled"}
                                                            {" · "}
                                                            {new Date(
                                                                m.created_at,
                                                            ).toLocaleDateString()}
                                                        </div>
                                                    </div>
                                                    <div class="flex flex-wrap gap-1 shrink-0">
                                                        <button
                                                            type="button"
                                                            class="press press-ghost press-sm"
                                                            onClick={() =>
                                                                toggle(m)
                                                            }
                                                        >
                                                            {m.enabled
                                                                ? "Disable"
                                                                : "Enable"}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            class="press press-ghost press-sm"
                                                            onClick={() =>
                                                                startEdit(m)
                                                            }
                                                        >
                                                            Edit
                                                        </button>
                                                        <button
                                                            type="button"
                                                            class="press press-ghost press-sm"
                                                            onClick={() =>
                                                                remove(m)
                                                            }
                                                        >
                                                            Delete
                                                        </button>
                                                    </div>
                                                </div>
                                            </>
                                        }
                                    >
                                        <input
                                            type="text"
                                            value={editTitle()}
                                            onInput={(e) =>
                                                setEditTitle(
                                                    e.currentTarget.value,
                                                )
                                            }
                                            placeholder="Title (optional)"
                                            class="input-vintage"
                                        />
                                        <textarea
                                            value={editContent()}
                                            onInput={(e) =>
                                                setEditContent(
                                                    e.currentTarget.value,
                                                )
                                            }
                                            rows={3}
                                            class="input-vintage resize-y"
                                        />
                                        <div class="flex gap-2 justify-end">
                                            <button
                                                type="button"
                                                class="press press-ghost press-sm"
                                                onClick={cancelEdit}
                                                disabled={savingEdit()}
                                            >
                                                Cancel
                                            </button>
                                            <Button
                                                variant="primary"
                                                size="sm"
                                                disabled={savingEdit()}
                                                onClick={saveEdit}
                                            >
                                                {savingEdit()
                                                    ? "Saving…"
                                                    : "Save"}
                                            </Button>
                                        </div>
                                    </Show>
                                </div>
                            )}
                        </For>
                    </div>
                </Show>
            </Show>
        </div>
    );
}
