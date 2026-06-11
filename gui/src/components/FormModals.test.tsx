// Component tests for the form modals in FormModals.tsx.
//
// Two kinds of coverage live here:
//   1. The original MeetingFormModal *reactivity regression* tests — render the
//      modal, fire a real edit, assert it survives the init effect (the bug where
//      serialize() over-subscribed and reset the form on every keystroke).
//   2. Smoke + key-behavior coverage for every other modal: typed input persists
//      (which also guards the unsaved-changes init effect against the same
//      footgun), required-field validation blocks the API, and a valid submit
//      calls the right api.* method and closes.
//
// All network goes through one mocked `api` (see vi.mock below) so these stay
// hermetic. Each modal renders through a Portal, so we query via `screen`.

import { render, screen, fireEvent } from '@solidjs/testing-library';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  MeetingFormModal,
  AccountFormModal,
  ContactFormModal,
  OpportunityFormModal,
  ProductFormModal,
  ProductCategoryFormModal,
  VendorFormModal,
  VendorProductFormModal,
} from './FormModals';

// One mock for every api.* the modals touch — resource fetchers return shapes so
// the modals render; writes are vi.fn()s with light implementations so we can
// assert the call and let the submit→onClose path complete. getAttendeeOptions
// gives the Meeting attendee test exactly one selectable contact.
type AttendeeOpt = { id: number; full_name: string; kind: string };
type AttendeeOptions = { account: AttendeeOpt[]; partner: AttendeeOpt[]; internal: AttendeeOpt[] };

const apiMock = vi.hoisted(() => ({
  getAttendeeOptions: vi.fn(async (): Promise<AttendeeOptions> => ({
    account: [],
    partner: [],
    internal: [{ id: 99, full_name: 'Test Teammate', kind: 'internal' }],
  })),
  getAccounts: vi.fn(async () => ({ accounts: [{ id: 1, name: 'Acme Corp', slug: 'acme-corp', status: 'account' }] as any[], total: 1 })),
  getProducts: vi.fn(async () => ({ products: [], total: 0 })),
  getProductCategories: vi.fn(async () => ({ categories: [], total: 0 })),
  getVendors: vi.fn(async () => ({ vendors: [{ id: 7, name: 'Cisco' }], total: 1 })),

  createAccount: vi.fn(async (d: any) => ({ id: 10, ...d })),
  patchAccount: vi.fn(async (id: number, d: any) => ({ id, ...d })),
  createContact: vi.fn(async (accountId: number, d: any) => ({ id: 20, account_id: accountId, ...d })),
  patchContact: vi.fn(async (id: number, d: any) => ({ id, ...d })),
  createOpportunity: vi.fn(async (d: any) => ({ id: 30, ...d })),
  patchOpportunity: vi.fn(async (id: number, d: any) => ({ id, ...d })),
  createProduct: vi.fn(async (d: any) => ({ id: 40, ...d })),
  patchProduct: vi.fn(async (id: number, d: any) => ({ id, ...d })),
  createProductCategory: vi.fn(async (d: any) => ({ id: 50, ...d })),
  patchProductCategory: vi.fn(async (id: number, d: any) => ({ id, ...d })),
  findOrCreateVendor: vi.fn(async (d: any) => ({ vendor: { id: 60, ...d }, created: true })),
  patchVendor: vi.fn(async (id: number, d: any) => ({ id, ...d })),
  findOrCreateVendorProduct: vi.fn(async (d: any) => ({ product: { id: 70, ...d }, created: true, vendor: { id: 7 }, vendor_created: false })),
  patchVendorProduct: vi.fn(async (id: number, d: any) => ({ id, ...d })),
  createMeeting: vi.fn(async (d: any) => ({ id: 80, ...d })),
  updateMeeting: vi.fn(async (id: number, d: any) => ({ id, ...d })),
}));
vi.mock('../lib/api', () => ({ api: apiMock }));

beforeEach(() => vi.clearAllMocks());

// Let microtasks + Solid's effect queue drain before asserting. The reactivity
// *bug* reset fields asynchronously (the init effect runs after the input
// handler), so asserting too early would let a broken version look correct.
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const create = (button: RegExp | string = 'Create') => screen.getByRole('button', { name: button });

// ───────────────────────────── Meeting (regressions) ─────────────────────────

