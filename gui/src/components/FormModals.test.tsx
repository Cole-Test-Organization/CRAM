// Regression tests for MeetingFormModal.
//
// These guard the reactivity bug where the modal's init effect over-subscribed
// (it called serialize(), which reads every form signal) and therefore re-ran
// and *reset the whole form* on every keystroke and every contact selection.
// The fix was to capture the dirty-tracking baseline with untrack().
//
// Each test renders the modal into an in-memory DOM (jsdom), fires a real
// input/click event the way a user would, and asserts the input survives.
// Before the fix these go red; after it they go green.

import { render, screen, fireEvent } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { MeetingFormModal } from './FormModals';

// MeetingFormModal renders AttendeePicker, which calls api.getAttendeeOptions on
// mount. Stub the api module so the modal renders with no real network — and so
// the attendee test has exactly one contact to select.
vi.mock('../lib/api', () => ({
  api: {
    getAttendeeOptions: async () => ({
      account: [],
      partner: [],
      internal: [{ id: 99, full_name: 'Test Teammate', kind: 'internal' }],
    }),
  },
}));

// Let microtasks + Solid's effect queue drain. This matters: the *bug* reset the
// field asynchronously (the init effect runs after the input handler), so we
// must wait for that reset to have a chance to happen before asserting —
// otherwise even the buggy code would momentarily look correct.
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

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
