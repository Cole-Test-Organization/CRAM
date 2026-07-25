import { createResource, createSignal, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { api } from "../lib/api";
import { MeetingFormModal } from "../components/FormModals";
import Button from "../components/Button";
import ListRows from "../components/ListRows";
import TodayTimeline from "../components/TodayTimeline";
import SelectionToolbar from "../components/SelectionToolbar";
import SegmentedControl from "../components/SegmentedControl";
import { createSelection } from "../components/createSelection";
import MergeModal from "../components/MergeModal";
import { buildMeetingsExport } from "../lib/meetingExport";
import { createPersistentSignal } from "../lib/persistentSignal";

type Props = {
    accountId?: number;
    accountName?: string;
    onAfterCreate?: (meeting: any) => void;
    onAfterDelete?: () => void;
};

export default function MeetingsList(props: Props = {}) {
    const [filter, setFilter] = createSignal("");
    // Filter toggles persist across reloads/navigation — they're a working mode
    // ("I'm triaging"), not a per-visit choice. The text filter deliberately
    // isn't sticky: a stale search box reads as an empty list.
    const [reviewOnly, setReviewOnly] = createPersistentSignal("meetings.reviewOnly", false);
    const [kindFilter, setKindFilter] = createPersistentSignal<"all" | "external" | "internal">("meetings.kindFilter", "all");
    const [modalOpen, setModalOpen] = createSignal(false);
    const [markingInternal, setMarkingInternal] = createSignal(false);
    const [bulkError, setBulkError] = createSignal("");
    const [mergeOpen, setMergeOpen] = createSignal(false);
    const [mergePair, setMergePair] = createSignal<[number, number] | null>(
        null,
    );
    const navigate = useNavigate();

    const [meetings, { refetch }] = createResource(
        () => ({ accountId: props.accountId }),
        async ({ accountId }) => {
            if (accountId !== undefined && accountId !== null)
                return api.getMeetings(accountId);
            return api.getAllMeetings({ limit: 100000 });
        },
    );

    const filtered = () => {
        const q = filter().toLowerCase();
        let list = meetings() || [];
        if (reviewOnly()) list = list.filter((m: any) => m.needs_review);
        if (kindFilter() === "internal") list = list.filter((m: any) => m.internal);
        if (kindFilter() === "external") list = list.filter((m: any) => !m.internal);
        if (!q) return list;
        return list.filter(
            (m: any) =>
                (m.title || m.filename || "").toLowerCase().includes(q) ||
                (m.account_name || "").toLowerCase().includes(q) ||
                (m.attendees || "").toLowerCase().includes(q) ||
                (m.date || "").includes(q) ||
                (m.internal && "internal".includes(q)),
        );
    };

    // Meetings/notes awaiting placement or match review.
    const reviewCount = () =>
        (meetings() || []).filter((m: any) => m.needs_review).length;

    const sel = createSelection(
        () => filtered().map((m: any) => m.id),
        () => props.accountId,
    );

    const deleteMeeting = async (id: number) => {
        if (!confirm("Delete this meeting?")) return;
        await api.deleteMeeting(id);
        sel.remove(id);
        refetch();
        props.onAfterDelete?.();
    };

    // Meetings in the selection that aren't internal yet — the only ones the
    // bulk action has anything to do.
    const selectedExternal = () => {
        const ids = new Set(sel.idList());
        return (meetings() || []).filter((m: any) => ids.has(m.id) && !m.internal);
    };

    // Bulk "these aren't customer-facing". Runs the same per-meeting reassign the
    // Move panel uses, so it strips the account and clears any review flag.
    // Sequential: each call can 409 on a filename collision with an existing
    // internal note, and we want to keep going and report the stragglers.
    const markSelectedInternal = async () => {
        const targets = selectedExternal();
        if (!targets.length || markingInternal()) return;
        if (!confirm(`Mark ${targets.length} meeting${targets.length === 1 ? "" : "s"} as internal? This removes the account link — attendees and notes stay.`)) return;
        setMarkingInternal(true);
        setBulkError("");
        const failed: string[] = [];
        for (const m of targets) {
            try {
                await api.reassignMeetingAccount(m.id, { internal: true });
                sel.remove(m.id);
            } catch (err: any) {
                failed.push(m.title || m.filename || `#${m.id}`);
                void err;
            }
        }
        if (failed.length) {
            setBulkError(
                `Couldn't convert ${failed.length} of ${targets.length}: ${failed.slice(0, 3).join(", ")}${failed.length > 3 ? "…" : ""}. Usually a filename clash with an existing internal note — open one and rename it.`,
            );
        }
        setMarkingInternal(false);
        refetch();
        props.onAfterDelete?.();
    };

    // Snapshot the two selected ids when opening the merge resolver so the modal's
    // pair is stable even if the selection changes underneath.
    const openMerge = () => {
        const ids = sel.idList();
        if (ids.length === 2) {
            setMergePair([ids[0], ids[1]]);
            setMergeOpen(true);
        }
    };

    return (
        <div>
            <div class="flex flex-col gap-3 mb-6 md:flex-row md:items-center">
                <Show when={props.accountId === undefined || props.accountId === null}>
                    <h1 class="text-[26px] font-bold font-[family-name:var(--font-display)]">
                        Meetings
                    </h1>
                </Show>
                <div class="flex items-center gap-4 flex-wrap md:ml-auto">
                    <span class="text-base-300 text-[12px] uppercase tracking-wider">
                        {filtered().length} meeting
                        {filtered().length === 1 ? "" : "s"}
                    </span>
                    <Show when={sel.count() === 2}>
                        <button
                            class="press press-ghost press-sm md:press-md"
                            onClick={openMerge}
                            title="Merge the two selected meetings"
                        >
                            ⇄ Merge 2
                        </button>
                    </Show>
                    <Button
                        variant="primary"
                        size={props.accountId !== undefined && props.accountId !== null ? "sm" : "md"}
                        onClick={() => setModalOpen(true)}
                    >
                        + New Meeting
                    </Button>
                </div>
            </div>

            <Show when={props.accountId === undefined || props.accountId === null}>
                <TodayTimeline
                    meetings={() => meetings() || []}
                    getHref={(m: any) => `/meetings/${m.id}`}
                />
            </Show>

            <div class="mb-5 flex flex-col gap-3 md:flex-row md:items-center">
                <div class="flex items-center bg-base-950 border-2 border-base-500 px-3 py-2 gap-2 focus-within:border-surf-300 transition-colors flex-1">
                    <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        class="text-surf-400"
                    >
                        <circle cx="11" cy="11" r="8" />
                        <path d="m21 21-4.35-4.35" />
                    </svg>
                    <input
                        type="text"
                        placeholder="Filter meetings..."
                        value={filter()}
                        onInput={(e) => setFilter(e.currentTarget.value)}
                        class="flex-1 bg-transparent border-none outline-none text-base-50 text-sm placeholder:text-base-400"
                    />
                </div>
                <Show when={(props.accountId === undefined || props.accountId === null) && (reviewCount() || reviewOnly())}>
                    <label
                        class="flex items-center gap-2 cursor-pointer text-[11px] uppercase tracking-wider font-semibold text-amber-300 shrink-0 px-1"
                        title="Show only parked notes awaiting an account"
                    >
                        <input
                            type="checkbox"
                            class="accent-amber-300 w-4 h-4 cursor-pointer"
                            checked={reviewOnly()}
                            onChange={(e) =>
                                setReviewOnly(e.currentTarget.checked)
                            }
                        />
                        Needs review{reviewCount() ? ` (${reviewCount()})` : ""}
                    </label>
                </Show>
            </div>

            <SelectionToolbar
                selection={sel}
                buildExport={buildMeetingsExport}
                loading={() => meetings.loading}
            >
                <SegmentedControl
                    value={kindFilter()}
                    onChange={setKindFilter}
                    options={[
                        { value: "all", label: "All" },
                        { value: "external", label: "External" },
                        { value: "internal", label: "Internal" },
                    ]}
                />
                <Show when={selectedExternal().length}>
                    <button
                        class="press press-ghost press-sm md:press-md"
                        disabled={markingInternal()}
                        onClick={markSelectedInternal}
                        title="Remove the account link so these stop showing as customer-facing"
                    >
                        {markingInternal()
                            ? "Marking…"
                            : `Mark ${selectedExternal().length} internal`}
                    </button>
                </Show>
            </SelectionToolbar>

            <Show when={bulkError()}>
                <div class="text-[11px] text-scarlet-400 mb-3 font-semibold">
                    {bulkError()}
                </div>
            </Show>

            <ListRows
                items={filtered}
                loading={() => meetings.loading}
                getId={(m: any) => m.id}
                getHref={(m: any) => `/meetings/${m.id}`}
                renderRow={(m: any) => (
                    <>
                        <span class="flex-1 min-w-full md:min-w-0 font-semibold text-sm text-base-50 flex items-center gap-2 flex-wrap">
                            <span>{m.title || m.filename}</span>
                            <Show when={m.needs_review}>
                                <span class="bg-base-950 border-2 border-amber-300 text-amber-300 text-[10px] px-1.5 py-0.5 uppercase tracking-widest font-bold leading-none">
                                    Review
                                </span>
                            </Show>
                            <Show when={m.account_needs_review}>
                                <span
                                    class="bg-base-950 border-2 border-amber-300 text-amber-300 text-[10px] px-1.5 py-0.5 uppercase tracking-widest font-bold leading-none"
                                    title="This meeting's account was created automatically during import — not yet confirmed"
                                >
                                    Account created
                                </span>
                            </Show>
                            <Show when={m.internal}>
                                <span class="bg-base-950 border-2 border-surf-300 text-surf-300 text-[10px] px-1.5 py-0.5 uppercase tracking-widest font-bold leading-none">
                                    Internal
                                </span>
                            </Show>
                        </span>
                        <Show when={props.accountId === undefined || props.accountId === null}>
                            <span class="text-base-300 text-[12px]">
                                {m.internal ? "" : m.account_name}
                            </span>
                        </Show>
                        <span class="text-base-300 text-[12px]">{m.date}</span>
                    </>
                )}
                selection={sel}
                onDelete={deleteMeeting}
                deleteTitle="Delete meeting"
                emptyState={
                    <div class="text-base-300 text-center p-10 text-sm">
                        No meetings found
                    </div>
                }
            />

            <MeetingFormModal
                open={modalOpen()}
                onClose={() => setModalOpen(false)}
                fixedAccountId={props.accountId}
                fixedAccountName={props.accountName}
                onSaved={(m) => {
                    refetch();
                    if (props.onAfterCreate) {
                        props.onAfterCreate(m);
                    } else {
                        navigate(`/meetings/${m.id}`);
                    }
                }}
            />

            <MergeModal
                open={mergeOpen()}
                entity="meetings"
                idA={mergePair()?.[0] ?? null}
                idB={mergePair()?.[1] ?? null}
                onClose={() => setMergeOpen(false)}
                onMerged={() => {
                    sel.clear();
                    refetch();
                    props.onAfterDelete?.();
                }}
            />
        </div>
    );
}
