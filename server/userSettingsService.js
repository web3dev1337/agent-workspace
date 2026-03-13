const fs = require('fs');
const path = require('path');
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/user-settings.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

class UserSettingsService {
  constructor() {
    const dataDirRaw = String(process.env.ORCHESTRATOR_DATA_DIR || '').trim();
    const baseDir = (() => {
      if (dataDirRaw) {
        try { return path.resolve(dataDirRaw); } catch { return dataDirRaw; }
      }
      return path.join(__dirname, '..');
    })();

    this.settingsPath = process.env.ORCHESTRATOR_USER_SETTINGS_PATH
      ? String(process.env.ORCHESTRATOR_USER_SETTINGS_PATH)
      : path.join(baseDir, 'user-settings.json');
    this.settings = this.loadSettings();
  }

  static getInstance() {
    if (!UserSettingsService.instance) {
      UserSettingsService.instance = new UserSettingsService();
    }
    return UserSettingsService.instance;
  }

  getDefaultSettings() {
    return {
      version: '1.1.0',
      global: {
        claudeFlags: {
          skipPermissions: false,
          provider: 'anthropic',
          // Add other global Claude flags here in the future
        },
        autoStart: {
          enabled: false,
          mode: 'fresh', // 'fresh', 'continue', or 'resume'
          delay: 500 // ms delay before auto-starting
        },
        terminal: {
          // Add other global terminal settings here in the future
        },
        process: {
          status: {
            lookbackHours: 24,
            caps: {
              wipMax: 3,
              q12: 3,
              q3: 6,
              q4: 10
            }
          }
        },
        scheduler: {
          enabled: false,
          tickSeconds: 30,
          safety: {
            defaultMode: 'safe',
            blockedCommandPatterns: [
              'queue-merge',
              'queue-request-changes',
              'queue-approve',
              'stop-session',
              'kill-session',
              'destroy-session',
              'remove-worktree'
            ]
          },
          schedules: []
        },
        pager: {
          nudgeText: 'next',
          intervalSeconds: 300,
          enterDelayMs: 1000,
          maxPings: 24,
          maxRuntimeMinutes: 120,
          customInstruction: '',
          customInstructionMode: 'append',
          doneCheck: {
            enabled: false,
            token: 'PAGER_DONE',
            prompt: 'If you are 100% done with all requested work, reply exactly: PAGER_DONE and then stop.'
          }
        },
        policy: {
          enabled: false,
          defaultRole: 'admin',
          allowHeaderOverride: false,
          headerName: 'x-orchestrator-role',
          allowQueryOverride: false,
          queryName: 'role',
          roleByAction: {
            read: 'viewer',
            write: 'operator',
            destructive: 'admin',
            billing: 'admin',
            audit_export: 'operator',
            command_execute: 'operator'
          },
          dangerousCommandPatterns: [
            'merge',
            'approve',
            'request-changes',
            'request_changes',
            'remove',
            'destroy',
            'kill',
            'stop',
            'restart',
            'close',
            'ticket-move'
          ],
          readOnlyCommandPatterns: [
            'list-',
            'get-',
            'open-',
            'show-',
            'status',
            'catalog',
            'capabilities',
            'context'
          ]
        },
        audit: {
          maxRecords: 10000,
          redaction: {
            enabled: true,
            emails: true,
            tokens: true,
            homePaths: true
          },
          signing: {
            enabled: false,
            keyId: 'local-default'
          }
        },
        ui: {
          theme: 'dark',
          skin: 'blue',
          // 0..100 (applied as 0..1 multiplier for skin tint in CSS)
          skinIntensity: 100,
          visibility: {
            processBanner: false,
            header: {
              dashboard: true,
              newProject: false,
              history: false,
              prs: false,
              queue: true,
              chats: false,
              commands: false,
              reviewRoute: false,
              activity: false,
              diff: false,
              workflowMode: false,
              workflowBackground: false,
              tierFilters: false,
              focusTier2: false,
              focusSwap: false,
              tasks: true,
              ports: true,
              voice: false,
              notifications: false,
              commander: true,
              recommendations: false,
              settings: true,
              connectionStatus: true
            },
            sidebar: {
              viewPresets: false,
              tierFilters: true,
              activeFilter: true,
              refreshBranch: false,
              readyForReview: false,
              sessionVisibilityToggles: false,
              deleteWorktree: true
            },
            terminal: {
              intentHints: false,
              branchRefresh: false,
              closeProcess: false,
              removeWorktree: true,
              reviewConsole: true,
              showOnlyWorktree: false,
              startAgentOptions: true,
              startClaudeWithSettings: false,
              createNewProject: false,
              refreshTerminal: false,
              interrupt: false,
              assignCodeReview: true,
              buildProductionZip: false,
              viewBranchOnGithub: false,
              viewBranchDiff: true,
              viewPrOnGithub: true,
              advancedDiff: false,
              advancedBranchDiff: false,
              startServerDev: false,
              forceKill: true,
              launchSettings: false,
              serverLaunchMenu: false,
              startServer: true
            },
            dashboard: {
              processBanner: false,
              processSection: false,
              statusCard: false,
              telemetryCard: false,
              polecatsCard: false,
              discordCard: false,
              projectsCard: false,
              adviceCard: false,
              readinessCard: false,
              suggestions: false,
              workspacesActive: true,
              workspacesAll: true,
              reviewSection: true,
              quickLinks: false,
              runningServices: true,
              createSection: true
            },
            reviewInbox: {
              mode: 'mine',
              tiers: 't3t4',
              kind: 'pr',
              unreviewedOnly: true,
              autoConsole: false,
              autoAdvance: false,
              prioritizeActive: true,
              project: ''
            },
            quickReview: {
              mode: 'mine',
              tiers: 't3t4',
              kind: 'pr',
              unreviewedOnly: true,
              autoConsole: true,
              autoAdvance: false,
              prioritizeActive: true,
              project: ''
            },
            commander: {
              cmdMode: false,
              startStop: false,
              startClaude: false,
              advice: false,
              sessions: false,
              modeSelect: false
            }
          },
          simpleMode: {
            // Codex-style top-level project/chat shell controls.
            enabled: false,
            startupOpen: false,
            hotkeys: true,
            showHints: true
          },
          reviewConsole: {
	            // Default layout intent: a batch-review surface. Keep it fullscreen and show diff by default.
	            preset: 'review', // default | review | throughput | deep | code | terminals | custom
	            fullscreen: true,
            diffEmbed: true,
            sections: {
              terminals: true,
              files: false,
              commits: false,
              diff: true
            }
          },
          discord: {
            // If enabled, the server will call POST /api/discord/ensure-services on startup
            // (via internal service call) to keep Claudesworth online after restarts.
            autoEnsureServicesAtStartup: false
          },
          branches: {
            // Branch label rendering in Worktree list and terminal headers.
            hidePrefixes: true,
            colorize: true,
            showAtInSidebar: false
          },
          terminals: {
            // Persist terminal filtering across refreshes.
            // 'all' | 'claude' | 'server'
            viewMode: 'all',
            // 'all' | 'none' | '1' | '2' | '3' | '4'
            tierFilter: 'all'
          },
          worktrees: {
            autoCreateExtraWhenBusy: true,
            autoCreateMinNumber: 9,
            autoCreateMaxNumber: 25,
            considerOtherWorkspaces: true,
            showDetailedChooserMetadata: false,
            // Quick Worktree: per-repo create-count presets.
            createPresets: { small: 2, medium: 4, large: 6 },
            // Keyed by repo path -> 'small'|'medium'|'large' (or empty for default).
            createPresetByRepoPath: {}
          },
          workflow: {
            mode: 'review',
            focus: {
              hideTier2WhenTier1Busy: true,
              autoSwapToTier2WhenTier1Busy: false
            },
            notifications: {
              mode: 'quiet', // quiet | normal | aggressive
              tier1Interrupts: true,
              reviewCompleteNudges: true
            }
          },
          tasks: {
            // 'inherit' uses the main UI theme; 'light'/'dark' force the Tasks panel theme.
            theme: 'inherit',
            launch: {
              // Prepended before the ticket preface + card description when launching from Tasks.
              globalPromptPrefix: '',
              includeTicketTitle: false
            },
            me: {
              // Optional override (useful if you want "me" to match a specific board member).
              // If unset, the UI will use `/api/tasks/me` from the provider credentials.
              trelloUsername: ''
            },
            // Keyed by `${provider}:${boardId}` -> mapping/config:
            // { enabled?: boolean, repoSlug?: string, localPath?: string, defaultStartTier?: 1|2|3|4 }
            // Local-only by default (stored in user-settings.json).
            boardMappings: {},
            // Keyed by `${provider}:${boardId}` -> conventions/config:
		            // {
		            //   doneListId?: string,
		            //   forTestListId?: string,
		            //   mergedCommentTemplate?: string,
		            //   mergedLabelNames?: string,
		            //   mergedChecklistName?: string,
		            //   mergedChecklistItemTemplate?: string,
	            //   dependencyChecklistName?: string,
	            //   tierFromLabels?: boolean,
	            //   tierByLabelColor?: { [color: string]: 1|2|3|4 },
	            //   needsFixLabelName?: string
	            // }
            boardConventions: {},
            combined: {
              // Optional cross-board “combined view” column selections.
              // Each item: { boardId: string, listId: string }
              selections: [],
              // Optional “presets” for quickly switching combined view selections.
              // Each item: { id: string, name: string, selections: { boardId: string, listId: string }[] }
              presets: [],
              // Which preset is currently active (purely for UI convenience).
              activePresetId: ''
            },
		            automations: {
		              trello: {
		                onPrMerged: {
		                  enabled: false,
		                  pollEnabled: true,
		                  webhookEnabled: false,
		                  comment: true,
		                  // Supports placeholders like {prUrl}, {mergedAt}, {reviewOutcome}, {verifyMinutes}, {notes}, {promptRef}.
		                  commentTemplate: 'Merged ✅\nPR: {prUrl}',
		                  moveToDoneList: true,
		                  // Optional: override list choice (defaults to done list). Values: 'done' | 'for_test' | 'none'
		                  moveTarget: 'done',
		                  closeIfNoDoneList: false,
		                  pollMs: 60_000
		                }
		              }
		            },
            kanban: {
              // Persist kanban UI state server-side (survives refresh and works across ports/origins).
              // Keyed by `${provider}:${boardId}` -> string[] listIds
              collapsedByBoard: {},
              // Keyed by `${provider}:${boardId}` -> string listId (narrow layout)
              expandedByBoard: {},
              // Keyed by `${provider}:${boardId}` -> 'scroll' | 'wrap' | 'wrap-expand'
              layoutByBoard: {}
            },
            filters: {
              // Keyed by `${provider}:${boardId}` -> string[] memberIds
              assigneesByBoard: {}
            }
          },
	          diffViewer: {
	            theme: 'light'
	          }
	        }
	      },
      perTerminal: {
        // sessionId -> override settings
        // Example:
        // "work1-claude": { claudeFlags: { skipPermissions: true }, autoStart: { enabled: true, mode: 'continue' } }
      }
    };
  }

