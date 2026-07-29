import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearMeetingDraft,
  loadMeetingDraft,
  meetingDraftKey,
  saveMeetingDraft,
} from './meetingDraft';

beforeEach(() => localStorage.clear());

describe('meeting draft storage', () => {
  it('persists a versioned local draft for one meeting', () => {
    const saved = saveMeetingDraft(
      17,
      '# Demo notes',
      '2026-07-29T12:00:00.000Z',
      localStorage,
      new Date('2026-07-29T12:05:00.000Z'),
    );

    expect(saved?.meetingId).toBe(17);
    expect(loadMeetingDraft(17)).toEqual(saved);
    expect(loadMeetingDraft(18)).toBeNull();
  });

  it('ignores malformed records and clears completed drafts', () => {
    localStorage.setItem(meetingDraftKey(17), '{"body":7}');
    expect(loadMeetingDraft(17)).toBeNull();

    saveMeetingDraft(17, 'Safe locally', null);
    clearMeetingDraft(17);
    expect(loadMeetingDraft(17)).toBeNull();
  });
});
