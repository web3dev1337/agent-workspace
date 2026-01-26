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

test.describe('Queue dependency graph', () => {
  test('opens dependency graph modal and renders upstream/downstream', async ({ page }) => {
    await page.route(/.*\/api\/process\/tasks.*/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 1,
          tasks: [
            {
              id: 'task:A',
              kind: 'worktree',
              status: 'open',
              title: 'Task A',
              updatedAt: '2026-01-25T00:00:00Z',
              record: { tier: 2 },
              dependencySummary: { total: 1, blocked: 0 }
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
        body: JSON.stringify({ id: 'task:A', dependencies: [] })
      });
    });

    await page.route(/.*\/api\/process\/dependency-graph\/.*/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          rootId: 'task:A',
          depth: 2,
          nodes: [
            { id: 'task:A', label: 'Task A' },
            { id: 'task:B', label: 'Task B', doneAt: '2026-01-01T00:00:00.000Z' },
            { id: 'task:C', label: 'Task C' }
          ],
          edges: [
            { from: 'task:A', to: 'task:B', satisfied: true, reason: 'doneAt' },
            { from: 'task:C', to: 'task:A', satisfied: false, reason: 'manual' }
          ]
        })
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

    await page.locator('#queue-dep-graph').click();
    await expect(page.locator('#queue-dep-graph-modal')).toBeVisible();
    await expect(page.locator('#queue-dep-graph-modal')).toContainText('Blocked By');
    await expect(page.locator('#queue-dep-graph-modal')).toContainText('Unblocks');
    await expect(page.locator('#queue-dep-graph-modal')).toContainText('Task B');
    await expect(page.locator('#queue-dep-graph-modal')).toContainText('Task C');
  });
});

