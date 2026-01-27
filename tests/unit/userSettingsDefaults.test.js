const { UserSettingsService } = require('../../server/userSettingsService');

describe('UserSettingsService defaults', () => {
  test('includes ui.tasks.boardMappings', () => {
    const defaults = UserSettingsService.prototype.getDefaultSettings.call({});
    expect(defaults?.global?.ui?.tasks).toBeTruthy();
    expect(defaults.global.ui.tasks.boardMappings).toBeTruthy();
    expect(typeof defaults.global.ui.tasks.boardMappings).toBe('object');
  });

  test('includes ui.workflow focus defaults', () => {
    const defaults = UserSettingsService.prototype.getDefaultSettings.call({});
    expect(defaults?.global?.ui?.workflow).toBeTruthy();
    expect(defaults.global.ui.workflow.mode).toBeTruthy();
    expect(defaults.global.ui.workflow.focus).toBeTruthy();
    expect(defaults.global.ui.workflow.focus.hideTier2WhenTier1Busy).toBe(true);
    expect(defaults.global.ui.workflow.focus.autoSwapToTier2WhenTier1Busy).toBe(false);
    expect(defaults.global.ui.workflow.notifications).toBeTruthy();
    expect(defaults.global.ui.workflow.notifications.mode).toBeTruthy();
  });

  test('includes ui.worktrees auto-create defaults', () => {
    const defaults = UserSettingsService.prototype.getDefaultSettings.call({});
    expect(defaults?.global?.ui?.worktrees).toBeTruthy();
    expect(typeof defaults.global.ui.worktrees.autoCreateExtraWhenBusy).toBe('boolean');
    expect(typeof defaults.global.ui.worktrees.autoCreateMinNumber).toBe('number');
    expect(typeof defaults.global.ui.worktrees.autoCreateMaxNumber).toBe('number');
    expect(typeof defaults.global.ui.worktrees.considerOtherWorkspaces).toBe('boolean');
  });

  test('includes ui.tasks.automations.trello.onPrMerged defaults', () => {
    const defaults = UserSettingsService.prototype.getDefaultSettings.call({});
    const cfg = defaults?.global?.ui?.tasks?.automations?.trello?.onPrMerged;
    expect(cfg).toBeTruthy();
    expect(typeof cfg.enabled).toBe('boolean');
    expect(typeof cfg.comment).toBe('boolean');
    expect(typeof cfg.moveToDoneList).toBe('boolean');
    expect(typeof cfg.pollMs).toBe('number');
  });

  test('mergeSettings deep-merges ui.tasks without dropping defaults', () => {
    const defaults = UserSettingsService.prototype.getDefaultSettings.call({});
    const merged = UserSettingsService.prototype.mergeSettings.call({}, defaults, {
      global: {
        ui: {
          workflow: {
            mode: 'focus'
          },
          tasks: {
            boardMappings: {
              'trello:b1': { enabled: true, localPath: 'games/hytopia/mock-repo', defaultStartTier: 3 }
            },
            combined: {
              selections: [{ boardId: 'b1', listId: 'l1' }],
              presets: [{ id: 'p1', name: 'My preset', selections: [{ boardId: 'b1', listId: 'l1' }] }],
              activePresetId: 'p1'
            },
            automations: {
              trello: {
                onPrMerged: { enabled: true }
              }
            }
          }
        }
      }
    });

    // Keeps the new mapping.
    expect(merged.global.ui.tasks.boardMappings['trello:b1']).toBeTruthy();
    // Does not drop default nested keys when only partially provided.
    expect(merged.global.ui.tasks.kanban).toBeTruthy();
    expect(merged.global.ui.tasks.kanban.layoutByBoard).toBeTruthy();
    expect(merged.global.ui.tasks.filters).toBeTruthy();
    expect(merged.global.ui.tasks.filters.assigneesByBoard).toBeTruthy();
    // Keeps combined view selections when provided.
    expect(Array.isArray(merged.global.ui.tasks.combined.selections)).toBe(true);
    expect(merged.global.ui.tasks.combined.selections[0]).toEqual({ boardId: 'b1', listId: 'l1' });
    // Keeps combined presets when provided.
    expect(Array.isArray(merged.global.ui.tasks.combined.presets)).toBe(true);
    expect(merged.global.ui.tasks.combined.presets[0]).toEqual({ id: 'p1', name: 'My preset', selections: [{ boardId: 'b1', listId: 'l1' }] });
    expect(merged.global.ui.tasks.combined.activePresetId).toBe('p1');
    // Keeps nested automation defaults while allowing partial override.
    expect(merged.global.ui.tasks.automations.trello.onPrMerged.enabled).toBe(true);
    expect(typeof merged.global.ui.tasks.automations.trello.onPrMerged.pollMs).toBe('number');
    // Does not drop workflow defaults when only mode is provided.
    expect(merged.global.ui.workflow.focus).toBeTruthy();
    expect(merged.global.ui.workflow.notifications).toBeTruthy();
  });
});
