const { test, expect } = require('@playwright/test');
const { mockUserSettings } = require('./_mockUserSettings');

test.describe('Quick Work start tier', () => {
  test('applyStartTierToNewSessions sets tier for agent session only', async ({ page }) => {
    test.setTimeout(60000);
    await mockUserSettings(page);

    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('/');
    await page.waitForFunction(() => !!window.orchestrator, { timeout: 30000 });

    const result = await page.evaluate(async () => {
      window.__upserts = [];

      // Avoid UI dependencies.
      window.orchestrator.buildSidebar = () => {};
      window.orchestrator.updateTerminalGrid = () => {};
      window.orchestrator.refreshTier1Busy = () => {};

      window.orchestrator.taskRecords = new Map();
      window.orchestrator.upsertTaskRecord = async (id, patch) => {
        window.__upserts.push({ id, patch });
        return { ...(patch || {}) };
      };

      await window.orchestrator.applyStartTierToNewSessions(
        ['demo-work1-claude', 'demo-work1-server'],
        3
      );

      return {
        upserts: window.__upserts,
        agentTier: window.orchestrator.taskRecords.get('session:demo-work1-claude')?.tier,
        serverTier: window.orchestrator.taskRecords.get('session:demo-work1-server')?.tier
      };
    });

    expect(result.agentTier).toBe(3);
    expect(result.serverTier).toBeUndefined();
    expect(result.upserts).toEqual([{ id: 'session:demo-work1-claude', patch: { tier: 3 } }]);
  });
});

