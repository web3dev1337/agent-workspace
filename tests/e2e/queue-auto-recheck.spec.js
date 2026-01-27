const { test, expect } = require('@playwright/test');

const ensureOrchestratorReady = async (page) => {
  await page.waitForFunction(() => window.orchestrator?.socket?.connected === true, {
    timeout: 20000
  });
};

const dismissFocusOverlay = async (page) => {
  const overlay = page.locator('#focus-overlay.active');
  if (await overlay.isVisible().catch(() => false)) {
    await page.locator('#focus-overlay .focus-close-btn').click();
    await expect(overlay).toBeHidden();
  }
};

test.describe('Queue auto recheck', () => {
  test('auto recheck emits add-worktree-sessions when PR updates after fixer spawn', async ({ page }) => {
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
              updatedAt: '2026-01-26T00:00:00Z',
              record: { tier: 3, reviewOutcome: 'needs_fix', notes: 'Please fix X', fixerSpawnedAt: '2026-01-25T00:00:00Z' },
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
        body: JSON.stringify({ id: 'pr:web3dev1337/mock-repo#12', dependencies: [] })
      });
    });

    await page.route(/.*\/api\/process\/task-records\/.*/, async (route) => {
      const req = route.request();
      if (req.method() !== 'PUT') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ record: {} }) });
        return;
      }
      const body = JSON.parse(req.postData() || '{}');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ record: { ...body } }) });
    });

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

    await page.goto('/');
    await ensureOrchestratorReady(page);
    await dismissFocusOverlay(page);

    await page.evaluate(async () => {
      localStorage.setItem('queue-auto-reviewer', 'false');
      localStorage.setItem('queue-auto-fixer', 'false');
      localStorage.setItem('queue-auto-recheck', 'false');

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

      await window.orchestrator.showQueuePanel();
      window.__capturedEmits = [];
      const sock = window.orchestrator?.socket;
      if (sock) {
        sock.emit = (event, payload) => {
          window.__capturedEmits.push({ event, payload });
        };
      }
    });

    await page.locator('#queue-auto-recheck').click();
    await page.locator('.task-card-row[data-queue-id="pr:web3dev1337/mock-repo#12"]').click();

    await expect.poll(async () => {
      return await page.evaluate(() => (window.__capturedEmits || []).filter(e => e.event === 'add-worktree-sessions').length);
    }, { timeout: 5000 }).toBeGreaterThan(0);

    const last = await page.evaluate(() => {
      const events = (window.__capturedEmits || []).filter(e => e.event === 'add-worktree-sessions');
      return events[events.length - 1]?.payload || null;
    });

    expect(last.worktreeId).toBe('work99');
    expect(last.repositoryName).toBe('mock-repo');
    expect(last.startTier).toBe(3);
  });
});
