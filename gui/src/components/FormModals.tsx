import { createSignal, createEffect, createResource, For, Show } from 'solid-js';
import Modal, { modalBtn } from './Modal';
import FormField, { FormRow, formInputClass, formTextareaClass, formSelectClass } from './FormField';
import AccountPicker from './AccountPicker';
import AttendeePicker from './AttendeePicker';
import { api } from '../lib/api';
import { STAGES, type OpportunityStage } from '../lib/stages';

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

type AccountLite = { id: number; name: string; slug: string };

// ----------------------- Account Form Modal -----------------------

interface AccountModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: (account: any) => void;
  existing?: any;
}

export function AccountFormModal(props: AccountModalProps) {
  const [name, setName] = createSignal('');
  const [slug, setSlug] = createSignal('');
  const [slugTouched, setSlugTouched] = createSignal(false);
  const [status, setStatus] = createSignal('account');
  const [lastContact, setLastContact] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');

  createEffect(() => {
    if (props.open) {
      const e = props.existing;
      setName(e?.name || '');
      setSlug(e?.slug || '');
      setSlugTouched(!!e);
      setStatus(e?.status === 'partner' ? 'partner' : 'account');
      setLastContact(e?.last_contact || '');
      setError('');
    }
  });

  const submit = async () => {
    if (!name().trim()) { setError('Name is required'); return; }
    const s = (slug().trim() || slugify(name()));
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(s)) {
      setError('Slug must be lowercase letters, numbers, and hyphens');
      return;
    }
    setSaving(true);
    setError('');
    try {
      let acct: any;
      if (props.existing) {
        acct = await api.patchAccount(props.existing.id, {
          name: name().trim(),
          status: status() || null,
          last_contact: lastContact() || null,
        });
      } else {
        const payload: any = { name: name().trim(), slug: s };
        if (status()) payload.status = status();
        if (lastContact()) payload.last_contact = lastContact();
        acct = await api.createAccount(payload);
      }
      props.onSaved?.(acct);
      props.onClose();
    } catch (err: any) {
      const msg = err?.message || 'Failed to save';
      setError(msg.includes('409') ? 'An account with this slug already exists' : msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={props.existing ? 'Edit Account' : 'New Account'}
      footer={
        <>
          <button class={modalBtn.secondary} onClick={props.onClose} disabled={saving()}>Cancel</button>
          <button class={modalBtn.primary} onClick={submit} disabled={saving()}>
            {saving() ? 'Saving...' : (props.existing ? 'Save' : 'Create')}
          </button>
        </>
      }
    >
      <FormField label="Name" required>
        <input
          class={formInputClass}
          value={name()}
          placeholder="Acme Corp"
          onInput={(e) => {
            const v = e.currentTarget.value;
            setName(v);
            if (!slugTouched()) setSlug(slugify(v));
          }}
          autofocus
        />
      </FormField>
      <FormField label="Slug" required hint="URL-safe identifier, auto-generated from name">
        <input
          class={formInputClass}
          value={slug()}
          placeholder="acme-corp"
          disabled={!!props.existing}
          onInput={(e) => { setSlugTouched(true); setSlug(e.currentTarget.value); }}
        />
      </FormField>
      <FormRow>
        <div class="flex-1 min-w-[140px]">
          <FormField label="Type">
            <select class={formSelectClass} value={status()} onChange={(e) => setStatus(e.currentTarget.value)}>
              <option value="account">Account</option>
              <option value="partner">Partner</option>
            </select>
          </FormField>
        </div>
        <div class="flex-1 min-w-[140px]">
          <FormField label="Last Contact">
            <input
              type="date"
              class={formInputClass}
              value={lastContact()}
              onInput={(e) => setLastContact(e.currentTarget.value)}
            />
          </FormField>
        </div>
      </FormRow>
      <Show when={error()}>
        <div class="text-[12px] text-scarlet-400 mt-2 font-semibold">{error()}</div>
      </Show>
    </Modal>
  );
}

// ----------------------- Contact Form Modal -----------------------

interface ContactModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: (contact: any) => void;
  existing?: any;
  fixedAccountId?: number;
  fixedAccountName?: string;
}

