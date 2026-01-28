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

test.describe('Commander terminal paste', () => {
  test.beforeEach(async ({ page }) => {
    await mockUserSettings(page);

    // Keep startup fast + deterministic for this test.
    await page.route(/.*\/api\/process\/task-records$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ count: 0, records: [] })
      });
    });

    await page.route(/.*\/api\/process\/tasks.*/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ tasks: [] })
      });
    });

    await page.route('**/api/commander/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ running: true, ready: true })
      });
    });

    await page.route('**/api/commander/output**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ output: '' })
      });
    });
  });

  test('Ctrl+V pastes text into the Commander terminal', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    const pasted = 'hello from clipboard';

    await page.route('**/api/commander/input', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    await page.goto('/');
    await ensureWorkspaceLoaded(page);
    await dismissFocusOverlay(page);

    // Open Commander panel.
    await page.locator('#commander-toggle').click();
    await expect(page.locator('#commander-panel')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#commander-terminal .xterm')).toBeVisible({ timeout: 10000 });

    // Put text into clipboard.
    await page.evaluate(async (text) => {
      await navigator.clipboard.writeText(text);
    }, pasted);

    const inputReqPromise = page.waitForRequest((req) => {
      if (req.method() !== 'POST') return false;
      try {
        return new URL(req.url()).pathname === '/api/commander/input';
      } catch {
        return false;
      }
    }, { timeout: 10000 });

    // Focus the terminal and paste.
    await page.locator('#commander-terminal').click();
    await page.keyboard.press('Control+V');

    const req = await inputReqPromise;
    expect(req.postDataJSON()).toEqual({ input: pasted });
  });
});
