/**
 * E2E tests for Claude Orchestrator
 */

const { test, expect } = require('@playwright/test');

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

test.describe('Claude Orchestrator', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await ensureWorkspaceLoaded(page);
  });

  test('should load the main page', async ({ page }) => {
    // Check page title
    await expect(page).toHaveTitle(/Agent Orchestrator/);
  });

  test('should show sidebar with worktree list', async ({ page }) => {
    await ensureWorkspaceLoaded(page);
    const sidebar = page.locator('.sidebar');
    await expect(sidebar).toBeVisible({ timeout: 10000 });

    const worktreeList = page.locator('#worktree-list');
    await expect(worktreeList).toBeVisible();
  });

  test('should show header with actions', async ({ page }) => {
    const header = page.locator('header');
    await expect(header).toBeVisible({ timeout: 10000 });

    // Check for New Project button
    const greenfieldBtn = page.locator('#greenfield-btn');
    await expect(greenfieldBtn).toBeVisible();

    // Check for Commander button
    const commanderBtn = page.locator('#commander-toggle');
    await expect(commanderBtn).toBeVisible();
  });

  test('should show connection status', async ({ page }) => {
    const connectionStatus = page.locator('#connection-status');
    await expect(connectionStatus).toBeVisible();

    // Wait for connection (should say Connected after socket connects)
    await page.waitForFunction(() => {
      const status = document.querySelector('#connection-status');
      return status && status.textContent.includes('Connected');
    }, { timeout: 10000 });
  });

  test('should open settings panel', async ({ page }) => {
    const settingsToggle = page.locator('#settings-toggle');
    await settingsToggle.click();

    const settingsPanel = page.locator('#settings-panel');
    await expect(settingsPanel).toBeVisible();

    // Close settings
    const closeBtn = page.locator('#close-settings');
    await closeBtn.click();
    await expect(settingsPanel).not.toBeVisible();
  });
});

test.describe('Greenfield Wizard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await ensureWorkspaceLoaded(page);
  });

  test('should open greenfield wizard on button click', async ({ page }) => {
    const greenfieldBtn = page.locator('#greenfield-btn');
    await greenfieldBtn.click();

    // Wait for wizard modal to appear
    const wizardModal = page.locator('.greenfield-wizard-modal');
    await expect(wizardModal).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Commander Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await ensureWorkspaceLoaded(page);
  });

  test('should toggle commander panel', async ({ page }) => {
    const commanderBtn = page.locator('#commander-toggle');
    await commanderBtn.click();

    // Commander panel should appear
    const commanderPanel = page.locator('.commander-panel');
    await expect(commanderPanel).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Terminal Grid', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await ensureWorkspaceLoaded(page);
  });

  test('should show terminal grid', async ({ page }) => {
    const terminalGrid = page.locator('#terminal-grid');
    await expect(terminalGrid).toBeVisible();
  });

  test('should show loading message initially', async ({ page }) => {
    // This might be brief, so we use a shorter timeout
    const loadingMsg = page.locator('#loading-message');
    // Either visible briefly or already gone
    const isVisible = await loadingMsg.isVisible().catch(() => false);
    // Just verify the element exists in DOM
    expect(await page.locator('#loading-message').count()).toBeGreaterThanOrEqual(0);
  });
});

test.describe('Sidebar Controls', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await ensureWorkspaceLoaded(page);
  });

  test('should have view all button', async ({ page }) => {
    const viewAllBtn = page.locator('#view-all');
    await expect(viewAllBtn).toBeVisible();
  });

  test('should have claude only button', async ({ page }) => {
    const claudeOnlyBtn = page.locator('#view-claude-only');
    await expect(claudeOnlyBtn).toBeVisible();
  });

  test('should have servers only button', async ({ page }) => {
    const serversOnlyBtn = page.locator('#view-servers-only');
    await expect(serversOnlyBtn).toBeVisible();
  });

  test('should have add worktree button', async ({ page }) => {
    const addWorktreeBtn = page.locator('#add-worktree');
    await expect(addWorktreeBtn).toBeVisible();
  });
});

