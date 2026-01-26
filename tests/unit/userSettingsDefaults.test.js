const { UserSettingsService } = require('../../server/userSettingsService');

describe('UserSettingsService defaults', () => {
  test('includes ui.tasks.boardMappings', () => {
    const defaults = UserSettingsService.prototype.getDefaultSettings.call({});
    expect(defaults?.global?.ui?.tasks).toBeTruthy();
    expect(defaults.global.ui.tasks.boardMappings).toBeTruthy();
    expect(typeof defaults.global.ui.tasks.boardMappings).toBe('object');
  });

  test('mergeSettings deep-merges ui.tasks without dropping defaults', () => {
    const defaults = UserSettingsService.prototype.getDefaultSettings.call({});
    const merged = UserSettingsService.prototype.mergeSettings.call({}, defaults, {
      global: {
        ui: {
          tasks: {
            boardMappings: {
              'trello:b1': { enabled: true, localPath: 'games/hytopia/mock-repo', defaultStartTier: 3 }
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
  });
});
