import { A } from '@solidjs/router';
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  onCleanup,
  Show,
} from 'solid-js';
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

type PlacementOption = {
  value: string;
  label: string;
  searchText: string;
  group: 'placement' | 'chart' | 'other';
  meta?: string;
  disabled?: boolean;
};

type PlacementPickerProps = {
  contact: OrgChartContact;
  value: string;
  valueLabel: string;
  candidates: OrgChartContact[];
  chartContactIds: ReadonlySet<number>;
  directReportCount: number;
  disabled: boolean;
  onChange: (value: string) => void;
};

function personLabel(person: OrgChartContact) {
  return person.full_name || person.email || `Contact ${person.id}`;
}

function personMeta(person: OrgChartContact) {
  return [person.title, person.email].filter(Boolean);
}

function PlacementPicker(props: PlacementPickerProps) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [activeValue, setActiveValue] = createSignal<string | null>(null);
  let rootRef: HTMLDivElement | undefined;
  let inputRef: HTMLInputElement | undefined;

  const contactLabel = () => personLabel(props.contact);
  const listboxId = `org-placement-options-${props.contact.id}`;
  const optionId = (value: string) => `${listboxId}-${value.replace(/[^a-z0-9-]/gi, '-')}`;

  const options = createMemo<PlacementOption[]>(() => [
    {
      value: 'unassigned',
      label: 'Not in chart',
      searchText: 'not in chart remove unassigned',
      group: 'placement',
      meta: props.directReportCount ? 'Reassign direct reports first' : 'Remove from chart',
      disabled: props.directReportCount > 0,
    },
    {
      value: 'root',
      label: 'Top level',
      searchText: 'top level root no manager',
      group: 'placement',
      meta: 'No manager',
    },
    ...props.candidates.map((candidate): PlacementOption => {
      const inChart = props.chartContactIds.has(candidate.id);
      return {
        value: `manager:${candidate.id}`,
        label: personLabel(candidate),
        searchText: [
          personLabel(candidate),
          candidate.title,
          candidate.email,
          candidate.company,
        ].filter(Boolean).join(' '),
        group: inChart ? 'chart' : 'other',
        meta: personMeta(candidate).join(' · '),
      };
    }),
  ]);

  const filteredOptions = createMemo(() => {
    const normalized = query().trim().toLocaleLowerCase();
    if (!normalized) return options();
    return options().filter((option) => option.searchText.toLocaleLowerCase().includes(normalized));
  });

  const optionGroups = createMemo(() => {
    const visible = filteredOptions();
    return [
      { key: 'placement', label: 'Placement', options: visible.filter((option) => option.group === 'placement') },
      { key: 'chart', label: 'In org chart', options: visible.filter((option) => option.group === 'chart') },
      { key: 'other', label: 'Other account contacts', options: visible.filter((option) => option.group === 'other') },
    ].filter((group) => group.options.length > 0);
  });

  const enabledOptions = () => filteredOptions().filter((option) => !option.disabled);

  const closePicker = () => {
    setOpen(false);
    setQuery('');
    setActiveValue(null);
  };

  const openPicker = () => {
    if (props.disabled || open()) return;
    setQuery('');
    setActiveValue(props.value);
    setOpen(true);
  };

  const selectOption = (option: PlacementOption) => {
    if (option.disabled || props.disabled) return;
    closePicker();
    inputRef?.blur();
    props.onChange(option.value);
  };

  const moveActive = (direction: 1 | -1) => {
    const available = enabledOptions();
    if (!available.length) return;
    const currentIndex = available.findIndex((option) => option.value === activeValue());
    const nextIndex = currentIndex < 0
      ? (direction === 1 ? 0 : available.length - 1)
      : (currentIndex + direction + available.length) % available.length;
    const nextValue = available[nextIndex].value;
    setActiveValue(nextValue);
    queueMicrotask(() => document.getElementById(optionId(nextValue))?.scrollIntoView?.({ block: 'nearest' }));
  };

  createEffect(() => {
    if (!open()) return;
    const available = enabledOptions();
    if (!available.some((option) => option.value === activeValue())) {
      setActiveValue(available[0]?.value || null);
    }
  });

  createEffect(() => {
    if (props.disabled && open()) closePicker();
  });

  createEffect(() => {
    if (!open()) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef?.contains(event.target as Node)) closePicker();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    onCleanup(() => document.removeEventListener('pointerdown', closeOnOutsidePointer));
  });

  return (
    <div
      ref={rootRef}
      class="relative"
      onFocusOut={(event) => {
        const next = event.relatedTarget as Node | null;
        if (!next || !rootRef?.contains(next)) closePicker();
      }}
    >
      <div class="relative">
        <input
          ref={inputRef}
          class="input-vintage w-full pr-9"
          type="text"
          role="combobox"
          value={open() ? query() : props.valueLabel}
          placeholder={open() ? 'Search people or placements...' : undefined}
          readOnly={!open()}
          disabled={props.disabled}
          autocomplete="off"
          aria-label={`Placement for ${contactLabel()}`}
          aria-expanded={open()}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={open() && activeValue() ? optionId(activeValue()!) : undefined}
          title={props.directReportCount ? 'Reassign direct reports before removing this manager from the chart.' : undefined}
          onFocus={openPicker}
          onClick={openPicker}
          onInput={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              closePicker();
              inputRef?.blur();
              return;
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              if (!open()) openPicker();
              moveActive(event.key === 'ArrowDown' ? 1 : -1);
              return;
            }
            if (event.key === 'Enter' && open()) {
              event.preventDefault();
              const option = enabledOptions().find((candidate) => candidate.value === activeValue());
              if (option) selectOption(option);
            }
          }}
        />
        <svg
          aria-hidden="true"
          class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-surf-400"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d={open() ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
        </svg>
      </div>

      <Show when={open()}>
        <div
          id={listboxId}
          role="listbox"
          aria-label={`Placement options for ${contactLabel()}`}
          class="absolute left-0 right-0 z-50 mt-1 max-h-[min(360px,60svh)] overflow-y-auto border-2 border-base-500 bg-base-900 shadow-[4px_4px_0_0_var(--color-base-600)]"
        >
          <Show
            when={filteredOptions().length > 0}
            fallback={(
              <div class="p-4 text-center text-[12px] normal-case tracking-normal text-base-300">
                No people or placements match “{query().trim()}”.
              </div>
            )}
          >
            <For each={optionGroups()}>
              {(group) => (
                <div role="group" aria-label={group.label}>
                  <div class="sticky top-0 border-y border-base-700 bg-base-800 px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest text-surf-300 first:border-t-0">
                    {group.label}
                  </div>
                  <For each={group.options}>
                    {(option) => (
                      <button
                        id={optionId(option.value)}
                        type="button"
                        role="option"
                        data-placement-value={option.value}
                        aria-selected={option.value === props.value}
                        aria-disabled={option.disabled || undefined}
                        disabled={option.disabled}
                        class="press-row min-h-11 w-full gap-3 border-b border-base-700 text-left normal-case tracking-normal last:border-b-0 disabled:cursor-not-allowed disabled:opacity-45"
                        classList={{
                          'bg-base-700 border-l-surf-400': option.value === activeValue(),
                        }}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => {
                          if (!option.disabled) setActiveValue(option.value);
                        }}
                        onClick={() => selectOption(option)}
                      >
                        <span class="min-w-0 flex-1">
                          <span class="block break-words text-[13px] font-semibold text-base-50">{option.label}</span>
                          <Show when={option.meta}>
                            <span class="mt-0.5 block break-words text-[10px] text-base-300">{option.meta}</span>
                          </Show>
                        </span>
                        <Show when={option.value === props.value || option.group !== 'placement'}>
                          <span class="shrink-0 text-[9px] font-bold uppercase tracking-wider text-base-300">
                            {option.value === props.value ? 'Current' : option.group === 'chart' ? 'In chart' : 'Add as top level'}
                          </span>
                        </Show>
                      </button>
                    )}
                  </For>
                </div>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  );
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
    return contacts()
      .filter((candidate) => !disallowed.has(candidate.id))
      .sort((a, b) => {
        const chartRank = Number(nodeIds().has(b.id)) - Number(nodeIds().has(a.id));
        return chartRank || personLabel(a).localeCompare(personLabel(b));
      });
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

                        <div class="flex w-full min-w-0 flex-col gap-1 text-[10px] uppercase tracking-wider text-base-300 md:w-[280px]">
                          <span>Placement</span>
                          <PlacementPicker
                            contact={contact}
                            value={placementValue(contact.id)}
                            valueLabel={placementLabel(contact.id)}
                            candidates={managerOptions(contact.id)}
                            chartContactIds={nodeIds()}
                            directReportCount={directReportCount()}
                            disabled={savingId() !== null}
                            onChange={(value) => void setPlacement(contact, value)}
                          />
                        </div>
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
