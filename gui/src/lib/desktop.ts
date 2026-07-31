import {
  isCramMobile,
  openMobileMeetingNotes,
} from './mobile';
import {
  isClientCacheBridge,
  type ClientCacheBridge,
} from './clientCache';

type CramDesktopBridge = {
  isDesktop: true;
  cache: ClientCacheBridge;
  openMeetingNotes: (meetingId: number) => Promise<{
    opened: boolean;
    meetingId: number;
  }>;
};

function desktopBridge(): CramDesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as Window & { cramDesktop?: unknown }).cramDesktop;
  if (!candidate || typeof candidate !== 'object') return null;
  const bridge = candidate as Partial<CramDesktopBridge>;
  if (
    bridge.isDesktop !== true
    || !isClientCacheBridge(bridge.cache)
    || typeof bridge.openMeetingNotes !== 'function'
  ) {
    return null;
  }
  return bridge as CramDesktopBridge;
}

export function isCramDesktop() {
  return desktopBridge() !== null;
}

export function desktopCacheBridge(): ClientCacheBridge | null {
  return desktopBridge()?.cache || null;
}

export async function openFloatingMeetingNotes(meetingId: number) {
  if (!Number.isInteger(meetingId) || meetingId <= 0) {
    throw new Error('A positive meeting id is required.');
  }
  const bridge = desktopBridge();
  if (!bridge) throw new Error('Floating notes are available in CRAM Desktop.');
  return bridge.openMeetingNotes(meetingId);
}

export function hasClientMeetingNotes() {
  return isCramDesktop() || isCramMobile();
}

export function clientMeetingNotesLabel() {
  return isCramMobile() ? 'Focus Notes' : 'Float Notes';
}

export async function openClientMeetingNotes(meetingId: number) {
  if (isCramMobile()) return openMobileMeetingNotes(meetingId);
  return openFloatingMeetingNotes(meetingId);
}
