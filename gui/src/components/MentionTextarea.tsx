import {
    createSignal,
    createResource,
    createEffect,
    createMemo,
    onCleanup,
    For,
    Show,
} from "solid-js";
import { api } from "../lib/api";

// A tagged CRM record. `type` is the resolver discriminator; `partner` resolves
// through the same accounts service as `account` (a partner is just an account
// with status='partner') — we keep it distinct so the UI and the agent card can
// label it. `slug` is for accounts/partners/contacts/opportunities (linkable);
// meetings are id-addressed only.
export type Mention = {
    type: "account" | "partner" | "contact" | "meeting" | "opportunity";
    id: number;
    label: string;
    slug?: string;
};

type Item = { group: string; mention: Mention; secondary?: string };

// Fixed display order for the picker groups.
const GROUP_ORDER = [
    "Accounts",
    "Partners",
    "Contacts",
    "Opportunities",
    "Meetings",
] as const;

const TYPE_TAG: Record<Mention["type"], string> = {
    account: "acct",
    partner: "ptnr",
    contact: "person",
    opportunity: "opp",
    meeting: "mtg",
};

function buildItems(data: any): Item[] {
    const r = data?.results;
    if (!r) return [];
    const out: Item[] = [];

    // accounts bucket carries both customers and partners — split by status.
    const accts: any[] = r.accounts || [];
    for (const a of accts.filter((x) => x.status !== "partner")) {
        out.push({
            group: "Accounts",
            secondary: a.status || undefined,
            mention: { type: "account", id: a.id, label: a.name, slug: a.slug },
        });
    }
    for (const a of accts.filter((x) => x.status === "partner")) {
        out.push({
            group: "Partners",
            secondary: "partner",
            mention: { type: "partner", id: a.id, label: a.name, slug: a.slug },
        });
    }
    for (const c of r.contacts || []) {
        const company = c.account_name || c.company || "";
        out.push({
            group: "Contacts",
            secondary: [c.title, company].filter(Boolean).join(" · ") || undefined,
            mention: {
                type: "contact",
                id: c.id,
                label: c.full_name || c.email || `Contact ${c.id}`,
                slug: c.account_slug ? String(c.account_slug).split(",")[0] : undefined,
            },
        });
    }
    for (const o of r.opportunities || []) {
        out.push({
            group: "Opportunities",
            secondary: [o.stage, o.account_name].filter(Boolean).join(" · ") || undefined,
            mention: {
                type: "opportunity",
                id: o.id,
                label: o.name,
                slug: o.account_slug || undefined,
            },
        });
    }
    for (const m of r.meetings || []) {
        out.push({
            group: "Meetings",
            secondary: [m.account_name, m.date].filter(Boolean).join(" · ") || undefined,
            mention: {
                type: "meeting",
                id: m.id,
                label: m.title || `Meeting ${m.date || m.id}`,
            },
        });
    }

    // stable group order
    return out.sort(
        (a, b) => GROUP_ORDER.indexOf(a.group as any) - GROUP_ORDER.indexOf(b.group as any),
    );
}

/**
 * A textarea that supports Slack-style `@` tagging of CRM records.
 *
 * Controlled: the parent owns `value` (text) and `mentions` (resolved tags).
 * The inline `@Label` text is a cosmetic breadcrumb; the `mentions` array is the
 * authoritative payload sent to the agent. Selected records render as removable
 * chips below the box (chips-below, not inline pills — keeps a plain <textarea>
 * so it stays mobile-safe).
 */
