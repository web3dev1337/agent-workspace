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

const mockTasksApi = async (page, { cardCount = 23 } = {}) => {
  const cards = Array.from({ length: cardCount }).map((_, i) => ({
    id: `c${i + 1}`,
    idList: 'l1',
    idMembers: ['m1'],
    name: `Card ${i + 1}`,
    pos: i + 1,
    dateLastActivity: '2026-01-01T00:00:00Z'
  }));

  await page.route('**/api/tasks/providers**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        providers: [{ id: 'trello', label: 'Trello', configured: true, capabilities: { read: true, write: true } }]
      })
    });
  });

  await page.route('**/api/tasks/me**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ provider: 'trello', member: { id: 'm1', fullName: 'Me', username: 'me' } })
    });
  });

  await page.route('**/api/tasks/boards**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        provider: 'trello',
        boards: [{ id: 'b1', name: 'Mock Board' }]
      })
    });
  });

  await page.route('**/api/tasks/boards/b1/snapshot**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        provider: 'trello',
        boardId: 'b1',
        lists: [
          { id: 'l1', name: 'Backlog', pos: 1 },
          { id: 'l2', name: 'Doing', pos: 2 }
        ],
        cardsByList: {
          l1: cards,
          l2: [{ id: 'c999', idList: 'l2', idMembers: ['m1'], name: 'Small', pos: 1, dateLastActivity: '2026-01-01T00:00:00Z' }]
        }
      })
    });
  });

  await page.route('**/api/tasks/boards/b1/members**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ provider: 'trello', boardId: 'b1', members: [] })
    });
  });

  await page.route('**/api/tasks/boards/b1/custom-fields**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ provider: 'trello', boardId: 'b1', customFields: [] })
    });
  });

  await page.route('**/api/tasks/boards/b1/labels**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ provider: 'trello', boardId: 'b1', labels: [] })
    });
  });
};

test.describe('Tasks Kanban Wrap+Expand layout', () => {
  test('uses multi-column expansion without vertical scroll', async ({ page }) => {
    await mockUserSettings(page);
    await mockTasksApi(page, { cardCount: 23 });

    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('/');
    await ensureWorkspaceLoaded(page);

    // Dismiss focus overlay if present.
    const overlay = page.locator('#focus-overlay.active');
    if (await overlay.isVisible().catch(() => false)) {
      await page.locator('#focus-overlay .focus-close-btn').click();
      await expect(overlay).toBeHidden();
    }

    // Open Tasks → select board → Board view.
    await page.evaluate(() => document.getElementById('tasks-btn')?.click());
    await expect(page.locator('#tasks-panel')).toBeVisible({ timeout: 10000 });
    await page.locator('#tasks-board').selectOption('b1');
    await page.locator('#tasks-view-board').click();

    // Ensure Wrap+Expand is enabled (radio).
    await page.locator('input[name="tasks-layout"][value="wrap-expand"]').click();

    // Wait for columns to render.
    await expect(page.locator('.tasks-column[data-list-id="l1"]')).toBeVisible();

    // Wait until the column computes a columns count (>= 2 for this many cards).
    await page.waitForFunction(() => {
      const col = document.querySelector('.tasks-column[data-list-id="l1"]');
      if (!col) return false;
      const colsRaw = col.style.getPropertyValue('--tasks-card-columns');
      const cols = Number(colsRaw);
      return Number.isFinite(cols) && cols >= 2;
    }, { timeout: 10000 });

    const metrics = await page.evaluate(() => {
      const board = document.getElementById('tasks-board-view');
      const col = document.querySelector('.tasks-column[data-list-id="l1"]');
      const cards = col?.querySelector('.tasks-column-cards');
      return {
        boardCanScrollVertically: board ? board.scrollHeight > board.clientHeight + 1 : null,
        cardsCanScrollVertically: cards ? cards.scrollHeight > cards.clientHeight + 1 : null,
        cols: col ? Number(col.style.getPropertyValue('--tasks-card-columns')) : null
      };
    });

    expect(metrics.cols).toBeGreaterThanOrEqual(2);
    expect(metrics.boardCanScrollVertically).toBeFalsy();
    expect(metrics.cardsCanScrollVertically).toBeFalsy();
  });
});
