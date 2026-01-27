const { test, expect } = require('@playwright/test');
const { mockUserSettings } = require('./_mockUserSettings');

const ensureWorkspaceLoaded = async (page) => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const sidebar = page.locator('.sidebar');
    if (await sidebar.isVisible().catch(() => false)) {
      return;
    }

    await page.waitForFunction(() => window.orchestrator?.socket?.connected === true, {
      timeout: 20000
    });

    const openWorkspaceBtn = page.getByRole('button', { name: 'Open Workspace' }).first();
    try {
      await openWorkspaceBtn.waitFor({ state: 'visible', timeout: 20000 });
    } catch {
      await page.reload();
      continue;
    }

    await openWorkspaceBtn.click();
    try {
      await page.waitForSelector('#recovery-dialog, .sidebar:not(.hidden)', { timeout: 20000 });
    } catch {
      await page.reload();
      continue;
    }

    const recoverySkipBtn = page.locator('#recovery-skip');
    if (await recoverySkipBtn.isVisible().catch(() => false)) {
      await recoverySkipBtn.click();
    }

    await page.waitForSelector('.sidebar:not(.hidden)', { timeout: 20000 });
    return;
  }

  throw new Error('Failed to load workspace for tests.');
};

const dismissFocusOverlay = async (page) => {
  const overlay = page.locator('#focus-overlay.active');
  if (await overlay.isVisible().catch(() => false)) {
    await page.locator('#focus-overlay .focus-close-btn').click();
    await expect(overlay).toBeHidden();
  }
};

const mockTasksApi = async (page) => {
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
      body: JSON.stringify({ provider: 'trello', member: { id: 'm1', fullName: 'Alice', username: 'alice' } })
    });
  });

  await page.route('**/api/tasks/boards**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        provider: 'trello',
        boards: [
          { id: 'b1', name: 'Alpha Board', prefs: { backgroundColor: '#2ea043' } },
          { id: 'b2', name: 'Beta Board', prefs: { backgroundColor: '#1f6feb' } }
        ]
      })
    });
  });

  // Lists for loadBoardMeta / settings.
  await page.route('**/api/tasks/boards/b1/lists**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ provider: 'trello', boardId: 'b1', lists: [{ id: 'l1', name: 'To Do', pos: 1 }] })
    });
  });
  await page.route('**/api/tasks/boards/b2/lists**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ provider: 'trello', boardId: 'b2', lists: [{ id: 'l2', name: 'To Do', pos: 1 }] })
    });
  });

  // Meta endpoints used by loadBoardMeta.
  for (const boardId of ['b1', 'b2']) {
    await page.route(`**/api/tasks/boards/${boardId}/members**`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provider: 'trello', boardId, members: [] }) });
    });
    await page.route(`**/api/tasks/boards/${boardId}/labels**`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provider: 'trello', boardId, labels: [] }) });
    });
    await page.route(`**/api/tasks/boards/${boardId}/custom-fields**`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provider: 'trello', boardId, customFields: [] }) });
    });
  }

  // Combined view fetches list cards.
  await page.route('**/api/tasks/lists/l1/cards**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        provider: 'trello',
        listId: 'l1',
        cards: [
          {
            id: 'c1',
            name: 'Card 1',
            idBoard: 'b1',
            idList: 'l1',
            pos: 1,
            dateLastActivity: new Date('2026-01-25T10:00:00.000Z').toISOString(),
            url: 'https://trello.com/c/abc123'
          }
        ]
      })
    });
  });
  await page.route('**/api/tasks/lists/l2/cards**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        provider: 'trello',
        listId: 'l2',
        cards: [
          {
            id: 'c2',
            name: 'Card 2',
            idBoard: 'b2',
            idList: 'l2',
            pos: 1,
            dateLastActivity: new Date('2026-01-25T11:00:00.000Z').toISOString(),
            url: 'https://trello.com/c/def456'
          }
        ]
      })
    });
  });
};

test.describe('Tasks combined view', () => {
  test('renders selected lists from multiple boards', async ({ page }) => {
    await mockUserSettings(page, {
      initial: {
        version: 'test',
        global: {
          ui: {
            theme: 'dark',
            tasks: {
              theme: 'inherit',
              me: { trelloUsername: '' },
              filters: { assigneesByBoard: {} },
              kanban: { collapsedByBoard: {}, expandedByBoard: {}, layoutByBoard: {} },
              boardMappings: {
                'trello:b1': { enabled: true, localPath: 'games/hytopia/alpha', defaultStartTier: 3 },
                'trello:b2': { enabled: true, localPath: 'games/hytopia/beta', defaultStartTier: 3 }
              },
              combined: {
                selections: [
                  { boardId: 'b1', listId: 'l1' },
                  { boardId: 'b2', listId: 'l2' }
                ]
              }
            }
          }
        },
        perTerminal: {}
      }
    });
    await mockTasksApi(page);

    await page.goto('/');
    await ensureWorkspaceLoaded(page);
    await dismissFocusOverlay(page);

    await page.evaluate(() => document.getElementById('tasks-btn')?.click());
    await expect(page.locator('#tasks-panel')).toBeVisible({ timeout: 10000 });

    const boardSelect = page.locator('#tasks-board');
    await boardSelect.selectOption({ value: '__combined__' });

    await expect(page.locator('#tasks-board-view')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.tasks-column-title')).toContainText(['Alpha Board', 'Beta Board']);
    await expect(page.locator('.task-card-title')).toContainText(['Card 1', 'Card 2']);
  });
});
