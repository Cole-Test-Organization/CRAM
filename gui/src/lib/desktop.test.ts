import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clientMeetingNotesLabel,
  hasClientMeetingNotes,
  isCramDesktop,
  openClientMeetingNotes,
  openFloatingMeetingNotes,
} from './desktop';

afterEach(() => {
  delete (window as Window & { cramDesktop?: unknown }).cramDesktop;
  delete (window as Window & { cramMobile?: unknown }).cramMobile;
});

describe('desktop bridge', () => {
  it('stays unavailable in the normal website', () => {
    expect(isCramDesktop()).toBe(false);
    expect(hasClientMeetingNotes()).toBe(false);
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
    expect(hasClientMeetingNotes()).toBe(true);
    expect(clientMeetingNotesLabel()).toBe('Float Notes');
  });

  it('uses focused notes through the mobile bridge', async () => {
    const openMeetingNotes = vi.fn(async (meetingId: number) => ({
      opened: true,
      meetingId,
    }));
    Object.defineProperty(window, 'cramMobile', {
      configurable: true,
      value: {
        isMobile: true,
        cache: {
          put: vi.fn(),
          get: vi.fn(),
          keys: vi.fn(),
          delete: vi.fn(),
        },
        openMeetingNotes,
        openSettings: vi.fn(),
      },
    });

    expect(isCramDesktop()).toBe(false);
    expect(hasClientMeetingNotes()).toBe(true);
    expect(clientMeetingNotesLabel()).toBe('Focus Notes');
    await expect(openClientMeetingNotes(31)).resolves.toEqual({
      opened: true,
      meetingId: 31,
    });
    expect(openMeetingNotes).toHaveBeenCalledWith(31);
  });
});
