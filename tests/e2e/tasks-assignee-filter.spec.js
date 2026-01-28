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
      body: JSON.stringify({
        provider: 'trello',
        boardId: 'b1',
        members: [
          { id: 'm1', fullName: 'Me', username: 'me' },
          { id: 'm2', fullName: 'Other', username: 'other' }
        ]
      })
    });
  });

  await page.route('**/api/tasks/boards/b1/labels**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ provider: 'trello', boardId: 'b1', labels: [] })
    });
  });

  await page.route('**/api/tasks/boards/b1/cards**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        provider: 'trello',
        boardId: 'b1',
        cards: [
          { id: 'c1', idMembers: ['m1'], name: 'Mine', dateLastActivity: '2026-01-01T00:00:00Z' },
          { id: 'c2', idMembers: ['m2'], name: 'Not mine', dateLastActivity: '2026-01-01T00:00:00Z' }
        ]
      })
    });
  });
};

test.describe('Tasks assignee filtering', () => {
  test('defaults to any and can filter me', async ({ page }) => {
    await mockUserSettings(page);
    await mockTasksApi(page);
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('/');
    await dismissFocusOverlay(page);
    await ensureWorkspaceLoaded(page);
    await dismissFocusOverlay(page);

    await page.evaluate(() => document.getElementById('tasks-btn')?.click());
    await expect(page.locator('#tasks-panel')).toBeVisible({ timeout: 10000 });

    await page.locator('#tasks-board').selectOption('b1');

    // Default should be "Any" -> show both.
    await expect(page.locator('.task-card-row')).toHaveCount(2);

    // Switch to Only me -> show one card.
    const assigneesDetails = page.locator('#tasks-assignees-filter');
    const openAssignees = async () => {
      await assigneesDetails.evaluate((el) => { el.open = true; });
      await expect(page.locator('#tasks-assignees-me')).toBeVisible();
    };
    await openAssignees();
    await page.locator('#tasks-assignees-me').click();
    await expect(page.locator('.task-card-row')).toHaveCount(1);
    await expect(page.locator('.task-card-title')).toHaveText('Mine');

    // Switch back to Any -> show both again.
    await openAssignees();
    await page.locator('#tasks-assignees-any').click();
    await expect(page.locator('.task-card-row')).toHaveCount(2);
  });
});
