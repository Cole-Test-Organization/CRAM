// Behavior tests for AttendeePicker — the bucketed attendee multi-select inside
// the meeting modal. Guards: external mode without an account shows a prompt and
// fetches nothing; once it has options, toggling a contact reports ids via
// onChange; and a selected attendee renders a chip whose × removes it.

import { render, screen, fireEvent } from '@solidjs/testing-library';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AttendeePicker from './AttendeePicker';

const apiMock = vi.hoisted(() => ({
  getAttendeeOptions: vi.fn(async () => ({
    account: [{ id: 1, full_name: 'Alice Account', kind: 'account', title: 'CISO' }],
    partner: [{ id: 2, full_name: 'Pat Partner', kind: 'partner', partner_account_name: 'CDW' }],
    internal: [{ id: 3, full_name: 'Iris Internal', kind: 'internal' }],
  })),
}));
vi.mock('../lib/api', () => ({ api: apiMock }));

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => vi.clearAllMocks());

describe('AttendeePicker', () => {
  it('external mode with no account shows a prompt and fetches nothing', async () => {
    render(() => <AttendeePicker mode="external" accountId={null} value={[]} onChange={() => {}} />);
    expect(screen.getByText('Select an account first')).toBeTruthy();
    await flush();
    expect(apiMock.getAttendeeOptions).not.toHaveBeenCalled();
  });

  it('fetches options once it has an account and reports a toggled id via onChange', async () => {
    const onChange = vi.fn();
    render(() => <AttendeePicker mode="external" accountId={5} value={[]} onChange={onChange} />);

    const alice = await screen.findByText('Alice Account');
    const checkbox = alice.closest('label')!.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith([1]);
  });

  it('renders a chip for a selected attendee and removes it via the × button', async () => {
    const onChange = vi.fn();
    // internal mode fetches regardless of account; value=[3] → Iris is selected.
    render(() => <AttendeePicker mode="internal" accountId={null} value={[3]} onChange={onChange} />);

    const removeBtn = await screen.findByRole('button', { name: 'Remove Iris Internal' });
    fireEvent.click(removeBtn);
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
