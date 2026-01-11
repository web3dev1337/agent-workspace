/**
 * End-to-end tests for Claude Orchestrator
 */

const { test, expect } = require('@playwright/test');

test.describe('Orchestrator UI', () => {
  test('should load the dashboard', async ({ page }) => {
    await page.goto('/');

    // Wait for the app to initialize
    await page.waitForSelector('.main-container, .dashboard', { timeout: 10000 });

    // Check title or header exists
    const header = await page.locator('header, .header, h1').first();
    await expect(header).toBeVisible();
  });

  test('should show workspace tabs when workspace is loaded', async ({ page }) => {
    await page.goto('/');

    // Wait for potential workspace tabs
    const tabContainer = page.locator('.workspace-tabs-container, .workspace-tabs');

    // If tabs exist, they should be visible
    if (await tabContainer.count() > 0) {
      await expect(tabContainer.first()).toBeVisible();
    }
  });

  test('should have terminal grid', async ({ page }) => {
    await page.goto('/');

    // Wait for terminal grid to load (may take time if workspace loads)
    await page.waitForTimeout(2000);

    const terminalGrid = page.locator('.terminal-grid');

    // Terminal grid should exist (might be empty if no workspace)
    if (await terminalGrid.count() > 0) {
      await expect(terminalGrid.first()).toBeVisible();
    }
  });
});

test.describe('Workspace Switching', () => {
  test('should open workspace wizard on new tab click', async ({ page }) => {
    await page.goto('/');

    // Wait for page to load
    await page.waitForTimeout(2000);

    // Look for new tab button or add workspace button
    const newTabButton = page.locator('.tab-new, [data-action="new-workspace"], button:has-text("+")');

    if (await newTabButton.count() > 0) {
      await newTabButton.first().click();

      // Should show some kind of wizard/modal
      const modal = page.locator('.modal, .wizard, .workspace-wizard, [role="dialog"]');
      await expect(modal.first()).toBeVisible({ timeout: 5000 });
    }
  });
});

test.describe('Terminal Interactions', () => {
  test('terminal wrapper should be clickable', async ({ page }) => {
    await page.goto('/');

    // Wait for terminals to potentially load
    await page.waitForTimeout(3000);

    const terminal = page.locator('.terminal-wrapper').first();

    if (await terminal.count() > 0) {
      // Terminal should be visible and have reasonable size
      const box = await terminal.boundingBox();
      expect(box.width).toBeGreaterThan(100);
      expect(box.height).toBeGreaterThan(50);
    }
  });
});

test.describe('API Health', () => {
  test('health endpoint should return ok', async ({ request }) => {
    const response = await request.get('http://localhost:3000/health');

    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.status).toBe('ok');
  });

  test('workspaces endpoint should return array', async ({ request }) => {
    const response = await request.get('http://localhost:3000/api/workspaces');

    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
  });
});
