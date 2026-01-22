// Enhanced Claude Orchestrator with sidebar and flexible viewing
class ClaudeOrchestrator {
  constructor() {
    this.sessions = new Map();
    this.activeView = [];
    this.visibleTerminals = new Set(); // Track which terminals are visible
    this.socket = null;
    this.terminalManager = null;
    this.notificationManager = null;
    this.agentModalManager = null; // Agent modal manager
    this.settings = this.loadSettings();
    this.userSettings = null; // Will be loaded from server
    this.currentLayout = '2x4';
    this.serverStatuses = new Map(); // Track server running status
    this.serverPorts = new Map(); // Track server ports
    this.githubLinks = new Map(); // Track GitHub PR/branch links per session
    this.githubLinkLogs = new Map(); // Track last logged GitHub links per session
    this.sessionActivity = new Map(); // Track which sessions have been used
    this.dismissedStartupUI = new Map(); // Track which sessions have dismissed startup UI
    this.startupUIDebounce = new Map(); // Debounce startup UI showing
    this.sessionAgentPreferences = new Map(); // Track agent preferences per session
    this.autoStartApplied = new Set(); // Prevent duplicate auto-start on reconnects
    this.showActiveOnly = false; // Filter toggle
    this.serverLaunchSettings = this.loadServerLaunchSettings(); // Server launch flags

    // Workspace management
    this.currentWorkspace = null;
    this.availableWorkspaces = [];
    this.orchestratorConfig = {};
    this.dashboard = null;
    this.workspaceSwitcher = null;
    this.isDashboardMode = false;

    // Tab management for multiple workspaces
    this.tabManager = null;

    // Dynamic workspace types
    this.workspaceTypes = {};
    this.frameworks = {};
    this.workspaceHierarchy = {};
    this.cascadedConfigs = {};  // Fully merged configs (Global → Category → Framework → Project)
    this.worktreeConfigs = new Map(); // Worktree-specific configs (sessionId → config)
    this.worktreeTags = new Map(); // Worktree path → tags (e.g., readyForReview)

    // Button registry - all available buttons with their implementations
    this.buttonRegistry = this.initButtonRegistry();

    this.init();
  }
  
  async init() {
    try {
      // Initialize managers
      this.terminalManager = new TerminalManager(this);
      this.notificationManager = new NotificationManager(this);
      this.agentModalManager = new AgentModalManager(this);

      // Initialize tab manager for multi-workspace support
      if (typeof WorkspaceTabManager !== 'undefined') {
        this.tabManager = new WorkspaceTabManager(this);
        console.log('Tab manager initialized');
      }

      // Initialize Commander panel (Top-Level Claude terminal)
      if (typeof CommanderPanel !== 'undefined') {
        this.commanderPanel = new CommanderPanel(this);
        this.commanderPanel.init();
        console.log('Commander panel initialized');
      }

      // Initialize Voice Control (push-to-talk voice commands)
      if (typeof VoiceControl !== 'undefined') {
        this.voiceControl = new VoiceControl(this);
        console.log('Voice control initialized (press V or click mic button)');
      }

      // Initialize Greenfield wizard for new project creation
      if (typeof GreenfieldWizard !== 'undefined') {
        this.greenfieldWizard = new GreenfieldWizard(this);
        document.getElementById('greenfield-btn')?.addEventListener('click', () => {
          this.greenfieldWizard.show();
        });
        console.log('Greenfield wizard initialized');
      }

      // Initialize Conversation browser for history
      if (typeof ConversationBrowser !== 'undefined') {
        this.conversationBrowser = new ConversationBrowser(this);
        document.getElementById('conversations-btn')?.addEventListener('click', () => {
          this.conversationBrowser.show();
        });
        console.log('Conversation browser initialized');
      }

      // PRs panel
      document.getElementById('prs-btn')?.addEventListener('click', () => {
        this.showPRsPanel();
      });

      // Initialize Ports panel
      document.getElementById('ports-btn')?.addEventListener('click', () => {
        this.showPortsPanel();
      });

      // Initialize sidebar ports and set up auto-refresh
      this.refreshSidebarPorts();
      setInterval(() => this.refreshSidebarPorts(), 30000); // Refresh every 30s

      // Request notification permission if enabled
      if (this.settings.notifications) {
        this.notificationManager.requestPermission();
      }
      
      // Set up UI
      this.setupEventListeners();
      this.applyTheme();
      this.syncSettingsUI();
      
      // Connect to server
      await this.connectToServer();
      
      // Load user settings from server
      await this.loadUserSettings();

      // Load worktree tags (ready-for-review, etc.)
      await this.loadWorktreeTags();
      
      // Check for updates on startup
      this.checkForSettingsUpdates();
      
      // Hide loading message if it exists
      const loadingMessage = document.getElementById('loading-message');
      if (loadingMessage) {
        loadingMessage.classList.add('hidden');
      }
      
    } catch (error) {
      console.error('Failed to initialize:', error);
      this.showError('Failed to initialize application');
    }
  }
  
