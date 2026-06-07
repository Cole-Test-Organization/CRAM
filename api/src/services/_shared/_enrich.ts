// Enrichment helpers shared across the find-or-create services (contacts,
// accounts, vendor_products …). Kept dependency-free so any service can pull
// just the piece it needs.

// "Blank" = nothing worth keeping: null, undefined, or whitespace-only string.
// Non-string values (numbers, booleans, arrays) are considered present.
function isBlank(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === 'string') return v.trim() === '';
  return false;
}

type Row = Record<string, unknown>;

// Fill-only enrich: build the patch that copies a field from `incoming` into
// `existing` ONLY when the incoming value is present AND the existing value is
// blank. Never overwrites a non-blank stored value — machine/ingestion data
// fills gaps but can't clobber curated data, which keeps the operation
// idempotent and order-independent.
//
//   existing  — the row already in the DB (object of column → value)
//   incoming  — the candidate data we just received
//   fields    — explicit allow-list of columns eligible for enrichment.
//               Identity/key columns (slug, kind, the match key …) belong
//               OUT of this list so they're never silently rewritten.
//
// Returns { patch, fields }: `patch` is the (possibly empty) column→value map
// to UPDATE; `fields` is the list of column names it would fill. An empty
// `fields` means there's nothing to write — callers should skip the UPDATE.
export function fillBlanks(
  existing: Row | null | undefined,
  incoming: Row | null | undefined,
  fields: string[],
): { patch: Row; fields: string[] } {
  const patch: Row = {};
  const filled: string[] = [];
  for (const col of fields) {
    const next = incoming?.[col];
    if (isBlank(next)) continue;          // nothing new to contribute
    if (!isBlank(existing?.[col])) continue; // already have something — keep it
    patch[col] = typeof next === 'string' ? next.trim() : next;
    filled.push(col);
  }
  return { patch, fields: filled };
}
