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

test.describe('Queue reviewer spawn', () => {
  test('emits add-worktree-sessions when spawning reviewer for PR', async ({ page }) => {
    // Mock a single PR item in the Queue.
    await page.route(/.*\/api\/process\/tasks.*/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 1,
          tasks: [
            {
              id: 'pr:web3dev1337/mock-repo#12',
              kind: 'pr',
              status: 'open',
              title: 'Mock PR',
              url: 'https://github.com/web3dev1337/mock-repo/pull/12',
              repository: 'web3dev1337/mock-repo',
              prNumber: 12,
              updatedAt: '2026-01-25T00:00:00Z',
              record: { tier: 3, changeRisk: 'low' },
              dependencySummary: { total: 0, blocked: 0 }
            }
          ]
        })
      });
    });

    // Dependencies endpoint is called when rendering the detail pane.
    await page.route(/.*\/api\/process\/task-records\/.+\/dependencies.*/, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'pr:web3dev1337/mock-repo#12',
          dependencies: []
        })
      });
    });

    // Mock repo scan so the reviewer can locate a local repo.
    await page.route('**/api/workspaces/scan-repos**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            name: 'mock-repo',
            path: '/home/test/GitHub/games/hytopia/mock-repo',
            relativePath: 'games/hytopia/mock-repo',
            type: 'hytopia-game',
            category: 'Hytopia Games',
            worktreeDirs: [
              { id: 'work99', path: '/home/test/GitHub/games/hytopia/mock-repo/work99', number: 99, lastModifiedMs: 1 }
            ]
          }
        ])
      });
    });

    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('/');
    await ensureWorkspaceLoaded(page);
    await dismissFocusOverlay(page);

    // Make the environment deterministic: use a minimal mixed-repo workspace and
    // clear any sessions loaded from disk so worktree selection is stable.
    await page.evaluate(() => {
      if (window.orchestrator) {
        window.orchestrator.sessions = new Map();
        window.orchestrator.currentWorkspace = {
          id: 'test-workspace',
          name: 'Test Workspace',
          workspaceType: 'mixed-repo',
          terminals: [],
          repository: null
        };
      }
    });

    // Capture socket emits.
    await page.evaluate(() => {
      window.__capturedEmits = [];
      const sock = window.orchestrator?.socket;
      const original = sock?.emit?.bind(sock);
      if (!sock || !original) return;
      sock.emit = (event, payload) => {
        window.__capturedEmits.push({ event, payload });
        return original(event, payload);
      };
    });

    // Spawn reviewer via method directly (less flaky than relying on modal click timing).
    await page.evaluate(async () => {
      await window.orchestrator.spawnReviewAgentForPRTask({
        id: 'pr:web3dev1337/mock-repo#12',
        kind: 'pr',
        url: 'https://github.com/web3dev1337/mock-repo/pull/12',
        repository: 'web3dev1337/mock-repo',
        prNumber: 12
      }, { tier: 3, agentId: 'claude', mode: 'fresh', yolo: true });
    });

    // Verify add-worktree-sessions emit.
    await expect.poll(async () => {
      return await page.evaluate(() => (window.__capturedEmits || []).filter(e => e.event === 'add-worktree-sessions').length);
    }, { timeout: 5000 }).toBeGreaterThan(0);

    const last = await page.evaluate(() => {
      const events = (window.__capturedEmits || []).filter(e => e.event === 'add-worktree-sessions');
      return events[events.length - 1]?.payload || null;
    });

    expect(last.worktreeId).toBe('work99');
    expect(last.repositoryName).toBe('mock-repo');
    expect(last.repositoryRoot).toBe('/home/test/GitHub/games/hytopia/mock-repo');
    expect(last.startTier).toBe(3);
  });
});
