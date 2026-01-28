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

    const getProcessText = async () => {
      const headerChips = await headerBanner.locator('.process-chip').allTextContents().catch(() => []);
      if (headerChips.length) return headerChips.join(' ');

      const dashboardChips = await dashboardBanner.locator('.process-chip').allTextContents().catch(() => []);
      if (dashboardChips.length) return dashboardChips.join(' ');

      const statusText = await dashboardStatus.textContent().catch(() => '');
      return String(statusText || '');
    };

    await expect
      .poll(async () => {
        const t = await getProcessText();
        return /WIP\s+2\b/.test(t)
          && /T1\s+1\b/.test(t)
          && /T2\s+0\b/.test(t)
          && /T3\s+2\b/.test(t)
          && /T4\s+0\b/.test(t);
      }, { timeout: 30000 })
      .toBe(true);
  });
});
