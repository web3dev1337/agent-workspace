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
    await ensureWorkspaceLoaded(page);
    await dismissFocusOverlay(page);

    await page.waitForSelector('#worktree-list .worktree-item', { timeout: 30000 });
    await page.waitForFunction(() => window.orchestrator?.sessions?.size > 0, { timeout: 30000 });

    const seeded = await page.evaluate(() => {
      const sessions = Array.from(window.orchestrator.sessions.entries()).map(([id, s]) => ({ id, ...s }));
      const claudeSessions = sessions.filter((s) => (s.type === 'claude' || String(s.id).includes('-claude')));
      if (claudeSessions.length < 2) return { ok: false, reason: 'not enough claude sessions' };

      // Find two sessions that are likely in different worktrees.
      let a = null;
      let b = null;
      for (let i = 0; i < claudeSessions.length; i++) {
        for (let j = i + 1; j < claudeSessions.length; j++) {
          const si = claudeSessions[i];
          const sj = claudeSessions[j];
          const wi = si.worktreeId || String(si.id).split('-')[0];
          const wj = sj.worktreeId || String(sj.id).split('-')[0];
          if (wi !== wj) {
            a = si;
            b = sj;
            break;
          }
        }
        if (a && b) break;
      }

      a = a || claudeSessions[0];
      b = b || claudeSessions[1];

      window.orchestrator.taskRecords.set(`session:${a.id}`, { tier: 1 });
      window.orchestrator.taskRecords.set(`session:${b.id}`, { tier: 2 });
      window.orchestrator.buildSidebar();

      return { ok: true };
    });

    expect(seeded).toEqual({ ok: true });

    await expect(page.locator('.worktree-tier-badge.tier-1')).toHaveCount(1);
    await expect(page.locator('.worktree-tier-badge.tier-2')).toHaveCount(1);

    await page.locator('.filter-toggle-tier button', { hasText: 'Q1' }).click();
    await expect(page.locator('.worktree-tier-badge.tier-1')).toHaveCount(1);
    await expect(page.locator('.worktree-tier-badge.tier-2')).toHaveCount(0);

    await page.locator('.filter-toggle-tier button', { hasText: 'All' }).click();
    await expect(page.locator('.worktree-tier-badge.tier-2')).toHaveCount(1);
  });
});
