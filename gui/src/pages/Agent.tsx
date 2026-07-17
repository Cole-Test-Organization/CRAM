import {
    createSignal,
    createEffect,
    createResource,
    onMount,
    For,
    Show,
} from "solid-js";
import { createStore } from "solid-js/store";
import { A, useLocation } from "@solidjs/router";
import MarkdownRenderer from "../components/MarkdownRenderer";
import Button from "../components/Button";
import MentionTextarea, { type Mention } from "../components/MentionTextarea";
import MemoryManager from "../components/settings/MemoryManager";
import SystemPromptSettings from "../components/settings/SystemPromptSettings";
import { api } from "../lib/api";
import type {
    AgentEvent,
    UsageSnapshot,
    SessionsResponse,
    ReturnTo,
    AgentLocationState,
} from "../types/agent";
import { formatRelative } from "../utils/date";
import { apiFetch } from "../lib/offline";

const DEFAULT_LIMIT = 5;
const EXPANDED_LIMIT = 50;

export default function Agent() {
    const location = useLocation();
    const [events, setEvents] = createSignal<AgentEvent[]>([]);
    const [prompt, setPrompt] = createSignal("");
    const [notes, setNotes] = createSignal("");
    // Records the user tagged with @ in the prompt box. Sent alongside the
    // prompt so the server can resolve each to an identity card — the agent
    // gets the exact id instead of having to search for it.
    const [mentions, setMentions] = createSignal<Mention[]>([]);
    const [showNotes, setShowNotes] = createSignal(false);
    const [running, setRunning] = createSignal(false);
    const [sessionId, setSessionId] = createSignal<string | null>(null);
    const [loadingSession, setLoadingSession] = createSignal(false);
    // Captured once on mount from location.state so the breadcrumb persists
    // after we clear history state (otherwise refresh would re-fire submit).
    const [returnTo, setReturnTo] = createSignal<ReturnTo | null>(null);
    // Per-flow MCP tool restriction. null = no restriction (default); an array
    // (including []) is forwarded as `allowedTools` on every submit until the
    // session is reset.
    const [allowedTools, setAllowedTools] = createSignal<string[] | null>(null);
    // Latest token usage from the local provider, when it reports counts.
    // Reset on New Conversation.
    const [usage, setUsage] = createSignal<UsageSnapshot | null>(null);
    // Local LLM selection — persisted server-side per user (was localStorage).
    // Provider is always "local"; blank model/URL = server default (Ollama on
    // this device). The inline panel below has a Save button; the same fields
    // are also editable in Settings → Agent LLM.
    const [agentSettings, setAgentSettings] = createStore<{
        provider: string;
        model: string;
        localBaseUrl: string;
        saving: boolean;
        msg: { kind: "ok" | "err"; text: string } | null;
    }>({
        provider: "local",
        model: "",
        localBaseUrl: "",
        saving: false,
        msg: null,
    });
    const [savedAgentSettings, { refetch: refetchAgentSettings }] =
        createResource(() => api.getAgentSettings());
    // One-shot sync: seed the local editable store once the resource lands.
    let agentSettingsSeeded = false;
    createEffect(() => {
        const s = savedAgentSettings();
        if (!s || agentSettingsSeeded) return;
        setAgentSettings({
            provider: "local",
            model: s.model || "",
            localBaseUrl: s.local_base_url || "",
        });
        agentSettingsSeeded = true;
    });
    const saveAgentSettings = async () => {
        setAgentSettings({ saving: true, msg: null });
        try {
            await api.patchAgentSettings({
                provider: agentSettings.provider || null,
                model: agentSettings.model.trim() || null,
                local_base_url: agentSettings.localBaseUrl.trim() || null,
            });
            await refetchAgentSettings();
            setAgentSettings("msg", { kind: "ok", text: "Saved" });
            setTimeout(() => setAgentSettings("msg", null), 3000);
        } catch (err: any) {
            setAgentSettings("msg", {
                kind: "err",
                text: err?.message || "Save failed",
            });
        } finally {
            setAgentSettings("saving", false);
        }
    };
    const [settingsOpen, setSettingsOpen] = createSignal(false);
    const [searchInput, setSearchInput] = createSignal("");
    const [debouncedSearch, setDebouncedSearch] = createSignal("");
    const [expanded, setExpanded] = createSignal(false);
    const [sessionsData, { refetch: refetchSessions }] = createResource<
        SessionsResponse,
        { q: string; limit: number }
    >(
        () => ({
            q: debouncedSearch(),
            limit:
                expanded() || debouncedSearch()
                    ? EXPANDED_LIMIT
                    : DEFAULT_LIMIT,
        }),
        async ({ q, limit }) => {
            try {
                const params = new URLSearchParams();
                if (q) params.set("search", q);
                params.set("limit", String(limit));
                const res = await apiFetch(
                    `/api/agent/sessions?${params.toString()}`,
                );
                if (!res.ok) return { total: 0, sessions: [] };
                return (await res.json()) as SessionsResponse;
            } catch {
                return { total: 0, sessions: [] };
            }
        },
    );

    let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined;
    const onSearchInput = (val: string) => {
        setSearchInput(val);
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(
            () => setDebouncedSearch(val.trim()),
            150,
        );
    };

    let logEndRef: HTMLDivElement | undefined;
    let abortController: AbortController | null = null;

    createEffect(() => {
        events();
        if (logEndRef)
            logEndRef.scrollIntoView({ behavior: "smooth", block: "end" });
    });

    const cancel = () => {
        abortController?.abort();
    };

    const handleDeleteSession = async (
        id: string,
        title: string,
        e: MouseEvent,
    ) => {
        e.stopPropagation();
        if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
        try {
            const res = await apiFetch(`/api/agent/sessions/${id}`, {
                method: "DELETE",
            });
            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
            refetchSessions();
        } catch (err: any) {
            alert(`Failed to delete: ${err?.message || String(err)}`);
        }
    };

    const reset = () => {
        setEvents([]);
        setSessionId(null);
        setPrompt("");
        setNotes("");
        setMentions([]);
        setShowNotes(false);
        setSearchInput("");
        setDebouncedSearch("");
        setExpanded(false);
        setUsage(null);
        setAllowedTools(null);
        refetchSessions();
    };

    const resumeSession = async (id: string) => {
        if (running() || loadingSession()) return;
        setLoadingSession(true);
        try {
            const res = await apiFetch(`/api/agent/sessions/${id}`);
            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
            const data = (await res.json()) as {
                id: string;
                events: AgentEvent[];
            };
            setEvents(data.events);
            setSessionId(data.id);
            setUsage(null);
        } catch (err: any) {
            setEvents([
                {
                    type: "error",
                    message: `Failed to load session: ${err?.message || String(err)}`,
                },
            ]);
        } finally {
            setLoadingSession(false);
        }
    };

    const submit = async () => {
        if (!prompt().trim() || running()) return;

        const currentPrompt = prompt();
        const currentNotes = notes();
        const currentMentions = mentions();
        setEvents((e) => [
            ...e,
            {
                type: "user_prompt",
                text: currentPrompt,
                notes: currentNotes || undefined,
            },
        ]);
        setPrompt("");
        setNotes("");
        setMentions([]);
        setShowNotes(false);
        setRunning(true);
        abortController = new AbortController();

        try {
            const res = await apiFetch("/api/agent/query", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    prompt: currentPrompt,
                    notes: currentNotes || undefined,
                    sessionId: sessionId() || undefined,
                    provider: agentSettings.provider || undefined,
                    model: agentSettings.model || undefined,
                    localBaseUrl:
                        agentSettings.provider === "local" &&
                        agentSettings.localBaseUrl
                            ? agentSettings.localBaseUrl
                            : undefined,
                    allowedTools: allowedTools() ?? undefined,
                    mentions: currentMentions.length ? currentMentions : undefined,
                }),
                signal: abortController.signal,
            });

            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
            if (!res.body) throw new Error("No response body");

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buf = "";

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buf += decoder.decode(value, { stream: true });

                const parts = buf.split("\n\n");
                buf = parts.pop() || "";

                for (const part of parts) {
                    const line = part
                        .split("\n")
                        .find((l) => l.startsWith("data: "));
                    if (!line) continue;
                    const payload = line.slice(6);
                    try {
                        const evt = JSON.parse(payload) as AgentEvent;
                        console.debug("[agent SSE]", evt.type, evt);
                        if (evt.type === "session") setSessionId(evt.sessionId);
                        if (evt.type === "usage") {
                            // Status, not history — drive the meter, skip log.
                            setUsage({
                                promptTokens: evt.promptTokens,
                                completionTokens: evt.completionTokens,
                                totalTokens: evt.totalTokens,
                                contextMax: evt.contextMax,
                            });
                            continue;
                        }
                        setEvents((e) => [...e, evt]);
                    } catch (err) {}
                }
            }
        } catch (err: any) {
            if (err?.name === "AbortError") {
                setEvents((e) => [
                    ...e,
                    { type: "error", message: "Cancelled" },
                ]);
            } else {
                setEvents((e) => [
                    ...e,
                    { type: "error", message: err?.message || String(err) },
                ]);
            }
        } finally {
            abortController = null;
            setRunning(false);
            refetchSessions();
        }
    };

    // Auto-fire a prompt passed via router state (e.g. "Generate Design of
    // Record" buttons on OpportunityDetail). We capture returnTo and
    // allowedTools into signals because we clear history state immediately so
    // a refresh won't re-submit the prompt.
    onMount(() => {
        const state = location.state as AgentLocationState | null;
        if (!state) return;
        if (state.returnTo) setReturnTo(state.returnTo);
        if (Array.isArray(state.allowedTools)) setAllowedTools(state.allowedTools);
        if (state.pendingPrompt) {
            setPrompt(state.pendingPrompt);
            history.replaceState({}, "", location.pathname);
            submit();
        } else if (state.returnTo || Array.isArray(state.allowedTools)) {
            history.replaceState({}, "", location.pathname);
        }
    });

    return (
        <div class="max-w-4xl mx-auto flex flex-col gap-6">
            <Show when={returnTo()}>
                {(rt) => (
                    <A
                        href={rt().href}
                        class="text-base-300 text-[12px] -mb-2 inline-block hover:text-surf-300 uppercase tracking-wider font-semibold"
                    >
                        &larr; Back to {rt().label}
                    </A>
                )}
            </Show>
            <div class="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h1 class="text-[26px] font-bold font-[family-name:var(--font-display)]">
                        Agent
                    </h1>
                    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <Show when={sessionId()}>
                            <span class="text-base-400 text-[11px] uppercase tracking-widest">
                                session {sessionId()?.slice(0, 8)}
                            </span>
                        </Show>
                        <Show when={usage() && usage()!.promptTokens != null}>
                            {(() => {
                                const u = usage()!;
                                const used =
                                    (u.promptTokens ?? 0) +
                                    (u.completionTokens ?? 0);
                                const max = u.contextMax;
                                const pct =
                                    max && max > 0
                                        ? Math.min(
                                              100,
                                              Math.round((used / max) * 100),
                                          )
                                        : null;
                                const danger = pct != null && pct >= 95;
                                const warn = pct != null && pct >= 80;
                                const colorClass = danger
                                    ? "text-scarlet-300"
                                    : warn
                                      ? "text-amber-300"
                                      : "text-base-400";
                                return (
                                    <span
                                        title={`prompt: ${u.promptTokens?.toLocaleString() ?? "?"} · completion: ${u.completionTokens?.toLocaleString() ?? "?"}${max ? ` · max: ${max.toLocaleString()}` : ""}`}
                                        class={`text-[11px] uppercase tracking-widest font-mono ${colorClass}`}
                                    >
                                        ctx {used.toLocaleString()}
                                        {max
                                            ? ` / ${max.toLocaleString()} (${pct}%)`
                                            : ""}
                                    </span>
                                );
                            })()}
                        </Show>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <Button
                        variant="ghost"
                        onClick={() => setSettingsOpen(!settingsOpen())}
                    >
                        {settingsOpen() ? "Close settings" : "Settings"}
                    </Button>
                    <Show when={events().length > 0}>
                        <Button
                            variant="ghost"
                            onClick={reset}
                            disabled={running()}
                        >
                            New Conversation
                        </Button>
                    </Show>
                </div>
            </div>

            <Show when={settingsOpen()}>
                <div class="panel panel-accent p-4 flex flex-col gap-3">
                    <div class="text-[10px] uppercase tracking-widest text-base-400">
                        Agent LLM · Local
                    </div>
                    <div class="text-[10px] text-base-500">
                        Runs on a local LLM — Ollama on this device by default.
                        Leave the fields blank to use the server default
                        (gemma4:12b on this device), or set a model / machine
                        below.
                    </div>

                    <label class="flex flex-col gap-1">
                        <span class="text-[11px] uppercase tracking-widest text-base-300">
                            Model
                        </span>
                        <input
                            type="text"
                            value={agentSettings.model}
                            onInput={(e) =>
                                setAgentSettings("model", e.currentTarget.value)
                            }
                            placeholder="gemma4:12b (or any model you've pulled)"
                            class="bg-base-950 border-2 border-base-500 px-3 py-2 outline-none text-base-50 text-sm placeholder:text-base-400 focus:border-surf-300 font-mono"
                        />
                    </label>

                    <Show when={agentSettings.provider === "local"}>
                        <label class="flex flex-col gap-1">
                            <span class="text-[11px] uppercase tracking-widest text-base-300">
                                Local server URL
                            </span>
                            <input
                                type="text"
                                value={agentSettings.localBaseUrl}
                                onInput={(e) =>
                                    setAgentSettings(
                                        "localBaseUrl",
                                        e.currentTarget.value,
                                    )
                                }
                                placeholder="http://192.168.1.50:11434"
                                class="bg-base-950 border-2 border-base-500 px-3 py-2 outline-none text-base-50 text-sm placeholder:text-base-400 focus:border-surf-300 font-mono"
                            />
                            <div class="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() =>
                                        setAgentSettings(
                                            "localBaseUrl",
                                            "http://host.docker.internal:11434",
                                        )
                                    }
                                    class="border-2 border-base-500 bg-base-950 hover:border-surf-300 hover:text-surf-200 text-base-300 text-[10px] uppercase tracking-widest px-2 py-1 transition-colors"
                                >
                                    Docker host · Ollama
                                </button>
                                <button
                                    type="button"
                                    onClick={() =>
                                        setAgentSettings(
                                            "localBaseUrl",
                                            "http://host.docker.internal:1234",
                                        )
                                    }
                                    class="border-2 border-base-500 bg-base-950 hover:border-surf-300 hover:text-surf-200 text-base-300 text-[10px] uppercase tracking-widest px-2 py-1 transition-colors"
                                >
                                    Docker host · LM Studio
                                </button>
                                <Show when={agentSettings.localBaseUrl}>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setAgentSettings("localBaseUrl", "")
                                        }
                                        class="border-2 border-base-700 bg-base-950 hover:border-base-400 text-base-500 hover:text-base-300 text-[10px] uppercase tracking-widest px-2 py-1 transition-colors"
                                    >
                                        Clear
                                    </button>
                                </Show>
                            </div>
                            <span class="text-[10px] text-base-500">
                                POSTed to{" "}
                                <span class="font-mono">{`{url}/v1/chat/completions`}</span>
                                . Saved server-side (per user) — also editable
                                in <A href="/settings" class="underline hover:text-surf-300">Settings → Agent LLM</A>.{" "}
                                <strong class="text-base-300">Docker host</strong>{" "}
                                presets hit Ollama / LM Studio on this device
                                (works on Docker Desktop; on Linux needs the{" "}
                                <span class="font-mono">extra_hosts</span>{" "}
                                directive in compose). For an LLM on another
                                machine, type its LAN address (e.g.{" "}
                                <span class="font-mono">http://192.168.1.50:11434</span>).
                                If empty, the server uses the default — Ollama on
                                this device.
                            </span>
                        </label>
                    </Show>

                    <Show when={agentSettings.msg}>
                        {(msg) => (
                            <div class={`text-[11px] font-semibold ${msg().kind === "ok" ? "text-surf-300" : "text-scarlet-400"}`}>
                                {msg().text}
                            </div>
                        )}
                    </Show>

                    <div class="flex gap-2 pt-1">
                        <Button
                            variant="primary"
                            size="sm"
                            disabled={agentSettings.saving}
                            onClick={saveAgentSettings}
                        >
                            {agentSettings.saving ? "Saving…" : "Save"}
                        </Button>
                    </div>

                    <div class="text-[10px] text-base-500 border-t border-base-700 pt-2">
                        No auth by default — set LOCAL_API_KEY on the server if
                        your endpoint requires a bearer token. New sessions
                        remember their model; resume to keep using it.
                    </div>
                </div>
                <SystemPromptSettings />
                <MemoryManager />
            </Show>

            <Show when={events().length > 0}>
                <div class="flex flex-col gap-3">
                    <For each={events()}>
                        {(evt) => <EventBubble event={evt} />}
                    </For>
                    <Show when={running()}>
                        <div class="text-base-300 text-[12px] italic">
                            Running...
                        </div>
                    </Show>
                    <div ref={logEndRef} />
                </div>
            </Show>

            <Show when={events().length === 0 && !loadingSession()}>
                <div class="flex flex-col gap-2">
                    <div class="flex items-center bg-base-950 border-2 border-base-500 px-3 py-2 gap-2 focus-within:border-surf-300 transition-colors">
                        <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            class="text-surf-400 shrink-0"
                        >
                            <circle cx="11" cy="11" r="8" />
                            <path d="m21 21-4.35-4.35" />
                        </svg>
                        <input
                            type="text"
                            placeholder="Search past conversations..."
                            value={searchInput()}
                            onInput={(e) =>
                                onSearchInput(e.currentTarget.value)
                            }
                            class="flex-1 bg-transparent border-none outline-none text-base-50 text-sm placeholder:text-base-400"
                        />
                        <Show when={searchInput()}>
                            <button
                                type="button"
                                onClick={() => onSearchInput("")}
                                class="text-base-400 hover:text-base-200 text-[11px] uppercase tracking-widest"
                                aria-label="Clear search"
                            >
                                ×
                            </button>
                        </Show>
                    </div>

                    <Show
                        when={(sessionsData()?.sessions.length ?? 0) > 0}
                        fallback={
                            <Show when={!sessionsData.loading}>
                                <div class="text-base-400 text-[12px] italic px-1 py-2">
                                    {debouncedSearch()
                                        ? `No matches for "${debouncedSearch()}"`
                                        : "No past conversations yet"}
                                </div>
                            </Show>
                        }
                    >
                        <div class="text-base-400 text-[10px] uppercase tracking-widest px-1 flex justify-between items-center">
                            <span>
                                {debouncedSearch()
                                    ? `${sessionsData()?.total ?? 0} match${(sessionsData()?.total ?? 0) === 1 ? "" : "es"}`
                                    : "Recent conversations"}
                            </span>
                            <Show when={sessionsData.loading}>
                                <span class="text-base-500 normal-case tracking-normal">
                                    searching…
                                </span>
                            </Show>
                        </div>
                        <div class="panel panel-accent">
                            <For each={sessionsData()?.sessions ?? []}>
                                {(s) => (
                                    <div
                                        role="button"
                                        tabIndex={
                                            running() || loadingSession()
                                                ? -1
                                                : 0
                                        }
                                        onClick={() => {
                                            if (!running() && !loadingSession())
                                                resumeSession(s.id);
                                        }}
                                        onKeyDown={(e) => {
                                            if (
                                                (e.key === "Enter" ||
                                                    e.key === " ") &&
                                                !running() &&
                                                !loadingSession()
                                            ) {
                                                e.preventDefault();
                                                resumeSession(s.id);
                                            }
                                        }}
                                        class={`press-row gap-4 flex-wrap border-b border-base-700 last:border-b-0 w-full text-left flex-col items-start cursor-pointer ${running() || loadingSession() ? "opacity-50 cursor-not-allowed" : ""}`}
                                    >
                                        <div class="flex flex-wrap gap-x-4 gap-y-1 w-full items-baseline">
                                            <span class="flex-1 min-w-[60%] md:min-w-0 text-sm text-base-50 truncate">
                                                {s.title}
                                            </span>
                                            <span class="text-base-300 text-[12px]">
                                                {formatRelative(s.updatedAt)}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={(e) =>
                                                    handleDeleteSession(
                                                        s.id,
                                                        s.title,
                                                        e,
                                                    )
                                                }
                                                disabled={
                                                    running() ||
                                                    loadingSession()
                                                }
                                                class="btn-x"
                                                aria-label="Delete conversation"
                                            >
                                                ×
                                            </button>
                                        </div>
                                        <Show when={s.match}>
                                            <div class="text-[12px] text-base-300 font-mono whitespace-pre-wrap break-words">
                                                {s.match!.before}
                                                <mark class="bg-surf-400/30 text-surf-200 px-0.5">
                                                    {s.match!.match}
                                                </mark>
                                                {s.match!.after}
                                            </div>
                                        </Show>
                                    </div>
                                )}
                            </For>
                        </div>
                        <Show
                            when={
                                !debouncedSearch() &&
                                !expanded() &&
                                (sessionsData()?.total ?? 0) > DEFAULT_LIMIT
                            }
                        >
                            <button
                                type="button"
                                onClick={() => setExpanded(true)}
                                class="text-surf-400 hover:text-surf-300 text-[11px] uppercase tracking-widest self-start px-1"
                            >
                                Show{" "}
                                {Math.min(
                                    (sessionsData()?.total ?? 0) -
                                        DEFAULT_LIMIT,
                                    EXPANDED_LIMIT - DEFAULT_LIMIT,
                                )}{" "}
                                more
                            </button>
                        </Show>
                        <Show
                            when={
                                !debouncedSearch() &&
                                expanded() &&
                                (sessionsData()?.total ?? 0) > DEFAULT_LIMIT
                            }
                        >
                            <button
                                type="button"
                                onClick={() => setExpanded(false)}
                                class="text-base-400 hover:text-base-200 text-[11px] uppercase tracking-widest self-start px-1"
                            >
                                Show fewer
                            </button>
                        </Show>
                    </Show>
                </div>
            </Show>

            <Show when={loadingSession()}>
                <div class="text-base-300 text-[12px] italic px-1">
                    Loading conversation...
                </div>
            </Show>

            <div class="panel panel-accent p-4 flex flex-col gap-3">
                <MentionTextarea
                    value={prompt()}
                    onInput={setPrompt}
                    mentions={mentions()}
                    onMentionsChange={setMentions}
                    onSubmit={submit}
                    rows={4}
                    disabled={running()}
                    placeholder={
                        sessionId()
                            ? "Follow-up..."
                            : "Ask the agent to look something up, update an account, etc. — type @ to tag a record"
                    }
                />

                <Show
                    when={showNotes()}
                    fallback={
                        <button
                            type="button"
                            onClick={() => setShowNotes(true)}
                            class="text-surf-400 hover:text-surf-300 text-[11px] uppercase tracking-widest self-start"
                            disabled={running()}
                        >
                            + Attach notes / emails
                        </button>
                    }
                >
                    <textarea
                        placeholder="Paste notes, emails, or meeting transcripts here..."
                        value={notes()}
                        onInput={(e) => setNotes(e.currentTarget.value)}
                        rows={8}
                        class="bg-base-950 border-2 border-base-500 px-3 py-2 outline-none text-base-50 text-[12px] placeholder:text-base-400 focus:border-surf-300 font-mono"
                        disabled={running()}
                    />
                </Show>

                <div class="flex justify-between items-center">
                    <span class="text-base-400 text-[10px] uppercase tracking-widest">
                        ⌘ + ↵ to submit
                    </span>
                    <Button
                        variant="primary"
                        onClick={running() ? cancel : submit}
                        disabled={!running() && !prompt().trim()}
                    >
                        {running()
                            ? "Cancel"
                            : sessionId()
                              ? "Send follow-up"
                              : "Run"}
                    </Button>
                </div>
            </div>
        </div>
    );
}

