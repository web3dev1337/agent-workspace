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
  await page.evaluate(() => {
    try {
      window.orchestrator?.unfocusTerminal?.();
    } catch {}
  });
};

test.describe('Tier Filters', () => {
  test('shows tier badges and filters sidebar', async ({ page }) => {
    test.setTimeout(60000);
    await page.route(/.*\/api\/process\/task-records$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ count: 0, records: [] })
      });
    });

    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('/');
    await page.waitForFunction(() => !!window.orchestrator, { timeout: 30000 });
    await dismissFocusOverlay(page);

    const ids = await page.evaluate(() => {
      try {
        window.orchestrator?.socket?.disconnect?.();
      } catch {}

      window.orchestrator.updateTerminalGrid = () => {};
      window.orchestrator.buildSidebar = () => {};
      window.orchestrator.currentWorkspace = null;
      window.orchestrator.sessions = new Map();
      window.orchestrator.visibleTerminals = new Set();
      window.orchestrator.taskRecords = new Map();

      const aId = 'demo-work1-claude';
      const bId = 'demo-work2-claude';
      window.orchestrator.sessions.set(aId, { sessionId: aId, type: 'claude', status: 'idle', branch: 'main', worktreeId: 'work1' });
      window.orchestrator.sessions.set(bId, { sessionId: bId, type: 'claude', status: 'idle', branch: 'main', worktreeId: 'work2' });
      window.orchestrator.visibleTerminals.add(aId);
      window.orchestrator.visibleTerminals.add(bId);

      window.orchestrator.taskRecords.set(`session:${aId}`, { tier: 1 });
      window.orchestrator.taskRecords.set(`session:${bId}`, { tier: 2 });

      return { aId, bId };
    });

    expect(ids.aId).toBeTruthy();
    expect(ids.bId).toBeTruthy();

    await page.evaluate(() => window.orchestrator.setTierFilter('1'));
    const focusVisible = await page.evaluate(({ aId, bId }) => ({
      a: window.orchestrator.isSessionVisibleInCurrentView(aId),
      b: window.orchestrator.isSessionVisibleInCurrentView(bId)
    }), ids);
    expect(focusVisible).toEqual({ a: true, b: false });

    await page.evaluate(() => window.orchestrator.setTierFilter('all'));
    const allVisible = await page.evaluate(({ aId, bId }) => ({
      a: window.orchestrator.isSessionVisibleInCurrentView(aId),
      b: window.orchestrator.isSessionVisibleInCurrentView(bId)
    }), ids);
    expect(allVisible).toEqual({ a: true, b: true });
  });
});
