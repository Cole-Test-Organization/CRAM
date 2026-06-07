// node-postgres serializes JS arrays as native PG array literals, which breaks
// JSONB inserts. Stringify explicitly so Postgres casts text → jsonb. Pass the
// result as the bind parameter for a jsonb column.
export function jsonb(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value);
}