describe('MeetingFormModal — editing must not be clobbered by the init effect', () => {
  it('keeps typed notes', async () => {
    render(() => (
      <MeetingFormModal
        open
        onClose={() => {}}
        existing={{ id: 1, date: '2026-06-02', internal: true, body: '', contacts: [] }}
      />
    ));

    const notes = screen.getByPlaceholderText(/meeting notes/i) as HTMLTextAreaElement;
    fireEvent.input(notes, { target: { value: 'POV kickoff went well' } });
    await flush();

    // Pre-fix: the init effect re-ran and reset this back to '' on every keystroke.
    expect(notes.value).toBe('POV kickoff went well');
  });

  it('keeps a selected attendee', async () => {
    render(() => (
      <MeetingFormModal
        open
        onClose={() => {}}
        existing={{ id: 2, date: '2026-06-02', internal: true, body: 'notes', contacts: [] }}
      />
    ));

    // Wait for AttendeePicker's (mocked) options to resolve and render the contact.
    await screen.findByText('Test Teammate');
    const checkbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    fireEvent.click(checkbox);
    await flush();

    // Pre-fix: the init effect re-ran and reset contactIds to [] on selection,
    // which is exactly the "it won't let me keep a contact" symptom.
    expect(checkbox.checked).toBe(true);
  });
});

// ───────────────── Meeting — attendee scope changes clear selection ──────────
// Switching the account (or toggling internal) changes the attendee option set.
// The selection must be dropped so a prior scope's contact ids can't be silently
// submitted: AttendeePicker hides ids it can't resolve against the new options,
// but they'd still POST, and the meetings service only validates that a contact
// *exists*, not that it belongs to the chosen account.