  loadSettings() {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const data = fs.readFileSync(this.settingsPath, 'utf8');
        const settings = JSON.parse(data);
        
        // Merge with defaults to ensure all properties exist
        const defaults = this.getDefaultSettings();
        const merged = this.mergeSettings(defaults, settings);
        const migrated = this.applySettingsMigrations(merged);
        if (migrated.changed) this.saveSettings(migrated.settings);
        
        logger.info('Loaded user settings', { path: this.settingsPath });
        return migrated.settings;
      } else {
        logger.info('No user settings file found, creating from default template', { 
          path: this.settingsPath 
        });
        const defaults = this.loadDefaultTemplate();
        this.saveSettings(defaults);
        return defaults;
      }
    } catch (error) {
      logger.error('Failed to load user settings, using fallback defaults', { 
        path: this.settingsPath,
        error: error.message 
      });
      return this.getDefaultSettings();
    }
  }

  applySettingsMigrations(settings) {
    const next = settings || {};
    let changed = false;

    const ui = next?.global?.ui;
    if (ui) {
      const rc = (ui.reviewConsole && typeof ui.reviewConsole === 'object') ? { ...ui.reviewConsole } : {};
      const migrations = (rc.migrations && typeof rc.migrations === 'object') ? { ...rc.migrations } : {};
      if (!migrations.filesDefaultOff) {
        const sections = (rc.sections && typeof rc.sections === 'object') ? { ...rc.sections } : {};
        if (sections.files !== false) {
          sections.files = false;
          changed = true;
        }
        if (sections.terminals === false) {
          sections.terminals = true;
          changed = true;
        }
        rc.sections = sections;
        rc.migrations = { ...migrations, filesDefaultOff: true };
        ui.reviewConsole = rc;
        changed = true;
      }

      const uiMigrations = (ui.migrations && typeof ui.migrations === 'object') ? { ...ui.migrations } : {};
      if (!uiMigrations.headerNotificationsVoiceDefaultOff) {
        const visibility = (ui.visibility && typeof ui.visibility === 'object') ? { ...ui.visibility } : {};
        const header = (visibility.header && typeof visibility.header === 'object') ? { ...visibility.header } : {};
        if (header.notifications !== false || header.voice !== false) {
          header.notifications = false;
          header.voice = false;
          visibility.header = header;
          ui.visibility = visibility;
          changed = true;
        }
        uiMigrations.headerNotificationsVoiceDefaultOff = true;
        ui.migrations = uiMigrations;
        changed = true;
      }
      if (!uiMigrations.headerTasksDefaultOn) {
        const visibility = (ui.visibility && typeof ui.visibility === 'object') ? { ...ui.visibility } : {};
        const header = (visibility.header && typeof visibility.header === 'object') ? { ...visibility.header } : {};
        if (header.tasks !== true) {
          header.tasks = true;
          visibility.header = header;
          ui.visibility = visibility;
          changed = true;
        }
        uiMigrations.headerTasksDefaultOn = true;
        ui.migrations = uiMigrations;
        changed = true;
      }
      if (!uiMigrations.headerPortsDefaultOn) {
        const visibility = (ui.visibility && typeof ui.visibility === 'object') ? { ...ui.visibility } : {};
        const header = (visibility.header && typeof visibility.header === 'object') ? { ...visibility.header } : {};
        if (header.ports !== true) {
          header.ports = true;
          visibility.header = header;
          ui.visibility = visibility;
          changed = true;
        }
        uiMigrations.headerPortsDefaultOn = true;
        ui.migrations = uiMigrations;
        changed = true;
      }
      if (!uiMigrations.headerSettingsDefaultOn) {
        const visibility = (ui.visibility && typeof ui.visibility === 'object') ? { ...ui.visibility } : {};
        const header = (visibility.header && typeof visibility.header === 'object') ? { ...visibility.header } : {};
        if (header.settings !== true) {
          header.settings = true;
          visibility.header = header;
          ui.visibility = visibility;
          changed = true;
        }
        uiMigrations.headerSettingsDefaultOn = true;
        ui.migrations = uiMigrations;
        changed = true;
      }
      if (!uiMigrations.dashboardQuickLinksDefaultOff) {
        const visibility = (ui.visibility && typeof ui.visibility === 'object') ? { ...ui.visibility } : {};
        const dashboard = (visibility.dashboard && typeof visibility.dashboard === 'object') ? { ...visibility.dashboard } : {};
        if (dashboard.quickLinks !== false) {
          dashboard.quickLinks = false;
          visibility.dashboard = dashboard;
          ui.visibility = visibility;
          changed = true;
        }
        uiMigrations.dashboardQuickLinksDefaultOff = true;
        ui.migrations = uiMigrations;
        changed = true;
      }
    }

    return { settings: next, changed };
  }

  loadDefaultTemplate() {
    const defaultTemplatePath = path.join(__dirname, '..', 'user-settings.default.json');
    try {
      if (fs.existsSync(defaultTemplatePath)) {
        const data = fs.readFileSync(defaultTemplatePath, 'utf8');
        const template = JSON.parse(data);
        logger.info('Loaded default template from repository', { path: defaultTemplatePath });
        return template;
      } else {
        logger.warn('Default template not found, using hardcoded defaults', { 
          path: defaultTemplatePath 
        });
        return this.getDefaultSettings();
      }
    } catch (error) {
      logger.error('Failed to load default template, using hardcoded defaults', { 
        path: defaultTemplatePath,
        error: error.message 
      });
      return this.getDefaultSettings();
    }
  }

  getDefaultTemplate() {
    return this.loadDefaultTemplate();
  }

  resetToDefaults() {
    try {
      const defaults = this.loadDefaultTemplate();
      this.settings = defaults;
      const saved = this.saveSettings();
      if (saved) {
        logger.info('Reset user settings to default template');
      }
      return saved;
    } catch (error) {
      logger.error('Failed to reset to defaults', { error: error.message, stack: error.stack });
      return false;
    }
  }

  saveAsDefault() {
    const defaultTemplatePath = path.join(__dirname, '..', 'user-settings.default.json');
    try {
      fs.writeFileSync(defaultTemplatePath, JSON.stringify(this.settings, null, 2));
      
      // Update the metadata with timestamp
      this.updateLastDefaultUpdate();
      
      logger.info('Saved current settings as default template', { path: defaultTemplatePath });
      return true;
    } catch (error) {
      logger.error('Failed to save as default template', { 
        path: defaultTemplatePath,
        error: error.message 
      });
      return false;
    }
  }

  updateLastDefaultUpdate() {
    try {
      // Store metadata about when the default was last updated
      const metadataPath = path.join(__dirname, '..', '.user-settings-metadata.json');
      const metadata = {
        lastDefaultUpdate: new Date().toISOString(),
        defaultVersion: this.settings.version || '1.0.0'
      };
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    } catch (error) {
      logger.warn('Failed to update default metadata', { error: error.message, stack: error.stack });
    }
  }

  checkForDefaultUpdates() {
    try {
      const metadataPath = path.join(__dirname, '..', '.user-settings-metadata.json');
      
      if (!fs.existsSync(metadataPath)) {
        return null; // No metadata, can't check
      }
      
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      const currentDefaults = this.loadDefaultTemplate();
      
      // Check if defaults are different from current user settings
      const isDefaultDifferent = JSON.stringify(currentDefaults) !== JSON.stringify(this.settings);
      
      if (isDefaultDifferent) {
        return {
          hasUpdates: true,
          lastUpdate: metadata.lastDefaultUpdate,
          currentDefaults: currentDefaults,
          userSettings: this.settings
        };
      }
      
      return { hasUpdates: false };
    } catch (error) {
      logger.error('Failed to check for default updates', { error: error.message, stack: error.stack });
      return null;
    }
  }

  mergeSettings(defaults, userSettings) {
    const merged = JSON.parse(JSON.stringify(defaults)); // Deep clone defaults

    if (userSettings.global) {
      if (userSettings.global.claudeFlags) {
        Object.assign(merged.global.claudeFlags, userSettings.global.claudeFlags);
      }
      if (userSettings.global.autoStart) {
        Object.assign(merged.global.autoStart, userSettings.global.autoStart);
      }
      if (userSettings.global.terminal) {
        Object.assign(merged.global.terminal, userSettings.global.terminal);
      }
      if (userSettings.global.process) {
        const procDefaults = (merged.global.process || {});
        const proc = userSettings.global.process || {};
        merged.global.process = {
          ...procDefaults,
          ...proc,
          status: {
            ...(procDefaults.status || {}),
            ...(proc.status || {}),
            caps: {
              ...((procDefaults.status || {}).caps || {}),
              ...((proc.status || {}).caps || {})
            }
          }
        };
      }
      if (userSettings.global.scheduler) {
        const defaultsScheduler = (merged.global.scheduler || {});
        const next = userSettings.global.scheduler || {};
        merged.global.scheduler = {
          ...defaultsScheduler,
          ...next,
          safety: {
            ...(defaultsScheduler.safety || {}),
            ...(next.safety || {})
          }
        };
      }
      if (userSettings.global.pager) {
        const defaultsPager = (merged.global.pager || {});
        const next = userSettings.global.pager || {};
        merged.global.pager = {
          ...defaultsPager,
          ...next,
          doneCheck: {
            ...(defaultsPager.doneCheck || {}),
            ...(next.doneCheck || {})
          }
        };
      }
      if (userSettings.global.policy) {
        const defaultsPolicy = (merged.global.policy || {});
        const next = userSettings.global.policy || {};
        merged.global.policy = {
          ...defaultsPolicy,
          ...next,
          roleByAction: {
            ...(defaultsPolicy.roleByAction || {}),
            ...(next.roleByAction || {})
          }
        };
      }
      if (userSettings.global.audit) {
        const defaultsAudit = (merged.global.audit || {});
        const next = userSettings.global.audit || {};
        merged.global.audit = {
          ...defaultsAudit,
          ...next,
          redaction: {
            ...(defaultsAudit.redaction || {}),
            ...(next.redaction || {})
          },
          signing: {
            ...(defaultsAudit.signing || {}),
            ...(next.signing || {})
          }
        };
      }
      if (userSettings.global.ui) {
        const ui = userSettings.global.ui || {};

        // Shallow merge at the UI level, but preserve nested defaults with targeted merges.
        // Important: do NOT let a partial `ui.tasks` object overwrite the default tasks subtree.
        const uiDefaults = merged.global.ui || {};
        const tasksDefaults = uiDefaults.tasks || {};
        merged.global.ui = {
          ...uiDefaults,
          ...ui,
          tasks: tasksDefaults
        };

        if (typeof ui.theme === 'string') {
          merged.global.ui.theme = ui.theme;
        }
        if (typeof ui.skin === 'string') {
          merged.global.ui.skin = ui.skin;
        }

        if (ui.simpleMode && typeof ui.simpleMode === 'object') {
          merged.global.ui.simpleMode = {
            ...(uiDefaults.simpleMode || {}),
            ...(ui.simpleMode || {})
          };
        }

        if (ui.visibility && typeof ui.visibility === 'object') {
          const defaultsVisibility = uiDefaults.visibility || {};
          const nextVisibility = ui.visibility || {};
          merged.global.ui.visibility = {
            ...defaultsVisibility,
            ...nextVisibility,
            header: {
              ...(defaultsVisibility.header || {}),
              ...(nextVisibility.header || {})
            },
            sidebar: {
              ...(defaultsVisibility.sidebar || {}),
              ...(nextVisibility.sidebar || {})
            },
            terminal: {
              ...(defaultsVisibility.terminal || {}),
              ...(nextVisibility.terminal || {})
            },
            dashboard: {
              ...(defaultsVisibility.dashboard || {}),
              ...(nextVisibility.dashboard || {})
            },
            commander: {
              ...(defaultsVisibility.commander || {}),
              ...(nextVisibility.commander || {})
            }
          };
        }

	        if (ui.diffViewer) {
	          merged.global.ui.diffViewer = {
	            ...(merged.global.ui.diffViewer || {}),
	            ...(ui.diffViewer || {})
	          };
	        }

	        if (ui.reviewConsole) {
	          const defaultsReviewConsole = (uiDefaults.reviewConsole && typeof uiDefaults.reviewConsole === 'object')
	            ? uiDefaults.reviewConsole
	            : {};
	          const rc = ui.reviewConsole || {};
	          const defaultsSections = (defaultsReviewConsole.sections && typeof defaultsReviewConsole.sections === 'object')
	            ? defaultsReviewConsole.sections
	            : {};
	          const rcSections = (rc.sections && typeof rc.sections === 'object') ? rc.sections : {};
	          merged.global.ui.reviewConsole = {
	            ...defaultsReviewConsole,
	            ...rc,
	            sections: {
	              ...defaultsSections,
	              ...rcSections
	            }
	          };
	        }

	        if (ui.workflow) {
	          const defaultsWorkflow = (uiDefaults.workflow || {});
	          const wf = ui.workflow || {};
	          merged.global.ui.workflow = {
            ...defaultsWorkflow,
            ...wf,
            focus: {
              ...(defaultsWorkflow.focus || {}),
              ...(wf.focus || {})
            },
            notifications: {
              ...(defaultsWorkflow.notifications || {}),
              ...(wf.notifications || {})
            }
          };
        }

        if (ui.tasks) {
          const defaultsTasks = tasksDefaults || {};
          const tasks = ui.tasks || {};

          merged.global.ui.tasks = {
            ...defaultsTasks,
            ...tasks
          };

          if (tasks.me) {
            merged.global.ui.tasks.me = {
              ...(defaultsTasks.me || {}),
              ...(tasks.me || {})
            };
          }

          if (tasks.launch) {
            merged.global.ui.tasks.launch = {
              ...(defaultsTasks.launch || {}),
              ...(tasks.launch || {})
            };
          }

          if (tasks.kanban) {
            merged.global.ui.tasks.kanban = {
              ...(defaultsTasks.kanban || {}),
              ...(tasks.kanban || {})
            };
          }

          if (tasks.filters) {
            merged.global.ui.tasks.filters = {
              ...(defaultsTasks.filters || {}),
              ...(tasks.filters || {})
            };
          }

          if (tasks.automations) {
            const defaultsAutomations = defaultsTasks.automations || {};
            const next = tasks.automations || {};
            merged.global.ui.tasks.automations = {
              ...defaultsAutomations,
              ...next,
              trello: {
                ...(defaultsAutomations.trello || {}),
                ...(next.trello || {}),
                onPrMerged: {
                  ...((defaultsAutomations.trello || {}).onPrMerged || {}),
                  ...(((next.trello || {}).onPrMerged) || {})
                }
              }
            };
          }

          if (tasks.boardMappings) {
            merged.global.ui.tasks.boardMappings = {
              ...(defaultsTasks.boardMappings || {}),
              ...(tasks.boardMappings || {})
            };
          }

          if (tasks.boardConventions) {
            merged.global.ui.tasks.boardConventions = {
              ...(defaultsTasks.boardConventions || {}),
              ...(tasks.boardConventions || {})
            };
          }
        }
      }
    }

    if (userSettings.perTerminal) {
      merged.perTerminal = { ...merged.perTerminal, ...userSettings.perTerminal };
    }

    return merged;
  }

  saveSettings(settings = null) {
    try {
      const toSave = settings || this.settings;
      fs.writeFileSync(this.settingsPath, JSON.stringify(toSave, null, 2));
      logger.info('Saved user settings', { path: this.settingsPath });
      return true;
    } catch (error) {
      logger.error('Failed to save user settings', { 
        path: this.settingsPath,
        error: error.message 
      });
      return false;
    }
  }

  // Get effective settings for a specific session
  getEffectiveSettings(sessionId) {
    const global = this.settings.global;
    const perTerminal = this.settings.perTerminal[sessionId] || {};

    // Merge global and per-terminal settings
    const effective = {
      claudeFlags: {
        ...global.claudeFlags,
        ...(perTerminal.claudeFlags || {})
      },
      autoStart: {
        ...(global.autoStart || {}),
        ...(perTerminal.autoStart || {})
      },
      terminal: {
        ...global.terminal,
        ...(perTerminal.terminal || {})
      }
    };

    return effective;
  }

  // Update global settings
  updateGlobalSettings(newGlobal) {
    try {
      // Simply update the global settings directly
      this.settings.global = {
        ...this.getDefaultSettings().global,
        ...newGlobal
      };
      
      // Deep merge claudeFlags, autoStart, and terminal
      if (newGlobal.claudeFlags) {
        this.settings.global.claudeFlags = {
          ...this.getDefaultSettings().global.claudeFlags,
          ...newGlobal.claudeFlags
        };
      }

      if (newGlobal.autoStart) {
        this.settings.global.autoStart = {
          ...this.getDefaultSettings().global.autoStart,
          ...newGlobal.autoStart
        };
      }

      if (newGlobal.terminal) {
        this.settings.global.terminal = {
          ...this.getDefaultSettings().global.terminal,
          ...newGlobal.terminal
        };
      }

      if (newGlobal.process) {
        const defaultsProcess = (this.getDefaultSettings().global.process || {});
        const next = (newGlobal.process || {});
        this.settings.global.process = {
          ...defaultsProcess,
          ...next,
          status: {
            ...(defaultsProcess.status || {}),
            ...(next.status || {}),
            caps: {
              ...((defaultsProcess.status || {}).caps || {}),
              ...((next.status || {}).caps || {})
            }
          }
        };
      }

      if (newGlobal.scheduler) {
        const defaultsScheduler = (this.getDefaultSettings().global.scheduler || {});
        const next = (newGlobal.scheduler || {});
        this.settings.global.scheduler = {
          ...defaultsScheduler,
          ...next,
          safety: {
            ...(defaultsScheduler.safety || {}),
            ...(next.safety || {})
          }
        };
      }

      if (newGlobal.pager) {
        const defaultsPager = (this.getDefaultSettings().global.pager || {});
        const next = (newGlobal.pager || {});
        this.settings.global.pager = {
          ...defaultsPager,
          ...next,
          doneCheck: {
            ...(defaultsPager.doneCheck || {}),
            ...(next.doneCheck || {})
          }
        };
      }

      if (newGlobal.policy) {
        const defaultsPolicy = (this.getDefaultSettings().global.policy || {});
        const next = (newGlobal.policy || {});
        this.settings.global.policy = {
          ...defaultsPolicy,
          ...next,
          roleByAction: {
            ...(defaultsPolicy.roleByAction || {}),
            ...(next.roleByAction || {})
          }
        };
      }

      if (newGlobal.audit) {
        const defaultsAudit = (this.getDefaultSettings().global.audit || {});
        const next = (newGlobal.audit || {});
        this.settings.global.audit = {
          ...defaultsAudit,
          ...next,
          redaction: {
            ...(defaultsAudit.redaction || {}),
            ...(next.redaction || {})
          },
          signing: {
            ...(defaultsAudit.signing || {}),
            ...(next.signing || {})
          }
        };
      }

      if (newGlobal.ui) {
        this.settings.global.ui = {
          ...this.getDefaultSettings().global.ui,
          ...newGlobal.ui
        };
        if (newGlobal.ui.visibility) {
          const defaultsVisibility = this.getDefaultSettings().global.ui.visibility || {};
          const nextVisibility = newGlobal.ui.visibility || {};
          this.settings.global.ui.visibility = {
            ...defaultsVisibility,
            ...nextVisibility,
            header: {
              ...(defaultsVisibility.header || {}),
              ...(nextVisibility.header || {})
            },
            sidebar: {
              ...(defaultsVisibility.sidebar || {}),
              ...(nextVisibility.sidebar || {})
            },
            terminal: {
              ...(defaultsVisibility.terminal || {}),
              ...(nextVisibility.terminal || {})
            },
            dashboard: {
              ...(defaultsVisibility.dashboard || {}),
              ...(nextVisibility.dashboard || {})
            },
            commander: {
              ...(defaultsVisibility.commander || {}),
              ...(nextVisibility.commander || {})
            }
          };
        }
        if (newGlobal.ui.diffViewer) {
          this.settings.global.ui.diffViewer = {
            ...this.getDefaultSettings().global.ui.diffViewer,
            ...newGlobal.ui.diffViewer
          };
        }
      }
      
      const saved = this.saveSettings();
      if (saved) {
        logger.info('Updated global settings', { settings: this.settings.global });
      }
      
      return saved;
    } catch (error) {
      logger.error('Failed to update global settings', { error: error.message, stack: error.stack });
      return false;
    }
  }

  // Update per-terminal settings
  updatePerTerminalSettings(sessionId, settings) {
    try {
      if (!this.settings.perTerminal) {
        this.settings.perTerminal = {};
      }
      
      this.settings.perTerminal[sessionId] = {
        ...this.settings.perTerminal[sessionId],
        ...settings
      };
      
      const saved = this.saveSettings();
      if (saved) {
        logger.info('Updated per-terminal settings', { 
          sessionId, 
          settings: this.settings.perTerminal[sessionId] 
        });
      }
      
      return saved;
    } catch (error) {
      logger.error('Failed to update per-terminal settings', { 
        sessionId, 
        error: error.message 
      });
      return false;
    }
  }

  // Remove per-terminal settings
  clearPerTerminalSettings(sessionId) {
    try {
      if (this.settings.perTerminal && this.settings.perTerminal[sessionId]) {
        delete this.settings.perTerminal[sessionId];
        const saved = this.saveSettings();
        if (saved) {
          logger.info('Cleared per-terminal settings', { sessionId });
        }
        return saved;
      }
      return true;
    } catch (error) {
      logger.error('Failed to clear per-terminal settings', { 
        sessionId, 
        error: error.message 
      });
      return false;
    }
  }

  // Get all settings (for API)
  getAllSettings() {
    return JSON.parse(JSON.stringify(this.settings)); // Return deep copy
  }
}

module.exports = { UserSettingsService };
