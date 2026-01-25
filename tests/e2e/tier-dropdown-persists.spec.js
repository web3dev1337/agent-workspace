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

test.describe('Tier dropdown persistence', () => {
  test('tier dropdown remains after updateTerminalControls runs', async ({ page }) => {
    test.setTimeout(60000);

    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('/');
    await ensureWorkspaceLoaded(page);

    await page.waitForFunction(() => !!window.orchestrator, { timeout: 30000 });

    const sessionId = 'demo-tierpersist-work1-claude';

    await page.evaluate((id) => {
      window.orchestrator.resizeTerminal = () => {};
      window.orchestrator.sendTerminalInput = () => {};
      window.orchestrator.showActiveOnly = false;
      window.orchestrator.workflowMode = 'review';
      window.orchestrator.viewMode = 'all';
      window.orchestrator.tierFilter = 'all';
      window.orchestrator.sessions = new Map([
        [id, { sessionId: id, type: 'claude', status: 'busy', branch: 'main', worktreeId: 'work1' }]
      ]);
      window.orchestrator.visibleTerminals = new Set([id]);
      window.orchestrator.taskRecords = new Map([[`session:${id}`, { tier: 2 }]]);
      window.orchestrator.updateTerminalGrid();
    }, sessionId);

    const tierSelect = page.locator(`select.tier-dropdown[data-session-id="${sessionId}"]`);
    await expect(tierSelect).toHaveCount(1, { timeout: 10000 });

    // Force a controls refresh (this previously removed the tier dropdown).
    await page.evaluate((id) => window.orchestrator.updateTerminalControls(id), sessionId);

    await expect(tierSelect).toHaveCount(1, { timeout: 10000 });
  });
});

