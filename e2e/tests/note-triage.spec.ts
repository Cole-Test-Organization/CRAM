import { test, expect } from '@playwright/test';
import { SEED, uniq, createParkedNote, autoAcceptDialogs } from './helpers';

// Journey 4 — Internal-note triage (TEST-SPEC.md §7). A parked, account-less
// note (needs_review) is resolved either by assigning it to an account or by
// confirming it as internal. The fixture is arranged via the API; the triage
// itself is driven in the browser.
test.describe('Internal-note triage', () => {
  test('assign a parked account-less note to an account → review flag clears', async ({ page, request }) => {
    autoAcceptDialogs(page);

    const note = await createParkedNote(request, {
      title: uniq('e2e-parked'),
      body: '# Parked note\n\nImporter could not place this — needs triage.',
    });

    await page.goto(`/meetings/${note.id}`);
    // Scenario A: account-less parked note.
    await expect(page.getByText("This note isn't assigned to an account.")).toBeVisible();
    await expect(page.getByText('Needs review')).toBeVisible();

    // Assign it to a seeded account via the triage AccountPicker.
    await page.getByRole('button', { name: 'Search for an account...' }).click();
    await page.getByPlaceholder('Search accounts...').fill(SEED.riverstone.name);
    await page.getByTestId('account-option').filter({ hasText: SEED.riverstone.name }).first().click();
    await page.getByRole('button', { name: 'Assign account' }).click();

    // The note is now placed → review flag + triage panel are gone.
    await expect(page.getByText("This note isn't assigned to an account.")).toBeHidden();
    await expect(page.getByText('Needs review')).toBeHidden();
  });

  test('keep a parked note as internal → review flag clears, stays internal', async ({ page, request }) => {
    autoAcceptDialogs(page);

    const note = await createParkedNote(request, {
      title: uniq('e2e-parked-internal'),
      body: '# Parked internal note\n\nActually an internal note — keep it.',
    });

    await page.goto(`/meetings/${note.id}`);
    await expect(page.getByText("This note isn't assigned to an account.")).toBeVisible();

    await page.getByRole('button', { name: 'Keep as internal' }).click();

    // Flag clears, panel disappears, and it remains an internal note.
    await expect(page.getByText("This note isn't assigned to an account.")).toBeHidden();
    await expect(page.getByText('Needs review')).toBeHidden();
    await expect(page.getByText('Internal').first()).toBeVisible();
  });
});
