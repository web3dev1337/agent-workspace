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

    // Depending on startup state we may be on the dashboard (banner in topbar) or inside a workspace
    // (banner in header). Accept either, but wait for chips to actually render.
    await expect
      .poll(async () => {
        const useDashboard = await dashboardBanner.isVisible().catch(() => false);
        const useHeader = await headerBanner.isVisible().catch(() => false);
        const banner = useDashboard ? dashboardBanner : (useHeader ? headerBanner : null);
        if (!banner) return null;

        const chips = banner.locator('.process-chip');
        const count = await chips.count();
        if (!count) return null;
        const text = await chips.first().textContent().catch(() => '');
        return (text || '').trim();
      }, { timeout: 15000 })
      .toBe('WIP 2');

    const banner = (await dashboardBanner.isVisible().catch(() => false)) ? dashboardBanner : headerBanner;
    await expect(banner).toContainText('T1 1');
    await expect(banner).toContainText('T2 0');
    await expect(banner).toContainText('T3 2');
    await expect(banner).toContainText('T4 0');
  });
});
