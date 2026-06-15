// Generic merge HTTP surface — object-agnostic "merge two records of the same
// type, choosing what to keep". The entity is a path param dispatched to a
// per-entity handler (see services/merge). Currently: meetings.
//
//   POST /api/merge/:entity/preview  { base_id, source_id }
//       → a MergePlan (both records' fields + relations) for the resolver UI.
//   POST /api/merge/:entity          { base_id, source_id, choices }
//       → applies the merge: base keeps/gains per choices, source is tombstoned.

import type { FastifyInstance } from 'fastify';
import type { MergeService, MergeChoices } from '../../services/merge/merge.js';

interface PreviewBody { base_id: number; source_id: number }
interface ApplyBody { base_id: number; source_id: number; choices?: MergeChoices }

export default async function mergeRoutes(fastify: FastifyInstance, { mergeService }: { mergeService: MergeService }) {
  fastify.post<{ Params: { entity: string }; Body: PreviewBody }>('/merge/:entity/preview', {
    schema: {
      description: 'Preview a merge: returns a plan describing both records — scalar fields (pick base or source), append fields like notes (base|source|both), and collections like attendees (checklist of source items to bring over) — for the resolver UI to render. Does not mutate anything. Supported entities: meetings.',
      tags: ['merge'],
      params: { type: 'object', required: ['entity'], properties: { entity: { type: 'string', description: 'Record type to merge (e.g. "meetings").' } } },
      body: {
        type: 'object',
        required: ['base_id', 'source_id'],
        properties: {
          base_id: { type: 'integer', description: 'The record that survives (the keeper).' },
          source_id: { type: 'integer', description: 'The record to fold in and tombstone.' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      return await mergeService.preview(request.userId, request.params.entity, request.body.base_id, request.body.source_id);
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode) { reply.code(e.statusCode); return { error: e.message }; }
      throw err;
    }
  });

  fastify.post<{ Params: { entity: string }; Body: ApplyBody }>('/merge/:entity', {
    schema: {
      description: 'Apply a merge. The base record keeps its values except where `choices.fields[key]="source"` pulls a field from the source; `choices.append.body` is "base"|"source"|"both" (default "both" appends the source notes); `choices.collections[key]` lists source item ids to bring over (e.g. attendee ids). Omitted choices default to the non-destructive option. The source is soft-deleted (tombstoned, recoverable), and any Krisp link is carried onto the survivor. Returns the merged record. Supported entities: meetings.',
      tags: ['merge'],
      params: { type: 'object', required: ['entity'], properties: { entity: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['base_id', 'source_id'],
        properties: {
          base_id: { type: 'integer', description: 'The record that survives.' },
          source_id: { type: 'integer', description: 'The record to fold in and tombstone.' },
          choices: {
            type: 'object',
            description: 'What to keep from each side. { fields: { <key>: "base"|"source" }, append: { body: "base"|"source"|"both" }, collections: { attendees: [sourceAttendeeId, …] } }. Anything omitted uses the non-destructive default.',
            additionalProperties: true,
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      return await mergeService.apply(request.userId, request.params.entity, request.body.base_id, request.body.source_id, request.body.choices || {});
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode) { reply.code(e.statusCode); return { error: e.message }; }
      throw err;
    }
  });
}
