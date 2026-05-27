import { createResource, createSignal, For, Show } from "solid-js";
import { api } from "../../lib/api";
import Button from "../Button";

export default function InternalDomainsSettings() {
    const [internalDomains, { refetch: refetchInternalDomains }] =
        createResource(() => api.listInternalDomains());

    const [newDomain, setNewDomain] = createSignal("");
    const [addingDomain, setAddingDomain] = createSignal(false);
    const [domainError, setDomainError] = createSignal("");

    const addDomain = async () => {
        const v = newDomain().trim();
        if (!v) {
            setDomainError("Enter a domain");
            return;
        }
        setAddingDomain(true);
        setDomainError("");
        try {
            await api.addInternalDomain(v);
            setNewDomain("");
            await refetchInternalDomains();
        } catch (err: any) {
            setDomainError(err?.message || "Failed to add domain");
        } finally {
            setAddingDomain(false);
        }
    };

    const removeDomain = async (d: string) => {
        if (!confirm(`Remove ${d} from your internal domain list?`)) return;
        try {
            await api.removeInternalDomain(d);
            await refetchInternalDomains();
        } catch (err: any) {
            setDomainError(err?.message || "Failed to remove domain");
        }
    };

    return (
        <div class="panel panel-accent p-5">
            <h2 class="text-[15px] font-bold uppercase tracking-widest text-surf-300 mb-4 font-[family-name:var(--font-display)]">
                Internal Domains
            </h2>

            <p class="text-base-300 text-[12px] mb-4">
                Email domains that belong to <b>your own company</b>. The
                "from emails" meeting flow tags attendees on these domains as{" "}
                <code class="text-surf-300">kind=internal</code> — no new
                account gets created for them, and no LinkedIn research is run
                on them. Add every alias your company uses (e.g.{" "}
                <code class="text-surf-300">paloaltonetworks.com</code> and{" "}
                <code class="text-surf-300">pan.dev</code>).
            </p>

            <div class="flex gap-2 mb-3 flex-wrap">
                <input
                    type="text"
                    value={newDomain()}
                    onInput={(e) => setNewDomain(e.currentTarget.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            addDomain();
                        }
                    }}
                    placeholder="paloaltonetworks.com"
                    class="input-vintage flex-1 min-w-[160px]"
                />
                <Button
                    variant="primary"
                    disabled={addingDomain()}
                    onClick={addDomain}
                >
                    {addingDomain() ? "Adding…" : "Add"}
                </Button>
            </div>

            <Show when={domainError()}>
                <div class="text-[12px] text-scarlet-400 mb-2 font-semibold">
                    {domainError()}
                </div>
            </Show>

            <Show
                when={!internalDomains.loading}
                fallback={<div class="text-base-300 text-sm">Loading…</div>}
            >
                <Show
                    when={(internalDomains()?.domains || []).length > 0}
                    fallback={
                        <div class="text-[11px] text-base-400 italic">
                            No internal domains yet. (Until you add one, the
                            server falls back to the{" "}
                            <code class="text-surf-300">SELF_DOMAINS</code> env
                            var if set.)
                        </div>
                    }
                >
                    <div class="border-2 border-base-600 bg-base-950 flex flex-col">
                        <For each={internalDomains()?.domains || []}>
                            {(d) => (
                                <div class="flex items-center justify-between gap-2 px-3 py-2 border-b border-base-700 last:border-b-0">
                                    <span class="text-sm text-base-50 font-mono break-all">
                                        {d.domain}
                                    </span>
                                    <button
                                        type="button"
                                        class="press press-ghost press-sm"
                                        onClick={() => removeDomain(d.domain)}
                                    >
                                        Remove
                                    </button>
                                </div>
                            )}
                        </For>
                    </div>
                </Show>
            </Show>
        </div>
    );
}
