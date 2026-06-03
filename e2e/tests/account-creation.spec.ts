import { test, expect } from '@playwright/test';
import { uniq, autoAcceptDialogs } from './helpers';

// Journey 3 — Account creation (TEST-SPEC.md §7, Phase 4).
test.describe('Account creation', () => {
  test('create a new account from the Accounts list → lands on its detail page', async ({ page }) => {
    autoAcceptDialogs(page);

    await page.goto('/accounts');
    await page.getByRole('button', { name: '+ New Account' }).click();
    await expect(page.getByRole('heading', { name: 'New Account' })).toBeVisible();

    // Name a fresh account; the modal auto-derives the slug from the name.
    const name = `E2E Account ${Date.now().toString(36)}`;
    await page.getByPlaceholder('Acme Corp').fill(name);
    const slug = await page.getByPlaceholder('acme-corp').inputValue();
    expect(slug).toMatch(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);

    // exact:true — the bare "Create" footer button, not AccountPicker's inline
    // "+ Create new account …" (which contains the substring "Create").
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    // Redirects to /accounts/:slug and the new account renders there.
    await page.waitForURL(new RegExp(`/accounts/${slug}$`));
    await expect(page.getByText(name).first()).toBeVisible();
  });

  test('blocks submit and shows an error when the name is empty', async ({ page }) => {
    autoAcceptDialogs(page);

    await page.goto('/accounts');
    await page.getByRole('button', { name: '+ New Account' }).click();
    await expect(page.getByRole('heading', { name: 'New Account' })).toBeVisible();

    // Submitting with an empty name is blocked client-side before any API call.
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByText('Name is required')).toBeVisible();
    // Modal stays open (no navigation).
    await expect(page.getByRole('heading', { name: 'New Account' })).toBeVisible();
  });
});
