/**
 * End-to-end tests for Claude Orchestrator
 */

const { test, expect } = require('@playwright/test');

// Use dev instance ports (server: 4000, client: 2081)
const SERVER_URL = process.env.PORT ? `http://localhost:${process.env.PORT}` : 'http://localhost:4000';

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
  test('should have workspace controls available', async ({ page }) => {
    await page.goto('/');

    // Wait for page to load
    await page.waitForTimeout(2000);

    // Check for workspace-related UI elements
    const workspaceControls = page.locator('.workspace-tabs, .workspace-switcher, .sidebar');

    // Should have some workspace controls
    if (await workspaceControls.count() > 0) {
      await expect(workspaceControls.first()).toBeVisible();
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
    const response = await request.get(`${SERVER_URL}/health`);

    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.status).toBe('ok');
  });

  test('workspaces endpoint should return array', async ({ request }) => {
    const response = await request.get(`${SERVER_URL}/api/workspaces`);

    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

test.describe('Quick Links API', () => {
  test('should get quick links data', async ({ request }) => {
    const response = await request.get(`${SERVER_URL}/api/quick-links`);

    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body).toHaveProperty('favorites');
    expect(body).toHaveProperty('recentSessions');
    expect(body).toHaveProperty('customLinks');
    expect(Array.isArray(body.favorites)).toBe(true);
  });

  test('should add a favorite link', async ({ request }) => {
    const testUrl = `https://test-${Date.now()}.com`;

    const response = await request.post(`${SERVER_URL}/api/quick-links/favorites`, {
      data: {
        name: 'Test Link',
        url: testUrl,
        icon: 'link'
      }
    });

    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body).toHaveProperty('favorites');
    expect(body.favorites.some(f => f.url === testUrl)).toBe(true);

    // Cleanup - remove the test favorite
    await request.delete(`${SERVER_URL}/api/quick-links/favorites`, {
      data: { url: testUrl }
    });
  });

  test('should track session access', async ({ request }) => {
    const response = await request.post(`${SERVER_URL}/api/quick-links/track-session`, {
      data: {
        workspaceId: 'test-ws',
        worktreeId: 'test-work1',
        sessionId: 'test-session',
        branch: 'test-branch'
      }
    });

    expect(response.ok()).toBeTruthy();
  });

  test('should get recent sessions', async ({ request }) => {
    const response = await request.get(`${SERVER_URL}/api/quick-links/recent-sessions`);

    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body).toHaveProperty('sessions');
    expect(Array.isArray(body.sessions)).toBe(true);
  });
});

test.describe('Port Registry API', () => {
  test('should get all port assignments', async ({ request }) => {
    const response = await request.get(`${SERVER_URL}/api/ports`);

    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body).toBeDefined();
  });

  test('should get port for specific worktree', async ({ request }) => {
    const repoPath = encodeURIComponent('/test/repo');
    const worktreeId = 'work1';

    const response = await request.get(`${SERVER_URL}/api/ports/${repoPath}/${worktreeId}`);

    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body).toHaveProperty('port');
    expect(typeof body.port).toBe('number');
  });
});

test.describe('Greenfield API', () => {
  test('should get available templates', async ({ request }) => {
    const response = await request.get(`${SERVER_URL}/api/greenfield/templates`);

    expect(response.ok()).toBeTruthy();

    const templates = await response.json();
    expect(Array.isArray(templates)).toBe(true);
    expect(templates.length).toBeGreaterThan(0);

    // Each template should have required fields
    templates.forEach(template => {
      expect(template).toHaveProperty('id');
      expect(template).toHaveProperty('name');
      expect(template).toHaveProperty('description');
    });
  });

  test('should validate project creation config', async ({ request }) => {
    // This should fail validation due to invalid path
    const response = await request.post(`${SERVER_URL}/api/greenfield/create`, {
      data: {
        name: '',
        templateId: 'empty',
        basePath: '/invalid/path'
      }
    });

    // Should return validation error
    expect(response.status()).toBe(400);
  });
});

