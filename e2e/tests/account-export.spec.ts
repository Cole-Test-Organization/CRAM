import { test, expect } from '@playwright/test';
import { SEED } from './helpers';

for (const viewport of [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 375, height: 812 },
]) {
  test(`account Drive export downloads without hiding or overflowing at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(`/accounts/${SEED.acme.slug}`);

    const exportLink = page.getByRole('link', { name: 'Export for Drive' });
    await expect(exportLink).toBeVisible();
    await expect(exportLink).toBeInViewport();
    await expect(exportLink).toHaveAttribute('href', `/api/export/accounts/${SEED.acme.slug}`);
    await expect(exportLink).toHaveAttribute('download', `${SEED.acme.slug}-google-drive.zip`);

    const pageFitsViewport = await page.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth
    ));
    expect(pageFitsViewport).toBe(true);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      exportLink.click(),
    ]);
    expect(download.suggestedFilename()).toBe(`${SEED.acme.slug}-google-drive.zip`);
    expect(await download.path()).not.toBeNull();
    await expect(page).toHaveURL(`/accounts/${SEED.acme.slug}`);
  });

  test(`Import / Export downloads a selected Drive bundle at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/import-export');

    await page.getByRole('checkbox', { name: new RegExp(SEED.acme.name, 'i') }).check();
    await page.getByRole('checkbox', { name: new RegExp(SEED.riverstone.name, 'i') }).check();

    const driveButton = page.getByRole('button', { name: 'Export 2 for Drive' });
    const jsonButton = page.getByRole('button', { name: 'Export 2 as JSON' });
    await driveButton.scrollIntoViewIfNeeded();
    await expect(driveButton).toBeVisible();
    await expect(driveButton).toBeInViewport();
    await expect(jsonButton).toBeVisible();

    const pageFitsViewport = await page.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth
    ));
    expect(pageFitsViewport).toBe(true);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      driveButton.click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^accounts-google-drive-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(await download.path()).not.toBeNull();
    await expect(page).toHaveURL('/import-export');
  });
}
