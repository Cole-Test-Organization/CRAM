// Behavior tests for AccountPicker — the search-and-select account combobox used
// across the create modals. Guards: it lists fetched accounts, filters as you
// type, reports the picked account via onChange, honors excludePartner, and the
// inline "create new account" path calls the API and selects the result.

import { render, screen, fireEvent } from '@solidjs/testing-library';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AccountPicker from './AccountPicker';

const apiMock = vi.hoisted(() => ({
  getAccounts: vi.fn(async () => ({
    accounts: [
      { id: 1, name: 'Acme Corp', slug: 'acme-corp', status: 'account' },
      { id: 2, name: 'Globex', slug: 'globex', status: 'account' },
      { id: 3, name: 'CDW', slug: 'cdw', status: 'partner' },
    ],
    total: 3,
  })),
  createAccount: vi.fn(async (data: any) => ({ id: 99, ...data })),
}));
vi.mock('../lib/api', () => ({ api: apiMock }));

beforeEach(() => vi.clearAllMocks());

describe('AccountPicker', () => {
  it('opens, lists fetched accounts, and reports the picked one via onChange', async () => {
    const onChange = vi.fn();
    render(() => <AccountPicker value={null} onChange={onChange} />);

    // Trigger shows the placeholder until something is chosen.
    fireEvent.click(screen.getByText('Select account...'));

    const row = await screen.findByText('Globex'); // waits for the resource
    fireEvent.click(row);
    expect(onChange).toHaveBeenCalledWith({ id: 2, name: 'Globex', slug: 'globex' });
  });

  it('filters the list as you type', async () => {
    render(() => <AccountPicker value={null} onChange={() => {}} />);
    fireEvent.click(screen.getByText('Select account...'));
    await screen.findByText('Acme Corp');

    fireEvent.input(screen.getByPlaceholderText('Search accounts...'), { target: { value: 'glob' } });
    expect(screen.queryByText('Acme Corp')).toBeNull();
    expect(screen.getByText('Globex')).toBeTruthy();
  });

  it('excludePartner filters partner accounts out of the list', async () => {
    render(() => <AccountPicker value={null} onChange={() => {}} excludePartner />);
    fireEvent.click(screen.getByText('Select account...'));
    await screen.findByText('Acme Corp');
    expect(screen.queryByText('CDW')).toBeNull();
  });

  it('creates a new account inline and selects it', async () => {
    const onChange = vi.fn();
    render(() => <AccountPicker value={null} onChange={onChange} />);
    fireEvent.click(screen.getByText('Select account...'));
    await screen.findByText('Acme Corp'); // dropdown open in pick mode

    fireEvent.click(screen.getByText(/Create new account/i)); // → create mode
    fireEvent.input(screen.getByPlaceholderText('Company name'), { target: { value: 'New Co' } });
    fireEvent.click(screen.getByRole('button', { name: /^Create$/ }));

    // Slug is auto-derived from the name; the created account is selected.
    await vi.waitFor(() =>
      expect(apiMock.createAccount).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New Co', slug: 'new-co', status: 'account' }),
      ),
    );
    await vi.waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 99, name: 'New Co' })),
    );
  });
});
