// Generic merge framework. The UI and API are object-agnostic — "merge two
// records of the same type, choosing what to keep" — but the per-entity logic
// (which fields exist, which relations to repoint, the uniqueness rules) is NOT
// generic, so each entity registers a MergeHandler. A handler does two things:
//
//   describe(base, source) → a MergePlan the GUI renders as a two-column resolver
//                            (scalar fields = pick base/source; `append` fields
//                            like notes = base|source|both; collections like
//                            attendees = checkboxes to bring over).
//   apply(base, source, choices) → mutate the BASE per the choices, repoint chosen
//                            relations, and soft-delete (tombstone) the source.
//
// The merge is non-destructive: the base survives, the source is tombstoned (not
// hard-deleted) so anything the user didn't pull across stays recoverable.
//
// First (and currently only) handler: meetings. Contacts/accounts can register
// later without touching the route or GUI.

import { badRequest } from '../../lib/http-error.js';

// One scalar/append field shown in the resolver. `kind:'scalar'` → the user keeps
// either side; `kind:'append'` → combinable (notes), choice is base|source|both.
export interface MergePlanField {
  key: string;
  label: string;
  kind: 'scalar' | 'append';
  base: unknown;
  source: unknown;
}

export interface MergePlanCollectionItem {
  id: number | string;
  label: string;
}

// A relation rendered as a checklist — the user ticks which SOURCE items to bring
// onto the base (base items always stay).
export interface MergePlanCollection {
  key: string;
  label: string;
  base: MergePlanCollectionItem[];
  source: MergePlanCollectionItem[];
}

export interface MergePlan {
  entity: string;
  base: { id: number; label: string };
  source: { id: number; label: string };
  fields: MergePlanField[];
  collections: MergePlanCollection[];
}

// What the user chose in the resolver. Anything omitted defaults to the
// non-destructive option (keep base for scalars, append both for notes, bring all
// source items for collections) — the handler decides the defaults.
export interface MergeChoices {
  fields?: Record<string, 'base' | 'source'>;
  append?: Record<string, 'base' | 'source' | 'both'>;
  collections?: Record<string, (number | string)[]>;
}

export interface MergeHandler {
  describe(userId: number, baseId: number, sourceId: number): Promise<MergePlan>;
  apply(userId: number, baseId: number, sourceId: number, choices: MergeChoices): Promise<any>;
}

export class MergeService {
  handlers: Record<string, MergeHandler>;

  constructor(handlers: Record<string, MergeHandler> = {}) {
    this.handlers = handlers;
  }

  entities(): string[] {
    return Object.keys(this.handlers);
  }

  private _handler(entity: string): MergeHandler {
    const h = this.handlers[entity];
    if (!h) throw badRequest(`Unknown merge entity: "${entity}". Supported: ${this.entities().join(', ') || '(none)'}.`);
    return h;
  }

  private _validateIds(baseId: number, sourceId: number) {
    if (!baseId || !sourceId) throw badRequest('Both base_id and source_id are required.');
    if (Number(baseId) === Number(sourceId)) throw badRequest('base_id and source_id must differ — cannot merge a record into itself.');
  }

  // Build the resolver plan: both records' fields/relations, for the GUI to render.
  async preview(userId: number, entity: string, baseId: number, sourceId: number): Promise<MergePlan> {
    this._validateIds(baseId, sourceId);
    return this._handler(entity).describe(userId, Number(baseId), Number(sourceId));
  }

  // Apply the merge: base keeps/gains per `choices`, source is tombstoned.
  async apply(userId: number, entity: string, baseId: number, sourceId: number, choices: MergeChoices): Promise<any> {
    this._validateIds(baseId, sourceId);
    return this._handler(entity).apply(userId, Number(baseId), Number(sourceId), choices || {});
  }
}
