export type MobileCachedResponse = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyBase64: string;
};

export type CramMobileCacheBridge = {
  put: (key: string, response: MobileCachedResponse) => Promise<void>;
  get: (key: string) => Promise<MobileCachedResponse | null>;
  keys: () => Promise<string[]>;
  delete: (key: string) => Promise<void>;
};

type CramMobileBridge = {
  isMobile: true;
  cache: CramMobileCacheBridge;
  openMeetingNotes: (meetingId: number) => Promise<{
    opened: boolean;
    meetingId: number;
  }>;
  openSettings: () => Promise<{ opened: boolean }>;
};

function isCacheBridge(value: unknown): value is CramMobileCacheBridge {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CramMobileCacheBridge>;
  return typeof candidate.put === 'function'
    && typeof candidate.get === 'function'
    && typeof candidate.keys === 'function'
    && typeof candidate.delete === 'function';
}

export function mobileBridge(): CramMobileBridge | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as Window & { cramMobile?: unknown }).cramMobile;
  if (!candidate || typeof candidate !== 'object') return null;
  const bridge = candidate as Partial<CramMobileBridge>;
  if (
    bridge.isMobile !== true
    || !isCacheBridge(bridge.cache)
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

export function mobileCacheBridge(): CramMobileCacheBridge | null {
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
