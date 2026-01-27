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

const mockTasksApi = async (page) => {
  const cardBase = {
    id: 'c1',
    idList: 'l1',
    name: 'Card 1',
    url: 'https://trello.com/c/AbCdEf12/card-1',
    dateLastActivity: '2026-01-01T00:00:00Z',
    labels: [{ id: 'lab1', name: 'Bug', color: 'red' }],
    idMembers: ['m1'],
    members: [
      { id: 'm1', fullName: 'Alice', username: 'alice', avatarUrl: 'https://trello-avatars.s3.amazonaws.com/abc123' }
    ],
    customFieldItems: [
      { idCustomField: 'cf_text', value: { text: 'old' } },
      { idCustomField: 'cf_check', value: { checked: 'false' } }
    ],
    checklists: [],
    actions: []
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
        lists: [
          { id: 'l1', name: 'To Do', pos: 1 },
          { id: 'l2', name: 'Doing', pos: 2 }
        ]
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

  await page.route('**/api/tasks/boards/b1/labels**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        provider: 'trello',
        boardId: 'b1',
        labels: [
          { id: 'lab1', name: 'Bug', color: 'red' },
          { id: 'lab2', name: 'UI', color: 'blue' }
        ]
      })
    });
  });

  await page.route('**/api/tasks/boards/b1/custom-fields**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        provider: 'trello',
        boardId: 'b1',
        customFields: [
          { id: 'cf_text', name: 'Notes', type: 'text' },
          { id: 'cf_check', name: 'Ready', type: 'checkbox' },
          {
            id: 'cf_list',
            name: 'Size',
            type: 'list',
            options: [
              { id: 'opt_s', value: { text: 'S' } },
              { id: 'opt_m', value: { text: 'M' } }
            ]
          }
        ]
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
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      const ids = Array.isArray(body?.idLabels) ? body.idLabels : [];
      const nextLabels = [
        ...(ids.includes('lab1') ? [{ id: 'lab1', name: 'Bug', color: 'red' }] : []),
        ...(ids.includes('lab2') ? [{ id: 'lab2', name: 'UI', color: 'blue' }] : [])
      ];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          provider: 'trello',
          cardId: 'c1',
          card: { ...cardBase, labels: nextLabels }
        })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ provider: 'trello', cardId: 'c1', card: cardBase })
    });
  });

  await page.route('**/api/tasks/cards/c1/custom-fields/cf_text?*', async (route) => {
    const body = route.request().postDataJSON();
    const text = body?.value?.text ?? '';
    const next = {
      ...cardBase,
      customFieldItems: [
        { idCustomField: 'cf_text', value: { text } },
        { idCustomField: 'cf_check', value: { checked: 'false' } }
      ]
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ provider: 'trello', cardId: 'c1', card: next })
    });
  });

  await page.route('**/api/tasks/cards/c1/custom-fields/cf_check?*', async (route) => {
    const body = route.request().postDataJSON();
    const checked = String(body?.value?.checked || 'false');
    const next = {
      ...cardBase,
      customFieldItems: [
        { idCustomField: 'cf_text', value: { text: 'old' } },
        { idCustomField: 'cf_check', value: { checked } }
      ]
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ provider: 'trello', cardId: 'c1', card: next })
    });
  });
};

test.describe('Tasks card edits', () => {
  test('can toggle labels and edit custom fields', async ({ page }) => {
    await mockUserSettings(page);
    await mockTasksApi(page);
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('/');
    await ensureWorkspaceLoaded(page);
    await dismissFocusOverlay(page);

    // Open Tasks
    await page.evaluate(() => document.getElementById('tasks-btn')?.click());
    await expect(page.locator('#tasks-panel')).toBeVisible({ timeout: 10000 });

    // Select the mock board (list view default); it should default to All lists.
    await page.locator('#tasks-board').selectOption('b1');
    await expect(page.locator('#tasks-list')).toHaveValue('__all__');

    // Open the card detail.
    await page.locator('.task-card-row[data-card-id="c1"]').click();
    await expect(page.locator('#tasks-card-title')).toHaveValue('Card 1');

    // Trello avatarUrl needs a `/<size>.png` suffix to load (otherwise it can look like an S3 root fetch).
    await expect(page.locator('.tasks-chip-avatar')).toHaveAttribute('src', /trello-avatars\.s3\.amazonaws\.com\/abc123\/50\.png$/);

    // Toggle a label (add UI label).
    const labelReqPromise = page.waitForRequest((req) => {
      if (req.method() !== 'PUT') return false;
      try {
        return new URL(req.url()).pathname === '/api/tasks/cards/c1';
      } catch {
        return false;
      }
    }, { timeout: 5000 });
    await page.getByRole('button', { name: /^UI$/ }).click();
    const labelReq = await labelReqPromise;
    expect(labelReq.postDataJSON()).toEqual({ idLabels: ['lab1', 'lab2'] });

    // Edit a custom text field (blur triggers save).
    const cfTextReqPromise = page.waitForRequest((req) => req.method() === 'PUT' && req.url().includes('/api/tasks/cards/c1/custom-fields/cf_text'), { timeout: 5000 });
    const notesInput = page.locator('.tasks-cf-input[data-cf-id="cf_text"]');
    await notesInput.fill('hello');
    await notesInput.press('Enter');
    const cfTextReq = await cfTextReqPromise;
    expect(cfTextReq.postDataJSON()).toEqual({ value: { text: 'hello' } });

    // Toggle a checkbox custom field (change triggers save).
    const cfCheckReqPromise = page.waitForRequest((req) => req.method() === 'PUT' && req.url().includes('/api/tasks/cards/c1/custom-fields/cf_check'), { timeout: 5000 });
    await page.locator('.tasks-cf-input[data-cf-id="cf_check"]').check();
    const cfCheckReq = await cfCheckReqPromise;
    expect(cfCheckReq.postDataJSON()).toEqual({ value: { checked: 'true' } });
  });
});
