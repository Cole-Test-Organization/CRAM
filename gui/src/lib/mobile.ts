import {
  isClientCacheBridge,
  type ClientCacheBridge,
} from './clientCache';

type CramMobileBridge = {
  isMobile: true;
  cache: ClientCacheBridge;
  openMeetingNotes: (meetingId: number) => Promise<{
    opened: boolean;
    meetingId: number;
  }>;
  openSettings: () => Promise<{ opened: boolean }>;
};

export function mobileBridge(): CramMobileBridge | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as Window & { cramMobile?: unknown }).cramMobile;
  if (!candidate || typeof candidate !== 'object') return null;
  const bridge = candidate as Partial<CramMobileBridge>;
  if (
    bridge.isMobile !== true
    || !isClientCacheBridge(bridge.cache)
    || typeof bridge.openMeetingNotes !== 'function'
    || typeof bridge.openSettings !== 'function'
  ) {
    return null;
  }
  return bridge as CramMobileBridge;
}

export function isCramMobile() {
  return mobileBridge() !== null;
}

export function mobileCacheBridge(): ClientCacheBridge | null {
  return mobileBridge()?.cache || null;
}

export async function openMobileMeetingNotes(meetingId: number) {
  if (!Number.isInteger(meetingId) || meetingId <= 0) {
    throw new Error('A positive meeting id is required.');
  }
  const bridge = mobileBridge();
  if (!bridge) throw new Error('Focused notes are available in CRAM Mobile.');
  return bridge.openMeetingNotes(meetingId);
}

export async function openMobileSettings() {
  const bridge = mobileBridge();
  if (!bridge) throw new Error('Mobile settings are available in CRAM Mobile.');
  return bridge.openSettings();
}
