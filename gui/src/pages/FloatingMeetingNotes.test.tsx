import { fireEvent, render, screen } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMeetingDraft } from '../lib/meetingDraft';
import { FloatingMeetingNotesEditor } from './FloatingMeetingNotes';

const apiMock = vi.hoisted(() => ({
  getMeeting: vi.fn(),
  updateMeeting: vi.fn(),
}));
const offlineMock = vi.hoisted(() => ({
  isOffline: vi.fn(),
}));

vi.mock('../lib/api', () => ({ api: apiMock }));
vi.mock('../lib/offline', () => ({ isOffline: offlineMock.isOffline }));

const meeting = {
  id: 31,
  title: 'Customer sync',
  filename: 'customer-sync',
  account_name: 'Acme',
  starts_at: '2026-07-29T12:00:00.000Z',
  body: 'Server notes',
  updated_at: '2026-07-29T11:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  offlineMock.isOffline.mockReturnValue(false);
  apiMock.getMeeting.mockResolvedValue({ ...meeting });
  apiMock.updateMeeting.mockImplementation(async (_id: number, data: any) => ({
    ...meeting,
    ...data,
    updated_at: '2026-07-29T12:05:00.000Z',
  }));
});

describe('FloatingMeetingNotesEditor', () => {
  it('stores every edit locally, then clears the draft after a server save', async () => {
    render(() => <FloatingMeetingNotesEditor meetingId={31} />);
    const editor = await screen.findByDisplayValue('Server notes');

    fireEvent.input(editor, { target: { value: 'Notes from the floating window' } });
    expect(loadMeetingDraft(31)?.body).toBe('Notes from the floating window');
    expect(screen.getByRole('status').textContent).toMatch(/Saved locally/);

    fireEvent.click(screen.getByRole('button', { name: 'Save to CRAM' }));
    await vi.waitFor(() => {
      expect(apiMock.updateMeeting).toHaveBeenCalledWith(31, {
        body: 'Notes from the floating window',
      });
    });
    await vi.waitFor(() => expect(loadMeetingDraft(31)).toBeNull());
    expect(screen.getByRole('status').textContent).toMatch(/Saved to CRAM/);
  });

  it('keeps an offline draft without attempting a write', async () => {
    offlineMock.isOffline.mockReturnValue(true);
    render(() => <FloatingMeetingNotesEditor meetingId={31} />);
    const editor = await screen.findByDisplayValue('Server notes');

    fireEvent.input(editor, { target: { value: 'Captured without the proxy' } });

    expect(loadMeetingDraft(31)?.body).toBe('Captured without the proxy');
    expect(screen.getByRole('status').textContent).toMatch(/CRAM is offline/);
    expect(apiMock.updateMeeting).not.toHaveBeenCalled();
  });
});
