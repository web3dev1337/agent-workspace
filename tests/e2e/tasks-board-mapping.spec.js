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

  // Minimal list/cards so panel can render.
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

  await page.route('**/api/tasks/boards/b1/cards**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ provider: 'trello', boardId: 'b1', cards: [] })
    });
  });
  await page.route('**/api/tasks/boards/b2/cards**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ provider: 'trello', boardId: 'b2', cards: [] })
    });
  });
};

test.describe('Tasks board mappings', () => {
  test('can hide disabled boards and show disabled on demand', async ({ page }) => {
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
                'trello:b2': { enabled: false, localPath: 'games/hytopia/beta', defaultStartTier: 3 }
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

    // Open Tasks
    await page.evaluate(() => document.getElementById('tasks-btn')?.click());
    await expect(page.locator('#tasks-panel')).toBeVisible({ timeout: 10000 });

    const boardSelect = page.locator('#tasks-board');
    await expect(boardSelect).toBeVisible();

    // By default, disabled boards are hidden from the selector.
    await expect.poll(async () => {
      const optionsText = await boardSelect.locator('option').allTextContents();
      return optionsText.join(' ');
    }, { timeout: 5000 }).toContain('Alpha Board');

    await expect.poll(async () => {
      const optionsText = await boardSelect.locator('option').allTextContents();
      return optionsText.join(' ');
    }, { timeout: 5000 }).not.toContain('Beta Board');

    // Open board settings (no board selected yet → message).
    await page.locator('#tasks-board-settings').click();
    await expect(page.locator('#tasks-detail')).toContainText('Select a board');

    // Select Alpha then disable it; current selection stays available even if disabled.
    await boardSelect.selectOption({ value: 'b1' });
    await page.locator('#tasks-board-settings').click();
    await expect(page.locator('#tasks-detail')).toContainText('Board Settings');
    await page.locator('#tasks-board-enabled').uncheck();
    await page.locator('#tasks-board-save').click();

    // Board selector should still include Alpha (because it's selected), but label marks it disabled.
    await expect.poll(async () => {
      const optsAfter = await boardSelect.locator('option').allTextContents();
      return optsAfter.join(' ');
    }, { timeout: 5000 }).toContain('Alpha Board (disabled)');

    // Enable "show disabled boards" and confirm Beta appears.
    await page.locator('#tasks-board-settings').click();
    // Use evaluate-click to avoid Playwright waiting for any "navigation" triggered by async refreshes.
    await page.evaluate(() => document.getElementById('tasks-show-disabled')?.click());
    await expect.poll(async () => {
      const optsShown = await boardSelect.locator('option').allTextContents();
      return optsShown.join(' ');
    }, { timeout: 5000 }).toContain('Beta Board (disabled)');
  });
});
