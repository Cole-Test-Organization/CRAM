import { afterEach, describe, expect, it, vi } from 'vitest';
import { isCramDesktop, openFloatingMeetingNotes } from './desktop';

afterEach(() => {
  delete (window as Window & { cramDesktop?: unknown }).cramDesktop;
});

describe('desktop bridge', () => {
  it('stays unavailable in the normal website', () => {
    expect(isCramDesktop()).toBe(false);
    expect(openFloatingMeetingNotes(4)).rejects.toThrow(/CRAM Desktop/);
  });

  it('opens a validated meeting through the narrow Electron bridge', async () => {
    const openMeetingNotes = vi.fn(async (meetingId: number) => ({
      opened: true,
      meetingId,
    }));
    Object.defineProperty(window, 'cramDesktop', {
      configurable: true,
      value: { isDesktop: true, openMeetingNotes },
    });

    await expect(openFloatingMeetingNotes(23)).resolves.toEqual({
      opened: true,
      meetingId: 23,
    });
    expect(openMeetingNotes).toHaveBeenCalledWith(23);
    await expect(openFloatingMeetingNotes(0)).rejects.toThrow(/positive meeting id/);
  });
});
