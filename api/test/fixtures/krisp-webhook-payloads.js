// A real Krisp webhook payload, captured verbatim from a live "Send sample note"
// delivery (the note_generated trigger). Mirrors fixtures/google-drive-zip.js: a
// builder producing realistic input so the importer is tested against the EXACT
// shape Krisp sends — nested under `data`, the emoji title, Krisp's pre-rendered
// `raw_content` markdown, and the fields we deliberately ignore
// (speakers / participants / calendar_event_id). Overridable bits (event id,
// meeting id, event type, start/end, content) let each test use a unique key and
// a collision-free time window.
//
// note_generated is the verbatim captured shape; transcript_generated /
// outline_generated reuse the same envelope (only `event` + `raw_content` differ)
// — model them on this until a real one of each is captured.

const REAL_RAW_CONTENT = `## Action Items
- [ ]  Try Krisp in the next meeting and review the generated notes. - Alice Smith - Due: 2026-06-14T23:00:00.000Z
- [ ]  Share the meeting summary with the team after the call. - Bob Johnson - Due: 2026-06-15T23:00:00.000Z

## Key Points
- Bob introduces Krisp and its important features.
- Krisp automatically transcribes and records meetings.
- AI-generated summaries provide quick, shareable meeting notes and action items.
- Krisp is compatible with any calling app, allowing centralized meeting knowledge.
- Anna is excited and eager to try Krisp immediately.
- Bob encourages Anna to use Krisp in her next meeting to see its benefits firsthand.

## Outline
**Krisp overview**
Bob explains how Krisp records, transcribes, and summarizes meetings automatically.
**Next steps**
Anna plans to try Krisp in an upcoming meeting and use the generated notes for follow-up.`;

export const KRISP_REAL_RAW_CONTENT = REAL_RAW_CONTENT;

export function krispWebhookPayload({
  eventId = '019ec3606ce5754e831748294975243c',
  event = 'note_generated',
  meetingId = '019ec3606cdd735f912ac170db9e392a',
  title = 'Hey 👋 Let’s get started with Krisp!',
  start = '2026-06-13T23:00:00.000Z',
  end = '2026-06-13T23:01:15.000Z',
  rawContent = REAL_RAW_CONTENT,
} = {}) {
  return {
    id: eventId,
    event,
    data: {
      meeting: {
        id: meetingId,
        title,
        url: `https://app.krisp.ai/n/${meetingId}`,
        start_date: start,
        end_date: end,
        duration: 75,
        // We ignore these, but they ARE in the real payload — keeping them means
        // the parser is exercised against the true shape (and proves we don't
        // accidentally key on / import an email).
        speakers: [
          { index: 0, id: 'demo-speaker-bob', email: 'bob@example.com', first_name: 'Bob', last_name: 'Johnson' },
          { index: 1, id: 'demo-speaker-alice', email: 'alice@example.com', first_name: 'Alice', last_name: 'Smith' },
        ],
        participants: [
          { id: 'demo-participant-alice', email: 'alice@example.com', first_name: 'Alice', last_name: 'Smith' },
          { id: 'demo-participant-bob', email: 'bob@example.com', first_name: 'Bob', last_name: 'Johnson' },
        ],
        calendar_event_id: 'demo-calendar-event-getting-started',
      },
      template: { id: 'demo-template-getting-started', name: 'Getting Started' },
      sections: {
        action_items: [
          { id: 'demo-action-item-try-krisp', title: 'Try Krisp in the next meeting and review the generated notes.', assignee: { id: 'demo-participant-alice', email: 'alice@example.com', first_name: 'Alice', last_name: 'Smith' }, due_date: '2026-06-14T23:00:00.000Z', priority: 'high', completed: false },
          { id: 'demo-action-item-share-notes', title: 'Share the meeting summary with the team after the call.', assignee: { id: 'demo-participant-bob', email: 'bob@example.com', first_name: 'Bob', last_name: 'Johnson' }, due_date: '2026-06-15T23:00:00.000Z', priority: 'medium', completed: false },
        ],
        key_points: [{ description: 'Bob introduces Krisp and its important features.', id: 'aaac4d0e975e4eb88e8f135c1ae1fddd' }],
        outline: [
          { id: 'demo-outline-introduction', title: 'Krisp overview', description: 'Bob explains how Krisp records, transcribes, and summarizes meetings automatically.' },
          { id: 'demo-outline-next-steps', title: 'Next steps', description: 'Anna plans to try Krisp in an upcoming meeting and use the generated notes for follow-up.' },
        ],
      },
      raw_meeting: '**Hey 👋 Let’s get started with Krisp!**\n🕞 Started at 11:00 PM on 13 Jun, lasted 1m',
      raw_content: rawContent,
    },
  };
}
