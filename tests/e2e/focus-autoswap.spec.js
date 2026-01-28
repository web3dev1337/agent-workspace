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

test.describe('Focus mode auto-swap', () => {
  test('shows Tier 2 only while Tier 1 is busy', async ({ page }) => {
    const t1 = 'demo-work1-claude';
    const t2 = 'demo-work2-claude';

    await page.route(/.*\/api\/process\/task-records$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 2,
          records: [
            { id: `session:${t1}`, record: { tier: 1 } },
            { id: `session:${t2}`, record: { tier: 2 } }
          ]
        })
      });
    });

    await page.goto('/');
    await ensureWorkspaceLoaded(page);
    await page.waitForFunction(() => !!window.orchestrator, { timeout: 10000 });

    // Prevent other tests from broadcasting session updates that would reset our seeded state.
    await page.evaluate(() => {
      try {
        window.orchestrator?.socket?.off?.('sessions');
        window.orchestrator?.socket?.off?.('workspace-changed');
      } catch {}
    });

    await page.evaluate(({ t1, t2 }) => {
      window.orchestrator.showActiveOnly = false;
      window.orchestrator.viewMode = 'all';
      window.orchestrator.tierFilter = 'all';
      window.orchestrator.workflowMode = 'focus';
      window.orchestrator.focusAutoSwapTier2WhenTier1Busy = true;

      window.orchestrator.sessions = new Map([
        [t1, { sessionId: t1, type: 'claude', status: 'busy', branch: 'main', worktreeId: 'work1' }],
        [t2, { sessionId: t2, type: 'claude', status: 'idle', branch: 'main', worktreeId: 'work2' }]
      ]);
      window.orchestrator.visibleTerminals = new Set([t1, t2]);
      window.orchestrator.taskRecords = new Map([
        [`session:${t1}`, { tier: 1 }],
        [`session:${t2}`, { tier: 2 }]
      ]);

      window.orchestrator.refreshTier1Busy({ suppressRerender: true });
      window.orchestrator.updateWorkflowModeButtons();
      window.orchestrator.updateTerminalGrid();
    }, { t1, t2 });

    await expect(page.locator('#wrapper-demo-work2-claude')).toHaveCount(1);
    await expect(page.locator('#wrapper-demo-work1-claude')).toHaveCount(0);

    // Now mark Tier 1 as idle and verify Tier 1 comes back.
    await page.evaluate(({ t1 }) => {
      const session = window.orchestrator.sessions.get(t1);
      window.orchestrator.sessions.set(t1, { ...session, status: 'waiting' });
      window.orchestrator.refreshTier1Busy({ suppressRerender: true });
      window.orchestrator.updateWorkflowModeButtons();
      window.orchestrator.updateTerminalGrid();
    }, { t1 });

    await expect.poll(async () => {
      return await page.locator('#wrapper-demo-work1-claude').count();
    }, { timeout: 10000 }).toBe(1);
  });
});
