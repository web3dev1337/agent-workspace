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

test.describe('Review Workflow', () => {
  test('review preset filters Queue to tier-3 unreviewed', async ({ page }) => {
    test.setTimeout(60000);

    await mockUserSettings(page);

    // Prevent popups from auto diff.
    await page.addInitScript(() => {
      window.open = (...args) => {
        try {
          window.__opened = window.__opened || [];
          window.__opened.push(String(args?.[0] || ''));
        } catch {}
        return null;
      };
    });

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
              title: 'Tier 3 - unreviewed',
              url: 'https://github.com/web3dev1337/demo/pull/1',
              repository: 'web3dev1337/demo',
              record: { tier: 3, changeRisk: 'low' },
              dependencySummary: { total: 0, blocked: 0 }
            },
            {
              id: 'pr:web3dev1337/demo#2',
              kind: 'pr',
              status: 'open',
              title: 'Tier 3 - reviewed',
              url: 'https://github.com/web3dev1337/demo/pull/2',
              repository: 'web3dev1337/demo',
              record: { tier: 3, reviewedAt: '2026-01-01T00:00:00Z', reviewOutcome: 'approved' },
              dependencySummary: { total: 0, blocked: 0 }
            },
            {
              id: 'pr:web3dev1337/demo#3',
              kind: 'pr',
              status: 'open',
              title: 'Tier 2 - unreviewed',
              url: 'https://github.com/web3dev1337/demo/pull/3',
              repository: 'web3dev1337/demo',
              record: { tier: 2 },
              dependencySummary: { total: 0, blocked: 0 }
            }
          ]
        })
      });
    });

    await page.route(/.*\/api\/process\/task-records\/.+\/dependencies.*/, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ dependencies: [] }) });
    });

    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('/');
    await ensureWorkspaceLoaded(page);

    // Open Queue with the same preset used by the Review workflow button.
    await page.evaluate(() => {
      window.orchestrator.queuePanelPreset = { reviewTier: 3, unreviewedOnly: true, autoOpenDiff: true };
      window.orchestrator.showQueuePanel();
    });
    await expect(page.locator('#queue-panel')).toBeVisible({ timeout: 10000 });

    // Preset should activate Q3 + Unreviewed.
    await expect(page.locator('#queue-tier-3.active')).toHaveCount(1);
    await expect(page.locator('#queue-unreviewed.active')).toHaveCount(1);

    // Only the tier-3 unreviewed item should be visible.
    await expect(page.locator('#queue-list .task-card-row')).toHaveCount(1);
    await expect(page.locator('#queue-list .task-card-row .task-card-title')).toHaveText('Tier 3 - unreviewed');
  });
});

test.describe('Focus Mode gating', () => {
  test('hides tier-2 while tier-1 is busy when enabled', async ({ page }) => {
    test.setTimeout(60000);
    await mockUserSettings(page);

    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('/');
    await page.waitForFunction(() => !!window.orchestrator, { timeout: 30000 });

    const seeded = await page.evaluate(() => {
      if (!window.orchestrator) return { ok: false };
      try { window.orchestrator?.socket?.disconnect?.(); } catch {}
      // Prevent any late socket/session events from resetting our seeded state.
      window.orchestrator.socket = { connected: false, emit: () => {} };
      window.orchestrator.updateTerminalGrid = () => {};
      window.orchestrator.buildSidebar = () => {};
      window.orchestrator.sessions = new Map();
      window.orchestrator.visibleTerminals = new Set();
      window.orchestrator.taskRecords = new Map();
      window.orchestrator.loadTaskRecords = async () => {};
      window.orchestrator.viewMode = 'all';

      const t1 = 'demo-work1-claude';
      const t2 = 'demo-work2-claude';
      window.orchestrator.sessions.set(t1, { sessionId: t1, type: 'claude', status: 'busy' });
      window.orchestrator.sessions.set(t2, { sessionId: t2, type: 'claude', status: 'idle' });
      window.orchestrator.visibleTerminals.add(t1);
      window.orchestrator.visibleTerminals.add(t2);
      window.orchestrator.taskRecords.set(`session:${t1}`, { tier: 1 });
      window.orchestrator.taskRecords.set(`session:${t2}`, { tier: 2 });
      window.orchestrator.focusHideTier2WhenTier1Busy = true;
      window.orchestrator.refreshTier1Busy({ suppressRerender: true });
      window.orchestrator.setWorkflowMode('focus');
      return { ok: true, t1, t2, tier1Busy: window.orchestrator.tier1Busy };
    });

    expect(seeded.ok).toBeTruthy();
    expect(seeded.tier1Busy).toBeTruthy();

    const visible = await page.evaluate(({ t1, t2 }) => ({
      t1: window.orchestrator.isSessionVisibleInCurrentView(t1),
      t2: window.orchestrator.isSessionVisibleInCurrentView(t2)
    }), seeded);

    expect(visible).toEqual({ t1: true, t2: false });
  });
});
