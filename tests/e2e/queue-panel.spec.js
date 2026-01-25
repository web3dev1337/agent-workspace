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

    // Mock process tasks list (one PR item)
    await page.route(/.*\/api\/process\/tasks.*/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 1,
          tasks: [
            {
              id: 'pr:web3dev1337/incremental-game#4',
              kind: 'pr',
              status: 'open',
              title: 'Mock PR',
              url: 'https://github.com/web3dev1337/incremental-game/pull/4',
              repository: 'web3dev1337/incremental-game',
              updatedAt: '2026-01-25T00:00:00Z',
              record: { tier: 2, changeRisk: 'low' },
              dependencySummary: { total: 2, blocked: 1 }
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

    await expect(page.locator('#queue-list .task-card-row')).toHaveCount(1);
    expect(pageErrors).toEqual([]);
    await page.locator('#queue-list .task-card-row').click();
    await expect(page.locator('#queue-tier')).toBeVisible();

    // Change tier to 3; should trigger a PUT.
    const reqPromise = page.waitForRequest((req) => req.method() === 'PUT' && req.url().includes('/api/process/task-records/'), { timeout: 5000 });
    await page.locator('#queue-tier').selectOption('3');
    await reqPromise;
  });
});
