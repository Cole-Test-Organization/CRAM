import { A } from '@solidjs/router';
import { createMemo, createResource, createSignal, For, Show } from 'solid-js';
import { api } from '../../lib/api';
import type { OrgChartContact, OrgChartNode } from '../../lib/types';

type Props = {
  accountId: number;
};

type BranchProps = {
  node: OrgChartNode;
  childrenByManager: ReadonlyMap<number, OrgChartNode[]>;
  root?: boolean;
  ancestors?: ReadonlySet<number>;
};

function personLabel(person: OrgChartContact) {
  return person.full_name || person.email || `Contact ${person.id}`;
}

function personMeta(person: OrgChartContact) {
  return [person.title, person.email].filter(Boolean);
}

function OrgBranch(props: BranchProps) {
  const children = () => {
    const ancestors = props.ancestors || new Set<number>();
    return (props.childrenByManager.get(props.node.id) || []).filter((child) => !ancestors.has(child.id));
  };
  const nextAncestors = () => new Set([...(props.ancestors || []), props.node.id]);

  return (
    <div data-org-branch={String(props.node.id)} class="min-w-0">
      <div
        data-org-node={String(props.node.id)}
        class="min-w-0 border-2 border-base-600 bg-base-900 px-3 py-3"
        classList={{ 'border-t-[3px] border-t-surf-500': props.root }}
        style={{ 'box-shadow': '2px 2px 0 0 var(--color-base-700)' }}
      >
        <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div class="min-w-0 flex-1">
            <A
              href={`/contacts/${props.node.id}`}
              class="break-words text-[13px] font-semibold text-base-50 hover:text-surf-300"
            >
              {personLabel(props.node)}
            </A>
            <Show when={personMeta(props.node).length > 0}>
              <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-base-300">
                <For each={personMeta(props.node)}>{(item) => <span class="break-all">{item}</span>}</For>
              </div>
            </Show>
          </div>
          <div class="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-base-300">
            <Show when={props.root}>
              <span class="border border-surf-500 px-1.5 py-0.5 text-surf-300">Top level</span>
            </Show>
            <Show when={children().length > 0}>
              <span>{children().length} direct</span>
            </Show>
          </div>
        </div>
      </div>

      <Show when={children().length > 0}>
        <div class="ml-2 mt-2 flex min-w-0 flex-col gap-2 border-l-2 border-base-600 pl-3 md:ml-4 md:pl-5">
          <For each={children()}>
            {(child) => (
              <div class="relative min-w-0">
                <span
                  data-org-edge
                  class="absolute -left-[14px] top-6 h-0.5 w-[14px] bg-base-600 md:-left-[22px] md:w-[22px]"
                  aria-hidden="true"
                />
                <OrgBranch
                  node={child}
                  childrenByManager={props.childrenByManager}
                  ancestors={nextAncestors()}
                />
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

export default function OrgChartPanel(props: Props) {
  const [chart, { mutate, refetch }] = createResource(() => props.accountId, (accountId) => api.getOrgChart(accountId));
  const [search, setSearch] = createSignal('');
  const [savingId, setSavingId] = createSignal<number | null>(null);
  const [saveError, setSaveError] = createSignal<string | null>(null);

  const contacts = createMemo(() => chart()?.contacts || []);
  const nodes = createMemo(() => chart()?.nodes || []);
  const nodeById = createMemo(() => new Map(nodes().map((node) => [node.id, node])));
  const nodeIds = createMemo(() => new Set(nodes().map((node) => node.id)));

  const childrenByManager = createMemo(() => {
    const byManager = new Map<number, OrgChartNode[]>();
    for (const node of nodes()) {
      const managerId = node.reports_to_contact_id;
      if (managerId == null || !nodeIds().has(managerId)) continue;
      const children = byManager.get(managerId) || [];
      children.push(node);
      byManager.set(managerId, children);
    }
    for (const children of byManager.values()) {
      children.sort((a, b) => personLabel(a).localeCompare(personLabel(b)));
    }
    return byManager;
  });

  const roots = createMemo(() => nodes()
    .filter((node) => node.reports_to_contact_id == null || !nodeIds().has(node.reports_to_contact_id))
    .sort((a, b) => personLabel(a).localeCompare(personLabel(b))));

  const descendantsOf = (nodeId: number) => {
    const descendants = new Set<number>();
    const visit = (id: number) => {
      for (const child of childrenByManager().get(id) || []) {
        if (descendants.has(child.id)) continue;
        descendants.add(child.id);
        visit(child.id);
      }
    };
    visit(nodeId);
    return descendants;
  };

  const filteredContacts = createMemo(() => {
    const query = search().trim().toLocaleLowerCase();
    if (!query) return contacts();
    return contacts().filter((contact) => [
      contact.full_name,
      contact.title,
      contact.email,
      contact.company,
    ].some((value) => value?.toLocaleLowerCase().includes(query)));
  });

  const placementValue = (contactId: number) => {
    const node = nodeById().get(contactId);
    if (!node) return 'unassigned';
    if (node.reports_to_contact_id == null) return 'root';
    return `manager:${node.reports_to_contact_id}`;
  };

  const placementLabel = (contactId: number) => {
    const node = nodeById().get(contactId);
    if (!node) return 'Not in chart';
    if (node.reports_to_contact_id == null) return 'Top level';
    const manager = nodeById().get(node.reports_to_contact_id);
    return manager ? `Reports to ${personLabel(manager)}` : 'Manager unavailable';
  };

  const managerOptions = (contactId: number) => {
    const disallowed = descendantsOf(contactId);
    disallowed.add(contactId);
    return contacts().filter((candidate) => !disallowed.has(candidate.id));
  };

  const setPlacement = async (contact: OrgChartContact, rawValue: string) => {
    if (rawValue === placementValue(contact.id)) return;
    setSavingId(contact.id);
    setSaveError(null);
    try {
      const updated = rawValue === 'unassigned'
        ? await api.removeOrgChartContact(props.accountId, contact.id)
        : await api.setOrgChartManager(
          props.accountId,
          contact.id,
          rawValue === 'root' ? null : Number(rawValue.slice('manager:'.length)),
        );
      mutate(updated);
    } catch (err: any) {
      setSaveError(err?.message || 'Unable to update org chart');
      void refetch();
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Show when={!chart.loading} fallback={<div class="p-10 text-center text-base-300">Loading...</div>}>
      <Show
        when={!chart.error}
        fallback={<div class="panel panel-accent p-10 text-center text-sm text-scarlet-300">Unable to load org chart</div>}
      >
        <div data-org-chart-panel class="flex min-w-0 flex-col gap-7">
          <section data-org-chart class="flex min-w-0 flex-col gap-3">
            <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <h2 class="font-[family-name:var(--font-display)] text-[20px] font-bold">Org Chart</h2>
              <span class="text-[12px] uppercase tracking-wider text-base-300">
                {nodes().length} in chart
              </span>
            </div>

            <Show
              when={nodes().length > 0}
              fallback={(
                <div class="panel panel-accent p-8 text-center text-sm text-base-300 md:p-10">
                  No reporting structure yet. Assign contacts from the index below.
                </div>
              )}
            >
              <div class="panel panel-accent flex min-w-0 flex-col gap-4 p-3 md:p-4">
                <For each={roots()}>
                  {(root) => <OrgBranch node={root} childrenByManager={childrenByManager()} root />}
                </For>
              </div>
            </Show>
          </section>

          <section data-contact-index class="flex min-w-0 flex-col gap-3">
            <div class="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <h3 class="font-[family-name:var(--font-display)] text-[17px] font-bold">Contact Index</h3>
                <p class="mt-1 max-w-3xl text-[12px] text-base-300">
                  Search every contact associated with this account, then place them at the top level or under the person they report to.
                </p>
              </div>
              <span class="text-[11px] uppercase tracking-wider text-base-300">
                {filteredContacts().length} of {contacts().length}
              </span>
            </div>

            <input
              class="input-vintage w-full"
              type="search"
              value={search()}
              placeholder="Search contacts by name, title, email, or company..."
              aria-label="Search account contacts"
              onInput={(event) => setSearch(event.currentTarget.value)}
            />

            <Show when={saveError()}>
              {(message) => (
                <div role="alert" class="border-2 border-scarlet-400 bg-base-900 p-3 text-[12px] text-scarlet-300">
                  {message()}
                </div>
              )}
            </Show>

            <Show
              when={filteredContacts().length > 0}
              fallback={(
                <div class="panel panel-accent p-8 text-center text-sm text-base-300">
                  {contacts().length ? `No contacts match “${search().trim()}”.` : 'No contacts are associated with this account.'}
                </div>
              )}
            >
              <div class="panel panel-accent divide-y-2 divide-base-700">
                <For each={filteredContacts()}>
                  {(contact) => {
                    const directReportCount = () => childrenByManager().get(contact.id)?.length || 0;
                    return (
                      <div
                        data-contact-index-row={String(contact.id)}
                        class="flex flex-col gap-3 p-3 md:flex-row md:flex-wrap md:items-center md:justify-between md:p-4"
                      >
                        <div class="min-w-0 flex-1">
                          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <A
                              href={`/contacts/${contact.id}`}
                              class="break-words text-[13px] font-semibold text-base-50 hover:text-surf-300"
                            >
                              {personLabel(contact)}
                            </A>
                            <span
                              data-contact-placement={String(contact.id)}
                              class="border border-base-600 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-base-300"
                            >
                              {placementLabel(contact.id)}
                            </span>
                          </div>
                          <Show when={personMeta(contact).length > 0}>
                            <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-base-300">
                              <For each={personMeta(contact)}>{(item) => <span class="break-all">{item}</span>}</For>
                            </div>
                          </Show>
                        </div>

                        <label class="flex w-full min-w-0 flex-col gap-1 text-[10px] uppercase tracking-wider text-base-300 md:w-[280px]">
                          Placement
                          <select
                            class="input-vintage w-full cursor-pointer"
                            value={placementValue(contact.id)}
                            disabled={savingId() !== null}
                            aria-label={`Placement for ${personLabel(contact)}`}
                            title={directReportCount() ? 'Reassign direct reports before removing this manager from the chart.' : undefined}
                            onChange={(event) => setPlacement(contact, event.currentTarget.value)}
                          >
                            <option value="unassigned" disabled={directReportCount() > 0}>
                              Not in chart{directReportCount() ? ' — reassign reports first' : ''}
                            </option>
                            <option value="root">Top level</option>
                            <For each={managerOptions(contact.id)}>
                              {(candidate) => (
                                <option value={`manager:${candidate.id}`}>
                                  {personLabel(candidate)}{nodeIds().has(candidate.id) ? '' : ' — add as top level'}
                                </option>
                              )}
                            </For>
                          </select>
                        </label>
                      </div>
                    );
                  }}
                </For>
              </div>
            </Show>
          </section>
        </div>
      </Show>
    </Show>
  );
}
