import {
  isCramMobile,
  openMobileMeetingNotes,
} from './mobile';

type CramDesktopBridge = {
  isDesktop: true;
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
  if (bridge.isDesktop !== true || typeof bridge.openMeetingNotes !== 'function') return null;
  return bridge as CramDesktopBridge;
}

export function isCramDesktop() {
  return desktopBridge() !== null;
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
