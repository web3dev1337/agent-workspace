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

const mockProjectsBoardApi = async (page) => {
  const projects = [
    { name: 'Alpha', relativePath: 'alpha', path: '/mock/alpha', type: 'tool-project', category: 'Tools' },
    { name: 'Beta', relativePath: 'beta', path: '/mock/beta', type: 'website', category: 'Web' },
    { name: 'Gamma', relativePath: 'gamma', path: '/mock/gamma', type: 'web-game', category: 'Games' }
  ];

  const columns = [
    { id: 'archived', label: 'Archive' },
    { id: 'someday', label: 'Maybe One Day' },
    { id: 'backlog', label: 'Backlog' },
    { id: 'active', label: 'Active' },
    { id: 'next', label: 'Ship Next' },
    { id: 'done', label: 'Done' }
  ];

  let board = {
    version: 2,
    updatedAt: new Date().toISOString(),
    projectToColumn: { gamma: 'active' },
    orderByColumn: {
      backlog: ['alpha', 'beta'],
      active: ['gamma']
    },
    collapsedColumnIds: [],
    tagsByProjectKey: {}
  };

  await page.route(/\/api\/workspaces\/scan-repos(\?|$)/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(projects) });
  });

  await page.route(/\/api\/projects\/board(\?|$)/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, storePath: '/mock/project-board.json', columns, board })
    });
  });

  await page.route('**/api/projects/board/move', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    const projectKey = String(body?.projectKey || '').trim().replace(/\\/g, '/');
    const columnId = String(body?.columnId || '').trim().toLowerCase();
    const patch = body?.orderByColumn && typeof body.orderByColumn === 'object' ? body.orderByColumn : {};

    const nextProjectToColumn = { ...(board.projectToColumn || {}) };
    if (columnId === 'backlog') delete nextProjectToColumn[projectKey];
    else nextProjectToColumn[projectKey] = columnId;

    const nextOrderByColumn = { ...(board.orderByColumn || {}) };
    for (const [col, list] of Object.entries(patch)) {
      if (!Array.isArray(list)) continue;
      nextOrderByColumn[String(col || '').trim().toLowerCase()] = list.map((k) => String(k || '').trim().replace(/\\/g, '/'));
    }

    board = { ...board, projectToColumn: nextProjectToColumn, orderByColumn: nextOrderByColumn, updatedAt: new Date().toISOString() };

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, projectKey, columnId, board })
    });
  });
};

test.describe('Projects Board drag/drop', () => {
  test('reorders within a list and moves between lists', async ({ page }) => {
    await mockUserSettings(page);
    await mockProjectsBoardApi(page);

    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('/');
    await ensureWorkspaceLoaded(page);
    await dismissFocusOverlay(page);

    await page.evaluate(() => document.getElementById('projects-board-btn')?.click());
    await expect(page.locator('#projects-board-modal')).toBeVisible({ timeout: 10000 });

    const backlogCards = page.locator('.projects-board-column[data-column-id="backlog"] .projects-board-card');
    await expect(backlogCards).toHaveCount(2);

    // Reorder: drag Beta before Alpha.
    await page.locator('.projects-board-card[data-project-key="beta"]').dragTo(
      page.locator('.projects-board-card[data-project-key="alpha"]'),
      { targetPosition: { x: 10, y: 4 } }
    );

    await expect(backlogCards).toHaveCount(2);
    await expect(backlogCards.nth(0)).toHaveAttribute('data-project-key', 'beta');
    await expect(backlogCards.nth(1)).toHaveAttribute('data-project-key', 'alpha');

    // Move: drag Alpha into Active after Gamma.
    const gamma = page.locator('.projects-board-column[data-column-id="active"] .projects-board-card[data-project-key="gamma"]');
    const gammaBox = await gamma.boundingBox();
    const dropX = gammaBox ? Math.max(2, Math.floor(gammaBox.width / 2)) : 40;
    const dropY = gammaBox ? Math.max(2, Math.floor(gammaBox.height - 2)) : 40;

    await page.locator('.projects-board-column[data-column-id="backlog"] .projects-board-card[data-project-key="alpha"]').dragTo(
      gamma,
      { targetPosition: { x: dropX, y: dropY } }
    );

    await expect(page.locator('.projects-board-column[data-column-id="backlog"] .projects-board-card')).toHaveCount(1);
    await expect(page.locator('.projects-board-column[data-column-id="backlog"] .projects-board-card').first()).toHaveAttribute('data-project-key', 'beta');

    const activeCards = page.locator('.projects-board-column[data-column-id="active"] .projects-board-card');
    await expect(activeCards).toHaveCount(2);
    await expect(activeCards.nth(0)).toHaveAttribute('data-project-key', 'gamma');
    await expect(activeCards.nth(1)).toHaveAttribute('data-project-key', 'alpha');
  });
});
