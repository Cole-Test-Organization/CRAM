import { createResource, createSignal, createEffect, Show } from 'solid-js';
import { useParams, useNavigate } from '@solidjs/router';
import { api } from '../lib/api';
import { createAutoSave } from '../lib/editing';
import { AccountFormModal } from '../components/FormModals';
import Button from '../components/Button';
import SaveIndicator from '../components/SaveIndicator';
import OverviewPanel from '../components/accounts/OverviewPanel';
import TechnicalProfilePanel from '../components/accounts/TechnicalProfilePanel';
import OrgChartPanel from '../components/accounts/OrgChartPanel';
import NotesPanel from '../components/NotesPanel';
import ThreadsPanel from '../components/accounts/ThreadsPanel';
import NewsPanel from '../components/accounts/NewsPanel';
import BackLink from '../components/BackLink';
import MeetingsList from './MeetingsList';
import ContactList from './ContactList';
import OpportunitiesList from './OpportunitiesList';

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

  const tabClass = (active: boolean) =>
    `px-4 py-2 text-[11px] cursor-pointer border-b-2 transition-colors duration-150 uppercase tracking-widest font-bold ${
      active ? 'text-surf-300 border-b-surf-400' : 'text-base-300 border-transparent hover:text-base-50'
    }`;

  return (
    <div>
      <BackLink fallbackHref="/" fallbackLabel="Dashboard" />

      <Show when={data()} fallback={<div class="text-base-300 p-10 text-center">Loading...</div>}>
        {(account) => {
          const [editingName, setEditingName] = createSignal(false);
          const [nameVal, setNameVal] = createSignal(account().name);

          // The non-keyed <Show> keeps this closure alive while data() stays
          // truthy, and createResource retains the previous account during a
          // slug refetch — so on account→account navigation the closure (and the
          // signals below) persist. Reset the inline-edit name state whenever the
          // account id changes so a half-typed rename can't leak to the next
          // account. Guard on the id so a same-account refetch (which re-fires
          // this effect via the new account() object) doesn't clobber an
          // in-progress edit.
          let lastNameId: number | undefined;
          createEffect(() => {
            const a = account();
            if (a.id !== lastNameId) {
              lastNameId = a.id;
              setEditingName(false);
              setNameVal(a.name);
            }
          });

          return (
            <>
              <div class="flex flex-col gap-4 mb-6 md:flex-row md:justify-between md:items-start">
                <div class="flex-1 min-w-0">
                  <Show when={editingName()} fallback={
                    <h1 class="text-[26px] font-bold cursor-pointer font-[family-name:var(--font-display)]" onClick={() => setEditingName(true)} title="Click to edit">{account().name}</h1>
                  }>
                    <input
                      class={`${fieldClass} text-[26px] font-bold py-0.5 px-1.5 w-full font-[family-name:var(--font-display)]`}
                      value={nameVal()}
                      onInput={(e) => setNameVal(e.currentTarget.value)}
                      onBlur={() => {
                        setEditingName(false);
                        if (nameVal() !== account().name) {
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
                      value={account().status === 'partner' ? 'partner' : 'account'}
                      onChange={(e) => accountSaver.saveNow({ status: e.currentTarget.value })}
                    >
                      <option value="account">Account</option>
                      <option value="partner">Partner</option>
                    </select>
                    <input
                      type="date"
                      class={fieldClass}
                      value={account().last_contact || ''}
                      onChange={(e) => accountSaver.saveNow({ last_contact: e.currentTarget.value || null })}
                      title="Last contact date"
                    />
                    <SaveIndicator status={accountSaver.status()} />
                  </div>
                </div>
                <div class="flex gap-3 flex-wrap">
                  <Button variant="ghost" size="sm" onClick={async () => {
                    try {
                      const bundle = await api.exportAccountBundle(account().slug);
                      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${account().slug}.json`;
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
                  <div class={tabClass(tab() === 'org')} onClick={() => setTab('org')}>
                    Org Chart
                  </div>
                  <div class={tabClass(tab() === 'meetings')} onClick={() => setTab('meetings')}>
                    Meetings ({account().meetings?.length || 0})
                  </div>
                  <div class={tabClass(tab() === 'opportunities')} onClick={() => setTab('opportunities')}>
                    Opportunities ({account().opportunities?.length || 0})
                  </div>
                  <div class={tabClass(tab() === 'threads')} onClick={() => setTab('threads')}>
                    Threads ({account().open_thread_count ?? 0})
                  </div>
                  <div class={tabClass(tab() === 'notes')} onClick={() => setTab('notes')}>Notes</div>
                  <div class={tabClass(tab() === 'news')} onClick={() => setTab('news')}>News</div>
                </div>
              </div>

              {/* === OVERVIEW TAB === */}
              {/* Mounted unconditionally and gated by `active` (not wrapped in a
                  <Show> like the other tabs) so its inline-edit state for
                  domains / partners / supporting team survives tab switches —
                  the panel hides its own content when inactive. It snapshots its
                  `account` prop at setup (seeding optimistic local lists), so a
                  keyed Show on the account id remounts it on account→account
                  navigation to re-seed from the new account — while a same-account
                  refetch (id unchanged) and tab switches leave it mounted. */}
              <Show when={account().id} keyed>
                <OverviewPanel account={account()} saver={accountSaver} active={tab() === 'overview'} />
              </Show>

              {/* === PROFILE TAB === */}
              <Show when={tab() === 'profile'}>
                <TechnicalProfilePanel accountId={account().id} />
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

              {/* === ORG CHART TAB === */}
              <Show when={tab() === 'org'}>
                <OrgChartPanel accountId={account().id} />
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

              {/* === THREADS TAB === */}
              <Show when={tab() === 'threads'}>
                <ThreadsPanel
                  accountId={account().id}
                  accountContacts={[...(account().contacts || []), ...(account().team || [])]}
                  onThreadsChanged={() => refetch()}
                />
              </Show>

              {/* === NOTES TAB === */}
              <Show when={tab() === 'notes'}>
                <NotesPanel target={{ account_id: account().id }} />
              </Show>

              {/* === NEWS TAB === */}
              <Show when={tab() === 'news'}>
                <NewsPanel accountId={account().id} />
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
