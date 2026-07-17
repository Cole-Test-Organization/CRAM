import { test, expect, type Page } from '@playwright/test';
import { SEED } from './helpers';

async function openOrgChart(page: Page) {
  await page.goto(`/accounts/${SEED.acme.slug}`);
  await page.getByText('Org Chart', { exact: true }).click();
  await expect(page.locator('[data-org-chart-panel]')).toBeVisible();
}

for (const viewport of [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 375, height: 812 },
]) {
  test(`org chart separates explicit members from the contact index at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openOrgChart(page);

    const chart = page.locator('[data-org-chart]');
    const index = page.locator('[data-contact-index]');
    await expect(chart.locator('[data-org-node]')).toHaveCount(2);
    await expect(index.locator('[data-contact-index-row]')).toHaveCount(3);

    const chartBeforeIndex = await page.locator('[data-org-chart-panel]').evaluate((panel) => (
      panel.firstElementChild?.hasAttribute('data-org-chart')
      && panel.lastElementChild?.hasAttribute('data-contact-index')
    ));
    expect(chartBeforeIndex).toBe(true);

    const panelFitsViewport = await page.locator('[data-org-chart-panel]').evaluate((panel) => (
      panel.scrollWidth <= panel.clientWidth
    ));
    const pageFitsViewport = await page.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth
    ));
    expect(panelFitsViewport).toBe(true);
    expect(pageFitsViewport).toBe(true);

    await page.getByRole('searchbox', { name: 'Search account contacts' }).fill('Priya');
    await expect(index.locator('[data-contact-index-row]')).toHaveCount(1);
    const priyaRow = index.locator('[data-contact-index-row]').filter({ hasText: 'Priya Shah' });
    await expect(priyaRow).toContainText('Not in chart');
    await expect(priyaRow.getByRole('combobox', { name: 'Placement for Priya Shah' })).toBeVisible();
    await expect(chart.locator('[data-org-node]')).toHaveCount(2);
  });
}