  async connectToServer() {
    return new Promise((resolve, reject) => {
      console.log('Attempting to connect to server...');
      const authToken = this.getAuthToken();
      const socketOptions = authToken ? { auth: { token: authToken } } : {};

      // Connect to server - client dev-server proxies to correct backend port from .env
      // Production: client on 2080 proxies to server on 3000
      // Development: client on 2081 proxies to server on 4000
      const serverUrl = window.location.origin;
      this.socket = io(serverUrl, socketOptions);
      console.log(`Socket connecting to ${serverUrl}...`);
      
      // Connection events
      this.socket.on('connect', () => {
        console.log('Connected to server');
        this.updateConnectionStatus(true);
        resolve();
      });
      
      this.socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
        this.updateConnectionStatus(false);
        
        if (error.message === 'Authentication failed') {
          this.showError('Authentication failed. Please check your token.');
        }
        reject(error);
      });
      
      this.socket.on('disconnect', () => {
        console.log('Disconnected from server');
        this.updateConnectionStatus(false);
      });
      
      // Session events
      this.socket.on('sessions', async (sessionStates) => {
        console.log('Received sessions event:', sessionStates);

        // Pre-fetch worktree configs if we have an active workspace
        if (this.currentWorkspace) {
          await this.prefetchWorktreeConfigs(this.currentWorkspace, sessionStates);
        }

        this.handleInitialSessions(sessionStates);
      });

      // Worktree tag updates (e.g., ready-for-review) from other clients
      this.socket.on('worktree-tag-updated', ({ worktreePath, tag }) => {
        if (!worktreePath) return;
        this.worktreeTags.set(worktreePath, tag || {});
        this.buildSidebar();
      });
      
      this.socket.on('terminal-output', ({ sessionId, data }) => {
        this.terminalManager.handleOutput(sessionId, data);

        // Notify inactive tabs if tab manager is enabled
        if (this.tabManager && this.currentTabId) {
          const activeTab = this.tabManager.getActiveTab();
          // If this session belongs to an inactive tab, show notification
          for (const [tabId, tab] of this.tabManager.tabs) {
            if (tab.sessions.has(sessionId) && tabId !== this.currentTabId) {
              const eventType = data.includes('[Error]') || data.includes('error') ? 'error' : 'output';
              this.tabManager.notifyTab(tabId, eventType);
              break;
            }
          }
        }

        // Check for server errors
        if (sessionId.includes('-server') && data.includes('[Error]')) {
          this.handleServerError(sessionId, data);
        }

        // Update server status based on output
        if (sessionId.includes('-server')) {
          this.updateServerStatus(sessionId, data);
        }

        // Detect GitHub URLs in Claude sessions
        if (sessionId.includes('-claude')) {
          this.detectGitHubLinks(sessionId, data);
        }

        // Detect clear commands to reset PR links and activity
        if (data.includes('/clear') || data.includes('clear')) {
          this.clearGitHubLinks(sessionId);
          this.sessionActivity.delete(sessionId);
          this.buildSidebar();
        }

        // Mark session as active when there's terminal activity
        if (data.trim().length > 0) {
          this.sessionActivity.set(sessionId, 'active');
        }
      });
      
      this.socket.on('status-update', ({ sessionId, status }) => {
        this.updateSessionStatus(sessionId, status);
      });
      
      this.socket.on('branch-update', ({ sessionId, branch, remoteUrl, defaultBranch, existingPR }) => {
        this.updateSessionBranch(sessionId, branch, remoteUrl, defaultBranch, existingPR);
      });
      
      this.socket.on('notification-trigger', (notification) => {
        this.notificationManager.handleNotification(notification);
      });
      
      this.socket.on('session-exited', ({ sessionId, exitCode }) => {
        this.handleSessionExit(sessionId, exitCode);
      });

      this.socket.on('session-restarted', ({ sessionId }) => {
        this.handleSessionRestart(sessionId);
      });

      this.socket.on('session-closed', ({ sessionId }) => {
        console.log(`Session closed by server: ${sessionId}`);
        // Remove session from local state
        this.sessions.delete(sessionId);
        this.visibleTerminals.delete(sessionId);

        // Remove terminal from UI
        const terminalElement = document.getElementById(`terminal-${sessionId}`);
        if (terminalElement) {
          console.log(`Removing terminal element from DOM: ${sessionId}`);
          terminalElement.remove();
        }

        // Remove from terminal manager
        if (this.terminalManager) {
          this.terminalManager.destroyTerminal(sessionId);
        }

        // Rebuild sidebar to reflect changes
        this.buildSidebar();

        // Reflow the grid after removing terminal
        if (this.terminalManager && this.terminalManager.fitAllTerminals) {
          setTimeout(() => {
            this.terminalManager.fitAllTerminals();
          }, 100);
        }
      });

      // ============ COMMANDER UI CONTROL ============
      // Commander Claude can control UI via these semantic commands
      this.socket.on('commander-action', ({ action, ...params }) => {
        console.log('Commander action:', action, params);
        this.handleCommanderAction(action, params);
      });

      // Handle new worktree sessions being added without destroying existing ones
      this.socket.on('worktree-sessions-added', ({ worktreeId, sessions }) => {
        console.log('New worktree sessions added:', worktreeId, sessions);

        // Add the new sessions to our sessions map (don't clear existing!)
        for (const [sessionId, sessionState] of Object.entries(sessions)) {
          this.sessions.set(sessionId, {
            sessionId,
            ...sessionState,
            hasUserInput: false
          });

          // If there's an existing PR, add it to GitHub links
          if (sessionState.existingPR) {
            const links = this.githubLinks.get(sessionId) || {};
            links.pr = sessionState.existingPR;
            this.githubLinks.set(sessionId, links);
          }

          // Mark new sessions as active so they show in the grid
          this.sessionActivity.set(sessionId, 'active');

          // Add to visible terminals set
          this.visibleTerminals.add(sessionId);

          // Register with current tab if tab manager is enabled
          if (this.tabManager && this.currentTabId) {
            const tab = this.tabManager.getTab(this.currentTabId);
            if (tab) {
              tab.sessions.set(sessionId, this.sessions.get(sessionId));
            }
          }
        }

        // Rebuild sidebar to show new worktree
        this.buildSidebar();

        // Update terminal grid to display new terminals
        this.updateTerminalGrid();

        // Show success message
        this.showTemporaryMessage(`Worktree ${worktreeId} terminals ready!`, 'success');

        // Auto-start Claude after a delay to let terminals initialize
        setTimeout(() => {
          this.checkAndApplyAutoStart();
        }, 2000);
      });

      this.socket.on('claude-started', ({ sessionId }) => {
        // Hide + persist dismissal so it doesn't resurrect on refresh/worktree-add
        this.hideStartupUI(sessionId);
        
        // Enable the start button now that Claude has started
        const startBtn = document.getElementById(`claude-start-btn-${sessionId}`);
        if (startBtn) {
          startBtn.disabled = false;
        }
      });

      // Agent-agnostic equivalent (Codex/OpenCode/etc). Startup UI only exists on -claude terminals,
      // but hiding is safe and prevents resurrection when agent is started via recovery/automation.
      this.socket.on('agent-started', ({ sessionId }) => {
        this.hideStartupUI(sessionId);
      });

      this.socket.on('claude-update-required', (updateInfo) => {
        this.showClaudeUpdateRequired(updateInfo);
      });
      
      this.socket.on('user-settings-updated', (settings) => {
        console.log('User settings updated:', settings);
        this.userSettings = settings;
        this.syncUserSettingsUI();
      });

      // Workspace events
      this.socket.on('workspace-info', async ({ active, available, config, workspaceTypes, frameworks, cascadedConfigs }) => {
        console.log('Received workspace info:', { active, available, config, workspaceTypes, frameworks, cascadedConfigs });
        this.currentWorkspace = active;
        this.availableWorkspaces = available;
        this.orchestratorConfig = config;

        // Store dynamic workspace types
        this.workspaceTypes = workspaceTypes || {};
        this.frameworks = frameworks || {};
        this.cascadedConfigs = cascadedConfigs || {};
        console.log('🎯 Dynamic workspace types loaded:', {
          totalTypes: Object.keys(this.workspaceTypes).length,
          frameworks: Object.keys(this.frameworks),
          cascadedConfigs: Object.keys(this.cascadedConfigs).length
        });

        // Initialize workspace switcher
        this.workspaceSwitcher = new WorkspaceSwitcher(this);
        this.workspaceSwitcher.render();

        // If there's an active workspace and tabManager is initialized,
        // create or focus a tab for it (handles page refresh / reconnect)
        if (active && this.tabManager) {
          // If a tab for this workspace already exists, just focus it
          const existingTab = Array.from(this.tabManager.tabs.values())
            .find(tab => tab.workspaceId === active.id);

          if (existingTab) {
            console.log(`Active workspace already open, switching to tab ${existingTab.id}`);
            await this.tabManager.switchTab(existingTab.id);
            this.tabManager.pruneDuplicateWorkspaceTabs(active.id, existingTab.id);
          } else if (this.tabManager.tabs.size === 0) {
            console.log('Creating initial tab for active workspace after page load');

            // Hide dashboard if showing
            if (this.dashboard) {
              this.dashboard.hide();
            }

            // Show main UI
            const mainContainer = document.querySelector('.main-container');
            const sidebar = document.querySelector('.sidebar');
            if (mainContainer) mainContainer.classList.remove('hidden');
            if (sidebar) sidebar.classList.remove('hidden');

            // Create tab for the active workspace
            // Note: sessions will come later in the 'sessions' event
            const tabId = this.tabManager.createTab(active, []);
            console.log(`Created initial tab ${tabId} for workspace ${active.name}`);

            // Set currentTabId so subsequent sessions event knows which tab to use
            this.currentTabId = tabId;

            // Switch to the new tab
            await this.tabManager.switchTab(tabId);
            this.tabManager.pruneDuplicateWorkspaceTabs(active.id, tabId);

            this.isDashboardMode = false;
          } else {
            console.log('Active workspace received on reconnect; preserving current tabs');
            this.tabManager.pruneDuplicateWorkspaceTabs(active.id, this.currentTabId || this.tabManager.activeTabId);
          }
        }

        // Update voice command context with workspace info
        this.updateVoiceContext();

        // Initialize dashboard if configured
        if (config.ui.startupDashboard && !active) {
          this.showDashboard();
        }
      });

      this.socket.on('workspace-changed', async ({ workspace, sessions }) => {
        console.log('Workspace changed:', workspace.name);

        // If tab manager is enabled, create a new tab for this workspace
        if (this.tabManager) {
          // Hide dashboard if showing
          if (this.dashboard) {
            this.dashboard.hide();
          }

          // Show main UI
          const mainContainer = document.querySelector('.main-container');
          const sidebar = document.querySelector('.sidebar');
          if (mainContainer) mainContainer.classList.remove('hidden');
          if (sidebar) sidebar.classList.remove('hidden');

          // Check if this workspace is already open in a tab
          let existingTab = null;
          for (const [tabId, tab] of this.tabManager.tabs) {
            if (tab.workspaceId === workspace.id) {
              existingTab = tab;
              break;
            }
          }

          if (existingTab) {
            // Switch to existing tab
            console.log(`Workspace ${workspace.name} already open, switching to tab`);
            // Set current workspace FIRST so tab manager doesn't re-request the backend switch
            this.currentWorkspace = workspace;
            this.isDashboardMode = false;
            await this.tabManager.switchTab(existingTab.id);
            this.tabManager.pruneDuplicateWorkspaceTabs(workspace.id, existingTab.id);

            // Ensure the active tab view is refreshed with the latest sessions for this workspace
            this.currentTabId = existingTab.id;

            // Pre-fetch worktree-specific configs for all terminals
            await this.prefetchWorktreeConfigs(workspace, sessions);

            this.handleInitialSessions(sessions);

            // Update workspace switcher
            if (this.workspaceSwitcher) {
              this.workspaceSwitcher.updateCurrentWorkspace();
            }
          } else {
            // Create new tab for this workspace
            const tabId = this.tabManager.createTab(workspace, sessions);
            console.log(`Created new tab ${tabId} for workspace ${workspace.name}`);

            // CRITICAL: Set currentTabId FIRST before anything else
            // Terminals need this to register to the correct tab
            this.currentTabId = tabId;

            // Switch to the new tab so it becomes active
            await this.tabManager.switchTab(tabId);
            this.tabManager.pruneDuplicateWorkspaceTabs(workspace.id, tabId);

            // Pre-fetch worktree-specific configs for all terminals
            await this.prefetchWorktreeConfigs(workspace, sessions);

            // Set current workspace
            this.currentWorkspace = workspace;
            this.isDashboardMode = false;

            // Rebuild with new workspace sessions
            // Terminals will now register to the correct tab via currentTabId
            this.handleInitialSessions(sessions);

            // Update workspace switcher
            if (this.workspaceSwitcher) {
              this.workspaceSwitcher.updateCurrentWorkspace();
            }
          }
        } else {
          // Original behavior (no tabs) - for backwards compatibility
          this.currentWorkspace = workspace;
          this.isDashboardMode = false;

          // Hide dashboard if showing
          if (this.dashboard) {
            this.dashboard.hide();
          }

          // Show main UI
          const mainContainer = document.querySelector('.main-container');
          const sidebar = document.querySelector('.sidebar');
          if (mainContainer) mainContainer.classList.remove('hidden');
          if (sidebar) sidebar.classList.remove('hidden');

          // Clear ALL existing state completely
          this.sessions.clear();
          this.visibleTerminals.clear();
          this.worktreeConfigs.clear();

          // Pre-fetch worktree-specific configs for all terminals
          await this.prefetchWorktreeConfigs(workspace, sessions);
          this.sessionActivity.clear();
          this.serverStatuses.clear();
          this.serverPorts.clear();
          this.githubLinks.clear();
          this.githubLinkLogs.clear();
          this.autoStartApplied.clear();

          // Clear terminal manager terminals
          if (this.terminalManager) {
            this.terminalManager.clearAll();
          }

          // Clear terminal grid completely
          const grid = document.getElementById('terminal-grid');
          if (grid) {
            grid.innerHTML = '';
            grid.removeAttribute('data-visible-count');
          }

          // Clear sidebar
          const worktreeList = document.getElementById('worktree-list');
          if (worktreeList) {
            worktreeList.innerHTML = '';
          }

          // Rebuild with new workspace sessions
          this.handleInitialSessions(sessions);

          // Update workspace switcher to show correct workspace
          if (this.workspaceSwitcher) {
            this.workspaceSwitcher.updateCurrentWorkspace();
          }
        }
      });

      this.socket.on('git-updated', (result) => {
        console.log('Git updated:', result);
        this.showTemporaryMessage(`Repository updated successfully! ${result.wasUpToDate ? 'Already up to date.' : 'Changes pulled.'}`, 'success');
        
        // Refresh the page after successful update
        if (!result.wasUpToDate) {
          setTimeout(() => {
            this.showTemporaryMessage('Refreshing page to apply updates...', 'info');
            setTimeout(() => {
              location.reload();
            }, 2000);
          }, 3000);
        }
      });
      
      // Build production events
      this.socket.on('build-started', ({ sessionId, worktreeNum }) => {
        console.log(`Build started for worktree ${worktreeNum}`);
      });
      
      this.socket.on('build-completed', ({ sessionId, worktreeNum, zipPath }) => {
        console.log(`Build completed for worktree ${worktreeNum}: ${zipPath}`);
        
        // Restore the build button (use work{num} pattern to find buttons)
        this.restoreBuildButton(`work${worktreeNum}`);
        
        // Request to reveal the file in explorer
        this.socket.emit('reveal-in-explorer', { path: zipPath });
      });
      
      this.socket.on('build-failed', ({ sessionId, worktreeNum, error }) => {
        console.error(`Build failed for worktree ${worktreeNum}:`, error);
        this.showError(`❌ Build failed for Worktree ${worktreeNum}: ${error}`);
        
        // Restore the build button (use work{num} pattern to find buttons)
        this.restoreBuildButton(`work${worktreeNum}`);
      });
      
      // Periodic heartbeat to keep sessions alive while UI is open
      this.startHeartbeats();
      
      this.socket.on('server-started', ({ sessionId, port }) => {
        console.log(`[SERVER-STARTED EVENT] Session: ${sessionId}, Port: ${port}`);
        this.serverPorts.set(sessionId, port);
        console.log(`Server ${sessionId} started on port ${port}`);
        console.log('Current serverPorts:', Array.from(this.serverPorts.entries()));
        
        // Only open localhost automatically - Hytopia needs manual click due to popup blockers
        setTimeout(() => {
          const localhostUrl = `https://localhost:${port}`;
          console.log(`Opening localhost for initialization: ${localhostUrl}`);
          window.open(localhostUrl, '_blank');
          
          // Show notification that server is ready
          if (this.settings.notifications) {
            this.showNotification('Server Ready', `Server ${sessionId.replace('-server', '')} is running on port ${port}. Click 🎮 to play!`);
          }
        }, 2000); // Wait 2 seconds for server to fully start
      });

      // NOTE: branch-update handler is registered earlier (line ~187) via updateSessionBranch()
      // Don't register duplicate handler here - it causes double processing

      // Set timeout for connection
      const timeoutId = setTimeout(() => {
        if (!this.socket.connected) {
          console.error('Connection timeout - server may not be reachable');
          this.showError('Connection timeout - please check if server is running on port 3000');
          reject(new Error('Connection timeout'));
        }
      }, 10000);
      
      // Clear timeout on successful connection
      this.socket.on('connect', () => {
        clearTimeout(timeoutId);
      });
    });
  }
  
  startHeartbeats() {
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
    }
    this._heartbeatInterval = setInterval(() => {
      if (!this.socket || !this.socket.connected) return;
      for (const sessionId of this.sessions.keys()) {
        this.socket.emit('session-heartbeat', { sessionId });
      }
    }, 30000);
  }
  
  setupEventListeners() {
    // Check if elements exist before adding listeners
    const elements = {
      'worktree-list': null,
      'view-all': null,
      'view-claude-only': null,
      'view-servers-only': null,
      'view-presets': null,
      'close-presets': null,
      'settings-toggle': null,
      'close-settings': null,
      'notification-toggle': null,
      'enable-notifications': null,
      'enable-sounds': null,
      'auto-scroll': null,
      'theme-select': null,
      'global-skip-permissions': null,
      'reset-to-defaults': null,
      'save-as-default': null,
      'check-updates': null,
      'pull-updates': null,
      'dismiss-settings-notification': null,
      'dismiss-git-notification': null,
      'start-claude': null,
      'cancel-claude-startup': null
    };
    
    // Check all elements exist
    for (const id in elements) {
      elements[id] = document.getElementById(id);
      if (!elements[id]) {
        console.warn(`Element not found: ${id}`);
      }
    }
    
    // Sidebar worktree clicks - use toggle instead of show
    if (elements['worktree-list']) {
      elements['worktree-list'].addEventListener('click', (e) => {
        // Check if click was on ready-for-review toggle
        const readyBtn = e.target.closest('.ready-review-btn');
        if (readyBtn) {
          e.preventDefault();
          e.stopPropagation();

          const worktreePath = readyBtn.dataset.worktreePath;
          if (worktreePath) {
            this.toggleWorktreeReadyForReview(worktreePath);
          }
          return;
        }

        // Check if click was on delete button
        if (e.target.closest('.delete-worktree-btn')) {
          return; // Let the button's onclick handler deal with it
        }

        const item = e.target.closest('.worktree-item');
        if (item) {
          const worktreeId = item.dataset.worktreeId;
          console.log(`Tab clicked: ${worktreeId}, Ctrl: ${e.ctrlKey}, Meta: ${e.metaKey}`);

          // Ctrl+Click or Cmd+Click = solo mode (show only this worktree)
          if (e.ctrlKey || e.metaKey) {
            this.showOnlyWorktree(worktreeId);
          } else {
            // Normal click = toggle visibility
            this.toggleWorktreeVisibility(worktreeId);
          }
        }
      });
    }
    
	    // View buttons
	    const dashboardBtn = document.getElementById('dashboard-btn');
	    if (dashboardBtn) {
	      dashboardBtn.addEventListener('click', () => {
	        this.showDashboard();
	      });
	    }

	    document.getElementById('view-all').addEventListener('click', () => {
	      this.showAllTerminals();
	    });
    
    document.getElementById('view-claude-only').addEventListener('click', () => {
      this.showClaudeOnly();
    });
    
    document.getElementById('view-servers-only').addEventListener('click', () => {
      this.showServersOnly();
    });
    
    // Presets
    document.getElementById('view-presets').addEventListener('click', () => {
      document.getElementById('presets-modal').classList.remove('hidden');
    });
    
    document.getElementById('close-presets').addEventListener('click', () => {
      document.getElementById('presets-modal').classList.add('hidden');
    });
    
    // Preset buttons
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = btn.dataset.preset;
        this.applyPreset(preset);
        document.getElementById('presets-modal').classList.add('hidden');
      });
    });
    
    // Grid layout dropdown removed - using dynamic layout now
    
    // Settings
    const settingsToggle = document.getElementById('settings-toggle');
    if (settingsToggle) {
      settingsToggle.addEventListener('click', () => {
        const panel = document.getElementById('settings-panel');
        if (panel) {
          panel.classList.toggle('hidden');
          console.log('Settings panel toggled');
        }
      });
    } else {
      console.error('Settings toggle button not found!');
    }
    
    document.getElementById('close-settings').addEventListener('click', () => {
      document.getElementById('settings-panel').classList.add('hidden');
    });
    
    // Settings inputs
    document.getElementById('enable-notifications').addEventListener('change', (e) => {
      this.settings.notifications = e.target.checked;
      this.saveSettings();
      if (e.target.checked) {
        this.notificationManager.requestPermission();
      }
    });
    
    document.getElementById('enable-sounds').addEventListener('change', (e) => {
      this.settings.sounds = e.target.checked;
      this.saveSettings();
    });
    
    document.getElementById('auto-scroll').addEventListener('change', (e) => {
      this.settings.autoScroll = e.target.checked;
      this.saveSettings();
    });
    
    document.getElementById('theme-select').addEventListener('change', (e) => {
      this.settings.theme = e.target.value;
      this.saveSettings();
      this.applyTheme();
    });

    // User settings (terminal flags)
    document.getElementById('global-skip-permissions').addEventListener('change', (e) => {
      this.updateGlobalUserSetting('claudeFlags.skipPermissions', e.target.checked);
    });

    const globalZaiProvider = document.getElementById('global-zai-provider');
    if (globalZaiProvider) {
      globalZaiProvider.addEventListener('change', (e) => {
        const provider = e.target.checked ? 'zai' : 'anthropic';
        this.updateGlobalUserSetting('claudeFlags.provider', provider);
      });
    }

    // Auto-start settings
    const globalAutoStart = document.getElementById('global-auto-start');
    const autoStartOptions = document.getElementById('auto-start-options');

    if (globalAutoStart) {
      globalAutoStart.addEventListener('change', (e) => {
        this.updateGlobalUserSetting('autoStart.enabled', e.target.checked);
        autoStartOptions.style.display = e.target.checked ? 'block' : 'none';
      });
    }

    const globalAutoStartMode = document.getElementById('global-auto-start-mode');
    if (globalAutoStartMode) {
      globalAutoStartMode.addEventListener('change', (e) => {
        this.updateGlobalUserSetting('autoStart.mode', e.target.value);
      });
    }

    const globalAutoStartDelay = document.getElementById('global-auto-start-delay');
    if (globalAutoStartDelay) {
      globalAutoStartDelay.addEventListener('change', (e) => {
        const delay = parseInt(e.target.value);
        if (!isNaN(delay) && delay >= 0 && delay <= 5000) {
          this.updateGlobalUserSetting('autoStart.delay', delay);
        }
      });
    }

    // Session recovery settings
    const sessionRecoveryEnabled = document.getElementById('session-recovery-enabled');
    const sessionRecoveryOptions = document.getElementById('session-recovery-options');

    if (sessionRecoveryEnabled) {
      sessionRecoveryEnabled.addEventListener('change', (e) => {
        this.updateGlobalUserSetting('sessionRecovery.enabled', e.target.checked);
        if (sessionRecoveryOptions) {
          sessionRecoveryOptions.style.display = e.target.checked ? 'block' : 'none';
        }
      });
    }

    const sessionRecoveryMode = document.getElementById('session-recovery-mode');
    if (sessionRecoveryMode) {
      sessionRecoveryMode.addEventListener('change', (e) => {
        this.updateGlobalUserSetting('sessionRecovery.mode', e.target.value);
      });
    }

    const recoveryResumeCwd = document.getElementById('recovery-resume-cwd');
    if (recoveryResumeCwd) {
      recoveryResumeCwd.addEventListener('change', (e) => {
        this.updateGlobalUserSetting('sessionRecovery.resumeCwd', e.target.checked);
      });
    }

    const recoveryResumeConversation = document.getElementById('recovery-resume-conversation');
    if (recoveryResumeConversation) {
      recoveryResumeConversation.addEventListener('change', (e) => {
        this.updateGlobalUserSetting('sessionRecovery.resumeConversation', e.target.checked);
      });
    }

    const recoverySkipPermissions = document.getElementById('recovery-skip-permissions');
    if (recoverySkipPermissions) {
      recoverySkipPermissions.addEventListener('change', (e) => {
        this.updateGlobalUserSetting('sessionRecovery.skipPermissions', e.target.checked);
      });
    }

    // Template management buttons
    document.getElementById('reset-to-defaults').addEventListener('click', () => {
      this.resetToDefaults();
    });

    document.getElementById('save-as-default').addEventListener('click', () => {
      this.saveAsDefault();
    });

    // Git update buttons
    document.getElementById('check-updates').addEventListener('click', () => {
      this.checkForUpdates();
    });

    document.getElementById('pull-updates').addEventListener('click', () => {
      this.pullLatestChanges();
    });

    // Notification dismiss buttons
    document.getElementById('dismiss-settings-notification').addEventListener('click', () => {
      document.getElementById('settings-update-notification').classList.add('hidden');
    });

    document.getElementById('dismiss-git-notification').addEventListener('click', () => {
      document.getElementById('git-update-notification').classList.add('hidden');
    });
    
    // Notification toggle - for now, just open settings to notification section
    document.getElementById('notification-toggle').addEventListener('click', () => {
      // Open settings panel
      document.getElementById('settings-panel').classList.remove('hidden');
      // Focus on notifications checkbox
      document.getElementById('enable-notifications').focus();
    });
    
    // Claude startup modal handlers (simplified)
    const cancelClaudeBtn = document.getElementById('cancel-claude-startup');
    
    if (cancelClaudeBtn) {
      cancelClaudeBtn.addEventListener('click', () => {
        this.hideClaudeStartupModal();
      });
    }
    
    // Handle startup option button clicks
    document.addEventListener('click', (e) => {
      if (e.target.closest('.startup-option-btn')) {
        const btn = e.target.closest('.startup-option-btn');
        const mode = btn.dataset.mode;
        
        // Check if modal YOLO is checked
        const modalYolo = document.getElementById('modal-yolo');
        const skipPermissions = modalYolo ? modalYolo.checked : false;
        
        if (this.pendingClaudeSession) {
          this.startClaudeWithOptions(this.pendingClaudeSession, mode, skipPermissions);
          this.hideClaudeStartupModal();
        }
      }
    });
    
    // Handle window resize to fix blank terminals
    let resizeTimeout;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        // Refit all visible terminals
        this.activeView.forEach(sessionId => {
          this.terminalManager.fitTerminal(sessionId);
          const term = this.terminalManager.terminals.get(sessionId);
          if (term) {
            term.refresh(0, term.rows - 1);
          }
        });
      }, 250);
    });
  }
  
  handleInitialSessions(sessionStates) {
    console.log('Received initial sessions:', sessionStates);

    // Preserve per-workspace worktree visibility (hide/show toggles) when we
    // receive a sessions refresh for the SAME workspace (e.g. after adding a
    // worktree). Never carry visibility between different workspaces.
    const currentWorkspaceId = this.currentWorkspace?.id || null;
    const previousWorkspaceId = this.lastSessionsWorkspaceId || null;
    const preserveVisibility = !!(currentWorkspaceId && previousWorkspaceId && currentWorkspaceId === previousWorkspaceId);
    const previousSessionIds = new Set(this.sessions.keys());
    const previousVisibleSessionIds = new Set(this.visibleTerminals);

    // Clear existing sessions and activity tracking
    this.sessions.clear();
    this.sessionActivity.clear();
    this.visibleTerminals.clear();
    
    // Process sessions
    for (const [sessionId, state] of Object.entries(sessionStates)) {
      const sessionData = {
        sessionId,
        ...state,
        hasUserInput: false
      };
      this.sessions.set(sessionId, sessionData);

      // Register session with current tab if tab manager is enabled
      if (this.tabManager && this.currentTabId) {
        const tab = this.tabManager.getTab(this.currentTabId);
        if (tab) {
          tab.sessions.set(sessionId, sessionData);
        }
      }

      // If there's an existing PR, add it to GitHub links automatically
      if (state.existingPR) {
        const links = this.githubLinks.get(sessionId) || {};
        links.pr = state.existingPR;
        this.githubLinks.set(sessionId, links);
        console.log('Loaded existing PR for session:', sessionId, state.existingPR);
      }

      // For mixed-repo workspaces, set terminals as active immediately so they show by default
      // For traditional workspaces, they start as inactive until user interacts
      const isComplexSessionId = sessionId.includes('-') && sessionId.split('-').length > 2;
      this.sessionActivity.set(sessionId, isComplexSessionId ? 'active' : 'inactive');

      // Visibility: default to visible, but preserve per-session hidden state if
      // this is a refresh for the same workspace.
      const isExistingSession = previousSessionIds.has(sessionId);
      const shouldBeVisible = preserveVisibility
        ? (isExistingSession ? previousVisibleSessionIds.has(sessionId) : true)
        : true;
      if (shouldBeVisible) {
        this.visibleTerminals.add(sessionId);
      }
      // Debug: console.log(`Added terminal ${sessionId} to visible set, activity: ${this.sessionActivity.get(sessionId)}`);
    }

    this.lastSessionsWorkspaceId = currentWorkspaceId;
    
    // Hide loading message FIRST
    const loadingMessage = document.getElementById('loading-message');
    if (loadingMessage) {
      loadingMessage.style.display = 'none';
    }
    
    // Build sidebar
    this.buildSidebar();

    // Show all visible terminals
    this.updateTerminalGrid();

    // Check for auto-start after a delay to let terminals initialize
    setTimeout(() => {
      this.checkAndApplyAutoStart();
    }, 2000);

    // Apply session recovery if pending
    if (this.dashboard?.pendingRecovery && this.dashboard.pendingRecovery.mode !== 'skip') {
      setTimeout(() => {
        this.applySessionRecovery(this.dashboard.pendingRecovery);
        this.dashboard.pendingRecovery = null;
      }, 1000);
    }

    // Update voice command context with session info
    this.updateVoiceContext();
  }

  checkAndApplyAutoStart() {
    if (!this.userSettings) {
      console.log('User settings not loaded yet, skipping auto-start');
      return;
    }

    // Check each Claude session for auto-start
    for (const [sessionId, session] of this.sessions) {
      if (sessionId.includes('-claude')) {
        // Skip if this session was recovered
        if (this.recoveredSessions && this.recoveredSessions.has(sessionId)) {
          console.log(`Skipping auto-start for ${sessionId} - already recovered`);
          continue;
        }
        if (this.autoStartApplied.has(sessionId)) {
          continue;
        }

        const effectiveSettings = this.getEffectiveSettings(sessionId);

        if (effectiveSettings && effectiveSettings.autoStart && effectiveSettings.autoStart.enabled) {
          console.log(`Auto-start enabled for ${sessionId}`, effectiveSettings.autoStart);

          // Hide the startup UI since auto-start will handle it
          this.hideStartupUI(sessionId);

          // Apply auto-start with configured delay
          const delay = effectiveSettings.autoStart.delay || 500;
          const mode = effectiveSettings.autoStart.mode || 'fresh';
          const skipPermissions = effectiveSettings.claudeFlags.skipPermissions || false;

          setTimeout(() => {
            console.log(`Auto-starting Claude ${sessionId} with mode: ${mode}, skip: ${skipPermissions}`);
            this.startClaudeWithOptions(sessionId, mode, skipPermissions);
          }, delay);
          this.autoStartApplied.add(sessionId);
        } else {
          // Only show startup UI if the session is actually waiting.
          // Passing hardcoded "waiting" can resurrect the overlay after worktree adds / reconnects.
          this.showStartupUIIfNeeded(sessionId, session.status || 'idle', null);
        }
      }
    }
  }

  extractRepositoryName(sessionId) {
    // For mixed-repo workspaces, get repository name from workspace config
    if (this.currentWorkspace?.workspaceType === 'mixed-repo') {
      const terminals = Array.isArray(this.currentWorkspace.terminals)
        ? this.currentWorkspace.terminals
        : this.currentWorkspace.terminals?.pairs;

      if (terminals) {
        const terminal = terminals.find(t => t.id === sessionId);
        if (terminal?.repository?.name) {
          return terminal.repository.name;
        }
      }
    }

    // Fallback: parse from session ID (for backwards compatibility)
    const parts = sessionId.split('-');
    const workIndex = parts.findIndex(part => part.startsWith('work'));
    if (workIndex > 0) {
      return parts.slice(0, workIndex).join('-');
    }
    return null; // Traditional workspace
  }

  /**
   * Initialize button registry with all available buttons
   * Maps button IDs to their implementations
   */
  initButtonRegistry() {
    return {
      // Common buttons (Global level - all projects)
      focus: {
        icon: '🔍',
        title: 'Show Only This Worktree',
        action: 'focusTerminal',
        showWhen: 'always',
        terminalType: 'both'
      },

      // Claude terminal buttons
      replay: {
        icon: '📹',
        title: 'Open Replay Viewer',
        action: 'openReplayViewer',
        showWhen: 'always',
        terminalType: 'claude'
      },
      claudeStart: {
        icon: '🚀',
        title: 'Start Claude with Settings',
        action: 'autoStartClaude',
        showWhen: 'always',
        terminalType: 'claude',
        special: 'disabled-until-ready'
      },
      claudeModal: {
        icon: '↻',
        title: 'Start Agent with Options',
        action: 'showClaudeStartupModal',
        showWhen: 'always',
        terminalType: 'claude'
      },
      refresh: {
        icon: '🔄',
        title: 'Refresh Terminal Display',
        action: 'refreshTerminal',
        showWhen: 'always',
        terminalType: 'claude'
      },
      review: {
        icon: '👥',
        title: 'Assign Code Review',
        action: 'showCodeReviewDropdown',
        showWhen: 'always',
        terminalType: 'claude'
      },

      // Server terminal buttons
      play: {
        icon: '🎮',
        title: 'Play in Hytopia',
        action: 'playInHytopia',
        showWhen: 'running',
        terminalType: 'server'
      },
      copyUrl: {
        icon: '📋',
        title: 'Copy HTTPS localhost URL',
        action: 'copyLocalhostUrl',
        showWhen: 'running',
        terminalType: 'server'
      },
      website: {
        icon: '🌐',
        title: 'Open Hytopia Website',
        action: 'openHytopiaWebsite',
        showWhen: 'always',
        terminalType: 'server'
      },
      build: {
        icon: '📦',
        title: 'Build Production ZIP',
        action: 'buildProduction',
        showWhen: 'always',
        terminalType: 'both'
      },
      kill: {
        icon: '✕',
        title: 'Force Kill',
        action: 'killServer',
        showWhen: 'always',
        terminalType: 'server',
        className: 'danger'
      }
    };
  }

  /**
   * Get buttons for a session based on cascaded config
   * @param {string} sessionId
   * @param {string} terminalType - 'claude' or 'server'
   * @returns {Array} Array of button HTML strings
   */
  getButtonsForSession(sessionId, terminalType) {
    const session = this.sessions.get(sessionId);
    if (!session) return this.getDefaultButtons(terminalType, sessionId);

    // Get repository type for this session
    let repositoryType = session.repositoryType || null;
    if (this.currentWorkspace) {
      if (this.currentWorkspace.workspaceType === 'mixed-repo') {
        const repositoryName = this.extractRepositoryName(sessionId);
        // terminals can be either an array or {pairs: array}
        const terminals = Array.isArray(this.currentWorkspace.terminals)
          ? this.currentWorkspace.terminals
          : this.currentWorkspace.terminals?.pairs;

        if (repositoryName && terminals) {
          const terminal = terminals.find(t => t.id === sessionId)
            || terminals.find(t => t.repository?.name === repositoryName && t.worktree === session.worktreeId)
            || terminals.find(t => t.repository?.name === repositoryName);
          repositoryType = terminal?.repository?.type || null;
        }
      } else {
        repositoryType = this.currentWorkspace.type;
      }
    }

    if (!repositoryType) {
      console.log(`No repositoryType found for session ${sessionId}, using defaults`);
      return this.getDefaultButtons(terminalType, sessionId);
    }

    // Get worktree-specific cascaded config (pre-fetched)
    const cascadedConfig = this.worktreeConfigs.get(sessionId);
    console.log(`Looking up worktree config for ${sessionId} (type: ${repositoryType}):`, cascadedConfig);
    if (!cascadedConfig || !cascadedConfig.buttons) {
      console.log(`No worktree config or buttons found for ${sessionId}, using defaults`);
      return this.getDefaultButtons(terminalType, sessionId);
    }

    // Get button definitions for this terminal type
    const buttonDefs = cascadedConfig.buttons[terminalType] || {};
    const buttons = [];

    // Always add focus button first
    buttons.push(this.renderButton('focus', this.buttonRegistry.focus, sessionId));

    // Render configured buttons
    for (const [buttonId, buttonConfig] of Object.entries(buttonDefs)) {
      const registryEntry = this.buttonRegistry[buttonId];
      if (!registryEntry) continue;

      // Merge config with registry
      const mergedButton = { ...registryEntry, ...buttonConfig };
      buttons.push(this.renderButton(buttonId, mergedButton, sessionId));
    }

    return buttons;
  }

  /**
   * Render a single button
   */
  renderButton(buttonId, buttonDef, sessionId) {
    const className = `control-btn ${buttonDef.className || ''}`;
    const disabled = buttonDef.special === 'disabled-until-ready' ? 'disabled' : '';
    const id = buttonDef.special === 'disabled-until-ready' ? `id="claude-start-btn-${sessionId}"` : '';

    // Map action name to actual method call
    const actionMap = {
      focusTerminal: `window.orchestrator.focusTerminal('${sessionId}')`,
      openReplayViewer: `window.orchestrator.openReplayViewer('${sessionId}')`,
      autoStartClaude: `window.orchestrator.autoStartClaude('${sessionId}')`,
      showClaudeStartupModal: `window.orchestrator.showClaudeStartupModal('${sessionId}')`,
      refreshTerminal: `window.orchestrator.refreshTerminal('${sessionId}')`,
      showCodeReviewDropdown: `window.orchestrator.showCodeReviewDropdown('${sessionId}')`,
      playInHytopia: `window.orchestrator.playInHytopia('${sessionId}')`,
      copyLocalhostUrl: `window.orchestrator.copyLocalhostUrl('${sessionId}')`,
      openHytopiaWebsite: `window.orchestrator.openHytopiaWebsite()`,
      buildProduction: `window.orchestrator.buildProduction('${sessionId}')`,
      killServer: `window.orchestrator.killServer('${sessionId}')`
    };

    const onclick = actionMap[buttonDef.action] || buttonDef.action;

    return `<button class="${className}" ${id} ${disabled} onclick="${onclick}" title="${buttonDef.title}">${buttonDef.icon}</button>`;
  }

  /**
   * Get default buttons (fallback when no config)
   */
  getDefaultButtons(terminalType, sessionId = '') {
    if (terminalType === 'claude') {
      return [
        this.renderButton('focus', this.buttonRegistry.focus, sessionId),
        this.renderButton('claudeStart', this.buttonRegistry.claudeStart, sessionId),
        this.renderButton('claudeModal', this.buttonRegistry.claudeModal, sessionId),
        this.renderButton('refresh', this.buttonRegistry.refresh, sessionId),
        this.renderButton('review', this.buttonRegistry.review, sessionId),
        this.renderButton('build', this.buttonRegistry.build, sessionId)
      ];
    } else {
      return [
        this.renderButton('focus', this.buttonRegistry.focus, sessionId),
        this.renderButton('build', this.buttonRegistry.build, sessionId),
        this.renderButton('kill', this.buttonRegistry.kill, sessionId)
      ];
    }
  }

  /**
   * Pre-fetch worktree-specific configs for all terminals
   * @param {object} workspace
   * @param {array} sessions
   */
  async prefetchWorktreeConfigs(workspace, sessions) {
    console.log('Pre-fetching worktree configs...');
    const fetchPromises = [];

    for (const [sessionId, session] of Object.entries(sessions)) {
      // Extract worktree path
      let repositoryType = null;
      let worktreePath = null;

      try {
        if (workspace.workspaceType === 'mixed-repo') {
          const terminals = Array.isArray(workspace.terminals)
            ? workspace.terminals
            : workspace.terminals?.pairs;

          if (terminals) {
            const repositoryName = session.repositoryName || this.extractRepositoryName(sessionId);
            const terminal = terminals.find(t => t.id === sessionId)
              || terminals.find(t => t.repository?.name === repositoryName && t.worktree === session.worktreeId);
            if (terminal && terminal.repository && terminal.worktree) {
              repositoryType = terminal.repository.type;
              worktreePath = terminal.worktreePath || `${terminal.repository.path}/${terminal.worktree}`;
            }
          }
        } else {
          repositoryType = workspace.type;
          if (session.worktreeId && workspace.repository && workspace.repository.path) {
            worktreePath = `${workspace.repository.path}/${session.worktreeId}`;
          }
        }

        if (repositoryType && worktreePath) {
          fetchPromises.push(
            this.fetchCascadedConfig(repositoryType, worktreePath)
              .then(config => {
                this.worktreeConfigs.set(sessionId, config);
                console.log(`Cached config for ${sessionId} from ${worktreePath}`);
              })
              .catch(error => {
                console.warn(`Failed to fetch config for ${sessionId}:`, error);
              })
          );
        }
      } catch (error) {
        console.error(`Error processing session ${sessionId}:`, error);
      }
    }

    await Promise.all(fetchPromises);
    console.log(`Pre-fetched ${this.worktreeConfigs.size} worktree configs`);
  }

  /**
   * Fetch cascaded config from server for a specific worktree
   * @param {string} repositoryType
   * @param {string} worktreePath - Full path to worktree directory
   * @returns {Promise<object>}
   */
  async fetchCascadedConfig(repositoryType, worktreePath) {
    try {
      const url = worktreePath
        ? `/api/cascaded-config/${repositoryType}?worktreePath=${encodeURIComponent(worktreePath)}`
        : `/api/cascaded-config/${repositoryType}`;

      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch config');

      return await response.json();
    } catch (error) {
      console.error(`Failed to fetch cascaded config for ${repositoryType}:`, error);
      return null;
    }
  }

  /**
   * Get server controls HTML including start/stop and dynamic buttons
   */
  getServerControlsHTML(sessionId) {
    const isRunning = this.serverStatuses.get(sessionId) === 'running';

    // Start with server control (start/stop/launch)
    let html = '';

    if (isRunning) {
      html += `<button class="control-btn" onclick="window.orchestrator.toggleServer('${sessionId}')" title="Stop Server">⏹</button>`;
    } else {
      html += `<div class="server-launch-group">
        <select class="control-btn env-select" id="server-env-${sessionId}" name="server-env-${sessionId}"
                onchange="window.orchestrator.toggleServer('${sessionId}', this.value); this.value='custom';" title="Start Server">
          <option value="">▶</option>
          ${this.getDynamicLaunchOptions(sessionId)}
          <option value="custom" selected>Custom...</option>
        </select>
        <button class="control-btn" onclick="window.orchestrator.showServerLaunchSettings('${sessionId}')" title="Launch Settings">⚙️</button>
      </div>`;
    }

    // Add dynamic buttons from config
    const buttons = this.getButtonsForSession(sessionId, 'server');

    // Filter buttons based on showWhen and server state
    const filteredButtons = buttons.filter(buttonHTML => {
      // Simple heuristic: if button contains specific actions, check state
      if (isRunning && (buttonHTML.includes('playInHytopia') || buttonHTML.includes('copyLocalhostUrl'))) {
        return true; // Show these only when running
      }
      if (!isRunning && (buttonHTML.includes('playInHytopia') || buttonHTML.includes('copyLocalhostUrl'))) {
        return false; // Hide when not running
      }
      return true; // Show all other buttons always
    });

    html += '\n' + filteredButtons.join('\n');

    return html;
  }

  buildSidebar() {
    const worktreeList = document.getElementById('worktree-list');
    if (!worktreeList) return;

    const previousScrollTop = worktreeList.scrollTop;

    // Always ensure filter toggle exists and is updated FIRST
    this.ensureFilterToggleExists();
    
    // Clear and rebuild the worktree list
    worktreeList.innerHTML = '';
    
    // Group sessions by worktree and repository for mixed-repo support
    const worktrees = new Map();

    for (const [sessionId, session] of this.sessions) {
      // Only show sessions that belong to current workspace
      if (this.currentWorkspace && session.workspace && session.workspace !== this.currentWorkspace.id) {
        continue; // Skip sessions from other workspaces
      }

      const worktreeId = session.worktreeId || sessionId.split('-')[0];

      // Extract repository name from session ID for mixed-repo workspaces
      const repositoryName = this.extractRepositoryName(sessionId);
      const key = repositoryName ? `${repositoryName}-${worktreeId}` : worktreeId;

      if (!worktrees.has(key)) {
        worktrees.set(key, {
          id: key, // Use full key (repo-work1) not just work1 for uniqueness in mixed workspaces
          worktreeId: worktreeId, // Keep original worktree ID (work1) for session matching
          repositoryName: repositoryName,
          displayName: repositoryName ? `${repositoryName}/${worktreeId}` : worktreeId,
          claude: null,
          server: null
        });
      }

      const worktree = worktrees.get(key);
      if (session.type === 'claude') {
        worktree.claude = session;
      } else if (session.type === 'server') {
        worktree.server = session;
      }
    }
    
    // Create sidebar items
    for (const [worktreeId, worktree] of worktrees) {
      // Check if worktree is active (has any session marked as active)
      const isActive = this.isWorktreeActive(worktreeId);
      
      // Skip inactive worktrees if filter is enabled
      if (this.showActiveOnly && !isActive) {
        continue;
      }
      
      // Check if any session in this worktree is visible
      const isVisible = (worktree.claude && this.visibleTerminals.has(worktree.claude.sessionId)) ||
                       (worktree.server && this.visibleTerminals.has(worktree.server.sessionId));
      
      const item = document.createElement('div');
      // Only show visibility state, not activity state (activity filtering is handled separately)
      item.className = `worktree-item ${!isVisible ? 'hidden-terminal' : ''}`;
      item.dataset.worktreeId = worktree.id;
      item.title = 'Click to toggle • Ctrl+Click to show only this worktree';

      const branch = worktree.claude?.branch || worktree.server?.branch || 'unknown';
      const displayName = worktree.displayName;

      // Single-dot sidebar status: prefer the agent (Claude) status
      const sidebarStatus = worktree.claude?.status || worktree.server?.status || 'idle';

      const agentId = worktree.claude?.agent || null;
      const agentIcon = this.getAgentIcon(agentId);
      const agentTitle = agentId ? `Agent: ${agentId}` : 'Agent: unknown';

      const worktreePath = this.getWorktreePathForSidebarEntry(worktree);
      const isReadyForReview = !!(worktreePath && this.worktreeTags.get(worktreePath)?.readyForReview);
      const readyTitle = isReadyForReview ? 'Ready for review (click to clear)' : 'Mark ready for review';

      item.innerHTML = `
        <div class="worktree-header">
          <div class="worktree-title">
            <span class="visibility-indicator">${isVisible ? '👁' : '🚫'}</span>
            <span class="status-dot worktree-status-dot ${sidebarStatus}"></span>
            <span class="agent-type-icon" title="${this.escapeHtml(agentTitle)}">${agentIcon}</span>
            <span class="worktree-name">${displayName}</span>
            <span class="worktree-branch">${branch}</span>
          </div>
          <div class="worktree-actions">
            <button class="ready-review-btn ${isReadyForReview ? 'ready' : ''}"
                    data-worktree-path="${this.escapeHtml(worktreePath || '')}"
                    aria-pressed="${isReadyForReview ? 'true' : 'false'}"
                    title="${this.escapeHtml(readyTitle)}"
                    ${worktreePath ? '' : 'disabled'}>
              R
            </button>
            <button class="delete-worktree-btn"
                    onclick="event.stopPropagation(); window.orchestrator.deleteWorktree('${worktree.id}', '${displayName}')"
                    title="Remove worktree from workspace (keeps files intact)">
              ✕
            </button>
          </div>
        </div>
      `;
      
      // Click handler is already attached via event delegation in setupEventListeners
      
      worktreeList.appendChild(item);
    }

    worktreeList.scrollTop = previousScrollTop;
  }

  getWorktreePathForSidebarEntry(worktree) {
    const workspace = this.currentWorkspace;
    if (!workspace || !worktree) return null;

    if (workspace.workspaceType === 'mixed-repo') {
      const terminals = Array.isArray(workspace.terminals)
        ? workspace.terminals
        : workspace.terminals?.pairs;
      if (!terminals) return null;

      const sessionId = worktree.claude?.sessionId || worktree.server?.sessionId || '';
      const repositoryName = worktree.repositoryName || this.extractRepositoryName(sessionId);

      const terminal = terminals.find(t => t.repository?.name === repositoryName && t.worktree === worktree.worktreeId)
        || terminals.find(t => t.id === worktree.claude?.sessionId)
        || terminals.find(t => t.id === worktree.server?.sessionId);

      if (terminal && terminal.repository && terminal.worktree) {
        return terminal.worktreePath || `${terminal.repository.path}/${terminal.worktree}`;
      }
      return null;
    }

    if (workspace.repository?.path && worktree.worktreeId) {
      return `${workspace.repository.path}/${worktree.worktreeId}`;
    }

    return null;
  }

  async loadWorktreeTags() {
    try {
      const response = await fetch('/api/worktree-tags');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const tags = await response.json();
      this.worktreeTags = new Map(Object.entries(tags || {}));
      this.buildSidebar();
      return this.worktreeTags;
    } catch (error) {
      console.warn('Failed to load worktree tags:', error);
      return null;
    }
  }

  async setWorktreeReadyForReview(worktreePath, ready) {
    try {
      const response = await fetch('/api/worktree-tags/ready', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worktreePath, ready })
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(text || `HTTP ${response.status}`);
      }

      const result = await response.json();
      if (result && result.worktreePath) {
        this.worktreeTags.set(result.worktreePath, result.tag || {});
      }
      this.buildSidebar();
      return result;
    } catch (error) {
      console.error('Failed to update ready-for-review tag:', error);
      this.showTemporaryMessage('Failed to update ready-for-review tag', 'error');
      return null;
    }
  }

  async toggleWorktreeReadyForReview(worktreePath) {
    const current = this.worktreeTags.get(worktreePath)?.readyForReview;
    return this.setWorktreeReadyForReview(worktreePath, !current);
  }
  
  ensureFilterToggleExists() {
    let filterToggle = document.getElementById('filter-toggle');
    
    if (!filterToggle) {
      // Create the filter toggle element
      filterToggle = document.createElement('div');
      filterToggle.className = 'filter-toggle';
      filterToggle.id = 'filter-toggle';
      
      // Insert it right before the worktree list
      const worktreeList = document.getElementById('worktree-list');
      worktreeList.parentNode.insertBefore(filterToggle, worktreeList);
    }
    
    // Always update the button content
    filterToggle.innerHTML = `
      <button class="${this.showActiveOnly ? 'active' : ''}" onclick="window.orchestrator.toggleActivityFilter()">
        ${this.showActiveOnly ? 'Show All' : 'Active Only'}
      </button>
    `;
  }

  getServerStatusClass(sessionId) {
    const status = this.serverStatuses.get(sessionId);
    if (status === 'running') return 'running';
    if (status === 'error') return 'error';
    return 'idle';
  }
  
  isWorktreeActive(worktreeIdOrKey) {
    // Check if any session for this worktree has been marked as active.
    // For mixed-repo workspaces we may receive:
    // - keys like "RepoName-work3" in the sidebar, or
    // - plain worktree IDs like "work3" in some filters.
    //
    // Prefer direct sessionId checks first, then fall back to scanning sessions.
    const claudeId = `${worktreeIdOrKey}-claude`;
    const serverId = `${worktreeIdOrKey}-server`;

    if (this.sessionActivity.get(claudeId) === 'active') return true;
    if (this.sessionActivity.get(serverId) === 'active') return true;

    // Fallback: compute the same key used in the sidebar and match against it.
    for (const [sessionId, session] of this.sessions) {
      const sessionWorktreeId = session.worktreeId || sessionId.split('-')[0];
      const repositoryName = this.extractRepositoryName(sessionId);
      const sessionKey = repositoryName ? `${repositoryName}-${sessionWorktreeId}` : sessionWorktreeId;

      if (sessionKey === worktreeIdOrKey || sessionWorktreeId === worktreeIdOrKey) {
        if (this.sessionActivity.get(sessionId) === 'active') {
          return true;
        }
      }
    }

    return false;
  }
  
  toggleActivityFilter() {
    this.showActiveOnly = !this.showActiveOnly;
    this.buildSidebar();
    
    // Also update the main grid view to match the filter
    if (this.showActiveOnly) {
      this.showActiveWorktreesOnly();
    } else {
      this.showAllTerminals();
    }
  }
  
  showActiveWorktreesOnly() {
    // Clear visible terminals first
    this.visibleTerminals.clear();
    
    // Add only active worktree sessions to visible set
    for (const [sessionId, session] of this.sessions) {
      const sessionWorktreeId = session.worktreeId || sessionId.split('-')[0];
      const repositoryName = this.extractRepositoryName(sessionId);
      const worktreeKey = repositoryName ? `${repositoryName}-${sessionWorktreeId}` : sessionWorktreeId;

      if (this.isWorktreeActive(worktreeKey)) {
        this.visibleTerminals.add(sessionId);
      }
    }
    
    // If no active sessions, show all
    if (this.visibleTerminals.size === 0) {
      this.showAllTerminals();
    } else {
      this.updateTerminalGrid();
      this.buildSidebar();
    }
  }
  
  resizeAllVisibleTerminals() {
    // Force resize all visible terminals to fit their containers
    this.activeView.forEach(sessionId => {
      const wrapper = document.getElementById(`wrapper-${sessionId}`);
      if (wrapper && wrapper.style.display !== 'none') {
        this.terminalManager.fitTerminal(sessionId);
        const term = this.terminalManager.terminals.get(sessionId);
        if (term) {
          term.refresh(0, term.rows - 1);
        }
      }
    });
  }

  showOnlyWorktree(worktreeIdOrKey) {
    console.log(`Showing only worktree: ${worktreeIdOrKey}`);

    // Clear all visible terminals first
    this.visibleTerminals.clear();

    // Strategy 1: Direct match (for simple workspace types)
    const claudeId = `${worktreeIdOrKey}-claude`;
    const serverId = `${worktreeIdOrKey}-server`;

    let foundSessions = false;
    if (this.sessions.has(claudeId)) {
      this.visibleTerminals.add(claudeId);
      foundSessions = true;
    }
    if (this.sessions.has(serverId)) {
      this.visibleTerminals.add(serverId);
      foundSessions = true;
    }

    // Strategy 2: Search all sessions for matching worktreeId or complex keys
    if (!foundSessions) {
      for (const [sessionId, session] of this.sessions) {
        // Check if this session belongs to the current workspace
        if (this.currentWorkspace && session.workspace && session.workspace !== this.currentWorkspace.id) {
          continue; // Skip sessions from other workspaces
        }

        // For mixed-repo workspaces, build the same key used in buildSidebar
        const sessionWorktreeId = session.worktreeId || sessionId.split('-')[0];
        const repositoryName = this.extractRepositoryName(sessionId);
        const sessionKey = repositoryName ? `${repositoryName}-${sessionWorktreeId}` : sessionWorktreeId;

        // Match full key OR just the worktreeId part (e.g., "work1" matches "zoo-game-work1")
        if (sessionKey === worktreeIdOrKey || sessionWorktreeId === worktreeIdOrKey) {
          this.visibleTerminals.add(sessionId);
        }
      }
    }

    // Update the grid to show only these terminals
    this.updateTerminalGrid();
    this.buildSidebar();
  }

  toggleWorktreeVisibility(worktreeIdOrKey) {
    console.log(`Toggling visibility for worktree: ${worktreeIdOrKey}`);

    // Find all sessions that match this worktree key
    const sessions = [];

    // Strategy 1: Direct match (for simple workspace types like "work1")
    const claudeId = `${worktreeIdOrKey}-claude`;
    const serverId = `${worktreeIdOrKey}-server`;

    if (this.sessions.has(claudeId)) sessions.push(claudeId);
    if (this.sessions.has(serverId)) sessions.push(serverId);

    // Strategy 2: Search all sessions for matching worktreeId or complex keys
    if (sessions.length === 0) {
      // For mixed-repo workspaces, worktreeIdOrKey might be like "HyFire2-work2"
      // We need to find sessions that match this pattern
      for (const [sessionId, session] of this.sessions) {
        // Check if this session belongs to the current workspace
        if (this.currentWorkspace && session.workspace && session.workspace !== this.currentWorkspace.id) {
          continue; // Skip sessions from other workspaces
        }

        // For mixed-repo workspaces, build the same key used in buildSidebar
        const sessionWorktreeId = session.worktreeId || sessionId.split('-')[0];
        const repositoryName = this.extractRepositoryName(sessionId);
        const sessionKey = repositoryName ? `${repositoryName}-${sessionWorktreeId}` : sessionWorktreeId;

        if (sessionKey === worktreeIdOrKey) {
          sessions.push(sessionId);
        }
      }
    }

    if (sessions.length === 0) {
      console.warn(`No sessions found for worktree ${worktreeIdOrKey}`);
      return;
    }

    console.log(`Found sessions for ${worktreeIdOrKey}:`, sessions);

    // Check if ANY session from this worktree is currently visible
    const anyVisible = sessions.some(id => this.visibleTerminals.has(id));

    // Log current state for debugging
    const claudeSessionId = sessions.find(id => id.includes('claude'));
    const claudeSession = claudeSessionId ? this.sessions.get(claudeSessionId) : null;
    console.log(`Toggling ${worktreeIdOrKey}: currently ${anyVisible ? 'visible' : 'hidden'}, Claude status: ${claudeSession?.status || 'unknown'}, sessions: ${sessions.join(', ')}`);

    if (anyVisible) {
      // Hide terminals - allow hiding even if Claude is running (user wants to focus elsewhere)
      sessions.forEach(id => {
        this.visibleTerminals.delete(id);
      });
      console.log(`Hidden worktree ${worktreeIdOrKey}`);
    } else {
      // Show terminals - add back to visible set
      sessions.forEach(id => {
        this.visibleTerminals.add(id);
      });
      console.log(`Shown worktree ${worktreeIdOrKey}`);
    }

    // IMPORTANT: Must update the entire grid to recalculate layout
    // This will re-render with correct data-visible-count and apply proper CSS grid
    this.updateTerminalGrid();
    this.buildSidebar();
  }
  
  showWorktree(worktreeIdOrKey) {
    // Show terminals for this EXACT worktree key
    const claudeId = `${worktreeIdOrKey}-claude`;
    const serverId = `${worktreeIdOrKey}-server`;

    if (this.sessions.has(claudeId)) this.visibleTerminals.add(claudeId);
    if (this.sessions.has(serverId)) this.visibleTerminals.add(serverId);

    this.updateTerminalGrid();
    this.buildSidebar();
  }
  
  showAllTerminals() {
    // Add all sessions to visible set
    for (const sessionId of this.sessions.keys()) {
      this.visibleTerminals.add(sessionId);
    }
    
    this.updateTerminalGrid();
    this.buildSidebar();
  }
  
  /**
   * Get the terminal grid container for the current tab
   */
  getTerminalGrid() {
    // If tab manager is enabled, get the active tab's container
    if (this.tabManager && this.currentTabId) {
      const tab = this.tabManager.getActiveTab();
      if (tab && tab.containerElement) {
        return tab.containerElement;
      }
    }

    // Fallback to default terminal-grid
    const defaultGrid = document.getElementById('terminal-grid');
    if (!defaultGrid) {
      console.error('Terminal grid not found!');
    }
    return defaultGrid;
  }

  updateTerminalGrid() {
    // Get ALL sessions (works for both traditional and mixed-repo workspaces)
    const allSessions = Array.from(this.sessions.keys());
    this.renderTerminalsWithVisibility(allSessions);
  }
  
  renderTerminalsWithVisibility(sessionIds) {
    // Render all terminals but apply visibility using CSS (don't destroy DOM)
    this.activeView = sessionIds.filter(id => this.visibleTerminals.has(id));
    const grid = this.getTerminalGrid();

    if (!grid) {
      console.error('Terminal grid not found!');
      return;
    }

    // Set the data attribute for dynamic layout based on visible count
    const visibleCount = this.activeView.length;
    grid.setAttribute('data-visible-count', visibleCount);
    // If the user has more than 16 visible terminals, fall back to a scrollable grid
    // instead of clipping extra rows (which shows up as tiny “slivers” at the bottom).
    grid.classList.toggle('terminal-grid-scrollable', visibleCount > 16);

    // CRITICAL: Don't destroy terminals with innerHTML = ''
    // Instead, create missing terminals and hide/show existing ones

    sessionIds.forEach((sessionId) => {
      const session = this.sessions.get(sessionId);
      const isVisible = this.visibleTerminals.has(sessionId);
      const wrapperId = `wrapper-${sessionId}`;
      let wrapper = document.getElementById(wrapperId);

      console.log(`📍 ${sessionId}: session=${!!session}, visible=${isVisible}, exists=${!!wrapper}`);

      if (session && isVisible) {
        // Create wrapper if it doesn't exist
        if (!wrapper) {
          console.log(`✅ Creating terminal element for: ${sessionId}`);
          wrapper = this.createTerminalElement(sessionId, session);
          if (wrapper) {
            grid.appendChild(wrapper);
            console.log(`✅ Appended terminal to grid: ${sessionId}`);

            // Initialize terminal for newly created element
            setTimeout(() => {
              const terminalEl = document.getElementById(`terminal-${sessionId}`);
              if (terminalEl && !this.terminalManager.terminals.has(sessionId)) {
                this.terminalManager.createTerminal(sessionId, session);
              }
            }, 50);
          }
        } else {
          // Show existing wrapper
          wrapper.style.display = '';

          // Refit terminal if it exists
          if (this.terminalManager.terminals.has(sessionId)) {
            requestAnimationFrame(() => {
              this.terminalManager.fitTerminal(sessionId);
            });
          }
        }
      } else if (wrapper) {
        // Hide wrapper if not visible
        wrapper.style.display = 'none';
      }
    });

    // Force a resize after everything is rendered to ensure terminals fit properly
    setTimeout(() => {
      this.resizeAllVisibleTerminals();
    }, 200);
  }
  
  showClaudeOnly() {
    // Clear visible terminals and add only Claude sessions
    this.visibleTerminals.clear();
    for (const sessionId of this.sessions.keys()) {
      if (sessionId.includes('-claude')) {
        this.visibleTerminals.add(sessionId);
      }
    }
    this.updateTerminalGrid();
    this.buildSidebar();
  }
  
  showServersOnly() {
    // Clear visible terminals and add only server sessions
    this.visibleTerminals.clear();
    for (const sessionId of this.sessions.keys()) {
      if (sessionId.includes('-server')) {
        this.visibleTerminals.add(sessionId);
      }
    }
    this.updateTerminalGrid();
    this.buildSidebar();
  }
  
  applyPreset(preset) {
    this.visibleTerminals.clear();
    
    switch (preset) {
      case 'all':
        this.showAllTerminals();
        break;
      case 'claude-all':
        this.showClaudeOnly();
        break;
      case 'servers-all':
        this.showServersOnly();
        break;
      case 'work-1-5':
        ['work1-claude', 'work1-server', 'work5-claude', 'work5-server'].forEach(id => {
          if (this.sessions.has(id)) {
            this.visibleTerminals.add(id);
          }
        });
        this.updateTerminalGrid();
        this.buildSidebar();
        break;
      case 'custom-claude':
        ['work2-claude', 'work5-claude', 'work6-claude', 'work8-claude', 'work1-claude', 'work7-claude'].forEach(id => {
          if (this.sessions.has(id)) {
            this.visibleTerminals.add(id);
          }
        });
        this.updateTerminalGrid();
        this.buildSidebar();
        break;
    }
  }
  
  // changeLayout method removed - using dynamic layout based on visible terminal count
  
  showTerminals(sessionIds) {
    // Legacy function - update visible set and refresh everything
    this.visibleTerminals.clear();
    sessionIds.forEach(id => {
      if (this.sessions.has(id)) {
        this.visibleTerminals.add(id);
      }
    });
    this.updateTerminalGrid();
    this.buildSidebar();
  }
  
  renderTerminals(sessionIds) {
    // Core rendering function - just displays terminals without updating state
    this.activeView = sessionIds;
    const grid = this.getTerminalGrid();
    
    // Sort sessionIds to ensure proper ordering: work1-claude, work1-server, work2-claude, work2-server, etc.
    const sortedSessionIds = sessionIds.slice().sort((a, b) => {
      // Extract worktree number
      const getWorkNum = (id) => parseInt(id.match(/work(\d+)/)?.[1] || 0);
      const numA = getWorkNum(a);
      const numB = getWorkNum(b);
      
      // First sort by worktree number
      if (numA !== numB) return numA - numB;
      
      // Then claude before server
      if (a.includes('claude') && b.includes('server')) return -1;
      if (a.includes('server') && b.includes('claude')) return 1;
      return 0;
    });
    
    // Clear grid but don't destroy terminals
    grid.innerHTML = '';
    
    // Create terminal elements for active view
    sortedSessionIds.forEach((sessionId) => {
      const session = this.sessions.get(sessionId);
      if (session) {
        const wrapper = this.createTerminalElement(sessionId, session);
        grid.appendChild(wrapper);
      }
    });
    
    // Now handle terminal instances
    sortedSessionIds.forEach((sessionId, index) => {
      const session = this.sessions.get(sessionId);
      if (session) {
        setTimeout(() => {
          const terminalEl = document.getElementById(`terminal-${sessionId}`);
          if (!terminalEl) return;
          
          if (this.terminalManager.terminals.has(sessionId)) {
            // Re-attach existing terminal to the new element
            const term = this.terminalManager.terminals.get(sessionId);
            
            // Clear and re-open the terminal in the new element
            terminalEl.innerHTML = '';
            term.open(terminalEl);
            
            // Force a resize and refresh
            this.terminalManager.fitTerminal(sessionId);
            
            // Force a screen refresh to show content
            term.refresh(0, term.rows - 1);
          } else {
            // Create new terminal only if it doesn't exist
            this.terminalManager.createTerminal(sessionId, session);
          }
          
          // Don't auto-start Claude - let user choose via modal or button
        }, 50 + (index * 25)); // Reduced stagger time
      }
    });
  }
  
  createTerminalElement(sessionId, session) {
    const wrapper = document.createElement('div');
    wrapper.className = 'terminal-wrapper';
    wrapper.id = `wrapper-${sessionId}`;
    
    const isClaudeSession = session.type === 'claude';
    const isServerSession = session.type === 'server';

    // Build display name with repository info for mixed-repo workspaces
    const repositoryName = this.extractRepositoryName(sessionId);
    const worktreeId = session.worktreeId;
    const displayName = repositoryName ? `${repositoryName}/${worktreeId}` : worktreeId.replace('work', '');

    wrapper.innerHTML = `
      <div class="terminal-header">
        <div class="terminal-title">
          <span class="status-indicator ${session.status}" id="status-${sessionId}"></span>
          <span>${isClaudeSession ? '🤖 Agent' : '💻 Server'} ${displayName}</span>
          <span class="terminal-branch ${(session.branch === 'master' || session.branch === 'main' || session.branch?.startsWith('master-') || session.branch?.startsWith('main-')) ? 'master-branch' : ''}">${session.branch || ''}</span>
        </div>
        <div class="terminal-controls">
          ${isClaudeSession ? `
            ${this.getButtonsForSession(sessionId, 'claude').join('\n')}
            ${this.getGitHubButtons(sessionId)}
          ` : ''}
          ${isServerSession ? `
            ${this.getServerControlsHTML(sessionId)}
          ` : ''}
        </div>
      </div>
      <div class="terminal-body">
        <div class="terminal" id="terminal-${sessionId}"></div>
        ${isClaudeSession ? `
          <div class="terminal-startup-ui" id="startup-ui-${sessionId}" style="display: none;">
            <div class="startup-ui-compact">
              <!-- Agent Selection -->
              <div class="inline-agent-selector">
                <select id="inline-agent-${sessionId}" class="agent-dropdown" onchange="window.orchestrator.updateInlineAgent('${sessionId}', this.value)">
                  <option value="claude">🤖 Claude</option>
                  <option value="codex">⚡ Codex</option>
                </select>
              </div>

              <!-- Dynamic Mode Buttons -->
              <div class="inline-mode-buttons" id="inline-modes-${sessionId}">
                <button class="startup-btn-inline" onclick="window.orchestrator.quickStartAgent('${sessionId}', 'fresh')">
                  <span class="btn-icon">🆕</span>
                  <span>Fresh</span>
                </button>
                <button class="startup-btn-inline" onclick="window.orchestrator.quickStartAgent('${sessionId}', 'continue')">
                  <span class="btn-icon">➡️</span>
                  <span>Continue</span>
                </button>
                <button class="startup-btn-inline" onclick="window.orchestrator.quickStartAgent('${sessionId}', 'resume')">
                  <span class="btn-icon">⏸️</span>
                  <span>Resume</span>
                </button>
              </div>

              <!-- Advanced Settings Button -->
              <div class="inline-presets">
                <button class="advanced-btn" onclick="window.orchestrator.showClaudeStartupModal('${sessionId}')" title="Advanced Options">⚙️ Advanced</button>
              </div>
            </div>
          </div>
        ` : ''}
      </div>
    `;
    
    return wrapper;
  }
  
  updateSessionStatus(sessionId, status) {
    const statusElement = document.getElementById(`status-${sessionId}`);
    if (statusElement) {
      statusElement.className = `status-indicator ${status}`;
      statusElement.title = status;
    }

    // Update session data
    const session = this.sessions.get(sessionId);
    const previousStatus = session ? session.status : null;
    if (session) {
      session.status = status;

      // Track that user has interacted if going from waiting to busy
      if (previousStatus === 'waiting' && status === 'busy') {
        session.hasUserInput = true;
      }

      // Only mark as active when user actually interacts (waiting -> busy transition)
      // OR when status changes to busy (meaning user is actively working)
      if ((previousStatus === 'waiting' && status === 'busy') || status === 'busy') {
        this.sessionActivity.set(sessionId, 'active');
        this.buildSidebar(); // Refresh to update grey/active state
      }

      // Check if auto-start is enabled when status becomes waiting
      if (status === 'waiting' && sessionId.includes('-claude') && this.userSettings) {
        const effectiveSettings = this.getEffectiveSettings(sessionId);

        if (effectiveSettings && effectiveSettings.autoStart && effectiveSettings.autoStart.enabled) {
          // Hide the startup UI since auto-start will handle it
          const startupUI = document.getElementById(`startup-ui-${sessionId}`);
          if (startupUI) {
            startupUI.style.display = 'none';
          }
        } else {
          // Use centralized logic for startup UI display
          this.showStartupUIIfNeeded(sessionId, status, previousStatus);
        }
      }

      // Don't mark fresh "waiting" sessions as active - they're just showing welcome screen
    }
    
    // Update quick actions for Claude sessions
    if (sessionId.includes('claude')) {
      // Clear any pending notification timer if Claude goes busy again
      if (status === 'busy' && this.notificationTimers && this.notificationTimers[sessionId]) {
        clearTimeout(this.notificationTimers[sessionId]);
        delete this.notificationTimers[sessionId];
      }

      // Show notification when Claude becomes ready AFTER user input
      // But NOT during intermediate todo steps - wait for a longer idle period
      if (previousStatus === 'busy' && status === 'waiting' && session && session.hasUserInput) {
        // Set a timer to check if Claude stays in waiting state (not just intermediate)
        if (this.notificationTimers && this.notificationTimers[sessionId]) {
          clearTimeout(this.notificationTimers[sessionId]);
        }

        if (!this.notificationTimers) {
          this.notificationTimers = {};
        }

        // Only show notification if Claude stays in waiting state for 3+ seconds
        // This filters out intermediate todo steps which quickly go back to busy
        this.notificationTimers[sessionId] = setTimeout(() => {
          const currentSession = this.sessions.get(sessionId);
          if (currentSession && currentSession.status === 'waiting') {
            console.log(`Showing ready notification for ${sessionId} after stable waiting state`);
            this.showClaudeReadyNotification(sessionId);
          }
        }, 3000);
      }
    }
    
    // Update sidebar
    this.updateSidebarStatus(sessionId, status);
  }
  
  updateSidebarStatus(sessionId, status) {
    const session = this.sessions.get(sessionId);
    const worktreeId = session?.worktreeId || sessionId.split('-')[0];
    const repositoryName = session?.repositoryName || this.extractRepositoryName(sessionId);
    const key = repositoryName ? `${repositoryName}-${worktreeId}` : worktreeId;

    // Sidebar status is the agent (Claude) status. Ignore server updates to keep the sidebar compact.
    if (!sessionId.includes('-claude')) return;

    const worktreeItem = document.querySelector(`[data-worktree-id="${key}"]`);
    if (!worktreeItem) return;

    const dot = worktreeItem.querySelector('.worktree-status-dot');
    if (dot) {
      dot.className = `status-dot worktree-status-dot ${status}`;
    }
  }
  
  updateSessionBranch(sessionId, branch, remoteUrl, defaultBranch, existingPR) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.branch = branch;
      if (remoteUrl) {
        session.remoteUrl = remoteUrl;
      }
      if (defaultBranch) {
        session.defaultBranch = defaultBranch;
      }
      
      console.log(`Branch updated for ${sessionId}: ${branch}`, existingPR ? `(existing PR: ${existingPR})` : '');
      
      // If there's an existing PR, add it to GitHub links automatically
      if (existingPR) {
        const links = this.githubLinks.get(sessionId) || {};
        links.pr = existingPR;
        this.githubLinks.set(sessionId, links);
        console.log('Automatically detected existing PR:', existingPR);
      }
    }
    
    // Update terminal branch display
    const terminalElement = document.querySelector(`#wrapper-${sessionId} .terminal-branch`);
    if (terminalElement) {
      terminalElement.textContent = branch || '';
      
      // Add red styling for master/main branches
      if (branch === 'master' || branch === 'main' || 
          branch?.startsWith('master-') || branch?.startsWith('main-')) {
        terminalElement.classList.add('master-branch');
      } else {
        terminalElement.classList.remove('master-branch');
      }
    }
    
    // Update sidebar
    this.buildSidebar();
    
    // Update GitHub buttons with new remote URL
    this.updateTerminalControls(sessionId);
  }
  
  // Server control methods
  toggleServer(sessionId, environment = 'development') {
    const status = this.serverStatuses.get(sessionId);

    if (status === 'running') {
      // Stop server
      this.socket.emit('server-control', { sessionId, action: 'stop' });
      this.serverStatuses.set(sessionId, 'idle');
      this.serverPorts.delete(sessionId);
      this.updateSidebarStatus(sessionId, 'idle');
      this.updateServerControls(sessionId); // Restore launch controls
    } else {
      // Get launch settings for this session
      const launchSettings = environment === 'custom' ?
        this.getEffectiveLaunchSettings(sessionId) :
        {}; // Use defaults for dev/prod

      // Start server with environment and settings
      this.socket.emit('server-control', {
        sessionId,
        action: 'start',
        environment: environment === 'custom' ? 'development' : environment,
        launchSettings
      });
    }
  }
  
  killServer(sessionId) {
    // Send force kill
    this.socket.emit('server-control', { sessionId, action: 'kill' });
    this.serverStatuses.set(sessionId, 'idle');
    
    // Update UI
    const button = document.getElementById(`server-toggle-${sessionId}`);
    if (button) {
      button.textContent = '▶';
    }
    
    this.updateSidebarStatus(sessionId, 'idle');
    this.updateServerControls(sessionId);
  }
  
  playInHytopia(sessionId) {
    console.log(`[PLAY IN HYTOPIA] Session: ${sessionId}`);
    console.log('Available ports:', Array.from(this.serverPorts.entries()));
    const port = this.serverPorts.get(sessionId);
    if (!port) {
      console.error('No port found for server', sessionId);
      // Try to calculate port based on worktree number
      const worktreeMatch = sessionId.match(/work(\d+)/);
      if (worktreeMatch) {
        const worktreeNum = parseInt(worktreeMatch[1]);
        const calculatedPort = 8080 + worktreeNum - 1;
        console.log(`Calculated port ${calculatedPort} for ${sessionId}`);
        this.serverPorts.set(sessionId, calculatedPort);
        this.playInHytopia(sessionId); // Retry with calculated port
      }
      return;
    }
    
    const serverUrl = `localhost:${port}`;
    const hytopiaUrl = `https://hytopia.com/play/?${serverUrl}`;
    
    console.log(`Opening Hytopia for ${sessionId} at ${hytopiaUrl}`);
    window.open(hytopiaUrl, '_blank');
  }
  
  restoreBuildButton(sessionId) {
    // Find any button that might be building for this worktree
    const worktreeMatch = sessionId.match(/work(\d+)/);
    if (!worktreeMatch) return;
    
    const worktreeNum = worktreeMatch[1];
    
    // Check both claude and server buttons for this worktree
    [`work${worktreeNum}-claude`, `work${worktreeNum}-server`].forEach(id => {
      const btn = this.buildingButtons?.get(id);
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '📦';
        btn.classList.remove('building');
        this.buildingButtons.delete(id);
      }
    });
  }
  
  buildProduction(sessionId) {
    // Extract worktree number from sessionId (e.g., 'work1-claude' -> 1)
    const worktreeMatch = sessionId.match(/work(\d+)/);
    if (!worktreeMatch) {
      console.error('Could not extract worktree number from sessionId:', sessionId);
      this.showError('Failed to identify worktree for build');
      return;
    }
    
    const worktreeNum = worktreeMatch[1];
    console.log(`Building production ZIP for worktree ${worktreeNum}`);
    
    // Disable the build button and show loading state
    const buildBtn = document.querySelector(`#wrapper-${sessionId} button[onclick*="buildProduction"]`);
    if (buildBtn) {
      buildBtn.disabled = true;
      buildBtn.innerHTML = '<span class="loading-spinner"></span>';
      buildBtn.classList.add('building');
    }
    
    // Store the button reference for later
    this.buildingButtons = this.buildingButtons || new Map();
    this.buildingButtons.set(sessionId, buildBtn);
    
    // Emit socket event to trigger build on backend
    this.socket.emit('build-production', { 
      sessionId,
      worktreeNum 
    });
  }
  
  detectGitHubLinks(sessionId, data) {
    // Look for GitHub URLs with improved pattern matching
    const githubUrlPattern = /https:\/\/github\.com\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+(?:\/(?!https:\/\/github\.com\/)[^\s\)\]\}\>\"\'\`]*)?/g;
    const matches = data.match(githubUrlPattern);
    
    if (matches) {
      const links = this.githubLinks.get(sessionId) || {};
      
      matches.forEach(originalUrl => {
        // Clean up ANSI escape codes and other terminal artifacts
        let url = originalUrl
          .replace(/\x1b\[[0-9;]*m/g, '') // Remove ANSI codes
          .replace(/%1B\[[0-9;]*m/g, '') // Remove URL-encoded ANSI codes
          .replace(/\u001b\[[0-9;]*m/g, '') // Remove Unicode ANSI codes
          .replace(/[\x00-\x1F\x7F-\x9F]/g, '') // Remove other control characters
          .trim();
        
        // Remove common trailing punctuation that might be captured
        url = url.replace(/[,;.!?)\]}>'"`]*$/, '');

        // Guard against concatenated URLs in a single chunk
        const secondUrlIndex = url.indexOf('https://github.com/', 8);
        if (secondUrlIndex > 0) {
          url = url.slice(0, secondUrlIndex);
        }
        
        // Validate URL format
        try {
          new URL(url);
        } catch (e) {
          console.warn('Invalid GitHub URL detected:', url);
          return;
        }
        
        // Categorize the URL
        if (url.includes('/pull/') && url.match(/\/pull\/\d+\/?$/)) {
          if (links.pr !== url) {
            links.pr = url;
            console.log('PR link detected:', url);
          }
        } else if (url.includes('/commit/') && url.match(/\/commit\/[a-f0-9]+\/?$/)) {
          if (links.commit !== url) {
            links.commit = url;
            console.log('Commit link detected:', url);
          }
        } else if (url.includes('/tree/') || url.includes('/commits/')) {
          if (links.branch !== url) {
            links.branch = url;
            console.log('Branch link detected:', url);
          }
        }
      });
      
      this.githubLinks.set(sessionId, links);
      this.updateTerminalControls(sessionId);
    }
  }
  
  clearGitHubLinks(sessionId) {
    this.githubLinks.delete(sessionId);
    this.githubLinkLogs.delete(sessionId);
    this.updateTerminalControls(sessionId);
  }
  
  copyLocalhostUrl(sessionId) {
    const port = this.serverPorts.get(sessionId);
    if (!port) {
      console.error('No port found for server', sessionId);
      return;
    }
    
    const url = `https://localhost:${port}`;
    navigator.clipboard.writeText(url).then(() => {
      console.log(`Copied ${url} to clipboard`);
      this.showNotification('Copied!', `${url} copied to clipboard`);
    });
  }
  
  openHytopiaWebsite() {
    window.open('https://hytopia.com', '_blank');
  }
  
  openPRLink(url) {
    try {
      // Validate the URL
      new URL(url);
      console.log('Opening PR URL:', url);
      window.open(url, '_blank');
    } catch (error) {
      console.error('Invalid PR URL:', url, error);
      this.showToast('Invalid PR URL', 'error');
    }
  }
  
  getGitHubButtons(sessionId) {
    const links = this.githubLinks.get(sessionId) || {};
    let buttons = '';
    
    // Always show branch button (uses current session's git info)
    const session = this.sessions.get(sessionId);
    if (session && session.branch && session.branch !== 'master' && session.branch !== 'main') {
      const worktreeId = sessionId.split('-')[0];
      
      // Use dynamic remote URL if available
      if (session.remoteUrl) {
        const branchUrl = `${session.remoteUrl}/tree/${session.branch}`;
        // Use the actual default branch from git, fallback to 'main' if not available
        const defaultBranch = session.defaultBranch || 'main';
        const compareUrl = `${session.remoteUrl}/compare/${defaultBranch}...${session.branch}`;
        
        buttons += `<button class="control-btn" onclick="window.open('${branchUrl}', '_blank')" title="View Branch on GitHub">🌿</button>`;
        buttons += `<button class="control-btn" onclick="window.open('${compareUrl}', '_blank')" title="View Branch Diff">📊</button>`;
      }
    }
    
    // Show PR button if PR link detected
    if (links.pr) {
      const lastLogged = this.githubLinkLogs.get(sessionId);
      if (!lastLogged || lastLogged.pr !== links.pr) {
        console.log('Adding PR button for session:', sessionId, 'URL:', links.pr);
        this.githubLinkLogs.set(sessionId, { pr: links.pr });
      }
      buttons += `<button class="control-btn" onclick="window.orchestrator.openPRLink('${links.pr}')" title="View PR on GitHub (${links.pr})">📥</button>`;
      // Add advanced diff viewer button for PRs
      buttons += `<button class="control-btn diff-viewer-btn" onclick="window.orchestrator.launchDiffViewer('${links.pr}')" title="Advanced Diff View">🔍</button>`;
    }
    
    // Check for commit URLs
    if (links.commit) {
      buttons += `<button class="control-btn diff-viewer-btn" onclick="window.orchestrator.launchDiffViewer('${links.commit}')" title="Advanced Diff View">🔍</button>`;
    }
    
    return buttons;
  }
  
  updateTerminalControls(sessionId) {
    // Trigger a refresh of the terminal element to update buttons
    const terminalWrapper = document.querySelector(`[id*="${sessionId}"]`);
    if (terminalWrapper) {
      // Find the controls div and update it
      const controlsDiv = terminalWrapper.querySelector('.terminal-controls');
      if (controlsDiv && sessionId.includes('-claude')) {
        const focusBtn = `<button class="control-btn focus-btn" onclick="window.orchestrator.focusTerminal('${sessionId}')" title="Show Only This Worktree">🔍</button>`;
        const restartBtn = `<button class="control-btn" onclick="window.orchestrator.restartClaudeSession('${sessionId}')" title="Restart Claude">↻</button>`;
        const refreshBtn = `<button class="control-btn" onclick="window.orchestrator.refreshTerminal('${sessionId}')" title="Refresh Terminal Display">🔄</button>`;
        const reviewBtn = `<button class="control-btn review-btn" onclick="window.orchestrator.showCodeReviewDropdown('${sessionId}')" title="Assign Code Review">👥</button>`;
        controlsDiv.innerHTML = focusBtn + restartBtn + refreshBtn + reviewBtn + this.getGitHubButtons(sessionId);
      }
    }
  }
  
  updateServerStatus(sessionId, output) {
    // Check if server started - look for various startup messages
    if (output.includes('Server started') || 
        output.includes('Listening on') || 
        output.includes('Server running') ||
        output.includes('Started server') ||
        output.includes('🚀')) {
      this.serverStatuses.set(sessionId, 'running');
      this.updateSidebarStatus(sessionId, 'running');
      
      const button = document.getElementById(`server-toggle-${sessionId}`);
      if (button) {
        button.textContent = '⏹';
      }
      
      this.updateServerControls(sessionId);
    }
    
    // Check if server stopped
    if (output.includes('Server stopped') || output.includes('exit')) {
      this.serverStatuses.set(sessionId, 'idle');
      this.updateSidebarStatus(sessionId, 'idle');
      
      const button = document.getElementById(`server-toggle-${sessionId}`);
      if (button) {
        button.textContent = '▶';
      }
      
      this.updateServerControls(sessionId);
    }
  }
  
  /**
   * Get dynamic launch options based on current workspace
   */
  getDynamicLaunchOptions(sessionId) {
    // Derive repository type on-demand from workspace config
    // This handles: config changes, worktree additions/removals, existing sessions
    let repositoryType = null;

    if (this.currentWorkspace) {
      if (this.currentWorkspace.workspaceType === 'mixed-repo') {
        // Mixed-repo: Extract repository name from sessionId and lookup in workspace config
        const repositoryName = this.extractRepositoryName(sessionId);
        if (repositoryName && this.currentWorkspace.terminals?.pairs) {
          // Find matching terminal in workspace config
          const terminal = this.currentWorkspace.terminals.pairs.find(t =>
            t.id === sessionId || t.repository?.name === repositoryName
          );
          repositoryType = terminal?.repository?.type || null;
        }
      } else {
        // Single-repo: Use workspace type
        repositoryType = this.currentWorkspace.type;
      }
    }

    if (!repositoryType) {
      return '<option value="development">Dev</option><option value="production">Prod</option>';
    }

    // Use cascaded config (includes Global → Category → Framework → Project)
    const cascadedConfig = this.cascadedConfigs[repositoryType];

    if (!cascadedConfig) {
      return '<option value="development">Dev</option><option value="production">Prod</option>';
    }

    // Check for game modes in cascaded config (from any level: global, category, framework, or project)
    if (cascadedConfig.gameModes) {
      const modes = Object.entries(cascadedConfig.gameModes)
        .sort((a, b) => (a[1].priority || 999) - (b[1].priority || 999))
        .map(([key, mode]) => `<option value="${key}" title="${mode.description || ''}">${mode.name || key}</option>`)
        .join('');
      return modes;
    }

    // Check for common flags in cascaded config (from framework or category level)
    if (cascadedConfig.commonFlags) {
      const modes = Object.entries(cascadedConfig.commonFlags)
        .filter(([key, flag]) => flag.type === 'select')
        .map(([key, flag]) =>
          flag.options.map(option =>
            `<option value="${key}_${option}" title="${flag.description || ''}">${flag.name || key}: ${option}</option>`
          ).join('')
        ).join('');
      return modes || '<option value="development">Dev</option><option value="production">Prod</option>';
    }

    return '<option value="development">Dev</option><option value="production">Prod</option>';
  }

  updateServerControls(sessionId) {
    const wrapper = document.getElementById(`wrapper-${sessionId}`);
    if (!wrapper) return;

    const controlsDiv = wrapper.querySelector('.terminal-controls');
    if (!controlsDiv) return;

    // Use dynamic button system
    controlsDiv.innerHTML = this.getServerControlsHTML(sessionId);
  }
  
  handleServerError(sessionId, output) {
    const worktreeId = sessionId.split('-')[0];
    
    // Update status
    this.serverStatuses.set(sessionId, 'error');
    this.updateSidebarStatus(sessionId, 'error');
    
    // Show notification
    this.notificationManager.handleNotification({
      sessionId,
      type: 'error',
      message: `Server error in ${worktreeId}`,
      details: output.substring(output.indexOf('[Error]'), output.indexOf('[Error]') + 100)
    });
  }
  
  sendTerminalInput(sessionId, data) {
    if (!this.socket || !this.socket.connected) {
      console.error('Not connected to server');
      return;
    }
    
    // Mark session as active when user first provides input
    // But only for meaningful input (not just arrow keys, etc.)
    if (data.length > 0 && !data.match(/^[\x1b\x7f\r\n]/) && data.trim().length > 0) {
      const currentActivity = this.sessionActivity.get(sessionId);
      if (currentActivity !== 'active') {
        this.sessionActivity.set(sessionId, 'active');
        this.buildSidebar();
      }
    }
    
    this.socket.emit('terminal-input', { sessionId, data });
  }
  
  resizeTerminal(sessionId, cols, rows) {
    if (this.socket && this.socket.connected) {
      this.socket.emit('terminal-resize', { sessionId, cols, rows });
    }
  }

  /**
   * Handle Commander Claude UI control actions
   * These are semantic commands that Commander uses to control the UI
   */
  handleCommanderAction(action, params) {
    switch (action) {
      case 'focus-session':
        this.focusTerminal(params.sessionId);
        break;

      case 'switch-workspace':
        if (this.tabManager) {
          this.tabManager.switchToWorkspace(params.workspaceName);
        }
        break;

      case 'open-commander':
        if (this.commanderPanel) {
          this.commanderPanel.show();
        }
        break;

      case 'open-greenfield':
        if (this.greenfieldWizard) {
          this.greenfieldWizard.show();
        }
        break;

      case 'open-settings':
        document.getElementById('settings-panel')?.classList.remove('hidden');
        break;

      case 'highlight-worktree': {
        const item = document.querySelector(`[data-worktree-id="${params.worktreeId}"]`);
        if (item) {
          item.scrollIntoView({ behavior: 'smooth', block: 'center' });
          item.classList.add('highlighted');
          setTimeout(() => item.classList.remove('highlighted'), 2000);
        }
        break;
      }

      case 'start-claude':
        this.startClaudeInSession(params.sessionId, params.yolo !== false);
        break;

      case 'stop-session':
        this.stopSession(params.sessionId);
        break;

      case 'focus-worktree':
        this.showOnlyWorktree(params.worktreeId);
        break;

      case 'show-all-worktrees':
        this.showAllTerminals();
        break;

      default:
        console.warn('Unknown commander action:', action);
    }
  }

  handleSessionExit(sessionId, exitCode) {
    console.log(`Session ${sessionId} exited with code ${exitCode}`);
    this.updateSessionStatus(sessionId, 'exited');

    // If it's a Claude session, enable the start button and show startup UI
    if (sessionId.includes('-claude')) {
      const startBtn = document.getElementById(`claude-start-btn-${sessionId}`);
      if (startBtn) {
        startBtn.disabled = false;
      }

      // Reset dismissed state and show startup UI if appropriate
      this.dismissedStartupUI.delete(sessionId);
      this.showStartupUIIfNeeded(sessionId, 'waiting', 'busy');
    }

    // If it's a server session, update status and restore controls
    if (sessionId.includes('-server')) {
      this.serverStatuses.set(sessionId, 'idle');
      this.serverPorts.delete(sessionId);
      this.updateSidebarStatus(sessionId, 'idle');
      this.updateServerControls(sessionId);

      // Show notification if it crashed unexpectedly
      if (exitCode !== 0) {
        const worktreeId = sessionId.split('-')[0];
        this.showNotification(`Server ${worktreeId} stopped unexpectedly (exit code: ${exitCode})`, 'warning');
      }
    }
  }
  
  handleSessionRestart(sessionId) {
    console.log(`Session ${sessionId} restarted`);
    // Terminal will automatically reconnect and show new content

    // If it's a Claude session that restarted, only show the startup UI if Claude is not running
    if (sessionId.includes('-claude')) {
      const session = this.sessions.get(sessionId);
      const isClaudeRunning = session && session.status !== 'idle';

      // Only show startup UI if Claude is NOT running
      if (!isClaudeRunning) {
        // Use centralized logic
        this.showStartupUIIfNeeded(sessionId, 'waiting', 'idle');

        // Enable the start button in menu strip
        const startBtn = document.getElementById(`claude-start-btn-${sessionId}`);
        if (startBtn) {
          startBtn.disabled = false;
        }
      } else {
        console.log(`Claude is running in ${sessionId}, not showing startup UI`);
      }
    }
  }
  
  restartClaudeSession(sessionId) {
    console.log(`Restarting Claude session: ${sessionId}`);
    
    if (this.socket && this.socket.connected) {
      this.socket.emit('restart-session', { sessionId });
      
      // Update UI to show restarting
      this.updateSessionStatus(sessionId, 'restarting');
    } else {
      this.showError('Not connected to server');
    }
  }
  
  refreshTerminal(sessionId) {
    console.log('Refreshing terminal:', sessionId);
    const term = this.terminalManager.terminals.get(sessionId);
    if (term) {
      // Force fit and refresh
      this.terminalManager.fitTerminal(sessionId);
      term.refresh(0, term.rows - 1);
      
      // Also try scrolling to bottom to trigger redraw
      term.scrollToBottom();
      
      // If still blank, re-attach to DOM
      const terminalEl = document.getElementById(`terminal-${sessionId}`);
      if (terminalEl && terminalEl.children.length === 0) {
        term.open(terminalEl);
      }
    }
  }
  
  updateConnectionStatus(connected) {
    const statusElement = document.getElementById('connection-status');
    if (statusElement) {
      const dot = statusElement.querySelector('.status-dot');
      const text = statusElement.querySelector('span:last-child');
      
      if (connected) {
        dot.classList.remove('disconnected');
        dot.classList.add('connected');
        text.textContent = 'Connected';
      } else {
        dot.classList.remove('connected');
        dot.classList.add('disconnected');
        text.textContent = 'Disconnected';
      }
    }
  }
  
  showError(message) {
    // For now, use alert. Could be improved with a toast notification
    alert(`Error: ${message}`);
  }
  
  showClaudeUpdateRequired(updateInfo) {
    // Create update banner
    const banner = document.createElement('div');
    banner.className = 'update-banner';
    banner.innerHTML = `
      <div class="update-content">
        <h3>⚠️ ${updateInfo.title}</h3>
        <p>${updateInfo.message}</p>
        <div class="update-instructions">
          ${updateInfo.instructions.map(line => `<div>${line}</div>`).join('')}
        </div>
        <button onclick="this.parentElement.parentElement.remove()" class="dismiss-btn">Dismiss</button>
      </div>
    `;
    
    // Add to top of page
    document.body.insertBefore(banner, document.body.firstChild);
    
    // Also show in console
    console.warn('Claude Update Required:', updateInfo);
  }

  showClaudeReadyNotification(sessionId) {
    // Rate limiting: don't show notification if we showed one recently
    const now = Date.now();
    if (!this.lastNotificationTime) this.lastNotificationTime = {};

    // Increased rate limit to 30 seconds to avoid spam during todo lists
    if (this.lastNotificationTime[sessionId] && (now - this.lastNotificationTime[sessionId]) < 30000) {
      console.log(`Rate limiting notification for ${sessionId} (shown ${Math.round((now - this.lastNotificationTime[sessionId]) / 1000)}s ago)`);
      return;
    }
    this.lastNotificationTime[sessionId] = now;
    
    const worktreeId = sessionId.replace('-claude', '');
    const session = this.sessions.get(sessionId);
    const branch = session ? session.branch : '';
    
    // Create small toast notification
    const toast = document.createElement('div');
    toast.className = 'ready-toast';
    toast.innerHTML = `
      <div class="toast-content">
        <span class="toast-icon">✅</span>
        <span class="toast-text">Claude ${worktreeId} ready ${branch ? `(${branch})` : ''}</span>
      </div>
    `;
    
    // Add to page
    document.body.appendChild(toast);
    
    // Remove after 3 seconds
    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 3000);
    
    // Play notification sound if enabled
    if (this.settings.sounds) {
      this.playNotificationSound();
    }
    
    // Browser notification if enabled
    if (this.settings.notifications && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(`Claude ${worktreeId} Ready`, {
        body: `Claude finished responding and is ready for input ${branch ? `(${branch})` : ''}`,
        icon: '/favicon.ico',
        tag: `claude-ready-${sessionId}` // Prevent duplicates
      });
    }
  }

  showNotification(title, message) {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, {
        body: message,
        icon: '/favicon.ico'
      });
    }
  }
  
  playNotificationSound() {
    // Create a simple notification sound
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
    oscillator.frequency.setValueAtTime(600, audioContext.currentTime + 0.1);
    
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.3);
  }
  
  loadSettings() {
    const stored = localStorage.getItem('claude-orchestrator-settings');
    const defaults = {
      notifications: true,
      sounds: true,
      autoScroll: true,
      theme: 'dark'
    };

    if (stored) {
      return { ...defaults, ...JSON.parse(stored) };
    }

    return defaults;
  }

  loadServerLaunchSettings() {
    const stored = localStorage.getItem('server-launch-settings');
    const defaults = this.getDynamicLaunchDefaults();

    if (stored) {
      return { ...defaults, ...JSON.parse(stored) };
    }

    return defaults;
  }

  /**
   * Get dynamic launch defaults based on current workspace
   */
  getDynamicLaunchDefaults() {
    // Default fallback
    let defaults = {
      global: {
        envVars: 'NODE_ENV=development',
        nodeOptions: '--max-old-space-size=4096',
        gameArgs: ''
      },
      perWorktree: {}
    };

    if (!this.currentWorkspace) {
      return defaults;
    }

    const workspaceType = this.currentWorkspace.type;
    const typeInfo = this.workspaceTypes[workspaceType];

    if (!typeInfo) {
      return defaults;
    }

    // If this inherits from a framework, get framework defaults
    if (typeInfo.inherits && this.frameworks[typeInfo.inherits]) {
      const framework = this.frameworks[typeInfo.inherits];

      // Build environment variables from framework common flags
      const envVars = [];
      const nodeOptions = ['--max-old-space-size=4096'];
      let gameArgs = '';

      if (framework.commonFlags) {
        Object.entries(framework.commonFlags).forEach(([key, flag]) => {
          if (flag.type === 'boolean' && flag.default) {
            envVars.push(`${key}=${flag.default}`);
          } else if (flag.type === 'select' && flag.default) {
            if (key === 'NODE_ENV') {
              envVars.push(`NODE_ENV=${flag.default}`);
            } else {
              envVars.push(`${key}=${flag.default}`);
            }
          }
        });
      }

      // Add game-specific defaults if available
      if (typeInfo.gameModes) {
        // Find the first/default game mode
        const defaultMode = Object.entries(typeInfo.gameModes)
          .sort((a, b) => (a[1].priority || 999) - (b[1].priority || 999))[0];

        if (defaultMode && defaultMode[1].env) {
          // Parse env string into individual variables
          const modeEnvVars = defaultMode[1].env.split(' ')
            .filter(v => v.includes('='))
            .filter(v => !envVars.some(existing => existing.startsWith(v.split('=')[0])));
          envVars.push(...modeEnvVars);
        }
      }

      defaults.global.envVars = envVars.join(' ') || 'NODE_ENV=development';
      defaults.global.nodeOptions = nodeOptions.join(' ');
      defaults.global.gameArgs = gameArgs;
    }

    return defaults;
  }

  saveServerLaunchSettings() {
    localStorage.setItem('server-launch-settings', JSON.stringify(this.serverLaunchSettings));
  }

  getEffectiveLaunchSettings(sessionId) {
    const worktreeId = sessionId.split('-')[0];
    const worktreeSettings = this.serverLaunchSettings.perWorktree[worktreeId] || {};

    return {
      envVars: worktreeSettings.envVars || this.serverLaunchSettings.global.envVars || '',
      nodeOptions: worktreeSettings.nodeOptions || this.serverLaunchSettings.global.nodeOptions || '',
      gameArgs: worktreeSettings.gameArgs || this.serverLaunchSettings.global.gameArgs || ''
    };
  }

  showServerLaunchSettings(sessionId) {
    const worktreeId = sessionId.split('-')[0];
    const settings = this.parseCurrentSettings(worktreeId);

    // Create full-screen interactive modal without tabs
    const modalHtml = `
      <div id="launch-settings-modal" class="modal launch-settings-fullscreen">
        <div class="modal-content fullscreen">
          <div class="modal-header">
            <h2>🎮 Game Server Configuration - ${worktreeId}</h2>
            <button class="close-btn" onclick="window.orchestrator.closeLaunchSettingsModal()">✕</button>
          </div>

          <div class="modal-body">
            <div class="settings-container">
              <!-- Left Column: Quick Presets & Game Settings -->
              <div class="settings-column">
                <section class="settings-section">
                  <h3>⚡ Quick Presets</h3>
                  <div class="preset-grid">
                    <button class="preset-btn-large" onclick="window.orchestrator.applyPreset('quick-test')">
                      <span class="preset-icon">⚡</span>
                      <span class="preset-name">Quick Test</span>
                      <span class="preset-desc">2 rounds, 30s</span>
                    </button>
                    <button class="preset-btn-large" onclick="window.orchestrator.applyPreset('fast-game')">
                      <span class="preset-icon">🏃</span>
                      <span class="preset-name">Fast Game</span>
                      <span class="preset-desc">5 rounds, 60s</span>
                    </button>
                    <button class="preset-btn-large" onclick="window.orchestrator.applyPreset('normal')">
                      <span class="preset-icon">🎮</span>
                      <span class="preset-name">Normal</span>
                      <span class="preset-desc">13 rounds</span>
                    </button>
                    <button class="preset-btn-large" onclick="window.orchestrator.applyPreset('competitive')">
                      <span class="preset-icon">🏆</span>
                      <span class="preset-name">Competitive</span>
                      <span class="preset-desc">30 rounds</span>
                    </button>
                    <button class="preset-btn-large" onclick="window.orchestrator.applyPreset('debug')">
                      <span class="preset-icon">🐛</span>
                      <span class="preset-name">Debug</span>
                      <span class="preset-desc">Dev + logs</span>
                    </button>
                    <button class="preset-btn-large" onclick="window.orchestrator.applyPreset('bots-only')">
                      <span class="preset-icon">🤖</span>
                      <span class="preset-name">Bots</span>
                      <span class="preset-desc">Auto-fill</span>
                    </button>
                  </div>
                </section>

                <section class="settings-section">
                  <h3>🎮 Game Rules</h3>
                  <div class="settings-grid">
                    <div class="setting-item">
                      <label>Game Mode</label>
                      <div class="radio-group">
                        <label class="radio-option">
                          <input type="radio" name="game-mode" value="casual" ${settings.mode === 'casual' ? 'checked' : ''}
                                 onchange="window.orchestrator.updateConfigSummary()">
                          <span>Casual</span>
                        </label>
                        <label class="radio-option">
                          <input type="radio" name="game-mode" value="competitive" ${settings.mode === 'competitive' ? 'checked' : ''}
                                 onchange="window.orchestrator.updateConfigSummary()">
                          <span>Competitive</span>
                        </label>
                      </div>
                    </div>

                    <div class="setting-item">
                      <label>Max Rounds</label>
                      <div class="slider-container">
                        <input type="range" id="max-rounds" min="1" max="30" value="${settings.maxRounds}"
                               oninput="document.getElementById('max-rounds-value').textContent = this.value; window.orchestrator.updateConfigSummary()">
                        <span id="max-rounds-value" class="slider-value">${settings.maxRounds}</span>
                      </div>
                    </div>

                    <div class="setting-item">
                      <label>Team Size</label>
                      <div class="slider-container">
                        <input type="range" id="team-size" min="1" max="16" value="${settings.teamSize}"
                               oninput="document.getElementById('team-size-value').textContent = this.value; window.orchestrator.updateConfigSummary()">
                        <span id="team-size-value" class="slider-value">${settings.teamSize}</span>
                      </div>
                    </div>

                    <div class="setting-item">
                      <label>Min Players</label>
                      <div class="slider-container">
                        <input type="range" id="min-players" min="1" max="10" value="${settings.minPlayers}"
                               oninput="document.getElementById('min-players-value').textContent = this.value; window.orchestrator.updateConfigSummary()">
                        <span id="min-players-value" class="slider-value">${settings.minPlayers}</span>
                      </div>
                    </div>

                    <div class="toggles-row">
                      <label class="toggle-switch">
                        <input type="checkbox" id="friendly-fire" ${settings.friendlyFire ? 'checked' : ''} onchange="window.orchestrator.updateConfigSummary()">
                        <span class="toggle-slider"></span>
                        <span class="toggle-label">Friendly Fire</span>
                      </label>

                      <label class="toggle-switch">
                        <input type="checkbox" id="auto-bots" ${settings.autoBots ? 'checked' : ''} onchange="window.orchestrator.updateConfigSummary()">
                        <span class="toggle-slider"></span>
                        <span class="toggle-label">Auto Bots</span>
                      </label>

                      <label class="toggle-switch">
                        <input type="checkbox" id="allow-spectators" ${settings.spectators ? 'checked' : ''} onchange="window.orchestrator.updateConfigSummary()">
                        <span class="toggle-slider"></span>
                        <span class="toggle-label">Spectators</span>
                      </label>

                      <label class="toggle-switch">
                        <input type="checkbox" id="strict-teams" ${settings.strictTeams ? 'checked' : ''} onchange="window.orchestrator.updateConfigSummary()">
                        <span class="toggle-slider"></span>
                        <span class="toggle-label">Strict Teams</span>
                      </label>
                    </div>
                  </div>
                </section>
              </div>

              <!-- Middle Column: Timing Settings -->
              <div class="settings-column">
                <section class="settings-section">
                  <h3>⏱️ Timing Settings</h3>
                  <div class="settings-grid">
                    <div class="setting-item">
                      <label>Round Time</label>
                      <div class="slider-container">
                        <input type="range" id="round-time" min="30" max="300" value="${settings.roundTime}"
                               oninput="document.getElementById('round-time-value').textContent = this.value + 's'; window.orchestrator.updateConfigSummary()">
                        <span id="round-time-value" class="slider-value">${settings.roundTime}s</span>
                      </div>
                    </div>

                    <div class="setting-item">
                      <label>Buy Time</label>
                      <div class="slider-container">
                        <input type="range" id="buy-time" min="5" max="60" value="${settings.buyTime}"
                               oninput="document.getElementById('buy-time-value').textContent = this.value + 's'; window.orchestrator.updateConfigSummary()">
                        <span id="buy-time-value" class="slider-value">${settings.buyTime}s</span>
                      </div>
                    </div>

                    <div class="setting-item">
                      <label>Warmup Time</label>
                      <div class="slider-container">
                        <input type="range" id="warmup-time" min="0" max="120" value="${settings.warmupTime}"
                               oninput="document.getElementById('warmup-time-value').textContent = this.value + 's'; window.orchestrator.updateConfigSummary()">
                        <span id="warmup-time-value" class="slider-value">${settings.warmupTime}s</span>
                      </div>
                    </div>

                    <div class="setting-item">
                      <label>Bomb Timer</label>
                      <div class="slider-container">
                        <input type="range" id="bomb-timer" min="20" max="60" value="${settings.bombTimer}"
                               oninput="document.getElementById('bomb-timer-value').textContent = this.value + 's'; window.orchestrator.updateConfigSummary()">
                        <span id="bomb-timer-value" class="slider-value">${settings.bombTimer}s</span>
                      </div>
                    </div>

                    <div class="setting-item">
                      <label>Pre-Round</label>
                      <div class="slider-container">
                        <input type="range" id="preround-time" min="0" max="10" value="${settings.preRoundTime}"
                               oninput="document.getElementById('preround-time-value').textContent = this.value + 's'; window.orchestrator.updateConfigSummary()">
                        <span id="preround-time-value" class="slider-value">${settings.preRoundTime}s</span>
                      </div>
                    </div>

                    <div class="setting-item">
                      <label>Round End</label>
                      <div class="slider-container">
                        <input type="range" id="roundend-time" min="0" max="15" value="${settings.roundEndTime}"
                               oninput="document.getElementById('roundend-time-value').textContent = this.value + 's'; window.orchestrator.updateConfigSummary()">
                        <span id="roundend-time-value" class="slider-value">${settings.roundEndTime}s</span>
                      </div>
                    </div>
                  </div>
                </section>

                <section class="settings-section">
                  <h3>⚙️ Server Settings</h3>
                  <div class="settings-grid">
                    <div class="setting-item">
                      <label>Environment</label>
                      <div class="radio-group">
                        <label class="radio-option">
                          <input type="radio" name="node-env" value="development" ${settings.nodeEnv === 'development' ? 'checked' : ''}
                                 onchange="window.orchestrator.updateConfigSummary()">
                          <span>Development</span>
                        </label>
                        <label class="radio-option">
                          <input type="radio" name="node-env" value="production" ${settings.nodeEnv === 'production' ? 'checked' : ''}
                                 onchange="window.orchestrator.updateConfigSummary()">
                          <span>Production</span>
                        </label>
                      </div>
                    </div>

                    <div class="setting-item">
                      <label>Memory Limit</label>
                      <div class="slider-container">
                        <input type="range" id="memory-limit" min="1024" max="16384" step="1024" value="${settings.memoryLimit}"
                               oninput="document.getElementById('memory-limit-value').textContent = (this.value/1024) + 'GB'; window.orchestrator.updateConfigSummary()">
                        <span id="memory-limit-value" class="slider-value">${settings.memoryLimit/1024}GB</span>
                      </div>
                    </div>

                    <div class="setting-item">
                      <label>Server Port</label>
                      <input type="number" id="server-port" value="${settings.port || 3000}" min="1000" max="65535"
                             class="setting-input" onchange="window.orchestrator.updateConfigSummary()">
                    </div>

                    <div class="toggles-row">
                      <label class="toggle-switch">
                        <input type="checkbox" id="debug-mode" ${settings.debugMode ? 'checked' : ''} onchange="window.orchestrator.updateConfigSummary()">
                        <span class="toggle-slider"></span>
                        <span class="toggle-label">Debug Mode</span>
                      </label>
                    </div>
                  </div>
                </section>
              </div>

              <!-- Right Column: Status & Advanced -->
              <div class="settings-column">
                <section class="settings-section">
                  <h3>📊 Current Configuration</h3>
                  <div class="config-summary" id="config-summary">
                    <!-- Will be populated by JS -->
                  </div>
                </section>

                <section class="settings-section">
                  <h3>🔧 Advanced Options</h3>
                  <div class="advanced-settings">
                    <div class="setting-group">
                      <label>Extra Environment Variables</label>
                      <input type="text" id="extra-env" class="setting-input-full"
                             placeholder="KEY=value KEY2=value2" value="${settings.extraEnv || ''}"
                             onchange="window.orchestrator.updateConfigSummary()">
                    </div>

                    <div class="setting-group">
                      <label>Extra Node Options</label>
                      <input type="text" id="extra-node" class="setting-input-full"
                             placeholder="--inspect --trace-warnings" value="${settings.extraNode || ''}"
                             onchange="window.orchestrator.updateConfigSummary()">
                    </div>

                    <div class="setting-group">
                      <label>Extra Game Arguments</label>
                      <input type="text" id="extra-args" class="setting-input-full"
                             placeholder="--custom-flag=value" value="${settings.extraArgs || ''}"
                             onchange="window.orchestrator.updateConfigSummary()">
                    </div>

                    <div class="setting-group">
                      <label>Command Preview</label>
                      <pre id="command-preview" class="command-preview"></pre>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn-secondary" onclick="window.orchestrator.resetToDefaults()">Reset to Defaults</button>
            <button class="btn-save" onclick="window.orchestrator.saveInteractiveLaunchSettings('${sessionId}')">Apply & Launch</button>
            <button class="btn-cancel" onclick="window.orchestrator.closeLaunchSettingsModal()">Cancel</button>
          </div>
        </div>
      </div>
    `;

    // Add modal to page
    const existingModal = document.getElementById('launch-settings-modal');
    if (existingModal) {
      existingModal.remove();
    }

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Update the config summary
    this.updateConfigSummary();
  }

  parseCurrentSettings(worktreeId) {
    const worktreeSettings = this.serverLaunchSettings.perWorktree[worktreeId] || {};
    const globalSettings = this.serverLaunchSettings.global;

    // Parse existing settings or use defaults
    const envVars = worktreeSettings.envVars || globalSettings.envVars || '';
    const nodeOptions = worktreeSettings.nodeOptions || globalSettings.nodeOptions || '';
    const gameArgs = worktreeSettings.gameArgs || globalSettings.gameArgs || '';

    // Parse individual values
    const settings = {
      // Game rules
      mode: gameArgs.match(/--mode=(\w+)/)?.[1] || 'casual',
      maxRounds: parseInt(gameArgs.match(/--maxrounds=(\d+)/)?.[1] || '13'),
      teamSize: parseInt(gameArgs.match(/--teamsize=(\d+)/)?.[1] || '5'),
      minPlayers: parseInt(gameArgs.match(/--minplayers=(\d+)/)?.[1] || '2'),
      friendlyFire: gameArgs.includes('--friendlyfire=true'),
      autoBots: envVars.includes('AUTO_START_WITH_BOTS=true'),
      spectators: !gameArgs.includes('--spectators=false'),
      strictTeams: gameArgs.includes('--strictteams=true'),

      // Timing
      roundTime: parseInt(gameArgs.match(/--roundtime=(\d+)/)?.[1] || '60'),
      buyTime: parseInt(gameArgs.match(/--buytime=(\d+)/)?.[1] || '10'),
      warmupTime: parseInt(gameArgs.match(/--warmup=(\d+)/)?.[1] || '5'),
      bombTimer: parseInt(gameArgs.match(/--bombtimer=(\d+)/)?.[1] || '40'),
      preRoundTime: parseInt(gameArgs.match(/--preroundtime=(\d+)/)?.[1] || '3'),
      roundEndTime: parseInt(gameArgs.match(/--roundendtime=(\d+)/)?.[1] || '5'),

      // Server
      nodeEnv: envVars.match(/NODE_ENV=(\w+)/)?.[1] || 'development',
      memoryLimit: parseInt(nodeOptions.match(/--max-old-space-size=(\d+)/)?.[1] || '4096'),
      debugMode: envVars.includes('DEBUG=*'),
      port: parseInt(envVars.match(/PORT=(\d+)/)?.[1] || '3000'),

      // Advanced
      extraEnv: envVars.replace(/AUTO_START_WITH_BOTS=\w+|NODE_ENV=\w+|DEBUG=\*|PORT=\d+/g, '').trim(),
      extraNode: nodeOptions.replace(/--max-old-space-size=\d+/g, '').trim(),
      extraArgs: gameArgs.replace(/--mode=\w+|--maxrounds=\d+|--teamsize=\d+|--minplayers=\d+|--friendlyfire=\w+|--spectators=\w+|--strictteams=\w+|--roundtime=\d+|--buytime=\d+|--warmup=\d+|--bombtimer=\d+|--preroundtime=\d+|--roundendtime=\d+/g, '').trim()
    };

    return settings;
  }

  setupTabSwitching() {
    const tabs = document.querySelectorAll('.tab-btn');
    const contents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        // Remove active from all
        tabs.forEach(t => t.classList.remove('active'));
        contents.forEach(c => c.classList.remove('active'));

        // Add active to clicked
        tab.classList.add('active');
        const tabId = `tab-${tab.dataset.tab}`;
        document.getElementById(tabId).classList.add('active');
      });
    });
  }

  updateConfigSummary() {
    const summary = document.getElementById('config-summary');
    const preview = document.getElementById('command-preview');

    if (!summary) return;

    // Gather all settings - handle radio buttons
    const gameModeRadio = document.querySelector('input[name="game-mode"]:checked');
    const nodeEnvRadio = document.querySelector('input[name="node-env"]:checked');

    const config = {
      mode: gameModeRadio?.value || 'casual',
      maxRounds: document.getElementById('max-rounds')?.value || 13,
      teamSize: document.getElementById('team-size')?.value || 5,
      roundTime: document.getElementById('round-time')?.value || 60,
      buyTime: document.getElementById('buy-time')?.value || 10,
      warmupTime: document.getElementById('warmup-time')?.value || 5,
      autoBots: document.getElementById('auto-bots')?.checked || false,
      friendlyFire: document.getElementById('friendly-fire')?.checked || false,
      nodeEnv: nodeEnvRadio?.value || 'development',
      memoryLimit: document.getElementById('memory-limit')?.value || 4096,
      debugMode: document.getElementById('debug-mode')?.checked || false
    };

    // Update summary display
    summary.innerHTML = `
      <div class="config-item">🎮 Mode: <strong>${config.mode}</strong></div>
      <div class="config-item">🎯 Rounds: <strong>${config.maxRounds}</strong></div>
      <div class="config-item">👥 Team Size: <strong>${config.teamSize}v${config.teamSize}</strong></div>
      <div class="config-item">⏱️ Round Time: <strong>${config.roundTime}s</strong></div>
      <div class="config-item">💰 Buy Time: <strong>${config.buyTime}s</strong></div>
      <div class="config-item">🔥 Warmup: <strong>${config.warmupTime}s</strong></div>
      <div class="config-item">${config.autoBots ? '✅' : '❌'} Auto-fill with bots</div>
      <div class="config-item">${config.friendlyFire ? '✅' : '❌'} Friendly fire</div>
      <div class="config-item">🖥️ Environment: <strong>${config.nodeEnv}</strong></div>
      <div class="config-item">💾 Memory: <strong>${config.memoryLimit/1024}GB</strong></div>
    `;

    // Generate command preview if on advanced tab
    if (preview) {
      const envVars = this.buildEnvVarsFromUI();
      const nodeOptions = this.buildNodeOptionsFromUI();
      const gameArgs = this.buildGameArgsFromUI();

      preview.textContent = `NODE_ENV=${config.nodeEnv} ${envVars} node ${nodeOptions} server.js ${gameArgs}`;
    }
  }

  buildEnvVarsFromUI() {
    const parts = [];
    if (document.getElementById('auto-bots')?.checked) parts.push('AUTO_START_WITH_BOTS=true');
    if (document.getElementById('debug-mode')?.checked) parts.push('DEBUG=*');
    const extra = document.getElementById('extra-env')?.value;
    if (extra) parts.push(extra);
    return parts.join(' ');
  }

  buildNodeOptionsFromUI() {
    const parts = [];
    const memory = document.getElementById('memory-limit')?.value;
    if (memory) parts.push(`--max-old-space-size=${memory}`);
    const extra = document.getElementById('extra-node')?.value;
    if (extra) parts.push(extra);
    return parts.join(' ');
  }

  buildGameArgsFromUI() {
    const parts = [];
    const mode = document.querySelector('input[name="game-mode"]:checked')?.value;
    if (mode) parts.push(`--mode=${mode}`);

    const maxRounds = document.getElementById('max-rounds')?.value;
    if (maxRounds) parts.push(`--maxrounds=${maxRounds}`);

    const teamSize = document.getElementById('team-size')?.value;
    if (teamSize) parts.push(`--teamsize=${teamSize}`);

    const roundTime = document.getElementById('round-time')?.value;
    if (roundTime) parts.push(`--roundtime=${roundTime}`);

    const buyTime = document.getElementById('buy-time')?.value;
    if (buyTime) parts.push(`--buytime=${buyTime}`);

    const warmup = document.getElementById('warmup-time')?.value;
    if (warmup) parts.push(`--warmup=${warmup}`);

    if (document.getElementById('friendly-fire')?.checked) parts.push('--friendlyfire=true');
    if (document.getElementById('strict-teams')?.checked) parts.push('--strictteams=true');

    const extra = document.getElementById('extra-args')?.value;
    if (extra) parts.push(extra);

    return parts.join(' ');
  }

  applyPreset(preset) {
    const presets = {
      'quick-test': {
        maxRounds: 2, roundTime: 30, buyTime: 5, warmupTime: 2
      },
      'fast-game': {
        maxRounds: 5, roundTime: 60, buyTime: 10, warmupTime: 3
      },
      'normal': {
        maxRounds: 13, roundTime: 60, buyTime: 10, warmupTime: 5
      },
      'competitive': {
        maxRounds: 30, roundTime: 90, buyTime: 20, warmupTime: 60, mode: 'competitive'
      },
      'debug': {
        debugMode: true, nodeEnv: 'development', maxRounds: 2
      },
      'bots-only': {
        autoBots: true, minPlayers: 1
      }
    };

    const settings = presets[preset];
    if (!settings) return;

    // Apply settings to UI
    Object.entries(settings).forEach(([key, value]) => {
      const el = document.getElementById(key.replace(/([A-Z])/g, '-$1').toLowerCase());
      if (el) {
        if (el.type === 'checkbox') {
          el.checked = value;
        } else {
          el.value = value;
          // Update slider display if applicable
          const display = document.getElementById(el.id + '-value');
          if (display) {
            display.textContent = el.id.includes('time') ? value + 's' : value;
          }
        }
      }
    });

    this.updateConfigSummary();
  }

  resetToDefaults() {
    this.applyPreset('normal');
  }

  updatePresetCheckboxesFromValues() {
    const globalEnv = document.getElementById('global-env-vars').value;
    const globalNode = document.getElementById('global-node-options').value;
    const globalArgs = document.getElementById('global-game-args').value;

    // Check which presets are active
    document.getElementById('preset-bots').checked = globalEnv.includes('AUTO_START_WITH_BOTS=true');
    document.getElementById('preset-fast').checked = globalArgs.includes('--warmup=3') && globalArgs.includes('--buytime=10');
    document.getElementById('preset-debug').checked = globalEnv.includes('DEBUG=*');
    document.getElementById('preset-memory').checked = globalNode.includes('--max-old-space-size');
    document.getElementById('preset-dev').checked = globalEnv.includes('NODE_ENV=development');
    document.getElementById('preset-quick').checked = globalArgs.includes('--maxrounds=2') && globalArgs.includes('--roundtime=30');
  }

  closeLaunchSettingsModal() {
    const modal = document.getElementById('launch-settings-modal');
    if (modal) {
      modal.remove();
    }
  }

  saveInteractiveLaunchSettings(sessionId) {
    const worktreeId = sessionId.split('-')[0];

    // Build settings from UI - handle radio buttons
    const nodeEnv = document.querySelector('input[name="node-env"]:checked')?.value || 'development';
    const envVars = `NODE_ENV=${nodeEnv} ${this.buildEnvVarsFromUI()}`.trim();
    const nodeOptions = this.buildNodeOptionsFromUI();
    const gameArgs = this.buildGameArgsFromUI();

    // Save as global settings
    this.serverLaunchSettings.global = {
      envVars: envVars,
      nodeOptions: nodeOptions,
      gameArgs: gameArgs
    };

    this.saveServerLaunchSettings();
    this.closeLaunchSettingsModal();

    // Auto-launch the server with custom settings
    this.toggleServer(sessionId, 'custom');
  }

  saveLaunchSettings(sessionId) {
    const worktreeId = sessionId.split('-')[0];

    // Save global settings
    this.serverLaunchSettings.global = {
      envVars: document.getElementById('global-env-vars').value,
      nodeOptions: document.getElementById('global-node-options').value,
      gameArgs: document.getElementById('global-game-args').value
    };

    // Save worktree-specific settings
    const worktreeEnv = document.getElementById('worktree-env-vars').value;
    const worktreeNode = document.getElementById('worktree-node-options').value;
    const worktreeArgs = document.getElementById('worktree-game-args').value;

    if (worktreeEnv || worktreeNode || worktreeArgs) {
      this.serverLaunchSettings.perWorktree[worktreeId] = {
        envVars: worktreeEnv,
        nodeOptions: worktreeNode,
        gameArgs: worktreeArgs
      };
    } else {
      delete this.serverLaunchSettings.perWorktree[worktreeId];
    }

    this.saveServerLaunchSettings();
    this.closeLaunchSettingsModal();

    // Show feedback
    this.showNotification('Launch settings saved', 'success');
  }

  updatePresetsFromCheckboxes() {
    const botsChecked = document.getElementById('preset-bots').checked;
    const fastChecked = document.getElementById('preset-fast').checked;
    const debugChecked = document.getElementById('preset-debug').checked;
    const memoryChecked = document.getElementById('preset-memory').checked;
    const devChecked = document.getElementById('preset-dev').checked;
    const quickChecked = document.getElementById('preset-quick').checked;

    const globalEnvInput = document.getElementById('global-env-vars');
    const globalNodeInput = document.getElementById('global-node-options');
    const globalArgsInput = document.getElementById('global-game-args');

    // Start with existing manual entries (if any)
    let envVars = [];
    let nodeOptions = [];
    let gameArgs = [];

    // Parse existing values to avoid duplicates
    const currentEnv = globalEnvInput.value.trim();
    const currentNode = globalNodeInput.value.trim();
    const currentArgs = globalArgsInput.value.trim();

    // Helper to add if not already present
    const addUnique = (arr, items) => {
      items.forEach(item => {
        if (!arr.includes(item)) {
          arr.push(item);
        }
      });
    };

    // Start with current non-preset values
    if (currentEnv && !currentEnv.includes('AUTO_START_WITH_BOTS') && !currentEnv.includes('DEBUG=')) {
      envVars.push(currentEnv);
    }
    if (currentNode && !currentNode.includes('--max-old-space-size')) {
      nodeOptions.push(currentNode);
    }
    if (currentArgs && !currentArgs.includes('--warmup') && !currentArgs.includes('--buytime')) {
      gameArgs.push(currentArgs);
    }

    // Add preset values based on checkboxes
    if (botsChecked) {
      addUnique(envVars, ['AUTO_START_WITH_BOTS=true']);
    }

    if (fastChecked) {
      addUnique(gameArgs, ['--warmup=3', '--buytime=10', '--roundtime=60']);
    }

    if (debugChecked) {
      addUnique(envVars, ['DEBUG=*', 'NODE_ENV=development']);
    }

    if (memoryChecked) {
      addUnique(nodeOptions, ['--max-old-space-size=8192']);
    }

    if (devChecked) {
      // Remove production env if it exists
      envVars = envVars.filter(v => !v.includes('NODE_ENV=production'));
      addUnique(envVars, ['NODE_ENV=development']);
    }

    if (quickChecked) {
      // Quick test mode - 2 rounds, very short times
      // Remove conflicting args first
      gameArgs = gameArgs.filter(arg => !arg.includes('--maxrounds') && !arg.includes('--roundtime') && !arg.includes('--warmup') && !arg.includes('--buytime'));
      addUnique(gameArgs, ['--maxrounds=2', '--roundtime=30', '--warmup=2', '--buytime=5']);
    }

    // Update the input fields
    globalEnvInput.value = envVars.join(' ');
    globalNodeInput.value = nodeOptions.join(' ');
    globalArgsInput.value = gameArgs.join(' ');
  }
  
  saveSettings() {
    localStorage.setItem('claude-orchestrator-settings', JSON.stringify(this.settings));
  }
  
  applyTheme() {
    if (this.settings.theme === 'light') {
      document.body.classList.add('light-theme');
    } else {
      document.body.classList.remove('light-theme');
    }
  }
  
  syncSettingsUI() {
    // Sync checkbox states with settings
    document.getElementById('enable-notifications').checked = this.settings.notifications;
    document.getElementById('enable-sounds').checked = this.settings.sounds;
    document.getElementById('auto-scroll').checked = this.settings.autoScroll;
    document.getElementById('theme-select').value = this.settings.theme;
    
    // Sync user settings UI if loaded
    if (this.userSettings) {
      this.syncUserSettingsUI();
    }
  }
  
  showCodeReviewDropdown(sessionId) {
    // Close any existing dropdowns
    document.querySelectorAll('.review-dropdown').forEach(dropdown => dropdown.remove());
    
    // Get the terminal controls container
    const terminalWrapper = document.getElementById(`wrapper-${sessionId}`);
    const controlsContainer = terminalWrapper.querySelector('.terminal-controls');
    
    // Create dropdown
    const dropdown = document.createElement('div');
    dropdown.className = 'review-dropdown';
    dropdown.innerHTML = this.buildReviewerDropdownHTML(sessionId);
    
    // Position and add to DOM
    controlsContainer.appendChild(dropdown);
    
    // Close dropdown when clicking outside
    const closeDropdown = (e) => {
      if (!dropdown.contains(e.target)) {
        dropdown.remove();
        document.removeEventListener('click', closeDropdown);
      }
    };
    
    // Add close listener after a short delay to prevent immediate closure
    setTimeout(() => {
      document.addEventListener('click', closeDropdown);
    }, 100);
  }
  
  buildReviewerDropdownHTML(requestingSessionId) {
    const availableReviewers = this.getAvailableReviewers(requestingSessionId);
    
    let html = `
      <div class="review-dropdown-header">
        Assign Code Review
      </div>
    `;
    
    if (availableReviewers.length === 0) {
      html += `
        <div class="reviewer-option disabled">
          <span class="reviewer-status inactive"></span>
          <span>No available reviewers</span>
        </div>
      `;
    } else {
      availableReviewers.forEach(({ sessionId, session, worktreeNumber, status }) => {
        const statusClass = status === 'waiting' ? 'ready' : status === 'busy' ? 'busy' : 'inactive';
        html += `
          <div class="reviewer-option" onclick="window.orchestrator.assignCodeReview('${requestingSessionId}', '${sessionId}')">
            <span class="reviewer-status ${statusClass}"></span>
            <span>🤖 Claude ${worktreeNumber}</span>
            <span style="font-size: 0.75rem; color: var(--text-secondary);">(${session.branch || 'unknown'})</span>
          </div>
        `;
      });
    }
    
    return html;
  }
  
  getAvailableReviewers(requestingSessionId) {
    const reviewers = [];
    
    for (const [sessionId, session] of this.sessions) {
      // Only include Claude sessions that are not the requesting session
      if (sessionId.includes('-claude') && sessionId !== requestingSessionId) {
        const worktreeNumber = sessionId.replace('-claude', '').replace('work', '');
        const isActive = this.sessionActivity.get(sessionId) === 'active';
        
        // Prefer active sessions, but include inactive ones as backup
        if (isActive || session.status === 'waiting') {
          reviewers.push({
            sessionId,
            session,
            worktreeNumber,
            status: session.status,
            isActive
          });
        }
      }
    }
    
    // Sort by preference: active + ready first, then active + busy, then inactive
    reviewers.sort((a, b) => {
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;
      if (a.status === 'waiting' && b.status !== 'waiting') return -1;
      if (a.status !== 'waiting' && b.status === 'waiting') return 1;
      return 0;
    });
    
    return reviewers;
  }
  
  async assignCodeReview(requestingSessionId, reviewerSessionId) {
    // Close dropdown
    document.querySelectorAll('.review-dropdown').forEach(dropdown => dropdown.remove());
    
    try {
      // Extract code/PR information from the requesting session
      const codeInfo = await this.extractCodeForReview(requestingSessionId);
      
      if (!codeInfo.hasContent) {
        this.showToast(`No code changes detected in Claude ${requestingSessionId.replace('work', '').replace('-claude', '')}`, 'warning');
        return;
      }
      
      // Format review request
      const reviewRequest = this.formatReviewRequest(codeInfo, requestingSessionId);
      
      // Send to reviewer Claude
      this.sendTerminalInput(reviewerSessionId, reviewRequest);
      
      // Mark both sessions as active
      this.sessionActivity.set(reviewerSessionId, 'active');
      this.buildSidebar();
      
      // Show success message
      const requestingWorktree = requestingSessionId.replace('work', '').replace('-claude', '');
      const reviewerWorktree = reviewerSessionId.replace('work', '').replace('-claude', '');
      this.showToast(`Code review assigned: Claude ${requestingWorktree} → Claude ${reviewerWorktree}`, 'success');
      
    } catch (error) {
      console.error('Error assigning code review:', error);
      this.showToast('Failed to assign code review', 'error');
    }
  }
  
  async extractCodeForReview(sessionId) {
    // Get terminal content
    const terminalContent = this.terminalManager.getTerminalContent(sessionId);
    
    // Look for various types of code content
    const codePatterns = {
      prUrl: /https:\/\/github\.com\/[^\s]+\/pull\/\d+/g,
      gitDiff: /diff --git[\s\S]*?(?=diff --git|$)/g,
      fileChanges: /^\+\+\+ b\/.*$/gm,
      codeBlocks: /```[\s\S]*?```/g,
      bashCommands: /(?:git\s+(?:diff|log|show)|gh\s+pr)/g
    };
    
    const extracted = {
      prUrls: [...(terminalContent.match(codePatterns.prUrl) || [])],
      gitDiffs: [...(terminalContent.match(codePatterns.gitDiff) || [])],
      codeBlocks: [...(terminalContent.match(codePatterns.codeBlocks) || [])],
      recentCommands: this.extractRecentCommands(terminalContent),
      hasContent: false
    };
    
    // Determine if there's reviewable content
    extracted.hasContent = extracted.prUrls.length > 0 || 
                          extracted.gitDiffs.length > 0 || 
                          extracted.codeBlocks.length > 0 ||
                          extracted.recentCommands.some(cmd => cmd.includes('git') || cmd.includes('gh pr'));
    
    return extracted;
  }
  
  extractRecentCommands(terminalContent) {
    const lines = terminalContent.split('\n');
    const commands = [];
    
    // Look for command patterns (simple approach)
    for (let i = lines.length - 1; i >= 0 && commands.length < 10; i--) {
      const line = lines[i].trim();
      if (line.match(/^(git|gh|npm|bun|yarn|node)\s+/) || line.includes('claude ')) {
        commands.unshift(line);
      }
    }
    
    return commands;
  }
  
  formatReviewRequest(codeInfo, requestingSessionId) {
    const requestingWorktree = requestingSessionId.replace('work', '').replace('-claude', '');
    
    let request = `Please review the code from Claude ${requestingWorktree}:\n\n`;
    
    if (codeInfo.prUrls.length > 0) {
      request += `**Pull Request(s):**\n`;
      codeInfo.prUrls.forEach(url => {
        request += `- ${url}\n`;
      });
      request += `\nPlease review this PR and provide feedback on:\n`;
      request += `- Code quality and best practices\n`;
      request += `- Potential bugs or issues\n`;
      request += `- Suggestions for improvement\n`;
      request += `- Architecture and design patterns\n\n`;
    }
    
    if (codeInfo.gitDiffs.length > 0) {
      request += `**Git Diff:**\n\`\`\`diff\n`;
      request += codeInfo.gitDiffs.slice(0, 2).join('\n'); // Limit to first 2 diffs
      request += `\n\`\`\`\n\n`;
    }
    
    if (codeInfo.codeBlocks.length > 0) {
      request += `**Code Changes:**\n`;
      request += codeInfo.codeBlocks.slice(0, 3).join('\n\n'); // Limit to first 3 blocks
      request += `\n\n`;
    }
    
    if (codeInfo.recentCommands.length > 0) {
      request += `**Recent Commands:**\n`;
      codeInfo.recentCommands.forEach(cmd => {
        request += `- \`${cmd}\`\n`;
      });
      request += `\n`;
    }
    
    request += `Please provide a thorough code review with specific feedback and suggestions.\n`;
    
    return request;
  }
  
  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <div class="toast-content">
        <span class="toast-icon">${type === 'success' ? '✅' : type === 'warning' ? '⚠️' : type === 'error' ? '❌' : 'ℹ️'}</span>
        <span class="toast-text">${message}</span>
      </div>
    `;
    
    // Add styles for different toast types
    const styles = {
      info: 'var(--accent-primary)',
      success: 'var(--accent-success)', 
      warning: 'var(--accent-warning)',
      error: 'var(--accent-danger)'
    };
    
    toast.style.cssText = `
      position: fixed;
      top: calc(var(--header-height) + 20px);
      right: 20px;
      background: ${styles[type]};
      color: white;
      padding: var(--space-sm) var(--space-md);
      border-radius: var(--radius-md);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      z-index: 1000;
      animation: slideInRight 0.3s ease-out, fadeOutRight 0.3s ease-in 4.7s forwards;
    `;
    
    document.body.appendChild(toast);
    
    // Remove after 5 seconds
    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 5000);
  }

  async launchDiffViewer(githubUrl) {
    // Parse GitHub URL to extract owner, repo, and PR/commit
    const prMatch = githubUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/);
    const commitMatch = githubUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/commit\/([a-f0-9]{40})/);
    
    let diffViewerPath = '';
    
    if (prMatch) {
      const [, owner, repo, pr] = prMatch;
      diffViewerPath = `/pr/${owner}/${repo}/${pr}`;
    } else if (commitMatch) {
      const [, owner, repo, sha] = commitMatch;
      diffViewerPath = `/commit/${owner}/${repo}/${sha}`;
    } else {
      this.showToast('Unable to parse GitHub URL', 'error');
      return;
    }
    
    // Open a placeholder tab immediately (avoids popup blockers), then redirect once ready.
    const popup = window.open('', '_blank');
    if (!popup) {
      this.showToast('Popup blocked - allow popups to open the diff viewer', 'warning');
      return;
    }

    try {
      popup.document.title = 'Starting Diff Viewer…';
      popup.document.body.style.cssText = 'background:#0b0b0b;color:#d4d4d4;font-family:system-ui, sans-serif;padding:20px;';
      popup.document.body.innerHTML = `
        <h2 style="margin:0 0 8px 0;">Starting Advanced Diff Viewer…</h2>
        <div style="color:#9a9a9a;margin-bottom:14px;">This may take a few seconds the first time.</div>
        <div style="font-family:Consolas, Monaco, monospace;background:#111;border:1px solid #222;border-radius:10px;padding:10px;">
          Target: ${diffViewerPath}
        </div>
      `;
    } catch {
      // Some browsers restrict about:blank manipulation; ignore.
    }

    this.showToast('Starting Advanced Diff Viewer…', 'info');

    let baseUrl = 'http://localhost:7655';
    try {
      const resp = await fetch('/api/diff-viewer/ensure', { method: 'POST' });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data?.message || data?.error || 'Failed to start diff viewer');
      }
      if (data?.baseUrl) baseUrl = data.baseUrl;

      // If it’s still booting (e.g. first-time npm install/build), poll until healthy.
      if (!data?.running) {
        this.showToast('Diff viewer is starting… (first run may take a minute)', 'info');
        const start = Date.now();
        const timeoutMs = 120000;
        while (Date.now() - start < timeoutMs) {
          if (popup.closed) return;
          await new Promise(r => setTimeout(r, 1000));
          const statusResp = await fetch('/api/diff-viewer/status');
          const status = await statusResp.json();
          if (status?.baseUrl) baseUrl = status.baseUrl;
          if (status?.running) break;
        }
      }
    } catch (err) {
      this.showToast(`Diff viewer failed to start: ${err.message}`, 'error');
      try {
        popup.document.title = 'Diff Viewer Error';
        popup.document.body.innerHTML = `
          <h2 style="margin:0 0 8px 0;color:#ff6b6b;">Failed to start diff viewer</h2>
          <div style="color:#9a9a9a;margin-bottom:14px;">${err.message}</div>
          <div style="color:#9a9a9a;">Try running <code style="background:#111;border:1px solid #222;border-radius:6px;padding:2px 6px;">./diff-viewer/start-diff-viewer.sh</code> in the repo.</div>
        `;
      } catch {}
      return;
    }

    const diffViewerUrl = `${baseUrl}${diffViewerPath}`;
    popup.location.href = diffViewerUrl;
    this.showToast('Opening Advanced Diff Viewer…', 'success');
  }

  getAuthToken() {
    // Check URL params first
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('token');
    
    if (tokenFromUrl) {
      // Save to localStorage for future use
      localStorage.setItem('claude-orchestrator-token', tokenFromUrl);
      // Remove from URL for security
      window.history.replaceState({}, document.title, window.location.pathname);
      return tokenFromUrl;
    }
    
    // Check localStorage
    return localStorage.getItem('claude-orchestrator-token');
  }
  
  // Terminal Focus Feature - Now shows only that worktree
  focusTerminal(sessionId) {
    // Extract worktree ID from session ID
    const worktreeId = sessionId.split('-')[0];

    // Show only this worktree (hides all others)
    this.showOnlyWorktree(worktreeId);

    // Optional: scroll to the terminal if needed
    const terminalWrapper = document.getElementById(`wrapper-${sessionId}`);
    if (terminalWrapper) {
      terminalWrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    return; // Skip the old overlay logic

    // OLD OVERLAY LOGIC BELOW (keeping for reference, will be removed)
    try {
      const terminalWrapperOld = document.getElementById(`wrapper-${sessionId}`);
      if (!terminalWrapperOld) {
        console.error(`Terminal wrapper not found for ${sessionId}`);
        return;
      }

      // Get session info
      const session = this.sessions.get(sessionId);
      if (!session) {
        console.error(`Session not found for ${sessionId}`);
        return;
      }

      // Get the xterm instance from terminalManager
      const xtermInstance = this.terminalManager?.terminals?.get(sessionId);
      if (!xtermInstance) {
        console.error(`Terminal instance not found for ${sessionId}`);
        return;
      }
      
      // Store original parent for unfocus
      const terminalElement = terminalWrapper.querySelector('.terminal');
      if (!terminalElement) {
        console.error(`Terminal element not found in wrapper for ${sessionId}`);
        return;
      }
      
      this.focusedTerminalInfo = {
        sessionId: sessionId,
        originalParent: terminalElement.parentElement,
        originalNextSibling: terminalElement.nextSibling,
        terminalElement: terminalElement,
        terminalWrapper: terminalWrapper,
        originalDimensions: {
          cols: xtermInstance.cols || 80,
          rows: xtermInstance.rows || 24
        }
      };
      
      // Add focusing animation to original terminal
      terminalWrapper.classList.add('focusing');
      
      // Update overlay header
      const focusedTitle = document.getElementById('focused-title');
      const focusedBranch = document.getElementById('focused-branch');
      const focusedStatus = document.getElementById('focused-status');
      
      const isClaudeSession = sessionId.includes('-claude');
      const worktreeNumber = sessionId.split('-')[0].replace('work', '');
      
      if (focusedTitle) focusedTitle.textContent = `${isClaudeSession ? '🤖 Agent' : '💻 Server'} ${worktreeNumber}`;
      if (focusedBranch) focusedBranch.textContent = session.branch || '';
      if (focusedStatus) focusedStatus.className = `status-indicator ${session.status || 'idle'}`;
      
      // Move the actual terminal element to focused container
      const focusedTerminalBody = document.getElementById('focused-terminal-body');
      if (!focusedTerminalBody) {
        console.error('Focused terminal body container not found');
        return;
      }
      
      focusedTerminalBody.innerHTML = '';
      focusedTerminalBody.appendChild(terminalElement);
      
      // Hide original wrapper
      terminalWrapper.style.visibility = 'hidden';
      
      // Activate focus overlay with animation
      const focusOverlay = document.getElementById('focus-overlay');
      if (focusOverlay) {
        focusOverlay.classList.add('active');
      }
      
      // Bind ESC key for unfocus
      this.handleEscKey = (e) => {
        if (e.key === 'Escape') {
          this.unfocusTerminal();
        }
      };
      document.addEventListener('keydown', this.handleEscKey);
      
      // Resize terminal to fit the focused container after animation
      setTimeout(() => {
        try {
          // Store original font size
          this.focusedTerminalInfo.originalFontSize = xtermInstance.options.fontSize || 12;
          
          // Increase font size for better readability in focused mode
          const originalSize = this.focusedTerminalInfo.originalFontSize;
          const newFontSize = Math.round(originalSize * 1.8); // 1.8x larger (reduced from 3x by ~60%)
          xtermInstance.options.fontSize = newFontSize;
          
          const rect = focusedTerminalBody.getBoundingClientRect();
          // Calculate new dimensions based on container size with larger font
          const charWidth = newFontSize * 0.6;  // Approximate character width
          const lineHeight = newFontSize * 1.4; // Approximate line height
          
          const cols = Math.floor((rect.width - 30) / charWidth);
          const rows = Math.floor((rect.height - 30) / lineHeight);
          
          // Apply reasonable limits
          const finalCols = Math.min(200, Math.max(80, cols));
          const finalRows = Math.min(80, Math.max(24, rows));
          
          console.log(`Resizing focused terminal from ${xtermInstance.cols}x${xtermInstance.rows} to ${finalCols}x${finalRows} with font size ${newFontSize}px`);
          
          // Resize xterm
          xtermInstance.resize(finalCols, finalRows);
          
          // Use fit addon if available
          const fitAddon = this.terminalManager?.fitAddons?.get(sessionId);
          if (fitAddon) {
            fitAddon.fit();
          }
          
          // Send resize command to backend
          if (this.socket) {
            this.socket.emit('resize', {
              sessionId: sessionId,
              cols: finalCols,
              rows: finalRows
            });
          }
          
          // Focus the terminal for input
          xtermInstance.focus();
        } catch (resizeError) {
          console.error('Error resizing focused terminal:', resizeError);
        }
      }, 200);
      
      // Remove focusing animation after transition
      setTimeout(() => {
        terminalWrapper.classList.remove('focusing');
      }, 300);
      
    } catch (error) {
      console.error('Error focusing terminal:', error);
    }
  }
  
  unfocusTerminal() {
    try {
      if (!this.focusedTerminalInfo) return;
      
      const { sessionId, originalParent, originalNextSibling, terminalElement, terminalWrapper, originalDimensions } = this.focusedTerminalInfo;
      
      // Move terminal element back to original location
      if (originalNextSibling) {
        originalParent.insertBefore(terminalElement, originalNextSibling);
      } else {
        originalParent.appendChild(terminalElement);
      }
      
      // Show original wrapper
      terminalWrapper.style.visibility = 'visible';
      
      // Deactivate focus overlay
      const focusOverlay = document.getElementById('focus-overlay');
      if (focusOverlay) {
        focusOverlay.classList.remove('active');
      }
      
      // Restore original terminal size and font
      const xtermInstance = this.terminalManager?.terminals?.get(sessionId);
      if (xtermInstance) {
        // Restore font size immediately before moving the terminal back
        const originalFontSize = this.focusedTerminalInfo.originalFontSize || 12;
        console.log(`Restoring font size from ${xtermInstance.options.fontSize}px to ${originalFontSize}px`);
        xtermInstance.options.fontSize = originalFontSize;
        
        // Force a refresh of the terminal to apply font change
        xtermInstance.refresh(0, xtermInstance.rows - 1);
        
        if (originalDimensions) {
          setTimeout(() => {
            console.log(`Restoring terminal dimensions to ${originalDimensions.cols}x${originalDimensions.rows}`);
            xtermInstance.resize(originalDimensions.cols, originalDimensions.rows);
            
            // Use fit addon if available
            const fitAddon = this.terminalManager?.fitAddons?.get(sessionId);
            if (fitAddon) {
              setTimeout(() => fitAddon.fit(), 50);
            }
            
            // Send resize command to backend
            if (this.socket) {
              this.socket.emit('resize', {
                sessionId: sessionId,
                cols: originalDimensions.cols,
                rows: originalDimensions.rows
              });
            }
          }, 100);
        }
      }
      
      // Clean up
      this.focusedTerminalInfo = null;
      
      // Remove ESC key listener
      if (this.handleEscKey) {
        document.removeEventListener('keydown', this.handleEscKey);
        this.handleEscKey = null;
      }
    } catch (error) {
      console.error('Error unfocusing terminal:', error);
    }
  }
  
  calculateTerminalDimensions(container) {
    if (!container) return null;
    
    const rect = container.getBoundingClientRect();
    const cols = Math.floor(rect.width / 9);  // Approximate character width
    const rows = Math.floor(rect.height / 20); // Approximate line height
    
    return { cols: Math.max(80, cols), rows: Math.max(24, rows) };
  }

  /**
   * Apply session recovery - cd to last directory and optionally resume conversation
   */
  async applySessionRecovery(recovery) {
    if (!recovery || !recovery.sessions || recovery.sessions.length === 0) {
      console.log('No sessions to recover');
      return;
    }

    console.log('Applying session recovery:', recovery);
    const recoverySettings = this.userSettings?.global?.sessionRecovery || {};
    const resumeConversation = recoverySettings.resumeConversation !== false;

    // Track which sessions we're recovering so auto-start skips them
    this.recoveredSessions = new Set();

    for (const session of recovery.sessions) {
      const { sessionId, lastCwd, lastAgent, lastConversationId } = session;

      // Find the terminal for this session
      if (!this.sessions.has(sessionId)) {
        console.log(`Session ${sessionId} not found, skipping recovery`);
        continue;
      }

      // Mark this session as recovered to prevent auto-start
      this.recoveredSessions.add(sessionId);

      console.log(`Recovering session ${sessionId}:`, { lastCwd, lastAgent, lastConversationId });

      // Start agent with resume if conversation available and it's a claude terminal
      if (resumeConversation && lastConversationId && lastAgent === 'claude' && sessionId.includes('-claude')) {
        console.log(`Resuming conversation: ${lastConversationId} in ${lastCwd}`);

        // Use recovery-specific skipPermissions setting (defaults to true)
        const skipPermissions = recoverySettings.skipPermissions !== false;

        this.socket.emit('start-claude', {
          sessionId,
          options: {
            mode: 'resume',
            resumeId: lastConversationId,
            skipPermissions: skipPermissions,
            cwd: lastCwd
          }
        });

        // Small delay between sessions
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    this.showTemporaryMessage(`Recovered ${recovery.sessions.length} session(s)`, 'success');
  }

  async autoStartClaude(sessionId) {
    console.log(`Auto-starting Claude with user settings: ${sessionId}`);

    if (!this.socket || !this.socket.connected) {
      this.showError('Not connected to server');
      return;
    }

    try {
      // Get effective settings for this session
      const response = await fetch(`/api/user-settings/effective/${sessionId}`);
      let effectiveSettings = {
        claudeFlags: { skipPermissions: false },
        autoStart: { mode: 'fresh' }
      };

      if (response.ok) {
        effectiveSettings = await response.json();
      } else {
        console.warn('Could not load effective settings, using defaults');
      }

      // Start Claude with effective settings
      const options = {
        mode: effectiveSettings.autoStart?.mode || 'fresh',
        skipPermissions: effectiveSettings.claudeFlags.skipPermissions
      };

      console.log('Auto-starting Claude with options:', options);

      this.socket.emit('start-claude', {
        sessionId: sessionId,
        options: options
      });

      // Hide the startup UI if it exists
      const startupUI = document.getElementById(`startup-ui-${sessionId}`);
      if (startupUI) {
        startupUI.style.display = 'none';
      }
      
    } catch (error) {
      console.error('Error auto-starting Claude:', error);
      this.showError('Failed to start Claude with settings');
    }
  }

  async showClaudeStartupModal(sessionId) {
    // Use new agent modal instead of legacy Claude-specific modal
    if (this.agentModalManager) {
      await this.agentModalManager.showModal(sessionId);
    } else {
      // Fallback to legacy modal
      const modal = document.getElementById('claude-startup-modal');
      const sessionInfo = document.getElementById('startup-session-id');

      if (modal && sessionInfo) {
        // Store the session ID for later use
        this.pendingClaudeSession = sessionId;

        // Update session info display
        const worktreeNumber = sessionId.replace('work', '').replace('-claude', '');
        sessionInfo.textContent = `Work ${worktreeNumber}`;

        // Show modal
        modal.classList.remove('hidden');
      }
    }
  }
  
  hideClaudeStartupModal() {
    const modal = document.getElementById('claude-startup-modal');
    if (modal) {
      modal.classList.add('hidden');
      this.pendingClaudeSession = null;
    }
  }
  
  startClaudeWithOptions(sessionId, mode, skipPermissions) {
    if (!this.socket || !this.socket.connected) {
      this.showError('Not connected to server');
      return;
    }

    console.log(`Starting Claude ${sessionId} with mode: ${mode}, skip: ${skipPermissions}`);

    // Send command to server
    this.socket.emit('start-claude', {
      sessionId: sessionId,
      options: {
        mode: mode,
        skipPermissions: skipPermissions
      }
    });
  }

  /**
   * Start agent with configuration (agent-agnostic)
   */
  startAgentWithConfig(sessionId, config) {
    if (!this.socket || !this.socket.connected) {
      this.showError('Not connected to server');
      return;
    }

    console.log(`Starting agent ${config.agentId} for ${sessionId} with config:`, config);

    // Send command to server
    this.socket.emit('start-agent', {
      sessionId: sessionId,
      config: config
    });

    // Hide startup UI when agent starts
    this.hideStartupUI(sessionId);
  }

  /**
   * Centralized startup UI management to fix reappearing bug
   */
  shouldShowStartupUI(sessionId, currentStatus, previousStatus) {
    // Don't show if user explicitly dismissed it
    if (this.dismissedStartupUI.get(sessionId)) {
      return false;
    }

    // Don't show if not a Claude session
    if (!sessionId.includes('-claude')) {
      return false;
    }

    // Don't show if Claude is currently running (busy status)
    if (currentStatus === 'busy') {
      return false;
    }

    // Don't show if auto-start is enabled (it will handle startup)
    const effectiveSettings = this.getEffectiveSettings(sessionId);
    if (effectiveSettings && effectiveSettings.autoStart && effectiveSettings.autoStart.enabled) {
      return false;
    }

    // Only show for legitimate transitions to waiting (not rapid cycling)
    if (currentStatus === 'waiting') {
      // Show only on first transition from idle->waiting, not busy->waiting cycles
      return previousStatus === 'idle' || !previousStatus;
    }

    return false;
  }

  hideStartupUI(sessionId) {
    const startupUI = document.getElementById(`startup-ui-${sessionId}`);
    if (startupUI) {
      startupUI.style.display = 'none';
      // Mark as dismissed by user action
      this.dismissedStartupUI.set(sessionId, true);
    }
  }

  showStartupUIIfNeeded(sessionId, currentStatus, previousStatus) {
    // Debounce to prevent rapid showing/hiding
    clearTimeout(this.startupUIDebounce.get(sessionId));

    this.startupUIDebounce.set(sessionId, setTimeout(() => {
      if (this.shouldShowStartupUI(sessionId, currentStatus, previousStatus)) {
        const startupUI = document.getElementById(`startup-ui-${sessionId}`);
        if (startupUI) {
          console.log(`Showing startup UI for ${sessionId} (${previousStatus} → ${currentStatus})`);
          startupUI.style.display = 'block';
        }
      }
    }, 300)); // 300ms debounce
  }
  
  quickStartClaude(sessionId, mode) {
    // Check if YOLO mode is enabled
    const yoloCheckbox = document.getElementById(`yolo-${sessionId}`);
    const skipPermissions = yoloCheckbox ? yoloCheckbox.checked : false;

    // Hide the startup UI and mark as dismissed
    this.hideStartupUI(sessionId);

    // Start Claude with selected options
    this.startClaudeWithOptions(sessionId, mode, skipPermissions);
  }

  /**
   * Quick start agent from inline UI (new agent-agnostic method)
   */
  quickStartAgent(sessionId, mode) {
    const agentDropdown = document.getElementById(`inline-agent-${sessionId}`);
    const selectedAgent = agentDropdown ? agentDropdown.value : 'claude';

    // Build configuration with BEST settings by default (no more "powerful" checkbox)
    let config;
    if (selectedAgent === 'claude') {
      config = {
        agentId: 'claude',
        mode: mode,
        flags: ['skipPermissions']  // Always use best settings
      };
    } else if (selectedAgent === 'codex') {
      config = {
        agentId: 'codex',
        mode: mode,
        flags: [
          'yolo',               // --yolo: no approvals + full access
          'networkAccess',      // Enable network for package installs
          'search'              // Enable web search tool
        ]
      };
    }

    console.log(`Quick starting ${selectedAgent} with config:`, config);

    // Hide the startup UI and mark as dismissed
    this.hideStartupUI(sessionId);

    // Start the selected agent
    this.startAgentWithConfig(sessionId, config);
  }

  /**
   * Update inline agent selection
   */
  updateInlineAgent(sessionId, agentId) {
    const modesContainer = document.getElementById(`inline-modes-${sessionId}`);
    if (!modesContainer) return;

    // Save preference
    const prefs = this.sessionAgentPreferences.get(sessionId) || { agentId: 'claude', powerful: false };
    prefs.agentId = agentId;
    this.sessionAgentPreferences.set(sessionId, prefs);

    // Update mode buttons based on selected agent
    if (agentId === 'claude') {
      modesContainer.innerHTML = `
        <button class="startup-btn-inline" onclick="window.orchestrator.quickStartAgent('${sessionId}', 'fresh')">
          <span class="btn-icon">🆕</span>
          <span>Fresh</span>
        </button>
        <button class="startup-btn-inline" onclick="window.orchestrator.quickStartAgent('${sessionId}', 'continue')">
          <span class="btn-icon">➡️</span>
          <span>Continue</span>
        </button>
        <button class="startup-btn-inline" onclick="window.orchestrator.quickStartAgent('${sessionId}', 'resume')">
          <span class="btn-icon">⏸️</span>
          <span>Resume</span>
        </button>
      `;
    } else if (agentId === 'codex') {
      modesContainer.innerHTML = `
        <button class="startup-btn-inline" onclick="window.orchestrator.quickStartAgent('${sessionId}', 'fresh')">
          <span class="btn-icon">🆕</span>
          <span>Fresh</span>
        </button>
        <button class="startup-btn-inline" onclick="window.orchestrator.quickStartAgent('${sessionId}', 'continue')">
          <span class="btn-icon">➡️</span>
          <span>Continue</span>
        </button>
        <button class="startup-btn-inline" onclick="window.orchestrator.quickStartAgent('${sessionId}', 'resume')">
          <span class="btn-icon">⏸️</span>
          <span>Resume</span>
        </button>
      `;
    }
  }

  /**
   * Update inline preset (powerful mode toggle)
   */
  /**
   * Get saved agent preferences for session
   */
  getSessionAgentPreference(sessionId) {
    return this.sessionAgentPreferences.get(sessionId) || {
      agentId: 'claude'
      // Note: "powerful" removed - we always use best settings by default
    };
  }

  /**
   * Save agent preference for session
   */
  saveSessionAgentPreference(sessionId, agentId, powerful = false) {
    this.sessionAgentPreferences.set(sessionId, { agentId, powerful });
  }

  /**
   * Delete worktree from workspace with confirmation
   */
  async deleteWorktree(worktreeId, displayName) {
    // Show confirmation dialog with clear messaging about what gets deleted
    const confirmed = await this.showConfirmationDialog(
      'Remove Worktree from Workspace',
      `Are you sure you want to remove "${displayName}" from this workspace?\n\nThis will:\n✅ Remove the worktree from the workspace configuration\n✅ Close any active terminals for this worktree\n✅ Keep all git worktree files and folders intact\n\nℹ️ Your code and git history will NOT be deleted.\nYou can add this worktree back to the workspace later.`,
      'Remove from Workspace',
      'Cancel'
    );

    if (!confirmed) {
      return;
    }

    try {
      console.log(`Removing worktree ${worktreeId} from workspace configuration (keeping folder)...`);

      // Call backend API to remove from workspace configuration only
      // Backend will handle closing sessions and emitting session-closed events
      const response = await fetch('/api/workspaces/remove-worktree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: this.currentWorkspace.id,
          worktreeId: worktreeId
        })
      });

      if (response.ok) {
        const result = await response.json();
        this.showTemporaryMessage(`Removed "${displayName}" from workspace (files preserved)`, 'success');

        // Update local workspace reference with the updated configuration
        if (result.updatedWorkspace) {
          this.currentWorkspace = result.updatedWorkspace;
        }

        // Rebuild sidebar to reflect removal (without clearing terminal content)
        this.buildSidebar();
      } else {
        const error = await response.text();
        this.showError(`Failed to remove worktree: ${error}`);
      }

    } catch (error) {
      console.error('Error removing worktree from workspace:', error);
      this.showError('Failed to remove worktree from workspace');
    }
  }

  /**
   * Close all sessions associated with a worktree
   */
  closeWorktreeSessions(worktreeIdOrKey) {
    // Close sessions for this EXACT worktree key
    const claudeId = `${worktreeIdOrKey}-claude`;
    const serverId = `${worktreeIdOrKey}-server`;

    const sessionsToClose = [];
    if (this.sessions.has(claudeId)) sessionsToClose.push(claudeId);
    if (this.sessions.has(serverId)) sessionsToClose.push(serverId);

    sessionsToClose.forEach(sessionId => {
      console.log(`Closing session: ${sessionId}`);
      this.socket.emit('destroy-session', { sessionId });
    });
  }

  /**
   * Show confirmation dialog
   */
  async showConfirmationDialog(title, message, confirmText = 'OK', cancelText = 'Cancel') {
    return new Promise((resolve) => {
      const existing = document.getElementById('confirmation-dialog');
      if (existing) existing.remove();

      const dialog = document.createElement('div');
      dialog.id = 'confirmation-dialog';
      dialog.className = 'modal';
      dialog.innerHTML = `
        <div class="modal-content confirmation-dialog">
          <div class="modal-header">
            <h3>${title}</h3>
          </div>
          <div class="modal-body">
            <p style="white-space: pre-line; line-height: 1.5;">${message}</p>
          </div>
          <div class="modal-actions">
            <button id="confirm-btn" class="button-danger">${confirmText}</button>
            <button id="cancel-btn" class="button-secondary">${cancelText}</button>
          </div>
        </div>
      `;

      document.body.appendChild(dialog);

      // Handle button clicks
      const confirmBtn = dialog.querySelector('#confirm-btn');
      const cancelBtn = dialog.querySelector('#cancel-btn');

      confirmBtn.onclick = () => {
        dialog.remove();
        resolve(true);
      };

      cancelBtn.onclick = () => {
        dialog.remove();
        resolve(false);
      };

      // ESC key to cancel
      const handleEsc = (e) => {
        if (e.key === 'Escape') {
          dialog.remove();
          document.removeEventListener('keydown', handleEsc);
          resolve(false);
        }
      };
      document.addEventListener('keydown', handleEsc);
    });
  }
  
  updateYoloState(sessionId, checked) {
    // Update button styles to show YOLO is active
    const buttons = [
      document.getElementById(`btn-fresh-${sessionId}`),
      document.getElementById(`btn-continue-${sessionId}`),
      document.getElementById(`btn-resume-${sessionId}`)
    ];
    
    buttons.forEach(btn => {
      if (btn) {
        if (checked) {
          btn.classList.add('yolo-active');
        } else {
          btn.classList.remove('yolo-active');
        }
      }
    });
  }
  
  async startClaudeFromTerminal(sessionId) {
    if (!this.socket || !this.socket.connected) {
      return;
    }
    
    try {
      // Get effective settings for this session
      const response = await fetch(`/api/user-settings/effective/${sessionId}`);
      let effectiveSettings = { claudeFlags: { skipPermissions: false } };
      
      if (response.ok) {
        effectiveSettings = await response.json();
      }
      
      // Get selected options from the inline UI, but use effective settings as fallback
      const mode = document.querySelector(`input[name="claude-mode-${sessionId}"]:checked`)?.value || 'fresh';
      const skipPermissions = document.getElementById(`skip-permissions-${sessionId}`)?.checked ?? effectiveSettings.claudeFlags.skipPermissions;
      
      // Send command to server
      this.socket.emit('start-claude', {
        sessionId: sessionId,
        options: {
          mode: mode,
          skipPermissions: skipPermissions
        }
      });
      
      // Hide the startup UI
      const startupUI = document.getElementById(`startup-ui-${sessionId}`);
      if (startupUI) {
        startupUI.style.display = 'none';
      }
      
      // Enable the start button for future use
      const startBtn = document.getElementById(`claude-start-btn-${sessionId}`);
      if (startBtn) {
        startBtn.disabled = false;
      }
      
    } catch (error) {
      console.error('Error starting Claude from terminal:', error);
    }
  }

  restartClaudeSession(sessionId) {
    console.log(`Restarting Claude session: ${sessionId}`);
    
    if (this.socket && this.socket.connected) {
      this.socket.emit('restart-session', { sessionId });
      
      // Update UI to show restarting
      this.updateSessionStatus(sessionId, 'restarting');
    } else {
      this.showError('Not connected to server');
    }
  }

  // User Settings Methods
  async loadUserSettings() {
    try {
      const response = await fetch('/api/user-settings');
      if (response.ok) {
        this.userSettings = await response.json();
        console.log('User settings loaded:', this.userSettings);
        this.syncUserSettingsUI();
      } else {
        console.error('Failed to load user settings:', response.statusText);
      }
    } catch (error) {
      console.error('Error loading user settings:', error);
    }
  }

  async updateGlobalUserSetting(path, value) {
    try {
      // Ensure userSettings is loaded
      if (!this.userSettings) {
        console.warn('User settings not loaded, attempting to load...');
        await this.loadUserSettings();
        
        if (!this.userSettings) {
          console.error('Failed to load user settings');
          return;
        }
      }
      
      const pathParts = path.split('.');
      const newGlobal = JSON.parse(JSON.stringify(this.userSettings.global));
      
      // Navigate to the correct nested property
      let current = newGlobal;
      for (let i = 0; i < pathParts.length - 1; i++) {
        if (!current[pathParts[i]]) {
          current[pathParts[i]] = {};
        }
        current = current[pathParts[i]];
      }
      current[pathParts[pathParts.length - 1]] = value;

      const response = await fetch('/api/user-settings/global', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ global: newGlobal })
      });

      if (response.ok) {
        const updatedSettings = await response.json();
        this.userSettings = updatedSettings;
        console.log('Global setting updated:', path, '=', value);
      } else {
        console.error('Failed to update global setting:', response.statusText);
      }
    } catch (error) {
      console.error('Error updating global setting:', error);
    }
  }

  async updatePerTerminalSetting(sessionId, setting) {
    try {
      const response = await fetch(`/api/user-settings/terminal/${sessionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(setting)
      });

      if (response.ok) {
        const updatedSettings = await response.json();
        this.userSettings = updatedSettings;
        console.log('Per-terminal setting updated for', sessionId, ':', setting);
      } else {
        console.error('Failed to update per-terminal setting:', response.statusText);
      }
    } catch (error) {
      console.error('Error updating per-terminal setting:', error);
    }
  }

  async clearPerTerminalSetting(sessionId) {
    try {
      const response = await fetch(`/api/user-settings/terminal/${sessionId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        const updatedSettings = await response.json();
        this.userSettings = updatedSettings;
        console.log('Cleared per-terminal settings for', sessionId);
      } else {
        console.error('Failed to clear per-terminal setting:', response.statusText);
      }
    } catch (error) {
      console.error('Error clearing per-terminal setting:', error);
    }
  }

  getEffectiveSettings(sessionId) {
    if (!this.userSettings) return null;

    const global = this.userSettings.global || {};
    const perTerminal = this.userSettings.perTerminal[sessionId] || {};

    // Merge global and per-terminal settings
    return {
      claudeFlags: {
        ...(global.claudeFlags || {}),
        ...(perTerminal.claudeFlags || {})
      },
      autoStart: {
        ...(global.autoStart || {}),
        ...(perTerminal.autoStart || {})
      },
      terminal: {
        ...(global.terminal || {}),
        ...(perTerminal.terminal || {})
      }
    };
  }

  syncUserSettingsUI() {
    if (!this.userSettings) {
      console.warn('Cannot sync user settings UI - settings not loaded');
      return;
    }

    // Update global settings UI
    const globalSkipPermissions = document.getElementById('global-skip-permissions');
    if (globalSkipPermissions) {
      globalSkipPermissions.checked = this.userSettings.global.claudeFlags.skipPermissions;
    }

    const globalZaiProvider = document.getElementById('global-zai-provider');
    if (globalZaiProvider) {
      globalZaiProvider.checked = this.userSettings.global.claudeFlags.provider === 'zai';
    }

    // Update auto-start settings UI
    const globalAutoStart = document.getElementById('global-auto-start');
    const autoStartOptions = document.getElementById('auto-start-options');
    const autoStartMode = document.getElementById('global-auto-start-mode');
    const autoStartDelay = document.getElementById('global-auto-start-delay');

    if (globalAutoStart && this.userSettings.global.autoStart) {
      globalAutoStart.checked = this.userSettings.global.autoStart.enabled || false;
      autoStartOptions.style.display = globalAutoStart.checked ? 'block' : 'none';

      if (autoStartMode) {
        autoStartMode.value = this.userSettings.global.autoStart.mode || 'fresh';
      }
      if (autoStartDelay) {
        autoStartDelay.value = this.userSettings.global.autoStart.delay || 500;
      }
    }

    // Update session recovery settings UI
    const sessionRecoveryEnabled = document.getElementById('session-recovery-enabled');
    const sessionRecoveryOptions = document.getElementById('session-recovery-options');
    const sessionRecoveryMode = document.getElementById('session-recovery-mode');
    const recoveryResumeCwd = document.getElementById('recovery-resume-cwd');
    const recoveryResumeConversation = document.getElementById('recovery-resume-conversation');

    const recoverySettings = this.userSettings.global.sessionRecovery || {};
    if (sessionRecoveryEnabled) {
      sessionRecoveryEnabled.checked = recoverySettings.enabled !== false; // Default to enabled
      if (sessionRecoveryOptions) {
        sessionRecoveryOptions.style.display = sessionRecoveryEnabled.checked ? 'block' : 'none';
      }
    }
    if (sessionRecoveryMode) {
      sessionRecoveryMode.value = recoverySettings.mode || 'ask';
    }
    if (recoveryResumeCwd) {
      recoveryResumeCwd.checked = recoverySettings.resumeCwd !== false;
    }
    if (recoveryResumeConversation) {
      recoveryResumeConversation.checked = recoverySettings.resumeConversation !== false;
    }
    const recoverySkipPermissions = document.getElementById('recovery-skip-permissions');
    if (recoverySkipPermissions) {
      recoverySkipPermissions.checked = recoverySettings.skipPermissions !== false; // Default to true
    }

    // Update per-terminal settings UI
    this.updatePerTerminalSettingsUI();
  }

  updatePerTerminalSettingsUI() {
    const container = document.getElementById('per-terminal-settings');
    if (!container || !this.userSettings) return;

    // Get the container for per-terminal items
    let itemsContainer = container.querySelector('.per-terminal-items');
    if (!itemsContainer) {
      itemsContainer = document.createElement('div');
      itemsContainer.className = 'per-terminal-items';
      container.appendChild(itemsContainer);
    }

    // Clear existing items
    itemsContainer.innerHTML = '';

    // Add items for each Claude session
    for (const [sessionId, session] of this.sessions) {
      if (sessionId.includes('-claude')) {
        const item = this.createPerTerminalSettingItem(sessionId, session);
        itemsContainer.appendChild(item);
      }
    }
  }

  createPerTerminalSettingItem(sessionId, session) {
    const div = document.createElement('div');
    div.className = 'per-terminal-item';

    const hasOverride = this.userSettings.perTerminal[sessionId];

    // Get effective settings (with defaults)
    const effectiveSkipPermissions = hasOverride && hasOverride.claudeFlags
      ? hasOverride.claudeFlags.skipPermissions
      : this.userSettings.global.claudeFlags.skipPermissions;
    const effectiveProvider = hasOverride && hasOverride.claudeFlags && hasOverride.claudeFlags.provider
      ? hasOverride.claudeFlags.provider
      : (this.userSettings.global.claudeFlags.provider || 'anthropic');

    const effectiveAutoStart = {
      enabled: hasOverride && hasOverride.autoStart && hasOverride.autoStart.enabled !== undefined
        ? hasOverride.autoStart.enabled
        : (this.userSettings.global.autoStart ? this.userSettings.global.autoStart.enabled : false),
      mode: hasOverride && hasOverride.autoStart && hasOverride.autoStart.mode
        ? hasOverride.autoStart.mode
        : (this.userSettings.global.autoStart ? this.userSettings.global.autoStart.mode : 'fresh'),
      delay: hasOverride && hasOverride.autoStart && hasOverride.autoStart.delay !== undefined
        ? hasOverride.autoStart.delay
        : (this.userSettings.global.autoStart ? this.userSettings.global.autoStart.delay : 500)
    };

    div.innerHTML = `
      <div class="terminal-name">${sessionId}</div>
      <div class="terminal-controls">
        <div class="terminal-control-row">
          <label>
            <input type="checkbox" class="terminal-skip-permissions"
                   data-session-id="${sessionId}"
                   ${effectiveSkipPermissions ? 'checked' : ''}>
            Skip Permissions
          </label>
          <label style="margin-left: 15px;">
            <input type="checkbox" class="terminal-auto-start"
                   data-session-id="${sessionId}"
                   ${effectiveAutoStart.enabled ? 'checked' : ''}>
            Auto-Start
          </label>
          <label style="margin-left: 15px;">
            <input type="checkbox" class="terminal-use-zai"
                   data-session-id="${sessionId}"
                   ${effectiveProvider === 'zai' ? 'checked' : ''}>
            Use Z.ai
          </label>
          ${hasOverride ? `
            <button class="clear-override-btn" data-session-id="${sessionId}" title="Use global settings">
              ↻
            </button>
          ` : ''}
        </div>
        <div class="terminal-auto-start-options" style="margin-left: 20px; margin-top: 5px; display: ${effectiveAutoStart.enabled ? 'block' : 'none'};">
          <select class="terminal-auto-start-mode" data-session-id="${sessionId}">
            <option value="fresh" ${effectiveAutoStart.mode === 'fresh' ? 'selected' : ''}>Fresh</option>
            <option value="continue" ${effectiveAutoStart.mode === 'continue' ? 'selected' : ''}>Continue</option>
            <option value="resume" ${effectiveAutoStart.mode === 'resume' ? 'selected' : ''}>Resume</option>
          </select>
          <input type="number" class="terminal-auto-start-delay" data-session-id="${sessionId}"
                 value="${effectiveAutoStart.delay}" min="0" max="5000" style="width: 60px; margin-left: 10px;"
                 placeholder="Delay (ms)">
        </div>
      </div>
    `;

    // Add event listeners
    const skipCheckbox = div.querySelector('.terminal-skip-permissions');
    skipCheckbox.addEventListener('change', (e) => {
      const currentOverride = this.userSettings.perTerminal[sessionId] || {};
      const currentFlags = currentOverride.claudeFlags || {};
      this.updatePerTerminalSetting(sessionId, {
        ...currentOverride,
        claudeFlags: { ...currentFlags, skipPermissions: e.target.checked }
      });
    });

    const autoStartCheckbox = div.querySelector('.terminal-auto-start');
    const autoStartOptions = div.querySelector('.terminal-auto-start-options');

    autoStartCheckbox.addEventListener('change', (e) => {
      const currentOverride = this.userSettings.perTerminal[sessionId] || {};
      const currentAutoStart = currentOverride.autoStart || {};

      autoStartOptions.style.display = e.target.checked ? 'block' : 'none';

      this.updatePerTerminalSetting(sessionId, {
        ...currentOverride,
        autoStart: {
          ...currentAutoStart,
          enabled: e.target.checked
        }
      });
    });

    const modeSelect = div.querySelector('.terminal-auto-start-mode');
    modeSelect.addEventListener('change', (e) => {
      const currentOverride = this.userSettings.perTerminal[sessionId] || {};
      const currentAutoStart = currentOverride.autoStart || {};

      this.updatePerTerminalSetting(sessionId, {
        ...currentOverride,
        autoStart: {
          ...currentAutoStart,
          mode: e.target.value
        }
      });
    });

    const delayInput = div.querySelector('.terminal-auto-start-delay');
    delayInput.addEventListener('change', (e) => {
      const delay = parseInt(e.target.value);
      if (!isNaN(delay) && delay >= 0 && delay <= 5000) {
        const currentOverride = this.userSettings.perTerminal[sessionId] || {};
        const currentAutoStart = currentOverride.autoStart || {};

        this.updatePerTerminalSetting(sessionId, {
          ...currentOverride,
          autoStart: {
            ...currentAutoStart,
            delay: delay
          }
        });
      }
    });

    const clearBtn = div.querySelector('.clear-override-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.clearPerTerminalSetting(sessionId);
      });
    }

    const providerCheckbox = div.querySelector('.terminal-use-zai');
    if (providerCheckbox) {
      providerCheckbox.addEventListener('change', (e) => {
        const currentOverride = this.userSettings.perTerminal[sessionId] || {};
        const currentFlags = currentOverride.claudeFlags || {};
        const provider = e.target.checked ? 'zai' : 'anthropic';
        this.updatePerTerminalSetting(sessionId, {
          ...currentOverride,
          claudeFlags: { ...currentFlags, provider }
        });
      });
    }

    return div;
  }

  async resetToDefaults() {
    try {
      if (!confirm('Reset all user settings to repository defaults? This will overwrite all your current settings.')) {
        return;
      }

      const response = await fetch('/api/user-settings/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        const updatedSettings = await response.json();
        this.userSettings = updatedSettings;
        this.syncUserSettingsUI();
        console.log('Reset to defaults successfully');
        
        // Show user feedback
        this.showTemporaryMessage('Settings reset to defaults');
      } else {
        console.error('Failed to reset to defaults:', response.statusText);
        this.showTemporaryMessage('Failed to reset settings', 'error');
      }
    } catch (error) {
      console.error('Error resetting to defaults:', error);
      this.showTemporaryMessage('Error resetting settings', 'error');
    }
  }

  async saveAsDefault() {
    try {
      if (!confirm('Save current settings as the repository default template? This will affect new installations.')) {
        return;
      }

      const response = await fetch('/api/user-settings/save-as-default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        console.log('Saved as default template successfully');
        
        // Show user feedback with commit reminder
        this.showTemporaryMessage('Settings saved as default template. Remember to commit and push the changes to user-settings.default.json!', 'success');
      } else {
        console.error('Failed to save as default:', response.statusText);
        this.showTemporaryMessage('Failed to save as default template', 'error');
      }
    } catch (error) {
      console.error('Error saving as default:', error);
      this.showTemporaryMessage('Error saving as default template', 'error');
    }
  }

  showTemporaryMessage(message, type = 'info') {
    // Create a temporary message element
    const messageEl = document.createElement('div');
    messageEl.className = `temporary-message ${type}`;
    messageEl.textContent = message;
    
    // Style the message
    messageEl.style.cssText = `
      position: fixed;
      top: 80px;
      right: 20px;
      background: ${type === 'error' ? 'var(--accent-danger)' : type === 'success' ? 'var(--accent-success)' : 'var(--accent-primary)'};
      color: white;
      padding: var(--space-md);
      border-radius: var(--radius-md);
      z-index: 10000;
      max-width: 400px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      transform: translateX(100%);
      transition: transform 0.3s ease;
    `;
    
    document.body.appendChild(messageEl);
    
    // Animate in
    setTimeout(() => {
      messageEl.style.transform = 'translateX(0)';
    }, 100);
    
    // Remove after delay
    setTimeout(() => {
      messageEl.style.transform = 'translateX(100%)';
      setTimeout(() => {
        document.body.removeChild(messageEl);
      }, 300);
    }, 5000);
  }

  async openReplayViewer(sessionId) {
    try {
      // Extract worktree ID from sessionId (e.g., "work1-claude" -> "work1")
      const worktreeMatch = sessionId.match(/work(\d+)/);
      if (!worktreeMatch) {
        console.error('Could not extract worktree number from sessionId:', sessionId);
        this.showTemporaryMessage('Invalid session ID for replay viewer', 'error');
        return;
      }
      
      const worktreeNum = worktreeMatch[1];
      
      // Get worktree configuration from server for accurate path
      let worktreeConfig = null;
      try {
        const response = await fetch('/api/worktrees/config');
        if (response.ok) {
          worktreeConfig = await response.json();
        }
      } catch (error) {
        console.warn('Could not get worktree config, using defaults:', error);
      }
      
      // Use server-hosted replay viewer (avoids browser file:// restrictions)
      const replayViewerUrl = `${window.location.origin}/replay-viewer/work${worktreeNum}/`;
      
      console.log(`Opening replay viewer for ${sessionId} at ${replayViewerUrl}`);
      
      // Open in new tab (simpler approach)
      window.open(replayViewerUrl, '_blank');
      
      // Show success message with URL for reference
      this.showTemporaryMessage(`Opening replay viewer for work${worktreeNum}`, 'success');
      console.log(`Replay viewer URL: ${replayViewerUrl}`);
      
    } catch (error) {
      console.error('Error opening replay viewer:', error);
      this.showTemporaryMessage('Failed to open replay viewer', 'error');
    }
  }

  waitForSettingsAndAutoStart(sessionId) {
    // Wait for user settings to be loaded, then auto-start
    const checkAndStart = () => {
      if (this.userSettings) {
        console.log('User settings loaded, auto-starting Claude for:', sessionId);
        setTimeout(() => {
          this.autoStartClaude(sessionId);
        }, 1000);
      } else {
        console.log('Waiting for user settings to load for:', sessionId);
        setTimeout(checkAndStart, 500); // Check again in 500ms
      }
    };
    
    setTimeout(checkAndStart, 1000); // Initial delay for terminal setup
  }

  async checkForSettingsUpdates() {
    try {
      const response = await fetch('/api/user-settings/check-updates');
      if (response.ok) {
        const result = await response.json();
        
        if (result && result.hasUpdates) {
          const notification = document.getElementById('settings-update-notification');
          notification.classList.remove('hidden');
          console.log('Settings updates available:', result);
        }
      }
    } catch (error) {
      console.error('Error checking for settings updates:', error);
    }
  }

  async checkForUpdates() {
    try {
      this.showTemporaryMessage('Checking for updates...', 'info');
      
      const response = await fetch('/api/git/check-updates');
      if (response.ok) {
        const result = await response.json();
        
        if (result.hasUpdates) {
          const notification = document.getElementById('git-update-notification');
          const textElement = document.getElementById('git-notification-text');
          textElement.textContent = `${result.commitsBehind} update${result.commitsBehind > 1 ? 's' : ''} available on ${result.currentBranch}`;
          notification.classList.remove('hidden');
          
          this.showTemporaryMessage(`Found ${result.commitsBehind} update${result.commitsBehind > 1 ? 's' : ''} available`, 'success');
        } else if (result.hasUpdates === false) {
          this.showTemporaryMessage('Repository is up to date', 'success');
        } else {
          this.showTemporaryMessage('Unable to check for updates', 'error');
        }
      } else {
        this.showTemporaryMessage('Failed to check for updates', 'error');
      }
    } catch (error) {
      console.error('Error checking for updates:', error);
      this.showTemporaryMessage('Error checking for updates', 'error');
    }
  }

  async pullLatestChanges() {
    try {
      if (!confirm('Pull the latest changes from the repository? This will update the orchestrator code. Make sure you have no uncommitted changes.')) {
        return;
      }

      this.showTemporaryMessage('Pulling latest changes...', 'info');
      
      const response = await fetch('/api/git/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        const result = await response.json();
        
        if (result.success) {
          // Success message will be handled by socket event
          const notification = document.getElementById('git-update-notification');
          notification.classList.add('hidden');
        } else {
          this.showTemporaryMessage(result.error || 'Failed to pull changes', 'error');
          
          // Show specific error details if available
          if (result.changes && result.changes.length > 0) {
            console.log('Uncommitted changes:', result.changes);
            this.showTemporaryMessage('Please commit or stash your changes first', 'error');
          }
        }
      } else {
        this.showTemporaryMessage('Failed to pull latest changes', 'error');
      }
    } catch (error) {
      console.error('Error pulling latest changes:', error);
      this.showTemporaryMessage('Error pulling latest changes', 'error');
    }
  }

  // Update voice command context with current workspace/worktree info
  updateVoiceContext() {
    if (!this.voiceControl) return;

    // Build list of worktrees with their full identifiers
    const worktrees = [];
    for (const [sessionId, session] of this.sessions) {
      // Extract worktree info from session ID (e.g., "zoo-game-work1-claude" -> "zoo-game/work1")
      const match = sessionId.match(/^(.+?)-(work\d+)-/);
      if (match) {
        const worktreeId = `${match[1]}/${match[2]}`;
        if (!worktrees.includes(worktreeId)) {
          worktrees.push(worktreeId);
        }
      }
    }

    // Build context
    const context = {
      currentWorkspace: this.currentWorkspace?.name || null,
      workspaces: this.availableWorkspaces?.map(w => w.name) || [],
      worktrees: worktrees.sort(),
      // Add branch info if available
      worktreeDetails: Array.from(this.sessions.entries())
        .filter(([id]) => id.includes('-claude'))
        .map(([id, session]) => ({
          id: id.replace(/-claude$/, ''),
          branch: session.branch || 'unknown'
        }))
    };

    this.voiceControl.updateContext(context);
  }

  // Workspace management methods
  showDashboard() {
    console.log('Showing dashboard...');
    this.isDashboardMode = true;

    // Initialize dashboard if not already created
    if (!this.dashboard) {
      this.dashboard = new Dashboard(this);
    }

    // Hide main UI
    const mainContainer = document.querySelector('.main-container');
    const sidebar = document.querySelector('.sidebar');
    if (mainContainer) mainContainer.classList.add('hidden');
    if (sidebar) sidebar.classList.add('hidden');

    // Show dashboard
    this.dashboard.show();
  }

  hideDashboard() {
    console.log('Hiding dashboard...');
    this.isDashboardMode = false;

    if (this.dashboard) {
      this.dashboard.hide();
    }

    // Show main UI
    const mainContainer = document.querySelector('.main-container');
    const sidebar = document.querySelector('.sidebar');
    if (mainContainer) mainContainer.classList.remove('hidden');
    if (sidebar) sidebar.classList.remove('hidden');
  }

  switchToWorkspace(workspaceId) {
    console.log('Switching to workspace:', workspaceId);
    this.socket.emit('switch-workspace', { workspaceId });
  }

  async showPRsPanel() {
    console.log('Opening PRs panel...');

    // Remove existing modal
    const existing = document.getElementById('prs-panel');
    if (existing) existing.remove();

    const serverUrl = window.location.port === '2080'
      ? 'http://localhost:3000'
      : window.location.origin;

    const state = {
      mode: localStorage.getItem('prs-panel-mode') || 'mine', // mine | involved | all
      prsState: localStorage.getItem('prs-panel-state') || 'open', // all | open | merged | closed
      sort: localStorage.getItem('prs-panel-sort') || 'updated', // updated | created
      repo: localStorage.getItem('prs-panel-repo') || '', // comma-separated owner/repo
      owner: localStorage.getItem('prs-panel-owner') || '', // comma-separated owner/org
      query: '',
      limit: 50
    };

    const modal = document.createElement('div');
    modal.id = 'prs-panel';
    modal.className = 'modal prs-modal';
    modal.innerHTML = `
      <div class="modal-content prs-content">
        <div class="modal-header">
          <h2>🔀 Pull Requests</h2>
          <button class="close-btn" onclick="this.closest('.modal').remove()">×</button>
        </div>
        <div class="prs-toolbar">
          <div class="prs-toolbar-group">
            <span class="prs-label">Scope</span>
            <label class="quick-radio">
              <input type="radio" name="prs-mode" value="mine">
              Mine
            </label>
            <label class="quick-radio">
              <input type="radio" name="prs-mode" value="involved">
              Include others
            </label>
            <label class="quick-radio">
              <input type="radio" name="prs-mode" value="all">
              All
            </label>
          </div>
          <div class="prs-toolbar-group">
            <span class="prs-label">State</span>
            <label class="quick-radio">
              <input type="radio" name="prs-state" value="all">
              All
            </label>
            <label class="quick-radio">
              <input type="radio" name="prs-state" value="open">
              Open
            </label>
            <label class="quick-radio">
              <input type="radio" name="prs-state" value="merged">
              Merged
            </label>
            <label class="quick-radio">
              <input type="radio" name="prs-state" value="closed">
              Closed (unmerged)
            </label>
          </div>
          <div class="prs-toolbar-group">
            <span class="prs-label">Sort</span>
            <label class="quick-radio">
              <input type="radio" name="prs-sort" value="updated">
              Updated
            </label>
            <label class="quick-radio">
              <input type="radio" name="prs-sort" value="created">
              Created
            </label>
          </div>
          <input type="text" id="prs-repo" class="search-input prs-input" placeholder="Repo filter (owner/repo[,owner/repo])">
          <input type="text" id="prs-owner" class="search-input prs-input" placeholder="Owner filter (org/user[,org])">
          <input type="text" id="prs-search" class="search-input prs-search" placeholder="Search PRs...">
          <button class="btn-secondary" id="prs-refresh">🔄 Refresh</button>
        </div>
        <div class="prs-list" id="prs-list">
          <div class="loading">Loading PRs...</div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const listEl = modal.querySelector('#prs-list');
    const searchEl = modal.querySelector('#prs-search');
    const repoEl = modal.querySelector('#prs-repo');
    const ownerEl = modal.querySelector('#prs-owner');
    const refreshBtn = modal.querySelector('#prs-refresh');
    const modeInputs = modal.querySelectorAll('input[name="prs-mode"]');
    const stateInputs = modal.querySelectorAll('input[name="prs-state"]');
    const sortInputs = modal.querySelectorAll('input[name="prs-sort"]');

    // Initialize UI state
    modeInputs.forEach(input => { input.checked = input.value === state.mode; });
    stateInputs.forEach(input => { input.checked = input.value === state.prsState; });
    sortInputs.forEach(input => { input.checked = input.value === state.sort; });
    if (repoEl) repoEl.value = state.repo || '';
    if (ownerEl) ownerEl.value = state.owner || '';

    const fetchPRs = async () => {
      listEl.innerHTML = '<div class="loading">Loading PRs...</div>';
      const params = new URLSearchParams({
        mode: state.mode,
        state: state.prsState,
        sort: state.sort,
        limit: String(state.limit)
      });
      if (state.repo) params.set('repo', state.repo);
      if (state.owner) params.set('owner', state.owner);
      if (state.query) params.set('q', state.query);

      try {
        const response = await fetch(`${serverUrl}/api/prs?${params.toString()}`);
        if (!response.ok) throw new Error('Failed to load PRs');
        const data = await response.json();
        const prs = Array.isArray(data.prs) ? data.prs : [];

        if (!prs.length) {
          listEl.innerHTML = '<div class="quick-empty">No PRs found</div>';
          return;
        }

        listEl.innerHTML = prs.map(pr => {
          const repoLabel = pr.repository?.nameWithOwner || pr.repository?.name || 'unknown';
          const stateLabel = (pr.state || 'unknown').toLowerCase();
          const badge =
            stateLabel === 'open' ? '🟢 open' :
            stateLabel === 'merged' ? '✅ merged' :
            stateLabel === 'closed' ? '⚪ closed' :
            stateLabel;

          const draftLabel = pr.isDraft ? '🟡 draft' : '';
          const created = pr.createdAt ? new Date(pr.createdAt).toLocaleString() : '';
          const updated = pr.updatedAt ? new Date(pr.updatedAt).toLocaleString() : '';
          const metaParts = [];
          if (updated) metaParts.push(`Updated ${updated}`);
          if (created) metaParts.push(`Created ${created}`);

          return `
            <div class="pr-row ${stateLabel}">
              <div class="pr-main">
                <div class="pr-title">
                  <span class="pr-repo">${this.escapeHtml(repoLabel)}</span>
                  <span class="pr-number">#${pr.number}</span>
                  <span class="pr-badge">${badge}</span>
                  ${draftLabel ? `<span class="pr-badge draft">${draftLabel}</span>` : ''}
                </div>
                <div class="pr-subtitle">${this.escapeHtml(pr.title || '')}</div>
                <div class="pr-meta">${this.escapeHtml(metaParts.join(' • '))}</div>
              </div>
              <div class="pr-actions">
                <button class="btn-secondary pr-open-btn" data-url="${this.escapeHtml(pr.url)}">↗ Open</button>
                <button class="btn-secondary pr-diff-btn" data-url="${this.escapeHtml(pr.url)}">🔍 Diff</button>
              </div>
            </div>
          `;
        }).join('');
      } catch (error) {
        console.error('Failed to fetch PRs:', error);
        listEl.innerHTML = '<div class="quick-empty">Failed to load PRs</div>';
      }
    };

    const scheduleSearch = (() => {
      let t;
      return () => {
        clearTimeout(t);
        t = setTimeout(() => fetchPRs(), 250);
      };
    })();

    modeInputs.forEach(input => {
      input.addEventListener('change', () => {
        state.mode = input.value;
        localStorage.setItem('prs-panel-mode', state.mode);
        fetchPRs();
      });
    });

    stateInputs.forEach(input => {
      input.addEventListener('change', () => {
        state.prsState = input.value;
        localStorage.setItem('prs-panel-state', state.prsState);
        fetchPRs();
      });
    });

    sortInputs.forEach(input => {
      input.addEventListener('change', () => {
        state.sort = input.value;
        localStorage.setItem('prs-panel-sort', state.sort);
        fetchPRs();
      });
    });

    if (searchEl) {
      searchEl.addEventListener('input', () => {
        state.query = (searchEl.value || '').trim();
        scheduleSearch();
      });
    }

    const scheduleFilter = (() => {
      let t;
      return () => {
        clearTimeout(t);
        t = setTimeout(() => fetchPRs(), 250);
      };
    })();

    if (repoEl) {
      repoEl.addEventListener('input', () => {
        state.repo = (repoEl.value || '').trim();
        localStorage.setItem('prs-panel-repo', state.repo);
        scheduleFilter();
      });
    }

    if (ownerEl) {
      ownerEl.addEventListener('input', () => {
        state.owner = (ownerEl.value || '').trim();
        localStorage.setItem('prs-panel-owner', state.owner);
        scheduleFilter();
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => fetchPRs());
    }

    listEl.addEventListener('click', (e) => {
      const openBtn = e.target.closest('.pr-open-btn');
      const diffBtn = e.target.closest('.pr-diff-btn');
      const btn = openBtn || diffBtn;
      if (!btn) return;

      const url = btn.dataset.url;
      if (!url) return;

      try {
        new URL(url);
      } catch (error) {
        this.showToast('Invalid PR URL', 'error');
        return;
      }

      if (diffBtn) {
        this.launchDiffViewer(url);
        return;
      }

      window.open(url, '_blank');
    });

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    await fetchPRs();
  }

  async showPortsPanel() {
    console.log('Opening Ports panel...');

    // Remove existing modal
    const existing = document.getElementById('ports-panel');
    if (existing) existing.remove();

    // Fetch ports
    const serverUrl = window.location.port === '2080' ? 'http://localhost:3000' :
                      window.location.port === '2081' ? 'http://localhost:4000' :
                      window.location.origin;

    let portsData = { ports: [], count: 0 };
    try {
      const response = await fetch(`${serverUrl}/api/ports/scan`);
      if (response.ok) {
        portsData = await response.json();
      }
    } catch (error) {
      console.error('Failed to fetch ports:', error);
    }

    const modal = document.createElement('div');
    modal.id = 'ports-panel';
    modal.className = 'modal ports-modal';
    modal.innerHTML = `
      <div class="modal-content ports-content">
        <div class="ports-header">
          <h2>🔌 Running Services</h2>
          <button class="close-btn" onclick="this.closest('.modal').remove()">×</button>
        </div>
        <div class="ports-info">
          ${portsData.count} service${portsData.count !== 1 ? 's' : ''} running • Click name to edit label • Use 📋 to copy
        </div>
        <div class="ports-list">
          ${portsData.ports.length === 0 ? '<div class="no-ports">No services detected</div>' :
            portsData.ports.map(p => `
              <div class="port-item ${p.type}" data-port="${p.port}">
                <div class="port-card-header">
                  <div class="port-main">
                    <span class="port-icon">${p.icon || '❓'}</span>
                    <div class="port-details">
                      <span class="port-name ${p.customLabel ? 'custom-label' : ''}"
                            onclick="window.orchestrator.editPortLabel(${p.port}, '${(p.name || '').replace(/'/g, "\\'")}', this)"
                            title="Click to edit label">
                        ${p.name}${p.customLabel ? ' ✏️' : ''}
                      </span>
                      <span class="port-context">
                        ${p.project?.project ? `<span class="port-project">${p.project.project}</span>` : ''}
                        ${p.project?.worktree ? `<span class="port-worktree">${p.project.worktree}</span>` : ''}
                        ${p.project?.subPath ? `<span class="port-subpath">/${p.project.subPath}</span>` : ''}
                      </span>
                    </div>
                  </div>

                  <div class="port-actions">
                    <button class="port-action-btn" data-action="open" data-url="${p.url}" title="Open in browser">↗</button>
                    <button class="port-action-btn" data-action="copy" data-copy="${p.url}" title="Copy URL">📋 URL</button>
                    <button class="port-action-btn port-action-port" data-action="copy" data-copy="${p.port}" title="Copy Port">:${p.port}</button>
                  </div>
                </div>
                <div class="port-process" title="${p.cwd || ''}">${p.processName || ''} • PID ${p.pid || '?'}</div>
              </div>
            `).join('')}
        </div>
        <div class="ports-footer">
          <button class="btn-secondary" onclick="window.orchestrator.showPortsPanel()">
            🔄 Refresh
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
      const actionBtn = e.target.closest('.port-action-btn');
      if (actionBtn) {
        e.preventDefault();
        e.stopPropagation();

        const action = actionBtn.dataset.action;
        if (action === 'open') {
          try {
            const url = actionBtn.dataset.url;
            new URL(url);
            window.open(url, '_blank');
          } catch (error) {
            console.error('Invalid URL for port open action:', error);
            this.showToast('Invalid URL', 'error');
          }
          return;
        }

        if (action === 'copy') {
          const textToCopy = actionBtn.dataset.copy;
          if (!textToCopy) return;

          navigator.clipboard.writeText(textToCopy).then(() => {
            const label = actionBtn.classList.contains('port-action-port')
              ? `:${textToCopy}`
              : textToCopy;
            this.showToast(`Copied ${label}`, 'success');
          }).catch((error) => {
            console.error('Failed to copy to clipboard:', error);
            this.showToast('Copy failed', 'error');
          });
          return;
        }
      }

      // Close on backdrop click
      if (e.target === modal) modal.remove();
    });
  }

  async editPortLabel(port, currentName, element) {
    const newLabel = prompt(`Enter custom label for port ${port}:`, currentName);
    if (newLabel === null) return; // Cancelled

    const serverUrl = window.location.port === '2080' ? 'http://localhost:3000' :
                      window.location.port === '2081' ? 'http://localhost:4000' :
                      window.location.origin;

    try {
      const response = await fetch(`${serverUrl}/api/ports/label`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port, label: newLabel || null })
      });

      if (response.ok) {
        // Refresh the panel and sidebar
        this.showPortsPanel();
        this.refreshSidebarPorts();
      } else {
        alert('Failed to save label');
      }
    } catch (error) {
      console.error('Failed to save port label:', error);
      alert('Failed to save label: ' + error.message);
    }
  }

  async refreshSidebarPorts() {
    const serverUrl = window.location.port === '2080' ? 'http://localhost:3000' :
                      window.location.port === '2081' ? 'http://localhost:4000' :
                      window.location.origin;

    const listEl = document.getElementById('ports-sidebar-list');
    const countEl = document.getElementById('ports-count');
    if (!listEl) return;

    try {
      const response = await fetch(`${serverUrl}/api/ports/scan`);
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();

      countEl.textContent = data.count || 0;

      if (!data.ports || data.ports.length === 0) {
        listEl.innerHTML = '<div class="ports-sidebar-empty">No services running</div>';
        return;
      }

      listEl.innerHTML = data.ports.map(p => {
        const context = p.project?.project
          ? `${p.project.project}${p.project.worktree ? ' • ' + p.project.worktree : ''}`
          : (p.cwd ? p.cwd.split('/').slice(-2).join('/') : '');

        return `
          <div class="port-sidebar-item ${p.type || ''}"
               onclick="window.open('${p.url}', '_blank')"
               title="${p.cwd || p.name}">
            <span class="port-sidebar-icon">${p.icon || '❓'}</span>
            <div class="port-sidebar-info">
              <span class="port-sidebar-name">${p.name}</span>
              <span class="port-sidebar-context">${context}</span>
            </div>
            <span class="port-sidebar-port">:${p.port}</span>
          </div>
        `;
      }).join('');

    } catch (error) {
      console.error('Failed to refresh sidebar ports:', error);
      listEl.innerHTML = '<div class="ports-sidebar-empty">Failed to load</div>';
    }
  }

  async showAddWorktreeModal() {
    console.log('Opening Add Worktree modal...');

    this.showQuickWorktreeModal();
  }

  showSimpleAddWorktreeModal() {
    if (!this.currentWorkspace) return;
    const currentRepo = this.currentWorkspace.repository;
    const nextNumber = (this.currentWorkspace.terminals?.pairs || 1) + 1;
    if (confirm(`Create work${nextNumber} worktree from ${currentRepo.masterBranch} branch?`)) {
      this.createWorktree(currentRepo.path, nextNumber);
    }
  }

  showAdvancedAddWorktreeModal(allRepos) {
    const existing = document.getElementById('add-worktree-modal');
    if (existing) existing.remove();

    const categories = {};
    allRepos.forEach(repo => {
      if (!categories[repo.category]) categories[repo.category] = [];
      categories[repo.category].push(repo);
    });

    const modal = document.createElement('div');
    modal.id = 'add-worktree-modal';
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content worktree-modal">
        <div class="modal-header">
          <h3>Add Worktree to "${this.currentWorkspace.name}"</h3>
          <button class="close-btn" onclick="this.closest('.modal').remove()">✕</button>
        </div>
        <div class="worktree-modal-toolbar">
          <input type="text" id="worktree-search" placeholder="🔍 Search repositories..." class="search-input">
          <div class="filter-buttons">
            <button class="filter-btn active" data-filter="all">All</button>
            <button class="filter-btn" data-filter="available">Available Only</button>
            <button class="filter-btn" data-filter="hytopia">Hytopia Games</button>
            <button class="filter-btn" data-filter="monogame">MonoGame</button>
          </div>
        </div>
        <div class="modal-body worktree-modal-body">
          ${Object.entries(categories).map(([category, repos]) => `
            <div class="repo-category" data-category="${category.toLowerCase().replace(/\s+/g, '-')}">
              <div class="category-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <span class="category-toggle">▼</span>
                <h4>${category} <span class="repo-count">(${repos.length})</span></h4>
              </div>
              <div class="category-content">
                ${repos.map(repo => this.renderRepoWorktreeOptions(repo)).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    this.setupWorktreeModalInteractions();
  }

  async showQuickWorktreeModal() {
    const existing = document.getElementById('quick-worktree-modal');
    if (existing) existing.remove();
    this.quickWorktreeConversationsLoaded = false;
    this.quickWorktreeConversationLimit = this.quickWorktreeConversationLimit || 100;
    this.quickWorktreeSearchTerm = this.quickWorktreeSearchTerm || '';
    this.quickWorktreeSortMode = localStorage.getItem('quick-worktree-sort') || 'edited';
    this.quickWorktreeRecencyFilter = localStorage.getItem('quick-worktree-recency') || 'all';
    this.quickWorktreeFavoritesOnly = localStorage.getItem('quick-worktree-favorites-only') === 'true';
    if (!this.quickWorktreeFavorites) {
      try {
        const stored = JSON.parse(localStorage.getItem('quick-worktree-favorites') || '[]');
        this.quickWorktreeFavorites = new Set(Array.isArray(stored) ? stored : []);
      } catch (e) {
        this.quickWorktreeFavorites = new Set();
      }
    }

    const modal = document.createElement('div');
    modal.id = 'quick-worktree-modal';
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content quick-worktree-modal">
        <div class="modal-header">
          <div class="quick-worktree-title">
            <h3>Quick Work</h3>
            <div class="quick-worktree-tabs">
              <button class="quick-tab-btn active" data-tab="start">Start work</button>
              <button class="quick-tab-btn" data-tab="resume">Resume</button>
            </div>
          </div>
          <button class="close-btn" onclick="this.closest('.modal').remove()">✕</button>
        </div>
        <div class="quick-worktree-toolbar">
          <input type="text" id="quick-worktree-search" placeholder="Search repos..." class="search-input">
          <button class="btn-secondary quick-advanced-btn">Advanced</button>
        </div>
        <div class="modal-body quick-worktree-body">
          <div class="quick-tab-panel active" data-tab="start">
            <div class="quick-repo-controls">
              <div class="quick-control-group">
                <span class="quick-control-label">Sort</span>
                <label class="quick-radio">
                  <input type="radio" name="quick-sort" value="edited">
                  Edited
                </label>
                <label class="quick-radio">
                  <input type="radio" name="quick-sort" value="created">
                  Created
                </label>
              </div>
              <div class="quick-control-group">
                <span class="quick-control-label">Edited within</span>
                <label class="quick-radio">
                  <input type="radio" name="quick-recency" value="all">
                  All
                </label>
                <label class="quick-radio">
                  <input type="radio" name="quick-recency" value="7d">
                  7d
                </label>
                <label class="quick-radio">
                  <input type="radio" name="quick-recency" value="1m">
                  1m
                </label>
                <label class="quick-radio">
                  <input type="radio" name="quick-recency" value="2m">
                  2m
                </label>
                <label class="quick-radio">
                  <input type="radio" name="quick-recency" value="3m">
                  3m
                </label>
                <label class="quick-radio">
                  <input type="radio" name="quick-recency" value="6m">
                  6m
                </label>
                <label class="quick-radio">
                  <input type="radio" name="quick-recency" value="1y">
                  1y
                </label>
              </div>
              <div class="quick-control-group">
                <label class="quick-checkbox">
                  <input type="checkbox" id="quick-favorites-only">
                  Favorites only
                </label>
              </div>
            </div>
            <div id="quick-repo-list" class="quick-repo-list">
              <div class="loading">Loading repos...</div>
            </div>
          </div>
          <div class="quick-tab-panel" data-tab="resume">
            <div class="quick-conv-toolbar">
              <div class="quick-conv-controls">
                <button class="btn-secondary quick-conv-more-btn">Load more</button>
                <button class="btn-secondary quick-conv-history-btn">Open history</button>
              </div>
              <div class="quick-conv-count" id="quick-conv-count"></div>
            </div>
            <div id="quick-conv-list" class="quick-conv-list">
              <div class="loading">Loading recent conversations...</div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const searchInput = modal.querySelector('#quick-worktree-search');
    const advancedBtn = modal.querySelector('.quick-advanced-btn');
    const tabButtons = modal.querySelectorAll('.quick-tab-btn');
    const convMoreBtn = modal.querySelector('.quick-conv-more-btn');
    const convHistoryBtn = modal.querySelector('.quick-conv-history-btn');

    // Initialize quick work controls (sort/recency)
    modal.querySelectorAll('input[name="quick-sort"]').forEach(input => {
      input.checked = input.value === this.quickWorktreeSortMode;
    });
    modal.querySelectorAll('input[name="quick-recency"]').forEach(input => {
      input.checked = input.value === this.quickWorktreeRecencyFilter;
    });
    const favoritesOnlyCheckbox = modal.querySelector('#quick-favorites-only');
    if (favoritesOnlyCheckbox) {
      favoritesOnlyCheckbox.checked = !!this.quickWorktreeFavoritesOnly;
    }

    modal.addEventListener('change', (e) => {
      const sortInput = e.target.closest('input[name="quick-sort"]');
      if (sortInput) {
        this.quickWorktreeSortMode = sortInput.value;
        localStorage.setItem('quick-worktree-sort', this.quickWorktreeSortMode);
        this.renderQuickWorktreeRepoList();
        return;
      }

      const recencyInput = e.target.closest('input[name="quick-recency"]');
      if (recencyInput) {
        this.quickWorktreeRecencyFilter = recencyInput.value;
        localStorage.setItem('quick-worktree-recency', this.quickWorktreeRecencyFilter);
        this.renderQuickWorktreeRepoList();
        return;
      }

      if (e.target && e.target.id === 'quick-favorites-only') {
        this.quickWorktreeFavoritesOnly = !!e.target.checked;
        localStorage.setItem('quick-worktree-favorites-only', this.quickWorktreeFavoritesOnly ? 'true' : 'false');
        this.renderQuickWorktreeRepoList();
        return;
      }
    });

    if (advancedBtn) {
      advancedBtn.addEventListener('click', () => {
        modal.remove();
        this.showAddWorktreeModalAdvanced();
      });
    }

    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        tabButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        modal.querySelectorAll('.quick-tab-panel').forEach(panel => {
          panel.classList.toggle('active', panel.dataset.tab === tab);
        });

        if (tab === 'resume' && !this.quickWorktreeConversationsLoaded) {
          this.loadQuickWorktreeConversations();
        }
      });
    });

    if (convMoreBtn) {
      convMoreBtn.addEventListener('click', () => {
        this.quickWorktreeConversationLimit = (this.quickWorktreeConversationLimit || 100) + 100;
        this.loadQuickWorktreeConversations({ force: true });
      });
    }

    if (convHistoryBtn) {
      convHistoryBtn.addEventListener('click', () => {
        if (this.conversationBrowser) {
          modal.remove();
          this.conversationBrowser.show();
        } else {
          this.showTemporaryMessage('Conversation history not available', 'error');
        }
      });
    }

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase().trim();
        this.quickWorktreeSearchTerm = term;
        const activeTab = modal.querySelector('.quick-tab-panel.active')?.dataset.tab;
        if (activeTab === 'resume') {
          modal.querySelectorAll('.quick-conv-row').forEach(row => {
            const title = row.dataset.convTitle || '';
            const repo = row.dataset.convRepo || '';
            const path = row.dataset.convPath || '';
            const matches = title.includes(term) || repo.includes(term) || path.includes(term);
            row.style.display = matches ? 'flex' : 'none';
          });
        } else {
          this.applyQuickRepoSearchFilter(modal, term);
        }
      });
    }

    this.loadQuickWorktreeRepos();
  }

  applyQuickRepoSearchFilter(modal, term) {
    modal.querySelectorAll('.quick-repo-row').forEach(row => {
      const name = row.dataset.repoName || '';
      const path = row.dataset.repoPath || '';
      const matches = name.includes(term) || path.includes(term);
      row.style.display = matches ? 'flex' : 'none';
    });

    // Hide empty groups/subgroups after filtering
    modal.querySelectorAll('.quick-repo-subcategory').forEach(sub => {
      const anyVisible = Array.from(sub.querySelectorAll('.quick-repo-row'))
        .some(row => row.style.display !== 'none');
      sub.style.display = anyVisible ? '' : 'none';
    });

    modal.querySelectorAll('.quick-repo-category').forEach(cat => {
      const anyVisible = Array.from(cat.querySelectorAll('.quick-repo-row'))
        .some(row => row.style.display !== 'none');
      cat.style.display = anyVisible ? '' : 'none';
    });
  }

  async showAddWorktreeModalAdvanced() {
    try {
      const serverUrl = window.location.port === '2080' ? 'http://localhost:3000' : window.location.origin;
      const response = await fetch(`${serverUrl}/api/workspaces/scan-repos`);
      const allRepos = await response.json();
      this.showAdvancedAddWorktreeModal(allRepos);
    } catch (error) {
      console.error('Failed to fetch repositories:', error);
      this.showSimpleAddWorktreeModal();
    }
  }

  async loadQuickWorktreeRepos() {
    const listEl = document.getElementById('quick-repo-list');
    if (!listEl) return;

    try {
      const serverUrl = window.location.port === '2080' ? 'http://localhost:3000' : window.location.origin;
      const response = await fetch(`${serverUrl}/api/workspaces/scan-repos`);
      const repos = await response.json();

      this.quickWorktreeReposRaw = repos
        .map(repo => {
          const sessionActivity = this.getRepoLastActivity(repo);
          const lastModifiedMs = Math.max(repo.lastModifiedMs || 0, sessionActivity || 0);
          return {
            ...repo,
            lastModifiedMs
          };
        })
        .sort((a, b) => b.lastModifiedMs - a.lastModifiedMs);

      if (!this.quickWorktreeReposRaw.length) {
        listEl.innerHTML = '<div class="quick-empty">No repos found</div>';
        return;
      }

      this.renderQuickWorktreeRepoList();

      // Apply any existing search term
      const modal = document.getElementById('quick-worktree-modal');
      if (modal && this.quickWorktreeSearchTerm) {
        this.applyQuickRepoSearchFilter(modal, this.quickWorktreeSearchTerm);
      }
    } catch (error) {
      console.error('Failed to load repositories:', error);
      listEl.innerHTML = '<div class="quick-empty">Failed to load repos</div>';
    }
  }

  renderQuickWorktreeRepoList() {
    const listEl = document.getElementById('quick-repo-list');
    const modal = document.getElementById('quick-worktree-modal');
    if (!listEl) return;
    this.closeQuickWorktreeMenu();

    const repos = Array.isArray(this.quickWorktreeReposRaw) ? [...this.quickWorktreeReposRaw] : [];
    const now = Date.now();

    const recencyMs = {
      all: 0,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '1m': 30 * 24 * 60 * 60 * 1000,
      '2m': 60 * 24 * 60 * 60 * 1000,
      '3m': 90 * 24 * 60 * 60 * 1000,
      '6m': 180 * 24 * 60 * 60 * 1000,
      '1y': 365 * 24 * 60 * 60 * 1000
    };

    const threshold = recencyMs[this.quickWorktreeRecencyFilter] || 0;
    const filtered = threshold
      ? repos.filter(r => (r.lastModifiedMs || 0) >= (now - threshold))
      : repos;

    const favoritesSet = this.quickWorktreeFavorites || new Set();
    const filteredFavorites = this.quickWorktreeFavoritesOnly
      ? filtered.filter(r => favoritesSet.has(r.path))
      : filtered;

    const sorted = filteredFavorites.sort((a, b) => {
      if (this.quickWorktreeSortMode === 'created') {
        const aCreated = a.createdMs || 0;
        const bCreated = b.createdMs || 0;
        return bCreated - aCreated;
      }
      return (b.lastModifiedMs || 0) - (a.lastModifiedMs || 0);
    });

    listEl.innerHTML = this.renderQuickRepoList(sorted);

    // Re-apply search filter (if any)
    if (modal && this.quickWorktreeSearchTerm) {
      this.applyQuickRepoSearchFilter(modal, this.quickWorktreeSearchTerm);
    }

    // Delegate start button clicks (re-render safe)
    listEl.onclick = (event) => {
      const favBtn = event.target.closest('.quick-fav-btn');
      if (favBtn) {
        event.preventDefault();
        event.stopPropagation();
        const repoPath = favBtn.dataset.repoPath;
        if (repoPath) {
          this.toggleQuickWorktreeFavorite(repoPath);
          this.renderQuickWorktreeRepoList();
        }
        return;
      }

      const menuBtn = event.target.closest('.quick-start-menu-btn');
      if (menuBtn) {
        event.preventDefault();
        event.stopPropagation();
        this.showQuickWorktreeMenu(menuBtn);
        return;
      }

      const btn = event.target.closest('.quick-start-btn');
      if (!btn) return;

      const repoPath = btn.dataset.repoPath;
      const repoType = btn.dataset.repoType;
      const repoName = btn.dataset.repoName;
      const worktreeId = btn.dataset.worktreeId;
      const worktreePath = btn.dataset.worktreePath;
      const repositoryRoot = btn.dataset.repoRoot || repoPath;
      const keepOpen = event && (event.ctrlKey || event.metaKey);

      if (!worktreeId || !worktreePath) {
        this.showTemporaryMessage('No available worktrees for this repo', 'error');
        return;
      }

      this.quickStartWorktree({
        repoPath,
        repoType,
        repoName,
        worktreeId,
        worktreePath,
        repositoryRoot,
        keepOpen
      });
    };
  }

  toggleQuickWorktreeFavorite(repoPath) {
    if (!repoPath) return;
    if (!this.quickWorktreeFavorites) this.quickWorktreeFavorites = new Set();

    if (this.quickWorktreeFavorites.has(repoPath)) {
      this.quickWorktreeFavorites.delete(repoPath);
    } else {
      this.quickWorktreeFavorites.add(repoPath);
    }

    localStorage.setItem('quick-worktree-favorites', JSON.stringify(Array.from(this.quickWorktreeFavorites)));
  }

  closeQuickWorktreeMenu() {
    if (this.quickWorktreeMenuCleanup) {
      this.quickWorktreeMenuCleanup();
      this.quickWorktreeMenuCleanup = null;
    }
    if (this.quickWorktreeMenuEl) {
      this.quickWorktreeMenuEl.remove();
      this.quickWorktreeMenuEl = null;
    }
  }

  showQuickWorktreeMenu(anchorButton) {
    this.closeQuickWorktreeMenu();
    if (!anchorButton) return;

    const repoPath = anchorButton.dataset.repoPath;
    const repoType = anchorButton.dataset.repoType;
    const repoName = anchorButton.dataset.repoName;
    const repositoryRoot = anchorButton.dataset.repoRoot || repoPath;

    const repo = Array.isArray(this.quickWorktreeReposRaw)
      ? this.quickWorktreeReposRaw.find(r => r.path === repoPath)
      : null;

    const resolvedRepo = repo || { path: repoPath, type: repoType, name: repoName, worktreeDirs: [] };

    const oldest = this.getRecommendedWorktree(resolvedRepo);
    const recent = this.getMostRecentWorktree(resolvedRepo);

    const allWorktrees = (() => {
      const entries = Array.isArray(resolvedRepo.worktreeDirs) ? resolvedRepo.worktreeDirs : [];
      if (!entries.length) {
        return [{ id: 'root', path: repoPath, number: 0 }];
      }
      return entries
        .map(e => ({
          id: e.id,
          path: e.path || `${repoPath}/${e.id}`,
          number: e.number || parseInt((e.id || '').replace('work', ''), 10) || 0
        }))
        .sort((a, b) => (a.number || 0) - (b.number || 0));
    })();

    const menu = document.createElement('div');
    menu.className = 'quick-worktree-menu';
    menu.innerHTML = `
      <div class="quick-menu-section">
        ${oldest ? `
          <button class="quick-menu-item"
                  data-repo-path="${this.escapeHtml(repoPath)}"
                  data-repo-type="${this.escapeHtml(repoType)}"
                  data-repo-name="${this.escapeHtml(repoName)}"
                  data-repo-root="${this.escapeHtml(repositoryRoot)}"
                  data-worktree-id="${this.escapeHtml(oldest.id)}"
                  data-worktree-path="${this.escapeHtml(oldest.path)}">
            🕰️ Start oldest (${this.escapeHtml(oldest.id)})
          </button>
        ` : ''}
        ${recent && (!oldest || recent.id !== oldest.id) ? `
          <button class="quick-menu-item"
                  data-repo-path="${this.escapeHtml(repoPath)}"
                  data-repo-type="${this.escapeHtml(repoType)}"
                  data-repo-name="${this.escapeHtml(repoName)}"
                  data-repo-root="${this.escapeHtml(repositoryRoot)}"
                  data-worktree-id="${this.escapeHtml(recent.id)}"
                  data-worktree-path="${this.escapeHtml(recent.path)}">
            🆕 Start most recent (${this.escapeHtml(recent.id)})
          </button>
        ` : ''}
      </div>

      <div class="quick-menu-divider"></div>

      <div class="quick-menu-section">
        ${allWorktrees.map(entry => {
          const inUse = this.isWorktreeInUse(repoPath, entry.id, repoName);
          const disabled = inUse ? 'disabled' : '';
          const statusLabel = inUse ? ' • in use' : '';
          return `
            <button class="quick-menu-item"
                    ${disabled}
                    data-repo-path="${this.escapeHtml(repoPath)}"
                    data-repo-type="${this.escapeHtml(repoType)}"
                    data-repo-name="${this.escapeHtml(repoName)}"
                    data-repo-root="${this.escapeHtml(repositoryRoot)}"
                    data-worktree-id="${this.escapeHtml(entry.id)}"
                    data-worktree-path="${this.escapeHtml(entry.path)}">
              ${this.escapeHtml(entry.id)}${statusLabel}
            </button>
          `;
        }).join('')}
      </div>
    `;

    document.body.appendChild(menu);
    this.quickWorktreeMenuEl = menu;

    const rect = anchorButton.getBoundingClientRect();
    const menuWidth = 280;
    const left = Math.min(window.innerWidth - menuWidth - 12, Math.max(12, rect.left));
    const top = Math.min(window.innerHeight - 12, rect.bottom + 6);

    menu.style.position = 'fixed';
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.minWidth = `${menuWidth}px`;
    menu.style.zIndex = '1100';

    const onMenuClick = (e) => {
      const item = e.target.closest('.quick-menu-item');
      if (!item || item.disabled) return;
      const keepOpen = e.ctrlKey || e.metaKey;

      const worktreeId = item.dataset.worktreeId;
      const worktreePath = item.dataset.worktreePath;
      if (!worktreeId || !worktreePath) return;

      this.quickStartWorktree({
        repoPath: item.dataset.repoPath,
        repoType: item.dataset.repoType,
        repoName: item.dataset.repoName,
        worktreeId,
        worktreePath,
        repositoryRoot: item.dataset.repoRoot || item.dataset.repoPath,
        keepOpen
      });

      this.closeQuickWorktreeMenu();
    };

    menu.addEventListener('click', onMenuClick);

    // Enrich menu items with branch + PR state (best-effort, async)
    this.enrichQuickWorktreeMenuWithMetadata(menu).catch(() => {});

    const onDocMouseDown = (e) => {
      if (menu.contains(e.target) || e.target === anchorButton) return;
      this.closeQuickWorktreeMenu();
    };

    const onDocKeyDown = (e) => {
      if (e.key === 'Escape') this.closeQuickWorktreeMenu();
    };

    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onDocKeyDown);

    this.quickWorktreeMenuCleanup = () => {
      menu.removeEventListener('click', onMenuClick);
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onDocKeyDown);
    };
  }

  async enrichQuickWorktreeMenuWithMetadata(menuEl) {
    if (!menuEl) return;

    const items = Array.from(menuEl.querySelectorAll('.quick-menu-item'))
      .filter(btn => !!btn.dataset.worktreePath);

    const paths = Array.from(new Set(items.map(btn => btn.dataset.worktreePath).filter(Boolean)));
    if (!paths.length) return;

    const serverUrl = window.location.port === '2080'
      ? 'http://localhost:3000'
      : window.location.origin;

    const response = await fetch(`${serverUrl}/api/worktree-metadata/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths })
    });

    if (!response.ok) return;

    const data = await response.json();
    items.forEach(btn => {
      const meta = data[btn.dataset.worktreePath];
      if (!meta) return;

      const branch = meta.git?.branch || 'unknown';
      const pr = meta.pr || {};

      let prLabel = '';
      let prClass = '';
      if (pr.hasPR && pr.number) {
        if (pr.state === 'merged') {
          prLabel = `✅ merged #${pr.number}`;
          prClass = 'pr-merged';
        } else if (pr.state === 'open') {
          prLabel = pr.isDraft ? `🟡 draft #${pr.number}` : `🟢 PR #${pr.number}`;
          prClass = pr.isDraft ? 'pr-draft' : 'pr-open';
        } else if (pr.state === 'closed') {
          prLabel = `⚪ closed #${pr.number}`;
          prClass = 'pr-closed';
        } else {
          prLabel = `#${pr.number}`;
          prClass = 'pr-unknown';
        }
      }

      const id = btn.dataset.worktreeId || '';
      const suffix = prLabel ? ` • ${prLabel}` : '';

      // Keep the special "Start ..." labels intact, but append metadata.
      if (btn.textContent.includes('Start oldest') || btn.textContent.includes('Start most recent')) {
        btn.textContent = `${btn.textContent.split(' • ')[0]} • ${branch}${suffix}`;
      } else {
        btn.textContent = `${id} • ${branch}${suffix}`;
      }

      if (prClass) {
        btn.classList.remove('pr-open', 'pr-draft', 'pr-merged', 'pr-closed', 'pr-unknown');
        btn.classList.add(prClass);
      }
    });
  }

  renderQuickRepoList(repos) {
    const favoritesSet = this.quickWorktreeFavorites || new Set();
    const favorites = repos.filter(r => favoritesSet.has(r.path));
    const nonFavorites = repos.filter(r => !favoritesSet.has(r.path));

    const splitSegments = (relativePath) => {
      if (!relativePath) return [];
      return relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
    };

    const titleCase = (value) => {
      if (!value) return '';
      return value
        .split(/[-_ ]+/g)
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
    };

    const topLabelFor = (top) => {
      const key = (top || '').toLowerCase();
      if (!key) return 'Ungrouped';
      if (key === 'website' || key === 'websites' || key === 'web') return 'Websites';
      if (key === 'game' || key === 'games') return 'Games';
      if (key === 'board-games' || key === 'boardgames') return 'Board Games';
      if (key === 'tools' || key === 'tool') return 'Tools';
      if (key === 'writing') return 'Writing';
      if (key === 'automation') return 'Automation';
      if (key === 'docs' || key === 'documentation') return 'Docs';
      return titleCase(top);
    };

    // Compute which second-level folders are real "groups" (appear more than once within a top category).
    const secondLevelCounts = new Map(); // topKey -> Map(secondKey -> count)
    nonFavorites.forEach(repo => {
      const segments = splitSegments(repo.relativePath || '');
      const topKey = (segments[0] || 'ungrouped').toLowerCase();
      const secondKey = (segments[1] || '').toLowerCase();
      if (!secondKey) return;
      if (!secondLevelCounts.has(topKey)) secondLevelCounts.set(topKey, new Map());
      const map = secondLevelCounts.get(topKey);
      map.set(secondKey, (map.get(secondKey) || 0) + 1);
    });

    const groups = new Map(); // topLabel -> Map(subLabel -> repos[])

    nonFavorites.forEach(repo => {
      const segments = splitSegments(repo.relativePath || '');
      const topKey = (segments[0] || 'ungrouped').toLowerCase();
      const topLabel = topLabelFor(segments[0]);

      const secondKey = (segments[1] || '').toLowerCase();
      const secondCount = secondKey ? (secondLevelCounts.get(topKey)?.get(secondKey) || 0) : 0;
      const subLabel = secondKey && secondCount >= 2 ? titleCase(segments[1]) : 'Ungrouped';

      if (!groups.has(topLabel)) groups.set(topLabel, new Map());
      const subgroups = groups.get(topLabel);
      if (!subgroups.has(subLabel)) subgroups.set(subLabel, []);
      subgroups.get(subLabel).push(repo);
    });

    const orderTop = ['Games', 'Websites', 'Tools', 'Writing', 'Automation', 'Docs', 'Other', 'Ungrouped'];
    const topEntries = Array.from(groups.entries()).sort((a, b) => {
      const ai = orderTop.indexOf(a[0]);
      const bi = orderTop.indexOf(b[0]);
      if (ai !== -1 || bi !== -1) {
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      }
      return a[0].localeCompare(b[0]);
    });

    const favoritesHtml = favorites.length
      ? `
        <div class="quick-repo-category" data-category="favorites">
          <div class="quick-repo-category-header">⭐ Favorites</div>
          ${favorites.map(r => this.renderQuickRepoRow(r)).join('')}
        </div>
      `
      : '';

    const groupedHtml = topEntries.map(([topLabel, subgroups]) => {
      const subEntries = Array.from(subgroups.entries()).sort((a, b) => {
        if (a[0] === 'Ungrouped') return 1;
        if (b[0] === 'Ungrouped') return -1;
        return a[0].localeCompare(b[0]);
      });

      return `
        <div class="quick-repo-category" data-category="${this.escapeHtml(topLabel.toLowerCase())}">
          <div class="quick-repo-category-header">${this.escapeHtml(topLabel)}</div>
          ${subEntries.map(([subLabel, reposInSub]) => `
            <div class="quick-repo-subcategory" data-subcategory="${this.escapeHtml(subLabel.toLowerCase())}">
              <div class="quick-repo-subcategory-header">${this.escapeHtml(subLabel)}</div>
              ${reposInSub.map(r => this.renderQuickRepoRow(r)).join('')}
            </div>
          `).join('')}
        </div>
      `;
    }).join('');

    return favoritesHtml + groupedHtml;
  }

  renderQuickRepoRow(repo) {
    const recommended = this.getRecommendedWorktree(repo);
    const mostRecent = this.getMostRecentWorktree(repo);
    const hasWorktrees = Array.isArray(repo.worktreeDirs) && repo.worktreeDirs.length > 0;
    const actionLabel = recommended ? `Start (${recommended.id})` : (hasWorktrees ? 'All busy' : 'No worktrees');
    const displayPath = repo.relativePath || repo.path || '';
    const displayPathLabel = displayPath.startsWith('/') ? displayPath : `~/${displayPath}`;
    const isFavorite = (this.quickWorktreeFavorites || new Set()).has(repo.path);
    const favoriteLabel = isFavorite ? '★' : '☆';

    return `
      <div class="quick-repo-row"
           data-repo-name="${repo.name.toLowerCase()}"
           data-repo-path="${displayPath.toLowerCase()}">
        <div class="quick-repo-meta">
          <span class="quick-repo-icon">${this.getProjectIcon(repo.type)}</span>
          <div class="quick-repo-info">
            <div class="quick-repo-name">${this.escapeHtml(repo.name)}</div>
            <div class="quick-repo-path">${this.escapeHtml(displayPathLabel)}</div>
          </div>
        </div>
        <div class="quick-repo-actions">
          <button class="quick-fav-btn ${isFavorite ? 'active' : ''}"
                  data-repo-path="${repo.path}"
                  title="${isFavorite ? 'Remove from favorites' : 'Add to favorites'}">
            ${favoriteLabel}
          </button>
          ${recommended ? `<span class="quick-worktree-pill">${recommended.id}</span>` : ''}
          <div class="quick-start-group">
            <button class="btn-primary quick-start-btn"
                    data-repo-path="${repo.path}"
                    data-repo-type="${repo.type}"
                    data-repo-name="${repo.name}"
                    data-repo-root="${repo.path}"
                    data-worktree-id="${recommended ? recommended.id : ''}"
                    data-worktree-path="${recommended ? recommended.path : ''}"
                    ${recommended ? '' : 'disabled'}>
              ${actionLabel}
            </button>
            <button class="btn-secondary quick-start-menu-btn"
                    data-repo-path="${repo.path}"
                    data-repo-type="${repo.type}"
                    data-repo-name="${repo.name}"
                    data-repo-root="${repo.path}"
                    data-oldest-id="${recommended ? recommended.id : ''}"
                    data-oldest-path="${recommended ? recommended.path : ''}"
                    data-recent-id="${mostRecent ? mostRecent.id : ''}"
                    data-recent-path="${mostRecent ? mostRecent.path : ''}"
                    title="Choose worktree">
              ▾
            </button>
          </div>
        </div>
      </div>
    `;
  }

  getRecommendedWorktree(repo) {
    const worktreeEntries = Array.isArray(repo.worktreeDirs) ? repo.worktreeDirs : [];
    if (!worktreeEntries.length) {
      if (!repo.path) return null;
      const rootId = 'root';
      if (this.isWorktreeInUse(repo.path, rootId, repo.name)) return null;
      return {
        id: rootId,
        path: repo.path,
        lastModifiedMs: repo.lastModifiedMs || 0
      };
    }

    const available = worktreeEntries.filter(entry => {
      if (!entry || !entry.id) return false;
      return !this.isWorktreeInUse(repo.path, entry.id, repo.name);
    });

    if (!available.length) return null;

    let best = null;
    let bestTime = Infinity;

    for (const entry of available) {
      const lastActivity = this.getWorktreeLastActivity(repo, entry.id);
      const entryMtime = typeof entry.lastModifiedMs === 'number' ? entry.lastModifiedMs : 0;
      const effectiveLastUsed = Math.max(entryMtime, lastActivity || 0);
      if (effectiveLastUsed < bestTime) {
        bestTime = effectiveLastUsed;
        best = entry;
      }
    }

    if (!best) return null;

    return {
      id: best.id,
      path: best.path || `${repo.path}/${best.id}`,
      lastModifiedMs: best.lastModifiedMs
    };
  }

  getMostRecentWorktree(repo) {
    const worktreeEntries = Array.isArray(repo.worktreeDirs) ? repo.worktreeDirs : [];
    if (!worktreeEntries.length) {
      if (!repo.path) return null;
      const rootId = 'root';
      if (this.isWorktreeInUse(repo.path, rootId, repo.name)) return null;
      return {
        id: rootId,
        path: repo.path,
        lastModifiedMs: repo.lastModifiedMs || 0
      };
    }

    const available = worktreeEntries.filter(entry => {
      if (!entry || !entry.id) return false;
      return !this.isWorktreeInUse(repo.path, entry.id, repo.name);
    });

    if (!available.length) return null;

    let best = null;
    let bestTime = -Infinity;

    for (const entry of available) {
      const lastActivity = this.getWorktreeLastActivity(repo, entry.id);
      const entryMtime = typeof entry.lastModifiedMs === 'number' ? entry.lastModifiedMs : 0;
      const effectiveLastUsed = Math.max(entryMtime, lastActivity || 0);
      if (effectiveLastUsed > bestTime) {
        bestTime = effectiveLastUsed;
        best = entry;
      }
    }

    if (!best) return null;

    return {
      id: best.id,
      path: best.path || `${repo.path}/${best.id}`,
      lastModifiedMs: best.lastModifiedMs
    };
  }

  getRepoLastActivity(repo) {
    let latest = null;
    const repoName = repo.name?.toLowerCase();

    for (const [sessionId, session] of this.sessions) {
      const sessionRepoName = (session.repositoryName || this.extractRepositoryName(sessionId) || '').toLowerCase();

      if (!sessionRepoName) {
        if (this.currentWorkspace?.repository?.path !== repo.path) {
          continue;
        }
      } else if (repoName && sessionRepoName !== repoName) {
        continue;
      }

      if (typeof session.lastActivity === 'number') {
        latest = latest === null ? session.lastActivity : Math.max(latest, session.lastActivity);
      }
    }

    return latest;
  }

  getConversationRepoLabel(conv) {
    if (conv.gitRepo) return conv.gitRepo;
    if (conv.project) return conv.project;
    const cwd = conv.cwd || '';
    if (!cwd) return 'Unknown';

    const parts = cwd.split('/').filter(Boolean);
    if (!parts.length) return 'Unknown';
    return parts.slice(-2).join('/');
  }

  extractWorktreeLabel(cwd) {
    if (!cwd) return '';
    const nestedMatch = cwd.match(/(?:^|\/)(work\d+)(?:\/|$)/i);
    if (nestedMatch) return nestedMatch[1];
    const siblingMatch = cwd.match(/-work(\d+)(?:\/|$)/i);
    if (siblingMatch) return `work${siblingMatch[1]}`;
    return '';
  }

  formatConversationTimestamp(timestamp) {
    try {
      const date = new Date(timestamp);
      if (Number.isNaN(date.getTime())) return '';
      return date.toLocaleString();
    } catch (error) {
      return '';
    }
  }

  cleanQuickPreview(text) {
    if (!text) return '';
    let cleaned = text
      .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/gi, '')
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
      .replace(/<command-name>[\s\S]*?<\/command-name>/gi, '')
      .replace(/<command-message>[\s\S]*?<\/command-message>/gi, '')
      .replace(/<command-args>[\s\S]*?<\/command-args>/gi, '')
      .replace(/<[^>]+>/g, '')
      .trim();

    if (cleaned.length < 10) {
      cleaned = text.replace(/<[^>]+>/g, '').trim();
    }

    return cleaned.slice(0, 180);
  }

  formatTokenCount(tokens) {
    if (!tokens || typeof tokens !== 'number') return '';
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
    return `${tokens}`;
  }

  getWorktreeLastActivity(repo, worktreeId) {
    let latest = null;
    const repoName = repo.name?.toLowerCase();

    for (const [sessionId, session] of this.sessions) {
      const sessionWorktreeId = session.worktreeId || sessionId.split('-')[0];
      if (sessionWorktreeId !== worktreeId) continue;

      const sessionRepoName = (session.repositoryName || this.extractRepositoryName(sessionId) || '').toLowerCase();
      if (repoName && sessionRepoName && sessionRepoName !== repoName) continue;

      if (typeof session.lastActivity === 'number') {
        latest = latest === null ? session.lastActivity : Math.max(latest, session.lastActivity);
      }
    }

    return latest;
  }

  async loadQuickWorktreeConversations({ force = false } = {}) {
    const listEl = document.getElementById('quick-conv-list');
    if (!listEl) return;

    try {
      if (this.quickWorktreeConversationsLoaded && !force) return;
      listEl.innerHTML = '<div class="loading">Loading recent conversations...</div>';

      const serverUrl = window.location.port === '2080' ? 'http://localhost:3000' : window.location.origin;
      const limit = this.quickWorktreeConversationLimit || 100;
      const response = await fetch(`${serverUrl}/api/conversations/recent?limit=${limit}`);
      const conversations = await response.json();
      this.quickWorktreeConversationsLoaded = true;
      const countEl = document.getElementById('quick-conv-count');
      if (countEl) {
        countEl.textContent = `${conversations.length} loaded`;
      }

      if (!conversations.length) {
        listEl.innerHTML = '<div class="quick-empty">No recent conversations yet</div>';
        return;
      }

      listEl.innerHTML = conversations.map(conv => this.renderQuickConversationRow(conv)).join('');

      listEl.querySelectorAll('.quick-resume-btn').forEach(btn => {
        btn.addEventListener('click', (event) => {
          const id = btn.dataset.id;
          const project = btn.dataset.project;
          const cwd = btn.dataset.cwd;
          const keepOpen = event && (event.ctrlKey || event.metaKey);

          if (this.conversationBrowser) {
            this.conversationBrowser.resumeConversation(id, project, cwd);
          } else {
            this.showTemporaryMessage('Conversation browser not available', 'error');
          }

          if (!keepOpen) {
            document.getElementById('quick-worktree-modal')?.remove();
          }
        });
      });
    } catch (error) {
      console.error('Failed to load conversations:', error);
      listEl.innerHTML = '<div class="quick-empty">Failed to load conversations</div>';
    }
  }

  renderQuickConversationRow(conv) {
    const repoLabel = this.getConversationRepoLabel(conv);
    const worktreeLabel = this.extractWorktreeLabel(conv.cwd || '');
    const lastUsed = conv.lastTimestamp ? this.formatConversationTimestamp(conv.lastTimestamp) : '';
    const title = this.cleanQuickPreview(conv.summary || conv.firstUserMessage || conv.preview || conv.project || 'Conversation');
    const lastPreview = this.cleanQuickPreview(conv.lastMessage || '');
    const disabled = !conv.cwd;
    const model = conv.model || '';
    const msgCount = typeof conv.messageCount === 'number' ? conv.messageCount : 0;
    const userCount = typeof conv.userMessageCount === 'number' ? conv.userMessageCount : 0;
    const tokens = this.formatTokenCount(conv.totalTokens);

    return `
      <div class="quick-conv-row"
           data-conv-title="${this.escapeHtml(title).toLowerCase()}"
           data-conv-repo="${this.escapeHtml(repoLabel).toLowerCase()}"
           data-conv-path="${this.escapeHtml(conv.cwd || '').toLowerCase()}">
        <div class="quick-conv-main">
          <div class="quick-conv-header">
            <div class="quick-conv-title">${this.escapeHtml(repoLabel)}</div>
            <div class="quick-conv-badges">
              ${worktreeLabel ? `<span class="quick-pill">${this.escapeHtml(worktreeLabel)}</span>` : ''}
              ${conv.branch ? `<span class="quick-pill">${this.escapeHtml(conv.branch)}</span>` : ''}
            </div>
          </div>
          <div class="quick-conv-meta-row">
            ${lastUsed ? `<span>Last: ${this.escapeHtml(lastUsed)}</span>` : ''}
            ${conv.project ? `<span>${this.escapeHtml(conv.project)}</span>` : ''}
          </div>
          ${title ? `<div class="quick-conv-preview">${this.escapeHtml(title)}</div>` : ''}
          ${lastPreview && lastPreview !== title ? `<div class="quick-conv-preview">${this.escapeHtml(lastPreview)}</div>` : ''}
          <div class="quick-conv-meta-row">
            ${model ? `<span>${this.escapeHtml(model)}</span>` : ''}
            <span>${msgCount} msgs${userCount ? ` (${userCount} user)` : ''}</span>
            ${tokens ? `<span>${tokens} tokens</span>` : ''}
          </div>
          ${conv.cwd ? `<div class="quick-conv-path">${this.escapeHtml(conv.cwd)}</div>` : ''}
        </div>
        <div class="quick-conv-actions">
          <button class="btn-secondary quick-resume-btn" data-id="${conv.id}" data-project="${conv.project || ''}" data-cwd="${conv.cwd || ''}" ${disabled ? 'disabled' : ''}>
            ${disabled ? 'No CWD' : 'Resume'}
          </button>
        </div>
      </div>
    `;
  }

  setupWorktreeModalInteractions() {
    const searchInput = document.getElementById('worktree-search');
    const filterButtons = document.querySelectorAll('.filter-btn');
    const repoSections = document.querySelectorAll('.repo-section');
    const categories = document.querySelectorAll('.repo-category');

    // Search functionality
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        repoSections.forEach(section => {
          const repoName = section.dataset.repoName || '';
          const matches = repoName.includes(searchTerm);
          section.style.display = matches ? 'block' : 'none';
        });

        // Hide empty categories
        categories.forEach(category => {
          const visibleRepos = category.querySelectorAll('.repo-section[style="display: block"], .repo-section:not([style])').length;
          category.style.display = visibleRepos > 0 ? 'block' : 'none';
        });
      });
    }

    // Filter buttons
    filterButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        // Update active button
        filterButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const filter = btn.dataset.filter;

        repoSections.forEach(section => {
          let shouldShow = true;

          if (filter === 'available') {
            // Show only repos with available worktrees
            const availableWorktrees = section.querySelectorAll('.worktree-option.available').length;
            shouldShow = availableWorktrees > 0;
          } else if (filter === 'hytopia') {
            const repoType = section.dataset.repoType || '';
            shouldShow = repoType.includes('hytopia') || section.dataset.repoName.includes('hyfire');
          } else if (filter === 'monogame') {
            const repoType = section.dataset.repoType || '';
            shouldShow = repoType.includes('monogame');
          }
          // 'all' filter shows everything

          section.style.display = shouldShow ? 'block' : 'none';
        });

        // Hide empty categories after filtering
        categories.forEach(category => {
          const visibleRepos = category.querySelectorAll('.repo-section[style="display: block"], .repo-section:not([style*="none"])').length;
          category.style.display = visibleRepos > 0 ? 'block' : 'none';
        });
      });
    });

    // Collapse/expand categories by default (start with smaller categories collapsed)
    categories.forEach(category => {
      const repoCount = category.querySelectorAll('.repo-section').length;
      if (repoCount > 5) {
        category.classList.add('collapsed');
        const toggle = category.querySelector('.category-toggle');
        if (toggle) toggle.textContent = '▶';
      }
    });
  }

  renderRepoWorktreeOptions(repo) {
    const getIcon = (type) => this.getProjectIcon(type);
    const worktreeOptions = [];
    for (let i = 1; i <= 8; i++) {
      const worktreeId = `work${i}`;
      const isInUse = this.isWorktreeInUse(repo.path, worktreeId, repo.name);
      const statusIcon = isInUse ? '⚠️' : '✅';
      const statusText = isInUse ? 'In use' : 'Available';

      worktreeOptions.push(`
        <button class="worktree-option ${isInUse ? 'in-use' : 'available'}"
                onclick="window.orchestrator.addWorktreeToWorkspace('${repo.path}', '${worktreeId}', '${repo.type}', '${repo.name}', ${isInUse})">
          <span class="worktree-id">${worktreeId}</span>
          <span class="worktree-status">${statusIcon} ${statusText}</span>
        </button>
      `);
    }

    return `
      <div class="repo-section" data-repo-name="${repo.name.toLowerCase()}" data-repo-type="${repo.type}">
        <div class="repo-header">
          <span class="repo-icon">${getIcon(repo.type)}</span>
          <div class="repo-info">
            <span class="repo-name">${repo.name}</span>
            <span class="repo-path">~/${repo.relativePath}</span>
          </div>
          <span class="available-count">${worktreeOptions.filter(w => !w.includes('in-use')).length}/8 available</span>
        </div>
        <div class="worktree-grid">
          ${worktreeOptions.join('')}
        </div>
      </div>
    `;
  }

  isWorktreeInUse(repoPath, worktreeId, repoNameOverride = null) {
    // Check if this worktree has ACTIVE SESSIONS, not just workspace config
    // A worktree is "in use" only if there are actual terminal sessions for it

    if (!this.currentWorkspace) return false;

    // Extract repo name from path for session matching
    const repoName = (repoNameOverride || repoPath.split('/').pop() || '').toLowerCase();

    // Check if any session is using this worktree
    // Session IDs follow patterns like: "work1-claude", "work1-server",
    // or for mixed-repo: "repoName-work1-claude", "repoName-work1-server"
    for (const [sessionId, session] of this.sessions) {
      // Only consider sessions that belong to the current workspace
      if (this.currentWorkspace && session.workspace && session.workspace !== this.currentWorkspace.id) {
        continue;
      }

      const sessionWorktreeId = session.worktreeId || sessionId.split('-')[0];
      const sessionRepoName = (session.repositoryName || this.extractRepositoryName(sessionId) || '').toLowerCase();

      // For single-repo workspaces (no repo name in session)
      if (!sessionRepoName && this.currentWorkspace.repository?.path === repoPath) {
        if (sessionWorktreeId === worktreeId) {
          return true;
        }
      }

      // For mixed-repo workspaces (repo name in session)
      if (sessionRepoName && repoName && sessionRepoName === repoName) {
        if (sessionWorktreeId === worktreeId) {
          return true;
        }
      }
    }

    // Also check mixed-repo workspace config for explicitly assigned worktrees
    if (this.currentWorkspace.terminals && Array.isArray(this.currentWorkspace.terminals)) {
      const repoNameMatch = repoNameOverride ? repoNameOverride.toLowerCase() : '';
      return this.currentWorkspace.terminals.some(terminal => {
        if (terminal.worktree !== worktreeId) return false;
        if (terminal.repository?.path === repoPath) {
          return true; // This worktree is assigned in workspace config
        }
        if (repoNameMatch && (terminal.repository?.name || '').toLowerCase() === repoNameMatch) {
          return true; // Match by repo name when paths differ
        }
        return false;
      });
    }

    // No active sessions for this worktree - it's available
    return false;
  }

  quickStartWorktree({ repoPath, repoType, repoName, worktreeId, worktreePath, repositoryRoot, keepOpen = false }) {
    if (!this.socket) {
      this.showTemporaryMessage('Socket not connected', 'error');
      return;
    }

    this.showTemporaryMessage(`Starting ${repoName} ${worktreeId}...`, 'success');
    this.socket.emit('add-worktree-sessions', {
      worktreeId,
      worktreePath,
      repositoryName: repoName,
      repositoryType: repoType,
      repositoryRoot: repositoryRoot || repoPath
    });

    if (!keepOpen) {
      document.getElementById('quick-worktree-modal')?.remove();
    }
  }

  async addWorktreeToWorkspace(repoPath, worktreeId, repoType, repoName, isInUse = false) {
    try {
      console.log(`Adding ${worktreeId} from ${repoName} to workspace...`);

      if (isInUse) {
        // If the worktree already exists in this workspace, don't block selection.
        // Instead, make sure it is visible again (user likely hid it).
        const sessionIds = [];
        const targetRepoName = (repoName || '').toLowerCase();

        for (const [sessionId, session] of this.sessions) {
          if (this.currentWorkspace && session.workspace && session.workspace !== this.currentWorkspace.id) {
            continue;
          }

          const sessionWorktreeId = session.worktreeId || sessionId.split('-')[0];
          if (sessionWorktreeId !== worktreeId) continue;

          const sessionRepoName = (session.repositoryName || this.extractRepositoryName(sessionId) || '').toLowerCase();

          // Mixed repo match by repo name; single repo match by workspace repo path
          if (sessionRepoName && targetRepoName && sessionRepoName === targetRepoName) {
            sessionIds.push(sessionId);
          } else if (!sessionRepoName && this.currentWorkspace?.repository?.path === repoPath) {
            sessionIds.push(sessionId);
          }
        }

        if (sessionIds.length > 0) {
          sessionIds.forEach(id => this.visibleTerminals.add(id));
          this.updateTerminalGrid();
          this.buildSidebar();
          document.getElementById('add-worktree-modal')?.remove();
          document.getElementById('quick-worktree-modal')?.remove();
          this.showTemporaryMessage(`Showing ${repoName} ${worktreeId}`, 'success');
          return;
        }
      }

      const response = await fetch('/api/workspaces/add-mixed-worktree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: this.currentWorkspace.id,
          repositoryPath: repoPath,
          repositoryType: repoType,
          repositoryName: repoName,
          worktreeId: worktreeId,
          socketId: this.socket?.id || null
        })
      });

      if (response.ok) {
        this.showTemporaryMessage(`Added ${repoName} ${worktreeId} to workspace!`, 'success');
        document.getElementById('add-worktree-modal')?.remove();
        document.getElementById('quick-worktree-modal')?.remove();

        // Server will emit 'worktree-sessions-added' which is handled by our socket listener
      } else {
        const error = await response.text();
        this.showTemporaryMessage('Failed to add worktree: ' + error, 'error');
      }
    } catch (error) {
      console.error('Error adding worktree:', error);
      this.showTemporaryMessage('Error: ' + error.message, 'error');
    }
  }

  async createWorktree(worktreeNumber) {
    try {
      console.log(`Creating work${worktreeNumber} worktree...`);

      const response = await fetch('/api/workspaces/create-worktree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: this.currentWorkspace.id,
          worktreeNumber: worktreeNumber
        })
      });

      if (response.ok) {
        const result = await response.json();
        this.showTemporaryMessage(`Worktree work${worktreeNumber} created successfully!`, 'success');

        // Update workspace config to include new terminal pair
        this.currentWorkspace.terminals.pairs = worktreeNumber;

        // Add sessions for the new worktree WITHOUT destroying existing sessions
        // Server will emit 'worktree-sessions-added' which is handled by our socket listener
        setTimeout(() => {
          this.socket.emit('add-worktree-sessions', {
            worktreeId: result.worktreeId,
            worktreePath: result.path,
            repositoryName: null,  // Traditional workspace, no repo name needed
            repositoryType: this.currentWorkspace.repository?.type
          });
        }, 500);
      } else {
        const error = await response.text();
        console.error('Failed to create worktree:', error);
        this.showTemporaryMessage('Failed to create worktree: ' + error, 'error');
      }
    } catch (error) {
      console.error('Error creating worktree:', error);
      this.showTemporaryMessage('Error creating worktree: ' + error.message, 'error');
    }
  }

  showSettings() {
    // Toggle settings panel
    const settingsPanel = document.getElementById('settings-panel');
    if (settingsPanel) {
      settingsPanel.classList.toggle('hidden');
    }
  }

  getProjectIcon(type) {
    const icons = {
      'hytopia-game': '🎮',
      'monogame-game': '🕹️',
      'website': '🌐',
      'writing': '📖',
      'tool-project': '🛠️',
      'minecraft-mod': '⛏️',
      'rust-game': '🦀',
      'web-game': '🎯',
      'ruby-rails': '💎'
    };
    return icons[type] || '📁';
  }

  getAgentIcon(agentId) {
    const icons = {
      claude: '🤖',
      codex: '⚡',
      opencode: '🧩',
      aider: '🧰'
    };

    if (!agentId) return '🤖';
    return icons[agentId] || '🤖';
  }

  escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

// Initialize when DOM is ready
let orchestrator;
document.addEventListener('DOMContentLoaded', () => {
  orchestrator = new ClaudeOrchestrator();
  window.orchestrator = orchestrator; // Make globally available
});
