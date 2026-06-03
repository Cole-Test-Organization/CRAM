import { expect, type APIRequestContext, type Page } from '@playwright/test';

// ── Deterministic seed fixtures (dev/scripts/seed-dev-data.js) ──────────────
// Concrete, guaranteed-present entities. E2E asserts on NAMED entities — never
// on the date-relative meeting dates or exact row counts (that's the backend
// suite's job; see TEST-SPEC.md §5/§6).
export const SEED = {
  // Customer accounts (status='account').
  acme: { slug: 'acme-manufacturing', name: 'Acme Manufacturing' },
  riverstone: { slug: 'riverstone-health', name: 'Riverstone Health System' },
  // A channel partner (status='partner').
  cdw: { slug: 'cdw', name: 'CDW' },
} as const;

// Today's LOCAL date as YYYY-MM-DD — matches the meeting modal's default and the
// API's `date` contract. (Date is fine in a Playwright test; only the Workflow
// sandbox forbids it.)
export function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// A run-unique token so re-runs and Playwright retries never collide on the
// API's uniqueness guards (meeting filename, account slug → 409 on a dupe).
export function uniq(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`;
}

// Arrange a parked, account-less note awaiting triage — the realistic state the
// triage UI exists to resolve (an importer/agent couldn't confidently place a
// note). internal=true + no account ⇒ account-less; needs_review=true ⇒ parked.
// Created straight through the API; acting on it happens in the browser.
export async function createParkedNote(
  request: APIRequestContext,
  fields: { title: string; body: string },
): Promise<{ id: number; title: string; needs_review: boolean }> {
  const res = await request.post('/api/meetings', {
    data: {
      internal: true,
      needs_review: true,
      date: today(),
      title: fields.title,
      body: fields.body,
    },
  });
  expect(res.ok(), `arrange parked note failed (HTTP ${res.status()})`).toBeTruthy();
  return res.json();
}

// Auto-accept any native dialog (window.confirm / beforeunload). The unsaved-
// changes guard and the triage "Make internal" flow use confirm(); our happy
// paths don't trip them, but registering this keeps a stray dialog from hanging
// a run. Playwright otherwise auto-DISMISSES dialogs, which we don't want.
export function autoAcceptDialogs(page: Page): void {
  page.on('dialog', (d) => d.accept().catch(() => {}));
}