describe('MeetingFormModal — changing the scope clears selected attendees', () => {
  // mockResolvedValue persists past clearAllMocks (which only clears call
  // history), so restore the two mocks this block overrides to their file
  // defaults afterwards — otherwise the two-account list / customer contact
  // would leak into later AccountPicker-rendering tests.
  afterEach(() => {
    apiMock.getAccounts.mockResolvedValue({ accounts: [{ id: 1, name: 'Acme Corp', slug: 'acme-corp', status: 'account' }] as any[], total: 1 });
    apiMock.getAttendeeOptions.mockResolvedValue({ account: [], partner: [], internal: [{ id: 99, full_name: 'Test Teammate', kind: 'internal' }] });
  });

  it('clears the selection when the account changes (stale ids are not submitted)', async () => {
    // Two accounts to switch between, and one selectable customer contact that the
    // attendee picker offers for whichever account is chosen.
    apiMock.getAccounts.mockResolvedValue({
      accounts: [
        { id: 1, name: 'Acme Corp', slug: 'acme-corp', status: 'account' },
        { id: 2, name: 'Beta Inc', slug: 'beta-inc', status: 'account' },
      ],
      total: 2,
    });
    apiMock.getAttendeeOptions.mockResolvedValue({
      account: [{ id: 42, full_name: 'Casey Customer', kind: 'account' }],
      partner: [],
      internal: [],
    });

    const onClose = vi.fn();
    render(() => <MeetingFormModal open onClose={onClose} />);

    // Notes are required for submit — fill them so only the attendee check gates.
    fireEvent.input(screen.getByPlaceholderText(/meeting notes/i), { target: { value: 'kickoff' } });

    // Pick account #1 via the AccountPicker dropdown.
    fireEvent.click(screen.getByRole('button', { name: /select account/i }));
    fireEvent.click(await screen.findByText('Acme Corp'));

    // Select the contact the picker offers for account #1. Scope the checkbox to
    // the attendee row — the modal also renders the "internal" Type checkbox.
    const contact = await screen.findByText('Casey Customer');
    fireEvent.click(contact);
    await flush();
    const attendeeRow = screen.getByTestId('attendee-option');
    const checkbox = attendeeRow.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    // Switch to account #2 without re-picking an attendee.
    fireEvent.click(screen.getByRole('button', { name: /acme corp/i }));
    fireEvent.click(await screen.findByText('Beta Inc'));
    await flush();

    // Try to save. The selection must have been cleared, so the manual-create
    // guard blocks with "Select at least one attendee" and never POSTs the stale
    // contact. Pre-fix: contactIds still held id 42 and createMeeting fired,
    // linking Acme's contact to Beta.
    fireEvent.click(create());
    await flush();
    expect(screen.getByText('Select at least one attendee')).toBeTruthy();
    expect(apiMock.createMeeting).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────── Account ───────────────────────────────────

describe('AccountFormModal', () => {
  it('keeps typed input and auto-derives the slug', async () => {
    render(() => <AccountFormModal open onClose={() => {}} />);
    const name = screen.getByPlaceholderText('Acme Corp') as HTMLInputElement;
    fireEvent.input(name, { target: { value: 'Beta Inc' } });
    await flush();
    expect(name.value).toBe('Beta Inc');
    expect((screen.getByPlaceholderText('acme-corp') as HTMLInputElement).value).toBe('beta-inc');
  });

  it('requires a name', async () => {
    const onClose = vi.fn();
    render(() => <AccountFormModal open onClose={onClose} />);
    fireEvent.click(create());
    expect(screen.getByText('Name is required')).toBeTruthy();
    expect(apiMock.createAccount).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('creates the account and closes', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(() => <AccountFormModal open onSaved={onSaved} onClose={onClose} />);
    fireEvent.input(screen.getByPlaceholderText('Acme Corp'), { target: { value: 'Beta Inc' } });
    fireEvent.click(create());
    await vi.waitFor(() =>
      expect(apiMock.createAccount).toHaveBeenCalledWith(expect.objectContaining({ name: 'Beta Inc', slug: 'beta-inc' })),
    );
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalled();
  });
});

// ───────────────────────────────── Contact ───────────────────────────────────

describe('ContactFormModal', () => {
  it('keeps typed input (init effect must not clobber edits)', async () => {
    render(() => <ContactFormModal open onClose={() => {}} fixedAccountId={5} fixedAccountName="Acme" />);
    const name = screen.getByPlaceholderText('Jane Doe') as HTMLInputElement;
    fireEvent.input(name, { target: { value: 'Dana Lee' } });
    await flush();
    expect(name.value).toBe('Dana Lee');
  });

  it('requires a full name, then an account', async () => {
    render(() => <ContactFormModal open onClose={() => {}} />);
    fireEvent.click(create());
    expect(screen.getByText('Full name is required')).toBeTruthy();

    fireEvent.input(screen.getByPlaceholderText('Jane Doe'), { target: { value: 'Dana Lee' } });
    fireEvent.click(create());
    expect(screen.getByText('Select an account')).toBeTruthy();
    expect(apiMock.createContact).not.toHaveBeenCalled();
  });

  it('creates a contact on the fixed account', async () => {
    const onClose = vi.fn();
    render(() => <ContactFormModal open onClose={onClose} fixedAccountId={5} fixedAccountName="Acme" />);
    fireEvent.input(screen.getByPlaceholderText('Jane Doe'), { target: { value: 'Dana Lee' } });
    fireEvent.input(screen.getByPlaceholderText('jane@example.com'), { target: { value: 'dana@acme.com' } });
    fireEvent.click(create());
    await vi.waitFor(() =>
      expect(apiMock.createContact).toHaveBeenCalledWith(5, expect.objectContaining({ full_name: 'Dana Lee', email: 'dana@acme.com' })),
    );
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

// ─────────────────────────────── Opportunity ─────────────────────────────────

describe('OpportunityFormModal', () => {
  it('requires an account when none is fixed', async () => {
    render(() => <OpportunityFormModal open onClose={() => {}} />);
    fireEvent.click(create());
    expect(screen.getByText('Select an account')).toBeTruthy();
    expect(apiMock.createOpportunity).not.toHaveBeenCalled();
  });

  it('requires a name once the account is fixed', async () => {
    render(() => <OpportunityFormModal open onClose={() => {}} fixedAccountId={5} fixedAccountName="Acme" />);
    fireEvent.click(create());
    expect(screen.getByText('Name is required')).toBeTruthy();
    expect(apiMock.createOpportunity).not.toHaveBeenCalled();
  });

  it('creates an opportunity on the fixed account', async () => {
    const onClose = vi.fn();
    render(() => <OpportunityFormModal open onClose={onClose} fixedAccountId={5} fixedAccountName="Acme" />);
    fireEvent.input(screen.getByPlaceholderText('Q3 SIEM Replacement'), { target: { value: 'New Deal' } });
    fireEvent.click(create());
    await vi.waitFor(() =>
      expect(apiMock.createOpportunity).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New Deal', account_id: 5, stage: 'opp_identification' }),
      ),
    );
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

// ───────────────────────────────── Product ───────────────────────────────────

describe('ProductFormModal', () => {
  it('requires a name', async () => {
    render(() => <ProductFormModal open onClose={() => {}} />);
    fireEvent.click(create());
    expect(screen.getByText('Name is required')).toBeTruthy();
    expect(apiMock.createProduct).not.toHaveBeenCalled();
  });

  it('creates the product and closes', async () => {
    const onClose = vi.fn();
    render(() => <ProductFormModal open onClose={onClose} />);
    fireEvent.input(screen.getByPlaceholderText('Cortex XDR Pro'), { target: { value: 'Widget' } });
    fireEvent.click(create());
    await vi.waitFor(() =>
      expect(apiMock.createProduct).toHaveBeenCalledWith({ name: 'Widget', category_id: null }),
    );
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

// ────────────────────────────── Product Category ─────────────────────────────

describe('ProductCategoryFormModal', () => {
  it('requires a name', async () => {
    render(() => <ProductCategoryFormModal open onClose={() => {}} />);
    fireEvent.click(create());
    expect(screen.getByText('Name is required')).toBeTruthy();
    expect(apiMock.createProductCategory).not.toHaveBeenCalled();
  });

  it('creates the category', async () => {
    const onClose = vi.fn();
    render(() => <ProductCategoryFormModal open onClose={onClose} />);
    fireEvent.input(screen.getByPlaceholderText('Network Security'), { target: { value: 'Cloud' } });
    fireEvent.click(create());
    await vi.waitFor(() => expect(apiMock.createProductCategory).toHaveBeenCalledWith({ name: 'Cloud' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

// ───────────────────────────────── Vendor ────────────────────────────────────

describe('VendorFormModal', () => {
  it('keeps typed input and auto-derives the slug', async () => {
    render(() => <VendorFormModal open onClose={() => {}} />);
    const name = screen.getByPlaceholderText('Palo Alto Networks') as HTMLInputElement;
    fireEvent.input(name, { target: { value: 'Acme Security' } });
    await flush();
    expect(name.value).toBe('Acme Security');
    expect((screen.getByPlaceholderText('palo-alto-networks') as HTMLInputElement).value).toBe('acme-security');
  });

  it('requires a name', async () => {
    render(() => <VendorFormModal open onClose={() => {}} />);
    fireEvent.click(create());
    expect(screen.getByText('Name is required')).toBeTruthy();
    expect(apiMock.findOrCreateVendor).not.toHaveBeenCalled();
  });

  it('creates the vendor via find-or-create and closes', async () => {
    const onClose = vi.fn();
    render(() => <VendorFormModal open onClose={onClose} />);
    fireEvent.input(screen.getByPlaceholderText('Palo Alto Networks'), { target: { value: 'Acme Security' } });
    fireEvent.click(create());
    await vi.waitFor(() =>
      expect(apiMock.findOrCreateVendor).toHaveBeenCalledWith(expect.objectContaining({ name: 'Acme Security', slug: 'acme-security' })),
    );
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

// ────────────────────────────── Vendor Product ───────────────────────────────

describe('VendorProductFormModal', () => {
  it('requires a name, then a category', async () => {
    render(() => <VendorProductFormModal open onClose={() => {}} />);
    fireEvent.click(create());
    expect(screen.getByText('Name is required')).toBeTruthy();

    fireEvent.input(screen.getByPlaceholderText(/PA-3220/), { target: { value: 'Widget FW' } });
    fireEvent.click(create());
    expect(screen.getByText('Category is required')).toBeTruthy();
    expect(apiMock.findOrCreateVendorProduct).not.toHaveBeenCalled();
  });

  it('creates a vendor product against a new vendor', async () => {
    const onClose = vi.fn();
    render(() => <VendorProductFormModal open onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'New' })); // vendor mode → new
    fireEvent.input(screen.getByPlaceholderText('Cisco'), { target: { value: 'Acme Sec' } });
    fireEvent.input(screen.getByPlaceholderText(/PA-3220/), { target: { value: 'Widget FW' } });
    fireEvent.input(screen.getByPlaceholderText('firewall'), { target: { value: 'firewall' } });
    fireEvent.click(create());
    await vi.waitFor(() =>
      expect(apiMock.findOrCreateVendorProduct).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Widget FW', slug: 'widget-fw', category: 'firewall', vendor_name: 'Acme Sec' }),
      ),
    );
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

// ─────────────────────── Unsaved-changes guard (wiring) ──────────────────────
// The guard is now wired into the multi-field modals (Account, Contact,
// Opportunity, Vendor, VendorProduct). These prove the wiring on a representative
// modal: a dirty in-app close confirms first and respects a decline, while a
// clean close passes straight through. The "keeps typed input" tests above are
// the companion guarantee — they'd go red if rebaseline()'s untrack regressed
// and the open effect started resetting the form on every keystroke.

describe('unsaved-changes guard wiring (AccountFormModal)', () => {
  it('confirms before discarding a dirty form, and a decline keeps it open', async () => {
    const onClose = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(() => <AccountFormModal open onClose={onClose} />);

    fireEvent.input(screen.getByPlaceholderText('Acme Corp'), { target: { value: 'Beta Inc' } });
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); // → requestClose

    expect(confirmSpy).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled(); // user declined → modal stays open
    confirmSpy.mockRestore();
  });

  it('closes straight through when the form is clean — no confirm', async () => {
    const onClose = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(() => <AccountFormModal open onClose={onClose} />);
    await flush();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(confirmSpy).not.toHaveBeenCalled(); // clean → no prompt
    expect(onClose).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
