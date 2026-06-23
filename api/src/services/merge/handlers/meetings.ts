// Meeting merge handler (first instance of the generic merge framework). Folds
// the SOURCE meeting into the BASE: keep/take scalar fields per the user's
// choices, combine notes, bring over chosen attendees (repointing the join rows),
// then tombstone the source. Non-destructive — the source is soft-deleted, so any
// field/attendee the user didn't pull stays recoverable.
//
// The whole mutation runs inside one withUser() call, which is itself a
// transaction (BEGIN/COMMIT with the RLS user set), so the merge is atomic and
// user-scoped. Reads use the same connection.

import { withUser } from '../../../db/connection.js';
import { badRequest, notFound, conflict } from '../../../lib/http-error.js';
import type { PoolClient } from 'pg';
import type { MergeHandler, MergePlan, MergeChoices } from '../merge.js';

const COLS = 'id, account_id, date, starts_at, ends_at, location, title, filename, body, internal, needs_review, krisp_meeting_id';

function isoOrNull(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export class MeetingMergeHandler implements MergeHandler {
  meetingsService: any;

  constructor({ meetingsService }: { meetingsService?: any } = {}) {
    if (!meetingsService) throw new Error('MeetingMergeHandler requires meetingsService');
    this.meetingsService = meetingsService;
  }

  private async _fetch(client: PoolClient, id: number) {
    return (await client.query(`SELECT ${COLS} FROM meetings WHERE id = $1 AND deleted_at IS NULL`, [id])).rows[0] || null;
  }

  private async _attendees(client: PoolClient, meetingId: number) {
    return (await client.query(
      `SELECT ma.id, ma.contact_id, ma.display_name, ma.email, ma.status, c.full_name
         FROM meeting_attendees ma LEFT JOIN contacts c ON c.id = ma.contact_id
        WHERE ma.meeting_id = $1
        ORDER BY (ma.contact_id IS NULL), c.full_name, ma.display_name`,
      [meetingId]
    )).rows;
  }

  private async _accountName(client: PoolClient, accountId: number | null): Promise<string | null> {
    if (!accountId) return null;
    return (await client.query('SELECT name FROM accounts WHERE id = $1', [accountId])).rows[0]?.name || `#${accountId}`;
  }

  async describe(userId: number, baseId: number, sourceId: number): Promise<MergePlan> {
    return withUser(userId, async (client) => {
      const base = await this._fetch(client, baseId);
      const source = await this._fetch(client, sourceId);
      if (!base) throw notFound(`Base meeting not found: id=${baseId}`);
      if (!source) throw notFound(`Source meeting not found: id=${sourceId}`);

      const baseAtt = await this._attendees(client, baseId);
      const srcAtt = await this._attendees(client, sourceId);
      const item = (a: any) => ({ id: a.id, label: a.full_name || a.display_name || a.email || `attendee #${a.id}` });

      return {
        entity: 'meetings',
        base: { id: base.id, label: base.title || base.filename || `meeting #${base.id}` },
        source: { id: source.id, label: source.title || source.filename || `meeting #${source.id}` },
        fields: [
          { key: 'title', label: 'Title', kind: 'scalar', base: base.title, source: source.title },
          { key: 'date', label: 'Date', kind: 'scalar', base: base.date, source: source.date },
          { key: 'starts_at', label: 'Start time', kind: 'scalar', base: isoOrNull(base.starts_at), source: isoOrNull(source.starts_at) },
          { key: 'ends_at', label: 'End time', kind: 'scalar', base: isoOrNull(base.ends_at), source: isoOrNull(source.ends_at) },
          { key: 'location', label: 'Location', kind: 'scalar', base: base.location, source: source.location },
          { key: 'account_id', label: 'Account', kind: 'scalar', base: await this._accountName(client, base.account_id), source: await this._accountName(client, source.account_id) },
          { key: 'body', label: 'Notes', kind: 'append', base: base.body, source: source.body },
        ],
        collections: [
          { key: 'attendees', label: 'Attendees', base: baseAtt.map(item), source: srcAtt.map(item) },
        ],
      };
    });
  }

  async apply(userId: number, baseId: number, sourceId: number, choices: MergeChoices): Promise<any> {
    const fieldChoices = choices.fields || {};
    const bodyChoice = choices.append?.body || 'both';
    const bring = new Set((choices.collections?.attendees || []).map(Number));

    await withUser(userId, async (client) => {
      const base = await this._fetch(client, baseId);
      const source = await this._fetch(client, sourceId);
      if (!base) throw notFound(`Base meeting not found: id=${baseId}`);
      if (!source) throw notFound(`Source meeting not found: id=${sourceId}`);

      // Scalars default to the base; the user can pull a field from the source.
      const take = (key: string) => (fieldChoices[key] === 'source' ? source[key] : base[key]);
      const nextTitle = take('title');
      const nextDate = take('date');
      const nextStartsAt = take('starts_at');
      const nextEndsAt = take('ends_at');
      const nextLocation = take('location');
      const nextAccountId = take('account_id') ?? null;
      const nextInternal = !nextAccountId; // a meeting with no account is an internal note
      // Notes: 'both' (default) appends source under a separator; else the chosen side.
      const nextBody =
        bodyChoice === 'base' ? base.body :
        bodyChoice === 'source' ? source.body :
        `${(base.body || '').trimEnd()}\n\n---\n\n${source.body || ''}`.trim();
      // Carry a Krisp link onto the survivor so future Krisp events fold in here.
      const nextKrisp = base.krisp_meeting_id || source.krisp_meeting_id || null;

      if (nextInternal && nextAccountId) throw badRequest('An internal meeting cannot keep an account.');

      // Repoint the chosen source attendees onto the base, de-duping by contact
      // (drop a source link the base already has). Unchosen attendees stay on the
      // source and are hidden with its tombstone.
      const srcAtt = await this._attendees(client, sourceId);
      const baseContactIds = new Set((await this._attendees(client, baseId)).filter((a) => a.contact_id).map((a) => Number(a.contact_id)));
      for (const a of srcAtt) {
        if (!bring.has(Number(a.id))) continue;
        if (a.contact_id && baseContactIds.has(Number(a.contact_id))) {
          await client.query('DELETE FROM meeting_attendees WHERE id = $1', [a.id]);
        } else {
          await client.query('UPDATE meeting_attendees SET meeting_id = $2 WHERE id = $1', [a.id, baseId]);
          if (a.contact_id) baseContactIds.add(Number(a.contact_id));
        }
      }

      // Tombstone the source FIRST and clear its krisp id — so moving that krisp id
      // onto the base can't trip the (user, krisp_meeting_id) unique index against
      // a still-live source.
      await client.query('UPDATE meetings SET deleted_at = NOW(), krisp_meeting_id = NULL WHERE id = $1', [sourceId]);

      // Update the survivor. needs_review cleared — a deliberate merge settles it.
      try {
        await client.query(
          `UPDATE meetings
              SET title = $2, date = $3, starts_at = $4, ends_at = $5, location = $6,
                  account_id = $7, internal = $8, body = $9, needs_review = false, krisp_meeting_id = $10
            WHERE id = $1`,
          [baseId, nextTitle, nextDate, nextStartsAt, nextEndsAt, nextLocation, nextInternal ? null : nextAccountId, nextInternal, nextBody, nextKrisp]
        );
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw conflict('Merge would collide on a unique meeting filename for the chosen account. Rename one meeting first, then merge.');
        }
        throw err;
      }
    });

    const merged = await this.meetingsService.getById(userId, baseId);
    return { merged, base_id: baseId, source_id: sourceId, soft_deleted: true };
  }
}
