import { createResource, createSignal, For, Show, createEffect } from 'solid-js';
import { A, useParams, useNavigate } from '@solidjs/router';
import { api } from '../lib/api';
import MarkdownRenderer from '../components/MarkdownRenderer';
import { createAutoSave, type SaveStatus } from '../lib/editing';
import { AccountFormModal } from '../components/FormModals';
import AccountPicker from '../components/AccountPicker';
import Button from '../components/Button';
import TechnicalProfilePanel from '../components/accounts/TechnicalProfilePanel';
import NotesPanel from '../components/NotesPanel';
import BackLink from '../components/BackLink';
import MeetingsList from './MeetingsList';
import ContactList from './ContactList';
import OpportunitiesList from './OpportunitiesList';

function SaveIndicator(props: { status: SaveStatus }) {
  return (
    <Show when={props.status !== 'idle'}>
      <span class={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 border-2 ${
        props.status === 'saving' ? 'text-amber-300 border-amber-500/50 bg-amber-500/10' :
        props.status === 'saved' ? 'text-surf-300 border-surf-500/50 bg-surf-500/10' :
        'text-scarlet-300 border-scarlet-500/50 bg-scarlet-500/10'
      }`}>
        {props.status === 'saving' ? 'Saving...' : props.status === 'saved' ? 'Saved' : 'Error'}
      </span>
    </Show>
  );
}

function EditableMarkdown(props: { content: string; onSave: (val: string) => void; status: SaveStatus }) {
  const [editing, setEditing] = createSignal(false);
  const [value, setValue] = createSignal(props.content || '');
  let textareaRef: HTMLTextAreaElement | undefined;

  createEffect(() => setValue(props.content || ''));

  return (
    <div>
      <div class="flex justify-between items-center mb-3">
        <div />
        <div class="flex items-center gap-2">
          <SaveIndicator status={props.status} />
          <Show when={editing()}>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Done</Button>
          </Show>
        </div>
      </div>
      <Show when={editing()} fallback={
        <div
          class="mt-2 cursor-text p-3 -m-3 transition-colors duration-150 hover:bg-base-700/30"
          onClick={() => {
            setEditing(true);
            requestAnimationFrame(() => textareaRef?.focus());
          }}
        >
          <Show when={value()} fallback={<span class="text-base-300 text-[13px] italic">Click to add content...</span>}>
            <MarkdownRenderer content={value()} />
          </Show>
        </div>
      }>
        <textarea
          ref={textareaRef}
          class="input-vintage font-mono text-[12px] leading-relaxed mt-2"
          value={value()}
          onInput={(e) => {
            const v = e.currentTarget.value;
            setValue(v);
            props.onSave(v);
          }}
          rows={12}
        />
      </Show>
    </div>
  );
}

export default function AccountDetail() {
  const params = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [data, { refetch }] = createResource(() => params.slug, (slug) => api.getAccount(slug));
  const [tab, setTab] = createSignal('overview');

  const accountSaver = createAutoSave(async (patch: any) => {
    const acct = data();
    if (acct) await api.patchAccount(acct.id, patch);
  });

  const [accountModalOpen, setAccountModalOpen] = createSignal(false);

  const deleteAccount = async () => {
    const acct = data();
    if (!acct) return;
    if (!confirm(`Delete account "${acct.name}" and all its contacts/meetings?`)) return;
    await api.deleteAccount(acct.id);
    navigate(acct.status === 'partner' ? '/partners' : '/accounts');
  };

  /* Subtle inline-edit field — CSS class .press-field handles hover/focus,
     with mobile iOS-zoom-preventing 16px font-size baked in. */
  const fieldClass = "press-field";
  /* Tiny X remove button — CSS class .btn-x with responsive touch sizing. */
  const btnX = "btn-x";

  const tabClass = (active: boolean) =>
    `px-4 py-2 text-[11px] cursor-pointer border-b-2 transition-colors duration-150 uppercase tracking-widest font-bold ${
      active ? 'text-surf-300 border-b-surf-400' : 'text-base-300 border-transparent hover:text-base-50'
    }`;

  return (
    <div>
      <BackLink fallbackHref="/" fallbackLabel="Dashboard" />

      <Show when={data()} fallback={<div class="text-base-300 p-10 text-center">Loading...</div>}>
        {(account) => {
          const acct = account();
          const domains = typeof acct.domains === 'string' ? JSON.parse(acct.domains || '[]') : (acct.domains || []);
          const partners = Array.isArray(acct.partners) ? acct.partners : [];

          const [localDomains, setLocalDomains] = createSignal<string[]>([...domains]);
          const [localPartners, setLocalPartners] = createSignal<any[]>([...partners]);
          const [addingPartner, setAddingPartner] = createSignal(false);
          const [partnerPick, setPartnerPick] = createSignal<{ id: number; name: string; slug: string } | null>(null);
          const [partnerError, setPartnerError] = createSignal('');
          const [editingName, setEditingName] = createSignal(false);
          const [nameVal, setNameVal] = createSignal(acct.name);

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

          return (
            <>
              <div class="flex flex-col gap-4 mb-6 md:flex-row md:justify-between md:items-start">
                <div class="flex-1 min-w-0">
                  <Show when={editingName()} fallback={
                    <h1 class="text-[26px] font-bold cursor-pointer font-[family-name:var(--font-display)]" onClick={() => setEditingName(true)} title="Click to edit">{acct.name}</h1>
                  }>
                    <input
                      class={`${fieldClass} text-[26px] font-bold py-0.5 px-1.5 w-full font-[family-name:var(--font-display)]`}
                      value={nameVal()}
                      onInput={(e) => setNameVal(e.currentTarget.value)}
                      onBlur={() => {
                        setEditingName(false);
                        if (nameVal() !== acct.name) {
                          accountSaver.saveNow({ name: nameVal() });
                        }
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                      autofocus
                    />
                  </Show>
                  <div class="flex items-center gap-3 mt-1 flex-wrap">
                    <select
                      class={fieldClass}
                      value={acct.status === 'partner' ? 'partner' : 'account'}
                      onChange={(e) => accountSaver.saveNow({ status: e.currentTarget.value })}
                    >
                      <option value="account">Account</option>
                      <option value="partner">Partner</option>
                    </select>
                    <input
                      type="date"
                      class={fieldClass}
                      value={acct.last_contact || ''}
                      onChange={(e) => accountSaver.saveNow({ last_contact: e.currentTarget.value || null })}
                      title="Last contact date"
                    />
                    <SaveIndicator status={accountSaver.status()} />
                  </div>
                </div>
                <div class="flex gap-3 flex-wrap">
                  <Button variant="ghost" size="sm" onClick={async () => {
                    try {
                      const bundle = await api.exportAccountBundle(acct.slug);
                      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${acct.slug}.json`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                    } catch (err: any) {
                      alert(`Export failed: ${err?.message || err}`);
                    }
                  }} title="Download a portable JSON bundle (account + details + contacts + meetings + opportunities + partner shells)">Export JSON</Button>
                  <Button variant="ghost" size="sm" onClick={() => setAccountModalOpen(true)} title="Edit account details">Edit</Button>
                  <Button variant="danger" size="sm" onClick={deleteAccount} title="Delete account">Delete</Button>
                </div>
              </div>

              <div class="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 mb-5">
                <div class="flex gap-1 border-b-2 border-base-600 min-w-max md:min-w-0">
                  <div class={tabClass(tab() === 'overview')} onClick={() => setTab('overview')}>Overview</div>
                  <div class={tabClass(tab() === 'profile')} onClick={() => setTab('profile')}>Profile</div>
                  <div class={tabClass(tab() === 'contacts')} onClick={() => setTab('contacts')}>
                    Contacts ({account().contacts?.length || 0})
                  </div>
                  <div class={tabClass(tab() === 'meetings')} onClick={() => setTab('meetings')}>
                    Meetings ({account().meetings?.length || 0})
                  </div>
                  <div class={tabClass(tab() === 'opportunities')} onClick={() => setTab('opportunities')}>
                    Opportunities ({account().opportunities?.length || 0})
                  </div>
                  <div class={tabClass(tab() === 'notes')} onClick={() => setTab('notes')}>Notes</div>
                </div>
              </div>

              {/* === OVERVIEW TAB === */}
              <Show when={tab() === 'overview'}>
                <div class="panel panel-accent p-5">
                  <h3 class="text-[13px] font-bold uppercase tracking-widest text-surf-300 font-[family-name:var(--font-display)]">Relationship Summary</h3>
                  <EditableMarkdown
                    content={acct.relationship_summary || ''}
                    onSave={(val) => accountSaver.save({ relationship_summary: val })}
                    status={accountSaver.status()}
                  />
                </div>

                <div class="panel panel-accent p-5 mt-4">
                  <div class="flex justify-between items-center mb-3">
                    <h3 class="text-[13px] font-bold uppercase tracking-widest text-surf-300 font-[family-name:var(--font-display)]">Domains</h3>
                    <Button variant="primary" size="sm" onClick={() => {
                      const updated = [...localDomains(), ''];
                      setLocalDomains(updated);
                    }}>+ Add</Button>
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
                          onBlur={() => accountSaver.saveNow({ domains: localDomains() })}
                        />
                        <button class={btnX} onClick={() => {
                          const updated = localDomains().filter((_, j: number) => j !== i());
                          setLocalDomains(updated);
                          accountSaver.saveNow({ domains: updated });
                        }}>×</button>
                      </div>
                    )}
                  </For>
                </div>

                <div class="panel panel-accent p-5 mt-4">
                  <div class="flex justify-between items-center mb-3">
                    <h3 class="text-[13px] font-bold uppercase tracking-widest text-surf-300 font-[family-name:var(--font-display)]">Channel Partners</h3>
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

              </Show>

              {/* === PROFILE TAB === */}
              <Show when={tab() === 'profile'}>
                <TechnicalProfilePanel accountId={acct.id} />
              </Show>

              {/* === CONTACTS TAB === */}
              <Show when={tab() === 'contacts'}>
                <ContactList
                  accountId={account().id}
                  accountName={account().name}
                  onAfterCreate={() => refetch()}
                  onAfterDelete={() => refetch()}
                />
              </Show>

              {/* === MEETINGS TAB === */}
              <Show when={tab() === 'meetings'}>
                <MeetingsList
                  accountId={account().id}
                  accountName={account().name}
                  onAfterCreate={() => refetch()}
                  onAfterDelete={() => refetch()}
                />
              </Show>

              {/* === OPPORTUNITIES TAB === */}
              <Show when={tab() === 'opportunities'}>
                <OpportunitiesList
                  accountId={account().id}
                  accountName={account().name}
                  onAfterCreate={() => refetch()}
                  onAfterDelete={() => refetch()}
                />
              </Show>

              {/* === NOTES TAB === */}
              <Show when={tab() === 'notes'}>
                <NotesPanel target={{ account_id: acct.id }} />
              </Show>

            </>
          );
        }}
      </Show>

      <Show when={data()}>
        {(account) => (
          <AccountFormModal
            open={accountModalOpen()}
            onClose={() => setAccountModalOpen(false)}
            existing={account()}
            onSaved={() => refetch()}
          />
        )}
      </Show>
    </div>
  );
}
