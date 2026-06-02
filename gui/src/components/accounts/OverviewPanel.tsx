import { createSignal, createResource, For, Show } from 'solid-js';
import { A } from '@solidjs/router';
import { api } from '../../lib/api';
import type { createAutoSave } from '../../lib/editing';
import AccountPicker from '../AccountPicker';
import Button from '../Button';
import EditableMarkdown from '../EditableMarkdown';

type Props = {
  /** The loaded account (snapshot) — reads .relationship_summary, .domains, .partners, .team. */
  account: any;
  /** The shared account auto-saver from AccountDetail (patches relationship_summary + domains). */
  saver: ReturnType<typeof createAutoSave>;
  /** Whether the Overview tab is selected. The panel stays mounted across tab
      switches (so the inline-edit state below persists) and just hides its
      content when inactive — that's why it's gated here rather than by a
      <Show> around the whole component in AccountDetail. */
  active: boolean;
};

/* Subtle inline-edit field — CSS class .press-field handles hover/focus, with a
   mobile iOS-zoom-preventing 16px font-size baked in. */
const fieldClass = 'press-field';
/* Tiny X remove button — CSS class .btn-x with responsive touch sizing. */
const btnX = 'btn-x';

const panelHeading =
  'text-[13px] font-bold uppercase tracking-widest text-surf-300 font-[family-name:var(--font-display)]';

