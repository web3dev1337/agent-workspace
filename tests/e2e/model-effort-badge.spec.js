const { test, expect } = require('@playwright/test');

// Some environments show the dashboard with an "Open Workspace" button first,
// others auto-open the only workspace — handle both.
const ensureWorkspaceLoaded = async (page) => {
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.waitForFunction(() => window.orchestrator?.socket?.connected === true, {
      timeout: 20000
    });

    const sidebar = page.locator('.sidebar:not(.hidden)');
    const openWorkspaceBtn = page.getByRole('button', { name: 'Open Workspace' }).first();
    try {
      await Promise.race([
        sidebar.waitFor({ state: 'visible', timeout: 20000 }),
        openWorkspaceBtn.waitFor({ state: 'visible', timeout: 20000 })
      ]);
    } catch {
      await page.reload();
      continue;
    }

    if (await openWorkspaceBtn.isVisible().catch(() => false)) {
      await openWorkspaceBtn.click();
      await page.waitForSelector('#recovery-dialog, .sidebar:not(.hidden)', { timeout: 20000 });
      const recoverySkipBtn = page.locator('#recovery-skip');
      if (await recoverySkipBtn.isVisible().catch(() => false)) {
        await recoverySkipBtn.click();
      }
    }

    await page.waitForSelector('.sidebar:not(.hidden)', { timeout: 20000 });
    return;
  }

  throw new Error('Failed to load workspace for tests.');
};

test.describe('Model/effort badge', () => {
  test('shows the resolved model and effort on agent terminal headers', async ({ page }) => {
    test.setTimeout(60000);

    await page.route(/.*\/api\/sessions\/model-config$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          codex: {
            agent: 'codex',
            model: 'gpt-5.3-codex',
            effortLevel: 'xhigh',
            modelSource: null,
            effortSource: null
          },
          sessions: {
            'demo-work1-claude': {
              cwd: '/tmp/demo/work1',
              claude: {
                agent: 'claude',
                model: 'claude-fable-5[1m]',
                effortLevel: 'xhigh',
                modelSource: {
                  label: 'user settings (global)',
                  file: '/home/demo/.claude/settings.json'
                },
                effortSource: {
                  label: 'local settings',
                  file: '/tmp/demo/work1/.claude/settings.local.json'
                }
              }
            }
          }
        })
      });
    });

    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('/');
    await ensureWorkspaceLoaded(page);

    await page.waitForFunction(() => !!window.orchestrator, { timeout: 30000 });

    await page.evaluate(() => {
      const id = 'demo-work1-claude';
      window.orchestrator.showActiveOnly = false;
      window.orchestrator.workflowMode = 'review';
      window.orchestrator.viewMode = 'all';
      window.orchestrator.tierFilter = 'all';
      window.orchestrator.sessions = new Map([
        [id, { sessionId: id, type: 'claude', status: 'busy', branch: 'main', worktreeId: 'work1' }]
      ]);
      window.orchestrator.visibleTerminals = new Set([id]);
      window.orchestrator.taskRecords = new Map();
      window.orchestrator.updateTerminalGrid();
    });

    const badge = page.locator('.terminal-wrapper[data-session-id="demo-work1-claude"] .terminal-model-badge');
    await expect(badge).toBeVisible({ timeout: 20000 });
    await expect(badge).toContainText('fable-5[1m]');
    await expect(badge).toContainText('XHIGH');
    await expect(badge).toHaveAttribute('data-effort', 'xhigh');

    const tooltip = await badge.getAttribute('title');
    expect(tooltip).toContain('local settings');
    expect(tooltip).toContain('settings.local.json');

    // A session-only /model pick ('s') is read from the terminal's confirmation line
    // (ANSI bold codes included) and overrides the badge's model for that session only.
    await page.evaluate(() => {
      const ESC = String.fromCharCode(27); // real ANSI escape, as the PTY emits it
      window.orchestrator.detectModelChangeFromOutput(
        'demo-work1-claude',
        `Set model to ${ESC}[1mSonnet 5${ESC}[22m for this session only\r\n`
      );
    });
    await expect(badge).toContainText('Sonnet 5');
    await expect(badge).toHaveAttribute('data-session-override', 'true');
    expect(await badge.getAttribute('title')).toContain('THIS session only');

    // Saving a default (Enter) clears the session override; the settings value shows again.
    await page.evaluate(() => {
      const ESC = String.fromCharCode(27);
      window.orchestrator.detectModelChangeFromOutput(
        'demo-work1-claude',
        `Set model to ${ESC}[1mOpus 4.8 (1M context)${ESC}[22m and saved as your default for new sessions\r\n`
      );
    });
    await expect(badge).toContainText('fable-5[1m]');
    await expect(badge).toHaveAttribute('data-session-override', 'false');
  });
});
