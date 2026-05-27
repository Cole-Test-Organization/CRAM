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
import MemoryManager from "../components/settings/MemoryManager";
import { api } from "../lib/api";
import type {
    AgentEvent,
    UsageSnapshot,
    SessionsResponse,
    ReturnTo,
    AgentLocationState,
} from "../types/agent";
import { formatRelative } from "../utils/date";

const DEFAULT_LIMIT = 5;
const EXPANDED_LIMIT = 50;

export default function Agent() {
    const location = useLocation();
    const [events, setEvents] = createSignal<AgentEvent[]>([]);
    const [prompt, setPrompt] = createSignal("");
    const [notes, setNotes] = createSignal("");
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
    // Latest token usage from the provider (currently local llama.cpp/vLLM
    // only — Anthropic turns don't emit it). Reset on New Conversation.
    const [usage, setUsage] = createSignal<UsageSnapshot | null>(null);
    // Backend selection — persisted server-side per user (was localStorage).
    // Empty strings = "use server default" (AGENT_PROVIDER / AGENT_MODEL env).
    // The inline panel below has a Save button; the same fields are also
    // editable in Settings → Agent LLM.
    const [agentSettings, setAgentSettings] = createStore<{
        provider: string;
        model: string;
        localBaseUrl: string;
        saving: boolean;
        msg: { kind: "ok" | "err"; text: string } | null;
    }>({
        provider: "",
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
            provider: s.provider || "",
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
                const res = await fetch(
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
            const res = await fetch(`/api/agent/sessions/${id}`, {
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
            const res = await fetch(`/api/agent/sessions/${id}`);
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
        setShowNotes(false);
        setRunning(true);
        abortController = new AbortController();

        try {
            const res = await fetch("/api/agent/query", {
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
                        Agent Backend
                    </div>

                    <label class="flex flex-col gap-1">
                        <span class="text-[11px] uppercase tracking-widest text-base-300">
                            Provider
                        </span>
                        <select
                            value={agentSettings.provider}
                            onChange={(e) =>
                                setAgentSettings(
                                    "provider",
                                    e.currentTarget.value,
                                )
                            }
                            class="bg-base-950 border-2 border-base-500 px-3 py-2 outline-none text-base-50 text-sm focus:border-surf-300"
                        >
                            <option value="">(server default)</option>
                            <option value="anthropic">Anthropic</option>
                            <option value="local">
                                Local (OpenAI-compatible)
                            </option>
                        </select>
                    </label>

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
                            placeholder={
                                agentSettings.provider === "local"
                                    ? "e.g. llama-3.3-70b-instruct (whatever your server reports)"
                                    : agentSettings.provider === "anthropic"
                                      ? "claude-sonnet-4-6"
                                      : "(server default)"
                            }
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
                                placeholder="http://192.168.1.50:8080"
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
                                in <A href="/settings" class="underline hover:text-surf-300">Settings → Agent LLM</A>.
                                <strong class="text-base-300">
                                    {" "}
                                    Docker host
                                </strong>{" "}
                                presets target an inference server running on
                                the Docker host machine (works in Docker
                                Desktop on Mac/Windows; on Linux requires the{" "}
                                <span class="font-mono">extra_hosts</span>{" "}
                                directive in compose). If empty, the server
                                falls back to the LOCAL_BASE_URL env var.
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
                        Anthropic uses ANTHROPIC_API_KEY on the server. Local
                        uses the URL above (no auth by default — set
                        LOCAL_API_KEY on the server if your endpoint requires
                        it). New sessions remember their provider+model; resume
                        to keep using the same backend.
                    </div>
                </div>
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
                <textarea
                    placeholder={
                        sessionId()
                            ? "Follow-up..."
                            : "Ask the agent to look something up, update an account, save meeting notes, etc."
                    }
                    value={prompt()}
                    onInput={(e) => setPrompt(e.currentTarget.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
                            submit();
                    }}
                    rows={4}
                    class="bg-base-950 border-2 border-base-500 px-3 py-2 outline-none text-base-50 text-sm placeholder:text-base-400 focus:border-surf-300"
                    disabled={running()}
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
