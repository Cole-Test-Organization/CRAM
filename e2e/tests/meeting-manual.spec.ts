import { test, expect } from '@playwright/test';
import { SEED, uniq, autoAcceptDialogs } from './helpers';

// Journey 1 — Create a meeting (manual) → type notes → save (TEST-SPEC.md §7).
// Also exercises the meeting EDIT path (PUT /api/meetings/:id with starts_at /
// ends_at = null), which is the exact client/server contract the null-times
// backend regression (§1) guards — end-to-end through a real browser this time.
test.describe('Manual meeting → notes → save', () => {
  test('create a manual meeting (account + attendee + notes), then edit the notes', async ({ page }) => {
    autoAcceptDialogs(page);

    await page.goto('/meetings');
    await page.getByRole('button', { name: '+ New Meeting' }).click();
    await expect(page.getByRole('heading', { name: 'New Meeting' })).toBeVisible();

    // Pick a seeded account: open the picker → search → click the option.
    await page.getByRole('button', { name: 'Select account...' }).click();
    await page.getByPlaceholder('Search accounts...').fill(SEED.acme.name);
    await page.getByTestId('account-option').filter({ hasText: SEED.acme.name }).first().click();

    // The attendee picker loads the account's contacts once it's chosen — pick one.
    const attendee = page.getByTestId('attendee-option').first();
    await expect(attendee).toBeVisible();
    await attendee.getByRole('checkbox').check();

    // Type the notes + a unique title.
    const title = uniq('e2e-manual');
    const noteMarker = `E2E manual meeting ${uniq('note')}`;
    await page.getByPlaceholder('prisma-access-demo').fill(title);
    await page.getByPlaceholder('Meeting notes (markdown)').fill(`# ${noteMarker}\n\n- created via the manual journey`);

    // Save → redirect to the new meeting; title + notes render.
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForURL(/\/meetings\/\d+$/);
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.getByText(noteMarker)).toBeVisible();

    // ── "type notes → save", round 2: Edit the meeting, change the notes, Save.
    // The edit submits PUT with starts_at:null/ends_at:null (no time set) — the
    // null-times contract. A red 400 here would mean the server schema regressed.
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Edit Meeting' })).toBeVisible();

    const editedMarker = `EDITED-${uniq('marker')}`;
    await page.getByPlaceholder('Meeting notes (markdown)').fill(`# Updated notes\n\n${editedMarker}`);
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Edit Meeting' })).toBeHidden();
    await expect(page.getByText(editedMarker)).toBeVisible();
  });
});