export function ContactFormModal(props: ContactModalProps) {
  const [account, setAccount] = createSignal<AccountLite | null>(null);
  const [fullName, setFullName] = createSignal('');
  const [title, setTitle] = createSignal('');
  const [email, setEmail] = createSignal('');
  const [phone, setPhone] = createSignal('');
  const [linkedin, setLinkedin] = createSignal('');
  const [notes, setNotes] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');

  createEffect(() => {
    if (props.open) {
      const e = props.existing;
      setFullName(e?.full_name || '');
      setTitle(e?.title || '');
      setEmail(e?.email || '');
      setPhone(e?.phone || '');
      setLinkedin(e?.linkedin || '');
      setNotes(e?.notes || '');
      setError('');
      if (props.fixedAccountId && props.fixedAccountName) {
        setAccount({ id: props.fixedAccountId, name: props.fixedAccountName, slug: '' });
      } else {
        setAccount(null);
      }
    }
  });

  const submit = async () => {
    if (!fullName().trim()) { setError('Full name is required'); return; }
    if (!props.existing && !account()) { setError('Select an account'); return; }
    setSaving(true);
    setError('');
    try {
      const payload = {
        full_name: fullName().trim(),
        title: title().trim() || undefined,
        email: email().trim() || undefined,
        phone: phone().trim() || undefined,
        linkedin: linkedin().trim() || undefined,
        notes: notes().trim() || undefined,
      };
      let contact: any;
      if (props.existing) {
        contact = await api.patchContact(props.existing.id, payload);
      } else {
        contact = await api.createContact(account()!.id, payload);
      }
      props.onSaved?.(contact);
      props.onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={props.existing ? 'Edit Contact' : 'New Contact'}
      footer={
        <>
          <button class={modalBtn.secondary} onClick={props.onClose} disabled={saving()}>Cancel</button>
          <button class={modalBtn.primary} onClick={submit} disabled={saving()}>
            {saving() ? 'Saving...' : (props.existing ? 'Save' : 'Create')}
          </button>
        </>
      }
    >
      <Show when={!props.existing}>
        <FormField label="Account" required>
          <Show when={props.fixedAccountId} fallback={
            <AccountPicker value={account()} onChange={setAccount} />
          }>
            <div class="input-vintage opacity-75">
              {props.fixedAccountName}
            </div>
          </Show>
        </FormField>
      </Show>
      <FormField label="Full Name" required>
        <input class={formInputClass} placeholder="Jane Doe" value={fullName()} onInput={(e) => setFullName(e.currentTarget.value)} autofocus />
      </FormField>
      <FormRow>
        <div class="flex-1 min-w-[180px]">
          <FormField label="Title"><input class={formInputClass} placeholder="VP Engineering" value={title()} onInput={(e) => setTitle(e.currentTarget.value)} /></FormField>
        </div>
        <div class="flex-1 min-w-[180px]">
          <FormField label="Email"><input class={formInputClass} type="email" placeholder="jane@example.com" value={email()} onInput={(e) => setEmail(e.currentTarget.value)} /></FormField>
        </div>
      </FormRow>
      <FormRow>
        <div class="flex-1 min-w-[180px]">
          <FormField label="Phone"><input class={formInputClass} placeholder="(555) 123-4567" value={phone()} onInput={(e) => setPhone(e.currentTarget.value)} /></FormField>
        </div>
        <div class="flex-1 min-w-[180px]">
          <FormField label="LinkedIn"><input class={formInputClass} placeholder="https://linkedin.com/in/..." value={linkedin()} onInput={(e) => setLinkedin(e.currentTarget.value)} /></FormField>
        </div>
      </FormRow>
      <FormField label="Notes">
        <textarea class={formTextareaClass} rows={4} placeholder="Background, priorities, preferences..." value={notes()} onInput={(e) => setNotes(e.currentTarget.value)} />
      </FormField>
      <Show when={error()}>
        <div class="text-[12px] text-scarlet-400 mt-2 font-semibold">{error()}</div>
      </Show>
    </Modal>
  );
}

// ----------------------- Meeting Form Modal -----------------------

interface MeetingModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: (meeting: any) => void;
  existing?: any;
  fixedAccountId?: number;
  fixedAccountName?: string;
}

// Per-attendee decision row used by the from-emails mode.
type EmailAttendeeDecision = {
  email: string;
  name: string;
  kind: 'account' | 'partner' | 'internal';
  include: boolean;
  research: boolean;
};

type EmailResolveResult = {
  attendees: Array<{
    email: string;
    domain: string | null;
    name_guess: string;
    kind: 'account' | 'internal';
    contact: any | null;
    account_match: any | null;
  }>;
  accounts: Array<{
    domain: string;
    account: any | null;
    attendee_count: number;
    suggested_name: string;
  }>;
  primary_domain: string | null;
};