export default function MentionTextarea(props: {
    value: string;
    onInput: (v: string) => void;
    mentions: Mention[];
    onMentionsChange: (m: Mention[]) => void;
    placeholder?: string;
    rows?: number;
    disabled?: boolean;
    class?: string;
    /** Fired on ⌘/Ctrl+Enter when the mention popover is closed. */
    onSubmit?: () => void;
}) {
    let taRef: HTMLTextAreaElement | undefined;

    // rawQuery: the active token after `@` (null = popover closed, "" = bare @).
    const [rawQuery, setRawQuery] = createSignal<string | null>(null);
    const [debounced, setDebounced] = createSignal("");
    const [activeIndex, setActiveIndex] = createSignal(0);
    let triggerStart = 0; // index of the `@` we're completing

    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    const setQuery = (q: string | null) => {
        setRawQuery(q);
        if (debounceTimer) clearTimeout(debounceTimer);
        if (q === null) {
            setDebounced("");
            return;
        }
        // Debounce the firing: a burst of keystrokes collapses to ONE trailing
        // call once typing settles. Latest-wins is handled by createResource —
        // when the source changes it discards any superseded in-flight fetch.
        debounceTimer = setTimeout(() => setDebounced(q.trim()), 150);
    };
    onCleanup(() => debounceTimer && clearTimeout(debounceTimer));

    const [searchRes] = createResource(
        () => (rawQuery() !== null && debounced().length >= 1 ? debounced() : null),
        (q) => api.search(q, "all", 6),
    );

    const items = createMemo<Item[]>(() =>
        rawQuery() === null ? [] : buildItems(searchRes()),
    );
    // reset keyboard highlight whenever the result set changes
    createEffect(() => {
        items();
        setActiveIndex(0);
    });

    // popover is "open" once there's at least 1 char after the @ (bare @ shows
    // nothing — our agreed default).
    const open = () => {
        const q = rawQuery();
        return q !== null && q.length >= 1;
    };
    // true while the debounce hasn't caught up to the typed token yet — show a
    // "searching…" state instead of a premature "no matches" flicker.
    const pending = () => {
        const q = rawQuery();
        return q !== null && debounced() !== q.trim();
    };

    // Detect/extract the @-token immediately left of the caret.
    const syncTrigger = () => {
        const el = taRef;
        if (!el) {
            setQuery(null);
            return;
        }
        const caret = el.selectionStart ?? 0;
        const text = props.value;
        let i = caret - 1;
        while (i >= 0 && !/[\s@]/.test(text[i])) i--;
        if (i < 0 || text[i] !== "@") {
            setQuery(null);
            return;
        }
        // the `@` must start the input or follow whitespace, so emails like
        // dana@acme.com typed into the box don't trigger the picker.
        const prev = i === 0 ? "" : text[i - 1];
        if (prev && !/\s/.test(prev)) {
            setQuery(null);
            return;
        }
        triggerStart = i;
        setQuery(text.slice(i + 1, caret));
    };

    const selectItem = (item: Item) => {
        const m = item.mention;
        const text = props.value;
        const start = triggerStart;
        const end = start + 1 + (rawQuery()?.length ?? 0);
        const insert = `@${m.label} `;
        props.onInput(text.slice(0, start) + insert + text.slice(end));

        const dup = props.mentions.some((x) => x.type === m.type && x.id === m.id);
        if (!dup) props.onMentionsChange([...props.mentions, m]);

        setQuery(null);
        const caret = start + insert.length;
        queueMicrotask(() => {
            if (taRef) {
                taRef.focus();
                taRef.selectionStart = taRef.selectionEnd = caret;
            }
        });
    };

    const removeMention = (m: Mention) =>
        props.onMentionsChange(
            props.mentions.filter((x) => !(x.type === m.type && x.id === m.id)),
        );

    const onKeyDown = (e: KeyboardEvent) => {
        const list = items();
        if (open() && list.length > 0) {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => (i + 1) % list.length);
                return;
            }
            if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => (i - 1 + list.length) % list.length);
                return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                selectItem(list[activeIndex()]);
                return;
            }
            if (e.key === "Escape") {
                e.preventDefault();
                setQuery(null);
                return;
            }
        }
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            props.onSubmit?.();
        }
    };

    return (
        <div class="relative flex flex-col gap-2">
            <div class="relative">
                <textarea
                    ref={taRef}
                    value={props.value}
                    placeholder={props.placeholder}
                    rows={props.rows ?? 4}
                    disabled={props.disabled}
                    onInput={(e) => {
                        props.onInput(e.currentTarget.value);
                        syncTrigger();
                    }}
                    onClick={syncTrigger}
                    onKeyUp={(e) => {
                        // caret-moving keys re-evaluate the trigger; typing keys
                        // are already handled by onInput.
                        if (
                            e.key === "ArrowLeft" ||
                            e.key === "ArrowRight" ||
                            e.key === "Home" ||
                            e.key === "End"
                        )
                            syncTrigger();
                    }}
                    onKeyDown={onKeyDown}
                    onBlur={() => {
                        // let a click on a popover item land before closing
                        setTimeout(() => setQuery(null), 120);
                    }}
                    class={
                        props.class ??
                        "w-full bg-base-950 border-2 border-base-500 px-3 py-2 outline-none text-base-50 text-sm placeholder:text-base-400 focus:border-surf-300"
                    }
                />

                <Show when={open()}>
                    <div class="absolute z-20 left-0 right-0 top-full mt-1 max-h-72 overflow-y-auto bg-base-950 border-2 border-surf-400 shadow-[2px_2px_0_0_rgba(0,0,0,0.4)]">
                        <Show
                            when={!pending() && !searchRes.loading}
                            fallback={
                                <div class="px-3 py-2 text-[12px] text-base-400 italic">
                                    searching…
                                </div>
                            }
                        >
                            <Show
                                when={items().length > 0}
                                fallback={
                                    <div class="px-3 py-2 text-[12px] text-base-400 italic">
                                        No matches for "{rawQuery()}"
                                    </div>
                                }
                            >
                                <For each={items()}>
                                    {(item, idx) => {
                                        const prevGroup = () =>
                                            idx() === 0
                                                ? null
                                                : items()[idx() - 1].group;
                                        return (
                                            <>
                                                <Show when={item.group !== prevGroup()}>
                                                    <div class="px-3 pt-2 pb-1 text-[10px] uppercase tracking-widest text-base-500 border-t border-base-800 first:border-t-0">
                                                        {item.group}
                                                    </div>
                                                </Show>
                                                <button
                                                    type="button"
                                                    // mousedown (not click) so we
                                                    // insert before the blur fires
                                                    onMouseDown={(e) => {
                                                        e.preventDefault();
                                                        selectItem(item);
                                                    }}
                                                    onMouseEnter={() =>
                                                        setActiveIndex(idx())
                                                    }
                                                    class={`w-full text-left px-3 py-2 flex flex-col gap-0.5 ${
                                                        activeIndex() === idx()
                                                            ? "bg-surf-400/20"
                                                            : "hover:bg-base-900"
                                                    }`}
                                                >
                                                    <span class="text-sm text-base-50 truncate">
                                                        {item.mention.label}
                                                    </span>
                                                    <Show when={item.secondary}>
                                                        <span class="text-[11px] text-base-400 truncate">
                                                            {item.secondary}
                                                        </span>
                                                    </Show>
                                                </button>
                                            </>
                                        );
                                    }}
                                </For>
                            </Show>
                        </Show>
                    </div>
                </Show>
            </div>

            <Show when={props.mentions.length > 0}>
                <div class="flex flex-wrap gap-1.5">
                    <For each={props.mentions}>
                        {(m) => (
                            <span class="inline-flex items-center gap-1.5 bg-base-800 border border-base-500 px-2 py-0.5 text-[12px] text-base-100">
                                <span class="text-[9px] uppercase tracking-widest text-surf-400">
                                    {TYPE_TAG[m.type]}
                                </span>
                                <span class="truncate max-w-[14rem]">{m.label}</span>
                                <span class="text-base-500">#{m.id}</span>
                                <button
                                    type="button"
                                    class="btn-x"
                                    aria-label={`Remove ${m.label}`}
                                    onClick={() => removeMention(m)}
                                    disabled={props.disabled}
                                >
                                    ×
                                </button>
                            </span>
                        )}
                    </For>
                </div>
            </Show>
        </div>
    );
}
