const { test, expect } = require('@playwright/test');

const ensureWorkspaceLoaded = async (page) => {
  const sidebar = page.locator('.sidebar');
  if (await sidebar.isVisible().catch(() => false)) {
    return;
  }

  await page.waitForFunction(() => window.orchestrator?.socket?.connected === true, {
    timeout: 10000
  });

  const openWorkspaceBtn = page.getByRole('button', { name: 'Open Workspace' }).first();
  if (await openWorkspaceBtn.count() === 0) {
    throw new Error('No workspace available to open for tests.');
  }

  await openWorkspaceBtn.click();
  await page.waitForSelector('#recovery-dialog, .sidebar:not(.hidden)', { timeout: 10000 });

  const recoverySkipBtn = page.locator('#recovery-skip');
  if (await recoverySkipBtn.isVisible().catch(() => false)) {
    await recoverySkipBtn.click();
  }

  await page.waitForSelector('.sidebar:not(.hidden)', { timeout: 10000 });
};

const dismissFocusOverlay = async (page) => {
  const overlay = page.locator('#focus-overlay.active');
  if (await overlay.isVisible().catch(() => false)) {
    await page.locator('#focus-overlay .focus-close-btn').click();
    await expect(overlay).toBeHidden();
  }
};

test.describe('Tasks Panel', () => {
  test('should open Tasks panel from header', async ({ page }) => {
    await page.goto('/');
    await ensureWorkspaceLoaded(page);
    await dismissFocusOverlay(page);

    const tasksBtn = page.locator('#tasks-btn');
    await expect(tasksBtn).toHaveCount(1);

    const providersReqPromise = page.waitForRequest((req) => req.url().includes('/api/tasks/providers'), { timeout: 10000 });

    await page.evaluate(() => document.getElementById('tasks-btn')?.click());
    await expect(page.locator('#tasks-panel')).toBeVisible({ timeout: 10000 });

    const providersReq = await providersReqPromise.catch(() => null);
    if (providersReq) {
      const origin = new URL(page.url()).origin;
      expect(providersReq.url().startsWith(`${origin}/api/tasks/providers`)).toBeTruthy();
    }

    // Default filter should not hide older cards.
    await expect(page.locator('#tasks-updated input[name=\"tasks-updated\"][value=\"any\"]')).toBeChecked();

    // View toggle exists (List/Board)
    await expect(page.locator('#tasks-view-list')).toBeVisible();
    await expect(page.locator('#tasks-view-board')).toBeVisible();
    await expect(page.locator('#tasks-sort')).toBeVisible();
    await expect(page.locator('#tasks-sort input[name=\"tasks-sort\"][value=\"pos\"]')).toBeChecked();
    await expect(page.locator('#tasks-hide-empty')).toBeVisible();

    // If Trello isn't configured, show a hint (most CI/test environments).
    const hint = page.locator('#tasks-panel .tasks-config-hint');
    const boardSelect = page.locator('#tasks-board');

    // Wait until either hint appears OR boards select is populated OR an error is shown.
    await Promise.race([
      hint.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null),
      boardSelect.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null),
      page.locator('#tasks-panel .no-ports').waitFor({ state: 'visible', timeout: 5000 }).catch(() => null),
    ]);

    // In configured environments, boards should eventually load (have >1 option due to placeholder).
    // In unconfigured environments, the hint should be present.
    const hintVisible = await hint.isVisible().catch(() => false);
    if (!hintVisible) {
      await expect(boardSelect).toBeVisible();
    }
  });
});
