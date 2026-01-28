const { test, expect } = require('@playwright/test');
const { mockUserSettings } = require('./_mockUserSettings');

const ensureWorkspaceLoaded = async (page) => {
  const sidebar = page.locator('.sidebar');
  if (await sidebar.isVisible().catch(() => false)) {
    return;
  }

  await page.waitForFunction(() => window.orchestrator?.socket?.connected === true, {
    timeout: 15000
  });

  const openWorkspaceBtn = page.getByRole('button', { name: 'Open Workspace' }).first();
  if (await openWorkspaceBtn.count() === 0) {
    throw new Error('No workspace available to open for tests.');
  }

  await openWorkspaceBtn.click();
  await page.waitForSelector('#recovery-dialog, .sidebar:not(.hidden)', { timeout: 15000 });

  const recoverySkipBtn = page.locator('#recovery-skip');
  if (await recoverySkipBtn.isVisible().catch(() => false)) {
    await recoverySkipBtn.click();
  }

  await page.waitForSelector('.sidebar:not(.hidden)', { timeout: 15000 });
};

const dismissFocusOverlay = async (page) => {
  const overlay = page.locator('#focus-overlay.active');
  if (await overlay.isVisible().catch(() => false)) {
    await page.locator('#focus-overlay .focus-close-btn').click();
    await expect(overlay).toBeHidden();
  }
};

const mockTasksApi = async (page) => {
  const snapshot = {
    provider: 'trello',
    boardId: 'b1',
    lists: [
      { id: 'l1', name: 'To Do', pos: 1 },
      { id: 'l2', name: 'Doing', pos: 2 }
    ],
    cardsByList: {
      l1: [
        {
          id: 'c1',
          idList: 'l1',
          idMembers: ['m1'],
          name: 'Card 1',
          pos: 1,
          dateLastActivity: '2026-01-01T00:00:00Z',
          url: 'https://trello.com/c/AbCdEf12/card-1'
        }
      ],
      l2: []
    }
  };

  const cardDetail = {
    id: 'c1',
    idBoard: 'b1',
    idList: 'l1',
    name: 'Card 1',
    desc: 'hello',
    url: 'https://trello.com/c/AbCdEf12/card-1',
    dateLastActivity: '2026-01-01T00:00:00Z',
    labels: [],
    idMembers: ['m1'],
    members: [{ id: 'm1', fullName: 'Me', username: 'me' }],
    customFieldItems: [],
    checklists: [],
    actions: []
  };

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
      body: JSON.stringify({ provider: 'trello', boards: [{ id: 'b1', name: 'Mock Board' }] })
    });
  });

  await page.route('**/api/tasks/boards/b1/snapshot**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(snapshot)
    });
  });

  await page.route('**/api/tasks/boards/b1/members**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ provider: 'trello', boardId: 'b1', members: [{ id: 'm1', fullName: 'Me', username: 'me' }] })
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

  await page.route(/\/api\/tasks\/cards\/c1(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ provider: 'trello', cardId: 'c1', card: cardDetail })
    });
  });
};

test.describe('Tasks Kanban detail overlay layout', () => {
  test('keeps board left-aligned and opens detail on the right', async ({ page }) => {
    await mockUserSettings(page);
    await mockTasksApi(page);

    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('/');
    await ensureWorkspaceLoaded(page);
    await dismissFocusOverlay(page);

    await page.evaluate(() => document.getElementById('tasks-btn')?.click());
    await expect(page.locator('#tasks-panel')).toBeVisible({ timeout: 10000 });

    await page.locator('#tasks-board').selectOption('b1');
    await page.locator('#tasks-view-board').click();

    await expect(page.locator('.tasks-body')).toHaveClass(/tasks-body-board/);
    await expect(page.locator('#tasks-board-view')).toBeVisible();
    await expect(page.locator('.tasks-column[data-list-id="l1"]')).toBeVisible();

    const pre = await page.evaluate(() => {
      const board = document.getElementById('tasks-board-view');
      const col = document.querySelector('.tasks-column[data-list-id="l1"]');
      if (!board || !col) return null;
      const boardRect = board.getBoundingClientRect();
      const colRect = col.getBoundingClientRect();
      return {
        scrollLeft: board.scrollLeft,
        leftOffset: colRect.left - boardRect.left,
        boardWidth: boardRect.width
      };
    });

    expect(pre).toBeTruthy();
    expect(Math.abs(pre.scrollLeft)).toBeLessThan(1);
    expect(pre.leftOffset).toBeLessThan(40);
    expect(pre.boardWidth).toBeGreaterThan(700);

    await page.locator('.task-card-board[data-card-id="c1"]').click();
    await expect(page.locator('#tasks-card-title')).toHaveValue('Card 1');

    await expect(page.locator('.tasks-body')).toHaveClass(/tasks-has-detail/);

    const post = await page.evaluate(() => {
      const body = document.querySelector('.tasks-body');
      const detail = document.getElementById('tasks-detail');
      const board = document.getElementById('tasks-board-view');
      if (!body || !detail || !board) return null;
      const bodyRect = body.getBoundingClientRect();
      const detailRect = detail.getBoundingClientRect();
      const boardRect = board.getBoundingClientRect();
      return {
        detailRightDelta: Math.abs(detailRect.right - bodyRect.right),
        detailOnRightHalf: detailRect.left > (bodyRect.left + bodyRect.width / 2),
        boardWidth: boardRect.width
      };
    });

    expect(post).toBeTruthy();
    expect(post.detailRightDelta).toBeLessThan(3);
    expect(post.detailOnRightHalf).toBeTruthy();
    expect(post.boardWidth).toBeGreaterThan(700);
  });
});

