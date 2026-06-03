// Behavior tests for NotesPanel — the timestamped-notes feed on account/contact/
// opportunity pages. Guards: it renders the fetched feed, composing a note posts
// {target, body} and the Save button is gated on non-empty input, and deleting a
// note confirms first then calls the API.

import { render, screen, fireEvent } from '@solidjs/testing-library';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import NotesPanel from './NotesPanel';

const apiMock = vi.hoisted(() => ({
  getNotes: vi.fn(async () => ({
    notes: [
      { id: 1, body: 'First observation', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      { id: 2, body: 'Second observation', created_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' },
    ],
    total: 2,
  })),
  createNote: vi.fn(async (d: any) => ({ id: 3, ...d, created_at: '2026-01-03T00:00:00Z', updated_at: '2026-01-03T00:00:00Z' })),
  patchNote: vi.fn(async (id: number, d: any) => ({ id, ...d })),
  deleteNote: vi.fn(async () => undefined),
}));
vi.mock('../lib/api', () => ({ api: apiMock }));

beforeEach(() => vi.clearAllMocks());

describe('NotesPanel', () => {
  it('renders the fetched notes for its target', async () => {
    render(() => <NotesPanel target={{ account_id: 7 }} />);
    expect(await screen.findByText('First observation')).toBeTruthy();
    expect(screen.getByText('Second observation')).toBeTruthy();
    expect(apiMock.getNotes).toHaveBeenCalledWith(expect.objectContaining({ account_id: 7 }));
  });

  it('composes a new note via the API, with Save gated on non-empty input', async () => {
    render(() => <NotesPanel target={{ account_id: 7 }} />);
    await screen.findByText('First observation');

    fireEvent.click(screen.getByRole('button', { name: '+ New Note' }));
    const editor = screen.getByPlaceholderText(/Markdown supported/i);
    const saveBtn = screen.getByRole('button', { name: 'Save Note' }) as HTMLButtonElement;

    expect(saveBtn.disabled).toBe(true); // empty → disabled
    fireEvent.input(editor, { target: { value: 'Fresh note' } });
    expect(saveBtn.disabled).toBe(false);

    fireEvent.click(saveBtn);
    await vi.waitFor(() =>
      expect(apiMock.createNote).toHaveBeenCalledWith({ account_id: 7, body: 'Fresh note' }),
    );
  });

  it('deletes a note only after the user confirms', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(() => <NotesPanel target={{ account_id: 7 }} />);
    await screen.findByText('First observation');

    fireEvent.click(screen.getAllByTitle('Delete note')[0]); // first note → id 1
    await vi.waitFor(() => expect(apiMock.deleteNote).toHaveBeenCalledWith(1));
    confirmSpy.mockRestore();
  });
});