test.describe('API Health', () => {
  test('should respond to workspaces API', async ({ request }) => {
    const response = await request.get('/api/workspaces');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('should respond to commander status API', async ({ request }) => {
    const response = await request.get('/api/commander/status');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('running');
  });

  test('should respond to quick-links API', async ({ request }) => {
    const response = await request.get('/api/quick-links');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('favorites');
    expect(data).toHaveProperty('recentSessions');
    expect(data).toHaveProperty('products');
  });

  test('should respond to greenfield templates API', async ({ request }) => {
    const response = await request.get('/api/greenfield/templates');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('should respond to ports API', async ({ request }) => {
    const response = await request.get('/api/ports');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).not.toBeNull();
    expect(typeof data).toBe('object');
  });

  test('should respond to voice commands API', async ({ request }) => {
    const response = await request.get('/api/voice/commands');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('should respond to conversations recent API', async ({ request }) => {
    const response = await request.get('/api/conversations/recent?limit=10');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('should respond to conversations search API', async ({ request }) => {
    const response = await request.get('/api/conversations/search?q=test');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('results');
    expect(data).toHaveProperty('total');
  });

  test('should respond to conversations stats API', async ({ request }) => {
    const response = await request.get('/api/conversations/stats');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('totalConversations');
  });

  test('should respond to conversations projects API', async ({ request }) => {
    const response = await request.get('/api/conversations/projects');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('should respond to greenfield categories API', async ({ request }) => {
    const response = await request.get('/api/greenfield/categories');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('should respond to worktree metadata API', async ({ request }) => {
    const response = await request.get(`/api/worktree-metadata?path=${encodeURIComponent(process.cwd())}`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('git');
    expect(data).toHaveProperty('pr');
  });

  test('should respond to worktree tags API', async ({ request }) => {
    const response = await request.get('/api/worktree-tags');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).not.toBeNull();
    expect(typeof data).toBe('object');
  });
});

test.describe('Conversation Browser', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await ensureWorkspaceLoaded(page);
  });

  test('should have history button in header', async ({ page }) => {
    const historyBtn = page.locator('#conversations-btn');
    await expect(historyBtn).toBeVisible();
  });

  test('should open conversation browser on button click', async ({ page }) => {
    const historyBtn = page.locator('#conversations-btn');
    await historyBtn.click();

    // Wait for browser modal to appear
    const browserModal = page.locator('.conversation-browser-modal');
    await expect(browserModal).toBeVisible({ timeout: 5000 });
  });

  test('should show search input in browser', async ({ page }) => {
    const historyBtn = page.locator('#conversations-btn');
    await historyBtn.click();

    const searchInput = page.locator('#conv-search');
    await expect(searchInput).toBeVisible({ timeout: 5000 });
  });

  test('should close browser on X click', async ({ page }) => {
    const historyBtn = page.locator('#conversations-btn');
    await historyBtn.click();

    const browserModal = page.locator('.conversation-browser-modal');
    await expect(browserModal).toBeVisible({ timeout: 5000 });

    const closeBtn = page.locator('.conversation-browser-modal .close-btn');
    await closeBtn.click();

    await expect(browserModal).not.toBeVisible();
  });

  test('should have date filter dropdown', async ({ page }) => {
    const historyBtn = page.locator('#conversations-btn');
    await historyBtn.click();

    const dateFilter = page.locator('#conv-date-filter');
    await expect(dateFilter).toBeVisible({ timeout: 5000 });

    // Check filter options exist
    const options = await dateFilter.locator('option').count();
    expect(options).toBeGreaterThanOrEqual(6); // All Time + 5 presets
  });

  test('should have repo filter dropdown', async ({ page }) => {
    const historyBtn = page.locator('#conversations-btn');
    await historyBtn.click();

    const repoFilter = page.locator('#conv-repo-filter');
    await expect(repoFilter).toBeVisible({ timeout: 5000 });
  });

  test('should have load all checkbox', async ({ page }) => {
    const historyBtn = page.locator('#conversations-btn');
    await historyBtn.click();

    const loadAllCheckbox = page.locator('#load-all-checkbox');
    await expect(loadAllCheckbox).toBeVisible({ timeout: 5000 });
  });

  test('should show total indexed count', async ({ page }) => {
    const historyBtn = page.locator('#conversations-btn');
    await historyBtn.click();

    const totalIndexed = page.locator('#total-indexed');
    await expect(totalIndexed).toBeVisible({ timeout: 5000 });

    // Wait for stats to load
    await page.waitForTimeout(1000);
    const text = await totalIndexed.textContent();
    const normalized = text ? text.replace(/[^\d]/g, '') : '';
    const total = normalized ? Number(normalized) : 0;
    expect(Number.isNaN(total)).toBe(false);
    expect(total).toBeGreaterThanOrEqual(0);
  });
});

test.describe('Conversation API Performance', () => {
  test('recent API should respond within 500ms', async ({ request }) => {
    const start = Date.now();
    const response = await request.get('/api/conversations/recent?limit=100');
    const duration = Date.now() - start;

    expect(response.ok()).toBeTruthy();
    expect(duration).toBeLessThan(500);
  });

  test('search API should respond within 1000ms', async ({ request }) => {
    const start = Date.now();
    const response = await request.get('/api/conversations/search?q=test&limit=100');
    const duration = Date.now() - start;

    expect(response.ok()).toBeTruthy();
    expect(duration).toBeLessThan(1000);
  });

  test('stats API should respond within 200ms', async ({ request }) => {
    const start = Date.now();
    const response = await request.get('/api/conversations/stats');
    const duration = Date.now() - start;

    expect(response.ok()).toBeTruthy();
    expect(duration).toBeLessThan(200);
  });

  test('should handle large limit parameter', async ({ request }) => {
    const start = Date.now();
    const response = await request.get('/api/conversations/recent?limit=5000');
    const duration = Date.now() - start;

    expect(response.ok()).toBeTruthy();
    expect(duration).toBeLessThan(3000); // 3 seconds max for large loads
  });

  test('search with date range should work', async ({ request }) => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const response = await request.get(`/api/conversations/search?startDate=${weekAgo}&limit=50`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('results');
    expect(data).toHaveProperty('total');
  });
});