function EventBubble(props: { event: AgentEvent }) {
    const e = props.event;

    if (e.type === "user_prompt") {
        return (
            <div class="panel p-3 border-l-4 border-surf-400">
                <div class="text-[10px] uppercase tracking-widest text-surf-400 mb-1">
                    You
                </div>
                <div class="whitespace-pre-wrap text-sm text-base-50">
                    {e.text}
                </div>
                <Show when={e.notes}>
                    <details class="mt-2">
                        <summary class="text-[11px] text-base-400 cursor-pointer uppercase tracking-wider">
                            Attached notes
                        </summary>
                        <pre class="text-[12px] text-base-300 whitespace-pre-wrap font-mono mt-1">
                            {e.notes}
                        </pre>
                    </details>
                </Show>
            </div>
        );
    }

    if (e.type === "thinking") {
        return (
            <details class="text-base-300 text-[12px] px-1">
                <summary class="cursor-pointer text-surf-400 uppercase tracking-wider text-[10px] font-semibold">
                    Thinking
                </summary>
                <div class="mt-1 pl-3 border-l-2 border-surf-500">
                    <MarkdownRenderer content={e.text} />
                </div>
            </details>
        );
    }

    if (e.type === "assistant_text") {
        return (
            <div class="panel p-3">
                <div class="text-[10px] uppercase tracking-widest text-base-400 mb-1">
                    Agent
                </div>
                <MarkdownRenderer content={e.text} />
            </div>
        );
    }

    if (e.type === "tool_use") {
        return (
            <details class="panel p-2 border-l-4 border-base-500">
                <summary class="cursor-pointer text-[12px] text-base-300">
                    <span class="text-surf-400 font-mono">{e.name}</span>
                    <span class="text-base-500 ml-2 text-[10px] uppercase tracking-wider">
                        call
                    </span>
                </summary>
                <pre class="text-[11px] text-base-400 mt-2 p-2 bg-base-950 border border-base-700 overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(e.input, null, 2)}
                </pre>
            </details>
        );
    }

    if (e.type === "tool_result") {
        return (
            <details
                class={`panel p-2 border-l-4 ${e.isError ? "border-red-500" : "border-base-600"}`}
            >
                <summary class="cursor-pointer text-[12px] text-base-400">
                    <span class="text-base-300 uppercase tracking-wider text-[10px]">
                        result
                    </span>
                    <Show when={e.isError}>
                        <span class="text-red-400 ml-2 uppercase tracking-wider text-[10px]">
                            error
                        </span>
                    </Show>
                </summary>
                <pre class="text-[11px] text-base-300 mt-2 p-2 bg-base-950 border border-base-700 overflow-x-auto whitespace-pre-wrap">
                    {e.content}
                </pre>
            </details>
        );
    }

    if (e.type === "done") {
        const parts: string[] = ["done"];
        if (e.durationMs) parts.push(`${(e.durationMs / 1000).toFixed(1)}s`);
        return (
            <div class="text-[10px] text-base-500 uppercase tracking-widest text-center py-2 border-t border-b border-base-700">
                {parts.join(" · ")}
            </div>
        );
    }

    if (e.type === "notice") {
        return (
            <div class="panel p-3 border-l-4 border-amber-400">
                <div class="text-[10px] uppercase tracking-widest text-amber-300 mb-1">
                    Notice
                </div>
                <div class="text-sm text-base-200 whitespace-pre-wrap">
                    {e.message}
                </div>
            </div>
        );
    }

    if (e.type === "error") {
        return (
            <div class="panel p-3 border-l-4 border-red-500">
                <div class="text-[10px] uppercase tracking-widest text-red-400 mb-1">
                    Error
                </div>
                <div class="text-sm text-base-200 whitespace-pre-wrap">
                    {e.message}
                </div>
            </div>
        );
    }

    return null;
}