// The Overview tab: relationship summary, email/web domains, channel partners,
// and the internal supporting team. Split out of AccountDetail so the page file
// stays focused on the header/tabs shell. Each section keeps an optimistic local
// shadow of its list (matching the rest of the app) so edits feel instant
// without a full account refetch.
export default function OverviewPanel(props: Props) {
  const acct = props.account;
  const saver = props.saver;

  const domains0 =
    typeof acct.domains === 'string' ? JSON.parse(acct.domains || '[]') : acct.domains || [];
  const partners0 = Array.isArray(acct.partners) ? acct.partners : [];
  const team0 = Array.isArray(acct.team) ? acct.team : [];

  const [localDomains, setLocalDomains] = createSignal<string[]>([...domains0]);
  const [localPartners, setLocalPartners] = createSignal<any[]>([...partners0]);
  const [localTeam, setLocalTeam] = createSignal<any[]>([...team0]);

  // ── Channel partners ──────────────────────────────────────────────────
  const [addingPartner, setAddingPartner] = createSignal(false);
  const [partnerPick, setPartnerPick] = createSignal<{ id: number; name: string; slug: string } | null>(null);
  const [partnerError, setPartnerError] = createSignal('');

  const addPartner = async () => {
    const p = partnerPick();
    if (!p) return;
    if (p.id === acct.id) {
      setPartnerError('An account cannot be its own partner');
      return;
    }
    if (localPartners().some((lp: any) => lp.id === p.id)) {
      setPartnerError('Already linked');
      return;
    }
    try {
      const updated = await api.addPartner(acct.id, p.id);
      setLocalPartners(updated);
      setPartnerPick(null);
      setAddingPartner(false);
      setPartnerError('');
    } catch (err: any) {
      setPartnerError(err?.message || 'Failed to link partner');
    }
  };

  const removePartner = async (partnerId: number) => {
    const updated = await api.removePartner(acct.id, partnerId);
    setLocalPartners(updated);
  };

  // ── Supporting team (internal contacts mapped to this account) ─────────
  // Internal teammates are global contacts (kind=internal); linking one to this
  // account records that they support it. We reuse the contact↔account link
  // endpoints — no dedicated team API needed.
  const [addingTeam, setAddingTeam] = createSignal(false);
  const [teamQuery, setTeamQuery] = createSignal('');
  const [teamError, setTeamError] = createSignal('');

  // Lazily fetch the internal-contact roster when the picker opens (re-fetched
  // each open so newly-created teammates show up). Source is falsy while closed,
  // so the resource never runs until the user clicks + Add.
  const [internalContacts] = createResource(
    () => (addingTeam() ? true : undefined),
    () => api.getAllContacts({ kind: 'internal' }),
  );

  const availableTeam = () => {
    const linked = new Set(localTeam().map((t) => t.id));
    const q = teamQuery().toLowerCase().trim();
    return (internalContacts() || [])
      .filter((c: any) => !linked.has(c.id))
      .filter(
        (c: any) =>
          !q ||
          (c.full_name || '').toLowerCase().includes(q) ||
          (c.email || '').toLowerCase().includes(q) ||
          (c.title || '').toLowerCase().includes(q),
      );
  };

  const addTeamMember = async (contact: any) => {
    try {
      await api.linkContactAccount(contact.id, acct.id);
      setLocalTeam(
        [...localTeam(), contact].sort((a, b) =>
          (a.full_name || a.email || '').localeCompare(b.full_name || b.email || ''),
        ),
      );
      setAddingTeam(false);
      setTeamQuery('');
      setTeamError('');
    } catch (err: any) {
      setTeamError(err?.message || 'Failed to add team member');
    }
  };

  const removeTeamMember = async (contactId: number) => {
    await api.unlinkContactAccount(contactId, acct.id);
    setLocalTeam(localTeam().filter((t) => t.id !== contactId));
  };

  return (
    <Show when={props.active}>
      <div class="panel panel-accent p-5">
        <h3 class={panelHeading}>Relationship Summary</h3>
        <EditableMarkdown
          content={acct.relationship_summary || ''}
          onSave={(val) => saver.save({ relationship_summary: val })}
          status={saver.status()}
        />
      </div>

      <div class="panel panel-accent p-5 mt-4">
        <div class="flex justify-between items-center mb-3">
          <h3 class={panelHeading}>Domains</h3>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setLocalDomains([...localDomains(), ''])}
          >+ Add</Button>
        </div>
        <For each={localDomains()} fallback={<span class="text-base-300 text-[13px]">No domains. Click + Add to associate email/web domains with this account.</span>}>
          {(d: string, i) => (
            <div class="flex gap-2 items-center mt-2">
              <input
                class={`${fieldClass} flex-1`}
                placeholder="acme.com"
                value={d}
                onInput={(e) => {
                  const updated = [...localDomains()];
                  updated[i()] = e.currentTarget.value;
                  setLocalDomains(updated);
                }}
                onBlur={() => saver.saveNow({ domains: localDomains() })}
              />
              <button class={btnX} onClick={() => {
                const updated = localDomains().filter((_, j: number) => j !== i());
                setLocalDomains(updated);
                saver.saveNow({ domains: updated });
              }}>×</button>
            </div>
          )}
        </For>
      </div>

      <div class="panel panel-accent p-5 mt-4">
        <div class="flex justify-between items-center mb-3">
          <h3 class={panelHeading}>Channel Partners</h3>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setAddingPartner(!addingPartner());
              setPartnerError('');
            }}
          >
            {addingPartner() ? 'Cancel' : '+ Add'}
          </Button>
        </div>
        <Show when={addingPartner()}>
          <div class="mb-3 flex flex-col gap-2">
            <AccountPicker
              value={partnerPick()}
              onChange={setPartnerPick}
              placeholder="Search or create a partner account..."
            />
            <Show when={partnerError()}>
              <div class="text-[11px] text-scarlet-400 font-semibold">{partnerError()}</div>
            </Show>
            <div class="flex gap-2 justify-end">
              <Button variant="primary" size="sm" onClick={addPartner} disabled={!partnerPick()}>
                Link Partner
              </Button>
            </div>
          </div>
        </Show>
        <For each={localPartners()} fallback={<span class="text-base-300 text-[13px]">No channel partners linked. Click + Add to link an existing partner account or create a new one.</span>}>
          {(p: any) => (
            <div class="flex items-center gap-2 border-b border-base-700 last:border-b-0">
              <A href={`/accounts/${p.slug}`} class="flex-1 min-w-0 press-row gap-3 flex-wrap">
                <span class="flex-1 min-w-[60%] md:min-w-0 text-base-50 font-semibold text-sm">{p.name}</span>
                <Show when={p.status}>
                  <span class="text-base-400 text-[11px] uppercase tracking-wider">{p.status}</span>
                </Show>
                <Show when={typeof p.contact_count === 'number'}>
                  <span class="text-surf-300 text-[11px] uppercase tracking-wider">{p.contact_count} contact{p.contact_count === 1 ? '' : 's'}</span>
                </Show>
              </A>
              <button class={`${btnX} mr-2 md:mr-3 shrink-0`} onClick={() => removePartner(p.id)} title="Unlink partner">×</button>
            </div>
          )}
        </For>
      </div>

      {/* === SUPPORTING TEAM (internal contacts mapped to this account) === */}
      <div class="panel panel-accent p-5 mt-4">
        <div class="flex justify-between items-center mb-3">
          <h3 class={panelHeading}>Supporting Team</h3>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setAddingTeam(!addingTeam());
              setTeamError('');
              setTeamQuery('');
            }}
          >
            {addingTeam() ? 'Cancel' : '+ Add'}
          </Button>
        </div>
        <Show when={addingTeam()}>
          <div class="mb-3 flex flex-col gap-2">
            <input
              class={`${fieldClass} w-full`}
              placeholder="Search your internal contacts..."
              value={teamQuery()}
              onInput={(e) => setTeamQuery(e.currentTarget.value)}
              autofocus
            />
            <Show when={teamError()}>
              <div class="text-[11px] text-scarlet-400 font-semibold">{teamError()}</div>
            </Show>
            <div class="border-2 border-base-600 max-h-[260px] overflow-y-auto bg-base-950">
              <Show when={!internalContacts.loading} fallback={<div class="text-base-300 p-3 text-center text-sm">Loading...</div>}>
                <For each={availableTeam()} fallback={
                  <div class="text-base-300 p-3 text-center text-[13px]">
                    {(internalContacts() || []).length === 0
                      ? 'No internal contacts yet. Create teammates as contacts with kind "internal" first.'
                      : 'No unlinked internal contacts match.'}
                  </div>
                }>
                  {(c: any) => (
                    <button
                      type="button"
                      class="press-row w-full text-left border-b border-base-700 last:border-b-0 gap-3 flex-wrap"
                      onClick={() => addTeamMember(c)}
                    >
                      <span class="flex-1 min-w-[60%] md:min-w-0 text-base-50 font-semibold text-sm">{c.full_name || c.email}</span>
                      <Show when={c.title}>
                        <span class="text-base-400 text-[11px]">{c.title}</span>
                      </Show>
                      <Show when={c.email}>
                        <span class="text-surf-300 text-[11px]">{c.email}</span>
                      </Show>
                    </button>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </Show>
        <For each={localTeam()} fallback={<span class="text-base-300 text-[13px]">No internal team mapped. Click + Add to record which of your teammates support this account.</span>}>
          {(t: any) => (
            <div class="flex items-center gap-2 border-b border-base-700 last:border-b-0">
              <A href={`/contacts/${t.id}`} class="flex-1 min-w-0 press-row gap-3 flex-wrap">
                <span class="flex-1 min-w-[60%] md:min-w-0 text-base-50 font-semibold text-sm">{t.full_name || t.email}</span>
                <Show when={t.title}>
                  <span class="text-base-400 text-[11px] uppercase tracking-wider">{t.title}</span>
                </Show>
                <Show when={t.email}>
                  <span class="text-surf-300 text-[11px]">{t.email}</span>
                </Show>
              </A>
              <button class={`${btnX} mr-2 md:mr-3 shrink-0`} onClick={() => removeTeamMember(t.id)} title="Remove from supporting team">×</button>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