export function MeetingFormModal(props: MeetingModalProps) {
  // Manual-mode state (existing fields)
  const [account, setAccount] = createSignal<AccountLite | null>(null);
  const [internal, setInternal] = createSignal(false);
  const [date, setDate] = createSignal(new Date().toISOString().slice(0, 10));
  const [title, setTitle] = createSignal('');
  const [attendeesText, setAttendeesText] = createSignal('');
  const [contactIds, setContactIds] = createSignal<number[]>([]);
  const [body, setBody] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');

  // From-emails-mode state. The mode toggle is only shown when creating a
  // brand new external meeting (no `existing`, no `fixedAccountId`, not marked
  // internal) — every other path stays manual.
  const [mode, setMode] = createSignal<'manual' | 'from-emails'>('manual');
  const [emailsText, setEmailsText] = createSignal('');
  const [resolved, setResolved] = createSignal<EmailResolveResult | null>(null);
  const [resolving, setResolving] = createSignal(false);
  const [primaryDomain, setPrimaryDomain] = createSignal<string | null>(null);
  const [newAccountName, setNewAccountName] = createSignal('');
  const [decisions, setDecisions] = createSignal<Record<string, EmailAttendeeDecision>>({});

  createEffect(() => {
    if (props.open) {
      const e = props.existing;
      setDate(e?.date || new Date().toISOString().slice(0, 10));
      setTitle(e?.title || '');
      setAttendeesText(e?.attendees || '');
      setBody(e?.body || '');
      setContactIds(Array.isArray(e?.contacts) ? e.contacts.map((c: any) => c.id) : []);
      setInternal(!!e?.internal);
      setError('');
      if (props.fixedAccountId && props.fixedAccountName) {
        setAccount({ id: props.fixedAccountId, name: props.fixedAccountName, slug: '' });
      } else if (e?.account_id) {
        setAccount({ id: e.account_id, name: e.account_name || '', slug: e.account_slug || '' });
      } else {
        setAccount(null);
      }
      // From-emails defaults
      setMode('manual');
      setEmailsText('');
      setResolved(null);
      setResolving(false);
      setPrimaryDomain(null);
      setNewAccountName('');
      setDecisions({});
    }
  });

  // When the user switches modes (or toggles internal on), drop the
  // mode-specific state so we don't carry stale resolves/contact ids over.
  createEffect(() => {
    if (mode() === 'manual') {
      setResolved(null);
      setEmailsText('');
      setPrimaryDomain(null);
      setNewAccountName('');
      setDecisions({});
    } else {
      setContactIds([]);
      setAccount(null);
    }
  });
  createEffect(() => {
    if (internal()) setMode('manual');
  });

  const showModeToggle = () => !props.existing && !props.fixedAccountId && !internal();
  const showManualAccountPickers = () => !props.existing && !internal() && mode() === 'manual';
  const showFromEmails = () => !props.existing && !internal() && mode() === 'from-emails';

  const doResolve = async () => {
    if (!emailsText().trim()) { setError('Paste at least one email first.'); return; }
    setResolving(true);
    setError('');
    try {
      const result = await api.resolveMeetingEmails(emailsText());
      if (!result.attendees.length) {
        setError('No valid emails found in that input.');
        setResolved(null);
        return;
      }
      setResolved(result);
      setPrimaryDomain(result.primary_domain);
      const primaryCandidate = result.accounts.find(a => a.domain === result.primary_domain);
      setNewAccountName(primaryCandidate && !primaryCandidate.account ? primaryCandidate.suggested_name : '');
      const next: Record<string, EmailAttendeeDecision> = {};
      for (const a of result.attendees) {
        next[a.email] = {
          email: a.email,
          name: a.contact?.full_name || a.name_guess,
          kind: a.kind,
          include: true,
          research: false,
        };
      }
      setDecisions(next);
      // Pre-fill the display label from the parsed names — user can edit.
      if (!attendeesText().trim()) {
        setAttendeesText(result.attendees.map(a => a.contact?.full_name || a.name_guess).join(', '));
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to resolve emails');
      setResolved(null);
    } finally {
      setResolving(false);
    }
  };

  const updateDecision = (email: string, patch: Partial<EmailAttendeeDecision>) => {
    setDecisions(prev => ({ ...prev, [email]: { ...prev[email], ...patch } }));
  };

  const primaryAccountCandidate = () => {
    const r = resolved();
    if (!r) return null;
    return r.accounts.find(a => a.domain === primaryDomain()) || null;
  };

  const submit = async () => {
    if (!date()) { setError('Date is required'); return; }
    if (!body().trim()) { setError('Notes are required'); return; }

    setSaving(true);
    setError('');
    try {
      let meeting: any;

      if (props.existing) {
        // Edit always uses manual update path.
        meeting = await api.updateMeeting(props.existing.id, {
          date: date(),
          title: title().trim() || undefined,
          attendees: attendeesText().trim() || undefined,
          body: body(),
          contact_ids: contactIds(),
        });
      } else if (mode() === 'from-emails') {
        const r = resolved();
        if (!r) { setError('Hit "Resolve" first to look up the emails.'); setSaving(false); return; }
        const primary = primaryAccountCandidate();
        if (!primary) { setError('Pick a primary account domain.'); setSaving(false); return; }
        if (!primary.account && !newAccountName().trim()) {
          setError('Name the new account before saving.');
          setSaving(false);
          return;
        }
        const includedAttendees = r.attendees
          .map(a => ({ source: a, decision: decisions()[a.email] }))
          .filter(({ decision }) => decision?.include);
        if (includedAttendees.length === 0) {
          setError('At least one attendee must be included.');
          setSaving(false);
          return;
        }
        const contacts: any[] = includedAttendees.map(({ source, decision }) => {
          if (source.contact) {
            return {
              mode: 'existing' as const,
              contact_id: source.contact.id,
              // Only link to the chosen external account when the attendee
              // isn't internal — otherwise we'd attach a teammate to a
              // customer account.
              link_to_account: source.kind !== 'internal',
            };
          }
          return {
            mode: 'new' as const,
            full_name: decision.name.trim() || source.name_guess,
            email: source.email,
            kind: decision.kind,
            research: !!decision.research,
          };
        });
        const accountPayload = primary.account
          ? { mode: 'existing' as const, account_id: primary.account.id, domain: primary.domain }
          : { mode: 'new' as const, name: newAccountName().trim(), domain: primary.domain };
        const result = await api.createMeetingFromEmails({
          date: date(),
          title: title().trim() || undefined,
          attendees_text: attendeesText().trim() || undefined,
          body: body(),
          account: accountPayload,
          contacts,
        });
        meeting = result.meeting;
      } else {
        // Manual create
        if (!internal() && !account()) { setError('Select an account or mark as internal'); setSaving(false); return; }
        if (!internal() && contactIds().length === 0) { setError('Select at least one attendee'); setSaving(false); return; }
        meeting = await api.createMeeting({
          account_id: internal() ? undefined : account()!.id,
          internal: internal() || undefined,
          date: date(),
          title: title().trim() || undefined,
          attendees: attendeesText().trim() || undefined,
          contact_ids: contactIds(),
          body: body(),
        });
      }
      props.onSaved?.(meeting);
      props.onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={props.existing ? (props.existing.internal ? 'Edit Internal Meeting' : 'Edit Meeting') : (internal() ? 'New Internal Meeting' : 'New Meeting')}
      size="lg"
      footer={
        <>
          <button class={modalBtn.secondary} onClick={props.onClose} disabled={saving()}>Cancel</button>
          <button class={modalBtn.primary} onClick={submit} disabled={saving()}>
            {saving() ? 'Saving...' : (props.existing ? 'Save' : 'Create')}
          </button>
        </>
      }
    >
      <Show when={!props.existing && !props.fixedAccountId}>
        <FormField label="Type">
          <label class="flex items-center gap-2 text-sm text-base-50 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={internal()}
              onChange={(e) => setInternal(e.currentTarget.checked)}
              class="w-4 h-4 accent-surf-300"
            />
            Internal meeting (no account)
          </label>
        </FormField>
      </Show>

      <Show when={showModeToggle()}>
        <FormField
          label="Source"
          hint='Manual: pick the account and attendees yourself. From emails: paste a calendar-invite attendee list and we look up matching contacts + account, with optional background LinkedIn research on new attendees.'
        >
          <div class="flex gap-2">
            <button
              type="button"
              class={`press press-sm ${mode() === 'manual' ? 'press-primary' : 'press-ghost'}`}
              onClick={() => setMode('manual')}
            >
              Manual
            </button>
            <button
              type="button"
              class={`press press-sm ${mode() === 'from-emails' ? 'press-primary' : 'press-ghost'}`}
              onClick={() => setMode('from-emails')}
            >
              From emails
            </button>
          </div>
        </FormField>
      </Show>

      <Show when={showManualAccountPickers()}>
        <FormField label="Account" required>
          <Show when={props.fixedAccountId} fallback={
            <AccountPicker value={account()} onChange={setAccount} />
          }>
            <div class="input-vintage opacity-75">
              {props.fixedAccountName}
            </div>
          </Show>
        </FormField>
      </Show>

      <Show when={showFromEmails()}>
        <FormField
          label="Attendee emails"
          required
          hint='Paste from a calendar invite. One per line, comma-separated, or "Name <email>" form all work.'
        >
          <textarea
            class={formTextareaClass}
            rows={4}
            placeholder={'gnistor@hph.care, Katie Locandro <klocandro@paloaltonetworks.com>, wmonroy@hph.care'}
            value={emailsText()}
            onInput={(e) => setEmailsText(e.currentTarget.value)}
          />
          <div class="mt-2">
            <button
              type="button"
              class={`press press-sm ${resolved() ? 'press-ghost' : 'press-primary'}`}
              onClick={doResolve}
              disabled={resolving()}
            >
              {resolving() ? 'Resolving...' : resolved() ? 'Re-resolve' : 'Resolve'}
            </button>
          </div>
        </FormField>

        <Show when={resolved()}>
          {(r) => (
            <>
              <FormField label="Account" required>
                <Show when={r().accounts.length > 1}>
                  <div class="text-[11px] text-base-300 mb-2">Multiple external domains detected — pick the primary account. Attendees on other domains can still be included individually below.</div>
                </Show>
                <Show when={r().accounts.length === 0}>
                  <div class="text-[12px] text-base-300 italic">No external account candidates — all attendees appear to be internal. Switch to Manual mode for internal-only notes.</div>
                </Show>
                <For each={r().accounts}>
                  {(cand) => (
                    <label class="flex items-start gap-2 mb-2 cursor-pointer">
                      <input
                        type="radio"
                        name="primary-domain"
                        class="w-4 h-4 accent-surf-300 mt-1"
                        checked={primaryDomain() === cand.domain}
                        onChange={() => {
                          setPrimaryDomain(cand.domain);
                          if (!cand.account) setNewAccountName(cand.suggested_name);
                        }}
                      />
                      <div class="flex-1 min-w-0">
                        <div class="flex items-baseline gap-2 flex-wrap">
                          <span class="text-[12px] font-bold text-base-50">{cand.domain}</span>
                          <span class="text-[10px] text-base-400 uppercase tracking-wider">{cand.attendee_count} attendee{cand.attendee_count === 1 ? '' : 's'}</span>
                          <Show when={cand.account} fallback={
                            <span class="bg-base-950 border-2 border-amber-300 text-amber-300 text-[10px] px-1.5 py-0.5 uppercase tracking-widest font-bold leading-none">New</span>
                          }>
                            <span class="bg-base-950 border-2 border-surf-300 text-surf-300 text-[10px] px-1.5 py-0.5 uppercase tracking-widest font-bold leading-none">Existing</span>
                          </Show>
                        </div>
                        <Show when={cand.account} fallback={
                          <Show when={primaryDomain() === cand.domain}>
                            <input
                              class={`${formInputClass} mt-1`}
                              placeholder="New account name"
                              value={newAccountName()}
                              onInput={(e) => setNewAccountName(e.currentTarget.value)}
                            />
                          </Show>
                        }>
                          <div class="text-[12px] text-base-300">{cand.account!.name}</div>
                        </Show>
                      </div>
                    </label>
                  )}
                </For>
              </FormField>

              <FormField label="Attendees" hint='Untick to skip an email. "Research?" runs a LinkedIn + local-LLM enrichment on the new contact after the meeting is saved.'>
                <div class="border-2 border-base-500 bg-base-950 p-2 flex flex-col gap-2">
                  <For each={r().attendees}>
                    {(att) => {
                      const d = () => decisions()[att.email];
                      const isExisting = !!att.contact;
                      const isInternalDomain = att.kind === 'internal';
                      return (
                        <div class="border-2 border-base-700 bg-base-900 p-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
                          <label class="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              class="w-4 h-4 accent-surf-300"
                              checked={d()?.include ?? true}
                              onChange={(e) => updateDecision(att.email, { include: e.currentTarget.checked })}
                            />
                            <span class="text-[10px] uppercase tracking-wider text-base-300">Include</span>
                          </label>
                          <div class="flex-1 min-w-0">
                            <div class="flex items-baseline gap-2 flex-wrap">
                              <Show when={!isExisting} fallback={
                                <span class="text-sm font-semibold text-base-50">{att.contact!.full_name}</span>
                              }>
                                <input
                                  class={`${formInputClass} max-w-[240px]`}
                                  value={d()?.name ?? att.name_guess}
                                  onInput={(e) => updateDecision(att.email, { name: e.currentTarget.value })}
                                  placeholder="Full name"
                                />
                              </Show>
                              <span class="text-[11px] text-base-400 font-mono break-all">{att.email}</span>
                            </div>
                            <div class="flex items-center gap-2 mt-1 flex-wrap">
                              <Show when={isExisting} fallback={
                                <span class="bg-base-950 border-2 border-amber-300 text-amber-300 text-[10px] px-1.5 py-0.5 uppercase tracking-widest font-bold leading-none">New</span>
                              }>
                                <span class="bg-base-950 border-2 border-surf-300 text-surf-300 text-[10px] px-1.5 py-0.5 uppercase tracking-widest font-bold leading-none">Existing</span>
                              </Show>
                              <Show when={isInternalDomain}>
                                <span class="bg-base-950 border-2 border-base-400 text-base-300 text-[10px] px-1.5 py-0.5 uppercase tracking-widest font-bold leading-none">Internal Domain</span>
                              </Show>
                              <Show when={!isExisting}>
                                <select
                                  class="bg-base-950 border-2 border-base-500 text-base-50 text-[11px] px-2 py-1 uppercase tracking-wider"
                                  value={d()?.kind ?? att.kind}
                                  onChange={(e) => updateDecision(att.email, { kind: e.currentTarget.value as any })}
                                >
                                  <option value="account">Account</option>
                                  <option value="partner">Partner</option>
                                  <option value="internal">Internal</option>
                                </select>
                              </Show>
                            </div>
                          </div>
                          <Show when={!isExisting && (d()?.kind ?? att.kind) !== 'internal'}>
                            <label class="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                class="w-4 h-4 accent-surf-300"
                                checked={d()?.research ?? false}
                                onChange={(e) => updateDecision(att.email, { research: e.currentTarget.checked })}
                              />
                              <span class="text-[10px] uppercase tracking-wider text-base-300">Research?</span>
                            </label>
                          </Show>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </FormField>
            </>
          )}
        </Show>
      </Show>

      <FormRow>
        <div class="flex-1 min-w-[140px]">
          <FormField label="Date" required>
            <input type="date" class={formInputClass} value={date()} onInput={(e) => setDate(e.currentTarget.value)} />
          </FormField>
        </div>
        <div class="flex-[2] min-w-[200px]">
          <FormField label="Title" hint="Short slug (e.g. prisma-access-demo)">
            <input class={formInputClass} placeholder={internal() || props.existing?.internal ? 'weekly-sync' : 'prisma-access-demo'} value={title()} onInput={(e) => setTitle(e.currentTarget.value)} />
          </FormField>
        </div>
      </FormRow>

      <Show when={!showFromEmails()}>
        <FormField
          label="Attendees"
          required={!internal() && !props.existing?.internal && !showFromEmails()}
          hint={internal() || props.existing?.internal ? 'Search internal team and linked partners' : "Search this account's contacts, linked partners, and internal team"}
        >
          <AttendeePicker
            mode={internal() || props.existing?.internal ? 'internal' : 'external'}
            accountId={account()?.id ?? null}
            value={contactIds()}
            onChange={setContactIds}
          />
        </FormField>
      </Show>

      <FormField label="Attendees label (display)" hint="Optional free-text override for the meeting card. Selected attendees above are the authoritative link.">
        <input class={formInputClass} placeholder="Jane Doe, John Smith" value={attendeesText()} onInput={(e) => setAttendeesText(e.currentTarget.value)} />
      </FormField>
      <FormField label="Notes" required>
        <textarea class={formTextareaClass} rows={10} placeholder="Meeting notes (markdown)..." value={body()} onInput={(e) => setBody(e.currentTarget.value)} />
      </FormField>
      <Show when={error()}>
        <div class="text-[12px] text-scarlet-400 mt-2 font-semibold">{error()}</div>
      </Show>
    </Modal>
  );
}

// ----------------------- Opportunity Form Modal -----------------------

interface OpportunityModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: (opp: any) => void;
  existing?: any;
  fixedAccountId?: number;
  fixedAccountName?: string;
}

export function OpportunityFormModal(props: OpportunityModalProps) {
  const [account, setAccount] = createSignal<AccountLite | null>(null);
  const [name, setName] = createSignal('');
  const [stage, setStage] = createSignal<OpportunityStage>('opp_identification');
  const [oppLink, setOppLink] = createSignal('');
  const [trrLink, setTrrLink] = createSignal('');
  const [techValLink, setTechValLink] = createSignal('');
  const [notes, setNotes] = createSignal('');
  const [productIds, setProductIds] = createSignal<number[]>([]);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');

  const [productsRes] = createResource(() => props.open, async (open) => {
    if (!open) return null;
    const res = await api.getProducts({ limit: 500 });
    return res.products;
  });

  createEffect(() => {
    if (props.open) {
      const e = props.existing;
      setName(e?.name || '');
      setStage((e?.stage as any) || 'opp_identification');
      setOppLink(e?.opp_link || '');
      setTrrLink(e?.trr_link || '');
      setTechValLink(e?.tech_validation_link || '');
      setNotes(e?.notes || '');
      setProductIds(Array.isArray(e?.products) ? e.products.map((p: any) => p.id) : []);
      setError('');
      if (props.fixedAccountId && props.fixedAccountName) {
        setAccount({ id: props.fixedAccountId, name: props.fixedAccountName, slug: '' });
      } else if (e?.account_id) {
        setAccount({ id: e.account_id, name: e.account_name || '', slug: e.account_slug || '' });
      } else {
        setAccount(null);
      }
    }
  });

  const toggleProduct = (id: number) => {
    const cur = productIds();
    setProductIds(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };

  const submit = async () => {
    if (!props.existing && !account()) { setError('Select an account'); return; }
    if (!name().trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      let opp: any;
      const payload: any = {
        name: name().trim(),
        stage: stage(),
        opp_link: oppLink().trim() || null,
        trr_link: trrLink().trim() || null,
        tech_validation_link: techValLink().trim() || null,
        notes: notes().trim() || null,
        product_ids: productIds(),
      };
      if (props.existing) {
        opp = await api.patchOpportunity(props.existing.id, payload);
      } else {
        payload.account_id = account()!.id;
        opp = await api.createOpportunity(payload);
      }
      props.onSaved?.(opp);
      props.onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={props.existing ? 'Edit Opportunity' : 'New Opportunity'}
      size="lg"
      footer={
        <>
          <button class={modalBtn.secondary} onClick={props.onClose} disabled={saving()}>Cancel</button>
          <button class={modalBtn.primary} onClick={submit} disabled={saving()}>
            {saving() ? 'Saving...' : (props.existing ? 'Save' : 'Create')}
          </button>
        </>
      }
    >
      <Show when={!props.existing}>
        <FormField label="Account" required hint="Partner accounts can't have opportunities — they're filtered out.">
          <Show when={props.fixedAccountId} fallback={
            <AccountPicker value={account()} onChange={setAccount} excludePartner />
          }>
            <div class="input-vintage opacity-75">
              {props.fixedAccountName}
            </div>
          </Show>
        </FormField>
      </Show>
      <FormField label="Name" required>
        <input class={formInputClass} placeholder="Q3 SIEM Replacement" value={name()} onInput={(e) => setName(e.currentTarget.value)} autofocus />
      </FormField>
      <FormField label="Stage" required>
        <select class={formSelectClass} value={stage()} onChange={(e) => setStage(e.currentTarget.value as any)}>
          <For each={STAGES}>
            {(s) => <option value={s.id}>{s.label}</option>}
          </For>
        </select>
      </FormField>
      <FormRow>
        <div class="flex-1 min-w-[200px]">
          <FormField label="Opp Link" hint="External deal record (SFDC, etc.)">
            <input class={formInputClass} type="url" placeholder="https://..." value={oppLink()} onInput={(e) => setOppLink(e.currentTarget.value)} />
          </FormField>
        </div>
        <div class="flex-1 min-w-[200px]">
          <FormField label="TRR Link" hint="Technical Requirements Review doc">
            <input class={formInputClass} type="url" placeholder="https://..." value={trrLink()} onInput={(e) => setTrrLink(e.currentTarget.value)} />
          </FormField>
        </div>
        <div class="flex-1 min-w-[200px]">
          <FormField label="Tech Validation Link" hint="POV plan, validation doc, demo recording, etc.">
            <input class={formInputClass} type="url" placeholder="https://..." value={techValLink()} onInput={(e) => setTechValLink(e.currentTarget.value)} />
          </FormField>
        </div>
      </FormRow>
      <FormField label="Notes">
        <textarea class={formTextareaClass} rows={4} placeholder="Deal context, blockers, next steps..." value={notes()} onInput={(e) => setNotes(e.currentTarget.value)} />
      </FormField>
      <FormField label="Products" hint="Tap to attach. Manage the catalog from the Products page.">
        <Show when={!productsRes.loading} fallback={<div class="text-base-300 text-[12px]">Loading products...</div>}>
          <Show
            when={(productsRes() || []).length > 0}
            fallback={<div class="text-base-400 text-[12px] italic">No products yet — create some from the Products page.</div>}
          >
            <div class="border-2 border-base-500 bg-base-950 p-2 max-h-48 overflow-y-auto flex flex-col gap-1">
              <For each={productsRes() || []}>
                {(p: any) => {
                  const checked = () => productIds().includes(p.id);
                  return (
                    <label class="flex items-center gap-2 px-2 py-1.5 cursor-pointer text-sm text-base-50 hover:bg-base-800 transition-colors">
                      <input
                        type="checkbox"
                        checked={checked()}
                        onChange={() => toggleProduct(p.id)}
                        class="w-4 h-4 accent-surf-300"
                      />
                      <span class="flex-1">{p.name}</span>
                      <Show when={p.category_name}>
                        <span class="text-[10px] uppercase tracking-wider text-base-400">{p.category_name}</span>
                      </Show>
                    </label>
                  );
                }}
              </For>
            </div>
          </Show>
        </Show>
      </FormField>
      <Show when={error()}>
        <div class="text-[12px] text-scarlet-400 mt-2 font-semibold">{error()}</div>
      </Show>
    </Modal>
  );
}

// ----------------------- Product Form Modal -----------------------

interface ProductModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: (product: any) => void;
  existing?: any;
}

export function ProductFormModal(props: ProductModalProps) {
  const [name, setName] = createSignal('');
  const [categoryId, setCategoryId] = createSignal<string>('');
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');

  const [categoriesRes] = createResource(() => props.open, async (open) => {
    if (!open) return null;
    const res = await api.getProductCategories({ limit: 500 });
    return res.categories;
  });

  createEffect(() => {
    if (props.open) {
      const e = props.existing;
      setName(e?.name || '');
      setCategoryId(e?.category_id != null ? String(e.category_id) : '');
      setError('');
    }
  });

  const submit = async () => {
    if (!name().trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: name().trim(),
        category_id: categoryId() ? Number(categoryId()) : null,
      };
      const product = props.existing
        ? await api.patchProduct(props.existing.id, payload)
        : await api.createProduct(payload);
      props.onSaved?.(product);
      props.onClose();
    } catch (err: any) {
      const msg = err?.message || 'Failed to save';
      setError(msg.includes('409') ? 'A product with this name already exists' : msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={props.existing ? 'Edit Product' : 'New Product'}
      size="sm"
      footer={
        <>
          <button class={modalBtn.secondary} onClick={props.onClose} disabled={saving()}>Cancel</button>
          <button class={modalBtn.primary} onClick={submit} disabled={saving()}>
            {saving() ? 'Saving...' : (props.existing ? 'Save' : 'Create')}
          </button>
        </>
      }
    >
      <FormField label="Name" required>
        <input class={formInputClass} placeholder="Cortex XDR Pro" value={name()} onInput={(e) => setName(e.currentTarget.value)} autofocus />
      </FormField>
      <FormField label="Category" hint="Optional — manage categories below the product list.">
        <select class={formSelectClass} value={categoryId()} onChange={(e) => setCategoryId(e.currentTarget.value)}>
          <option value="">— No category —</option>
          <Show when={!categoriesRes.loading}>
            <For each={categoriesRes() || []}>
              {(cat: any) => <option value={String(cat.id)}>{cat.name}</option>}
            </For>
          </Show>
        </select>
      </FormField>
      <Show when={error()}>
        <div class="text-[12px] text-scarlet-400 mt-2 font-semibold">{error()}</div>
      </Show>
    </Modal>
  );
}

// ----------------------- Product Category Form Modal -----------------------

interface ProductCategoryModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: (category: any) => void;
  existing?: any;
}

export function ProductCategoryFormModal(props: ProductCategoryModalProps) {
  const [name, setName] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');

  createEffect(() => {
    if (props.open) {
      setName(props.existing?.name || '');
      setError('');
    }
  });

  const submit = async () => {
    if (!name().trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      const cat = props.existing
        ? await api.patchProductCategory(props.existing.id, { name: name().trim() })
        : await api.createProductCategory({ name: name().trim() });
      props.onSaved?.(cat);
      props.onClose();
    } catch (err: any) {
      const msg = err?.message || 'Failed to save';
      setError(msg.includes('409') ? 'A category with this name already exists' : msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={props.existing ? 'Edit Category' : 'New Category'}
      size="sm"
      footer={
        <>
          <button class={modalBtn.secondary} onClick={props.onClose} disabled={saving()}>Cancel</button>
          <button class={modalBtn.primary} onClick={submit} disabled={saving()}>
            {saving() ? 'Saving...' : (props.existing ? 'Save' : 'Create')}
          </button>
        </>
      }
    >
      <FormField label="Name" required>
        <input class={formInputClass} placeholder="Network Security" value={name()} onInput={(e) => setName(e.currentTarget.value)} autofocus />
      </FormField>
      <Show when={error()}>
        <div class="text-[12px] text-scarlet-400 mt-2 font-semibold">{error()}</div>
      </Show>
    </Modal>
  );
}

// ----------------------- Vendor Form Modal -----------------------

interface VendorModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: (vendor: any) => void;
  existing?: any;
}

export function VendorFormModal(props: VendorModalProps) {
  const [name, setName] = createSignal('');
  const [slug, setSlug] = createSignal('');
  const [slugTouched, setSlugTouched] = createSignal(false);
  const [website, setWebsite] = createSignal('');
  const [notes, setNotes] = createSignal('');
  const [needsReview, setNeedsReview] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');

  createEffect(() => {
    if (props.open) {
      const e = props.existing;
      setName(e?.name || '');
      setSlug(e?.slug || '');
      setSlugTouched(!!e);
      setWebsite(e?.website || '');
      setNotes(e?.notes || '');
      // New vendors created via this modal are pre-curated by the user, so default
      // needs_review=false — unlike the auto-create path used by the picker, which
      // sets it true. Existing rows keep their flag.
      setNeedsReview(e ? !!e.needs_review : false);
      setError('');
    }
  });

  const submit = async () => {
    if (!name().trim()) { setError('Name is required'); return; }
    const finalSlug = (slug().trim() || slugify(name()));
    setSaving(true);
    setError('');
    try {
      let vendor: any;
      if (props.existing) {
        vendor = await api.patchVendor(props.existing.id, {
          name: name().trim(),
          slug: finalSlug,
          website: website().trim() || null,
          notes: notes().trim() || null,
          needs_review: needsReview(),
        });
      } else {
        const result = await api.findOrCreateVendor({
          name: name().trim(),
          slug: finalSlug,
          website: website().trim() || null,
          notes: notes().trim() || null,
        });
        // If the user deliberately created via this curated form, clear the
        // auto-flag that find_or_create sets by default. (Idempotent — runs even
        // when the vendor already existed.)
        if (!needsReview()) {
          vendor = await api.patchVendor(result.vendor.id, { needs_review: false });
        } else {
          vendor = result.vendor;
        }
      }
      props.onSaved?.(vendor);
      props.onClose();
    } catch (err: any) {
      const msg = err?.message || 'Failed to save';
      setError(msg.includes('409') ? 'A vendor with this slug already exists' : msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={props.existing ? 'Edit Vendor' : 'New Vendor'}
      footer={
        <>
          <button class={modalBtn.secondary} onClick={props.onClose} disabled={saving()}>Cancel</button>
          <button class={modalBtn.primary} onClick={submit} disabled={saving()}>
            {saving() ? 'Saving...' : (props.existing ? 'Save' : 'Create')}
          </button>
        </>
      }
    >
      <FormField label="Name" required>
        <input
          class={formInputClass}
          placeholder="Palo Alto Networks"
          value={name()}
          onInput={(e) => {
            const v = e.currentTarget.value;
            setName(v);
            if (!slugTouched()) setSlug(slugify(v));
          }}
          autofocus
        />
      </FormField>
      <FormField label="Slug" hint="Auto-derived from name. Used as the canonical identifier.">
        <input
          class={formInputClass}
          placeholder="palo-alto-networks"
          value={slug()}
          disabled={!!props.existing}
          onInput={(e) => { setSlugTouched(true); setSlug(e.currentTarget.value); }}
        />
      </FormField>
      <FormField label="Website">
        <input class={formInputClass} placeholder="https://www.paloaltonetworks.com" value={website()} onInput={(e) => setWebsite(e.currentTarget.value)} />
      </FormField>
      <FormField label="Notes">
        <textarea class={formTextareaClass} rows={3} placeholder="Optional context — acquisitions, aliases, etc." value={notes()} onInput={(e) => setNotes(e.currentTarget.value)} />
      </FormField>
      <FormField label="Needs review" hint="Auto-created vendors are flagged for canonicalization. Clear once you've confirmed the row is canonical.">
        <label class="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            class="accent-surf-400 w-4 h-4 cursor-pointer"
            checked={needsReview()}
            onChange={(e) => setNeedsReview(e.currentTarget.checked)}
          />
          <span class="text-[12px] uppercase tracking-wider font-semibold">Flag for review</span>
        </label>
      </FormField>
      <Show when={error()}>
        <div class="text-[12px] text-scarlet-400 mt-2 font-semibold">{error()}</div>
      </Show>
    </Modal>
  );
}

// ----------------------- Vendor Product Form Modal -----------------------

const VENDOR_PRODUCT_CATEGORIES = [
  'firewall', 'edr', 'siem', 'idp', 'mfa', 'pam',
  'email_security', 'mdr', 'msp', 'sase', 'sdwan',
  'vpn', 'dlp', 'casb', 'vuln_mgmt', 'ticketing',
  'productivity_suite', 'cloud_provider',
  'cspm', 'appsec', 'ndr', 'iot_ot',
];

interface VendorProductModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: (product: any) => void;
  existing?: any;
  // If the page already knows the category (e.g. user clicked + on the
  // "firewall" filter), pre-fill and lock it.
  lockedCategory?: string;
}

export function VendorProductFormModal(props: VendorProductModalProps) {
  const [vendorMode, setVendorMode] = createSignal<'pick' | 'new'>('pick');
  const [vendorId, setVendorId] = createSignal<string>('');
  const [vendorName, setVendorName] = createSignal('');
  const [name, setName] = createSignal('');
  const [slug, setSlug] = createSignal('');
  const [slugTouched, setSlugTouched] = createSignal(false);
  const [category, setCategory] = createSignal('');
  const [notes, setNotes] = createSignal('');
  const [needsReview, setNeedsReview] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');

  const [vendorsRes] = createResource(() => props.open, async (open) => {
    if (!open) return null;
    const res = await api.getVendors({ limit: 500 });
    return res.vendors;
  });

  createEffect(() => {
    if (props.open) {
      const e = props.existing;
      setVendorMode(e ? 'pick' : 'pick');
      setVendorId(e?.vendor_id != null ? String(e.vendor_id) : '');
      setVendorName('');
      setName(e?.name || '');
      setSlug(e?.slug || '');
      setSlugTouched(!!e);
      setCategory(e?.category || props.lockedCategory || '');
      setNotes(e?.notes || '');
      setNeedsReview(e ? !!e.needs_review : false);
      setError('');
    }
  });

  const submit = async () => {
    if (!name().trim()) { setError('Name is required'); return; }
    if (!category().trim()) { setError('Category is required'); return; }
    const finalSlug = (slug().trim() || slugify(name()));
    setSaving(true);
    setError('');
    try {
      let product: any;
      if (props.existing) {
        product = await api.patchVendorProduct(props.existing.id, {
          name: name().trim(),
          slug: finalSlug,
          category: category().trim(),
          notes: notes().trim() || null,
          needs_review: needsReview(),
        });
      } else {
        const payload: any = {
          name: name().trim(),
          slug: finalSlug,
          category: category().trim(),
          notes: notes().trim() || null,
        };
        if (vendorMode() === 'pick') {
          if (!vendorId()) { setError('Select a vendor or switch to "New vendor"'); setSaving(false); return; }
          payload.vendor_id = Number(vendorId());
        } else {
          if (!vendorName().trim()) { setError('Vendor name is required'); setSaving(false); return; }
          payload.vendor_name = vendorName().trim();
        }
        const result = await api.findOrCreateVendorProduct(payload);
        // Curated create — clear the auto-set needs_review unless user opted in.
        if (!needsReview()) {
          product = await api.patchVendorProduct(result.product.id, { needs_review: false });
        } else {
          product = result.product;
        }
      }
      props.onSaved?.(product);
      props.onClose();
    } catch (err: any) {
      const msg = err?.message || 'Failed to save';
      setError(msg.includes('409') ? 'A product with this slug already exists for this vendor' : msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={props.existing ? 'Edit Vendor Product' : 'New Vendor Product'}
      footer={
        <>
          <button class={modalBtn.secondary} onClick={props.onClose} disabled={saving()}>Cancel</button>
          <button class={modalBtn.primary} onClick={submit} disabled={saving()}>
            {saving() ? 'Saving...' : (props.existing ? 'Save' : 'Create')}
          </button>
        </>
      }
    >
      <Show when={!props.existing}>
        <FormField label="Vendor" required>
          <div class="flex gap-2 mb-2">
            <button
              type="button"
              class={`press press-sm ${vendorMode() === 'pick' ? 'press-primary' : 'press-ghost'}`}
              onClick={() => setVendorMode('pick')}
            >
              Existing
            </button>
            <button
              type="button"
              class={`press press-sm ${vendorMode() === 'new' ? 'press-primary' : 'press-ghost'}`}
              onClick={() => setVendorMode('new')}
            >
              New
            </button>
          </div>
          <Show when={vendorMode() === 'pick'} fallback={
            <input
              class={formInputClass}
              placeholder="Cisco"
              value={vendorName()}
              onInput={(e) => setVendorName(e.currentTarget.value)}
            />
          }>
            <select class={formSelectClass} value={vendorId()} onChange={(e) => setVendorId(e.currentTarget.value)}>
              <option value="">— Select vendor —</option>
              <Show when={!vendorsRes.loading}>
                <For each={vendorsRes() || []}>
                  {(v: any) => <option value={String(v.id)}>{v.name}{v.needs_review ? ' (review)' : ''}</option>}
                </For>
              </Show>
            </select>
          </Show>
        </FormField>
      </Show>
      <Show when={props.existing}>
        <FormField label="Vendor" hint="Vendor cannot be reassigned — create a new product instead.">
          <input class={formInputClass} value={props.existing.vendor_name} disabled />
        </FormField>
      </Show>
      <FormField label="Product Name" required>
        <input
          class={formInputClass}
          placeholder="PA-3220, Falcon, Enterprise Security"
          value={name()}
          onInput={(e) => {
            const v = e.currentTarget.value;
            setName(v);
            if (!slugTouched()) setSlug(slugify(v));
          }}
          autofocus
        />
      </FormField>
      <FormField label="Slug" hint="Auto-derived from product name.">
        <input
          class={formInputClass}
          placeholder="pa-3220"
          value={slug()}
          disabled={!!props.existing}
          onInput={(e) => { setSlugTouched(true); setSlug(e.currentTarget.value); }}
        />
      </FormField>
      <FormField label="Category" required hint="Free-text, but stick to the conventional list so per-category filters work.">
        <input
          class={formInputClass}
          list="vendor-product-category-suggestions"
          placeholder="firewall"
          value={category()}
          disabled={!!props.lockedCategory}
          onInput={(e) => setCategory(e.currentTarget.value)}
        />
        <datalist id="vendor-product-category-suggestions">
          <For each={VENDOR_PRODUCT_CATEGORIES}>{(c) => <option value={c} />}</For>
        </datalist>
      </FormField>
      <FormField label="Notes">
        <textarea class={formTextareaClass} rows={2} placeholder="Optional. SKU notes, deployment context, etc." value={notes()} onInput={(e) => setNotes(e.currentTarget.value)} />
      </FormField>
      <FormField label="Needs review" hint="Auto-created products are flagged for canonicalization. Clear when you've confirmed the row.">
        <label class="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            class="accent-surf-400 w-4 h-4 cursor-pointer"
            checked={needsReview()}
            onChange={(e) => setNeedsReview(e.currentTarget.checked)}
          />
          <span class="text-[12px] uppercase tracking-wider font-semibold">Flag for review</span>
        </label>
      </FormField>
      <Show when={error()}>
        <div class="text-[12px] text-scarlet-400 mt-2 font-semibold">{error()}</div>
      </Show>
    </Modal>
  );
}

