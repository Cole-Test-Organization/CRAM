import type { JobStatus } from "./types/index.js";

// A provisioning job's `params` JSONB carries the full, self-contained spec the
// DB-claim worker needs to (re-)execute it after a restart: which lifecycle verb,
// against which deployment slug + target, with which resource action and run-time
// toggles. The `action`/`hostname`/`deployment_id` columns mirror the dispatch-
// relevant bits for indexing + joins; `params` is the source of truth.
export interface JobSpec {
  deploymentRef?: string | null;
  resourceAction?: string | null;
  runParams?: Record<string, unknown> | null;
}

// Surface-facing shape (HTTP + MCP). Internal columns (claimed_by/at) are omitted;
// runParams is surfaced as `params`, the deployment slug as `deployment`.
export interface JobView {
  id: string;
  action: string;
  target: string | null;
  deployment: string | null;
  resourceAction: string | null;
  status: JobStatus;
  cancelRequested: boolean;
  params: Record<string, unknown> | null;
  error: string | null;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  logs?: string[];
}

function iso(value: unknown): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export function rowToJobView(row: Record<string, unknown>, logs?: string[]): JobView {
  const spec = (row.params ?? {}) as JobSpec;
  const view: JobView = {
    id: row.id as string,
    action: row.action as string,
    target: (row.hostname as string | null) ?? null,
    deployment: (row.deployment_name as string | null) ?? spec.deploymentRef ?? null,
    resourceAction: spec.resourceAction ?? null,
    status: row.status as JobStatus,
    cancelRequested: Boolean(row.cancel_requested),
    params: spec.runParams ?? null,
    error: (row.error as string | null) ?? null,
    createdAt: iso(row.created_at),
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
  };
  if (logs) view.logs = logs;
  return view;
}
