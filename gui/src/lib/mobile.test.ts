import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isCramMobile,
  mobileCacheBridge,
  openMobileMeetingNotes,
  openMobileSettings,
} from './mobile';

afterEach(() => {
  delete (window as Window & { cramMobile?: unknown }).cramMobile;
});

function installBridge() {
  const bridge = {
    isMobile: true as const,
    cache: {
      put: vi.fn(async () => undefined),
      get: vi.fn(async () => null),
      keys: vi.fn(async () => []),
      delete: vi.fn(async () => undefined),
    },
    openMeetingNotes: vi.fn(async (meetingId: number) => ({ opened: true, meetingId })),
    openSettings: vi.fn(async () => ({ opened: true })),
  };
  Object.defineProperty(window, 'cramMobile', {
    configurable: true,
    value: bridge,
  });
  return bridge;
}

describe('mobile bridge', () => {
  it('stays unavailable in a normal browser', () => {
    expect(isCramMobile()).toBe(false);
    expect(mobileCacheBridge()).toBeNull();
    expect(openMobileSettings()).rejects.toThrow(/CRAM Mobile/);
  });

  it('validates ids and exposes only the narrow native operations', async () => {
    const bridge = installBridge();

    expect(isCramMobile()).toBe(true);
    expect(mobileCacheBridge()).toBe(bridge.cache);
    await expect(openMobileMeetingNotes(23)).resolves.toEqual({
      opened: true,
      meetingId: 23,
    });
    await expect(openMobileMeetingNotes(0)).rejects.toThrow(/positive meeting id/);
    await expect(openMobileSettings()).resolves.toEqual({ opened: true });
    expect(bridge.openMeetingNotes).toHaveBeenCalledWith(23);
    expect(bridge.openSettings).toHaveBeenCalledOnce();
  });

  it('rejects a partial or spoofed bridge', () => {
    Object.defineProperty(window, 'cramMobile', {
      configurable: true,
      value: { isMobile: true, cache: {} },
    });

    expect(isCramMobile()).toBe(false);
  });
});
