import { test, expect } from '@playwright/test';
import { uniq, autoAcceptDialogs } from './helpers';

// Journey 2 — From-emails flow (TEST-SPEC.md §7). Paste a calendar-invite
// attendee list → resolve it (deterministic, no LLM) → pick the account
// candidate → create the meeting + account + contacts in one shot.
test.describe('Meeting from emails', () => {
  test('resolve a fresh email list → new account candidate → create the meeting', async ({ page }) => {
    autoAcceptDialogs(page);

    await page.goto('/meetings');
    await page.getByRole('button', { name: '+ New Meeting' }).click();
    await expect(page.getByRole('heading', { name: 'New Meeting' })).toBeVisible();

    // Switch the source from Manual to From emails.
    await page.getByRole('button', { name: 'From emails', exact: true }).click();

    // Two attendees on a brand-new external domain ⇒ exactly one "New" account
    // candidate, auto-selected as primary. Fresh domain each run avoids dupes.
    const token = Date.now().toString(36);
    const domain = `e2e${token}.example`;
    const emails = `Pat Lee <pat.lee@${domain}>, Robin Fox <robin.fox@${domain}>`;
    await page.getByPlaceholder(/gnistor@hph\.care/).fill(emails);
    await page.getByRole('button', { name: 'Resolve', exact: true }).click();

    // The new primary candidate exposes an editable account name — name it.
    const accountName = `E2E Emails Co ${token}`;
    const nameInput = page.getByPlaceholder('New account name');
    await expect(nameInput).toBeVisible();
    await nameInput.fill(accountName);

    // Notes are required and rendered in both modes. (Leave "Research?" off so no
    // LinkedIn enrichment is enqueued.)
    const noteMarker = `From-emails meeting ${uniq('note')}`;
    await page.getByPlaceholder('Meeting notes (markdown)').fill(`# ${noteMarker}\n\n- resolved ${domain}`);

    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForURL(/\/meetings\/\d+$/);
    await expect(page.getByText(noteMarker)).toBeVisible();
  });
});
