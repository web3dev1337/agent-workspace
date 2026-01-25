const { test, expect } = require('@playwright/test');
const { mockUserSettings } = require('./_mockUserSettings');

test.describe('Launch gating', () => {
  test('prompts when Tier 1/2 launch is gated', async ({ page }) => {
    test.setTimeout(60000);

    await mockUserSettings(page);

    await page.route(/.*\/api\/process\/task-records$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 1,
          records: [
            { id: 'worktree:/tmp/demo', tier: 1 }
          ]
        })
      });
    });

    await page.route(/.*\/api\/process\/status.*/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          mode: 'mine',
          lookbackHours: 24,
          wip: 1,
          wipKind: 'workspaces',
          wipMax: 3,
          qByTier: { 1: 4, 2: 0, 3: 0, 4: 0, none: 0 },
          q12: 4,
          qTotal: 4,
          qCaps: { q12: 3, q3: 6, q4: 10 },
          level: 'warn',
          reasons: ['q12'],
          launchAllowedByTier: { 1: false, 2: false, 3: true, 4: true }
        })
      });
    });

    await page.route(/.*\/api\/user-settings\/effective\/.*/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ claudeFlags: { skipPermissions: false }, autoStart: { mode: 'fresh' } })
      });
    });

    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('/');

    // Seed a session and override confirm() to cancel.
    const seeded = await page.evaluate(() => {
      window._confirmCalls = 0;
      window.confirm = () => {
        window._confirmCalls += 1;
        return false;
      };

      if (!window.orchestrator) return { ok: false };
      window.orchestrator.socket?.disconnect?.();
      window.orchestrator.socket = { connected: true, emit: () => { window._emitCalls = (window._emitCalls || 0) + 1; } };
      window.orchestrator.sessions = new Map([['demo-claude', { type: 'claude', config: { cwd: '/tmp/demo/work1' } }]]);
      window.orchestrator.visibleTerminals = new Set(['demo-claude']);
      window.orchestrator.taskRecords = new Map([['worktree:/tmp/demo', { tier: 1 }]]);
      window.orchestrator.showToast = () => {};
      return { ok: true };
    });

    expect(seeded.ok).toBeTruthy();

    await page.evaluate(async () => {
      await window.orchestrator.startClaudeWithOptions('demo-claude', 'fresh', false);
    });

    const calls = await page.evaluate(() => ({ confirm: window._confirmCalls || 0, emit: window._emitCalls || 0 }));
    expect(calls.confirm).toBe(1);
    expect(calls.emit).toBe(0);

    // Now allow confirm; it should emit once.
    await page.evaluate(() => {
      window._emitCalls = 0;
      window.confirm = () => true;
    });

    await page.evaluate(async () => {
      await window.orchestrator.startClaudeWithOptions('demo-claude', 'fresh', false);
    });

    const calls2 = await page.evaluate(() => ({ emit: window._emitCalls || 0 }));
    expect(calls2.emit).toBe(1);
  });
});

