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

test.describe('Queue Panel', () => {
  test('opens and can save tier record', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(`pageerror: ${err?.message || String(err)}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') pageErrors.push(`console.error: ${msg.text()}`);
    });

    // Mock process tasks list (one PR item + one dependent item)
    await page.route(/.*\/api\/process\/tasks.*/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 2,
          tasks: [
            {
              id: 'pr:web3dev1337/incremental-game#4',
              kind: 'pr',
              status: 'open',
              title: 'Mock PR',
              url: 'https://github.com/web3dev1337/incremental-game/pull/4',
              repository: 'web3dev1337/incremental-game',
              project: 'incremental-game',
              worktree: 'work2',
              branch: 'feature/mock-queue',
              updatedAt: '2026-01-25T00:00:00Z',
              record: { tier: 2, changeRisk: 'low' },
              dependencySummary: { total: 2, blocked: 1 }
            },
            {
              id: 'worktree:/tmp/demo/work2',
              kind: 'worktree',
              status: 'ready',
              title: 'Mock Worktree Task',
              worktreePath: '/tmp/demo/work2',
              updatedAt: '2026-01-25T00:00:01Z',
              record: { tier: 3, dependencies: ['pr:web3dev1337/incremental-game#4'] },
              dependencySummary: { total: 0, blocked: 0 }
            }
          ]
        })
      });
    });

    // Mock upsert task record
    await page.route(/.*\/api\/process\/task-records\/.+/, async (route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      const body = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'pr:web3dev1337/incremental-game#4',
          record: {
            ...(body || {}),
            tier: body?.tier || 2,
            changeRisk: body?.changeRisk || 'low'
          }
        })
      });
    });

    // Dependencies: return a small list and allow add/remove.
    await page.route(/.*\/api\/process\/task-records\/.+\/dependencies.*/, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'pr:web3dev1337/incremental-game#4',
            dependencies: [
              { id: 'pr:web3dev1337/other-repo#1', satisfied: false, reason: 'pr_open' },
              { id: 'worktree:/tmp/demo/work1', satisfied: true, reason: 'doneAt' }
            ]
          })
        });
        return;
      }
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'pr:web3dev1337/incremental-game#4',
            record: { dependencies: ['x'] }
          })
        });
        return;
      }
      if (route.request().method() === 'DELETE') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'pr:web3dev1337/incremental-game#4',
            record: { dependencies: [] }
          })
        });
        return;
      }
      return route.fallback();
    });

    // Prompts: return 404 for read, allow write
    await page.route('**/api/prompts/*', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Not found' }) });
        return;
      }
      if (route.request().method() === 'PUT') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'x', sha256: 'deadbeef' }) });
        return;
      }
      return route.fallback();
    });

    // Worktree inspector: return a tiny git summary.
    await page.route('**/api/worktree-git-summary**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          path: '/tmp/demo/work2',
          branch: 'feature/mock-queue',
          ahead: 1,
          behind: 0,
          files: [
            {
              path: 'src/index.js',
              oldPath: null,
              indexStatus: 'M',
              worktreeStatus: ' ',
              isUntracked: false,
              staged: { added: 3, deleted: 1, binary: false },
              unstaged: null
            }
          ],
          commits: [{ hash: 'abc1234', date: '2026-01-25 00:00:00 +0000', message: 'mock commit' }],
          unpushedCommits: [{ hash: 'abc1234', date: '2026-01-25 00:00:00 +0000', message: 'mock commit' }],
          pr: {
            hasPR: true,
            number: 4,
            url: 'https://github.com/web3dev1337/incremental-game/pull/4',
            state: 'open',
            mergeable: 'MERGEABLE',
            isDraft: false,
            branch: 'feature/mock-queue'
          }
        })
      });
    });

    // Mock PR merge endpoint used by the Review Console.
    await page.route('**/api/prs/merge', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true })
      });
    });

    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('/');
    await ensureWorkspaceLoaded(page);
    await dismissFocusOverlay(page);

    // Spy on fetch calls from within the app (more reliable than request events here).
    await page.evaluate(() => {
      window.__fetchUrls = [];
      window.__unhandled = [];
      window.addEventListener('unhandledrejection', (e) => {
        try {
          window.__unhandled.push(String(e?.reason?.message || e?.reason || 'unhandledrejection'));
        } catch {
          window.__unhandled.push('unhandledrejection');
        }
      });
      const originalFetch = window.fetch;
      window.fetch = async (...args) => {
        try {
          window.__fetchUrls.push(String(args?.[0] || ''));
        } catch {}
        return originalFetch(...args);
      };
    });

    await page.evaluate(() => document.getElementById('queue-btn')?.click());
    await expect(page.locator('#queue-panel')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(200);
    const unhandled = await page.evaluate(() => window.__unhandled || []);
    expect(unhandled).toEqual([]);

    await page.waitForFunction(() => Array.isArray(window.__fetchUrls) && window.__fetchUrls.some(u => u.includes('/api/process/tasks')), { timeout: 10000 });

    await expect(page.locator('#queue-list .task-card-row')).toHaveCount(2);
    await expect(page.locator('#queue-list .task-card-row .pr-badge', { hasText: 'incremental-game' })).toBeVisible();
    await expect(page.locator('#queue-list .task-card-row .pr-badge', { hasText: 'work2' })).toBeVisible();
    await expect(page.locator('#queue-list .task-card-row .pr-badge', { hasText: 'feature/mock-queue' })).toBeVisible();
    expect(pageErrors).toEqual([]);
    await page.locator('#queue-list .task-card-row[data-queue-id=\"pr:web3dev1337/incremental-game#4\"]').click();
    await expect(page.locator('#queue-tier')).toBeVisible();
    await expect(page.locator('#queue-reverse-deps')).toContainText('Mock Worktree Task');

    // Start Review should kick off a review timer (PUT includes reviewStartedAt).
    const startReq = page.waitForRequest((req) => {
      if (req.method() !== 'PUT') return false;
      if (!req.url().includes('/api/process/task-records/')) return false;
      try {
        const body = req.postDataJSON();
        return !!body?.reviewStartedAt;
      } catch {
        return false;
      }
    }, { timeout: 5000 });
    await page.locator('#queue-start-review').click();
    await startReq;

    // Change tier to 3; should trigger a PUT.
    const reqPromise = page.waitForRequest((req) => req.method() === 'PUT' && req.url().includes('/api/process/task-records/'), { timeout: 5000 });
    await page.locator('#queue-tier').selectOption('3');
    await reqPromise;

    // Open Review Console for the worktree task (docked inspector).
    await page.locator('#queue-list .task-card-row[data-queue-id=\"worktree:/tmp/demo/work2\"]').click();
    await expect(page.locator('#queue-open-console')).toBeVisible();
    await page.locator('#queue-open-console').click();
    await expect(page.locator('#worktree-inspector-modal.docked')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#worktree-inspector-title')).toContainText('Review Console');

    // Merge PR should call /api/prs/merge.
    page.once('dialog', async (dialog) => dialog.accept());
    const mergeReq = page.waitForRequest((req) => req.method() === 'POST' && req.url().includes('/api/prs/merge'), { timeout: 5000 });
    await page.locator('#worktree-inspector-modal.docked [data-pr-merge]').click();
    const req = await mergeReq;
    expect(req.postDataJSON()).toMatchObject({
      url: 'https://github.com/web3dev1337/incremental-game/pull/4',
      method: 'merge'
    });
  });

  test('review mode orders by overallRisk then verifyMinutes', async ({ page }) => {
    // Mock process tasks list (3 unblocked PRs + 1 blocked PR)
    await page.route(/.*\/api\/process\/tasks.*/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 4,
          tasks: [
            {
              id: 'pr:web3dev1337/demo#1',
              kind: 'pr',
              status: 'open',
              title: 'PR A',
              url: 'https://github.com/web3dev1337/demo/pull/1',
              repository: 'web3dev1337/demo',
              updatedAt: '2026-01-25T00:00:00Z',
              record: { tier: 2, changeRisk: 'high', pFailFirstPass: 0.5, verifyMinutes: 20 },
              dependencySummary: { total: 0, blocked: 0 }
            },
            {
              id: 'pr:web3dev1337/demo#2',
              kind: 'pr',
              status: 'open',
              title: 'PR B',
              url: 'https://github.com/web3dev1337/demo/pull/2',
              repository: 'web3dev1337/demo',
              updatedAt: '2026-01-25T00:00:01Z',
              record: { tier: 2, changeRisk: 'high', pFailFirstPass: 0.5, verifyMinutes: 5 },
              dependencySummary: { total: 0, blocked: 0 }
            },
            {
              id: 'pr:web3dev1337/demo#3',
              kind: 'pr',
              status: 'open',
              title: 'PR C',
              url: 'https://github.com/web3dev1337/demo/pull/3',
              repository: 'web3dev1337/demo',
              updatedAt: '2026-01-25T00:00:02Z',
              record: { tier: 2, changeRisk: 'medium', pFailFirstPass: 0.5, verifyMinutes: 1 },
              dependencySummary: { total: 0, blocked: 0 }
            },
            {
              id: 'pr:web3dev1337/demo#4',
              kind: 'pr',
              status: 'open',
              title: 'PR D (blocked)',
              url: 'https://github.com/web3dev1337/demo/pull/4',
              repository: 'web3dev1337/demo',
              updatedAt: '2026-01-25T00:00:03Z',
              record: { tier: 2, changeRisk: 'critical', pFailFirstPass: 1, verifyMinutes: 1 },
              dependencySummary: { total: 1, blocked: 1 }
            }
          ]
        })
      });
    });

    // Mock upsert task record (used when starting review timer).
    await page.route(/.*\/api\/process\/task-records\/.+/, async (route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      const body = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'x',
          record: { ...(body || {}) }
        })
      });
    });

    // Dependencies: empty list (and allow writes).
    await page.route(/.*\/api\/process\/task-records\/.+\/dependencies.*/, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'x', dependencies: [] })
        });
        return;
      }
      if (['POST', 'DELETE'].includes(route.request().method())) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'x', record: { dependencies: [] } })
        });
        return;
      }
      return route.fallback();
    });

    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('/');
    await ensureWorkspaceLoaded(page);
    await dismissFocusOverlay(page);

    await page.evaluate(() => document.getElementById('queue-btn')?.click());
    await expect(page.locator('#queue-panel')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#queue-list .task-card-row')).toHaveCount(4);

    await page.locator('#queue-start-review').click();
    await page.waitForTimeout(200);

    const ids = await page.locator('#queue-list .task-card-row').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-queue-id')));
    expect(ids).toEqual([
      'pr:web3dev1337/demo#2',
      'pr:web3dev1337/demo#1',
      'pr:web3dev1337/demo#3',
      'pr:web3dev1337/demo#4'
    ]);
  });

  test('shows worktree conflict warnings when available', async ({ page }) => {
    await page.route(/.*\/api\/process\/tasks.*/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 2,
          tasks: [
            {
              id: 'worktree:/tmp/demo/work2',
              kind: 'worktree',
              status: 'ready',
              title: 'Worktree A',
              worktreePath: '/tmp/demo/work2',
              project: 'demo',
              worktree: 'work2',
              branch: 'feature/a',
              updatedAt: '2026-01-25T00:00:00Z',
              record: { tier: 2 },
              dependencySummary: { total: 0, blocked: 0 }
            },
            {
              id: 'worktree:/tmp/demo/work3',
              kind: 'worktree',
              status: 'ready',
              title: 'Worktree B',
              worktreePath: '/tmp/demo/work3',
              project: 'demo',
              worktree: 'work3',
              branch: 'feature/b',
              updatedAt: '2026-01-25T00:00:01Z',
              record: { tier: 2 },
              dependencySummary: { total: 0, blocked: 0 }
            }
          ]
        })
      });
    });

    await page.route('**/api/worktree-conflicts**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 1,
          conflicts: [
            {
              projectKey: 'demo',
              type: 'file-overlap',
              a: { worktreePath: '/tmp/demo/work2', branch: 'feature/a', pr: { hasPR: false }, changedFilesCount: 2 },
              b: { worktreePath: '/tmp/demo/work3', branch: 'feature/b', pr: { hasPR: false }, changedFilesCount: 1 },
              overlapFiles: ['package.json']
            }
          ],
          groups: []
        })
      });
    });

    await page.route(/.*\/api\/process\/task-records\/.+\/dependencies.*/, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'x', dependencies: [] })
        });
        return;
      }
      if (['POST', 'DELETE'].includes(route.request().method())) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'x', record: { dependencies: [] } })
        });
        return;
      }
      return route.fallback();
    });

    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('/');
    await ensureWorkspaceLoaded(page);
    await dismissFocusOverlay(page);

    await page.evaluate(() => document.getElementById('queue-btn')?.click());
    await expect(page.locator('#queue-panel')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#queue-list .task-card-row')).toHaveCount(2);

    await expect(page.locator('#queue-list .task-card-row[data-queue-id=\"worktree:/tmp/demo/work2\"]')).toContainText('conflicts:1');

    await page.locator('#queue-list .task-card-row[data-queue-id=\"worktree:/tmp/demo/work2\"]').click();
    await expect(page.locator('#queue-conflicts')).toContainText('/tmp/demo/work3');
  });
});
