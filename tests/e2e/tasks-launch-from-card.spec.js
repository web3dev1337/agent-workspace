const { test, expect } = require('@playwright/test');
const { mockUserSettings } = require('./_mockUserSettings');

const ensureOrchestratorReady = async (page) => {
  await page.waitForFunction(() => window.orchestrator?.socket?.connected === true, {
    timeout: 20000
  });
};

const dismissFocusOverlay = async (page) => {
  const overlay = page.locator('#focus-overlay.active');
  if (await overlay.isVisible().catch(() => false)) {
    await page.locator('#focus-overlay .focus-close-btn').click();
    await expect(overlay).toBeHidden();
  }
};

const mockTasksApi = async (page) => {
  const cardBase = {
    id: 'c1',
    idList: 'l1',
    name: 'Card 1',
    url: 'https://trello.com/c/AbCdEf12/card-1',
    dateLastActivity: '2026-01-01T00:00:00Z',
    labels: [],
    idMembers: ['m1'],
    members: [{ id: 'm1', fullName: 'Alice', username: 'alice', avatarUrl: 'https://trello-avatars.s3.amazonaws.com/abc123' }],
    customFieldItems: [],
    checklists: [],
    actions: [],
    desc: 'Do the thing.\n\nSteps:\n- A\n- B\n'
  };

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
        boards: [{ id: 'b1', name: 'Mock Board', prefs: { backgroundColor: '#2ea043' } }]
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
        members: [{ id: 'm1', fullName: 'Alice', username: 'alice', avatarUrl: 'https://trello-avatars.s3.amazonaws.com/abc123' }]
      })
    });
  });

  await page.route('**/api/tasks/boards/b1/cards**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        provider: 'trello',
        boardId: 'b1',
        cards: [cardBase]
      })
    });
  });

  await page.route(/\/api\/tasks\/cards\/c1(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ provider: 'trello', cardId: 'c1', card: cardBase })
    });
  });
};

test.describe('Tasks launch from card', () => {
  test('emits add-worktree-sessions using board mapping and selected tier', async ({ page }) => {
    await mockUserSettings(page, {
      initial: {
        version: 'test',
        global: {
          ui: {
            theme: 'dark',
            tasks: {
              theme: 'inherit',
              launch: {
                globalPromptPrefix: 'GLOBAL PREFIX',
                includeTicketTitle: true
              },
              me: { trelloUsername: '' },
              filters: { assigneesByBoard: {} },
              kanban: { collapsedByBoard: {}, expandedByBoard: {}, layoutByBoard: {} },
              boardMappings: {
                'trello:b1': { enabled: true, localPath: 'games/hytopia/mock-repo', promptPrefix: 'BOARD PREFIX', defaultStartTier: 3 }
              }
            }
          }
        },
        perTerminal: {}
      }
    });
    await mockTasksApi(page);

    // Mock repo scan to provide the mapped repo and a worktree entry.
    await page.route('**/api/workspaces/scan-repos**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            name: 'mock-repo',
            path: '/home/test/GitHub/games/hytopia/mock-repo',
            relativePath: 'games/hytopia/mock-repo',
            type: 'hytopia-game',
            category: 'Hytopia Games',
            // Use a non-standard worktree ID to avoid collisions with whatever
            // sessions the dev server may have loaded from disk.
            worktreeDirs: [{ id: 'work99', path: '/home/test/GitHub/games/hytopia/mock-repo/work99', number: 99, lastModifiedMs: 1 }]
          }
        ])
      });
    });

    await page.goto('/');
    await ensureOrchestratorReady(page);
    await dismissFocusOverlay(page);

    // Open Tasks and select the board (without needing to open a workspace first).
    await page.evaluate(async () => {
      if (window.orchestrator) {
        window.orchestrator.sessions = new Map();
        window.orchestrator.currentWorkspace = {
          id: 'test-workspace',
          name: 'Test Workspace',
          workspaceType: 'mixed-repo',
          terminals: [],
          repository: null
        };
        await window.orchestrator.showTasksPanel();
      }
    });
    await expect(page.locator('#tasks-panel')).toBeVisible({ timeout: 10000 });
    await page.locator('#tasks-board').selectOption({ value: 'b1' });

    // Click card and open detail.
    await page.locator('.task-card-row[data-card-id="c1"] .task-card-list-main').click();
    await expect(page.locator('#tasks-card-title')).toHaveValue('Card 1');

    // Hook socket.emit to capture the add-worktree-sessions payload.
    await page.evaluate(() => {
      window.__capturedEmits = [];
      window.__capturedToasts = [];
      if (window.orchestrator?.showToast) {
        const originalToast = window.orchestrator.showToast.bind(window.orchestrator);
        window.orchestrator.showToast = (msg, kind) => {
          window.__capturedToasts.push({ msg: String(msg || ''), kind: String(kind || '') });
          return originalToast(msg, kind);
        };
      }
      const sock = window.orchestrator?.socket;
      const original = sock?.emit?.bind(sock);
      if (!sock || !original) return;
      sock.emit = (event, payload) => {
        window.__capturedEmits.push({ event, payload });
        return original(event, payload);
      };
    });

    // Sanity: verify the emit hook is active.
    await page.evaluate(() => window.orchestrator?.socket?.emit?.('___probe', { ok: true }));
    const probe = await page.evaluate(() => (window.__capturedEmits || []).some(e => e.event === '___probe'));
    expect(probe).toBeTruthy();

    // Hook pendingWorktreeLaunches.set so we can capture the prompt even if the entry is
    // immediately consumed and removed by fast worktree-sessions-added events.
    await page.evaluate(() => {
      window.__pendingLaunchCalls = [];
      const map = window.orchestrator?.pendingWorktreeLaunches;
      if (!map || map.__patchedForE2E) return;
      const original = map.set.bind(map);
      map.set = (key, value) => {
        window.__pendingLaunchCalls.push({ key: String(key || ''), value });
        return original(key, value);
      };
      map.__patchedForE2E = true;
    });

    // Launch via the orchestrator method (less flaky than relying on click timing).
    await page.evaluate(async () => {
      await window.orchestrator.launchAgentFromTaskCard({
        provider: 'trello',
        boardId: 'b1',
        card: { id: 'c1', name: 'Card 1', url: 'https://trello.com/c/AbCdEf12/card-1', desc: 'Do the thing.' },
        tier: 2,
        agentId: 'claude',
        mode: 'fresh',
        yolo: true,
        autoSendPrompt: true,
        promptText: 'Do the thing.'
      });
    });

    const promptText = await page.evaluate(() => {
      const entries = window.__pendingLaunchCalls || [];
      const match = entries.find(e => e.key === 'work99');
      return String(match?.value?.promptText || '');
    });
    expect(promptText).toContain('GLOBAL PREFIX');
    expect(promptText).toContain('BOARD PREFIX');
    expect(promptText).toContain('Ticket title: Card 1');
    expect(promptText).toContain('Do the thing.');
    expect(promptText.indexOf('GLOBAL PREFIX')).toBeLessThan(promptText.indexOf('Task context:'));

    // Verify emit.
    const emitted = await page.evaluate(() => (window.__capturedEmits || []).filter(e => e.event === 'add-worktree-sessions'));
    expect(emitted.length).toBeGreaterThan(0);
    const last = emitted[emitted.length - 1].payload;
    expect(last.worktreeId).toBe('work99');
    expect(last.repositoryName).toBe('mock-repo');
    expect(last.repositoryRoot).toBe('/home/test/GitHub/games/hytopia/mock-repo');
    expect(last.startTier).toBe(2);
  });
});
