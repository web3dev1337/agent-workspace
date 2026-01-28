const { test, expect } = require('@playwright/test');

const ensureWorkspaceLoaded = async (page) => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const sidebar = page.locator('.sidebar');
    if (await sidebar.isVisible().catch(() => false)) {
      return;
    }

    await page.waitForFunction(() => window.orchestrator?.socket?.connected === true, {
      timeout: 20000
    });

    const openWorkspaceBtn = page.getByRole('button', { name: 'Open Workspace' }).first();
    try {
      await openWorkspaceBtn.waitFor({ state: 'visible', timeout: 20000 });
    } catch {
      await page.reload();
      continue;
    }

    await openWorkspaceBtn.click();
    try {
      await page.waitForSelector('#recovery-dialog, .sidebar:not(.hidden)', { timeout: 20000 });
    } catch {
      await page.reload();
      continue;
    }

    const recoverySkipBtn = page.locator('#recovery-skip');
    if (await recoverySkipBtn.isVisible().catch(() => false)) {
      await recoverySkipBtn.click();
    }

    await page.waitForSelector('.sidebar:not(.hidden)', { timeout: 20000 });
    return;
  }

  throw new Error('Failed to load workspace for tests.');
};

const dismissFocusOverlay = async (page) => {
  const overlay = page.locator('#focus-overlay.active');
  if (await overlay.isVisible().catch(() => false)) {
    await page.locator('#focus-overlay .focus-close-btn').click();
    await expect(overlay).toBeHidden();
  }
};

test.describe('Commander advice', () => {
  test('shows advice panel with mocked recommendations', async ({ page }) => {
    await page.route('**/api/process/advice**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          generatedAt: '2026-01-26T00:00:00Z',
          mode: 'mine',
          lookbackHours: 24,
          advice: [
            {
              level: 'warn',
              code: 'wip_over_cap',
              title: 'Too many projects in flight',
              message: 'WIP is 5 (cap 3).',
              actions: [{ type: 'ui', action: 'open-queue', label: 'Open Queue' }]
            }
          ]
        })
      });
    });

    await page.goto('/');
    await ensureWorkspaceLoaded(page);
    await dismissFocusOverlay(page);

    // Open Commander panel.
    await page.waitForFunction(() => !!window.orchestrator?.commanderPanel, { timeout: 20000 });
    await page.evaluate(() => window.orchestrator?.commanderPanel?.show?.());
    await expect(page.locator('#commander-panel')).toBeVisible();

    // Open advice.
    await page.locator('#commander-advice').click();
    await expect(page.locator('#commander-advice-panel')).toBeVisible();
    await expect(page.locator('#commander-advice-body')).toContainText('Too many projects in flight');
    await expect(page.locator('#commander-advice-body')).toContainText('WIP is 5 (cap 3).');
  });
});
