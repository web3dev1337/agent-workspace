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

test.describe('Terminal fit guardrails', () => {
  test('does not fit into tiny container during transitions', async ({ page }) => {
    test.setTimeout(60000);

    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('/');
    await ensureWorkspaceLoaded(page);
    await page.waitForFunction(() => !!window.orchestrator?.terminalManager, { timeout: 30000 });

    const sessionId = 'demo-fit-work1-claude';

    await page.evaluate((id) => {
      // Make test independent of back-end PTY resizing.
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
      window.orchestrator.updateTerminalGrid();
    }, sessionId);

    await page.waitForFunction((id) => {
      const wrapper = document.querySelector(`.terminal-wrapper[data-session-id="${id}"]`);
      const terminalEl = wrapper?.querySelector('.terminal') || null;
      const orchestrator = window.orchestrator;
      const session = orchestrator?.sessions?.get?.(id);
      const manager = orchestrator?.terminalManager;
      if (!manager || !session || !terminalEl) return false;
      if (!manager.terminals?.has?.(id)) {
        manager.createTerminal(id, session, terminalEl);
      }
      return manager.terminals.has(id) === true;
    }, sessionId, {
      timeout: 30000
    });

    const initialCols = await page.evaluate((id) => window.orchestrator.terminalManager.terminals.get(id)?.cols || 0, sessionId);
    expect(initialCols).toBeGreaterThan(0);

    // Force the wrapper to a tiny size, then ask the terminal manager to fit.
    const tinyAttempt = await page.evaluate((id) => {
      const wrapper = document.querySelector(`.terminal-wrapper[data-session-id="${id}"]`);
      const body = wrapper?.querySelector('.terminal-body') || null;
      if (!wrapper || !body) return { ok: false };

      wrapper.style.width = '120px';
      wrapper.style.height = '90px';

      const rect = body.getBoundingClientRect();
      window.orchestrator.terminalManager.fitTerminal(id);
      return { ok: true, bodyW: rect.width, bodyH: rect.height };
    }, sessionId);

    expect(tinyAttempt.ok).toBe(true);

    // Give the throttled fit logic a moment; it should refuse to fit and keep cols stable.
    await page.waitForTimeout(300);

    const afterTinyCols = await page.evaluate((id) => window.orchestrator.terminalManager.terminals.get(id)?.cols || 0, sessionId);
    expect(afterTinyCols).toBe(initialCols);

    // Restore normal sizing and ensure we can still fit (no throw).
    const restored = await page.evaluate((id) => {
      const wrapper = document.querySelector(`.terminal-wrapper[data-session-id="${id}"]`);
      if (!wrapper) return false;
      wrapper.style.width = '';
      wrapper.style.height = '';
      window.orchestrator.terminalManager.fitTerminal(id);
      return true;
    }, sessionId);
    expect(restored).toBe(true);
  });
});
