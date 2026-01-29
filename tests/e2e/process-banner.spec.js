const { test, expect } = require('@playwright/test');
const { mockUserSettings } = require('./_mockUserSettings');

test.describe('Process banner', () => {
  test('renders WIP and tiered queue counts', async ({ page }) => {
    test.setTimeout(60000);

    await mockUserSettings(page);

    await page.route(/.*\/api\/process\/task-records$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ count: 0, records: [] })
      });
    });

    await page.route(/.*\/api\/process\/status.*/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          mode: 'mine',
          lookbackHours: 24,
          wip: 2,
          wipKind: 'workspaces',
          wipMax: 3,
          qByTier: { 1: 1, 2: 0, 3: 2, 4: 0, none: 0 },
          q12: 1,
          qTotal: 3,
          qCaps: { q12: 3, q3: 6, q4: 10 },
          level: 'ok',
          reasons: [],
          launchAllowedByTier: { 1: true, 2: true, 3: true, 4: true }
        })
      });
    });

    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('/');

    const dashboardBanner = page.locator('#dashboard-process-banner');
    const headerBanner = page.locator('#process-banner');
    const dashboardStatus = page.locator('#dashboard-status-summary');

    const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

    const getProcessText = async () => {
      const headerChips = await headerBanner.locator('.process-chip').allTextContents().catch(() => []);
      if (headerChips.length) return normalizeText(headerChips.join(' '));

      const headerText = await headerBanner.textContent().catch(() => '');
      if (headerText) return normalizeText(headerText);

      const dashboardChips = await dashboardBanner.locator('.process-chip').allTextContents().catch(() => []);
      if (dashboardChips.length) return normalizeText(dashboardChips.join(' '));

      const dashboardText = await dashboardBanner.textContent().catch(() => '');
      if (dashboardText) return normalizeText(dashboardText);

      const statusText = await dashboardStatus.textContent().catch(() => '');
      return normalizeText(statusText);
    };

    await expect
      .poll(async () => {
        const t = await getProcessText();
        return /WIP\s+2\b/.test(t)
          && /T1\s+1\b/.test(t)
          && /T2\s+0\b/.test(t)
          && /T3\s+2\b/.test(t)
          && /T4\s+0\b/.test(t);
      }, { timeout: 50000 })
      .toBe(true);
  });
});
