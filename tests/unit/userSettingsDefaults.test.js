const { UserSettingsService } = require('../../server/userSettingsService');

describe('UserSettingsService defaults', () => {
  test('includes ui.tasks.boardMappings', () => {
    const defaults = UserSettingsService.prototype.getDefaultSettings.call({});
    expect(defaults?.global?.ui?.tasks).toBeTruthy();
    expect(defaults.global.ui.tasks.boardMappings).toBeTruthy();
    expect(typeof defaults.global.ui.tasks.boardMappings).toBe('object');
  });

  test('includes ui.skin defaults', () => {
    const defaults = UserSettingsService.prototype.getDefaultSettings.call({});
    expect(defaults?.global?.ui).toBeTruthy();
    expect(typeof defaults.global.ui.skin).toBe('string');
    expect(defaults.global.ui.skin).toBeTruthy();
    expect(typeof defaults.global.ui.skinIntensity).toBe('number');
    expect(defaults.global.ui.skinIntensity).toBeGreaterThanOrEqual(0);
  });

  test('includes ui.tasks.launch defaults', () => {
    const defaults = UserSettingsService.prototype.getDefaultSettings.call({});
    const launch = defaults?.global?.ui?.tasks?.launch;
    expect(launch).toBeTruthy();
    expect(typeof launch.globalPromptPrefix).toBe('string');
    expect(typeof launch.includeTicketTitle).toBe('boolean');
  });

  test('includes ui.simpleMode defaults', () => {
    const defaults = UserSettingsService.prototype.getDefaultSettings.call({});
    const simpleMode = defaults?.global?.ui?.simpleMode;
    expect(simpleMode).toBeTruthy();
    expect(simpleMode.enabled).toBe(false);
    expect(simpleMode.startupOpen).toBe(false);
    expect(simpleMode.hotkeys).toBe(true);
    expect(simpleMode.showHints).toBe(true);
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

  test('includes ui.experimental workspace sidebar persistence defaults', () => {
    const defaults = UserSettingsService.prototype.getDefaultSettings.call({});
    const experimental = defaults?.global?.ui?.experimental;
    expect(experimental).toBeTruthy();
    expect(experimental.persistWorkspaceSidebarState).toBe(false);
    expect(experimental.workspaceSidebarStateByWorkspace).toBeTruthy();
    expect(typeof experimental.workspaceSidebarStateByWorkspace).toBe('object');
  });

  test('includes ui.worktrees auto-create defaults', () => {
    const defaults = UserSettingsService.prototype.getDefaultSettings.call({});
    expect(defaults?.global?.ui?.worktrees).toBeTruthy();
    expect(typeof defaults.global.ui.worktrees.autoCreateExtraWhenBusy).toBe('boolean');
    expect(typeof defaults.global.ui.worktrees.autoCreateMinNumber).toBe('number');
    expect(typeof defaults.global.ui.worktrees.autoCreateMaxNumber).toBe('number');
    expect(typeof defaults.global.ui.worktrees.considerOtherWorkspaces).toBe('boolean');
    expect(defaults.global.ui.worktrees.createPresets).toBeTruthy();
    expect(typeof defaults.global.ui.worktrees.createPresets).toBe('object');
    expect(defaults.global.ui.worktrees.createPresetByRepoPath).toBeTruthy();
    expect(typeof defaults.global.ui.worktrees.createPresetByRepoPath).toBe('object');
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

  test('includes global.process.status caps defaults', () => {
    const defaults = UserSettingsService.prototype.getDefaultSettings.call({});
    const status = defaults?.global?.process?.status;
    expect(status).toBeTruthy();
    expect(typeof status.lookbackHours).toBe('number');
    expect(status.caps).toBeTruthy();
    expect(typeof status.caps.wipMax).toBe('number');
    expect(typeof status.caps.q12).toBe('number');
    expect(typeof status.caps.q3).toBe('number');
    expect(typeof status.caps.q4).toBe('number');
  });

  test('includes global.policy defaults', () => {
    const defaults = UserSettingsService.prototype.getDefaultSettings.call({});
    const policy = defaults?.global?.policy;
    expect(policy).toBeTruthy();
    expect(typeof policy.enabled).toBe('boolean');
    expect(typeof policy.defaultRole).toBe('string');
    expect(policy.roleByAction).toBeTruthy();
    expect(typeof policy.roleByAction.destructive).toBe('string');
    expect(Array.isArray(policy.dangerousCommandPatterns)).toBe(true);
  });

  test('includes global.audit defaults', () => {
    const defaults = UserSettingsService.prototype.getDefaultSettings.call({});
    const audit = defaults?.global?.audit;
    expect(audit).toBeTruthy();
    expect(typeof audit.maxRecords).toBe('number');
    expect(audit.redaction).toBeTruthy();
    expect(typeof audit.redaction.enabled).toBe('boolean');
  });

  test('includes global.pager defaults', () => {
    const defaults = UserSettingsService.prototype.getDefaultSettings.call({});
    const pager = defaults?.global?.pager;
    expect(pager).toBeTruthy();
    expect(typeof pager.nudgeText).toBe('string');
    expect(typeof pager.intervalSeconds).toBe('number');
    expect(typeof pager.maxPings).toBe('number');
    expect(typeof pager.maxRuntimeMinutes).toBe('number');
    expect(typeof pager.customInstructionMode).toBe('string');
    expect(pager.doneCheck).toBeTruthy();
    expect(typeof pager.doneCheck.enabled).toBe('boolean');
  });

  test('mergeSettings deep-merges ui.tasks without dropping defaults', () => {
    const defaults = UserSettingsService.prototype.getDefaultSettings.call({});
    const merged = UserSettingsService.prototype.mergeSettings.call({}, defaults, {
      global: {
        process: {
          status: { caps: { wipMax: 9 } }
        },
        policy: {
          enabled: true,
          roleByAction: { destructive: 'operator' }
        },
        audit: {
          redaction: { emails: false }
        },
        pager: {
          customInstruction: 'keep going',
          doneCheck: { enabled: true }
        },
        ui: {
          skin: 'blue',
          simpleMode: {
            startupOpen: true
          },
          experimental: {
            workspaceSidebarStateByWorkspace: {
              alpha: {
                viewMode: 'claude',
                tierFilter: '3',
                hiddenWorktreeKeys: ['repo-work4']
              }
            }
          },
          workflow: {
            mode: 'focus'
          },
          tasks: {
            launch: {
              includeTicketTitle: true
            },
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
    // Does not drop tasks.launch defaults when only partially provided.
    expect(merged.global.ui.tasks.launch).toBeTruthy();
    expect(merged.global.ui.tasks.launch.includeTicketTitle).toBe(true);
    expect(typeof merged.global.ui.tasks.launch.globalPromptPrefix).toBe('string');
    // Does not drop workflow defaults when only mode is provided.
    expect(merged.global.ui.workflow.focus).toBeTruthy();
    expect(merged.global.ui.workflow.notifications).toBeTruthy();
    // Keeps ui.skin when provided.
    expect(merged.global.ui.skin).toBe('blue');
    // Keeps simpleMode defaults while allowing partial override.
    expect(merged.global.ui.simpleMode).toBeTruthy();
    expect(merged.global.ui.simpleMode.startupOpen).toBe(true);
    expect(merged.global.ui.simpleMode.enabled).toBe(false);
    expect(merged.global.ui.simpleMode.hotkeys).toBe(true);
    // Keeps experimental defaults while allowing workspace-scoped sidebar state overrides.
    expect(merged.global.ui.experimental).toBeTruthy();
    expect(merged.global.ui.experimental.persistWorkspaceSidebarState).toBe(false);
    expect(merged.global.ui.experimental.workspaceSidebarStateByWorkspace.alpha).toEqual({
      viewMode: 'claude',
      tierFilter: '3',
      hiddenWorktreeKeys: ['repo-work4']
    });

    // Does not drop process.status defaults when only one cap is provided.
    expect(merged.global.process.status.lookbackHours).toBeTruthy();
    expect(merged.global.process.status.caps.wipMax).toBe(9);
    expect(typeof merged.global.process.status.caps.q12).toBe('number');
    expect(typeof merged.global.process.status.caps.q3).toBe('number');
    expect(typeof merged.global.process.status.caps.q4).toBe('number');

    // Keeps policy defaults while allowing partial override.
    expect(merged.global.policy.enabled).toBe(true);
    expect(merged.global.policy.roleByAction.destructive).toBe('operator');
    expect(typeof merged.global.policy.roleByAction.billing).toBe('string');

    // Keeps audit defaults while allowing partial override.
    expect(merged.global.audit.redaction.emails).toBe(false);
    expect(typeof merged.global.audit.redaction.tokens).toBe('boolean');
    // Keeps pager defaults while allowing partial override.
    expect(merged.global.pager.customInstruction).toBe('keep going');
    expect(merged.global.pager.doneCheck.enabled).toBe(true);
    expect(typeof merged.global.pager.doneCheck.token).toBe('string');
  });
});
