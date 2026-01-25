const { test, expect } = require('@playwright/test');
const { mockUserSettings } = require('./_mockUserSettings');

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

test.describe('Workflow Modes', () => {
  test('filters visible tiers and persists selection', async ({ page }) => {
    test.setTimeout(60000);

    await mockUserSettings(page);
    await page.route(/.*\/api\/process\/tasks.*/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ count: 0, tasks: [] })
      });
    });
    await page.route(/.*\/api\/process\/task-records$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ count: 0, records: [] })
      });
    });

    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('/');
    const seeded = await page.evaluate(() => {
      if (!window.orchestrator) return { ok: false, reason: 'no orchestrator' };

      try {
        window.orchestrator?.socket?.disconnect?.();
      } catch {}

      window.orchestrator.updateTerminalGrid = () => {};
      window.orchestrator.buildSidebar = () => {};
      window.orchestrator.showQueuePanel = async () => {};
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
      window.orchestrator.taskRecords.set(`session:${bId}`, { tier: 3 });

      return { ok: true, aId, bId };
    });

    expect(seeded.ok).toBeTruthy();
    expect(seeded.aId).toBeTruthy();
    expect(seeded.bId).toBeTruthy();

    await page.waitForFunction(() => !!window.orchestrator, { timeout: 30000 });
    await dismissFocusOverlay(page);

    // Focus mode (Tier 1–2 only)
    const settingsPut = page.waitForRequest((req) => req.method() === 'PUT' && req.url().includes('/api/user-settings/global'), { timeout: 10000 });
    await page.evaluate(() => window.orchestrator.setWorkflowMode('focus'));
    await settingsPut;
    const focus = await page.evaluate(({ aId, bId }) => ({
      mode: window.orchestrator.workflowMode,
      a: window.orchestrator.isSessionVisibleInCurrentView(aId),
      b: window.orchestrator.isSessionVisibleInCurrentView(bId)
    }), seeded);
    expect(focus).toEqual({ mode: 'focus', a: true, b: false });

    // Background mode (Tier 3–4 only)
    await page.evaluate(() => window.orchestrator.setWorkflowMode('background'));
    const background = await page.evaluate(({ aId, bId }) => ({
      mode: window.orchestrator.workflowMode,
      a: window.orchestrator.isSessionVisibleInCurrentView(aId),
      b: window.orchestrator.isSessionVisibleInCurrentView(bId)
    }), seeded);
    expect(background).toEqual({ mode: 'background', a: false, b: true });

    // Review mode (all tiers)
    await page.evaluate(() => window.orchestrator.setWorkflowMode('review'));
    const review = await page.evaluate(({ aId, bId }) => ({
      mode: window.orchestrator.workflowMode,
      a: window.orchestrator.isSessionVisibleInCurrentView(aId),
      b: window.orchestrator.isSessionVisibleInCurrentView(bId)
    }), seeded);
    expect(review).toEqual({ mode: 'review', a: true, b: true });
  });
});

test.describe('Queue Navigation', () => {
  test('orders unblocked first and supports Next/Prev', async ({ page }) => {
    test.setTimeout(60000);

    await mockUserSettings(page);

    await page.route(/.*\/api\/process\/tasks.*/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 3,
          tasks: [
            {
              id: 'pr:web3dev1337/demo#1',
              kind: 'pr',
              status: 'open',
              title: 'Blocked',
              url: 'https://github.com/web3dev1337/demo/pull/1',
              repository: 'web3dev1337/demo',
              record: { tier: 2, changeRisk: 'medium' },
              dependencySummary: { total: 1, blocked: 1 }
            },
            {
              id: 'pr:web3dev1337/demo#2',
              kind: 'pr',
              status: 'open',
              title: 'Unblocked 1',
              url: 'https://github.com/web3dev1337/demo/pull/2',
              repository: 'web3dev1337/demo',
              record: { tier: 1, changeRisk: 'low' },
              dependencySummary: { total: 0, blocked: 0 }
            },
            {
              id: 'pr:web3dev1337/demo#3',
              kind: 'pr',
              status: 'open',
              title: 'Unblocked 2',
              url: 'https://github.com/web3dev1337/demo/pull/3',
              repository: 'web3dev1337/demo',
              record: { tier: 3, changeRisk: 'low' },
              dependencySummary: { total: 0, blocked: 0 }
            }
          ]
        })
      });
    });

    await page.route(/.*\/api\/process\/task-records\/.+\/dependencies.*/, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ dependencies: [] })
      });
    });

    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('/');
    await ensureWorkspaceLoaded(page);
    await dismissFocusOverlay(page);

    await page.evaluate(() => document.getElementById('queue-btn')?.click());
    await expect(page.locator('#queue-panel')).toBeVisible({ timeout: 10000 });

    await expect(page.locator('#queue-list .task-card-row')).toHaveCount(3);

    const firstTitle = page.locator('#queue-list .task-card-row').first().locator('.task-card-title');
    const lastTitle = page.locator('#queue-list .task-card-row').last().locator('.task-card-title');
    await expect(firstTitle).toHaveText('Unblocked 1');
    await expect(lastTitle).toHaveText('Blocked');

    // Auto-selected first unblocked item.
    const selectedTitle = page.locator('#queue-list .task-card-row.selected .task-card-title');
    await expect(selectedTitle).toHaveText('Unblocked 1');

    await page.locator('#queue-next').click();
    await expect(selectedTitle).toHaveText('Unblocked 2');

    await page.locator('#queue-next').click();
    await expect(selectedTitle).toHaveText('Blocked');

    await page.locator('#queue-prev').click();
    await expect(selectedTitle).toHaveText('Unblocked 2');
  });
});
