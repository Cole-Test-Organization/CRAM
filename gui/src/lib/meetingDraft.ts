export const MEETING_DRAFT_VERSION = 1;
export const MEETING_DRAFT_PREFIX = 'cram.desktop.meeting-draft.v1:';

export type MeetingDraft = {
  version: 1;
  meetingId: number;
  body: string;
  baseUpdatedAt: string | null;
  savedAt: string;
};

function localDraftStorage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

export function meetingDraftKey(meetingId: number) {
  return `${MEETING_DRAFT_PREFIX}${meetingId}`;
}

export function loadMeetingDraft(
  meetingId: number,
  storage: Storage | null = localDraftStorage(),
): MeetingDraft | null {
  if (!storage || !Number.isInteger(meetingId) || meetingId <= 0) return null;
  try {
    const parsed = JSON.parse(storage.getItem(meetingDraftKey(meetingId)) || 'null');
    if (
      parsed?.version !== MEETING_DRAFT_VERSION
      || parsed?.meetingId !== meetingId
      || typeof parsed?.body !== 'string'
      || typeof parsed?.savedAt !== 'string'
      || Number.isNaN(Date.parse(parsed.savedAt))
      || (parsed.baseUpdatedAt !== null && typeof parsed.baseUpdatedAt !== 'string')
    ) {
      return null;
    }
    return parsed as MeetingDraft;
  } catch {
    return null;
  }
}

export function saveMeetingDraft(
  meetingId: number,
  body: string,
  baseUpdatedAt: string | null,
  storage: Storage | null = localDraftStorage(),
  now = new Date(),
): MeetingDraft | null {
  if (!storage || !Number.isInteger(meetingId) || meetingId <= 0) return null;
  const draft: MeetingDraft = {
    version: MEETING_DRAFT_VERSION,
    meetingId,
    body,
    baseUpdatedAt,
    savedAt: now.toISOString(),
  };
  storage.setItem(meetingDraftKey(meetingId), JSON.stringify(draft));
  return draft;
}

export function clearMeetingDraft(
  meetingId: number,
  storage: Storage | null = localDraftStorage(),
) {
  storage?.removeItem(meetingDraftKey(meetingId));
}
