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
    if (await openWorkspaceBtn.count() === 0) {
      throw new Error('No workspace available to open for tests.');
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
  const me = { id: 'm1', fullName: 'Alice', username: 'alice' };
  const cardBase = {
    id: 'c1',
    idList: 'l1',
    idBoard: 'b1',
    name: 'Card 1',
    url: 'https://trello.com/c/AbCdEf12/card-1',
    dateLastActivity: '2026-01-01T00:00:00Z',
    labels: [],
    idMembers: [me.id],
    members: [me],
    customFieldItems: [],
    checklists: [],
    actions: [],
    desc: 'Do the thing.\n'
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
      body: JSON.stringify({ provider: 'trello', member: me })
    });
  });

  await page.route('**/api/tasks/boards**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        provider: 'trello',
        boards: [{ id: 'b1', name: 'Mock Board', prefs: { backgroundColor: '#2ea043' } }]
      })
    });
  });

  await page.route('**/api/tasks/boards/b1/lists**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        provider: 'trello',
        boardId: 'b1',
        lists: [{ id: 'l1', name: 'To Do', pos: 1 }]
      })
    });
  });

  await page.route('**/api/tasks/boards/b1/members**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ provider: 'trello', boardId: 'b1', members: [me] })
    });
  });

  await page.route('**/api/tasks/boards/b1/cards**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        provider: 'trello',
        boardId: 'b1',
        cards: [cardBase]
      })
    });
  });

  await page.route(/.*\/api\/tasks\/boards\/b1\/snapshot.*/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        provider: 'trello',
        boardId: 'b1',
        lists: [{ id: 'l1', name: 'To Do', pos: 1 }],
        cardsByList: { l1: [cardBase] }
      })
    });
  });

  await page.route(/\/api\/tasks\/cards\/c1(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ provider: 'trello', cardId: 'c1', card: cardBase })
    });
  });
};

test.describe('Tasks quick launch', () => {
  test('quick launch button calls launchAgentFromTaskCard', async ({ page }) => {
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
                'trello:b1': { enabled: true, localPath: 'games/hytopia/mock-repo', defaultStartTier: 2 }
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

    // Force Tasks to open directly in board view for determinism.
    await page.evaluate(() => {
      localStorage.setItem('tasks-view', 'board');
      localStorage.setItem('tasks-board', 'b1');
    });

    await page.evaluate(() => document.getElementById('tasks-btn')?.click());
    await expect(page.locator('#tasks-panel')).toBeVisible({ timeout: 10000 });
    await page.locator('#tasks-board').selectOption({ value: 'b1' });
    await expect(page.locator('#tasks-board-view')).toBeVisible({ timeout: 20000 });

    // Change default tier via toolbar (should update quick launch tier).
    await page.locator('#tasks-launch-default-tier').selectOption({ value: '4' });

    // Capture quick launch calls.
    await page.evaluate(() => {
      window.__launchCalls = [];
      const o = window.orchestrator;
      o.launchAgentFromTaskCard = async (args) => {
        window.__launchCalls.push(args);
        return null;
      };
    });

    await expect(page.locator('.task-card-row[data-card-id="c1"]')).toBeVisible({ timeout: 10000 });
    await page.locator('.task-card-row[data-card-id="c1"] [data-quick-launch-btn]').click();

    await page.waitForFunction(() => (window.__launchCalls?.length || 0) > 0, null, { timeout: 10000 });
    const calls = await page.evaluate(() => window.__launchCalls || []);
    expect(calls.length).toBeGreaterThan(0);
    const last = calls[calls.length - 1];
    expect(last.provider).toBe('trello');
    expect(last.boardId).toBe('b1');
    expect(last.card?.id).toBe('c1');
    expect(last.tier).toBe(4);
  });
});