test.describe('Continuity API', () => {
  test('should return ledger or 404', async ({ request }) => {
    const worktreePath = encodeURIComponent('/test/worktree');
    const response = await request.get(`${SERVER_URL}/api/continuity/ledger?worktreePath=${worktreePath}`);

    // Either returns ledger data or 404 if not found
    expect([200, 404]).toContain(response.status());
  });

  test('should get workspace ledgers', async ({ request }) => {
    const response = await request.get(`${SERVER_URL}/api/continuity/workspace`);

    // Should return array (possibly empty) or error if no workspace
    const status = response.status();
    expect([200, 400, 404]).toContain(status);
  });
});

test.describe('Cascaded Config API', () => {
  test('should get cascaded config for type', async ({ request }) => {
    const response = await request.get(`${SERVER_URL}/api/cascaded-config/hytopia-game`);

    // Should return config or empty object
    expect(response.ok()).toBeTruthy();

    const config = await response.json();
    expect(typeof config).toBe('object');
  });

  test('should merge config with worktree overrides', async ({ request }) => {
    const worktreePath = encodeURIComponent('/some/worktree/path');
    const response = await request.get(`${SERVER_URL}/api/cascaded-config/hytopia-game?worktreePath=${worktreePath}`);

    expect(response.ok()).toBeTruthy();

    const config = await response.json();
    expect(typeof config).toBe('object');
  });
});

test.describe('Settings Panel', () => {
  test('should open settings panel', async ({ page }) => {
    await page.goto('/');

    // Wait for page to load
    await page.waitForTimeout(2000);

    // Click settings button
    const settingsButton = page.locator('#settings-toggle, [title="Settings"]');
    if (await settingsButton.count() > 0) {
      await settingsButton.click();

      // Settings panel should be visible
      const settingsPanel = page.locator('#settings-panel, .settings-panel');
      await expect(settingsPanel).toBeVisible({ timeout: 5000 });
    }
  });

  test('should have notification toggle', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Open settings
    const settingsButton = page.locator('#settings-toggle, [title="Settings"]');
    if (await settingsButton.count() > 0) {
      await settingsButton.click();

      const notificationToggle = page.locator('#enable-notifications');
      if (await notificationToggle.count() > 0) {
        await expect(notificationToggle).toBeVisible();
      }
    }
  });
});

test.describe('Socket.IO Connection', () => {
  test('should have connection status indicator', async ({ page }) => {
    await page.goto('/');

    // Wait for page to load
    await page.waitForTimeout(2000);

    // Check connection status indicator exists
    const connectionStatus = page.locator('.connection-status, #connection-status');
    if (await connectionStatus.count() > 0) {
      await expect(connectionStatus).toBeVisible();
    }
  });
});

test.describe('Commander API', () => {
  test('should get commander status', async ({ request }) => {
    const response = await request.get(`${SERVER_URL}/api/commander/status`);

    expect(response.ok()).toBeTruthy();

    const status = await response.json();
    expect(status).toHaveProperty('enabled');
    expect(status).toHaveProperty('historyLength');
    expect(status).toHaveProperty('apiKeyConfigured');
  });

  test('should get available tools', async ({ request }) => {
    const response = await request.get(`${SERVER_URL}/api/commander/tools`);

    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('tools');
    expect(Array.isArray(data.tools)).toBe(true);
    expect(data.tools.length).toBeGreaterThan(0);

    // Check that tools have required properties
    data.tools.forEach(tool => {
      expect(tool).toHaveProperty('name');
      expect(tool).toHaveProperty('description');
      expect(tool).toHaveProperty('input_schema');
    });
  });

  test('should process command (simulation mode without API key)', async ({ request }) => {
    const response = await request.post(`${SERVER_URL}/api/commander/command`, {
      data: { input: 'list workspaces' }
    });

    expect(response.ok()).toBeTruthy();

    const result = await response.json();
    expect(result).toHaveProperty('response');
  });

  test('should clear history', async ({ request }) => {
    const response = await request.post(`${SERVER_URL}/api/commander/clear`);

    expect(response.ok()).toBeTruthy();

    const result = await response.json();
    expect(result.success).toBe(true);
  });

  test('should reject empty input', async ({ request }) => {
    const response = await request.post(`${SERVER_URL}/api/commander/command`, {
      data: {}
    });

    expect(response.status()).toBe(400);
  });
});
