// Behavior tests for OverviewPanel — the account Overview tab (relationship
// summary, domains, channel partners, supporting team). The guard that earns
// its keep here is the Domains editor: it must let you type a whole domain into
// one field. Regression — the list was rendered with <For> over a primitive
// string array, so every keystroke recreated the <input> and dropped focus,
// capping input at one character. <Index> keeps the node stable; these tests
// fail loudly if anyone reaches for <For> again.

import { render, screen, fireEvent, within } from '@solidjs/testing-library';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import OverviewPanel from './OverviewPanel';

// OverviewPanel imports the api client; the Domains flow never calls it (the
// internal-contacts resource only runs once the Team picker opens), but stub it
// so importing the component doesn't drag in real fetch wiring.
const apiMock = vi.hoisted(() => ({
  getAllContacts: vi.fn(async () => []),
  addPartner: vi.fn(),
  removePartner: vi.fn(),
  linkContactAccount: vi.fn(),
  unlinkContactAccount: vi.fn(),
}));
vi.mock('../../lib/api', () => ({ api: apiMock }));

beforeEach(() => vi.clearAllMocks());

const baseAccount = (over: Record<string, any> = {}) => ({
  id: 1,
  relationship_summary: '',
  domains: [],
  partners: [],
  team: [],
  ...over,
});

// Fresh saver per render so saveNow assertions don't bleed across tests. The
// shape matches createAutoSave's return ({ status, save, saveNow }).
function setup(account: any = baseAccount()) {
  const saver = { status: () => 'idle' as const, save: vi.fn(), saveNow: vi.fn() };
  render(() => <OverviewPanel account={account} saver={saver as any} active={true} />);
  // Scope to the Domains panel — three sections each have a "+ Add" button.
  const panel = screen.getByRole('heading', { name: 'Domains' }).closest('.panel') as HTMLElement;
  return { saver, panel, addDomain: () => fireEvent.click(within(panel).getByRole('button', { name: '+ Add' })) };
}

describe('OverviewPanel — Domains editor', () => {
  it('lets you type a full multi-character domain into one stable field', () => {
    const { saver, panel, addDomain } = setup();
    addDomain();

    const input = within(panel).getByPlaceholderText('acme.com') as HTMLInputElement;

    // Type the domain one character at a time into the SAME field reference,
    // exactly as a user would. With the old <For> the first keystroke tore the
    // node out — the held reference detached and later keystrokes were dropped.
    for (const value of ['a', 'ac', 'acm', 'acme', 'acme.', 'acme.c', 'acme.co', 'acme.com']) {
      fireEvent.input(input, { target: { value } });
    }

    const after = within(panel).getByPlaceholderText('acme.com') as HTMLInputElement;
    expect(after).toBe(input); // node preserved across keystrokes (Index, not For)
    expect(after.value).toBe('acme.com'); // and the whole string landed, not just 'a'

    // Persists on blur with the full domain.
    fireEvent.blur(after);
    expect(saver.saveNow).toHaveBeenCalledWith({ domains: ['acme.com'] });
  });

  it('edits the right row when several domains exist', () => {
    const { saver, panel } = setup(baseAccount({ domains: ['acme.com', 'globex.com'] }));

    const inputs = within(panel).getAllByPlaceholderText('acme.com') as HTMLInputElement[];
    expect(inputs.map((i) => i.value)).toEqual(['acme.com', 'globex.com']);

    fireEvent.input(inputs[1], { target: { value: 'globex.net' } });
    fireEvent.blur(inputs[1]);

    // Only the second entry changed — indexing stayed correct after the swap.
    expect(saver.saveNow).toHaveBeenCalledWith({ domains: ['acme.com', 'globex.net'] });
  });

  it('removes a domain and persists the shortened list', () => {
    const { saver, panel } = setup(baseAccount({ domains: ['acme.com', 'globex.com'] }));

    fireEvent.click(within(panel).getAllByRole('button', { name: '×' })[0]); // drop the first

    expect(within(panel).getAllByPlaceholderText('acme.com').map((i) => (i as HTMLInputElement).value)).toEqual(['globex.com']);
    expect(saver.saveNow).toHaveBeenCalledWith({ domains: ['globex.com'] });
  });
});
