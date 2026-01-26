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

test.describe('Queue dependency linking UX', () => {
  test('supports drag/drop add + bulk remove', async ({ page }) => {
    const deps = [];

    await page.route(/.*\/api\/process\/tasks.*/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 2,
          tasks: [
            {
              id: 'task:A',
              kind: 'worktree',
              status: 'open',
              title: 'Task A',
              updatedAt: '2026-01-25T00:00:00Z',
              record: { tier: 2 },
              dependencySummary: { total: deps.length, blocked: deps.length }
            },
            {
              id: 'task:B',
              kind: 'worktree',
              status: 'open',
              title: 'Task B',
              updatedAt: '2026-01-25T00:00:00Z',
              record: { tier: 2 },
              dependencySummary: { total: 0, blocked: 0 }
            }
          ]
        })
      });
    });

    await page.route(/.*\/api\/process\/task-records\/task%3AA\/dependencies.*/, async (route) => {
      const req = route.request();
      if (req.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'task:A',
            dependencies: deps.map((id) => ({ id, satisfied: false, reason: 'manual' }))
          })
        });
        return;
      }

      if (req.method() === 'POST') {
        const body = req.postDataJSON?.() || {};
        const depId = String(body?.dependencyId || '').trim();
        if (depId) deps.push(depId);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'task:A', record: { dependencies: deps.slice() } })
        });
        return;
      }

      await route.fallback();
    });

    await page.route(/.*\/api\/process\/task-records\/task%3AA\/dependencies\/.*/, async (route) => {
      const req = route.request();
      if (req.method() !== 'DELETE') return route.fallback();
      const url = new URL(req.url());
      const parts = url.pathname.split('/');
      const depEncoded = parts[parts.length - 1] || '';
      const dep = decodeURIComponent(depEncoded);
      const idx = deps.indexOf(dep);
      if (idx >= 0) deps.splice(idx, 1);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'task:A', record: { dependencies: deps.slice() } })
      });
    });

    await page.goto('/');
    await ensureWorkspaceLoaded(page);
    await page.waitForFunction(() => !!window.orchestrator, { timeout: 10000 });

    await page.evaluate(async () => {
      await window.orchestrator.showQueuePanel();
    });

    await expect(page.locator('#queue-panel')).toBeVisible();
    await page.locator('.task-card-row[data-queue-id="task:A"]').click();

    await expect(page.locator('#queue-deps')).toContainText('No dependencies');

    await page.locator('.task-card-row[data-queue-id="task:B"]').dragTo(page.locator('#queue-dep-dropzone'));
    await expect(page.locator('#queue-deps')).toContainText('task:B');

    await page.locator('#queue-deps .queue-dep-check[data-dep="task:B"]').check();
    await page.locator('#queue-deps #queue-dep-remove-selected').click();
    await expect(page.locator('#queue-deps')).toContainText('No dependencies');
  });
});

