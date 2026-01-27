// Enhanced Claude Orchestrator with sidebar and flexible viewing
class ClaudeOrchestrator {
  constructor() {
    this.sessions = new Map();
    this.activeView = [];
    this.visibleTerminals = new Set(); // Track which terminals are visible
    // Second-layer filter applied after per-worktree visibility toggles:
    // 'all' | 'claude' | 'server'
    this.viewMode = 'all';
    // Second-layer filter for tiered workflow:
    // 'all' | 'none' | 1 | 2 | 3 | 4
    this.tierFilter = 'all';
    // Workflow mode (tier-aware) applied after viewMode + tierFilter:
    // 'focus' (Tier 1–2) | 'review' (all) | 'background' (Tier 3–4)
    this.workflowMode = 'review';
    this.focusHideTier2WhenTier1Busy = true;
    this.focusAutoSwapTier2WhenTier1Busy = false;
    this.tier1Busy = false;
    this.queuePanelPreset = null;
    this.processStatus = null;
    this.processStatusInterval = null;
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
    this.autoCreateExtraWorktreesWhenBusy = true;
    this.autoCreateWorktreeMinNumber = 9;
    this.autoCreateWorktreeMaxNumber = 25;

    // Tab management for multiple workspaces
    this.tabManager = null;

    // Dynamic workspace types
    this.workspaceTypes = {};
    this.frameworks = {};
    this.workspaceHierarchy = {};
    this.cascadedConfigs = {};  // Fully merged configs (Global → Category → Framework → Project)
    this.worktreeConfigs = new Map(); // Worktree-specific configs (sessionId → config)
    this.worktreeTags = new Map(); // Worktree path → tags (e.g., readyForReview)
    this.taskRecords = new Map(); // taskId → record (tier/risk/pFail/promptRef)

    // Launch helpers (ticket/card → worktree → agent → auto-prompt)
    this.pendingAutoPrompts = new Map(); // sessionId -> { text, createdAt, sentAt }
    this.pendingWorktreeLaunches = new Map(); // worktreeId -> { promptText, autoSendPrompt, agentConfig }
    // Optimistic “in-use” tracking: while a worktree is starting (sessions not yet added), treat it as in-use
    // so Quick Work / Add Worktree won’t recommend it again.
    this.pendingWorktreeReservations = new Map(); // `${repoPathNorm}::${worktreeId}` -> expiresAtMs
    // Worktree launches that should not auto-start or auto-show terminals when sessions arrive.
    this.pendingBackgroundWorktrees = new Set(); // worktreeId
    this.scannedReposCache = { value: null, fetchedAt: 0 };
    this.worktreeModalKeepOpen = this.loadWorktreeModalKeepOpenPreference();

    // Button registry - all available buttons with their implementations
    this.buttonRegistry = this.initButtonRegistry();

    this.init();
  }

  loadWorktreeModalKeepOpenPreference() {
    try {
      return localStorage.getItem('worktree-modal-keep-open') === 'true';
    } catch {
      return false;
    }
  }

  setWorktreeModalKeepOpenPreference(keepOpen) {
    const next = !!keepOpen;
    this.worktreeModalKeepOpen = next;
    try {
      localStorage.setItem('worktree-modal-keep-open', next ? 'true' : 'false');
    } catch {
      // ignore
    }
  }

  getWorktreeModalKeepOpen() {
    return !!this.worktreeModalKeepOpen;
  }

  refreshWorktreeAddModals() {
    // Quick Work modal: rerender availability (recommended worktree + in-use flags)
    if (document.getElementById('quick-worktree-modal')) {
      try {
        this.renderQuickWorktreeRepoList();
      } catch {
        // ignore
      }
    }

    // Advanced add-worktree modal: update availability labels/classes without rebuilding everything
    if (document.getElementById('add-worktree-modal')) {
      try {
        this.refreshAdvancedAddWorktreeModalAvailability();
      } catch {
        // ignore
      }
    }
  }

  normalizeWorktreePath(p) {
    return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').trim();
  }

  reserveWorktree(repoPath, worktreeId, { ttlMs } = {}) {
    const repo = this.normalizeWorktreePath(repoPath);
    const id = String(worktreeId || '').trim();
    if (!repo || !id) return;
    const ttl = Number.isFinite(Number(ttlMs)) ? Number(ttlMs) : 45_000;
    const expiresAt = Date.now() + Math.max(5_000, ttl);
    this.pendingWorktreeReservations.set(`${repo}::${id}`, expiresAt);
  }

  clearWorktreeReservation(repoPath, worktreeId) {
    const repo = this.normalizeWorktreePath(repoPath);
    const id = String(worktreeId || '').trim();
    if (!repo || !id) return;
    this.pendingWorktreeReservations.delete(`${repo}::${id}`);
  }

  clearWorktreeReservationByWorktreeId(worktreeId) {
    const id = String(worktreeId || '').trim();
    if (!id || !this.pendingWorktreeReservations?.size) return;
    for (const key of this.pendingWorktreeReservations.keys()) {
      if (key.endsWith(`::${id}`)) this.pendingWorktreeReservations.delete(key);
    }
  }

  isWorktreeReserved(repoPath, worktreeId) {
    const repo = this.normalizeWorktreePath(repoPath);
    const id = String(worktreeId || '').trim();
    if (!repo || !id) return false;
    const key = `${repo}::${id}`;
    const expiresAt = this.pendingWorktreeReservations.get(key);
    if (!expiresAt) return false;
    const now = Date.now();
    if (expiresAt <= now) {
      this.pendingWorktreeReservations.delete(key);
      return false;
    }
    return true;
  }

  cleanupExpiredWorktreeReservations() {
    if (!this.pendingWorktreeReservations?.size) return;
    const now = Date.now();
    for (const [key, expiresAt] of this.pendingWorktreeReservations.entries()) {
      if (!expiresAt || expiresAt <= now) this.pendingWorktreeReservations.delete(key);
    }
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

      // Queue / Review inbox panel (process tasks)
      document.getElementById('queue-btn')?.addEventListener('click', () => {
        this.showQueuePanel();
      });

      // Workflow mode toggles (tier-aware visibility rules)
      document.getElementById('workflow-focus')?.addEventListener('click', () => {
        this.setWorkflowMode('focus');
      });
      document.getElementById('workflow-review')?.addEventListener('click', () => {
        this.setWorkflowMode('review');
        this.queuePanelPreset = { reviewTier: 3, unreviewedOnly: true, autoOpenDiff: true };
        this.showQueuePanel();
      });
      document.getElementById('workflow-background')?.addEventListener('click', () => {
        this.setWorkflowMode('background');
        // Background mode: open a triage-oriented queue view for Tier 3/4 items.
        this.queuePanelPreset = { tierSet: [3, 4], triageMode: true, reviewActive: false };
        this.showQueuePanel();
      });

      document.getElementById('workflow-focus-tier2')?.addEventListener('click', () => {
        this.setFocusHideTier2WhenTier1Busy(!this.focusHideTier2WhenTier1Busy);
      });

      document.getElementById('workflow-focus-autoswap')?.addEventListener('click', () => {
        this.setFocusAutoSwapTier2WhenTier1Busy(!this.focusAutoSwapTier2WhenTier1Busy);
      });

      // Tasks panel (ticketing providers like Trello)
      document.getElementById('tasks-btn')?.addEventListener('click', () => {
        this.showTasksPanel();
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
      this.syncWorkflowModeFromUserSettings();
      this.syncFocusBehaviorFromUserSettings();
      this.syncWorktreeCreationFromUserSettings();

      // Load worktree tags (ready-for-review, etc.)
      await this.loadWorktreeTags();

      // Load task records (tiers/risk/prompt refs) for tier-aware UI
      await this.loadTaskRecords();

      // WIP / Queue banner (process status)
      this.startProcessStatusBanner();
      
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
        this.maybeAutoSendPrompt(sessionId, status);
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

        // Remove terminal wrapper from UI
        const wrapper = document.getElementById(`wrapper-${sessionId}`);
        if (wrapper) {
          console.log(`Removing terminal wrapper from DOM: ${sessionId}`);
          wrapper.remove();
        } else {
          // Fallback for older DOM shapes
          const terminalElement = document.getElementById(`terminal-${sessionId}`);
          if (terminalElement) {
            console.log(`Removing terminal element from DOM: ${sessionId}`);
            terminalElement.remove();
          }
        }

        // Remove from terminal manager
        if (this.terminalManager) {
          this.terminalManager.destroyTerminal(sessionId);
        }

        // Rebuild sidebar to reflect changes
        this.buildSidebar();
        this.updateTerminalGrid();

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
      this.socket.on('worktree-sessions-added', ({ worktreeId, sessions, startTier }) => {
        console.log('New worktree sessions added:', worktreeId, sessions);

        const isBackground = this.pendingBackgroundWorktrees?.has?.(worktreeId);
        if (isBackground) this.pendingBackgroundWorktrees.delete(worktreeId);

        // Add the new sessions to our sessions map (don't clear existing!)
        for (const [sessionId, sessionState] of Object.entries(sessions)) {
          this.sessions.set(sessionId, {
            sessionId,
            ...sessionState,
            hasUserInput: false,
            backgroundLaunch: !!isBackground
          });

          // If there's an existing PR, add it to GitHub links
          if (sessionState.existingPR) {
            const links = this.githubLinks.get(sessionId) || {};
            links.pr = sessionState.existingPR;
            this.githubLinks.set(sessionId, links);
          }

          // Mark new sessions as active (active-only filter should treat background work as active too).
          this.sessionActivity.set(sessionId, 'active');

          // Background launches intentionally do not auto-show in Review/Focus.
          if (!isBackground) {
            this.visibleTerminals.add(sessionId);
          }

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

        // Apply selected start tier (Quick Work) to new Agent sessions.
        const tier = Number(startTier);
        if (tier >= 1 && tier <= 4) {
          const sessionIds = Object.keys(sessions || {});
          this.applyStartTierToNewSessions(sessionIds, tier);
        }

        // Clear optimistic “starting” reservation now that the sessions exist.
        try {
          const sessionStates = Object.values(sessions || {});
          const sample = sessionStates && sessionStates.length ? sessionStates[0] : null;
          const repoRoot = this.normalizeWorktreePath(sample?.repositoryRoot || '');
          if (repoRoot) {
            this.clearWorktreeReservation(repoRoot, worktreeId);
          } else {
            // Fallback: clear any reservation for this worktree id.
            this.clearWorktreeReservationByWorktreeId(worktreeId);
          }
        } catch {
          // ignore
        }

        // Show success message
        const readyMsg = isBackground
          ? `Worktree ${worktreeId} terminals ready (background)`
          : `Worktree ${worktreeId} terminals ready!`;
        this.showTemporaryMessage(readyMsg, 'success');
        this.refreshWorktreeAddModals();

        // Auto-start Claude after a delay to let terminals initialize.
        // Background launches intentionally skip this.
        if (!isBackground) {
          setTimeout(() => {
            this.checkAndApplyAutoStart();
          }, 2000);
        }

        // If this worktree was launched from a task card, start agent + auto-send prompt (best-effort).
        const pending = this.pendingWorktreeLaunches.get(worktreeId);
        if (pending) {
          this.pendingWorktreeLaunches.delete(worktreeId);
          const sessionIds = Object.keys(sessions || {});
          const agentSessionId =
            sessionIds.find(id => id.endsWith('-claude'))
            || sessionIds.find(id => !id.endsWith('-server'))
            || null;

          if (agentSessionId && pending.agentConfig) {
            this.startAgentWithConfig(agentSessionId, pending.agentConfig);
          }

          if (agentSessionId && pending.ticket && typeof pending.ticket === 'object') {
            const ticketProvider = String(pending.ticket.provider || '').trim().toLowerCase();
            const ticketCardId = String(pending.ticket.cardId || '').trim();
            const ticketCardUrl = String(pending.ticket.cardUrl || '').trim();
            if (ticketProvider && ticketCardId) {
              this.upsertTaskRecord(`session:${agentSessionId}`, {
                ticketProvider,
                ticketCardId,
                ticketCardUrl: ticketCardUrl || null
              }).then((rec) => {
                if (rec) this.taskRecords.set(`session:${agentSessionId}`, rec);
              }).catch(() => {});
            }
          }

          if (agentSessionId && pending.autoSendPrompt && String(pending.promptText || '').trim()) {
            this.pendingAutoPrompts.set(agentSessionId, {
              text: String(pending.promptText || ''),
              createdAt: Date.now(),
              sentAt: null
            });
          }
        }
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
        this.applyThemeFromUserSettings();
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

	            // Set current workspace BEFORE switching tabs so WorkspaceTabManager doesn't
	            // re-request a backend workspace switch (we're already in 'workspace-changed').
	            this.currentWorkspace = workspace;
	            this.isDashboardMode = false;

	            // CRITICAL: Set currentTabId FIRST before anything else
	            // Terminals need this to register to the correct tab
	            this.currentTabId = tabId;

	            // Switch to the new tab so it becomes active
	            await this.tabManager.switchTab(tabId);
	            this.tabManager.pruneDuplicateWorkspaceTabs(workspace.id, tabId);

	            // Pre-fetch worktree-specific configs for all terminals
	            await this.prefetchWorktreeConfigs(workspace, sessions);

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
      'notifications-panel': null,
      'close-notifications': null,
      'notifications-clear': null,
      'notifications-mark-read': null,
      'enable-notifications': null,
      'enable-sounds': null,
      'auto-scroll': null,
      'theme-select': null,
      'workflow-notify-mode': null,
      'workflow-notify-tier1-interrupts': null,
      'workflow-notify-review-nudges': null,
      'tasks-theme-select': null,
      'trello-me-username': null,
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
		      this.setViewMode('all');
		    });
	    
	    document.getElementById('view-claude-only').addEventListener('click', () => {
	      this.setViewMode('claude');
	    });
	    
	    document.getElementById('view-servers-only').addEventListener('click', () => {
	      this.setViewMode('server');
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
      // Persist via server user settings so it survives reloads across devices/worktrees.
      this.updateGlobalUserSetting('ui.theme', e.target.value);
    });

    const tasksThemeSelect = document.getElementById('tasks-theme-select');
    if (tasksThemeSelect) {
      tasksThemeSelect.addEventListener('change', (e) => {
        const next = e.target.value;
        this.updateGlobalUserSetting('ui.tasks.theme', next);
      });
    }

    const trelloMeUsername = document.getElementById('trello-me-username');
    if (trelloMeUsername) {
      trelloMeUsername.addEventListener('change', (e) => {
        const v = String(e.target.value || '').trim();
        this.updateGlobalUserSetting('ui.tasks.me.trelloUsername', v);
      });
    }

    const diffViewerThemeSelect = document.getElementById('diff-viewer-theme');
    if (diffViewerThemeSelect) {
      diffViewerThemeSelect.addEventListener('change', (e) => {
        this.updateGlobalUserSetting('ui.diffViewer.theme', e.target.value);
      });
    }

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
    
    // Workflow notification settings (server-persisted)
    const workflowNotifyMode = document.getElementById('workflow-notify-mode');
    if (workflowNotifyMode) {
      workflowNotifyMode.addEventListener('change', (e) => {
        const v = String(e.target.value || '').trim().toLowerCase();
        const mode = (v === 'quiet' || v === 'normal' || v === 'aggressive') ? v : 'quiet';
        this.updateGlobalUserSetting('ui.workflow.notifications.mode', mode);
      });
    }
    const workflowNotifyTier1 = document.getElementById('workflow-notify-tier1-interrupts');
    if (workflowNotifyTier1) {
      workflowNotifyTier1.addEventListener('change', (e) => {
        this.updateGlobalUserSetting('ui.workflow.notifications.tier1Interrupts', !!e.target.checked);
      });
    }
    const workflowNotifyReview = document.getElementById('workflow-notify-review-nudges');
    if (workflowNotifyReview) {
      workflowNotifyReview.addEventListener('change', (e) => {
        this.updateGlobalUserSetting('ui.workflow.notifications.reviewCompleteNudges', !!e.target.checked);
      });
    }

    // Notifications panel
    const notificationsPanel = document.getElementById('notifications-panel');
    const toggleNotificationsPanel = () => {
      if (!notificationsPanel) return;
      // Only one side panel open at a time.
      document.getElementById('settings-panel')?.classList.add('hidden');
      notificationsPanel.classList.toggle('hidden');
      if (!notificationsPanel.classList.contains('hidden')) {
        this.notificationManager?.renderNotifications?.();
      }
    };

    document.getElementById('notification-toggle').addEventListener('click', toggleNotificationsPanel);

    const closeNotificationsBtn = document.getElementById('close-notifications');
    if (closeNotificationsBtn) {
      closeNotificationsBtn.addEventListener('click', () => notificationsPanel?.classList.add('hidden'));
    }
    const clearNotificationsBtn = document.getElementById('notifications-clear');
    if (clearNotificationsBtn) {
      clearNotificationsBtn.addEventListener('click', () => this.notificationManager?.clearAll?.());
    }
    const markReadBtn = document.getElementById('notifications-mark-read');
    if (markReadBtn) {
      markReadBtn.addEventListener('click', () => this.notificationManager?.markAllAsRead?.());
    }
    
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

	    // Ensure the view buttons reflect the current view mode (radio behavior).
	    this.updateViewModeButtons();

	    // Keyboard: Alt+↑ / Alt+↓ to change tier for the last interacted terminal.
	    this.setupTierHotkeys();
	  }

  setupTierHotkeys() {
    if (this._tierHotkeysBound) return;
    this._tierHotkeysBound = true;

    document.addEventListener('keydown', (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;

      const sessionId = this.focusedTerminalInfo?.sessionId || this.lastInteractedSessionId;
      if (!sessionId) return;

      e.preventDefault();
      e.stopPropagation();

      const delta = e.key === 'ArrowUp' ? 1 : -1;
      this.cycleTierForSession(sessionId, delta);
    });
  }
	  
	  setViewMode(mode) {
	    const normalized = String(mode || '').toLowerCase();
	    if (!['all', 'claude', 'server'].includes(normalized)) return;
	    if (this.viewMode === normalized) return;
	
	    this.viewMode = normalized;
	    this.updateViewModeButtons();
	    // Second-layer filter only: do NOT modify worktree visibility (visibleTerminals).
	    this.updateTerminalGrid();
	  }
	  
  updateViewModeButtons() {
    const allBtn = document.getElementById('view-all');
    const claudeBtn = document.getElementById('view-claude-only');
    const serverBtn = document.getElementById('view-servers-only');
    if (!allBtn || !claudeBtn || !serverBtn) return;

    allBtn.classList.toggle('active', this.viewMode === 'all');
    claudeBtn.classList.toggle('active', this.viewMode === 'claude');
    serverBtn.classList.toggle('active', this.viewMode === 'server');
  }

  setTierFilter(filter) {
    const raw = String(filter ?? '').trim().toLowerCase();
    const normalized = raw === '' || raw === 'all'
      ? 'all'
      : (raw === 'none' ? 'none' : Number.parseInt(raw, 10));

    if (normalized !== 'all' && normalized !== 'none' && !(normalized >= 1 && normalized <= 4)) {
      return;
    }

    if (this.tierFilter === normalized) return;
    this.tierFilter = normalized;
    this.ensureFilterToggleExists();
    this.updateTerminalGrid();
    this.buildSidebar();
  }

  matchesTierFilter(sessionId) {
    if (this.tierFilter === 'all') return true;
    const tier = this.getTierForSession(sessionId);
    if (this.tierFilter === 'none') return tier === null;
    return tier === this.tierFilter;
  }

  setWorkflowMode(mode) {
    const normalized = String(mode || '').trim().toLowerCase();
    if (!['focus', 'review', 'background'].includes(normalized)) return;
    if (this.workflowMode === normalized) return;

    this.workflowMode = normalized;
    this.updateWorkflowModeButtons();
    // Second-layer filter only: do NOT modify worktree visibility (visibleTerminals) or tierFilter.
    this.updateTerminalGrid();
    this.buildSidebar();

    // Persist for the user.
    this.updateGlobalUserSetting('ui.workflow.mode', normalized);
  }

  syncWorkflowModeFromUserSettings() {
    const mode = this.userSettings?.global?.ui?.workflow?.mode;
    const normalized = String(mode || '').trim().toLowerCase();
    this.workflowMode = ['focus', 'review', 'background'].includes(normalized) ? normalized : 'review';
    this.updateWorkflowModeButtons();
  }

  syncFocusBehaviorFromUserSettings() {
    const v = this.userSettings?.global?.ui?.workflow?.focus?.hideTier2WhenTier1Busy;
    this.focusHideTier2WhenTier1Busy = v !== false;
    const swap = this.userSettings?.global?.ui?.workflow?.focus?.autoSwapToTier2WhenTier1Busy;
    this.focusAutoSwapTier2WhenTier1Busy = swap === true;
    this.refreshTier1Busy();
    this.updateWorkflowModeButtons();
  }

  syncWorktreeCreationFromUserSettings() {
    const cfg = this.userSettings?.global?.ui?.worktrees || {};
    this.autoCreateExtraWorktreesWhenBusy = cfg.autoCreateExtraWhenBusy !== false;
    const min = Number(cfg.autoCreateMinNumber);
    const max = Number(cfg.autoCreateMaxNumber);
    if (Number.isFinite(min) && min >= 1) this.autoCreateWorktreeMinNumber = Math.round(min);
    if (Number.isFinite(max) && max >= this.autoCreateWorktreeMinNumber) this.autoCreateWorktreeMaxNumber = Math.round(max);
  }

  getNextWorktreeIdForRepo(repo, { minNumber } = {}) {
    const min = Number.isFinite(Number(minNumber)) ? Number(minNumber) : this.autoCreateWorktreeMinNumber;
    const entries = Array.isArray(repo?.worktreeDirs) ? repo.worktreeDirs : [];
    let maxExisting = 0;
    for (const e of entries) {
      const id = String(e?.id || '');
      const m = id.match(/^work(\d+)$/i);
      if (!m) continue;
      const n = Number(m[1]);
      if (Number.isFinite(n)) maxExisting = Math.max(maxExisting, n);
    }
    const start = Math.max(min, maxExisting + 1);
    return `work${start}`;
  }

  async autoCreateExtraWorktreeForRepo(repo, { startTier, worktreeId } = {}) {
    if (!repo?.path || !repo?.name) return null;
    if (!this.currentWorkspace?.id) return null;

    const tier = Number(startTier);
    const startTierSafe = (tier >= 1 && tier <= 4) ? tier : undefined;

    const nextId = String(worktreeId || '').trim() || this.getNextWorktreeIdForRepo(repo);
    const nextNumber = Number(nextId.replace(/^work/i, ''));
    if (!Number.isFinite(nextNumber) || nextNumber > this.autoCreateWorktreeMaxNumber) {
      this.showToast(`Auto-create limit reached (max work${this.autoCreateWorktreeMaxNumber})`, 'warning');
      return null;
    }

    // Mixed-repo workspaces can add an arbitrary repo+worktree pair.
    if (this.currentWorkspace.workspaceType === 'mixed-repo') {
      // Avoid broadcasting `worktree-sessions-added` to all clients if we can't target this socket.
      if (!this.socket?.id) return null;
      const res = await fetch('/api/workspaces/add-mixed-worktree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: this.currentWorkspace.id,
          repositoryPath: repo.path,
          repositoryType: repo.type,
          repositoryName: repo.name,
          worktreeId: nextId,
          socketId: this.socket?.id || null,
          startTier: startTierSafe
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to auto-create worktree');
      return { id: nextId, path: `${repo.path}/${nextId}` };
    }

    // Single-repo workspace: only if the repo matches the current workspace repo.
    const workspaceRepoPath = String(this.currentWorkspace.repository?.path || '').replace(/\/+$/, '');
    const repoPath = String(repo.path || '').replace(/\/+$/, '');
    if (workspaceRepoPath && repoPath && workspaceRepoPath === repoPath) {
      const res = await fetch('/api/workspaces/create-worktree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: this.currentWorkspace.id,
          repositoryPath: repo.path,
          worktreeNumber: nextNumber
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to auto-create worktree');

      // Ensure we apply the tier when sessions arrive (handled by server emit when we add sessions).
      setTimeout(() => {
        this.socket?.emit?.('add-worktree-sessions', {
          worktreeId: data.worktreeId,
          worktreePath: data.path,
          repositoryName: null,
          repositoryType: this.currentWorkspace.repository?.type,
          repositoryRoot: repo.path,
          startTier: startTierSafe
        });
      }, 200);

      return { id: data.worktreeId, path: data.path };
    }

    return null;
  }

  setFocusHideTier2WhenTier1Busy(enabled) {
    const next = !!enabled;
    if (this.focusHideTier2WhenTier1Busy === next) return;
    this.focusHideTier2WhenTier1Busy = next;
    this.updateWorkflowModeButtons();
    this.updateTerminalGrid();
    this.buildSidebar();
    this.updateGlobalUserSetting('ui.workflow.focus.hideTier2WhenTier1Busy', next);
  }

  setFocusAutoSwapTier2WhenTier1Busy(enabled) {
    const next = !!enabled;
    if (this.focusAutoSwapTier2WhenTier1Busy === next) return;
    this.focusAutoSwapTier2WhenTier1Busy = next;
    this.updateWorkflowModeButtons();
    this.updateTerminalGrid();
    this.buildSidebar();
    this.updateGlobalUserSetting('ui.workflow.focus.autoSwapToTier2WhenTier1Busy', next);
  }

  updateWorkflowModeButtons() {
    const focusBtn = document.getElementById('workflow-focus');
    const reviewBtn = document.getElementById('workflow-review');
    const backgroundBtn = document.getElementById('workflow-background');
    if (!focusBtn || !reviewBtn || !backgroundBtn) return;

    focusBtn.classList.toggle('active', this.workflowMode === 'focus');
    reviewBtn.classList.toggle('active', this.workflowMode === 'review');
    backgroundBtn.classList.toggle('active', this.workflowMode === 'background');

    focusBtn.setAttribute('aria-pressed', this.workflowMode === 'focus' ? 'true' : 'false');
    reviewBtn.setAttribute('aria-pressed', this.workflowMode === 'review' ? 'true' : 'false');
    backgroundBtn.setAttribute('aria-pressed', this.workflowMode === 'background' ? 'true' : 'false');

    const tier2Btn = document.getElementById('workflow-focus-tier2');
    if (tier2Btn) {
      const show = this.workflowMode === 'focus';
      tier2Btn.classList.toggle('hidden', !show);
      tier2Btn.classList.toggle('focus-tier2-on', this.focusHideTier2WhenTier1Busy);
      tier2Btn.textContent = this.focusHideTier2WhenTier1Busy ? 'T2 Auto' : 'T2 Always';
      tier2Btn.setAttribute('aria-pressed', this.focusHideTier2WhenTier1Busy ? 'true' : 'false');
      tier2Btn.title = this.focusHideTier2WhenTier1Busy
        ? (this.tier1Busy ? 'Focus: Tier 2 hidden while Tier 1 is busy' : 'Focus: Tier 2 will show when Tier 1 is idle')
        : 'Focus: Tier 2 always visible';
    }

    const swapBtn = document.getElementById('workflow-focus-autoswap');
    if (swapBtn) {
      const show = this.workflowMode === 'focus';
      swapBtn.classList.toggle('hidden', !show);
      swapBtn.classList.toggle('focus-autoswap-on', this.focusAutoSwapTier2WhenTier1Busy);
      swapBtn.textContent = 'Swap T2';
      swapBtn.setAttribute('aria-pressed', this.focusAutoSwapTier2WhenTier1Busy ? 'true' : 'false');
      swapBtn.title = this.focusAutoSwapTier2WhenTier1Busy
        ? (this.tier1Busy ? 'Focus: showing Tier 2 while Tier 1 is busy' : 'Focus: will show Tier 2 when Tier 1 becomes busy')
        : 'Focus: do not auto-swap while Tier 1 is busy';
    }
  }

  startProcessStatusBanner() {
    const renderInto = (banner, status) => {
      if (!banner) return;
      if (!banner.dataset.bound) {
        banner.dataset.bound = 'true';
        banner.addEventListener('click', () => this.showQueuePanel());
      }

      if (!status || typeof status !== 'object') {
        banner.innerHTML = `<span class="process-chip level-warn">WIP —</span><span class="process-chip">T1 —</span><span class="process-chip">T2 —</span><span class="process-chip">T3 —</span><span class="process-chip">T4 —</span>`;
        return;
      }

      const level = status.level === 'warn' || status.level === 'blocked' ? status.level : 'ok';
      const q = status.qByTier || {};
      banner.innerHTML = `
        <span class="process-chip level-${level}">WIP ${Number(status.wip ?? 0)}</span>
        <span class="process-chip">T1 ${Number(q[1] ?? 0)}</span>
        <span class="process-chip">T2 ${Number(q[2] ?? 0)}</span>
        <span class="process-chip">T3 ${Number(q[3] ?? 0)}</span>
        <span class="process-chip">T4 ${Number(q[4] ?? 0)}</span>
      `;
    };

    const render = (status) => {
      renderInto(document.getElementById('process-banner'), status);
      renderInto(document.getElementById('dashboard-process-banner'), status);
    };

    const refresh = async () => {
      try {
        const prev = this.processStatus;
        const res = await fetch(`${window.location.origin}/api/process/status?mode=mine`);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const status = await res.json();
        this.processStatus = status;
        render(status);

        // Notification modes (best-effort; toast-only by default).
        try {
          const cfg = this.getWorkflowNotificationConfig();
          if (cfg.mode !== 'quiet' && cfg.tier1Interrupts) {
            const prevT1 = Number(prev?.qByTier?.[1] ?? 0);
            const nextT1 = Number(status?.qByTier?.[1] ?? 0);
            const now = Date.now();
            const last = Number(this.lastTier1InterruptToastAt || 0);
            if (nextT1 > 0 && prevT1 === 0 && (now - last > 90_000)) {
              this.lastTier1InterruptToastAt = now;
              this.notifyWorkflow({
                type: 'waiting',
                message: `Tier 1 queue: ${nextT1}`,
                metadata: { kind: 'tier1_interrupt', tier: 1, count: nextT1 }
              });
            }
          }
        } catch {
          // ignore
        }
      } catch (error) {
        console.warn('Failed to refresh process status', error);
        render(null);
      }
    };

    if (this.processStatusInterval) clearInterval(this.processStatusInterval);
    this.processStatusInterval = setInterval(refresh, 30_000);
    refresh();
  }

  async ensureLaunchAllowedForSession(sessionId) {
    const sessionTier = this.getTierForSession(sessionId);
    const tier = sessionTier === null ? 2 : sessionTier;
    if (!(tier >= 1 && tier <= 4)) return true;

    try {
      const res = await fetch(`${window.location.origin}/api/process/status?mode=mine`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const status = await res.json();
      this.processStatus = status;
      const allowedByTier = status?.launchAllowedByTier || {};
      const isAllowed = allowedByTier[String(tier)] !== false && allowedByTier[tier] !== false;
      if (isAllowed) return true;

      const q = status?.qByTier || {};
      const caps = status?.qCaps || {};
      const reasons = Array.isArray(status?.reasons) ? status.reasons : [];
      const msg = [
        `Launch gate: current workload is high.`,
        ``,
        `WIP ${status?.wip ?? 0}/${status?.wipMax ?? ''}`,
        `T1 ${q[1] ?? 0}  T2 ${q[2] ?? 0}  T3 ${q[3] ?? 0}  T4 ${q[4] ?? 0}`,
        `Caps: T1+T2 ${caps.q12 ?? ''}  T3 ${caps.q3 ?? ''}  T4 ${caps.q4 ?? ''}`,
        reasons.length ? `Reasons: ${reasons.join(', ')}` : '',
        ``,
        `Start Tier ${tier} anyway?`
      ].filter(Boolean).join('\n');

      return window.confirm(msg);
    } catch (error) {
      console.warn('Failed to check launch gate, allowing start', error);
      return true;
    }
  }

  refreshTier1Busy({ suppressRerender } = {}) {
    const prev = this.tier1Busy;
    this.tier1Busy = this.computeTier1Busy();
    if (prev !== this.tier1Busy) {
      this.updateWorkflowModeButtons();
      if (!suppressRerender && this.workflowMode === 'focus' && (this.focusHideTier2WhenTier1Busy || this.focusAutoSwapTier2WhenTier1Busy)) {
        this.updateTerminalGrid();
        this.buildSidebar();
      }
    }
  }

  computeTier1Busy() {
    for (const [sessionId, session] of this.sessions) {
      if (!this.matchesViewMode(sessionId)) continue;
      if (!(session?.type === 'claude' || String(sessionId).includes('-claude'))) continue;

      const tier = this.getTierForSession(sessionId);
      if (tier !== 1) continue;

      const status = String(session?.status || '').toLowerCase();
      if (status === 'busy' || status === 'starting' || status === 'restarting' || status === 'running') {
        return true;
      }
    }
    return false;
  }

  hasAnyTierSession(targetTier) {
    const target = Number(targetTier);
    if (!(target >= 1 && target <= 4)) return false;
    for (const [sessionId] of this.sessions) {
      if (!this.matchesViewMode(sessionId)) continue;
      const tier = this.getTierForSession(sessionId);
      if (tier === target) return true;
    }
    return false;
  }

  matchesWorkflowMode(sessionId) {
    if (this.workflowMode === 'review') return true;
    const tier = this.getTierForSession(sessionId);

    if (this.workflowMode === 'focus') {
      if (this.focusAutoSwapTier2WhenTier1Busy && this.tier1Busy) {
        const hasTier2 = this.hasAnyTierSession(2);
        if (hasTier2) {
          return tier === 2;
        }
      }

      if (tier === 1) return true;
      if (tier !== 2) return false;
      if (!this.focusHideTier2WhenTier1Busy) return true;
      return !this.tier1Busy;
    }

    if (this.workflowMode === 'background') {
      return tier === 3 || tier === 4;
    }

    return true;
  }

  getPRTaskIdFromUrl(url) {
    const raw = String(url || '').trim();
    const m = raw.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!m) return null;
    const [, owner, repo, prNum] = m;
    return `pr:${owner}/${repo}#${prNum}`;
  }

  getTierForSession(sessionId) {
    const session = this.sessions.get(sessionId);
    const prUrl = this.githubLinks.get(sessionId)?.pr || null;
    const prTaskId = prUrl ? this.getPRTaskIdFromUrl(prUrl) : null;
    if (prTaskId) {
      const record = this.taskRecords.get(prTaskId);
      const tier = Number(record?.tier);
      if (tier >= 1 && tier <= 4) return tier;
    }

    const worktreePath = session?.config?.cwd || session?.cwd || session?.worktreePath || null;
    if (worktreePath) {
      const record = this.taskRecords.get(`worktree:${worktreePath}`);
      const tier = Number(record?.tier);
      if (tier >= 1 && tier <= 4) return tier;
    }

    const record = this.taskRecords.get(`session:${sessionId}`);
    const tier = Number(record?.tier);
    if (tier >= 1 && tier <= 4) return tier;

    return null;
  }
	  
	  matchesViewMode(sessionId) {
	    if (this.viewMode === 'all') return true;
	
	    const session = this.sessions.get(sessionId);
	    const type = session?.type;
	
	    if (this.viewMode === 'claude') {
	      return type === 'claude' || sessionId.includes('-claude');
	    }
	
	    if (this.viewMode === 'server') {
	      return type === 'server' || sessionId.includes('-server');
	    }
	
	    return true;
	  }

  isSessionVisibleInCurrentView(sessionId) {
    const session = this.sessions.get(sessionId);
    // Background-launched worktrees intentionally do not auto-show in Review/Focus,
    // but they should become visible when the user explicitly switches to Background mode.
    const backgroundLaunch = !!session?.backgroundLaunch;
    const visibleByWorktreeToggle = this.visibleTerminals.has(sessionId)
      || (this.workflowMode === 'background' && backgroundLaunch);

	    return visibleByWorktreeToggle
        && this.matchesViewMode(sessionId)
        && this.matchesTierFilter(sessionId)
        && this.matchesWorkflowMode(sessionId);
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
      interrupt: {
        icon: '⛔',
        title: 'Interrupt (Ctrl+C)',
        action: 'interruptSession',
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
      interruptSession: `window.orchestrator.interruptSession('${sessionId}')`,
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
        this.renderButton('interrupt', this.buttonRegistry.interrupt, sessionId),
        this.renderButton('review', this.buttonRegistry.review, sessionId),
        this.renderButton('build', this.buttonRegistry.build, sessionId)
      ];
    } else {
      return [
        this.renderButton('focus', this.buttonRegistry.focus, sessionId),
        this.renderButton('build', this.buttonRegistry.build, sessionId),
        this.renderButton('interrupt', this.buttonRegistry.interrupt, sessionId),
        this.renderButton('kill', this.buttonRegistry.kill, sessionId)
      ];
    }
  }

  getTierDropdownHTML(sessionId) {
    const tier = this.getTierForSession(sessionId);
    const tierValue = tier ? String(tier) : '';
    return `
      <select class="tier-dropdown" data-session-id="${sessionId}" aria-label="Tier" title="Tier" onchange="window.orchestrator.setTierForSession('${sessionId}', this.value)">
        <option value="" ${tierValue === '' ? 'selected' : ''}>None</option>
        <option value="1" ${tierValue === '1' ? 'selected' : ''}>T1</option>
        <option value="2" ${tierValue === '2' ? 'selected' : ''}>T2</option>
        <option value="3" ${tierValue === '3' ? 'selected' : ''}>T3</option>
        <option value="4" ${tierValue === '4' ? 'selected' : ''}>T4</option>
      </select>
    `;
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

  getLinkedServerSessionIdForClaude(claudeSessionId) {
    const sid = String(claudeSessionId || '').trim();
    if (!sid.endsWith('-claude')) return null;
    const serverSessionId = sid.replace(/-claude$/, '-server');
    if (!this.sessions || !this.sessions.has(serverSessionId)) return null;
    return serverSessionId;
  }

  getLinkedClaudeSessionIdForServer(serverSessionId) {
    const sid = String(serverSessionId || '').trim();
    if (!sid.endsWith('-server')) return null;
    const claudeSessionId = sid.replace(/-server$/, '-claude');
    if (!this.sessions || !this.sessions.has(claudeSessionId)) return null;
    return claudeSessionId;
  }

  getServerQuickControlsHTMLForClaude(claudeSessionId) {
    const serverSessionId = this.getLinkedServerSessionIdForClaude(claudeSessionId);
    if (!serverSessionId) return '';

    const isRunning = this.serverStatuses.get(serverSessionId) === 'running';
    if (isRunning) {
      return `<button class="control-btn" onclick="window.orchestrator.toggleServer('${serverSessionId}')" title="Stop Server">⏹S</button>`;
    }
    return `<button class="control-btn" onclick="window.orchestrator.toggleServer('${serverSessionId}', 'development')" title="Start Server (dev)">▶S</button>`;
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
      const backgroundMode = this.workflowMode === 'background';
      const isVisible = (worktree.claude && (this.visibleTerminals.has(worktree.claude.sessionId) || (backgroundMode && worktree.claude.backgroundLaunch))) ||
                       (worktree.server && (this.visibleTerminals.has(worktree.server.sessionId) || (backgroundMode && worktree.server.backgroundLaunch)));
      
      const item = document.createElement('div');
      // Only show visibility state, not activity state (activity filtering is handled separately)
      item.className = `worktree-item ${!isVisible ? 'hidden-terminal' : ''}`;
      item.dataset.worktreeId = worktree.id;
      item.title = 'Click to toggle • Ctrl+Click to show only this worktree';

      const branch = worktree.claude?.branch || worktree.server?.branch || 'unknown';
      const displayName = worktree.displayName;

      // Single-dot sidebar status: prefer the agent (Claude) status
      const sidebarStatus = worktree.claude?.status || worktree.server?.status || 'idle';

      const agentId = worktree.claude?.agent || worktree.server?.agent || null;
      const statusTitleParts = [
        `Status: ${sidebarStatus}`,
        agentId ? `Agent: ${agentId}` : null
      ].filter(Boolean);
      const statusTitle = statusTitleParts.join(' • ');

	      const worktreePath = this.getWorktreePathForSidebarEntry(worktree);
	      const isReadyForReview = !!(worktreePath && this.worktreeTags.get(worktreePath)?.readyForReview);
	      const readyTitle = isReadyForReview ? 'Ready for review (click to clear)' : 'Mark ready for review';

	      const tierSessionId = worktree.claude?.sessionId || worktree.server?.sessionId || null;
	      const tier = tierSessionId ? this.getTierForSession(tierSessionId) : null;
	      const tierMatches = this.tierFilter === 'all'
	        ? true
	        : (this.tierFilter === 'none' ? tier === null : tier === this.tierFilter);
	      if (!tierMatches) continue;
	      if (tierSessionId && !this.matchesWorkflowMode(tierSessionId)) continue;

	      const tierBadge = tier ? `<span class="worktree-tier-badge tier-${tier}" title="Tier ${tier}">T${tier}</span>` : '';

	      item.innerHTML = `
	        <div class="worktree-header">
	          <div class="worktree-title">
	            <span class="status-dot worktree-status-dot ${sidebarStatus}" title="${this.escapeHtml(statusTitle)}"></span>
	            <div class="worktree-text">
	              <div class="worktree-name" title="${this.escapeHtml(displayName)}">${displayName}</div>
	              <div class="worktree-meta">
	                ${tierBadge}
	                <span class="worktree-branch" title="${this.escapeHtml(branch)}">@${branch}</span>
	              </div>
	            </div>
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

  async loadTaskRecords() {
    try {
      const response = await fetch('/api/process/task-records');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json().catch(() => ({}));
      const records = Array.isArray(data.records) ? data.records : [];

      this.taskRecords = new Map();
      for (const r of records) {
        if (!r?.id) continue;
        this.taskRecords.set(r.id, r.record || {});
      }

      // If sessions already exist, tier badges/filters can update immediately.
      this.buildSidebar();
      this.updateTerminalGrid();
      return this.taskRecords;
    } catch (error) {
      console.warn('Failed to load task records:', error);
      return null;
    }
  }

  async upsertTaskRecord(id, patch) {
    const taskId = String(id || '').trim();
    if (!taskId) throw new Error('Missing task record id');

    const res = await fetch(`/api/process/task-records/${encodeURIComponent(taskId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch || {})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || 'Failed to save task record');
    return data.record || null;
  }

  async setTierForSession(sessionId, tierValue) {
    const sid = String(sessionId || '').trim();
    if (!sid) return;

    const raw = String(tierValue ?? '').trim();
    const tier = raw ? Number(raw) : null;
    const nextTier = (tier >= 1 && tier <= 4) ? tier : null;

    try {
      const recordId = `session:${sid}`;
      const rec = await this.upsertTaskRecord(recordId, { tier: nextTier });
      if (rec) this.taskRecords.set(recordId, rec);
      else this.taskRecords.delete(recordId);

      this.refreshTier1Busy();
      this.buildSidebar();
      this.updateTerminalGrid();
      this.showToast(nextTier ? `Tier set to T${nextTier}` : 'Tier cleared', 'success');
    } catch (e) {
      this.showToast(String(e?.message || e), 'error');
      // Re-render to ensure the selector reflects stored data.
      this.buildSidebar();
      this.updateTerminalGrid();
    }
  }

  cycleTierForSession(sessionId, delta) {
    const sid = String(sessionId || '').trim();
    if (!sid) return;
    const direction = Number(delta) || 0;
    if (direction === 0) return;

    const tierSequence = [null, 1, 2, 3, 4];
    const currentTier = this.getTierForSession(sid);
    const currentIndex = tierSequence.findIndex((t) => t === (currentTier ?? null));
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (safeIndex + direction + tierSequence.length) % tierSequence.length;
    const nextTier = tierSequence[nextIndex];

    this.setTierForSession(sid, nextTier ? String(nextTier) : '');
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
	      <div class="filter-toggle-row">
	        <button class="${this.showActiveOnly ? 'active' : ''}" onclick="window.orchestrator.toggleActivityFilter()">
	          ${this.showActiveOnly ? 'Show All' : 'Active Only'}
	        </button>
	      </div>
	      <div class="filter-toggle-row filter-toggle-tier" role="group" aria-label="Tier filter">
	        <button class="${this.tierFilter === 'all' ? 'active' : ''}" onclick="window.orchestrator.setTierFilter('all')" title="Show all tiers">All</button>
	        <button class="${this.tierFilter === 1 ? 'active' : ''}" onclick="window.orchestrator.setTierFilter('1')" title="Tier 1">T1</button>
	        <button class="${this.tierFilter === 2 ? 'active' : ''}" onclick="window.orchestrator.setTierFilter('2')" title="Tier 2">T2</button>
	        <button class="${this.tierFilter === 3 ? 'active' : ''}" onclick="window.orchestrator.setTierFilter('3')" title="Tier 3">T3</button>
	        <button class="${this.tierFilter === 4 ? 'active' : ''}" onclick="window.orchestrator.setTierFilter('4')" title="Tier 4">T4</button>
	        <button class="${this.tierFilter === 'none' ? 'active' : ''}" onclick="window.orchestrator.setTierFilter('none')" title="No tier set">None</button>
	      </div>
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
    // Keep derived workflow state up to date before filtering/rending.
    this.refreshTier1Busy({ suppressRerender: true });

    // Get ALL sessions (works for both traditional and mixed-repo workspaces)
    const allSessions = Array.from(this.sessions.keys());
    this.renderTerminalsWithVisibility(allSessions);
  }
  
	  renderTerminalsWithVisibility(sessionIds) {
	    // Render all terminals but apply visibility using CSS (don't destroy DOM)
	    this.activeView = sessionIds.filter(id => this.isSessionVisibleInCurrentView(id));
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
	      const isVisible = this.isSessionVisibleInCurrentView(sessionId);
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
	    this.setViewMode('claude');
	  }
	  
	  showServersOnly() {
	    this.setViewMode('server');
	  }
	  
	  applyPreset(preset) {
	    this.visibleTerminals.clear();
	    
	    switch (preset) {
	      case 'all':
	        this.showAllTerminals();
	        this.setViewMode('all');
	        break;
	      case 'claude-all':
	        this.showAllTerminals();
	        this.setViewMode('claude');
	        break;
	      case 'servers-all':
	        this.showAllTerminals();
	        this.setViewMode('server');
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
    wrapper.addEventListener('mousedown', () => {
      this.lastInteractedSessionId = sessionId;
    });
    
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
            ${this.getTierDropdownHTML(sessionId)}
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
    // Update session data
    const session = this.sessions.get(sessionId);
    const previousStatus = session ? session.status : null;
    if (session) {
      session.status = status;
      this.refreshTier1Busy();

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

    // UI stabilizer: avoid rapid busy→idle flicker in status indicators.
    // (Session state updates remain immediate; only the visual dot is delayed.)
    if (statusElement) {
      if (!this.sessionStatusUiTimers) this.sessionStatusUiTimers = new Map();
      const existing = this.sessionStatusUiTimers.get(sessionId);
      if (existing) clearTimeout(existing);

      const apply = (next) => {
        statusElement.className = `status-indicator ${next}`;
        statusElement.title = next;
      };

      const shouldDelayIdle = next =>
        next === 'idle' && (previousStatus === 'busy' || previousStatus === 'waiting');

      if (shouldDelayIdle(status)) {
        const timer = setTimeout(() => {
          this.sessionStatusUiTimers.delete(sessionId);
          const current = this.sessions.get(sessionId);
          if (current && current.status !== 'idle') return;
          apply('idle');
        }, 1500);
        this.sessionStatusUiTimers.set(sessionId, timer);
      } else {
        apply(status);
      }
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
      if (!this.sidebarStatusUi) this.sidebarStatusUi = new Map();
      if (!this.sidebarStatusUiTimers) this.sidebarStatusUiTimers = new Map();

      const prev = this.sidebarStatusUi.get(key) || 'idle';
      if (prev === status) return;

      const existing = this.sidebarStatusUiTimers.get(key);
      if (existing) clearTimeout(existing);

      const apply = (next) => {
        dot.className = `status-dot worktree-status-dot ${next}`;
        this.sidebarStatusUi.set(key, next);
      };

      const shouldDelayIdle = (next) =>
        next === 'idle' && (prev === 'busy' || prev === 'waiting');

      if (shouldDelayIdle(status)) {
        const timer = setTimeout(() => {
          this.sidebarStatusUiTimers.delete(key);
          const current = this.sessions.get(sessionId);
          if (current && current.status !== 'idle') return;
          apply('idle');
        }, 1500);
        this.sidebarStatusUiTimers.set(key, timer);
      } else {
        apply(status);
      }
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
    const wrapper = document.getElementById(`wrapper-${sessionId}`);
    if (!wrapper) return;
    const controlsDiv = wrapper.querySelector('.terminal-controls');
    if (!controlsDiv) return;

    if (sessionId.includes('-claude')) {
      controlsDiv.innerHTML = `
        ${this.getTierDropdownHTML(sessionId)}
        ${this.getServerQuickControlsHTMLForClaude(sessionId)}
        ${this.getButtonsForSession(sessionId, 'claude').join('\n')}
        ${this.getGitHubButtons(sessionId)}
      `;
      return;
    }

    // Server terminals: keep the existing launch controls.
    controlsDiv.innerHTML = this.getServerControlsHTML(sessionId);
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
      const linkedClaude = this.getLinkedClaudeSessionIdForServer(sessionId);
      if (linkedClaude) this.updateTerminalControls(linkedClaude);
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
      const linkedClaude = this.getLinkedClaudeSessionIdForServer(sessionId);
      if (linkedClaude) this.updateTerminalControls(linkedClaude);
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

  interruptSession(sessionId) {
    // Always prefer a direct socket emit over relying on xterm key handling.
    // This is useful when a CLI tool tells you to Ctrl+C (e.g. `claude --resume` with no conversations).
    try {
      this.sendTerminalInput(sessionId, '\x03');
    } catch (e) {
      console.error('Failed to interrupt session', e);
    }
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

      case 'open-dashboard':
        this.showDashboard?.();
        break;

      case 'open-prs':
        this.showPRsPanel?.();
        break;

      case 'open-telemetry':
        try {
          this.showDashboard?.();
          setTimeout(() => {
            try {
              this.dashboard?.showTelemetryOverlay?.();
            } catch {}
          }, 50);
        } catch (e) {
          console.error('Failed to open telemetry overlay:', e);
        }
        break;

      case 'open-queue':
        this.showQueuePanel?.().catch?.((err) => console.error('Failed to open queue:', err));
        break;

      case 'queue-next':
        this.showQueuePanel?.()
          .then(() => setTimeout(() => document.getElementById('queue-next')?.click?.(), 50))
          .catch?.((err) => console.error('Failed to open queue next:', err));
        break;

      case 'queue-blockers':
        this.showQueuePanel?.()
          .then(() => setTimeout(() => {
            const btn = document.getElementById('queue-blocked');
            if (btn && !btn.classList.contains('active')) btn.click();
          }, 50))
          .catch?.((err) => console.error('Failed to open queue blockers:', err));
        break;

      case 'queue-triage':
        this.showQueuePanel?.()
          .then(() => setTimeout(() => {
            const btn = document.getElementById('queue-triage');
            if (btn && !btn.classList.contains('active')) btn.click();
          }, 50))
          .catch?.((err) => console.error('Failed to open queue triage:', err));
        break;

      case 'queue-conveyor-t2':
        this.showQueuePanel?.()
          .then(() => setTimeout(() => document.getElementById('queue-conveyor-t2')?.click?.(), 50))
          .catch?.((err) => console.error('Failed to open queue conveyor t2:', err));
        break;

      case 'open-tasks':
        this.showTasksPanel?.().catch?.((err) => console.error('Failed to open tasks:', err));
        break;

      case 'open-advice':
        if (this.commanderPanel) {
          this.commanderPanel.show();
          this.commanderPanel.showAdvice?.().catch?.((err) => console.error('Failed to open advice:', err));
        }
        break;

      case 'set-workflow-mode': {
        const mode = String(params?.mode || '').toLowerCase();
        if (mode) this.setWorkflowMode(mode);
        break;
      }

      case 'set-focus-tier2': {
        const behavior = String(params?.behavior || '').toLowerCase();
        if (behavior === 'auto') this.setFocusHideTier2WhenTier1Busy(true);
        else if (behavior === 'always') this.setFocusHideTier2WhenTier1Busy(false);
        break;
      }

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

    // Background scheduling rule: while you're in Focus/Review, don't spam toast/browser
    // notifications for Tier 3/4 agents. Route them into the workflow notification
    // system (respecting the user's notification mode) and let Background triage handle it.
    try {
      const tier = this.getTierForSession(sessionId);
      if ((tier === 3 || tier === 4) && this.workflowMode !== 'background') {
        const worktreeId = String(sessionId || '').replace('-claude', '');
        const session = this.sessions.get(sessionId);
        const branch = session ? session.branch : '';
        this.notifyWorkflow?.({
          type: 'info',
          message: `Background agent ready: Claude ${worktreeId}${branch ? ` (${branch})` : ''}`,
          sessionId,
          metadata: { kind: 'background_ready', tier }
        });
        return;
      }
    } catch {
      // ignore
    }

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

    // Keep terminals visually consistent with UI theme.
    this.terminalManager?.updateTheme?.(this.settings.theme);
  }

  applyThemeFromUserSettings() {
    const userTheme = this.userSettings?.global?.ui?.theme;
    if (userTheme !== 'dark' && userTheme !== 'light') return;
    if (this.settings.theme === userTheme) return;

    this.settings.theme = userTheme;
    this.saveSettings();
    this.applyTheme();

    const themeSelect = document.getElementById('theme-select');
    if (themeSelect) themeSelect.value = userTheme;
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

  getWorkflowNotificationConfig() {
    const cfg = this.userSettings?.global?.ui?.workflow?.notifications || {};
    const modeRaw = String(cfg.mode || 'quiet').trim().toLowerCase();
    const mode = (modeRaw === 'quiet' || modeRaw === 'normal' || modeRaw === 'aggressive') ? modeRaw : 'quiet';
    return {
      mode,
      tier1Interrupts: cfg.tier1Interrupts !== false,
      reviewCompleteNudges: cfg.reviewCompleteNudges !== false
    };
  }

  notifyWorkflow({ type = 'info', message = '', sessionId = null, metadata = null } = {}) {
    const msg = String(message || '').trim();
    if (!msg) return;

    const cfg = this.getWorkflowNotificationConfig();

    try {
      this.notificationManager?.handleNotification?.({
        type,
        message: msg,
        sessionId: sessionId || undefined,
        metadata: (metadata && typeof metadata === 'object') ? metadata : undefined
      });
    } catch {
      // ignore
    }

    const toastType = type === 'error'
      ? 'error'
      : (type === 'waiting' ? 'warning' : (type === 'completed' ? 'success' : 'info'));

    if (cfg.mode === 'aggressive') {
      this.showToast?.(msg, toastType);
      return;
    }

    if (cfg.mode === 'normal') {
      // Only toast for higher-signal events.
      if (toastType === 'warning' || toastType === 'error' || toastType === 'success') {
        this.showToast?.(msg, toastType);
      }
    }
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

    // Note: scroll to the terminal if needed
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
  
  async startClaudeWithOptions(sessionId, mode, skipPermissions) {
    if (!this.socket || !this.socket.connected) {
      this.showError('Not connected to server');
      return;
    }

    const allowed = await this.ensureLaunchAllowedForSession(sessionId);
    if (!allowed) {
      this.showToast('Launch blocked by workload gate', 'warning');
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
  async startAgentWithConfig(sessionId, config) {
    if (!this.socket || !this.socket.connected) {
      this.showError('Not connected to server');
      return;
    }

    const allowed = await this.ensureLaunchAllowedForSession(sessionId);
    if (!allowed) {
      this.showToast('Launch blocked by workload gate', 'warning');
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

  /**
   * If the user manually types into a Claude terminal, treat that as "I'm handling startup myself".
   * This prevents the Fresh/Continue/Resume overlay from popping up while the user runs `claude ...` manually.
   */
  onManualTerminalInput(sessionId) {
    const sid = String(sessionId || '').trim();
    if (!sid || !sid.includes('-claude')) return;

    const session = this.sessions?.get?.(sid);
    const startupUI = document.getElementById(`startup-ui-${sid}`);
    const isVisible = startupUI && startupUI.style.display === 'block';

    // Only suppress if the terminal is idle (shell) or the startup UI is currently visible.
    // Avoid suppressing during normal Claude "waiting for input" interactions.
    const isShellIdle = session?.status === 'idle';
    if (!isShellIdle && !isVisible) return;

    if (startupUI) startupUI.style.display = 'none';
    this.dismissedStartupUI.set(sid, true);
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
        this.applyThemeFromUserSettings();
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

    // Update diff viewer settings UI
    const diffViewerThemeSelect = document.getElementById('diff-viewer-theme');
    if (diffViewerThemeSelect) {
      diffViewerThemeSelect.value = this.userSettings.global?.ui?.diffViewer?.theme || 'light';
    }

    // Sync UI theme (light/dark) from server settings if present.
    const themeSelect = document.getElementById('theme-select');
    if (themeSelect) {
      const theme = this.userSettings.global?.ui?.theme;
      if (theme === 'light' || theme === 'dark') {
        themeSelect.value = theme;
      }
    }

    const tasksThemeSelect = document.getElementById('tasks-theme-select');
    if (tasksThemeSelect) {
      const tasksTheme = this.userSettings.global?.ui?.tasks?.theme;
      if (tasksTheme === 'light' || tasksTheme === 'dark' || tasksTheme === 'inherit') {
        tasksThemeSelect.value = tasksTheme;
      } else {
        tasksThemeSelect.value = 'inherit';
      }
    }

    // Workflow notification settings UI
    const workflowNotifyMode = document.getElementById('workflow-notify-mode');
    if (workflowNotifyMode) {
      const cfg = this.userSettings.global?.ui?.workflow?.notifications || {};
      const v = String(cfg.mode || 'quiet').trim().toLowerCase();
      workflowNotifyMode.value = (v === 'quiet' || v === 'normal' || v === 'aggressive') ? v : 'quiet';
    }
    const workflowNotifyTier1 = document.getElementById('workflow-notify-tier1-interrupts');
    if (workflowNotifyTier1) {
      const cfg = this.userSettings.global?.ui?.workflow?.notifications || {};
      workflowNotifyTier1.checked = cfg.tier1Interrupts !== false;
    }
    const workflowNotifyReview = document.getElementById('workflow-notify-review-nudges');
    if (workflowNotifyReview) {
      const cfg = this.userSettings.global?.ui?.workflow?.notifications || {};
      workflowNotifyReview.checked = cfg.reviewCompleteNudges !== false;
    }

    const trelloMeUsername = document.getElementById('trello-me-username');
    if (trelloMeUsername) {
      trelloMeUsername.value = this.userSettings.global?.ui?.tasks?.me?.trelloUsername || '';
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

    // Use same-origin API calls so the app works on any port:
    // - Backend-served UI: `/api/*` is handled by the backend.
    // - Client dev-server UI: `/api/*` is proxied to the backend (see `client/dev-server.js`).
    const serverUrl = window.location.origin;

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

  async showTasksPanel() {
    console.log('Opening Tasks panel...');

    this.closeTasksPanel();

    // Always talk to the current origin. In split dev, `client/dev-server.js`
    // proxies `/api` + `/socket.io` to the backend (using `ORCHESTRATOR_PORT`),
    // so hard-coding `:3000` breaks when running the orchestrator on other ports.
    const serverUrl = window.location.origin;
    const ALL_BOARDS_ID = '__all_enabled__';
    const COMBINED_VIEW_ID = '__combined__';

	    const state = {
	      provider: localStorage.getItem('tasks-provider') || 'trello',
	      view: localStorage.getItem('tasks-view') || 'list', // list | board
	      boardId: localStorage.getItem('tasks-board') || '',
	      listId: localStorage.getItem('tasks-list') || '',
      query: '',
      updatedWindow: localStorage.getItem('tasks-updated-window') || 'any', // any | 1h | 24h | 7d | 30d
      sort: localStorage.getItem('tasks-sort') || 'pos', // pos | activity | name
      hideEmptyColumns: localStorage.getItem('tasks-hide-empty') === 'true',
      boardLayout: 'wrap-expand', // scroll | wrap | wrap-expand (board view)
      assigneeFilterMode: 'selected', // selected | any
      assigneeFilterIds: [],
      me: null,
      lists: [],
      boardMembers: [],
      boardLabels: [],
      boards: [],
      boardCustomFields: [],
	      boardMetaCache: new Map(), // boardId -> { lists, members, labels, customFields }
	      selectedCardId: null,
	      restoreDetailCardId: null,
	      showDisabledBoards: localStorage.getItem('tasks-show-disabled-boards') === 'true'
	    };

    // Keep Kanban views left-aligned on open/board switch (avoid “single column stuck on the right”).
    let boardScrollResetNextRender = true;

    const modal = document.createElement('div');
    modal.id = 'tasks-panel';
    modal.className = 'modal tasks-modal';
    modal.setAttribute('dir', 'ltr');
    const tasksThemeSetting = this.userSettings?.global?.ui?.tasks?.theme;
    const resolvedTasksTheme = (tasksThemeSetting === 'light' || tasksThemeSetting === 'dark')
      ? tasksThemeSetting
      : (this.settings.theme === 'light' ? 'light' : 'dark');
    modal.classList.add(`tasks-theme-${resolvedTasksTheme}`);
    modal.innerHTML = `
      <div class="modal-content tasks-content" dir="ltr">
        <div class="modal-header">
          <h2>✅ Tasks</h2>
          <button class="close-btn tasks-close-btn" id="tasks-close-btn" aria-label="Close Tasks" title="Close (Esc)">×</button>
        </div>

		        <div class="tasks-toolbar">
			          <select id="tasks-provider" class="tasks-select" title="Provider"></select>
		            <div class="tasks-board-picker" id="tasks-board-picker">
		              <span class="tasks-board-accent" id="tasks-board-accent" aria-hidden="true" title="Board color"></span>
		              <button class="btn-secondary tasks-board-btn" id="tasks-board-btn" type="button" title="Board">Board</button>
		              <select id="tasks-board" class="tasks-select tasks-select-hidden" title="Board"></select>
		              <div class="tasks-board-menu hidden" id="tasks-board-menu" role="menu" aria-label="Boards"></div>
		            </div>
			          <button class="btn-secondary" id="tasks-board-settings" title="Board mapping / settings">⚙</button>
		              <button class="btn-secondary" id="tasks-board-open-link" title="Open board in browser">🔗</button>
		              <button class="btn-secondary" id="tasks-board-conventions" title="Board conventions wizard (Done list, label tiers, dependencies)">📏</button>
		              <button class="btn-secondary" id="tasks-combined-settings" title="Combined view settings">🧲</button>
		              <select id="tasks-combined-preset" class="tasks-select tasks-select-inline" title="Combined preset"></select>
		              <button class="btn-secondary" id="tasks-hotkeys" title="Hotkeys (?)">⌨</button>
				          <select id="tasks-list" class="tasks-select" title="List"></select>
	            <div class="tasks-launch-defaults" id="tasks-launch-defaults" title="Defaults used by 🚀 quick launch">
              <span class="tasks-launch-defaults-label">🚀</span>
              <div class="tasks-quick-tier-group tasks-launch-default-tier-group" id="tasks-launch-default-tier-group" title="Default tier">
                <button class="btn-secondary tasks-quick-tier-btn" type="button" data-launch-default-tier-btn="1">T1</button>
                <button class="btn-secondary tasks-quick-tier-btn" type="button" data-launch-default-tier-btn="2">T2</button>
                <button class="btn-secondary tasks-quick-tier-btn" type="button" data-launch-default-tier-btn="3">T3</button>
                <button class="btn-secondary tasks-quick-tier-btn" type="button" data-launch-default-tier-btn="4">T4</button>
              </div>
              <div class="tasks-quick-tier-group tasks-launch-default-agent-group" id="tasks-launch-default-agent-group" title="Default agent">
                <button class="btn-secondary tasks-quick-tier-btn" type="button" data-launch-default-agent-btn="claude">Claude</button>
                <button class="btn-secondary tasks-quick-tier-btn" type="button" data-launch-default-agent-btn="codex">Codex</button>
              </div>
              <div class="tasks-quick-tier-group tasks-launch-default-mode-group" id="tasks-launch-default-mode-group" title="Default mode">
                <button class="btn-secondary tasks-quick-tier-btn" type="button" data-launch-default-mode-btn="fresh">Fresh</button>
                <button class="btn-secondary tasks-quick-tier-btn" type="button" data-launch-default-mode-btn="continue">Cont</button>
                <button class="btn-secondary tasks-quick-tier-btn" type="button" data-launch-default-mode-btn="resume">Res</button>
              </div>
              <label class="tasks-toggle tasks-toggle-mini" title="Skip permission prompts (YOLO)">
                <input type="checkbox" id="tasks-launch-default-yolo" />
                <span>YOLO</span>
              </label>
              <label class="tasks-toggle tasks-toggle-mini" title="Auto-send card description as the first prompt">
                <input type="checkbox" id="tasks-launch-default-auto-send" />
                <span>Auto</span>
              </label>
            </div>
          <input type="text" id="tasks-search" class="search-input tasks-search" placeholder="Search cards...">
          <div class="tasks-radio" role="radiogroup" aria-label="Kanban layout" id="tasks-layout" style="display:none">
            <label class="tasks-radio-option"><input type="radio" name="tasks-layout" value="scroll">Scroll</label>
            <label class="tasks-radio-option"><input type="radio" name="tasks-layout" value="wrap">Wrap</label>
            <label class="tasks-radio-option"><input type="radio" name="tasks-layout" value="wrap-expand">Wrap+Expand</label>
          </div>
          <details class="tasks-filter tasks-filter-assignees" id="tasks-assignees-filter">
            <summary class="btn-secondary" title="Filter by assignees">Assignees</summary>
            <div class="tasks-filter-popover">
              <div class="tasks-filter-actions">
                <button class="btn-secondary" type="button" id="tasks-assignees-me">Only me</button>
                <button class="btn-secondary" type="button" id="tasks-assignees-any">Any</button>
              </div>
              <div class="tasks-filter-list" id="tasks-assignees-list"></div>
            </div>
          </details>
          <div class="tasks-radio" role="radiogroup" aria-label="Updated window" id="tasks-updated">
            <label class="tasks-radio-option"><input type="radio" name="tasks-updated" value="any">Any</label>
            <label class="tasks-radio-option"><input type="radio" name="tasks-updated" value="1h">1h</label>
            <label class="tasks-radio-option"><input type="radio" name="tasks-updated" value="24h">24h</label>
            <label class="tasks-radio-option"><input type="radio" name="tasks-updated" value="7d">7d</label>
            <label class="tasks-radio-option"><input type="radio" name="tasks-updated" value="30d">30d</label>
          </div>
          <div class="tasks-radio" role="radiogroup" aria-label="Sort order" id="tasks-sort">
            <label class="tasks-radio-option"><input type="radio" name="tasks-sort" value="pos">Order</label>
            <label class="tasks-radio-option"><input type="radio" name="tasks-sort" value="activity">Recent</label>
            <label class="tasks-radio-option"><input type="radio" name="tasks-sort" value="name">Name</label>
          </div>
          <label class="tasks-toggle" title="Hide empty columns (board view)">
            <input type="checkbox" id="tasks-hide-empty">
            <span>Hide empty</span>
          </label>
          <div class="tasks-view-toggle" role="group" aria-label="Tasks view">
            <button class="btn-secondary tasks-view-btn" id="tasks-view-list" data-view="list" title="List view">List</button>
            <button class="btn-secondary tasks-view-btn" id="tasks-view-board" data-view="board" title="Board view">Board</button>
          </div>
          <button class="btn-primary" id="tasks-new-card" title="Create a new card">➕ New</button>
          <button class="btn-secondary" id="tasks-refresh">🔄 Refresh</button>
        </div>

        <div class="tasks-body">
          <div class="tasks-cards" id="tasks-cards">
            <div class="loading">Loading providers...</div>
          </div>
          <div class="tasks-detail" id="tasks-detail">
            <div class="tasks-detail-empty">Select a card to see details.</div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Centralized close behavior (cleans up resize/keydown handlers).
    this.tasksPanelModalEl = modal;
    modal.querySelector('#tasks-close-btn')?.addEventListener('click', () => this.closeTasksPanel());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.closeTasksPanel();
    });
    this.tasksPanelKeydownHandler = (e) => {
      if (e.key === 'Escape') this.closeTasksPanel();
    };
    document.addEventListener('keydown', this.tasksPanelKeydownHandler);

		    const providerEl = modal.querySelector('#tasks-provider');
		    const boardEl = modal.querySelector('#tasks-board');
	    const boardBtnEl = modal.querySelector('#tasks-board-btn');
		    const boardMenuEl = modal.querySelector('#tasks-board-menu');
				    const boardSettingsBtn = modal.querySelector('#tasks-board-settings');
				    const boardOpenLinkBtn = modal.querySelector('#tasks-board-open-link');
				    const boardConventionsBtn = modal.querySelector('#tasks-board-conventions');
		      const combinedSettingsBtn = modal.querySelector('#tasks-combined-settings');
		      const combinedPresetEl = modal.querySelector('#tasks-combined-preset');
		      const hotkeysBtn = modal.querySelector('#tasks-hotkeys');
			    const listEl = modal.querySelector('#tasks-list');
    const searchEl = modal.querySelector('#tasks-search');
    const updatedEl = modal.querySelector('#tasks-updated');
    const sortEl = modal.querySelector('#tasks-sort');
    const hideEmptyEl = modal.querySelector('#tasks-hide-empty');
    const newCardBtn = modal.querySelector('#tasks-new-card');
    const refreshBtn = modal.querySelector('#tasks-refresh');
    const viewListBtn = modal.querySelector('#tasks-view-list');
    const viewBoardBtn = modal.querySelector('#tasks-view-board');
    const contentEl = modal.querySelector('.tasks-content');
    const bodyEl = modal.querySelector('.tasks-body');
    const cardsEl = modal.querySelector('#tasks-cards');
    const detailEl = modal.querySelector('#tasks-detail');
    const boardAccentEl = modal.querySelector('#tasks-board-accent');
    const launchDefaultsWrapEl = modal.querySelector('#tasks-launch-defaults');
    const launchDefaultTierGroupEl = modal.querySelector('#tasks-launch-default-tier-group');
    const launchDefaultAgentGroupEl = modal.querySelector('#tasks-launch-default-agent-group');
    const launchDefaultModeGroupEl = modal.querySelector('#tasks-launch-default-mode-group');
    const launchDefaultYoloEl = modal.querySelector('#tasks-launch-default-yolo');
    const launchDefaultAutoSendEl = modal.querySelector('#tasks-launch-default-auto-send');
	    let lastSnapshot = null;

	    const boardKey = () => `${state.provider}:${state.boardId}`;

      const sanitizeCssColor = (value) => {
        const v = String(value || '').trim();
        if (!v) return '';
        if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return v;
        if (/^(rgb|rgba|hsl|hsla)\\([0-9., %]+\\)$/.test(v)) return v;
        // Avoid accepting arbitrary words as CSS colors (e.g., Trello uses "sky").
        const keyword = v.toLowerCase();
        const allowed = new Set(['red', 'green', 'blue', 'orange', 'yellow', 'purple', 'pink', 'lime', 'black', 'white', 'gray', 'grey', 'cyan', 'teal', 'magenta']);
        if (allowed.has(keyword)) return keyword;
        return '';
      };

      const resolveBoardAccentColor = (board) => {
        if (!board || typeof board !== 'object') return '';
        const prefs = board?.prefs || {};
        const direct = sanitizeCssColor(prefs?.backgroundColor || prefs?.backgroundTopColor || prefs?.backgroundBottomColor || '');
        if (direct) return direct;

        const background = String(prefs?.background || '').trim().toLowerCase();
        if (!background) return '';

        // Best-effort mapping for Trello color backgrounds.
        const map = {
          blue: '#0079bf',
          orange: '#d29034',
          green: '#519839',
          red: '#b04632',
          purple: '#89609e',
          pink: '#cd5a91',
          lime: '#4bbf6b',
          sky: '#00aecc',
          grey: '#838c91',
          gray: '#838c91',
          black: '#4d4d4d',
          yellow: '#d9b51c'
        };
        return sanitizeCssColor(map[background] || '');
      };

      const setBoardAccent = (value) => {
        const color = sanitizeCssColor(value);
	      const show = !!color && state.boardId && state.boardId !== ALL_BOARDS_ID && state.boardId !== COMBINED_VIEW_ID;
        if (contentEl) {
          if (show) contentEl.style.setProperty('--tasks-board-accent', color);
          else contentEl.style.removeProperty('--tasks-board-accent');
        }
        if (boardAccentEl) {
          boardAccentEl.classList.toggle('is-hidden', !show);
          if (show) boardAccentEl.style.backgroundColor = color;
          else boardAccentEl.style.backgroundColor = '';
        }
      };

	      const syncBoardAccent = () => {
	        const board = Array.isArray(state.boards) ? state.boards.find((b) => b?.id === state.boardId) : null;
	        const color = resolveBoardAccentColor(board);
	        setBoardAccent(color);
	      };

      const getBoardColorById = (boardId) => {
        const bid = String(boardId || '').trim();
        if (!bid || bid === ALL_BOARDS_ID || bid === COMBINED_VIEW_ID) return '';
        const board = Array.isArray(state.boards) ? state.boards.find((b) => b?.id === bid) : null;
        return resolveBoardAccentColor(board);
      };

      const isBoardMenuOpen = () => !!boardMenuEl && !boardMenuEl.classList.contains('hidden');

      let boardMenuQuery = '';
      let boardMenuActiveValue = '';

      const closeBoardMenu = () => {
        if (!boardMenuEl) return;
        boardMenuEl.classList.add('hidden');
        boardBtnEl?.setAttribute?.('aria-expanded', 'false');
        boardMenuQuery = '';
        boardMenuActiveValue = '';
      };

      const renderBoardPicker = () => {
        if (!boardBtnEl || !boardMenuEl || !boardEl) return;

        const selected = String(boardEl.value || '').trim();
        const options = Array.from(boardEl.querySelectorAll('option')).map((opt) => ({
          value: String(opt.value || ''),
          label: String(opt.textContent || '').trim(),
          disabled: !!opt.disabled
        }));

        const selectedOpt = options.find((o) => o.value === selected);
        boardBtnEl.textContent = selectedOpt?.label || 'Board';
        boardBtnEl.setAttribute('aria-haspopup', 'menu');
        boardBtnEl.setAttribute('aria-expanded', isBoardMenuOpen() ? 'true' : 'false');

        const items = options.filter((o) => o.value);
        const q = String(boardMenuQuery || '').trim().toLowerCase();
        const filtered = q
          ? items.filter((o) => {
              const label = String(o.label || o.value || '').toLowerCase();
              const value = String(o.value || '').toLowerCase();
              return label.includes(q) || value.includes(q);
            })
          : items;

        const selectedInFiltered = filtered.some((o) => o.value === selected);
        if (boardMenuActiveValue && !filtered.some((o) => o.value === boardMenuActiveValue)) {
          boardMenuActiveValue = '';
        }
        if (!boardMenuActiveValue) {
          boardMenuActiveValue = selectedInFiltered ? selected : (filtered[0]?.value || '');
        }

        boardMenuEl.innerHTML = `
          <div class="tasks-board-menu-search-wrap" role="none">
            <input id="tasks-board-menu-search" class="tasks-board-menu-search" type="text" placeholder="Filter boards…" autocomplete="off" spellcheck="false" aria-label="Filter boards" />
          </div>
          <div class="tasks-board-menu-items" role="none">
            ${
              filtered.length
                ? filtered
                    .map((o) => {
                      const isSelected = o.value === selected;
                      const isActive = o.value === boardMenuActiveValue;
                      const color = getBoardColorById(o.value);
                      const dot = color
                        ? `<span class="tasks-board-menu-dot" style="background-color:${this.escapeHtml(color)}" aria-hidden="true"></span>`
                        : `<span class="tasks-board-menu-dot is-hidden" aria-hidden="true"></span>`;
                      return `
                        <button type="button" class="tasks-board-menu-item ${isSelected ? 'is-selected' : ''} ${isActive ? 'is-active' : ''}" role="menuitemradio" aria-checked="${isSelected ? 'true' : 'false'}" data-board-menu-value="${this.escapeHtml(o.value)}">
                          ${dot}
                          <span class="tasks-board-menu-label">${this.escapeHtml(o.label || o.value)}</span>
                        </button>
                      `;
                    })
                    .join('')
                : `<div class="tasks-board-menu-empty" role="none">No matching boards.</div>`
            }
          </div>
        `;

        const search = boardMenuEl.querySelector('#tasks-board-menu-search');
        if (search) {
          search.value = boardMenuQuery;
          search.addEventListener('input', () => {
            boardMenuQuery = String(search.value || '');
            renderBoardPicker();
          });
          search.addEventListener('keydown', (e) => {
            const key = e.key;
            if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Enter') return;
            e.preventDefault();
            e.stopPropagation();

            const itemButtons = Array.from(boardMenuEl.querySelectorAll('[data-board-menu-value]'));
            if (itemButtons.length === 0) return;

            const current = itemButtons.find((b) => String(b.getAttribute('data-board-menu-value') || '') === boardMenuActiveValue) || itemButtons[0];
            const idx = Math.max(0, itemButtons.indexOf(current));

            if (key === 'Enter') {
              current?.click?.();
              return;
            }

            const delta = key === 'ArrowDown' ? 1 : -1;
            const next = itemButtons[Math.min(itemButtons.length - 1, Math.max(0, idx + delta))] || current;
            const nextValue = String(next.getAttribute('data-board-menu-value') || '').trim();
            if (nextValue) boardMenuActiveValue = nextValue;
            itemButtons.forEach((b) => b.classList.toggle('is-active', String(b.getAttribute('data-board-menu-value') || '') === boardMenuActiveValue));
            next.scrollIntoView?.({ block: 'nearest' });
          });
        }
      };

      const openBoardMenu = ({ focusSearch = false } = {}) => {
        renderBoardPicker();
        boardMenuEl?.classList?.remove?.('hidden');
        boardBtnEl?.setAttribute?.('aria-expanded', 'true');
        if (focusSearch) {
          const search = boardMenuEl?.querySelector?.('#tasks-board-menu-search');
          try {
            search?.focus?.();
            search?.select?.();
          } catch {
            // ignore
          }
        }
      };

      const closeHotkeysOverlay = () => {
        const existing = modal.querySelector('#tasks-hotkeys-overlay');
        if (existing) existing.remove();
      };

      const closeNewCardOverlay = () => {
        const existing = modal.querySelector('#tasks-new-card-overlay');
        if (existing) existing.remove();
      };

      const openNewCardOverlay = async () => {
        closeNewCardOverlay();

        const bid = String(state.boardId || '').trim();
        if (!bid || bid === ALL_BOARDS_ID || bid === COMBINED_VIEW_ID) {
          this.showToast('Select a single board first', 'warning');
          return;
        }

        let lists = Array.isArray(state.lists) ? state.lists : [];
        if (!lists.length) {
          try {
            lists = await fetchLists({ boardId: bid, refresh: false });
          } catch {
            lists = [];
          }
        }
        lists = (Array.isArray(lists) ? lists : [])
          .filter((l) => l?.id && l?.name && l?.closed !== true);

        if (!lists.length) {
          this.showToast('No lists available on this board', 'warning');
          return;
        }

        const curListId = String(state.listId || '').trim();
        let defaultListId = (curListId && curListId !== '__all__') ? curListId : '';
        if (!defaultListId || !lists.some(l => l.id === defaultListId)) {
          defaultListId = lists[0].id;
        }

        const overlay = document.createElement('div');
        overlay.id = 'tasks-new-card-overlay';
        overlay.className = 'tasks-launch-popover-overlay';
        overlay.innerHTML = `
          <div class="tasks-launch-popover" id="tasks-new-card-popover" role="dialog" aria-label="New task">
            <div class="tasks-launch-popover-header">
              <div class="tasks-launch-popover-title">➕ New task</div>
              <button class="btn-secondary" id="tasks-new-card-close" type="button" title="Close (Esc)">×</button>
            </div>
            <div class="tasks-launch-popover-meta">${this.escapeHtml(bid)}</div>

            <div class="tasks-launch-popover-grid" style="grid-template-columns: 1fr;">
              <label class="tasks-launch-popover-field" style="grid-column: 1 / -1;">
                <span>List</span>
                <select id="tasks-new-card-list" class="tasks-select tasks-select-inline">
                  ${lists.map((l) => `<option value="${this.escapeHtml(l.id)}" ${l.id === defaultListId ? 'selected' : ''}>${this.escapeHtml(l.name)}</option>`).join('')}
                </select>
              </label>
              <label class="tasks-launch-popover-field" style="grid-column: 1 / -1;">
                <span>Title</span>
                <input id="tasks-new-card-title" class="tasks-input" placeholder="Task title…" />
              </label>
              <label class="tasks-launch-popover-field" style="grid-column: 1 / -1;">
                <span>Description</span>
                <textarea id="tasks-new-card-desc" class="tasks-textarea" rows="6" placeholder="(optional)"></textarea>
              </label>
            </div>

            <div class="tasks-launch-popover-actions">
              <button class="btn-primary" id="tasks-new-card-create" type="button">Create</button>
              <button class="btn-secondary" id="tasks-new-card-cancel" type="button">Cancel</button>
            </div>
          </div>
        `;

        modal.querySelector('.tasks-content')?.appendChild(overlay);

        let cleanupKeydown = () => {};
        const close = () => {
          cleanupKeydown();
          closeNewCardOverlay();
        };
        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) close();
        });
        overlay.querySelector('#tasks-new-card-close')?.addEventListener('click', close);
        overlay.querySelector('#tasks-new-card-cancel')?.addEventListener('click', close);

        const titleEl = overlay.querySelector('#tasks-new-card-title');
        titleEl?.focus?.();

        const createBtn = overlay.querySelector('#tasks-new-card-create');
        createBtn?.addEventListener('click', async () => {
          const listId = String(overlay.querySelector('#tasks-new-card-list')?.value || '').trim();
          const title = String(overlay.querySelector('#tasks-new-card-title')?.value || '').trim();
          const desc = String(overlay.querySelector('#tasks-new-card-desc')?.value || '');

          if (!listId) return;
          if (!title) {
            this.showToast('Title is required', 'warning');
            return;
          }

          try {
            if (createBtn) createBtn.disabled = true;
            const created = await createCard({ listId, name: title, desc });
            if (!created?.id) throw new Error('Create succeeded but returned no card id');

            // If user is in list view, ensure we show the list we created into.
            if (state.view === 'list' && listEl) {
              state.listId = listId;
              try { localStorage.setItem('tasks-list', state.listId); } catch {}
              listEl.value = listId;
            }

            close();
            this.showToast('Created', 'success');

            await refreshAll({ force: true });
            const detail = await fetchCardDetail(created.id).catch(() => created);
            if (detail) renderDetail(detail);
          } catch (err) {
            console.error('Create card failed:', err);
            this.showToast(String(err?.message || err), 'error');
          } finally {
            if (createBtn) createBtn.disabled = false;
          }
        });

        const onKeyDown = (e) => {
          if (e.key === 'Escape') close();
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            overlay.querySelector('#tasks-new-card-create')?.click?.();
          }
        };
        document.addEventListener('keydown', onKeyDown);
        cleanupKeydown = () => document.removeEventListener('keydown', onKeyDown);
      };

      const openHotkeysOverlay = () => {
        closeHotkeysOverlay();
        const overlay = document.createElement('div');
        overlay.id = 'tasks-hotkeys-overlay';
        overlay.className = 'tasks-hotkeys-overlay';
        overlay.innerHTML = `
          <div class="tasks-hotkeys-card" role="dialog" aria-label="Tasks hotkeys">
            <div class="tasks-hotkeys-header">
              <div class="tasks-hotkeys-title">⌨ Hotkeys</div>
              <button class="btn-secondary" id="tasks-hotkeys-close" type="button" title="Close (Esc)">×</button>
            </div>
            <div class="tasks-hotkeys-grid">
              <div class="tasks-hotkeys-group">
                <div class="tasks-hotkeys-group-title">Navigate</div>
                <div class="tasks-hotkeys-row"><code>↑</code>/<code>↓</code> select card</div>
                <div class="tasks-hotkeys-row"><code>Enter</code> open details</div>
                <div class="tasks-hotkeys-row"><code>Esc</code> close overlay/panel</div>
              </div>
              <div class="tasks-hotkeys-group">
                <div class="tasks-hotkeys-group-title">Open</div>
                <div class="tasks-hotkeys-row"><code>O</code> open card in browser</div>
                <div class="tasks-hotkeys-row"><code>/</code> focus search</div>
                <div class="tasks-hotkeys-row"><code>B</code> board picker (type to filter)</div>
              </div>
              <div class="tasks-hotkeys-group">
                <div class="tasks-hotkeys-group-title">Defaults</div>
                <div class="tasks-hotkeys-row"><code>C</code>/<code>X</code> Claude/Codex</div>
                <div class="tasks-hotkeys-row"><code>F</code>/<code>N</code>/<code>R</code> Fresh/Cont/Res</div>
                <div class="tasks-hotkeys-row"><code>Y</code> YOLO toggle</div>
                <div class="tasks-hotkeys-row"><code>P</code> Auto-send toggle</div>
              </div>
              <div class="tasks-hotkeys-group">
                <div class="tasks-hotkeys-group-title">Launch</div>
                <div class="tasks-hotkeys-row"><code>L</code> launch with default tier</div>
                <div class="tasks-hotkeys-row"><code>1</code>/<code>2</code>/<code>3</code>/<code>4</code> launch as T1–T4</div>
              </div>
            </div>
          </div>
        `;
        modal.querySelector('.tasks-content')?.appendChild(overlay);
        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) closeHotkeysOverlay();
        });
        overlay.querySelector('#tasks-hotkeys-close')?.addEventListener('click', closeHotkeysOverlay);
      };

      const closeLaunchPopover = () => {
        const existing = modal.querySelector('#tasks-launch-popover-overlay');
        if (existing) existing.remove();
      };

      const openLaunchPopover = ({ anchorEl, cardId, boardId } = {}) => {
        closeLaunchPopover();
        const cid = String(cardId || '').trim();
        const bid = String(boardId || '').trim();
        if (!cid) return;

        const mappingTier = getMappingTierForBoard(bid);
        const defaults = readLaunchDefaults({ mappingTier });
        const canLaunch = canLaunchFromBoard(state.provider, bid);

        const overlay = document.createElement('div');
        overlay.id = 'tasks-launch-popover-overlay';
        overlay.className = 'tasks-launch-popover-overlay';
        overlay.innerHTML = `
          <div class="tasks-launch-popover" id="tasks-launch-popover" role="dialog" aria-label="Launch options">
            <div class="tasks-launch-popover-header">
              <div class="tasks-launch-popover-title">⚡ Launch options</div>
              <button class="btn-secondary" id="tasks-launch-popover-close" type="button" title="Close (Esc)">×</button>
            </div>
            <div class="tasks-launch-popover-meta">${this.escapeHtml(cid)}</div>

            ${canLaunch ? '' : `
              <div class="tasks-launch-popover-warn">
                Set Board Settings to enable Launch for this board.
                <button class="btn-secondary" id="tasks-launch-popover-warn-open-settings" type="button">Open</button>
              </div>
            `}

            <div class="tasks-launch-popover-grid">
              <label class="tasks-launch-popover-field">
                <span>Tier</span>
                <select id="tasks-launch-popover-tier" class="tasks-select tasks-select-inline">
                  <option value="1" ${defaults.tier === 1 ? 'selected' : ''}>T1</option>
                  <option value="2" ${defaults.tier === 2 ? 'selected' : ''}>T2</option>
                  <option value="3" ${defaults.tier === 3 ? 'selected' : ''}>T3</option>
                  <option value="4" ${defaults.tier === 4 ? 'selected' : ''}>T4</option>
                </select>
              </label>
              <label class="tasks-launch-popover-field">
                <span>Agent</span>
                <select id="tasks-launch-popover-agent" class="tasks-select tasks-select-inline">
                  <option value="claude" ${defaults.agentId === 'claude' ? 'selected' : ''}>Claude</option>
                  <option value="codex" ${defaults.agentId === 'codex' ? 'selected' : ''}>Codex</option>
                </select>
              </label>
              <label class="tasks-launch-popover-field">
                <span>Mode</span>
                <select id="tasks-launch-popover-mode" class="tasks-select tasks-select-inline">
                  <option value="fresh" ${defaults.mode === 'fresh' ? 'selected' : ''}>Fresh</option>
                  <option value="continue" ${defaults.mode === 'continue' ? 'selected' : ''}>Continue</option>
                  <option value="resume" ${defaults.mode === 'resume' ? 'selected' : ''}>Resume</option>
                </select>
              </label>
              <label class="tasks-toggle tasks-toggle-mini" title="Skip permission prompts (YOLO)">
                <input type="checkbox" id="tasks-launch-popover-yolo" ${defaults.yolo !== false ? 'checked' : ''} />
                <span>YOLO</span>
              </label>
              <label class="tasks-toggle tasks-toggle-mini" title="Auto-send card description as the first prompt">
                <input type="checkbox" id="tasks-launch-popover-auto" ${defaults.autoSendPrompt !== false ? 'checked' : ''} />
                <span>Auto</span>
              </label>
            </div>

            <div class="tasks-launch-popover-actions">
              <button class="btn-primary" id="tasks-launch-popover-launch" type="button">🚀 Launch</button>
              <button class="btn-secondary" id="tasks-launch-popover-board-settings" type="button" ${bid ? '' : 'disabled'}>⚙ Board Settings</button>
            </div>
          </div>
        `;

        modal.querySelector('.tasks-content')?.appendChild(overlay);

        const popover = overlay.querySelector('#tasks-launch-popover');
        const closeBtn = overlay.querySelector('#tasks-launch-popover-close');
        closeBtn?.addEventListener('click', closeLaunchPopover);
        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) closeLaunchPopover();
        });

        const settingsBtn = overlay.querySelector('#tasks-launch-popover-board-settings');
        settingsBtn?.addEventListener('click', () => {
          closeLaunchPopover();
          if (bid) renderBoardSettings({ boardId: bid });
        });

        const warnOpenBtn = overlay.querySelector('#tasks-launch-popover-warn-open-settings');
        warnOpenBtn?.addEventListener('click', () => {
          closeLaunchPopover();
          if (bid) renderBoardSettings({ boardId: bid });
        });

        const position = () => {
          if (!popover || !anchorEl || typeof anchorEl.getBoundingClientRect !== 'function') return;
          const rect = anchorEl.getBoundingClientRect();
          const width = popover.offsetWidth || 360;
          const height = popover.offsetHeight || 220;
          const margin = 10;
          const maxLeft = window.innerWidth - width - margin;
          const maxTop = window.innerHeight - height - margin;
          const left = Math.max(margin, Math.min(maxLeft, rect.left + rect.width - width));
          const top = Math.max(margin, Math.min(maxTop, rect.bottom + 8));
          popover.style.left = `${Math.round(left)}px`;
          popover.style.top = `${Math.round(top)}px`;
        };

        // Initial position after DOM paint.
        window.requestAnimationFrame(position);
        window.requestAnimationFrame(position);

        const launchBtn = overlay.querySelector('#tasks-launch-popover-launch');
        launchBtn?.addEventListener('click', async () => {
          const tier = Number(overlay.querySelector('#tasks-launch-popover-tier')?.value || 3);
          const agentId = String(overlay.querySelector('#tasks-launch-popover-agent')?.value || 'claude').trim().toLowerCase();
          const mode = String(overlay.querySelector('#tasks-launch-popover-mode')?.value || 'fresh').trim().toLowerCase();
          const yolo = !!overlay.querySelector('#tasks-launch-popover-yolo')?.checked;
          const autoSendPrompt = !!overlay.querySelector('#tasks-launch-popover-auto')?.checked;

          if (!(tier >= 1 && tier <= 4)) return;
          if (agentId !== 'claude' && agentId !== 'codex') return;
          if (mode !== 'fresh' && mode !== 'continue' && mode !== 'resume') return;
          if (!bid) return;

          if (!canLaunchFromBoard(state.provider, bid)) {
            this.showToast('Set Board Settings to enable Launch', 'error');
            return;
          }

          try {
            launchBtn.disabled = true;
            const card = await fetchCardDetail(cid);
            const promptText = String(card?.desc ?? '');
            await this.launchAgentFromTaskCard({
              provider: state.provider,
              boardId: bid,
              card,
              tier,
              agentId,
              mode,
              yolo,
              autoSendPrompt,
              promptText
            });
            closeLaunchPopover();
          } catch (err) {
            console.error('Launch options failed:', err);
            this.showToast(String(err?.message || err), 'error');
          } finally {
            launchBtn.disabled = false;
          }
        });
      };

      const getMappingTierForBoard = (boardId) => {
        const bid = String(boardId || '').trim();
        if (!bid || bid === ALL_BOARDS_ID || bid === COMBINED_VIEW_ID) return undefined;
        const mapping = getBoardMapping(state.provider, bid) || null;
        const t = Number(mapping?.defaultStartTier);
        return Number.isFinite(t) && t >= 1 && t <= 4 ? t : undefined;
      };

      const syncLaunchDefaultsUi = ({ mappingTier } = {}) => {
        const tierHint = Number.isFinite(Number(mappingTier)) ? Number(mappingTier) : undefined;
        const defaults = readLaunchDefaults({ mappingTier: tierHint });
        if (launchDefaultTierGroupEl) {
          const tier = Number(defaults.tier || 3);
          launchDefaultTierGroupEl.querySelectorAll?.('[data-launch-default-tier-btn]')?.forEach?.((btn) => {
            const t = Number(btn?.getAttribute?.('data-launch-default-tier-btn') || '');
            btn?.classList?.toggle?.('is-selected', t === tier);
          });
        }
        if (launchDefaultAgentGroupEl) {
          const agentId = String(defaults.agentId || 'claude');
          launchDefaultAgentGroupEl.querySelectorAll?.('[data-launch-default-agent-btn]')?.forEach?.((btn) => {
            const v = String(btn?.getAttribute?.('data-launch-default-agent-btn') || '').trim().toLowerCase();
            btn?.classList?.toggle?.('is-selected', v === agentId);
          });
        }
        if (launchDefaultModeGroupEl) {
          const mode = String(defaults.mode || 'fresh');
          launchDefaultModeGroupEl.querySelectorAll?.('[data-launch-default-mode-btn]')?.forEach?.((btn) => {
            const v = String(btn?.getAttribute?.('data-launch-default-mode-btn') || '').trim().toLowerCase();
            btn?.classList?.toggle?.('is-selected', v === mode);
          });
        }
        if (launchDefaultYoloEl) launchDefaultYoloEl.checked = defaults.yolo !== false;
        if (launchDefaultAutoSendEl) launchDefaultAutoSendEl.checked = defaults.autoSendPrompt !== false;

        // Keep the card detail launch controls in sync (if a card is currently selected).
        const detailTierEl = detailEl?.querySelector?.('#tasks-launch-tier');
        const detailAgentEl = detailEl?.querySelector?.('#tasks-launch-agent');
        const detailModeEl = detailEl?.querySelector?.('#tasks-launch-mode');
        const detailYoloEl = detailEl?.querySelector?.('#tasks-launch-yolo');
        const detailAutoEl = detailEl?.querySelector?.('#tasks-launch-auto-send');
        if (detailTierEl) detailTierEl.value = String(defaults.tier || 3);
        if (detailAgentEl) detailAgentEl.value = String(defaults.agentId || 'claude');
        if (detailModeEl) detailModeEl.value = String(defaults.mode || 'fresh');
        if (detailYoloEl) detailYoloEl.checked = defaults.yolo !== false;
        if (detailAutoEl) detailAutoEl.checked = defaults.autoSendPrompt !== false;
      };

      const persistLaunchDefaultsFromToolbar = () => {
        if (!launchDefaultsWrapEl) return;
        const selectedTierBtn = launchDefaultTierGroupEl?.querySelector?.('[data-launch-default-tier-btn].is-selected');
        const tier = Number(selectedTierBtn?.getAttribute?.('data-launch-default-tier-btn') || 3);
        const selectedAgentBtn = launchDefaultAgentGroupEl?.querySelector?.('[data-launch-default-agent-btn].is-selected');
        const agentId = String(selectedAgentBtn?.getAttribute?.('data-launch-default-agent-btn') || 'claude');
        const selectedModeBtn = launchDefaultModeGroupEl?.querySelector?.('[data-launch-default-mode-btn].is-selected');
        const mode = String(selectedModeBtn?.getAttribute?.('data-launch-default-mode-btn') || 'fresh');
        const yolo = !!launchDefaultYoloEl?.checked;
        const autoSendPrompt = !!launchDefaultAutoSendEl?.checked;
        writeLaunchDefaults({ tier, agentId, mode, yolo, autoSendPrompt });

        // Apply to any visible quick-launch tier buttons so changing defaults takes effect immediately.
        try {
          cardsEl?.querySelectorAll?.('[data-quick-tier-group]')?.forEach?.((group) => {
            if (!group) return;
            group.querySelectorAll?.('[data-quick-launch-tier-btn]')?.forEach?.((btn) => {
              const t = Number(btn?.getAttribute?.('data-quick-launch-tier-btn') || '');
              btn?.classList?.toggle?.('is-selected', t === tier);
            });
          });
        } catch {
          // ignore
        }
      };

	    const getBoardMappings = () => {
	      const mappings = this.userSettings?.global?.ui?.tasks?.boardMappings;
	      return mappings && typeof mappings === 'object' ? mappings : {};
	    };

		    const getBoardMapping = (provider, boardId) => {
		      const key = `${provider}:${boardId}`;
		      const all = getBoardMappings();
		      const m = all?.[key];
		      return m && typeof m === 'object' ? m : null;
		    };

		    const readLaunchDefaults = ({ mappingTier } = {}) => {
		      const tierRaw = Number(localStorage.getItem('tasks-launch-tier') || '');
		      const tier = (tierRaw >= 1 && tierRaw <= 4)
		        ? tierRaw
		        : ((Number(mappingTier) >= 1 && Number(mappingTier) <= 4) ? Number(mappingTier) : 3);

		      const agentRaw = String(localStorage.getItem('tasks-launch-agent') || 'claude').trim().toLowerCase();
		      const agentId = (agentRaw === 'codex' || agentRaw === 'claude') ? agentRaw : 'claude';

		      const modeRaw = String(localStorage.getItem('tasks-launch-mode') || 'fresh').trim().toLowerCase();
		      const mode = (modeRaw === 'continue' || modeRaw === 'resume' || modeRaw === 'fresh') ? modeRaw : 'fresh';

		      const yolo = localStorage.getItem('tasks-launch-yolo') !== 'false';
		      const autoSendPrompt = localStorage.getItem('tasks-launch-auto-send') !== 'false';

		      return { tier, agentId, mode, yolo, autoSendPrompt };
		    };

		    const writeLaunchDefaults = (patch = {}) => {
		      try {
		        if (patch.tier !== undefined) localStorage.setItem('tasks-launch-tier', String(patch.tier));
		        if (patch.agentId !== undefined) localStorage.setItem('tasks-launch-agent', String(patch.agentId));
		        if (patch.mode !== undefined) localStorage.setItem('tasks-launch-mode', String(patch.mode));
		        if (patch.yolo !== undefined) localStorage.setItem('tasks-launch-yolo', patch.yolo ? 'true' : 'false');
		        if (patch.autoSendPrompt !== undefined) localStorage.setItem('tasks-launch-auto-send', patch.autoSendPrompt ? 'true' : 'false');
		      } catch {}
		    };

	    const isBoardEnabled = (provider, boardId) => {
	      const m = getBoardMapping(provider, boardId);
	      if (!m) return true;
	      return m.enabled !== false;
	    };

      const canLaunchFromBoard = (provider, boardId) => {
        const bid = String(boardId || '').trim();
        if (!bid || bid === ALL_BOARDS_ID || bid === COMBINED_VIEW_ID) return false;
        const mapping = getBoardMapping(provider, bid) || null;
        const enabled = mapping ? (mapping.enabled !== false) : true;
        const localPath = mapping ? String(mapping.localPath || '') : '';
        return !!(enabled && localPath);
      };

		    const updateBoardMapping = async (provider, boardId, patch) => {
		      const key = `${provider}:${boardId}`;
		      const current = getBoardMappings();
		      const next = { ...(current || {}) };
		      const prev = next[key] && typeof next[key] === 'object' ? next[key] : {};
		      next[key] = { ...prev, ...(patch || {}) };
		      await this.updateGlobalUserSetting('ui.tasks.boardMappings', next);
		    };

		    const getBoardConventionsAll = () => {
		      const raw = this.userSettings?.global?.ui?.tasks?.boardConventions;
		      return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
		    };

		    const getBoardConventions = (provider, boardId) => {
		      const key = `${provider}:${boardId}`;
		      const current = getBoardConventionsAll();
		      const v = current[key];
		      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
		    };

		    const updateBoardConventions = async (provider, boardId, patch) => {
		      const key = `${provider}:${boardId}`;
		      const current = getBoardConventionsAll();
		      const next = { ...(current || {}) };
		      const prev = next[key] && typeof next[key] === 'object' ? next[key] : {};
		      next[key] = { ...prev, ...(patch || {}) };
		      await this.updateGlobalUserSetting('ui.tasks.boardConventions', next);
		    };

		    const getDependencyChecklistNameForBoard = (provider, boardId) => {
		      const conv = getBoardConventions(provider, boardId);
		      const name = String(conv?.dependencyChecklistName || '').trim();
		      return name || 'Dependencies';
		    };

		    const getTierHintFromLabels = (provider, boardId, labels) => {
		      const conv = getBoardConventions(provider, boardId);
		      if (conv?.tierFromLabels !== true) return null;
		      const map = conv?.tierByLabelColor && typeof conv.tierByLabelColor === 'object' && !Array.isArray(conv.tierByLabelColor)
		        ? conv.tierByLabelColor
		        : {};
		      const tiers = [];
		      for (const l of (Array.isArray(labels) ? labels : [])) {
		        const color = String(l?.color || '').trim().toLowerCase();
		        if (!color) continue;
		        const t = Number(map[color]);
		        if (t >= 1 && t <= 4) tiers.push(t);
		      }
		      if (!tiers.length) return null;
		      return Math.min(...tiers);
		    };

		      const getCombinedConfig = () => {
		        const raw = this.userSettings?.global?.ui?.tasks?.combined;
		        return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
		      };

		      const normalizeCombinedSelections = (rawSelections) => {
		        const arr = Array.isArray(rawSelections) ? rawSelections : [];
		        const clean = arr
		          .map((s) => ({
		            boardId: String(s?.boardId || '').trim(),
		            listId: String(s?.listId || '').trim()
		          }))
		          .filter((s) => !!s.boardId && !!s.listId);

		        // De-dupe while preserving order.
		        const seen = new Set();
		        const out = [];
		        for (const item of clean) {
		          const key = `${item.boardId}:${item.listId}`;
		          if (seen.has(key)) continue;
		          seen.add(key);
		          out.push(item);
		        }
		        return out;
		      };

		      const getCombinedSelections = () => {
		        const raw = getCombinedConfig()?.selections;
		        const arr = Array.isArray(raw) ? raw : [];
	        return normalizeCombinedSelections(arr);
	      };

	      const getCombinedPresets = () => {
	        const raw = getCombinedConfig()?.presets;
	        const arr = Array.isArray(raw) ? raw : [];
	        const out = [];
	        const seen = new Set();
	        for (const p of arr) {
	          const id = String(p?.id || '').trim();
	          if (!id || seen.has(id)) continue;
	          seen.add(id);
	          const name = String(p?.name || '').trim() || id;
	          const selections = normalizeCombinedSelections(p?.selections);
	          out.push({ id, name, selections });
	        }
	        return out;
	      };

	      const getCombinedActivePresetId = () => String(getCombinedConfig()?.activePresetId || '').trim();

	      const updateCombinedConfig = async (patch) => {
	        const current = getCombinedConfig();
	        const next = { ...(current || {}), ...(patch || {}) };
	        await this.updateGlobalUserSetting('ui.tasks.combined', next);
	      };

	      const updateCombinedSelections = async (selections, { activePresetId = '' } = {}) => {
	        await updateCombinedConfig({
	          selections: Array.isArray(selections) ? selections : [],
	          activePresetId: String(activePresetId ?? '').trim()
	        });
	      };

	      const updateCombinedPresets = async ({ presets, activePresetId } = {}) => {
	        await updateCombinedConfig({
	          presets: Array.isArray(presets) ? presets : [],
	          ...(activePresetId !== undefined ? { activePresetId: String(activePresetId ?? '').trim() } : {})
	        });
	      };

	      const createPresetId = () => `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

	      const renderCombinedPresetSelect = () => {
	        if (!combinedPresetEl) return;
	        const isCombined = state.boardId === COMBINED_VIEW_ID;
	        if (!isCombined) {
	          combinedPresetEl.innerHTML = '';
	          combinedPresetEl.disabled = true;
	          combinedPresetEl.style.display = 'none';
	          return;
	        }

	        const presets = getCombinedPresets();
	        const active = getCombinedActivePresetId();
	        combinedPresetEl.innerHTML = `
	          <option value="">Custom</option>
	          ${presets.map((p) => `<option value="${this.escapeHtml(p.id)}">${this.escapeHtml(p.name)}</option>`).join('')}
	        `;
	        combinedPresetEl.value = presets.some((p) => p.id === active) ? active : '';
	        combinedPresetEl.disabled = presets.length === 0;
	      };

	    const renderCombinedSettings = async () => {
	      const selections = getCombinedSelections();
	      const presets = getCombinedPresets();
	      const activePresetId = getCombinedActivePresetId();

        const boardOptions = (Array.isArray(state.boards) ? state.boards : [])
          .filter((b) => !!b?.id)
          .map((b) => ({ id: b.id, name: b.name || b.id }));

        const resolveBoardName = (boardId) => {
          const b = (Array.isArray(state.boards) ? state.boards : []).find((x) => x?.id === boardId);
          return b?.name || boardId;
        };

        const resolveListName = async ({ boardId, listId } = {}) => {
          const meta = await loadBoardMeta({ boardId, refresh: false }).catch(() => ({ lists: [] }));
          const list = (meta?.lists || []).find((l) => l?.id === listId);
          return list?.name || listId;
        };

        const labels = [];
        for (const sel of selections) {
          // eslint-disable-next-line no-await-in-loop
          const listName = await resolveListName(sel);
          labels.push(`${resolveBoardName(sel.boardId)} • ${listName}`);
        }

	        detailEl.innerHTML = `
	          <div class="tasks-detail-header">
	            <div class="tasks-detail-title">Combined View</div>
	            <div class="tasks-detail-actions">
	              <button class="btn-secondary" id="tasks-combined-close" type="button">Back</button>
	            </div>
	          </div>
	          <div class="tasks-detail-meta">Pick specific lists/columns across boards and show them together.</div>

	          <div class="tasks-detail-block">
	            <div class="tasks-detail-block-title">Presets</div>
	            <div class="tasks-inline-row">
	              <select id="tasks-combined-preset-select" class="tasks-select tasks-select-inline" title="Preset">
	                <option value="">Custom</option>
	                ${presets.map((p) => `<option value="${this.escapeHtml(p.id)}" ${p.id === activePresetId ? 'selected' : ''}>${this.escapeHtml(p.name)}</option>`).join('')}
	              </select>
	              <button class="btn-secondary" id="tasks-combined-preset-apply" type="button" ${presets.length ? '' : 'disabled'}>Apply</button>
	              <button class="btn-secondary" id="tasks-combined-preset-delete" type="button" ${presets.length ? '' : 'disabled'}>Delete</button>
	            </div>
	            <div class="tasks-inline-row" style="margin-top:8px">
	              <input id="tasks-combined-preset-name" class="tasks-input tasks-input-inline" placeholder="Preset name" />
	              <button class="btn-secondary" id="tasks-combined-preset-save" type="button" title="Save current columns as a new preset">Save new</button>
	              <button class="btn-secondary" id="tasks-combined-preset-overwrite" type="button" ${presets.length ? '' : 'disabled'} title="Overwrite selected preset with current columns">Overwrite</button>
	            </div>
	            <div class="tasks-detail-meta" style="margin-top:8px">Tip: presets are available in the toolbar when viewing Combined.</div>
	          </div>

	          <div class="tasks-detail-block">
	            <div class="tasks-detail-block-title">Selected columns (${selections.length})</div>
	            <div class="tasks-combined-list" id="tasks-combined-list">
	              ${
                selections.length
                  ? selections
                      .map((s, idx) => `
                        <div class="tasks-combined-item" data-combined-index="${idx}">
                          <div class="tasks-combined-label">${this.escapeHtml(labels[idx] || `${s.boardId} • ${s.listId}`)}</div>
                          <div class="tasks-combined-actions">
                            <button class="btn-secondary" type="button" data-combined-up title="Move up">↑</button>
                            <button class="btn-secondary" type="button" data-combined-down title="Move down">↓</button>
                            <button class="btn-secondary" type="button" data-combined-remove title="Remove">✕</button>
                          </div>
                        </div>
                      `)
                      .join('')
                  : `<div class="tasks-detail-empty">No columns selected yet.</div>`
              }
            </div>
          </div>

          <div class="tasks-detail-block">
            <div class="tasks-detail-block-title">Add a column</div>
            <div class="tasks-inline-row">
              <select id="tasks-combined-add-board" class="tasks-select tasks-select-inline" title="Board"></select>
              <select id="tasks-combined-add-list" class="tasks-select tasks-select-inline" title="List"></select>
              <button class="btn-secondary" id="tasks-combined-add" type="button">Add</button>
            </div>
            <div class="tasks-inline-row" style="margin-top:8px">
              <button class="btn-secondary" id="tasks-combined-add-current" type="button" title="Add the currently-selected board/list">Add current</button>
              <button class="btn-secondary" id="tasks-combined-open" type="button" title="Switch to Combined view">Open Combined</button>
            </div>
          </div>
        `;

	        detailEl.querySelector('#tasks-combined-close')?.addEventListener('click', () => {
	          renderDetail(null);
	          refreshAll({ force: false });
	        });

	        const presetSelectEl = detailEl.querySelector('#tasks-combined-preset-select');
	        const presetNameEl = detailEl.querySelector('#tasks-combined-preset-name');
	        const presetApplyBtn = detailEl.querySelector('#tasks-combined-preset-apply');
	        const presetDeleteBtn = detailEl.querySelector('#tasks-combined-preset-delete');
	        const presetSaveBtn = detailEl.querySelector('#tasks-combined-preset-save');
	        const presetOverwriteBtn = detailEl.querySelector('#tasks-combined-preset-overwrite');

	        const resolveSelectedPreset = () => {
	          const id = String(presetSelectEl?.value || '').trim();
	          if (!id) return null;
	          return getCombinedPresets().find((p) => p.id === id) || null;
	        };

	        presetApplyBtn?.addEventListener('click', async () => {
	          const preset = resolveSelectedPreset();
	          if (!preset) return;
	          await updateCombinedSelections(preset.selections, { activePresetId: preset.id });
	          renderCombinedPresetSelect();
	          await refreshAll({ force: false });
	          renderCombinedSettings();
	        });

	        presetSaveBtn?.addEventListener('click', async () => {
	          const name = String(presetNameEl?.value || '').trim();
	          if (!name) {
	            this.showToast('Preset name required', 'warning');
	            return;
	          }
	          const existing = getCombinedPresets();
	          const id = createPresetId();
	          const next = [...existing, { id, name, selections }];
	          await updateCombinedPresets({ presets: next, activePresetId: id });
	          renderCombinedPresetSelect();
	          renderCombinedSettings();
	        });

	        presetOverwriteBtn?.addEventListener('click', async () => {
	          const preset = resolveSelectedPreset();
	          if (!preset) return;
	          const existing = getCombinedPresets();
	          const next = existing.map((p) => (p.id === preset.id ? { ...p, selections } : p));
	          await updateCombinedPresets({ presets: next, activePresetId: preset.id });
	          renderCombinedPresetSelect();
	          renderCombinedSettings();
	        });

	        presetDeleteBtn?.addEventListener('click', async () => {
	          const preset = resolveSelectedPreset();
	          if (!preset) return;
	          if (!window.confirm(`Delete preset "${preset.name}"?`)) return;
	          const existing = getCombinedPresets();
	          const next = existing.filter((p) => p.id !== preset.id);
	          const nextActive = getCombinedActivePresetId() === preset.id ? '' : getCombinedActivePresetId();
	          await updateCombinedPresets({ presets: next, activePresetId: nextActive });
	          renderCombinedPresetSelect();
	          renderCombinedSettings();
	        });

	        presetSelectEl?.addEventListener('change', () => {
	          // Keep overwrite/delete buttons aligned to selection state.
	          const has = !!resolveSelectedPreset();
	          if (presetDeleteBtn) presetDeleteBtn.disabled = !has;
	          if (presetOverwriteBtn) presetOverwriteBtn.disabled = !has;
	          if (presetApplyBtn) presetApplyBtn.disabled = !has;
	        });
	        // Initial button state.
	        const hasPreset = !!resolveSelectedPreset();
	        if (presetDeleteBtn) presetDeleteBtn.disabled = !hasPreset;
	        if (presetOverwriteBtn) presetOverwriteBtn.disabled = !hasPreset;
	        if (presetApplyBtn) presetApplyBtn.disabled = !hasPreset;

	        const listWrap = detailEl.querySelector('#tasks-combined-list');
	        listWrap?.addEventListener('click', async (e) => {
	          const row = e.target?.closest?.('[data-combined-index]');
	          if (!row) return;
	          const idx = Number(row.getAttribute('data-combined-index') || '');
	          if (!Number.isFinite(idx)) return;

	          if (e.target?.closest?.('[data-combined-remove]')) {
	            const next = selections.filter((_, i) => i !== idx);
	            await updateCombinedSelections(next);
	            renderCombinedPresetSelect();
	            renderCombinedSettings();
	            return;
	          }
	          if (e.target?.closest?.('[data-combined-up]')) {
	            if (idx <= 0) return;
	            const next = [...selections];
	            const tmp = next[idx - 1];
	            next[idx - 1] = next[idx];
	            next[idx] = tmp;
	            await updateCombinedSelections(next);
	            renderCombinedPresetSelect();
	            renderCombinedSettings();
	            return;
	          }
	          if (e.target?.closest?.('[data-combined-down]')) {
	            if (idx >= selections.length - 1) return;
	            const next = [...selections];
	            const tmp = next[idx + 1];
	            next[idx + 1] = next[idx];
	            next[idx] = tmp;
	            await updateCombinedSelections(next);
	            renderCombinedPresetSelect();
	            renderCombinedSettings();
	          }
	        });

        const addBoardEl = detailEl.querySelector('#tasks-combined-add-board');
        const addListEl = detailEl.querySelector('#tasks-combined-add-list');
        const addBtn = detailEl.querySelector('#tasks-combined-add');
        const addCurrentBtn = detailEl.querySelector('#tasks-combined-add-current');
        const openBtn = detailEl.querySelector('#tasks-combined-open');

        const setOptions = (select, options, placeholder = 'Select...') => {
          if (!select) return;
          select.innerHTML = '';
          const ph = document.createElement('option');
          ph.value = '';
          ph.textContent = placeholder;
          select.appendChild(ph);
          for (const o of options) {
            const opt = document.createElement('option');
            opt.value = o.id;
            opt.textContent = o.name;
            select.appendChild(opt);
          }
        };

        setOptions(addBoardEl, boardOptions, 'Board');

        const loadListsForBoard = async (boardId) => {
          if (!addListEl) return;
          const meta = await loadBoardMeta({ boardId, refresh: false }).catch(() => ({ lists: [] }));
          const lists = (meta?.lists || []).filter((l) => !!l?.id).map((l) => ({ id: l.id, name: l.name || l.id }));
          setOptions(addListEl, lists, 'List');
        };

        const defaultBoardId = (() => {
          const bid = String(state.boardId || '').trim();
          if (bid && bid !== ALL_BOARDS_ID && bid !== COMBINED_VIEW_ID) return bid;
          return boardOptions[0]?.id || '';
        })();

        if (addBoardEl) addBoardEl.value = defaultBoardId;
        if (defaultBoardId) await loadListsForBoard(defaultBoardId);

        addBoardEl?.addEventListener('change', async () => {
          const boardId = String(addBoardEl.value || '').trim();
          await loadListsForBoard(boardId);
        });

	        addBtn?.addEventListener('click', async () => {
	          const boardId = String(addBoardEl?.value || '').trim();
	          const listId = String(addListEl?.value || '').trim();
	          if (!boardId || !listId) return;
	          const next = [...selections, { boardId, listId }];
	          await updateCombinedSelections(next);
	          renderCombinedPresetSelect();
	          await refreshAll({ force: false });
	          renderCombinedSettings();
	        });

	        addCurrentBtn?.addEventListener('click', async () => {
	          const boardId = String(state.boardId || '').trim();
	          const listId = String(state.listId || '').trim();
	          if (!boardId || boardId === ALL_BOARDS_ID || boardId === COMBINED_VIEW_ID) return;
	          if (!listId || listId === '__all__') return;
	          const next = [...selections, { boardId, listId }];
	          await updateCombinedSelections(next);
	          renderCombinedPresetSelect();
	          await refreshAll({ force: false });
	          renderCombinedSettings();
	        });

        openBtn?.addEventListener('click', async () => {
          state.boardId = COMBINED_VIEW_ID;
          localStorage.setItem('tasks-board', state.boardId);
          state.view = 'board';
          localStorage.setItem('tasks-view', state.view);
          applyView();
          syncBoardLayoutUI();
          syncBoardAccent();
          renderBoardPicker();
          await refreshAll({ force: true });
        });
      };

			    const ensureBoardDetailVisible = (sentinelId) => {
			      const current = String(state.selectedCardId || '').trim();
			      if (current && !current.startsWith('__')) state.restoreDetailCardId = current;
			      state.selectedCardId = sentinelId;
			      if (state.view === 'board') bodyEl?.classList?.toggle?.('tasks-has-detail', true);
			    };

			    const restoreBoardDetailOrClear = async () => {
			      const restoreId = String(state.restoreDetailCardId || '').trim();
			      state.restoreDetailCardId = null;
			      if (!restoreId) {
			        renderDetail(null);
			        return;
			      }
			      try {
			        const card = await fetchCardDetail(restoreId);
			        renderDetail(card);
			      } catch (err) {
			        console.warn('Failed to restore previous card detail:', err);
			        renderDetail(null);
			      }
			    };

			    const renderBoardSettings = ({ boardId } = {}) => {
			      const effectiveBoardId = String(boardId || state.boardId || '').trim();
			      if (!effectiveBoardId || effectiveBoardId === ALL_BOARDS_ID) {
			        detailEl.innerHTML = `<div class="tasks-detail-empty">Select a board to edit mapping.</div>`;
			        return;
			      }

			      ensureBoardDetailVisible('__board_settings__');

		      const mapping = getBoardMapping(state.provider, effectiveBoardId) || {};
		      const enabled = mapping.enabled !== false;
		      const repoSlug = String(mapping.repoSlug || '');
		      const localPath = String(mapping.localPath || '');
		      const defaultTier = Number(mapping.defaultStartTier);
		      const boardName = ((Array.isArray(state.boards) ? state.boards : []).find(b => b.id === effectiveBoardId)?.name) || effectiveBoardId;

		      detailEl.innerHTML = `
		        <div class="tasks-detail-header">
		          <div class="tasks-detail-title">Board Settings</div>
		          <div class="tasks-detail-actions">
		            <button class="btn-secondary" id="tasks-board-settings-close" type="button">Back</button>
		          </div>
		        </div>
		        <div class="tasks-detail-meta">${this.escapeHtml(boardName)}</div>

	        <div class="tasks-detail-block">
	          <div class="tasks-detail-block-title">Visibility</div>
	          <label class="tasks-toggle">
	            <input type="checkbox" id="tasks-board-enabled" ${enabled ? 'checked' : ''} />
	            <span>Enabled (show in board list)</span>
	          </label>
	          <label class="tasks-toggle" title="Show disabled boards in the selector">
	            <input type="checkbox" id="tasks-show-disabled" ${state.showDisabledBoards ? 'checked' : ''} />
	            <span>Show disabled boards</span>
	          </label>
	        </div>

		        <div class="tasks-detail-block">
		          <div class="tasks-detail-block-title">Repo mapping</div>
		          <div class="tasks-inline-row">
		            <input id="tasks-board-local-path" class="tasks-input" placeholder="Local repo path or GitHub-relative path (e.g. games/hytopia/zoo)" value="${this.escapeHtml(localPath)}" />
		          </div>
	          <div class="tasks-inline-row" style="margin-top:8px">
	            <input id="tasks-board-repo-slug" class="tasks-input" placeholder="GitHub repo slug (optional, e.g. owner/repo)" value="${this.escapeHtml(repoSlug)}" />
	          </div>
	          <div class="tasks-inline-row" style="margin-top:8px">
	            <select id="tasks-board-default-tier" class="tasks-select tasks-select-inline" title="Default tier when launching from this board">
	              <option value="">(default tier: none)</option>
	              <option value="1" ${defaultTier === 1 ? 'selected' : ''}>T1</option>
	              <option value="2" ${defaultTier === 2 ? 'selected' : ''}>T2</option>
	              <option value="3" ${defaultTier === 3 ? 'selected' : ''}>T3</option>
	              <option value="4" ${defaultTier === 4 ? 'selected' : ''}>T4</option>
	            </select>
	            <button class="btn-secondary" id="tasks-board-save" type="button">💾 Save</button>
	          </div>
		          <div class="tasks-detail-empty" style="margin-top:8px">
		            This mapping enables “Launch” in card detail (card → repo → worktree → agent).
		          </div>
		        </div>

		        <div class="tasks-detail-block">
		          <div class="tasks-detail-block-title">Trello conventions</div>
		          <div class="tasks-detail-empty" style="margin-bottom:8px">
		            Configure Done list selection, tier labels, and dependency checklist name for this board.
		          </div>
		          <button class="btn-secondary" id="tasks-board-conventions-open" type="button">📏 Open Conventions Wizard</button>
		        </div>
		      `;

		      detailEl.querySelector('#tasks-board-settings-close')?.addEventListener('click', () => {
		        restoreBoardDetailOrClear().catch(() => renderDetail(null));
		      });

	      const showDisabledEl = detailEl.querySelector('#tasks-show-disabled');
	      showDisabledEl?.addEventListener('change', async () => {
	        state.showDisabledBoards = !!showDisabledEl.checked;
	        localStorage.setItem('tasks-show-disabled-boards', state.showDisabledBoards ? 'true' : 'false');
	        await refreshAll({ force: false });
	      });

		      const saveBtn = detailEl.querySelector('#tasks-board-save');
		      saveBtn?.addEventListener('click', async () => {
	        try {
	          saveBtn.disabled = true;
	          const enabledNext = !!detailEl.querySelector('#tasks-board-enabled')?.checked;
	          const localPathNext = String(detailEl.querySelector('#tasks-board-local-path')?.value || '').trim();
	          const repoSlugNext = String(detailEl.querySelector('#tasks-board-repo-slug')?.value || '').trim();
	          const tierRaw = String(detailEl.querySelector('#tasks-board-default-tier')?.value || '').trim();
	          const tierNum = Number(tierRaw);
	          await updateBoardMapping(state.provider, effectiveBoardId, {
	            enabled: enabledNext,
	            localPath: localPathNext || null,
	            repoSlug: repoSlugNext || null,
	            defaultStartTier: (tierNum >= 1 && tierNum <= 4) ? tierNum : null
	          });
	          this.showToast('Board settings saved', 'success');
	          await refreshAll({ force: false });
	        } catch (err) {
	          console.error('Board settings save failed:', err);
	          this.showToast(String(err?.message || err), 'error');
	        } finally {
	          if (saveBtn) saveBtn.disabled = false;
	        }
		      });

		      detailEl.querySelector('#tasks-board-conventions-open')?.addEventListener('click', () => {
		        renderBoardConventions({ boardId: effectiveBoardId });
		      });
		    };

			    const renderBoardConventions = async ({ boardId } = {}) => {
			      const effectiveBoardId = String(boardId || state.boardId || '').trim();
			      if (!effectiveBoardId || effectiveBoardId === ALL_BOARDS_ID || effectiveBoardId === COMBINED_VIEW_ID) {
			        detailEl.innerHTML = `<div class="tasks-detail-empty">Select a board to edit conventions.</div>`;
			        return;
			      }

			      ensureBoardDetailVisible('__board_conventions__');

			      const boardName = ((Array.isArray(state.boards) ? state.boards : []).find(b => b.id === effectiveBoardId)?.name) || effectiveBoardId;
			      const conv = getBoardConventions(state.provider, effectiveBoardId) || {};

			      const safeChecklistName = String(conv?.dependencyChecklistName || '').trim() || 'Dependencies';
			      const doneListId = String(conv?.doneListId || '').trim();
            const mergedCommentTemplate = String(conv?.mergedCommentTemplate || '').trim();
            const mergedLabelNames = String(conv?.mergedLabelNames || '').trim();
            const mergedChecklistName = String(conv?.mergedChecklistName || '').trim();
            const mergedChecklistItemTemplate = String(conv?.mergedChecklistItemTemplate || '').trim();
			      const tierFromLabels = conv?.tierFromLabels === true;
			      const needsFixLabelName = String(conv?.needsFixLabelName || '').trim();
			      const tierByLabelColor = conv?.tierByLabelColor && typeof conv.tierByLabelColor === 'object' && !Array.isArray(conv.tierByLabelColor)
			        ? conv.tierByLabelColor
			        : {};

		      const colors = ['green', 'yellow', 'orange', 'red', 'purple', 'blue', 'sky', 'lime', 'pink', 'black'];
		      const renderTierOptions = (selected) => `
		        <option value="" ${selected === '' ? 'selected' : ''}>(none)</option>
		        <option value="1" ${selected === '1' ? 'selected' : ''}>T1</option>
		        <option value="2" ${selected === '2' ? 'selected' : ''}>T2</option>
		        <option value="3" ${selected === '3' ? 'selected' : ''}>T3</option>
		        <option value="4" ${selected === '4' ? 'selected' : ''}>T4</option>
		      `;

		      const suggestDoneListId = (lists) => {
		        const arr = Array.isArray(lists) ? lists : [];
		        const norm = (s) => String(s || '').trim().toLowerCase();
		        const scored = arr
		          .map((l) => ({ id: l?.id || '', name: norm(l?.name || '') }))
		          .filter((l) => !!l.id && !!l.name);
		        const firstMatch = (re) => scored.find((l) => re.test(l.name))?.id || null;
		        return (
		          firstMatch(/\\b(merged|shipped|released)\\b/) ||
		          firstMatch(/\\b(done|complete|completed)\\b/) ||
		          null
		        );
		      };

		      detailEl.innerHTML = `
		        <div class="tasks-detail-header">
		          <div class="tasks-detail-title">Board Conventions</div>
		          <div class="tasks-detail-actions">
		            <button class="btn-secondary" id="tasks-board-conventions-back" type="button">Back</button>
		          </div>
		        </div>
		        <div class="tasks-detail-meta">${this.escapeHtml(boardName)}</div>

		        <div class="tasks-detail-block">
		          <div class="tasks-detail-block-title">PR-merge “Done” list</div>
		          <div class="tasks-inline-row" style="gap:8px; flex-wrap:wrap;">
		            <select id="tasks-conv-done-list" class="tasks-select tasks-select-inline" title="List to move cards to when PR merges">
		              <option value="">(auto-detect)</option>
		            </select>
		            <button class="btn-secondary" id="tasks-conv-done-suggest" type="button" title="Pick a suggested Done list from current board lists">Suggest</button>
		          </div>
		          <div class="tasks-detail-meta" style="margin-top:8px">
		            Used by PR-merge automation when moving Trello cards. If unset, the server uses name heuristics (merged/shipped/done).
		          </div>
		        </div>

		        <div class="tasks-detail-block">
		          <div class="tasks-detail-block-title">PR-merge comment template</div>
		          <div class="tasks-inline-row">
		            <textarea id="tasks-conv-merged-comment-template" class="tasks-textarea" rows="4" placeholder="Merged ✅&#10;PR: {prUrl}">${this.escapeHtml(mergedCommentTemplate)}</textarea>
		          </div>
		          <div class="tasks-detail-meta" style="margin-top:8px">
		            Optional per-board override. Placeholders: <code>{prUrl}</code>, <code>{mergedAt}</code>, <code>{reviewOutcome}</code>, <code>{verifyMinutes}</code>, <code>{notes}</code>, <code>{promptRef}</code>, <code>{ticketCardUrl}</code>.
		          </div>
		        </div>

		        <div class="tasks-detail-block">
		          <div class="tasks-detail-block-title">PR-merge labels</div>
		          <div class="tasks-inline-row">
		            <input id="tasks-conv-merged-label-names" class="tasks-input" value="${this.escapeHtml(mergedLabelNames)}" placeholder="Comma-separated Trello label names (optional), e.g. Merged, Shipped" />
		          </div>
		          <div class="tasks-detail-meta" style="margin-top:8px">
		            Optional per-board labels to apply when the PR merges. Names are matched case-insensitively to existing board labels.
		          </div>
		        </div>

		        <div class="tasks-detail-block">
		          <div class="tasks-detail-block-title">PR-merge checklist item</div>
		          <div class="tasks-inline-row">
		            <input id="tasks-conv-merged-checklist-name" class="tasks-input" value="${this.escapeHtml(mergedChecklistName)}" placeholder="Checklist name (optional), e.g. Ship Log" />
		          </div>
		          <div class="tasks-inline-row" style="margin-top:8px;">
		            <input id="tasks-conv-merged-checklist-item-template" class="tasks-input" value="${this.escapeHtml(mergedChecklistItemTemplate)}" placeholder="Item text template (optional), e.g. Merged: {prUrl}" />
		          </div>
		          <div class="tasks-detail-meta" style="margin-top:8px">
		            If set, Orchestrator adds a checklist item on merge. Supports the same placeholders as the merge comment template.
		          </div>
		        </div>

		        <div class="tasks-detail-block">
		          <div class="tasks-detail-block-title">Dependencies checklist name</div>
		          <div class="tasks-inline-row">
		            <input id="tasks-conv-deps-name" class="tasks-input" value="${this.escapeHtml(safeChecklistName)}" placeholder="Dependencies" />
		          </div>
		          <div class="tasks-detail-meta" style="margin-top:8px">
		            The Tasks card detail “Dependencies” section reads/writes to this checklist on the Trello card.
		          </div>
		        </div>

			        <div class="tasks-detail-block">
			          <div class="tasks-detail-block-title">Tier from label color</div>
			          <label class="tasks-toggle" title="When enabled, Launch defaults can be suggested from Trello label colors">
			            <input type="checkbox" id="tasks-conv-tier-from-labels" ${tierFromLabels ? 'checked' : ''} />
			            <span>Use tier mapping from labels</span>
			          </label>
		          <div class="tasks-kv" style="margin-top:10px">
		            ${colors.map((c) => {
		              const v = Number(tierByLabelColor?.[c]);
		              const selected = (v >= 1 && v <= 4) ? String(v) : '';
		              return `
		                <div class="tasks-kv-row tasks-kv-row-edit">
		                  <div class="tasks-kv-key"><span class="tasks-label tasks-label--${c}" style="min-width: 90px; display:inline-flex; justify-content:center;">${c}</span></div>
		                  <div class="tasks-kv-val tasks-kv-val-edit">
		                    <select class="tasks-select tasks-select-inline" data-tier-color="${this.escapeHtml(c)}" style="width:120px;">
		                      ${renderTierOptions(selected)}
		                    </select>
		                  </div>
		                </div>
		              `;
		            }).join('')}
		          </div>
			        </div>

			        <div class="tasks-detail-block">
			          <div class="tasks-detail-block-title">Feedback loops</div>
			          <div class="tasks-inline-row">
			            <input id="tasks-conv-needs-fix-label" class="tasks-input" value="${this.escapeHtml(needsFixLabelName)}" placeholder="Needs-fix label name (optional), e.g. needs_fix" />
			          </div>
			          <div class="tasks-detail-meta" style="margin-top:8px">
			            When Queue outcome is <code>needs_fix</code>, Orchestrator can auto-apply this label to the linked Trello card.
			          </div>
			        </div>

			        <div class="tasks-detail-block">
			          <div class="tasks-inline-row" style="gap:8px; flex-wrap:wrap;">
			            <button class="btn-secondary" id="tasks-conv-save" type="button">💾 Save conventions</button>
			          </div>
			        </div>
			      `;

		      detailEl.querySelector('#tasks-board-conventions-back')?.addEventListener('click', () => {
		        renderBoardSettings({ boardId: effectiveBoardId });
		      });

		      const doneSelect = detailEl.querySelector('#tasks-conv-done-list');
		      const suggestBtn = detailEl.querySelector('#tasks-conv-done-suggest');
		      const saveBtn = detailEl.querySelector('#tasks-conv-save');

		      let lists = [];
		      try {
		        const meta = await loadBoardMeta({ boardId: effectiveBoardId, refresh: true });
		        lists = Array.isArray(meta?.lists) ? meta.lists : [];
		      } catch {
		        lists = [];
		      }

		      if (doneSelect) {
		        for (const l of lists) {
		          if (!l?.id) continue;
		          const opt = document.createElement('option');
		          opt.value = l.id;
		          opt.textContent = l.name || l.id;
		          doneSelect.appendChild(opt);
		        }
		        if (doneListId) doneSelect.value = doneListId;
		      }

		      suggestBtn?.addEventListener('click', () => {
		        const suggested = suggestDoneListId(lists);
		        if (doneSelect && suggested) doneSelect.value = suggested;
		        if (!suggested) this.showToast('No Done list suggestion found', 'info');
		      });

			      saveBtn?.addEventListener('click', async () => {
			        try {
			          if (saveBtn) saveBtn.disabled = true;

			          const doneListIdNext = String(doneSelect?.value || '').trim() || null;
                const mergedCommentTemplateNext = String(detailEl.querySelector('#tasks-conv-merged-comment-template')?.value || '').trim() || null;
                const mergedLabelNamesNext = String(detailEl.querySelector('#tasks-conv-merged-label-names')?.value || '').trim() || null;
                const mergedChecklistNameNext = String(detailEl.querySelector('#tasks-conv-merged-checklist-name')?.value || '').trim() || null;
                const mergedChecklistItemTemplateNext = String(detailEl.querySelector('#tasks-conv-merged-checklist-item-template')?.value || '').trim() || null;
			          const depsNameNext = String(detailEl.querySelector('#tasks-conv-deps-name')?.value || '').trim() || null;
			          const tierFromLabelsNext = !!detailEl.querySelector('#tasks-conv-tier-from-labels')?.checked;
			          const needsFixLabelNameNext = String(detailEl.querySelector('#tasks-conv-needs-fix-label')?.value || '').trim() || null;

			          const nextMap = {};
			          detailEl.querySelectorAll('[data-tier-color]').forEach((sel) => {
			            const color = String(sel.getAttribute('data-tier-color') || '').trim().toLowerCase();
			            const v = Number(sel.value);
		            if (!color) return;
		            if (v >= 1 && v <= 4) nextMap[color] = v;
		          });

			          await updateBoardConventions(state.provider, effectiveBoardId, {
			            doneListId: doneListIdNext,
                  mergedCommentTemplate: mergedCommentTemplateNext,
                  mergedLabelNames: mergedLabelNamesNext,
                  mergedChecklistName: mergedChecklistNameNext,
                  mergedChecklistItemTemplate: mergedChecklistItemTemplateNext,
			            dependencyChecklistName: depsNameNext,
			            tierFromLabels: tierFromLabelsNext,
			            tierByLabelColor: nextMap,
			            needsFixLabelName: needsFixLabelNameNext
			          });

		          this.showToast('Conventions saved', 'success');
		        } catch (err) {
		          console.error('Conventions save failed:', err);
		          this.showToast(String(err?.message || err), 'error');
		        } finally {
		          if (saveBtn) saveBtn.disabled = false;
		        }
		      });
		    };

	    const readAssigneeFilter = () => {
	      const key = boardKey();
      const fromServer = this.userSettings?.global?.ui?.tasks?.filters?.assigneesByBoard?.[key];
      if (fromServer && typeof fromServer === 'object' && !Array.isArray(fromServer)) {
        const mode = fromServer.mode;
        const ids = Array.isArray(fromServer.ids) ? fromServer.ids.filter(Boolean) : [];
        if (mode === 'any') return { mode: 'any', ids: [] };
        // Treat an empty selection as "any" (matches user expectation: show all cards by default).
        if (ids.length === 0) return { mode: 'any', ids: [] };
        return { mode: 'selected', ids };
      }
      if (Array.isArray(fromServer)) {
        const ids = fromServer.filter(Boolean);
        return ids.length === 0 ? { mode: 'any', ids: [] } : { mode: 'selected', ids }; // legacy
      }
      try {
        const raw = localStorage.getItem(`tasks-assignees:${key}`);
        if (!raw) return { mode: 'any', ids: [] };
        const arr = JSON.parse(raw);
        if (arr && typeof arr === 'object' && !Array.isArray(arr)) {
          const mode = arr.mode;
          const ids = Array.isArray(arr.ids) ? arr.ids.filter(Boolean) : [];
          if (mode === 'any') return { mode: 'any', ids: [] };
          if (ids.length === 0) return { mode: 'any', ids: [] };
          return { mode: 'selected', ids };
        }
        if (!Array.isArray(arr)) return { mode: 'any', ids: [] };
        const ids = arr.filter(Boolean);
        return ids.length === 0 ? { mode: 'any', ids: [] } : { mode: 'selected', ids };
      } catch {
        return { mode: 'any', ids: [] };
      }
    };

    const persistAssigneeFilter = ({ mode, ids } = {}) => {
      const key = boardKey();
      const cleanMode = mode === 'any' ? 'any' : 'selected';
      const cleanIds = Array.from(new Set((Array.isArray(ids) ? ids : []).filter(Boolean)));
      const payload = cleanMode === 'any'
        ? { mode: 'any', ids: [] }
        : { mode: 'selected', ids: cleanIds };
      try {
        localStorage.setItem(`tasks-assignees:${key}`, JSON.stringify(payload));
      } catch {
        // ignore
      }
      try {
        const current = this.userSettings?.global?.ui?.tasks?.filters?.assigneesByBoard || {};
        const next = { ...(current || {}) };
        next[key] = payload;
        this.updateGlobalUserSetting('ui.tasks.filters.assigneesByBoard', next);
      } catch {
        // ignore
      }
    };

    const fetchMe = async ({ refresh = false } = {}) => {
      const url = new URL(`${serverUrl}/api/tasks/me`);
      url.searchParams.set('provider', state.provider);
      if (refresh) url.searchParams.set('refresh', 'true');
      const res = await fetch(url.toString());
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to load me');
      return data.member || null;
    };

    const resolveMeId = () => {
      const overrideUsername = String(this.userSettings?.global?.ui?.tasks?.me?.trelloUsername || '').trim().toLowerCase();
      const members = Array.isArray(state.boardMembers) ? state.boardMembers : [];
      if (overrideUsername) {
        const found = members.find(m => String(m?.username || '').toLowerCase() === overrideUsername);
        if (found?.id) return found.id;
      }
      const meUsername = String(state.me?.username || '').trim().toLowerCase();
      if (meUsername) {
        const found = members.find(m => String(m?.username || '').toLowerCase() === meUsername);
        if (found?.id) return found.id;
      }
      return state.me?.id || null;
    };

    const passesAssigneeFilter = (card) => {
      if (state.assigneeFilterMode === 'any') return true;
      const ids = Array.isArray(state.assigneeFilterIds) ? state.assigneeFilterIds.filter(Boolean) : [];
      if (ids.length === 0) return true;
      const memberIds = Array.isArray(card?.idMembers) ? card.idMembers : [];
      if (memberIds.length === 0) return false;
      return memberIds.some(id => ids.includes(id));
    };
    const readBoardLayout = () => {
      const key = boardKey();
      const fromServer = this.userSettings?.global?.ui?.tasks?.kanban?.layoutByBoard?.[key];
      const allowed = new Set(['scroll', 'wrap', 'wrap-expand']);
      if (allowed.has(fromServer)) return fromServer;
      try {
        const fromLocal = localStorage.getItem(`tasks-board-layout:${key}`);
        if (allowed.has(fromLocal)) return fromLocal;
      } catch {
        // ignore
      }
      return 'wrap-expand';
    };

    const persistBoardLayout = (layout) => {
      const key = boardKey();
      try {
        localStorage.setItem(`tasks-board-layout:${key}`, layout);
      } catch {
        // ignore
      }
      try {
        const current = this.userSettings?.global?.ui?.tasks?.kanban?.layoutByBoard || {};
        const next = { ...(current || {}) };
        next[key] = layout;
        this.updateGlobalUserSetting('ui.tasks.kanban.layoutByBoard', next);
      } catch {
        // ignore
      }
    };

    const computeUpdatedSince = () => {
      const now = Date.now();
      const windowValue = state.updatedWindow;
      if (!windowValue || windowValue === 'any') return null;
      const msByKey = {
        '1h': 60 * 60 * 1000,
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000,
        '30d': 30 * 24 * 60 * 60 * 1000
      };
      const delta = msByKey[windowValue];
      if (!delta) return null;
      return new Date(now - delta).toISOString();
    };

    const escapeHtml = (value) => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    const openPromptEditorForCard = async ({ promptId, provider, cardId } = {}) => {
      const pid = String(promptId || '').trim();
      if (!pid) return;
      const targetProvider = String(provider || 'trello').trim() || 'trello';
      const targetCardId = String(cardId || '').trim();
      if (!targetCardId) throw new Error('cardId is required');

      const existing = document.getElementById('prompt-editor');
      if (existing) existing.remove();

      const editor = document.createElement('div');
      editor.id = 'prompt-editor';
      editor.className = 'modal tasks-modal';
      editor.classList.add(`tasks-theme-${resolvedTasksTheme}`);
      editor.innerHTML = `
        <div class="modal-content tasks-content">
          <div class="modal-header">
            <h2>📝 Prompt: ${escapeHtml(pid)}</h2>
            <button class="close-btn tasks-close-btn" aria-label="Close" onclick="this.closest('.modal').remove()">×</button>
          </div>
          <div class="tasks-body" style="grid-template-columns: 1fr;">
            <div class="tasks-detail" style="overflow:auto;">
              <div class="tasks-inline-row" style="margin-bottom: 10px;">
                <button class="btn-secondary" id="prompt-load">🔄 Load</button>
                <button class="btn-secondary" id="prompt-save">💾 Save</button>
                <span style="flex:1"></span>
                <label class="tasks-detail-meta" style="display:flex; align-items:center; gap:8px;">
                  store:
                  <select id="prompt-store" class="tasks-select tasks-select-inline" style="width: 140px;">
                    <option value="private" selected>private</option>
                    <option value="shared">shared</option>
                    <option value="encrypted">encrypted</option>
                  </select>
                </label>
              </div>
              <div class="tasks-inline-row" id="prompt-store-extra" style="margin-bottom: 10px; gap: 8px; flex-wrap: wrap;">
                <input id="prompt-repo-root" class="tasks-input" style="min-width: 340px; flex: 1;" placeholder="Repo root (for shared/encrypted), e.g. /home/<user>/GitHub/games/hytopia/zoo-game" />
                <input id="prompt-rel-path" class="tasks-input" style="min-width: 260px; flex: 1;" placeholder="Repo-relative path (optional; default .orchestrator/prompts/<id>.md)" />
                <label class="tasks-toggle" id="prompt-comment-pointer-wrap" style="display:none" title="Add a pointer comment back to this card">
                  <input type="checkbox" id="prompt-comment-pointer" checked />
                  <span>Comment pointer</span>
                </label>
                <button class="btn-secondary" id="prompt-promote" title="Copy private prompt into repo store (shared/encrypted)">⬆ Promote</button>
                <span class="tasks-detail-meta" id="prompt-sha"></span>
              </div>
              <div class="tasks-detail-meta" id="prompt-meta" style="margin-bottom: 8px;"></div>
              <textarea id="prompt-text" class="tasks-textarea" rows="24" placeholder="Write your prompt…"></textarea>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(editor);

      const metaEl = editor.querySelector('#prompt-meta');
      const shaEl = editor.querySelector('#prompt-sha');
      const textEl = editor.querySelector('#prompt-text');
      const storeEl = editor.querySelector('#prompt-store');
      const extraEl = editor.querySelector('#prompt-store-extra');
      const repoRootEl = editor.querySelector('#prompt-repo-root');
      const relPathEl = editor.querySelector('#prompt-rel-path');
      const commentWrapEl = editor.querySelector('#prompt-comment-pointer-wrap');
      const commentEl = editor.querySelector('#prompt-comment-pointer');
      const loadBtn = editor.querySelector('#prompt-load');
      const promoteBtn = editor.querySelector('#prompt-promote');
      const saveBtn = editor.querySelector('#prompt-save');

      let dirty = false;
      let loaded = { store: 'private', repoRoot: '', relPath: '' };

      const setMeta = (m) => {
        if (!metaEl) return;
        metaEl.innerHTML = m ? String(m) : '';
      };

      const storeNeedsRepo = (store) => store === 'shared' || store === 'encrypted';

      const updateStoreUI = ({ store, repoRoot, relPath } = {}) => {
        const s = String(store || 'private').trim().toLowerCase();
        if (storeEl) storeEl.value = ['private', 'shared', 'encrypted'].includes(s) ? s : 'private';
        if (repoRootEl) repoRootEl.value = String(repoRoot || '').trim();
        if (relPathEl) relPathEl.value = String(relPath || '').trim();
        const needs = storeNeedsRepo(storeEl?.value || 'private');
        if (extraEl) extraEl.style.display = 'flex';
        if (repoRootEl) repoRootEl.style.display = needs ? '' : 'none';
        if (relPathEl) relPathEl.style.display = needs ? '' : 'none';
        if (commentWrapEl) commentWrapEl.style.display = needs ? '' : 'none';
        if (promoteBtn) promoteBtn.style.display = needs ? '' : 'none';
      };

      const load = async () => {
        const store = String(storeEl?.value || 'private').trim().toLowerCase();
        const repoRoot = String(repoRootEl?.value || '').trim();
        const relPath = String(relPathEl?.value || '').trim();

        const url = new URL(`${serverUrl}/api/prompts/${encodeURIComponent(pid)}`);
        if (storeNeedsRepo(store)) {
          if (!repoRoot) throw new Error('Repo root is required for shared/encrypted prompts');
          url.searchParams.set('visibility', store);
          url.searchParams.set('repoRoot', repoRoot);
          if (relPath) url.searchParams.set('relPath', relPath);
        }

        const res = await fetch(url.toString());
        if (res.status === 404) {
          shaEl.textContent = 'new';
          textEl.value = '';
          setMeta(storeNeedsRepo(store) ? `store: <code>${escapeHtml(store)}</code> • (new file)` : 'store: <code>private</code> • (new file)');
          dirty = false;
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Failed to load prompt');
        textEl.value = data.text || '';
        shaEl.textContent = data.sha256 ? `sha256: ${data.sha256.slice(0, 12)}…` : '';
        const effectiveStore = String(data.visibility || store).trim().toLowerCase();
        loaded = {
          store: effectiveStore,
          repoRoot: String(data.repoRoot || repoRoot || ''),
          relPath: String(data.relPath || relPath || '')
        };
        updateStoreUI(loaded);
        setMeta(storeNeedsRepo(effectiveStore)
          ? `store: <code>${escapeHtml(effectiveStore)}</code> • <code>${escapeHtml(loaded.relPath || '')}</code>`
          : 'store: <code>private</code>');
        dirty = false;
      };

      const save = async () => {
        saveBtn.disabled = true;
        try {
          const store = String(storeEl?.value || 'private').trim().toLowerCase();
          const repoRoot = String(repoRootEl?.value || '').trim();
          const relPath = String(relPathEl?.value || '').trim();

          const url = new URL(`${serverUrl}/api/prompts/${encodeURIComponent(pid)}`);
          if (storeNeedsRepo(store)) {
            if (!repoRoot) throw new Error('Repo root is required for shared/encrypted prompts');
            url.searchParams.set('visibility', store);
            url.searchParams.set('repoRoot', repoRoot);
            if (relPath) url.searchParams.set('relPath', relPath);
          }

          const res = await fetch(url.toString(), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: textEl.value })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data?.error || 'Failed to save prompt');
          shaEl.textContent = data.sha256 ? `sha256: ${data.sha256.slice(0, 12)}…` : '';
          loaded = {
            store: String(data.visibility || store).trim().toLowerCase(),
            repoRoot: String(data.repoRoot || repoRoot || ''),
            relPath: String(data.relPath || relPath || '')
          };
          updateStoreUI(loaded);
          setMeta(storeNeedsRepo(loaded.store)
            ? `store: <code>${escapeHtml(loaded.store)}</code> • <code>${escapeHtml(loaded.relPath || '')}</code>`
            : 'store: <code>private</code>');
          dirty = false;
          this.showToast('Prompt saved', 'success');
        } catch (e) {
          this.showToast(String(e?.message || e), 'error');
        } finally {
          saveBtn.disabled = false;
        }
      };

      const promote = async () => {
        const store = String(storeEl?.value || '').trim().toLowerCase();
        if (!storeNeedsRepo(store)) return;
        const repoRoot = String(repoRootEl?.value || '').trim();
        const relPath = String(relPathEl?.value || '').trim();
        if (!repoRoot) throw new Error('Repo root is required for shared/encrypted prompts');

        const pointer = commentEl && commentEl.checked
          ? { provider: targetProvider, cardId: targetCardId }
          : undefined;

        const res = await fetch(`${serverUrl}/api/prompts/${encodeURIComponent(pid)}/promote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visibility: store, repoRoot, relPath: relPath || undefined, commentPointer: pointer })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Failed to promote prompt');
        if (data?.relPath && relPathEl) relPathEl.value = String(data.relPath);
        this.showToast(`Prompt promoted (${store})`, 'success');
        await load();
      };

      textEl?.addEventListener('input', () => { dirty = true; });
      loadBtn?.addEventListener('click', async () => {
        try {
          loadBtn.disabled = true;
          await load();
        } catch (e) {
          this.showToast(String(e?.message || e), 'error');
        } finally {
          loadBtn.disabled = false;
        }
      });
      saveBtn.addEventListener('click', save);
      promoteBtn?.addEventListener('click', async () => {
        try {
          promoteBtn.disabled = true;
          await promote();
        } catch (e) {
          this.showToast(String(e?.message || e), 'error');
        } finally {
          promoteBtn.disabled = false;
        }
      });

      storeEl?.addEventListener('change', async () => {
        if (dirty && !window.confirm('Discard unsaved changes?')) {
          storeEl.value = loaded.store || 'private';
          return;
        }
        updateStoreUI({ store: storeEl.value, repoRoot: repoRootEl?.value, relPath: relPathEl?.value });
      });

      updateStoreUI(loaded);
      await load();
    };

    const toTrelloAvatarUrl = (avatarUrl, size = 50) => {
      const raw = String(avatarUrl || '').trim();
      if (!raw) return '';
      // Trello commonly returns a base avatarUrl like:
      //   https://trello-avatars.s3.amazonaws.com/<hash>
      // which must be suffixed with `/<size>.png` (otherwise it can 403 / look like an S3 root fetch).
      const lower = raw.toLowerCase();
      if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp') || lower.includes('.png?') || lower.includes('.jpg?') || lower.includes('.jpeg?') || lower.includes('.webp?')) {
        return raw;
      }
      const safeSize = Number.isFinite(Number(size)) ? Math.max(10, Math.min(512, Number(size))) : 50;
      return `${raw.replace(/\/$/, '')}/${safeSize}.png`;
    };

    const toDatetimeLocalValue = (iso) => {
      if (!iso) return '';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      const pad = (n) => String(n).padStart(2, '0');
      const yyyy = d.getFullYear();
      const mm = pad(d.getMonth() + 1);
      const dd = pad(d.getDate());
      const hh = pad(d.getHours());
      const mi = pad(d.getMinutes());
      return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
    };

    const fromDatetimeLocalValue = (value) => {
      const v = String(value || '').trim();
      if (!v) return null;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return null;
      return d.toISOString();
    };

    const setSelectOptions = (select, options, { placeholder = 'Select...', valueKey = 'id', labelKey = 'name' } = {}) => {
      if (!select) return;
      select.innerHTML = '';
      const ph = document.createElement('option');
      ph.value = '';
      ph.textContent = placeholder;
      select.appendChild(ph);

      for (const item of options) {
        const opt = document.createElement('option');
        opt.value = item?.[valueKey] || item?.id || '';
        opt.textContent = item?.[labelKey] || item?.name || opt.value;
        select.appendChild(opt);
      }
    };

    const renderCards = (cards) => {
      if (!state.boardId) {
        cardsEl.innerHTML = `<div class="no-ports">Select a board to view cards.</div>`;
        return;
      }

      if (state.view === 'board') {
        cardsEl.innerHTML = `<div class="no-ports">Board view uses the board snapshot. Click Refresh if needed.</div>`;
        return;
      }

      if (!state.listId) {
        cardsEl.innerHTML = `<div class="no-ports">Select a list (or “All lists”) to view cards.</div>`;
        return;
      }

      const filtered = (Array.isArray(cards) ? cards : []).filter(passesAssigneeFilter);
      if (filtered.length === 0) {
        cardsEl.innerHTML = `<div class="no-ports">No cards found.</div>`;
        return;
      }

      const isAllBoards = state.boardId === ALL_BOARDS_ID;
      const isCombined = state.boardId === COMBINED_VIEW_ID;
      const isMultiBoard = isAllBoards || isCombined;
      const boardColorById = new Map((Array.isArray(state.boards) ? state.boards : []).map((b) => [b?.id, resolveBoardAccentColor(b)]).filter(([id]) => !!id));
      const globalDefaults = readLaunchDefaults();
      const globalTier = Number(globalDefaults?.tier || 3);

      cardsEl.innerHTML = filtered
        .map((c) => {
          const title = (c?.name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const last = c?.dateLastActivity ? new Date(c.dateLastActivity).toLocaleString() : '';
          const board = isMultiBoard ? String(c?.__boardName || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
          const list = isMultiBoard ? String(c?.__listName || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
          const boardList = (board && list) ? `${board} • ${list}` : board;
          const meta = [boardList, last].filter(Boolean).join(' • ');

          const cardBoardId = isMultiBoard ? String(c?.idBoard || '').trim() : String(state.boardId || '').trim();
          const cardBoardColor = sanitizeCssColor(isAllBoards ? boardColorById.get(cardBoardId) : (boardColorById.get(cardBoardId) || ''));
          const boardDot = cardBoardColor ? `<span class="tasks-card-board-dot" aria-hidden="true" style="background:${escapeHtml(cardBoardColor)}"></span>` : '';
          const mappingForQuick = cardBoardId ? (getBoardMapping(state.provider, cardBoardId) || null) : null;
          const mappingEnabled = mappingForQuick ? (mappingForQuick.enabled !== false) : true;
          const mappingLocalPath = mappingForQuick ? String(mappingForQuick.localPath || '') : '';
          const canQuickLaunch = !!(mappingEnabled && mappingLocalPath && cardBoardId && cardBoardId !== ALL_BOARDS_ID);
          const tierHint = getTierHintFromLabels(state.provider, cardBoardId, c?.labels);
          const quickTier = (tierHint >= 1 && tierHint <= 4) ? tierHint : globalTier;

          const quickTierButtons = canQuickLaunch
            ? `
              <div class="tasks-quick-tier-group" data-quick-tier-group title="Launch with tier">
                <button class="btn-secondary tasks-quick-tier-btn ${quickTier === 1 ? 'is-selected' : ''}" type="button" data-quick-launch-tier-btn="1" title="Launch as T1">T1</button>
                <button class="btn-secondary tasks-quick-tier-btn ${quickTier === 2 ? 'is-selected' : ''}" type="button" data-quick-launch-tier-btn="2" title="Launch as T2">T2</button>
                <button class="btn-secondary tasks-quick-tier-btn ${quickTier === 3 ? 'is-selected' : ''}" type="button" data-quick-launch-tier-btn="3" title="Launch as T3">T3</button>
                <button class="btn-secondary tasks-quick-tier-btn ${quickTier === 4 ? 'is-selected' : ''}" type="button" data-quick-launch-tier-btn="4" title="Launch as T4">T4</button>
              </div>
            `
            : '';

          const quickLaunchHtml = canQuickLaunch
            ? `
              <div class="task-card-quick-actions" data-quick-launch-wrap>
                ${quickTierButtons}
                <button class="btn-secondary tasks-quick-launch-btn" type="button" data-quick-launch-btn title="Launch agent (uses default tier)">🚀</button>
                <button class="btn-secondary tasks-quick-launch-btn" type="button" data-quick-launch-options-btn title="Launch options">⚡</button>
              </div>
            `
            : (cardBoardId ? `<button class="btn-secondary tasks-quick-launch-btn" type="button" data-quick-launch-setup title="Set Board Settings to enable Launch">⚙</button>` : '');

          return `
            <div class="task-card-row task-card-list" data-card-id="${c.id}" data-board-id="${escapeHtml(cardBoardId)}" data-url="${c.url || ''}">
              <div class="task-card-list-main">
                <div class="task-card-title">${boardDot}${title}</div>
                <div class="task-card-meta">${meta}</div>
              </div>
              ${quickLaunchHtml ? `<div class="task-card-list-actions">${quickLaunchHtml}</div>` : ''}
            </div>
          `;
        })
        .join('');
    };

    const renderDetail = (card) => {
      if (!card) {
        state.selectedCardId = null;
        bodyEl?.classList.toggle('tasks-has-detail', false);
        detailEl.innerHTML = `<div class="tasks-detail-empty">Select a card to see details.</div>`;
        return;
      }

      state.selectedCardId = card.id || null;
      bodyEl?.classList.toggle('tasks-has-detail', !!state.selectedCardId);

      const title = escapeHtml(card?.name || '');
      const desc = escapeHtml(card?.desc || '');
      const last = card?.dateLastActivity ? new Date(card.dateLastActivity).toLocaleString() : '';
      const url = card?.url || '';

      const members = Array.isArray(card?.members) ? card.members : [];
      const memberById = new Map(members.map(m => [m?.id, m]).filter(([id]) => !!id));
      const allMembers = Array.isArray(state.boardMembers) ? state.boardMembers : [];
      const availableMembers = allMembers.filter(m => m?.id && !memberById.has(m.id));

      const labels = Array.isArray(card?.labels) ? card.labels : [];
      const selectedLabelIds = new Set(labels.map(l => l?.id).filter(Boolean));
      const boardLabels = Array.isArray(state.boardLabels) ? state.boardLabels : [];
      const labelsForEditor = boardLabels.length ? boardLabels : labels;
      const trelloLabelColor = (label) => {
        const c = String(label?.color || '').toLowerCase();
        if (!c) return '';
        const allowed = new Set(['green', 'yellow', 'orange', 'red', 'purple', 'blue', 'sky', 'lime', 'pink', 'black']);
        return allowed.has(c) ? c : '';
      };
      const labelsEditorHtml = labelsForEditor.length
        ? labelsForEditor
          .map((l) => {
            const id = l?.id || '';
            const name = String(l?.name || '').trim();
            const color = trelloLabelColor(l);
            const selected = id && selectedLabelIds.has(id);
            const labelText = name || (color ? color : 'label');
            const cls = [
              'tasks-label',
              'tasks-label-toggle',
              color ? `tasks-label--${color}` : '',
              selected ? 'is-selected' : ''
            ].filter(Boolean).join(' ');
            return `
              <button type="button" class="${cls}" data-toggle-label="${escapeHtml(id)}" title="${escapeHtml(labelText)}">
                ${selected ? '✓ ' : ''}${escapeHtml(labelText)}
              </button>
            `;
          })
          .join('')
        : `<div class="tasks-detail-empty">No labels.</div>`;

      const customFields = Array.isArray(state.boardCustomFields) ? state.boardCustomFields : [];
      const customFieldItems = Array.isArray(card?.customFieldItems) ? card.customFieldItems : [];
      const customFieldItemsById = new Map(customFieldItems.map(i => [i?.idCustomField, i]).filter(([id]) => !!id));
      const escapeAttr = (value) => escapeHtml(value).replace(/\"/g, '&quot;');
      const renderCustomFieldInput = (field) => {
        const id = field?.id;
        if (!id) return '';
        const type = String(field?.type || '').toLowerCase();
        const item = customFieldItemsById.get(id) || null;

        if (type === 'list') {
          const options = Array.isArray(field?.options) ? field.options : [];
          const current = item?.idValue || '';
          return `
            <select class="tasks-select tasks-select-inline tasks-cf-input" data-cf-id="${escapeHtml(id)}" data-cf-type="list" data-cf-initial="${escapeAttr(current)}">
              <option value="">(none)</option>
              ${options.map(o => `
                <option value="${escapeHtml(o?.id || '')}" ${o?.id === current ? 'selected' : ''}>${escapeHtml(o?.value?.text || o?.value?.name || o?.id || '')}</option>
              `).join('')}
            </select>
          `;
        }

        if (type === 'checkbox') {
          const checked = String(item?.value?.checked || '').toLowerCase() === 'true';
          return `
            <label class="tasks-checkbox">
              <input type="checkbox" class="tasks-cf-input" data-cf-id="${escapeHtml(id)}" data-cf-type="checkbox" data-cf-initial="${checked ? 'true' : 'false'}" ${checked ? 'checked' : ''} />
              <span>${checked ? 'checked' : 'unchecked'}</span>
            </label>
          `;
        }

        if (type === 'date') {
          const value = toDatetimeLocalValue(item?.value?.date);
          return `
            <input type="datetime-local" class="tasks-input tasks-input-inline tasks-cf-input" value="${escapeAttr(value)}" data-cf-id="${escapeHtml(id)}" data-cf-type="date" data-cf-initial="${escapeAttr(value)}" />
          `;
        }

        if (type === 'number') {
          const value = item?.value?.number ?? '';
          return `
            <input type="number" step="any" class="tasks-input tasks-input-inline tasks-cf-input" value="${escapeAttr(value)}" data-cf-id="${escapeHtml(id)}" data-cf-type="number" data-cf-initial="${escapeAttr(value)}" />
          `;
        }

        const value = item?.value?.text ?? '';
        return `
          <input type="text" class="tasks-input tasks-input-inline tasks-cf-input" value="${escapeAttr(value)}" data-cf-id="${escapeHtml(id)}" data-cf-type="text" data-cf-initial="${escapeAttr(value)}" />
        `;
      };
      const customFieldsEditorHtml = customFields.length
        ? customFields
          .map((field) => `
            <div class="tasks-kv-row tasks-kv-row-edit">
              <div class="tasks-kv-key">${escapeHtml(field?.name || field?.id || '')}</div>
              <div class="tasks-kv-val tasks-kv-val-edit">${renderCustomFieldInput(field)}</div>
            </div>
          `)
          .join('')
        : `<div class="tasks-detail-empty">None.</div>`;

	      const listsById = new Map((state.lists || []).map(l => [l.id, l]));
	      const currentListName = listsById.get(card?.idList)?.name || '';

      const actions = Array.isArray(card?.actions) ? card.actions : [];
      const comments = actions
        .filter(a => a?.type === 'commentCard' && a?.data?.text)
        .map(a => ({
          id: a.id,
          text: a.data.text,
          date: a.date,
          author: a.memberCreator?.fullName || a.memberCreator?.username || a.idMemberCreator || 'unknown'
        }))
        .sort((a, b) => (Date.parse(b.date || '') || 0) - (Date.parse(a.date || '') || 0));

      const dueValue = toDatetimeLocalValue(card?.due);
      const effectiveBoardId =
        (state.boardId === ALL_BOARDS_ID || state.boardId === COMBINED_VIEW_ID)
          ? String(card?.idBoard || '').trim()
          : String(state.boardId || '').trim();

      const dependencyChecklistName = getDependencyChecklistNameForBoard(state.provider, effectiveBoardId);
      const dependencyChecklistKey = String(dependencyChecklistName || '').trim().toLowerCase() || 'dependencies';

      const checklists = Array.isArray(card?.checklists) ? card.checklists : [];
      const depChecklist = checklists.find(cl => String(cl?.name || '').trim().toLowerCase() === dependencyChecklistKey);
      const depItemsRaw = Array.isArray(depChecklist?.checkItems) ? depChecklist.checkItems : [];
      const dependencies = depItemsRaw.map(i => {
        const name = String(i?.name || '').trim();
        const match = name.match(/https?:\/\/\S+/);
        const url = match ? match[0] : '';
        const isComplete = String(i?.state || '').toLowerCase() === 'complete';
        return {
          id: i?.id || '',
          name,
          url,
          isComplete
        };
      }).filter(d => !!d.id);

	      const mapping = effectiveBoardId ? (getBoardMapping(state.provider, effectiveBoardId) || null) : null;
	      const mappingEnabled = mapping ? (mapping.enabled !== false) : true;
	      const mappingLocalPath = mapping ? String(mapping.localPath || '') : '';
		      const mappingTier = Number(mapping?.defaultStartTier);
		      const launchDefaults = readLaunchDefaults({ mappingTier });
		      const tierHint = getTierHintFromLabels(state.provider, effectiveBoardId, labels);
		      const defaultLaunchTier = (tierHint >= 1 && tierHint <= 4) ? tierHint : Number(launchDefaults?.tier || 3);
		      const defaultPromptId = card?.id ? `trello:${card.id}` : '';

	      detailEl.innerHTML = `
	        <div class="tasks-detail-header">
	          <div class="tasks-detail-title">
	            <input id="tasks-card-title" class="tasks-input" value="${title.replace(/\"/g, '&quot;')}" />
          </div>
          <div class="tasks-detail-actions">
            ${url ? `<a class="btn-secondary tasks-open" href="${url}" target="_blank" rel="noreferrer">↗ Open in Trello</a>` : ''}
            <button class="btn-secondary" id="tasks-card-save">💾 Save</button>
          </div>
        </div>
        <div class="tasks-detail-meta">Last activity: ${last || 'unknown'} • List: ${currentListName || card?.idList || 'unknown'}</div>
        <div class="tasks-detail-meta">
          Members:
          <span class="tasks-chips" id="tasks-member-chips">
            ${members.length === 0 ? `<span class="tasks-chip tasks-chip-muted">none</span>` : members.map(m => `
              <span class="tasks-chip" data-member-id="${escapeHtml(m?.id || '')}">
                ${m?.avatarUrl ? `<img class="tasks-chip-avatar" src="${escapeHtml(toTrelloAvatarUrl(m.avatarUrl, 50))}" alt="">` : ''}
                ${m?.username ? `<a class="tasks-chip-link" href="https://trello.com/${escapeHtml(m.username)}" target="_blank" rel="noreferrer">${escapeHtml(m?.fullName || m?.username || m?.id || '')}</a>` : escapeHtml(m?.fullName || m?.username || m?.id || '')}
                <button class="tasks-chip-x" type="button" title="Unassign" data-remove-member="${escapeHtml(m?.id || '')}">×</button>
              </span>
            `).join('')}
          </span>
        </div>
	        <div class="tasks-detail-meta">
	          Due:
	          <input id="tasks-card-due" class="tasks-input tasks-input-inline" type="datetime-local" value="${escapeHtml(dueValue)}" />
	          <button class="btn-secondary" id="tasks-card-due-save" title="Set due date">Set</button>
	          <button class="btn-secondary" id="tasks-card-due-clear" title="Clear due date">Clear</button>
	        </div>

		        <div class="tasks-detail-block">
		          <div class="tasks-detail-block-title">Launch</div>
              <div class="tasks-inline-row" style="gap:8px; flex-wrap:wrap; margin-bottom:8px;">
                <div class="tasks-quick-tier-group" data-detail-launch-tier-group title="Tier (Alt+1..4)">
                  <button class="btn-secondary tasks-quick-tier-btn" type="button" data-detail-launch-tier-btn="1" title="Tier 1 (Alt+1)">T1</button>
                  <button class="btn-secondary tasks-quick-tier-btn" type="button" data-detail-launch-tier-btn="2" title="Tier 2 (Alt+2)">T2</button>
                  <button class="btn-secondary tasks-quick-tier-btn" type="button" data-detail-launch-tier-btn="3" title="Tier 3 (Alt+3)">T3</button>
                  <button class="btn-secondary tasks-quick-tier-btn" type="button" data-detail-launch-tier-btn="4" title="Tier 4 (Alt+4)">T4</button>
                </div>
                <div class="tasks-quick-tier-group" data-detail-launch-agent-group title="Agent">
                  <button class="btn-secondary tasks-quick-tier-btn" type="button" data-detail-launch-agent-btn="claude" title="Claude">Claude</button>
                  <button class="btn-secondary tasks-quick-tier-btn" type="button" data-detail-launch-agent-btn="codex" title="Codex">Codex</button>
                </div>
                <div class="tasks-quick-tier-group" data-detail-launch-mode-group title="Mode">
                  <button class="btn-secondary tasks-quick-tier-btn" type="button" data-detail-launch-mode-btn="fresh" title="Fresh">Fresh</button>
                  <button class="btn-secondary tasks-quick-tier-btn" type="button" data-detail-launch-mode-btn="continue" title="Continue">Cont</button>
                  <button class="btn-secondary tasks-quick-tier-btn" type="button" data-detail-launch-mode-btn="resume" title="Resume">Res</button>
                </div>
              </div>
		          <div class="tasks-inline-row" style="gap:8px; flex-wrap:wrap;">
		            <select id="tasks-launch-tier" class="tasks-select tasks-select-inline" title="Tier">
		              <option value="1" ${defaultLaunchTier === 1 ? 'selected' : ''}>T1</option>
		              <option value="2" ${defaultLaunchTier === 2 ? 'selected' : ''}>T2</option>
		              <option value="3" ${defaultLaunchTier === 3 ? 'selected' : ''}>T3</option>
		              <option value="4" ${defaultLaunchTier === 4 ? 'selected' : ''}>T4</option>
		            </select>
		            <select id="tasks-launch-agent" class="tasks-select tasks-select-inline" title="Agent">
		              <option value="claude" ${launchDefaults.agentId === 'claude' ? 'selected' : ''}>Claude</option>
		              <option value="codex" ${launchDefaults.agentId === 'codex' ? 'selected' : ''}>Codex</option>
		            </select>
		            <select id="tasks-launch-mode" class="tasks-select tasks-select-inline" title="Mode">
		              <option value="fresh" ${launchDefaults.mode === 'fresh' ? 'selected' : ''}>Fresh</option>
		              <option value="continue" ${launchDefaults.mode === 'continue' ? 'selected' : ''}>Continue</option>
		              <option value="resume" ${launchDefaults.mode === 'resume' ? 'selected' : ''}>Resume</option>
		            </select>
		            <label class="tasks-toggle" title="Skip permission prompts (YOLO)">
		              <input type="checkbox" id="tasks-launch-yolo" ${launchDefaults.yolo ? 'checked' : ''} />
		              <span>YOLO</span>
		            </label>
		            <label class="tasks-toggle" title="Auto-send card description as the first prompt">
		              <input type="checkbox" id="tasks-launch-auto-send" ${launchDefaults.autoSendPrompt ? 'checked' : ''} />
		              <span>Auto-send prompt</span>
		            </label>
		            <button class="btn-secondary" id="tasks-launch-btn" type="button">🚀 Launch</button>
		          </div>
	          <div class="tasks-detail-empty" style="margin-top:8px">
	            ${mappingEnabled && mappingLocalPath
	              ? `Mapped repo: <code>${escapeHtml(mappingLocalPath)}</code>`
	              : `No board mapping set. <button class="btn-secondary" id="tasks-launch-open-board-settings" type="button">Open Board Settings</button>`}
	          </div>
	        </div>

	        <div class="tasks-detail-block">
	          <div class="tasks-detail-block-title">Assign Member</div>
	          <div class="tasks-inline-row">
	            <select id="tasks-assign-member" class="tasks-select tasks-select-inline">
              <option value="">Select member…</option>
              ${availableMembers.map(m => `
                <option value="${escapeHtml(m?.id || '')}">${escapeHtml(m?.fullName || m?.username || m?.id || '')}</option>
              `).join('')}
            </select>
            <button class="btn-secondary" id="tasks-assign-member-btn">＋ Assign</button>
          </div>
        </div>

        <div class="tasks-detail-block">
          <div class="tasks-detail-block-title">Labels (${selectedLabelIds.size})</div>
          <div class="tasks-label-editor" id="tasks-label-editor">
            ${labelsEditorHtml}
          </div>
        </div>

        <div class="tasks-detail-block">
          <div class="tasks-detail-block-title">Custom Fields</div>
          <div class="tasks-kv">
            ${customFieldsEditorHtml}
          </div>
        </div>

        <div class="tasks-detail-block">
          <div class="tasks-detail-block-title">Dependencies (${dependencies.length})</div>
          <div class="tasks-deps">
            ${dependencies.length === 0 ? `<div class="tasks-detail-empty">No dependencies.</div>` : dependencies.map(d => `
              <div class="tasks-dep-row ${d.isComplete ? 'done' : ''}">
                <input type="checkbox" class="tasks-dep-checkbox" data-dep-id="${escapeHtml(d.id)}" ${d.isComplete ? 'checked' : ''} />
                <div class="tasks-dep-text">
                  ${d.url ? `<a href="${escapeHtml(d.url)}" target="_blank" rel="noreferrer">${escapeHtml(d.name)}</a>` : escapeHtml(d.name)}
                </div>
                <button class="btn-secondary tasks-dep-remove" type="button" title="Remove dependency" data-remove-dep="${escapeHtml(d.id)}">×</button>
              </div>
            `).join('')}
          </div>
          <div class="tasks-inline-row tasks-dep-add">
            <input id="tasks-dep-input" class="tasks-input" placeholder="Paste Trello card URL or shortLink…" />
            <button class="btn-secondary" id="tasks-dep-add-btn">＋ Add</button>
          </div>
        </div>

	        <div class="tasks-detail-block">
	          <div class="tasks-detail-block-title">Description</div>
	          <textarea id="tasks-card-desc" class="tasks-textarea" rows="10" placeholder="(no description)">${desc}</textarea>
	        </div>

	        <div class="tasks-detail-block">
	          <div class="tasks-detail-block-title">Prompt Artifact</div>
	          <div class="tasks-inline-row" style="gap:8px; flex-wrap:wrap;">
	            <input id="tasks-prompt-id" class="tasks-input" style="min-width: 260px; flex: 1;" value="${escapeHtml(defaultPromptId)}" placeholder="Prompt id (e.g. trello:...)" />
	            <button class="btn-secondary" id="tasks-prompt-save" type="button" title="Save card description as a private prompt artifact">💾 Save from desc</button>
	            <button class="btn-secondary" id="tasks-prompt-open" type="button" title="Open prompt editor (promote + optional pointer comment)">📝 Open</button>
	          </div>
	          <div class="tasks-detail-empty" style="margin-top:8px">
	            Tip: promote to shared/encrypted in the editor, and optionally “Comment pointer” back to this card.
	          </div>
	        </div>

	        <div class="tasks-detail-block">
	          <div class="tasks-detail-block-title">Move</div>
	          <div class="tasks-move-row">
            <select id="tasks-card-move" class="tasks-select tasks-select-inline">
              ${(state.lists || []).map(l => `
                <option value="${l.id}" ${l.id === card?.idList ? 'selected' : ''}>${(l?.name || l.id).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</option>
              `).join('')}
            </select>
            <button class="btn-secondary" id="tasks-card-move-btn">➡ Move</button>
          </div>
        </div>

        <div class="tasks-detail-block">
          <div class="tasks-detail-block-title">Add Comment</div>
          <div class="tasks-comment-row">
            <textarea id="tasks-card-comment" class="tasks-textarea" rows="3" placeholder="Write a comment..."></textarea>
            <button class="btn-secondary" id="tasks-card-comment-btn">💬 Comment</button>
          </div>
        </div>

        <div class="tasks-detail-block">
          <div class="tasks-detail-block-title">Comments (${comments.length})</div>
          <div class="tasks-comments">
            ${comments.length === 0 ? `<div class="tasks-detail-empty">No comments.</div>` : comments.slice(0, 50).map(c => `
              <div class="tasks-comment">
                <div class="tasks-comment-meta">${String(c.author).replace(/</g, '&lt;').replace(/>/g, '&gt;')} • ${c.date ? new Date(c.date).toLocaleString() : ''}</div>
                <div class="tasks-comment-text">${String(c.text).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    };

    const showConfigHint = (providerLabel = 'Trello') => {
      cardsEl.innerHTML = `
        <div class="tasks-config-hint">
          <div class="tasks-config-title">${providerLabel} not configured</div>
          <div class="tasks-config-text">
            Set <code>TRELLO_API_KEY</code> and <code>TRELLO_TOKEN</code> in your environment (or create <code>~/.trello-credentials</code> with <code>API_KEY=...</code> and <code>TOKEN=...</code>).
          </div>
        </div>
      `;
      renderDetail(null);
    };

    const fetchProviders = async () => {
      const res = await fetch(`${serverUrl}/api/tasks/providers`);
      if (!res.ok) throw new Error('Failed to load task providers');
      return res.json();
    };

    const fetchBoardMembers = async ({ boardId = state.boardId, refresh = false } = {}) => {
      if (!boardId || boardId === ALL_BOARDS_ID) return [];
      const url = new URL(`${serverUrl}/api/tasks/boards/${encodeURIComponent(boardId)}/members`);
      url.searchParams.set('provider', state.provider);
      if (refresh) url.searchParams.set('refresh', 'true');
      const res = await fetch(url.toString());
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to load board members');
      return data.members || [];
    };

    const fetchBoardCustomFields = async ({ boardId = state.boardId, refresh = false } = {}) => {
      if (!boardId || boardId === ALL_BOARDS_ID) return [];
      const url = new URL(`${serverUrl}/api/tasks/boards/${encodeURIComponent(boardId)}/custom-fields`);
      url.searchParams.set('provider', state.provider);
      if (refresh) url.searchParams.set('refresh', 'true');
      const res = await fetch(url.toString());
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to load board custom fields');
      return data.customFields || [];
    };

    const fetchBoardLabels = async ({ boardId = state.boardId, refresh = false } = {}) => {
      if (!boardId || boardId === ALL_BOARDS_ID) return [];
      const url = new URL(`${serverUrl}/api/tasks/boards/${encodeURIComponent(boardId)}/labels`);
      url.searchParams.set('provider', state.provider);
      if (refresh) url.searchParams.set('refresh', 'true');
      const res = await fetch(url.toString());
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to load board labels');
      return data.labels || [];
    };

    const fetchBoards = async ({ refresh = false } = {}) => {
      const url = new URL(`${serverUrl}/api/tasks/boards`);
      url.searchParams.set('provider', state.provider);
      if (refresh) url.searchParams.set('refresh', 'true');
      const res = await fetch(url.toString());
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to load boards');
      return data.boards || [];
    };

    const fetchLists = async ({ boardId = state.boardId, refresh = false } = {}) => {
      if (!boardId || boardId === ALL_BOARDS_ID) return [];
      const url = new URL(`${serverUrl}/api/tasks/boards/${encodeURIComponent(boardId)}/lists`);
      url.searchParams.set('provider', state.provider);
      if (refresh) url.searchParams.set('refresh', 'true');
      const res = await fetch(url.toString());
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to load lists');
      return data.lists || [];
    };

    const loadBoardMeta = async ({ boardId, refresh = false } = {}) => {
      const bid = String(boardId || '').trim();
      if (!bid || bid === ALL_BOARDS_ID) {
        return { lists: [], members: [], labels: [], customFields: [] };
      }

      const cached = state.boardMetaCache?.get?.(bid);
      if (cached && !refresh) return cached;

      const [lists, members, labels, customFields] = await Promise.all([
        fetchLists({ boardId: bid, refresh }).catch(() => []),
        fetchBoardMembers({ boardId: bid, refresh }).catch(() => []),
        fetchBoardLabels({ boardId: bid, refresh }).catch(() => []),
        fetchBoardCustomFields({ boardId: bid, refresh }).catch(() => [])
      ]);

      const meta = { lists: lists || [], members: members || [], labels: labels || [], customFields: customFields || [] };
      try {
        state.boardMetaCache?.set?.(bid, meta);
      } catch {
        // ignore
      }
      return meta;
    };

    const fetchSnapshot = async ({ refresh = false } = {}) => {
      if (!state.boardId || state.boardId === ALL_BOARDS_ID) return null;
      const url = new URL(`${serverUrl}/api/tasks/boards/${encodeURIComponent(state.boardId)}/snapshot`);
      url.searchParams.set('provider', state.provider);
      if (refresh) url.searchParams.set('refresh', 'true');
      if (state.query) url.searchParams.set('q', state.query);
      const updatedSince = computeUpdatedSince();
      if (updatedSince) url.searchParams.set('updatedSince', updatedSince);

      const res = await fetch(url.toString());
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to load board snapshot');
      return data;
    };

    const fetchCombinedSnapshot = async ({ refresh = false } = {}) => {
      const selections = getCombinedSelections();
      const maxCols = 16;
      const slice = selections.slice(0, maxCols);
      if (slice.length === 0) return { columns: [] };

      const boardsById = new Map((Array.isArray(state.boards) ? state.boards : []).map((b) => [b?.id, b]));
      const updatedSince = computeUpdatedSince();
      const q = state.query;

      const boardIds = Array.from(new Set(slice.map((s) => s.boardId).filter(Boolean)));
      const metaPairs = await Promise.all(
        boardIds.map(async (boardId) => {
          const meta = await loadBoardMeta({ boardId, refresh: false }).catch(() => ({ lists: [] }));
          return [boardId, meta];
        })
      );
      const metaByBoard = new Map(metaPairs);

      const fetchOne = async (sel) => {
        const boardId = String(sel?.boardId || '').trim();
        const listId = String(sel?.listId || '').trim();
        if (!boardId || !listId) return null;

        const url = new URL(`${serverUrl}/api/tasks/lists/${encodeURIComponent(listId)}/cards`);
        url.searchParams.set('provider', state.provider);
        if (refresh) url.searchParams.set('refresh', 'true');
        if (q) url.searchParams.set('q', q);
        if (updatedSince) url.searchParams.set('updatedSince', updatedSince);

        const res = await fetch(url.toString());
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Failed to load list cards');

        const board = boardsById.get(boardId);
        const boardName = String(board?.name || boardId);
        const boardColor = resolveBoardAccentColor(board);
        const meta = metaByBoard.get(boardId) || { lists: [] };
        const list = (meta?.lists || []).find((l) => l?.id === listId);
        const listName = String(list?.name || listId);

        const cards = Array.isArray(data.cards) ? data.cards : [];
        const normalized = cards.map((c) => ({
          ...c,
          idBoard: c?.idBoard || boardId,
          idList: c?.idList || listId,
          __boardName: boardName,
          __listName: listName
        }));

        return { boardId, boardName, boardColor, listId, listName, cards: normalized };
      };

      const results = await Promise.all(slice.map((s) => fetchOne(s).catch(() => null)));
      return { columns: results.filter(Boolean) };
    };

    const renderCombinedBoard = (snapshot) => {
      const cols = Array.isArray(snapshot?.columns) ? snapshot.columns : [];
      if (cols.length === 0) {
        cardsEl.innerHTML = `
          <div class="tasks-config-hint">
            <div class="tasks-config-title">Combined view has no columns yet</div>
            <div class="tasks-config-text">Click 🧲 to pick lists/columns from any boards.</div>
          </div>
        `;
        return;
      }

      const updatedSince = computeUpdatedSince();
      const layoutMode = state.boardLayout || 'scroll';
      const isWrap = layoutMode === 'wrap';
      const isWrapExpand = layoutMode === 'wrap-expand';

      const sortCards = (arr) => {
        const cards = (Array.isArray(arr) ? [...arr] : []).filter(passesAssigneeFilter);
        if (state.sort === 'activity') {
          cards.sort((a, b) => (Date.parse(b?.dateLastActivity || '') || 0) - (Date.parse(a?.dateLastActivity || '') || 0));
          return cards;
        }
        if (state.sort === 'name') {
          cards.sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
          return cards;
        }
        cards.sort((a, b) => (a?.pos ?? 0) - (b?.pos ?? 0));
        return cards;
      };

      const globalDefaults = readLaunchDefaults();
      const globalTier = Number(globalDefaults?.tier || 3);

      cardsEl.innerHTML = `
        <div class="tasks-board ${isWrap ? 'tasks-board-wrap tasks-board-grid' : ''} ${isWrapExpand ? 'tasks-board-expand tasks-board-grid' : ''}" id="tasks-board-view">
          ${cols
            .map((col) => {
              const raw = Array.isArray(col?.cards) ? col.cards : [];
              const cards = sortCards(raw);
              if (state.hideEmptyColumns && cards.length === 0) return '';

              const boardDot = col.boardColor
                ? `<span class="tasks-board-menu-dot" style="background-color:${escapeHtml(col.boardColor)}" aria-hidden="true"></span>`
                : `<span class="tasks-board-menu-dot is-hidden" aria-hidden="true"></span>`;

              return `
                <div class="tasks-column is-expanded" data-list-id="${escapeHtml(`${col.boardId}:${col.listId}`)}">
                  <button class="tasks-column-header" type="button" aria-expanded="true">
                    <div class="tasks-column-title">${boardDot}${escapeHtml(col.boardName)} • ${escapeHtml(col.listName)}</div>
                    <div class="tasks-column-count" data-count>${cards.length}</div>
                  </button>
                  <div class="tasks-column-cards">
                    ${cards
                      .map((c) => {
                        const title = escapeHtml(String(c?.name || '').trim() || c?.id || '');
                        const last = c?.dateLastActivity ? new Date(c.dateLastActivity).toLocaleString() : '';
                        const cardBoardId = String(c?.idBoard || col.boardId || '').trim();
                        const mappingForQuick = cardBoardId ? (getBoardMapping(state.provider, cardBoardId) || null) : null;
                        const mappingEnabled = mappingForQuick ? (mappingForQuick.enabled !== false) : true;
                        const mappingLocalPath = mappingForQuick ? String(mappingForQuick.localPath || '') : '';
                        const canQuickLaunch = !!(mappingEnabled && mappingLocalPath && cardBoardId && cardBoardId !== ALL_BOARDS_ID);
                        const tierHint = getTierHintFromLabels(state.provider, cardBoardId, c?.labels);
                        const quickTier = (tierHint >= 1 && tierHint <= 4) ? tierHint : globalTier;

                        const quickTierButtons = canQuickLaunch
                          ? `
                            <div class="tasks-quick-tier-group" data-quick-tier-group>
                              <button class="btn-secondary tasks-quick-tier-btn ${quickTier === 1 ? 'is-selected' : ''}" type="button" data-quick-launch-tier-btn="1" title="Launch as T1">T1</button>
                              <button class="btn-secondary tasks-quick-tier-btn ${quickTier === 2 ? 'is-selected' : ''}" type="button" data-quick-launch-tier-btn="2" title="Launch as T2">T2</button>
                              <button class="btn-secondary tasks-quick-tier-btn ${quickTier === 3 ? 'is-selected' : ''}" type="button" data-quick-launch-tier-btn="3" title="Launch as T3">T3</button>
                              <button class="btn-secondary tasks-quick-tier-btn ${quickTier === 4 ? 'is-selected' : ''}" type="button" data-quick-launch-tier-btn="4" title="Launch as T4">T4</button>
                            </div>
                          `
                          : '';

                        const quickLaunchHtml = canQuickLaunch
                          ? `
                            <div class="task-card-quick-actions" data-quick-launch-wrap>
                              ${quickTierButtons}
                              <button class="btn-secondary tasks-quick-launch-btn" type="button" data-quick-launch-btn title="Launch agent (uses default tier)">🚀</button>
                              <button class="btn-secondary tasks-quick-launch-btn" type="button" data-quick-launch-options-btn title="Launch options">⚡</button>
                            </div>
                          `
                          : (cardBoardId ? `<button class="btn-secondary tasks-quick-launch-btn" type="button" data-quick-launch-setup title="Set Board Settings to enable Launch">⚙</button>` : '');

                        const meta = [
                          updatedSince ? '' : (c?.__boardName ? String(c.__boardName) : ''),
                          last
                        ].filter(Boolean).join(' • ');

                        return `
                          <div class="task-card-row task-card-board" data-card-id="${escapeHtml(c.id)}" data-board-id="${escapeHtml(cardBoardId)}" data-url="${escapeHtml(c?.url || '')}">
                            <div class="task-card-top">
                              <div class="task-card-meta">${escapeHtml(meta)}</div>
                              <div class="task-card-top-right">${quickLaunchHtml}</div>
                            </div>
                            <div class="task-card-title">${title}</div>
                          </div>
                        `;
                      })
                      .join('')}
                  </div>
                </div>
              `;
            })
            .join('')}
        </div>
      `;

      if (!isWrapExpand) return;
      const boardEl = cardsEl.querySelector('#tasks-board-view');
      if (!boardEl) return;

      const columns = Array.from(boardEl.querySelectorAll('.tasks-column'));
      const computeForColumn = (col) => {
        if (!col) return;
        const cardsContainer = col.querySelector('.tasks-column-cards');
        const header = col.querySelector('.tasks-column-header');
        if (!cardsContainer || !header) return;

        col.style.width = '';
        col.style.minWidth = '';
        const baseWidth = col.getBoundingClientRect().width;

        const cards = Array.from(cardsContainer.querySelectorAll('.task-card-board'));
        const cardCount = cards.length;
        if (cardCount === 0) {
          col.style.setProperty('--tasks-card-columns', '1');
          col.style.setProperty('--tasks-card-rows', '1');
          return;
        }

        const containerHeight = cardsContainer.clientHeight;
        if (!containerHeight || containerHeight < 40) return;

        const styles = window.getComputedStyle(cardsContainer);
        const rowGap = Number.parseFloat(styles.rowGap || styles.gap || '0') || 0;
        const sample = cards.slice(0, Math.min(6, cardCount));
        const heights = sample.map(el => el.getBoundingClientRect().height).filter(Boolean);
        const avg = heights.length ? (heights.reduce((a, b) => a + b, 0) / heights.length) : 80;
        const denom = Math.max(1, avg + rowGap);
        let rowsFit = Math.max(1, Math.floor((containerHeight + rowGap) / denom));
        rowsFit = Math.min(rowsFit, 12);

        const apply = (rows) => {
          const r = Math.max(1, Number(rows) || 1);
          const cols = Math.max(1, Math.ceil(cardCount / r));
          col.style.setProperty('--tasks-card-rows', String(r));
          col.style.setProperty('--tasks-card-columns', String(cols));
          if (cols <= 1) {
            col.style.width = '';
            col.style.minWidth = '';
          } else {
            const target = Math.max(baseWidth, baseWidth * cols);
            col.style.width = `${Math.round(target)}px`;
            col.style.minWidth = `${Math.round(target)}px`;
          }
        };

        apply(rowsFit);
        for (let attempt = 0; attempt < 6; attempt++) {
          void cardsContainer.offsetHeight;
          if (cardsContainer.scrollHeight <= cardsContainer.clientHeight + 1) break;
          rowsFit = Math.max(1, rowsFit - 1);
          apply(rowsFit);
        }
      };

      window.requestAnimationFrame(() => {
        columns.forEach(computeForColumn);
      });
    };

    const fetchCards = async ({ refresh = false } = {}) => {
      if (!state.boardId) return [];

      const updatedSince = computeUpdatedSince();
      const q = state.query;

      if (!state.listId) return [];

      if (state.boardId === ALL_BOARDS_ID) {
        const boards = Array.isArray(state.boards) ? state.boards : [];
        const enabledBoards = boards.filter((b) => {
          if (!b?.id) return false;
          return isBoardEnabled(state.provider, b.id);
        });

        // Avoid super wide fan-out by default; users should disable noisy boards.
        const maxBoards = 12;
        const slice = enabledBoards.slice(0, maxBoards);

        const boardNameById = new Map(slice.map((b) => [b.id, b.name || b.id]));

        const fetchOne = async (boardId) => {
          const url = new URL(`${serverUrl}/api/tasks/boards/${encodeURIComponent(boardId)}/cards`);
          url.searchParams.set('provider', state.provider);
          if (refresh) url.searchParams.set('refresh', 'true');
          if (q) url.searchParams.set('q', q);
          if (updatedSince) url.searchParams.set('updatedSince', updatedSince);
          const res = await fetch(url.toString());
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data?.error || 'Failed to load cards');
          const cards = Array.isArray(data.cards) ? data.cards : [];
          return cards.map((c) => ({ ...c, __boardName: boardNameById.get(boardId) || boardId }));
        };

        const results = await Promise.all(slice.map((b) => fetchOne(b.id).catch(() => [])));
        const merged = results.flat();
        // Sort by activity (default cross-board behavior) or name.
        if (state.sort === 'name') {
          merged.sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
        } else {
          merged.sort((a, b) => (Date.parse(b?.dateLastActivity || '') || 0) - (Date.parse(a?.dateLastActivity || '') || 0));
        }
        return merged;
      }

      if (state.listId === '__all__') {
        const url = new URL(`${serverUrl}/api/tasks/boards/${encodeURIComponent(state.boardId)}/cards`);
        url.searchParams.set('provider', state.provider);
        if (refresh) url.searchParams.set('refresh', 'true');
        if (q) url.searchParams.set('q', q);
        if (updatedSince) url.searchParams.set('updatedSince', updatedSince);
        const res = await fetch(url.toString());
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Failed to load cards');
        return data.cards || [];
      }

      const url = new URL(`${serverUrl}/api/tasks/lists/${encodeURIComponent(state.listId)}/cards`);
      url.searchParams.set('provider', state.provider);
      if (refresh) url.searchParams.set('refresh', 'true');
      if (q) url.searchParams.set('q', q);
      if (updatedSince) url.searchParams.set('updatedSince', updatedSince);
      const res = await fetch(url.toString());
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to load cards');
      return data.cards || [];
    };

    const fetchCardDetail = async (cardId) => {
      const url = new URL(`${serverUrl}/api/tasks/cards/${encodeURIComponent(cardId)}`);
      url.searchParams.set('provider', state.provider);
      const res = await fetch(url.toString());
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to load card');
      return data.card || null;
    };

    const parseResponseJson = async (res) => {
      const raw = await res.text().catch(() => '');
      if (!raw) return { raw: '', json: {} };
      try {
        return { raw, json: JSON.parse(raw) };
      } catch {
        return { raw, json: {} };
      }
    };

    const updateCard = async ({ cardId, fields } = {}) => {
      const res = await fetch(`${serverUrl}/api/tasks/cards/${encodeURIComponent(cardId)}?provider=${encodeURIComponent(state.provider)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields || {})
      });
      const { raw, json } = await parseResponseJson(res);
      if (!res.ok) throw new Error(json?.error || json?.details || raw || 'Failed to update card');
      return json.card || null;
    };

    const createCard = async ({ listId, name, desc = '' } = {}) => {
      const lid = String(listId || '').trim();
      const title = String(name || '').trim();
      if (!lid) throw new Error('List is required');
      if (!title) throw new Error('Title is required');

      const url = new URL(`${serverUrl}/api/tasks/lists/${encodeURIComponent(lid)}/cards`);
      url.searchParams.set('provider', state.provider);
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: title, desc: String(desc || '') })
      });
      const { raw, json } = await parseResponseJson(res);
      if (!res.ok) throw new Error(json?.error || json?.details || raw || 'Failed to create card');
      return json.card || null;
    };

    const updateCustomField = async ({ cardId, customFieldId, payload } = {}) => {
      const res = await fetch(`${serverUrl}/api/tasks/cards/${encodeURIComponent(cardId)}/custom-fields/${encodeURIComponent(customFieldId)}?provider=${encodeURIComponent(state.provider)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {})
      });
      const { raw, json } = await parseResponseJson(res);
      if (!res.ok) throw new Error(json?.error || json?.details || raw || 'Failed to update custom field');
      return json.card || null;
    };

    const addComment = async ({ cardId, text } = {}) => {
      const res = await fetch(`${serverUrl}/api/tasks/cards/${encodeURIComponent(cardId)}/comments?provider=${encodeURIComponent(state.provider)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const { raw, json } = await parseResponseJson(res);
      if (!res.ok) throw new Error(json?.error || json?.details || raw || 'Failed to add comment');
      return json.card || null;
    };

	    const addDependency = async ({ cardId, value, checklistName } = {}) => {
	      const trimmed = String(value || '').trim();
	      if (!trimmed) return null;

	      const body = trimmed.includes('http')
	        ? { url: trimmed }
	        : { shortLink: trimmed };

	      const url = new URL(`${serverUrl}/api/tasks/cards/${encodeURIComponent(cardId)}/dependencies`);
	      url.searchParams.set('provider', state.provider);
	      if (checklistName) url.searchParams.set('checklistName', String(checklistName));
	      const res = await fetch(url.toString(), {
	        method: 'POST',
	        headers: { 'Content-Type': 'application/json' },
	        body: JSON.stringify(body)
	      });
	      const { raw, json } = await parseResponseJson(res);
	      if (!res.ok) throw new Error(json?.error || json?.details || raw || 'Failed to add dependency');
	      return json.card || null;
	    };

	    const removeDependency = async ({ cardId, itemId, checklistName } = {}) => {
	      const url = new URL(`${serverUrl}/api/tasks/cards/${encodeURIComponent(cardId)}/dependencies/${encodeURIComponent(itemId)}`);
	      url.searchParams.set('provider', state.provider);
	      if (checklistName) url.searchParams.set('checklistName', String(checklistName));
	      const res = await fetch(url.toString(), {
	        method: 'DELETE'
	      });
	      const { raw, json } = await parseResponseJson(res);
	      if (!res.ok) throw new Error(json?.error || json?.details || raw || 'Failed to remove dependency');
	      return json.card || null;
	    };

    const setDependencyState = async ({ cardId, itemId, state: nextState, checklistName } = {}) => {
      const url = new URL(`${serverUrl}/api/tasks/cards/${encodeURIComponent(cardId)}/dependencies/${encodeURIComponent(itemId)}`);
      url.searchParams.set('provider', state.provider);
      if (checklistName) url.searchParams.set('checklistName', String(checklistName));
      const res = await fetch(url.toString(), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: nextState })
      });
      const { raw, json } = await parseResponseJson(res);
      if (!res.ok) throw new Error(json?.error || json?.details || raw || 'Failed to update dependency');
      return json.card || null;
    };

    const renderBoard = (snapshot) => {
      if (!state.boardId) {
        cardsEl.innerHTML = `<div class="no-ports">Select a board to view cards.</div>`;
        return;
      }

      if (!snapshot || !Array.isArray(snapshot.lists)) {
        cardsEl.innerHTML = `<div class="no-ports">No board data.</div>`;
        return;
      }

      const lists = snapshot.lists || [];
      const cardsByList = snapshot.cardsByList || {};
      const layoutMode = state.boardLayout || 'scroll';
      const isWrap = layoutMode === 'wrap';
      const isWrapExpand = layoutMode === 'wrap-expand';

      const board = Array.isArray(state.boards) ? state.boards.find(b => b?.id === state.boardId) : null;
      setBoardAccent(resolveBoardAccentColor(board));

      const membersById = new Map((state.boardMembers || []).map(m => [m?.id, m]).filter(([id]) => !!id));
      const trelloLabelColor = (label) => {
        const c = String(label?.color || '').toLowerCase();
        if (!c) return '';
        const allowed = new Set(['green', 'yellow', 'orange', 'red', 'purple', 'blue', 'sky', 'lime', 'pink', 'black']);
        return allowed.has(c) ? c : '';
      };

      const renderCompactLabels = (labels) => {
        const arr = Array.isArray(labels) ? labels : [];
        if (arr.length === 0) return '';
        const max = 2;
        const shown = arr.slice(0, max);
        const more = arr.length - shown.length;
        return `
          <div class="task-card-labels">
            ${shown.map((l) => {
              const color = trelloLabelColor(l);
              const name = String(l?.name || '').trim();
              const text = name || color || '';
              if (!text) return '';
              const cls = ['tasks-label', color ? `tasks-label--${color}` : ''].filter(Boolean).join(' ');
              return `<span class="${cls}" title="${escapeHtml(text)}">${escapeHtml(text)}</span>`;
            }).join('')}
            ${more > 0 ? `<span class="tasks-label tasks-label--more" title="${more} more">+${more}</span>` : ''}
          </div>
        `;
      };

      const sortCards = (arr) => {
        const cards = (Array.isArray(arr) ? [...arr] : []).filter(passesAssigneeFilter);
        if (state.sort === 'activity') {
          cards.sort((a, b) => (Date.parse(b?.dateLastActivity || '') || 0) - (Date.parse(a?.dateLastActivity || '') || 0));
          return cards;
        }
        if (state.sort === 'name') {
          cards.sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
          return cards;
        }
        // Default: Trello order / pos
        cards.sort((a, b) => (a?.pos ?? 0) - (b?.pos ?? 0));
        return cards;
      };

	      const mappingForQuick = getBoardMapping(state.provider, state.boardId) || null;
	      const mappingTier2 = Number(mappingForQuick?.defaultStartTier);
	      const quickDefaults = readLaunchDefaults({ mappingTier: mappingTier2 });
	      const mappingEnabled2 = mappingForQuick ? (mappingForQuick.enabled !== false) : true;
	      const mappingLocalPath2 = mappingForQuick ? String(mappingForQuick.localPath || '') : '';
	      const canQuickLaunch = !!(mappingEnabled2 && mappingLocalPath2);

	      cardsEl.innerHTML = `
	        <div class="tasks-board ${isWrap ? 'tasks-board-wrap tasks-board-grid' : ''} ${isWrapExpand ? 'tasks-board-expand tasks-board-grid' : ''}" id="tasks-board-view">
	          ${lists.map(list => {
            const raw = Array.isArray(cardsByList[list.id]) ? cardsByList[list.id] : [];
            const cards = sortCards(raw);
            if (state.hideEmptyColumns && cards.length === 0) return '';
            return `
              <div class="tasks-column is-expanded" id="tasks-col-${list.id}" data-list-id="${list.id}" data-column-name="${escapeHtml(list.name || '')}">
                <button class="tasks-column-header" type="button" data-col-toggle="${list.id}" aria-expanded="true">
                  <div class="tasks-column-title">${escapeHtml(list.name || '')}</div>
                  <div class="tasks-column-count" data-count>${cards.length}</div>
                </button>
                <div class="tasks-column-cards" data-dropzone data-dropzone-list="${list.id}">
                  ${cards.map(c => {
                    const title = String(c?.name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    const last = c?.dateLastActivity ? new Date(c.dateLastActivity).toLocaleString() : '';
                    const due = c?.due ? new Date(c.due).toLocaleDateString() : '';
                    const labels = Array.isArray(c?.labels) ? c.labels : [];
                    const memberIds = Array.isArray(c?.idMembers) ? c.idMembers : [];
                    const members = memberIds.map(id => membersById.get(id)).filter(Boolean).slice(0, 3);
                    const moreMembers = Math.max(0, memberIds.length - members.length);
	                    const fallbackTier = Number(quickDefaults?.tier || 3);
	                    const tierHint = getTierHintFromLabels(state.provider, state.boardId, labels);
	                    const quickTier = (tierHint >= 1 && tierHint <= 4) ? tierHint : fallbackTier;
                      const quickTierButtons = `
                        <div class="tasks-quick-tier-group" data-quick-tier-group>
                          <button class="btn-secondary tasks-quick-tier-btn ${quickTier === 1 ? 'is-selected' : ''}" type="button" data-quick-launch-tier-btn="1" title="Launch as T1">T1</button>
                          <button class="btn-secondary tasks-quick-tier-btn ${quickTier === 2 ? 'is-selected' : ''}" type="button" data-quick-launch-tier-btn="2" title="Launch as T2">T2</button>
                          <button class="btn-secondary tasks-quick-tier-btn ${quickTier === 3 ? 'is-selected' : ''}" type="button" data-quick-launch-tier-btn="3" title="Launch as T3">T3</button>
                          <button class="btn-secondary tasks-quick-tier-btn ${quickTier === 4 ? 'is-selected' : ''}" type="button" data-quick-launch-tier-btn="4" title="Launch as T4">T4</button>
                        </div>
                      `;
	                    const quickLaunchHtml = canQuickLaunch
	                      ? `
	                        <div class="task-card-quick-actions" data-quick-launch-wrap>
                            ${quickTierButtons}
	                          <button class="btn-secondary tasks-quick-launch-btn" type="button" data-quick-launch-btn title="Launch agent (uses default tier)">🚀</button>
                            <button class="btn-secondary tasks-quick-launch-btn" type="button" data-quick-launch-options-btn title="Launch options">⚡</button>
	                        </div>
	                      `
	                      : `
	                        <button class="btn-secondary tasks-quick-launch-btn" type="button" data-quick-launch-setup title="Set Board Settings to enable Launch">⚙</button>
	                      `;

		                    return `
		                      <div class="task-card-row task-card-board" draggable="true" data-card-id="${c.id}" data-board-id="${escapeHtml(state.boardId)}" data-origin-list-id="${list.id}" data-url="${escapeHtml(c?.url || '')}">
		                        <div class="task-card-top">
		                          ${renderCompactLabels(labels)}
		                          <div class="task-card-top-right">
		                            ${quickLaunchHtml}
	                            <div class="task-card-assignees">
	                              ${members.map(m => {
	                                const url = m?.username ? `https://trello.com/${m.username}` : '';
	                                const initial = String(m?.fullName || m?.username || '?').trim().slice(0, 1).toUpperCase();
	                                const avatar = m?.avatarUrl ? toTrelloAvatarUrl(m.avatarUrl, 50) : '';
	                                return `
	                                  <a class="tasks-avatar" href="${escapeHtml(url)}" target="_blank" rel="noreferrer" title="${escapeHtml(m?.fullName || m?.username || '')}">
	                                    ${avatar ? `<img src="${escapeHtml(avatar)}" alt="">` : `<span>${escapeHtml(initial)}</span>`}
	                                  </a>
	                                `;
	                              }).join('')}
	                              ${moreMembers ? `<span class="tasks-avatar tasks-avatar-more" title="${moreMembers} more">+${moreMembers}</span>` : ''}
	                            </div>
	                          </div>
	                        </div>
	                        <div class="task-card-title">${title}</div>
	                        <div class="task-card-meta">${due ? `<span class="task-card-due" title="Due">${escapeHtml(due)}</span> • ` : ''}${last}</div>
	                      </div>
	                    `;
	                  }).join('')}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;

      // Layout behavior:
      // - scroll: 1-row lists, horizontal scroll, per-list vertical scroll
      // - wrap: multi-row lists (no horizontal scroll), per-list vertical scroll
      // - wrap-expand: 1-row lists, horizontal scroll, expanded lists widen into multiple card columns (no vertical scrolling)
      bodyEl?.classList.toggle('tasks-kanban-wrap', !!isWrap);
      bodyEl?.classList.toggle('tasks-kanban-wrap-expand', !!isWrapExpand);

      if (!isWrapExpand && this.tasksWrapExpandResizeHandler) {
        window.removeEventListener('resize', this.tasksWrapExpandResizeHandler);
        this.tasksWrapExpandResizeHandler = null;
      }

      const applyWrapExpandColumns = () => {
        if (!isWrapExpand) return;
        const boardEl = cardsEl.querySelector('#tasks-board-view');
        if (!boardEl) return;

        const columns = Array.from(boardEl.querySelectorAll('.tasks-column'));

        const computeForColumn = (col) => {
          if (!col || col.classList.contains('is-collapsed')) return;
          const cardsContainer = col.querySelector('.tasks-column-cards');
          const header = col.querySelector('.tasks-column-header');
          if (!cardsContainer || !header) return;

          // Measure the "single column" width (default CSS width) so we can expand
          // the column horizontally without relying on CSS calc multiplication support.
          col.style.width = '';
          col.style.minWidth = '';
          const baseWidth = col.getBoundingClientRect().width;

          const cards = Array.from(cardsContainer.querySelectorAll('.task-card-board'));
          const cardCount = cards.length;
          if (cardCount === 0) {
            col.style.setProperty('--tasks-card-columns', '1');
            col.style.setProperty('--tasks-card-rows', '1');
            return;
          }

          const containerHeight = cardsContainer.clientHeight;
          if (!containerHeight || containerHeight < 40) return;

          const styles = window.getComputedStyle(cardsContainer);
          const rowGap = Number.parseFloat(styles.rowGap || styles.gap || '0') || 0;
          const columnGap = Number.parseFloat(styles.columnGap || styles.gap || '0') || 0;
          const padLeft = Number.parseFloat(styles.paddingLeft || '0') || 0;
          const padRight = Number.parseFloat(styles.paddingRight || '0') || 0;
          const sample = cards.slice(0, Math.min(6, cardCount));
          const heights = sample.map(el => el.getBoundingClientRect().height).filter(Boolean);
          const avg = heights.length ? (heights.reduce((a, b) => a + b, 0) / heights.length) : 80;
          const denom = Math.max(1, avg + rowGap);
          let rowsFit = Math.max(1, Math.floor((containerHeight + rowGap) / denom));
          // In wrap+expand mode, prefer minimizing the number of columns by filling vertically first
          // (as long as we still avoid vertical scrolling).
          rowsFit = Math.min(rowsFit, cardCount);

          const apply = (rows) => {
            const r = Math.max(1, Number(rows) || 1);
            const cols = Math.max(1, Math.ceil(cardCount / r));
            col.style.setProperty('--tasks-card-rows', String(r));
            col.style.setProperty('--tasks-card-columns', String(cols));

            if (cols <= 1) {
              col.style.width = '';
              col.style.minWidth = '';
            } else {
              // Match CSS `minmax(180px, 1fr)` for card columns; expand only as much as needed.
              const minCardWidth = 180;
              const cardsWidth = (cols * minCardWidth) + Math.max(0, cols - 1) * columnGap;
              const target = Math.max(baseWidth, cardsWidth + padLeft + padRight);
              col.style.width = `${Math.round(target)}px`;
              col.style.minWidth = `${Math.round(target)}px`;
            }
          };

          apply(rowsFit);

          // If we still overflow vertically, reduce rows (creating more columns) until we fit.
          for (let attempt = 0; attempt < 24; attempt++) {
            // Force reflow and then check overflow.
            void cardsContainer.offsetHeight;
            if (cardsContainer.scrollHeight <= cardsContainer.clientHeight + 1) break;
            rowsFit = Math.max(1, rowsFit - 1);
            apply(rowsFit);
          }
        };

        // Clear variables for collapsed columns to avoid stale widths.
        for (const col of columns) {
          if (col.classList.contains('is-collapsed')) {
            col.style.removeProperty('--tasks-card-columns');
            col.style.removeProperty('--tasks-card-rows');
            col.style.width = '';
            col.style.minWidth = '';
          }
        }

        // Compute after layout has settled.
	        window.requestAnimationFrame(() => {
	          columns.forEach(computeForColumn);
	        });
	      };

	      // Keep board view left-aligned on open/refresh (avoid landing scrolled to the far right).
	      try {
	        const boardView = cardsEl.querySelector('#tasks-board-view');
	        if (boardView) {
            const noHorizontalOverflow = (boardView.scrollWidth || 0) <= (boardView.clientWidth || 0) + 2;
            if (boardScrollResetNextRender || !state.selectedCardId || noHorizontalOverflow) {
              boardView.scrollLeft = 0;
              boardScrollResetNextRender = false;
            }
          }
	      } catch {
	        // ignore
	      }

	      // Fizzy-like collapsible columns (lightweight):
	      // - Persist per-board expanded column on narrow screens.
	      // - Allow collapsing/expanding columns by clicking the header.
	      const storageKey = `tasks-board-expanded:${state.provider}:${state.boardId}`;
      const collapsedKey = `tasks-board-collapsed:${state.provider}:${state.boardId}`;
      const boardKey = `${state.provider}:${state.boardId}`;
      const isNarrow = () => window.matchMedia('(max-width: 980px)').matches;

      const loadCollapsedSet = () => {
        const fromServer = this.userSettings?.global?.ui?.tasks?.kanban?.collapsedByBoard?.[boardKey];
        if (Array.isArray(fromServer)) return new Set(fromServer.filter(Boolean));
        try {
          const raw = localStorage.getItem(collapsedKey);
          const arr = raw ? JSON.parse(raw) : [];
          if (!Array.isArray(arr)) return new Set();
          return new Set(arr.filter(Boolean));
        } catch {
          return new Set();
        }
      };

      const saveCollapsedSet = (set) => {
        try {
          localStorage.setItem(collapsedKey, JSON.stringify(Array.from(set)));
        } catch {
          // ignore
        }

        // Also persist to server-side user settings so state survives across ports/origins.
        try {
          const current = this.userSettings?.global?.ui?.tasks?.kanban?.collapsedByBoard || {};
          const next = { ...(current || {}) };
          next[boardKey] = Array.from(set);
          this.updateGlobalUserSetting('ui.tasks.kanban.collapsedByBoard', next);
        } catch {
          // ignore
        }
      };

      const collapseAllExcept = (keepId) => {
        cardsEl.querySelectorAll('.tasks-column').forEach(col => {
          const id = col.dataset.listId;
          const shouldKeep = keepId && id === keepId;
          const header = col.querySelector('[data-col-toggle]');
          col.classList.toggle('is-collapsed', !shouldKeep);
          col.classList.toggle('is-expanded', shouldKeep);
          header?.setAttribute('aria-expanded', shouldKeep ? 'true' : 'false');
        });
      };

      const applyDefaultExpanded = () => {
        if (!isNarrow()) {
          // Desktop: restore collapsed columns (persisted).
          const collapsed = loadCollapsedSet();
          cardsEl.querySelectorAll('.tasks-column').forEach(col => {
            const header = col.querySelector('[data-col-toggle]');
            const id = col.dataset.listId;
            const isCollapsed = id && collapsed.has(id);
            col.classList.toggle('is-collapsed', !!isCollapsed);
            col.classList.toggle('is-expanded', !isCollapsed);
            header?.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
          });
          return;
        }

        const savedFromServer = this.userSettings?.global?.ui?.tasks?.kanban?.expandedByBoard?.[boardKey];
        const saved = savedFromServer || localStorage.getItem(storageKey);
        const first = cardsEl.querySelector('.tasks-column')?.dataset?.listId || null;
        const toExpand = saved || first;
        collapseAllExcept(toExpand);
        if (toExpand) {
          const col = cardsEl.querySelector(`.tasks-column[data-list-id="${CSS.escape(toExpand)}"]`);
          col?.scrollIntoView?.({ behavior: 'smooth', inline: 'start' });
        }
      };

      cardsEl.querySelectorAll('[data-col-toggle]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const listId = btn.getAttribute('data-col-toggle');
          const col = listId ? cardsEl.querySelector(`.tasks-column[data-list-id="${CSS.escape(listId)}"]`) : null;
          if (!col || !listId) return;

          const collapsed = col.classList.contains('is-collapsed');

          if (isNarrow()) {
            // Narrow: behave like Fizzy (one expanded at a time).
            collapseAllExcept(listId);
            localStorage.setItem(storageKey, listId);
            try {
              const current = this.userSettings?.global?.ui?.tasks?.kanban?.expandedByBoard || {};
              const next = { ...(current || {}) };
              next[boardKey] = listId;
              this.updateGlobalUserSetting('ui.tasks.kanban.expandedByBoard', next);
            } catch {
              // ignore
            }
            col.scrollIntoView?.({ behavior: 'smooth', inline: 'start' });
            return;
          }

          // Desktop: toggle collapsed/expanded for this column only.
          col.classList.toggle('is-collapsed', !collapsed);
          col.classList.toggle('is-expanded', collapsed);
          btn.setAttribute('aria-expanded', collapsed ? 'true' : 'false');

          const set = loadCollapsedSet();
          if (collapsed) {
            set.delete(listId);
          } else {
            set.add(listId);
          }
          saveCollapsedSet(set);
          applyWrapExpandColumns();
        });
      });

      applyDefaultExpanded();
      applyWrapExpandColumns();

      if (isWrapExpand) {
        clearTimeout(this.tasksWrapExpandResizeDebounce);
        const onResize = () => {
          clearTimeout(this.tasksWrapExpandResizeDebounce);
          this.tasksWrapExpandResizeDebounce = setTimeout(() => applyWrapExpandColumns(), 120);
        };
        window.removeEventListener('resize', this.tasksWrapExpandResizeHandler);
        this.tasksWrapExpandResizeHandler = onResize;
        window.addEventListener('resize', this.tasksWrapExpandResizeHandler);
      }
    };

	    const applyView = () => {
	      const isAllBoards = state.boardId === ALL_BOARDS_ID;
	      const isCombined = state.boardId === COMBINED_VIEW_ID;
	      const isBoard = state.view === 'board' && !isAllBoards;
      if (isAllBoards && state.view === 'board') {
        state.view = 'list';
        try { localStorage.setItem('tasks-view', state.view); } catch {}
      }
	      if (listEl) listEl.style.display = (isBoard || isAllBoards || isCombined) ? 'none' : '';
	      if (combinedPresetEl) combinedPresetEl.style.display = isCombined ? '' : 'none';
	      if (bodyEl) bodyEl.classList.toggle('tasks-body-board', isBoard);
	      if (bodyEl) bodyEl.classList.toggle('tasks-has-detail', isBoard && !!state.selectedCardId);
	      viewListBtn?.classList.toggle('active', !isBoard);
	      viewBoardBtn?.classList.toggle('active', isBoard);
      if (viewBoardBtn) viewBoardBtn.disabled = isAllBoards;
      if (boardSettingsBtn) boardSettingsBtn.disabled = isAllBoards || isCombined;
      if (boardOpenLinkBtn) boardOpenLinkBtn.disabled = !state.boardId || isAllBoards || isCombined;
      if (newCardBtn) newCardBtn.disabled = !state.boardId || isAllBoards || isCombined;
    };

    const openSelectedBoardInBrowser = () => {
      const bid = String(state.boardId || '').trim();
      if (!bid || bid === ALL_BOARDS_ID || bid === COMBINED_VIEW_ID) {
        this.showToast('Select a single board first', 'warning');
        return;
      }
      const board = (Array.isArray(state.boards) ? state.boards : []).find((b) => String(b?.id || '').trim() === bid) || null;
      const url = String(board?.url || board?.link || '').trim();
      if (!url) {
        this.showToast('Board URL unavailable for this provider', 'warning');
        return;
      }
      try {
        new URL(url);
      } catch {
        this.showToast('Invalid board URL', 'error');
        return;
      }
      window.open(url, '_blank');
    };

    const syncBoardLayoutUI = () => {
      const layoutEl = modal.querySelector('#tasks-layout');
      const isBoard = state.view === 'board' && state.boardId !== ALL_BOARDS_ID;
      if (!layoutEl) return;
      layoutEl.style.display = isBoard ? '' : 'none';
      const radio = layoutEl.querySelector(`input[name="tasks-layout"][value="${CSS.escape(state.boardLayout)}"]`);
      if (radio) radio.checked = true;
    };

    const renderAssigneeFilter = () => {
      const details = modal.querySelector('#tasks-assignees-filter');
      const list = modal.querySelector('#tasks-assignees-list');
      if (!details || !list) return;
      const isConfigured = !!state.boardId && state.boardId !== ALL_BOARDS_ID && state.boardId !== COMBINED_VIEW_ID;
      details.style.display = isConfigured ? '' : 'none';

      const members = Array.isArray(state.boardMembers) ? state.boardMembers : [];
      const selected = new Set((Array.isArray(state.assigneeFilterIds) ? state.assigneeFilterIds : []).filter(Boolean));

      list.innerHTML = members.length === 0
        ? `<div class="tasks-detail-empty">No members.</div>`
        : members
          .map((m) => {
            const id = m?.id || '';
            const label = (m?.fullName || m?.username || id || '').toString();
            if (!id) return '';
            return `
              <label class="tasks-filter-item">
                <input type="checkbox" data-assignee-id="${escapeHtml(id)}" ${state.assigneeFilterMode !== 'any' && selected.has(id) ? 'checked' : ''} />
                <span>${escapeHtml(label)}</span>
              </label>
            `;
          })
          .join('');
    };

	    const refreshAll = async ({ force = false } = {}) => {
	      cardsEl.innerHTML = `<div class="loading">Loading…</div>`;
	      renderDetail(null);

      try {
        const providersData = await fetchProviders();
        const providers = providersData.providers || [];
        providerEl.innerHTML = '';
        for (const p of providers) {
          const opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = `${p.label}${p.configured ? '' : ' (not configured)'}`;
          providerEl.appendChild(opt);
        }
        providerEl.value = state.provider;

        const selected = providers.find(p => p.id === state.provider);
        if (!selected || !selected.configured) {
          showConfigHint(selected?.label || 'Provider');
          return;
        }

	        const boards = await fetchBoards({ refresh: force });
	        state.boards = boards || [];

	        const boardsWithLabels = (state.boards || []).map((b) => {
	          const enabled = isBoardEnabled(state.provider, b?.id);
	          const m = getBoardMapping(state.provider, b?.id);
	          const hasMap = !!(m && (m.localPath || m.repoSlug));
	          const suffix = enabled ? (hasMap ? ' (mapped)' : '') : ' (disabled)';
	          return { ...b, __selectLabel: `${b?.name || b?.id || ''}${suffix}` };
	        });

	        const includeDisabled = !!state.showDisabledBoards;
	        const filteredBoards = boardsWithLabels.filter((b) => {
	          if (!b?.id) return false;
	          if (b.id === state.boardId) return true;
	          const enabled = isBoardEnabled(state.provider, b.id);
	          return enabled || includeDisabled;
	        });

	        const withAllBoards = [
	          { id: COMBINED_VIEW_ID, name: 'Combined view', __selectLabel: 'Combined view' },
	          { id: ALL_BOARDS_ID, name: 'All enabled boards', __selectLabel: 'All enabled boards' },
	          ...filteredBoards
	        ];

		        setSelectOptions(boardEl, withAllBoards, { placeholder: 'Select board...', valueKey: 'id', labelKey: '__selectLabel' });
			        if (state.boardId) boardEl.value = state.boardId;
		          syncBoardAccent();
		          renderBoardPicker();
		          syncLaunchDefaultsUi({ mappingTier: getMappingTierForBoard(state.boardId) });
		          renderCombinedPresetSelect();

	        // Fetch "me" (best-effort) so we can default the assignee filter.
	        try {
	          state.me = await fetchMe({ refresh: false });
	        } catch (e) {
          state.me = null;
        }

        if (state.view === 'list') {
          const isAllBoards = state.boardId === ALL_BOARDS_ID;
          const isCombined = state.boardId === COMBINED_VIEW_ID;
          if (isAllBoards || isCombined) {
            state.listId = '__all__';
            try { localStorage.setItem('tasks-list', state.listId); } catch {}
          }
          if (isCombined) {
            state.boardMembers = [];
            state.lists = [];
            state.boardLabels = [];
            state.boardCustomFields = [];
            state.assigneeFilterMode = 'any';
            state.assigneeFilterIds = [];
            renderAssigneeFilter();

            const snapshot = await fetchCombinedSnapshot({ refresh: force });
            lastSnapshot = snapshot;
            const cols = Array.isArray(snapshot?.columns) ? snapshot.columns : [];
            const cards = cols.flatMap((c) => Array.isArray(c?.cards) ? c.cards : []);
            renderCards(cards);
            return;
          }
          const [lists, members, labels] = await Promise.all([
            isAllBoards ? Promise.resolve([]) : fetchLists({ refresh: force }),
            isAllBoards ? Promise.resolve([]) : fetchBoardMembers({ refresh: force }).catch((e) => {
              console.warn('Failed to load board members:', e?.message || e);
              return [];
            })
            ,
            isAllBoards ? Promise.resolve([]) : fetchBoardLabels({ refresh: force }).catch((e) => {
              console.warn('Failed to load board labels:', e?.message || e);
              return [];
            })
          ]);
          state.lists = lists || [];
          state.boardMembers = members || [];
          state.boardLabels = labels || [];
          state.boardCustomFields = [];
          if (isAllBoards) {
            state.assigneeFilterMode = 'any';
            state.assigneeFilterIds = [];
            renderAssigneeFilter();
          } else {
            // Restore/default assignee filter for this board.
            const assignee = readAssigneeFilter();
            state.assigneeFilterMode = assignee.mode;
            state.assigneeFilterIds = assignee.ids;
            renderAssigneeFilter();
          }

          setSelectOptions(listEl, lists, { placeholder: 'All lists', valueKey: 'id', labelKey: 'name' });
          // Insert an explicit "All lists" option at the top (better default for users who think in boards).
          const allOpt = document.createElement('option');
          allOpt.value = '__all__';
          allOpt.textContent = 'All lists';
          listEl.insertBefore(allOpt, listEl.firstChild);

          if (state.listId) {
            listEl.value = state.listId;
          } else if (state.boardId) {
            state.listId = '__all__';
            localStorage.setItem('tasks-list', state.listId);
            listEl.value = state.listId;
          }

          const cards = await fetchCards({ refresh: force });
          renderCards(cards);
        } else {
          const isCombined = state.boardId === COMBINED_VIEW_ID;
          if (isCombined) {
            state.boardMembers = [];
            state.lists = [];
            state.boardCustomFields = [];
            state.boardLabels = [];
            state.assigneeFilterMode = 'any';
            state.assigneeFilterIds = [];
            renderAssigneeFilter();

            const snapshot = await fetchCombinedSnapshot({ refresh: force });
            lastSnapshot = snapshot;
            renderCombinedBoard(snapshot);
            return;
          }

          const [snapshot, members, customFields, labels] = await Promise.all([
            fetchSnapshot({ refresh: force }),
            fetchBoardMembers({ refresh: force }).catch((e) => {
              console.warn('Failed to load board members:', e?.message || e);
              return [];
            })
            ,
            fetchBoardCustomFields({ refresh: force }).catch((e) => {
              console.warn('Failed to load board custom fields:', e?.message || e);
              return [];
            })
            ,
            fetchBoardLabels({ refresh: force }).catch((e) => {
              console.warn('Failed to load board labels:', e?.message || e);
              return [];
            })
          ]);
          state.boardMembers = members || [];
          state.lists = snapshot?.lists || [];
          state.boardCustomFields = customFields || [];
          state.boardLabels = labels || [];
          const assignee = readAssigneeFilter();
          state.assigneeFilterMode = assignee.mode;
          state.assigneeFilterIds = assignee.ids;
          renderAssigneeFilter();
          lastSnapshot = snapshot;
          renderBoard(snapshot);
        }
      } catch (error) {
        console.error('Tasks panel refresh failed:', error);
        cardsEl.innerHTML = `<div class="no-ports">${String(error?.message || error)}</div>`;
      }
    };

    if (updatedEl) {
      const radio = updatedEl.querySelector(`input[name="tasks-updated"][value="${CSS.escape(state.updatedWindow)}"]`);
      if (radio) radio.checked = true;
    }
    if (sortEl) {
      const radio = sortEl.querySelector(`input[name="tasks-sort"][value="${CSS.escape(state.sort)}"]`);
      if (radio) radio.checked = true;
    }
    if (hideEmptyEl) hideEmptyEl.checked = !!state.hideEmptyColumns;
    state.boardLayout = readBoardLayout();
    applyView();
    syncBoardLayoutUI();
    syncLaunchDefaultsUi({ mappingTier: getMappingTierForBoard(state.boardId) });

    launchDefaultTierGroupEl?.addEventListener?.('click', (e) => {
      const btn = e.target?.closest?.('[data-launch-default-tier-btn]');
      if (!btn) return;
      e.preventDefault();
      const tier = Number(btn.getAttribute('data-launch-default-tier-btn') || 3);
      if (!(tier >= 1 && tier <= 4)) return;
      launchDefaultTierGroupEl.querySelectorAll?.('[data-launch-default-tier-btn]')?.forEach?.((b) => {
        const t = Number(b?.getAttribute?.('data-launch-default-tier-btn') || '');
        b?.classList?.toggle?.('is-selected', t === tier);
      });
      persistLaunchDefaultsFromToolbar();
      syncLaunchDefaultsUi({ mappingTier: getMappingTierForBoard(state.boardId) });
    });

    launchDefaultAgentGroupEl?.addEventListener?.('click', (e) => {
      const btn = e.target?.closest?.('[data-launch-default-agent-btn]');
      if (!btn) return;
      e.preventDefault();
      const agentId = String(btn.getAttribute('data-launch-default-agent-btn') || '').trim().toLowerCase();
      if (agentId !== 'claude' && agentId !== 'codex') return;
      launchDefaultAgentGroupEl.querySelectorAll?.('[data-launch-default-agent-btn]')?.forEach?.((b) => {
        const v = String(b?.getAttribute?.('data-launch-default-agent-btn') || '').trim().toLowerCase();
        b?.classList?.toggle?.('is-selected', v === agentId);
      });
      persistLaunchDefaultsFromToolbar();
      syncLaunchDefaultsUi({ mappingTier: getMappingTierForBoard(state.boardId) });
    });

    launchDefaultModeGroupEl?.addEventListener?.('click', (e) => {
      const btn = e.target?.closest?.('[data-launch-default-mode-btn]');
      if (!btn) return;
      e.preventDefault();
      const mode = String(btn.getAttribute('data-launch-default-mode-btn') || '').trim().toLowerCase();
      if (mode !== 'fresh' && mode !== 'continue' && mode !== 'resume') return;
      launchDefaultModeGroupEl.querySelectorAll?.('[data-launch-default-mode-btn]')?.forEach?.((b) => {
        const v = String(b?.getAttribute?.('data-launch-default-mode-btn') || '').trim().toLowerCase();
        b?.classList?.toggle?.('is-selected', v === mode);
      });
      persistLaunchDefaultsFromToolbar();
      syncLaunchDefaultsUi({ mappingTier: getMappingTierForBoard(state.boardId) });
    });

    [launchDefaultYoloEl, launchDefaultAutoSendEl].forEach((el) => {
      el?.addEventListener?.('change', () => {
        persistLaunchDefaultsFromToolbar();
        syncLaunchDefaultsUi({ mappingTier: getMappingTierForBoard(state.boardId) });
      });
    });

    viewListBtn?.addEventListener('click', async () => {
      state.view = 'list';
      localStorage.setItem('tasks-view', state.view);
      applyView();
      syncBoardLayoutUI();
      await refreshAll({ force: false });
    });

    viewBoardBtn?.addEventListener('click', async () => {
      state.view = 'board';
      localStorage.setItem('tasks-view', state.view);
      boardScrollResetNextRender = true;
      applyView();
      state.boardLayout = readBoardLayout();
      syncBoardLayoutUI();
      await refreshAll({ force: false });
    });

    const layoutEl = modal.querySelector('#tasks-layout');
    if (layoutEl) {
      layoutEl.addEventListener('change', (e) => {
        const value = e?.target?.value;
        if (value !== 'scroll' && value !== 'wrap' && value !== 'wrap-expand') return;
        state.boardLayout = value;
        persistBoardLayout(value);
        syncBoardLayoutUI();

        if (state.view === 'board' && lastSnapshot) {
          renderBoard(lastSnapshot);
          return;
        }
        refreshAll({ force: false });
      });
    }

    const assigneesDetails = modal.querySelector('#tasks-assignees-filter');
    if (assigneesDetails) {
      assigneesDetails.addEventListener('toggle', () => {
        if (!assigneesDetails.open) return;
        // Keep the list in sync each time it opens.
        renderAssigneeFilter();
      });
    }

    const assigneesMeBtn = modal.querySelector('#tasks-assignees-me');
    assigneesMeBtn?.addEventListener('click', () => {
      const meId = resolveMeId();
      state.assigneeFilterIds = meId ? [meId] : [];
      state.assigneeFilterMode = 'selected';
      persistAssigneeFilter({ mode: 'selected', ids: state.assigneeFilterIds });
      renderAssigneeFilter();
      if (state.view === 'board' && lastSnapshot) {
        renderBoard(lastSnapshot);
        return;
      }
      refreshAll({ force: false });
    });

    const assigneesAnyBtn = modal.querySelector('#tasks-assignees-any');
    assigneesAnyBtn?.addEventListener('click', () => {
      state.assigneeFilterIds = [];
      state.assigneeFilterMode = 'any';
      persistAssigneeFilter({ mode: 'any', ids: [] });
      renderAssigneeFilter();
      if (state.view === 'board' && lastSnapshot) {
        renderBoard(lastSnapshot);
        return;
      }
      refreshAll({ force: false });
    });

	    const assigneesList = modal.querySelector('#tasks-assignees-list');
	    assigneesList?.addEventListener('change', (e) => {
      const checkbox = e.target?.closest?.('input[type="checkbox"][data-assignee-id]');
      if (!checkbox) return;
      const id = checkbox.getAttribute('data-assignee-id');
      if (!id) return;
      const set = new Set((Array.isArray(state.assigneeFilterIds) ? state.assigneeFilterIds : []).filter(Boolean));
      if (checkbox.checked) set.add(id);
      else set.delete(id);
      state.assigneeFilterIds = Array.from(set);
      state.assigneeFilterMode = 'selected';
      persistAssigneeFilter({ mode: 'selected', ids: state.assigneeFilterIds });
      if (state.view === 'board' && lastSnapshot) {
        renderBoard(lastSnapshot);
        return;
      }
      refreshAll({ force: false });
    });

	    providerEl.addEventListener('change', async () => {
	      state.provider = providerEl.value || 'trello';
	      localStorage.setItem('tasks-provider', state.provider);
	      state.boardId = '';
	      state.listId = '';
	      localStorage.removeItem('tasks-board');
	      localStorage.removeItem('tasks-list');
	      await refreshAll({ force: true });
	    });

	    combinedPresetEl?.addEventListener('change', async () => {
	      const presetId = String(combinedPresetEl.value || '').trim();
	      if (state.boardId !== COMBINED_VIEW_ID) return;
	      if (!presetId) {
	        await updateCombinedConfig({ activePresetId: '' });
	        renderCombinedPresetSelect();
	        return;
	      }
	      const presets = getCombinedPresets();
	      const preset = presets.find((p) => p.id === presetId) || null;
	      if (!preset) return;
	      await updateCombinedSelections(preset.selections, { activePresetId: preset.id });
	      renderCombinedPresetSelect();
	      await refreshAll({ force: false });
	    });

			    boardSettingsBtn?.addEventListener('click', (e) => {
			      e.preventDefault();
			      renderBoardSettings();
			    });

			    boardOpenLinkBtn?.addEventListener('click', (e) => {
			      e.preventDefault();
			      openSelectedBoardInBrowser();
			    });

			    boardConventionsBtn?.addEventListener('click', (e) => {
			      e.preventDefault();
			      const bid = String(state.boardId || '').trim();
			      if (!bid || bid === ALL_BOARDS_ID || bid === COMBINED_VIEW_ID) {
			        this.showToast('Select a single board first', 'error');
			        return;
			      }
			      renderBoardConventions({ boardId: bid }).catch(() => {});
			    });

        combinedSettingsBtn?.addEventListener('click', (e) => {
          e.preventDefault();
          renderCombinedSettings().catch((err) => {
            console.error('Failed to open combined settings:', err);
            this.showToast(String(err?.message || err), 'error');
          });
        });

      hotkeysBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openHotkeysOverlay();
      });

      boardBtnEl?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isBoardMenuOpen()) closeBoardMenu();
        else openBoardMenu({ focusSearch: true });
      });

      boardMenuEl?.addEventListener('click', (e) => {
        const btn = e.target?.closest?.('[data-board-menu-value]');
        if (!btn || !boardEl) return;
        const value = String(btn.getAttribute('data-board-menu-value') || '').trim();
        if (!value) return;
        if (boardEl.value !== value) {
          boardEl.value = value;
          boardEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
        closeBoardMenu();
      });

      boardMenuEl?.addEventListener?.('mouseover', (e) => {
        const btn = e.target?.closest?.('[data-board-menu-value]');
        if (!btn) return;
        const value = String(btn.getAttribute('data-board-menu-value') || '').trim();
        if (!value) return;
        boardMenuActiveValue = value;
        boardMenuEl.querySelectorAll('[data-board-menu-value]').forEach((b) => {
          b.classList.toggle('is-active', String(b.getAttribute('data-board-menu-value') || '') === boardMenuActiveValue);
        });
      });

      modal.addEventListener('click', (e) => {
        if (!isBoardMenuOpen()) return;
        const picker = modal.querySelector('#tasks-board-picker');
        if (picker && picker.contains(e.target)) return;
        closeBoardMenu();
      });

	    boardEl.addEventListener('change', async () => {
	      state.boardId = boardEl.value || '';
	      localStorage.setItem('tasks-board', state.boardId);
      boardScrollResetNextRender = true;
      if (state.boardId === COMBINED_VIEW_ID) {
        state.listId = '';
        try { localStorage.removeItem('tasks-list'); } catch {}
        state.view = 'board';
        try { localStorage.setItem('tasks-view', state.view); } catch {}
      } else {
        state.listId = '__all__';
        localStorage.setItem('tasks-list', state.listId);
      }
      state.boardLayout = readBoardLayout();
      syncBoardLayoutUI();
	      syncBoardAccent();
        renderBoardPicker();
	      syncLaunchDefaultsUi({ mappingTier: getMappingTierForBoard(state.boardId) });
	      if (state.boardId === ALL_BOARDS_ID) {
	        state.view = 'list';
	        localStorage.setItem('tasks-view', state.view);
	      }
        applyView();
        syncBoardLayoutUI();
	      await refreshAll({ force: true });
	    });

    listEl.addEventListener('change', async () => {
      state.listId = listEl.value || '';
      localStorage.setItem('tasks-list', state.listId);
      await refreshAll({ force: true });
    });

    if (searchEl) {
      let t = null;
      searchEl.addEventListener('input', () => {
        state.query = (searchEl.value || '').trim();
        if (t) clearTimeout(t);
        t = setTimeout(() => refreshAll({ force: false }), 200);
      });
    }

    if (updatedEl) {
      updatedEl.addEventListener('change', (e) => {
        const value = e?.target?.value;
        state.updatedWindow = value || 'any';
        localStorage.setItem('tasks-updated-window', state.updatedWindow);
        refreshAll({ force: false });
      });
    }

    if (sortEl) {
      sortEl.addEventListener('change', (e) => {
        const value = e?.target?.value;
        state.sort = value || 'pos';
        localStorage.setItem('tasks-sort', state.sort);
        refreshAll({ force: false });
      });
    }

    if (hideEmptyEl) {
      hideEmptyEl.addEventListener('change', () => {
        state.hideEmptyColumns = !!hideEmptyEl.checked;
        localStorage.setItem('tasks-hide-empty', state.hideEmptyColumns ? 'true' : 'false');
        refreshAll({ force: false });
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => refreshAll({ force: true }));
    }

    if (newCardBtn) {
      newCardBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openNewCardOverlay().catch((err) => {
          console.error('Failed to open new task overlay:', err);
          this.showToast(String(err?.message || err), 'error');
        });
      });
    }

	    cardsEl.addEventListener('click', async (e) => {
        const resolveRowBoardId = (row) => {
          if (!row) return String(state.boardId || '').trim();
          if (state.boardId === ALL_BOARDS_ID || state.boardId === COMBINED_VIEW_ID) return String(row.dataset?.boardId || '').trim();
          return String(state.boardId || '').trim();
        };

	      const quickSetupBtn = e.target.closest('[data-quick-launch-setup]');
	      if (quickSetupBtn) {
	        e.preventDefault();
	        e.stopPropagation();
          const row = quickSetupBtn.closest('.task-card-row');
          const boardId = resolveRowBoardId(row);
	        renderBoardSettings({ boardId });
	        return;
	      }

        const quickOptionsBtn = e.target.closest('[data-quick-launch-options-btn]');
        if (quickOptionsBtn) {
          e.preventDefault();
          e.stopPropagation();
          const row = quickOptionsBtn.closest('.task-card-row');
          const cardId = String(row?.dataset?.cardId || '').trim();
          if (!cardId) return;
          const boardId = resolveRowBoardId(row);
          if (!boardId) return;
          openLaunchPopover({ anchorEl: quickOptionsBtn, cardId, boardId });
          return;
        }

        const quickTierBtn = e.target.closest('[data-quick-launch-tier-btn]');
        if (quickTierBtn) {
          e.preventDefault();
          e.stopPropagation();
          const row = quickTierBtn.closest('.task-card-row');
          const cardId = row?.dataset?.cardId;
          if (!cardId) return;
          const boardId = resolveRowBoardId(row);
          if (!boardId) return;

          const tier = Number(quickTierBtn.getAttribute('data-quick-launch-tier-btn') || 3);
          if (!(tier >= 1 && tier <= 4)) return;

          try {
            quickTierBtn.disabled = true;
            // Visually select the tier for this card.
            try {
              row?.querySelectorAll?.('[data-quick-launch-tier-btn]')?.forEach?.((btn) => {
                const t = Number(btn?.getAttribute?.('data-quick-launch-tier-btn') || '');
                btn?.classList?.toggle?.('is-selected', t === tier);
              });
            } catch {
              // ignore
            }

            const defaults = readLaunchDefaults();
            writeLaunchDefaults({ tier });
            syncLaunchDefaultsUi({ mappingTier: getMappingTierForBoard(boardId) });

            const card = await fetchCardDetail(cardId);
            const promptText = String(card?.desc ?? '');

            await this.launchAgentFromTaskCard({
              provider: state.provider,
              boardId,
              card,
              tier,
              agentId: defaults.agentId || 'claude',
              mode: defaults.mode || 'fresh',
              yolo: defaults.yolo !== false,
              autoSendPrompt: defaults.autoSendPrompt !== false,
              promptText
            });
          } catch (err) {
            console.error('Quick tier launch failed:', err);
            this.showToast(String(err?.message || err), 'error');
          } finally {
            quickTierBtn.disabled = false;
          }
          return;
        }

	      const quickLaunchBtn = e.target.closest('[data-quick-launch-btn]');
	      if (quickLaunchBtn) {
	        e.preventDefault();
	        e.stopPropagation();
	        const row = quickLaunchBtn.closest('.task-card-row');
	        const cardId = row?.dataset?.cardId;
	        if (!cardId) return;
          const boardId = resolveRowBoardId(row);
          if (!boardId) return;

	        try {
	          quickLaunchBtn.disabled = true;
            const defaultsNow = readLaunchDefaults();
	          const fallbackTier = Number(defaultsNow?.tier || 3);
	          const defaults = readLaunchDefaults();
            syncLaunchDefaultsUi({ mappingTier: getMappingTierForBoard(boardId) });

	          const card = await fetchCardDetail(cardId);
            const effectiveBoardId = String(card?.idBoard || boardId || '').trim();
            const tierHint = getTierHintFromLabels(state.provider, effectiveBoardId, card?.labels);
            const tier = (tierHint >= 1 && tierHint <= 4) ? tierHint : fallbackTier;
	          const promptText = String(card?.desc ?? '');

	          await this.launchAgentFromTaskCard({
	            provider: state.provider,
	            boardId,
	            card,
	            tier,
	            agentId: defaults.agentId || 'claude',
	            mode: defaults.mode || 'fresh',
	            yolo: defaults.yolo !== false,
	            autoSendPrompt: defaults.autoSendPrompt !== false,
	            promptText
	          });
	        } catch (err) {
	          console.error('Quick launch failed:', err);
	          this.showToast(String(err?.message || err), 'error');
	        } finally {
	          quickLaunchBtn.disabled = false;
	        }
	        return;
	      }

        if (e.target.closest('[data-quick-launch-tier-btn]')) {
          e.stopPropagation();
          return;
        }

	      const row = e.target.closest('.task-card-row');
	      if (!row) return;
	      const cardId = row.dataset.cardId;
	      if (!cardId) return;

      cardsEl.querySelectorAll('.task-card-row.active').forEach(el => el.classList.remove('active'));
      row.classList.add('active');

      detailEl.innerHTML = `<div class="loading">Loading card…</div>`;
      try {
        const isAllBoards = state.boardId === ALL_BOARDS_ID || state.boardId === COMBINED_VIEW_ID;

        let cardPromise = fetchCardDetail(cardId);
        let needsCustomFields = !!state.boardId && (!Array.isArray(state.boardCustomFields) || state.boardCustomFields.length === 0);
        let needsLabels = !!state.boardId && (!Array.isArray(state.boardLabels) || state.boardLabels.length === 0);

        if (isAllBoards) {
          const card = await fetchCardDetail(cardId);
          cardPromise = Promise.resolve(card);
          const boardId = String(card?.idBoard || '').trim();
          if (boardId) {
            const meta = await loadBoardMeta({ boardId, refresh: false });
            state.lists = meta.lists || [];
            state.boardMembers = meta.members || [];
            state.boardLabels = meta.labels || [];
            state.boardCustomFields = meta.customFields || [];
          }
          needsCustomFields = false;
          needsLabels = false;
        }

        const customFieldsPromise = needsCustomFields
          ? fetchBoardCustomFields({ refresh: false }).catch((err) => {
            console.warn('Failed to load board custom fields:', err?.message || err);
            return [];
          })
          : Promise.resolve(state.boardCustomFields);

	        const labelsPromise = needsLabels
	          ? fetchBoardLabels({ refresh: false }).catch((err) => {
	            console.warn('Failed to load board labels:', err?.message || err);
	            return [];
	          })
	          : Promise.resolve(state.boardLabels);

		        const card = await cardPromise;

	        Promise.all([customFieldsPromise, labelsPromise]).then(([customFields, labels]) => {
	          if (needsCustomFields) state.boardCustomFields = customFields || [];
	          if (needsLabels) state.boardLabels = labels || [];
	          if (state.selectedCardId === cardId) setDetail(card);
	        }).catch(() => {});

		        const setDetail = (c) => {
		          renderDetail(c);

	          const saveBtn = detailEl.querySelector('#tasks-card-save');
	          const moveBtn = detailEl.querySelector('#tasks-card-move-btn');
	          const commentBtn = detailEl.querySelector('#tasks-card-comment-btn');
	          const dueSaveBtn = detailEl.querySelector('#tasks-card-due-save');
	          const dueClearBtn = detailEl.querySelector('#tasks-card-due-clear');
          const assignBtn = detailEl.querySelector('#tasks-assign-member-btn');
          const launchBtn = detailEl.querySelector('#tasks-launch-btn');
          const openBoardSettingsBtn = detailEl.querySelector('#tasks-launch-open-board-settings');
          const promptSaveBtn = detailEl.querySelector('#tasks-prompt-save');
	          const promptOpenBtn = detailEl.querySelector('#tasks-prompt-open');
	          const launchTierEl = detailEl.querySelector('#tasks-launch-tier');
	          const launchAgentEl = detailEl.querySelector('#tasks-launch-agent');
	          const launchModeEl = detailEl.querySelector('#tasks-launch-mode');
	          const launchYoloEl = detailEl.querySelector('#tasks-launch-yolo');
	          const launchAutoSendEl = detailEl.querySelector('#tasks-launch-auto-send');

          saveBtn?.addEventListener('click', async () => {
            const titleEl = detailEl.querySelector('#tasks-card-title');
            const descEl = detailEl.querySelector('#tasks-card-desc');
            const name = (titleEl?.value || '').trim();
            const desc = descEl?.value ?? '';
            if (!state.selectedCardId) return;
            try {
              saveBtn.disabled = true;
              const updated = await updateCard({ cardId: state.selectedCardId, fields: { name, desc } });
              if (updated) setDetail(updated);
              this.showToast('Saved', 'success');
            } catch (err) {
              console.error('Save card failed:', err);
              this.showToast(String(err?.message || err), 'error');
            } finally {
              saveBtn.disabled = false;
            }
          });

          moveBtn?.addEventListener('click', async () => {
            const sel = detailEl.querySelector('#tasks-card-move');
            const listId = sel?.value;
            if (!state.selectedCardId || !listId) return;
            try {
              moveBtn.disabled = true;
              const updated = await updateCard({ cardId: state.selectedCardId, fields: { idList: listId, pos: 'top' } });
              if (updated) setDetail(updated);
              await refreshAll({ force: true });
              this.showToast('Moved', 'success');
            } catch (err) {
              console.error('Move card failed:', err);
              this.showToast(String(err?.message || err), 'error');
            } finally {
              moveBtn.disabled = false;
            }
          });

          commentBtn?.addEventListener('click', async () => {
            const textarea = detailEl.querySelector('#tasks-card-comment');
            const text = (textarea?.value || '').trim();
            if (!state.selectedCardId || !text) return;
            try {
              commentBtn.disabled = true;
              const updated = await addComment({ cardId: state.selectedCardId, text });
              if (textarea) textarea.value = '';
              if (updated) setDetail(updated);
              this.showToast('Comment added', 'success');
            } catch (err) {
              console.error('Add comment failed:', err);
              this.showToast(String(err?.message || err), 'error');
            } finally {
              commentBtn.disabled = false;
            }
          });

          dueSaveBtn?.addEventListener('click', async () => {
            const dueEl = detailEl.querySelector('#tasks-card-due');
            const due = fromDatetimeLocalValue(dueEl?.value || '');
            if (!state.selectedCardId) return;
            try {
              dueSaveBtn.disabled = true;
              const updated = await updateCard({ cardId: state.selectedCardId, fields: { due } });
              if (updated) setDetail(updated);
              this.showToast('Due date updated', 'success');
            } catch (err) {
              console.error('Set due failed:', err);
              this.showToast(String(err?.message || err), 'error');
            } finally {
              dueSaveBtn.disabled = false;
            }
          });

          dueClearBtn?.addEventListener('click', async () => {
            if (!state.selectedCardId) return;
            try {
              dueClearBtn.disabled = true;
              const updated = await updateCard({ cardId: state.selectedCardId, fields: { due: null } });
              if (updated) setDetail(updated);
              this.showToast('Due date cleared', 'success');
            } catch (err) {
              console.error('Clear due failed:', err);
              this.showToast(String(err?.message || err), 'error');
            } finally {
              dueClearBtn.disabled = false;
            }
          });

	          assignBtn?.addEventListener('click', async () => {
            const select = detailEl.querySelector('#tasks-assign-member');
            const memberId = select?.value;
            if (!state.selectedCardId || !memberId) return;
            const currentMembers = Array.isArray(c?.members) ? c.members : [];
            const ids = Array.from(new Set([...currentMembers.map(m => m?.id).filter(Boolean), memberId]));
            try {
              assignBtn.disabled = true;
              const updated = await updateCard({ cardId: state.selectedCardId, fields: { idMembers: ids } });
              if (updated) setDetail(updated);
              this.showToast('Member assigned', 'success');
            } catch (err) {
              console.error('Assign member failed:', err);
              this.showToast(String(err?.message || err), 'error');
            } finally {
              assignBtn.disabled = false;
            }
	          });

		          const resolveEffectiveBoardId = () => {
		            const isAll = state.boardId === ALL_BOARDS_ID || state.boardId === COMBINED_VIEW_ID;
		            const raw = isAll ? String(c?.idBoard || '').trim() : String(state.boardId || '').trim();
		            return raw && raw !== ALL_BOARDS_ID ? raw : '';
		          };

		          const resolveDependencyChecklistName = () => {
		            const boardId = resolveEffectiveBoardId();
		            return getDependencyChecklistNameForBoard(state.provider, boardId);
		          };

		          openBoardSettingsBtn?.addEventListener('click', (e) => {
		            e.preventDefault();
		            const boardId = resolveEffectiveBoardId();
		            if (!boardId) return;
		            renderBoardSettings({ boardId });
		          });

              const syncDetailLaunchQuickButtons = () => {
                const tier = String(launchTierEl?.value || '').trim();
                const agentId = String(launchAgentEl?.value || '').trim().toLowerCase();
                const mode = String(launchModeEl?.value || '').trim().toLowerCase();

                const tierGroup = detailEl.querySelector('[data-detail-launch-tier-group]');
                tierGroup?.querySelectorAll?.('[data-detail-launch-tier-btn]')?.forEach?.((b) => {
                  const v = String(b?.getAttribute?.('data-detail-launch-tier-btn') || '').trim();
                  b?.classList?.toggle?.('is-selected', !!v && v === tier);
                });

                const agentGroup = detailEl.querySelector('[data-detail-launch-agent-group]');
                agentGroup?.querySelectorAll?.('[data-detail-launch-agent-btn]')?.forEach?.((b) => {
                  const v = String(b?.getAttribute?.('data-detail-launch-agent-btn') || '').trim().toLowerCase();
                  b?.classList?.toggle?.('is-selected', !!v && v === agentId);
                });

                const modeGroup = detailEl.querySelector('[data-detail-launch-mode-group]');
                modeGroup?.querySelectorAll?.('[data-detail-launch-mode-btn]')?.forEach?.((b) => {
                  const v = String(b?.getAttribute?.('data-detail-launch-mode-btn') || '').trim().toLowerCase();
                  b?.classList?.toggle?.('is-selected', !!v && v === mode);
                });
              };

		          const persistLaunchUi = () => {
		            const boardId = resolveEffectiveBoardId();
		            writeLaunchDefaults({
		              tier: Number(launchTierEl?.value || 3),
		              agentId: String(launchAgentEl?.value || 'claude'),
		              mode: String(launchModeEl?.value || 'fresh'),
		              yolo: !!launchYoloEl?.checked,
		              autoSendPrompt: !!launchAutoSendEl?.checked
		            });
                syncLaunchDefaultsUi({ mappingTier: getMappingTierForBoard(boardId) });
		          };
		          [launchTierEl, launchAgentEl, launchModeEl, launchYoloEl, launchAutoSendEl].forEach((el) => {
		            el?.addEventListener?.('change', () => {
                  persistLaunchUi();
                  syncDetailLaunchQuickButtons();
                });
		          });

              const detailLaunchTierGroup = detailEl.querySelector('[data-detail-launch-tier-group]');
              detailLaunchTierGroup?.addEventListener?.('click', (e) => {
                const btn = e.target?.closest?.('[data-detail-launch-tier-btn]');
                if (!btn) return;
                e.preventDefault();
                const tier = String(btn.getAttribute('data-detail-launch-tier-btn') || '').trim();
                if (!tier) return;
                if (launchTierEl) launchTierEl.value = tier;
                persistLaunchUi();
                syncDetailLaunchQuickButtons();
              });

              const detailLaunchAgentGroup = detailEl.querySelector('[data-detail-launch-agent-group]');
              detailLaunchAgentGroup?.addEventListener?.('click', (e) => {
                const btn = e.target?.closest?.('[data-detail-launch-agent-btn]');
                if (!btn) return;
                e.preventDefault();
                const agentId = String(btn.getAttribute('data-detail-launch-agent-btn') || '').trim().toLowerCase();
                if (agentId !== 'claude' && agentId !== 'codex') return;
                if (launchAgentEl) launchAgentEl.value = agentId;
                persistLaunchUi();
                syncDetailLaunchQuickButtons();
              });

              const detailLaunchModeGroup = detailEl.querySelector('[data-detail-launch-mode-group]');
              detailLaunchModeGroup?.addEventListener?.('click', (e) => {
                const btn = e.target?.closest?.('[data-detail-launch-mode-btn]');
                if (!btn) return;
                e.preventDefault();
                const mode = String(btn.getAttribute('data-detail-launch-mode-btn') || '').trim().toLowerCase();
                if (mode !== 'fresh' && mode !== 'continue' && mode !== 'resume') return;
                if (launchModeEl) launchModeEl.value = mode;
                persistLaunchUi();
                syncDetailLaunchQuickButtons();
              });

              // Alt+1..4 sets tier quickly when viewing card detail (avoid typing conflicts).
              if (this.tasksDetailLaunchKeyHandler) {
                try { detailEl.removeEventListener('keydown', this.tasksDetailLaunchKeyHandler); } catch {}
              }
              this.tasksDetailLaunchKeyHandler = (e) => {
                if (!e || !e.altKey) return;
                const target = e.target;
                const tag = String(target?.tagName || '').toUpperCase();
                if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
                const n = Number(e.key);
                if (!(n >= 1 && n <= 4)) return;
                e.preventDefault();
                if (launchTierEl) launchTierEl.value = String(n);
                persistLaunchUi();
                syncDetailLaunchQuickButtons();
              };
              detailEl.addEventListener('keydown', this.tasksDetailLaunchKeyHandler);

              syncDetailLaunchQuickButtons();

		          launchBtn?.addEventListener('click', async () => {
		            if (!state.selectedCardId) return;
		            try {
		              launchBtn.disabled = true;
		              const boardId = resolveEffectiveBoardId();
		              if (!boardId) throw new Error('No board selected for this card');
		              const tier = Number(detailEl.querySelector('#tasks-launch-tier')?.value || 3);
		              const agentId = String(detailEl.querySelector('#tasks-launch-agent')?.value || 'claude');
		              const mode = String(detailEl.querySelector('#tasks-launch-mode')?.value || 'fresh');
		              const yolo = !!detailEl.querySelector('#tasks-launch-yolo')?.checked;
		              const autoSendPrompt = !!detailEl.querySelector('#tasks-launch-auto-send')?.checked;
		              const promptText = String(detailEl.querySelector('#tasks-card-desc')?.value ?? c?.desc ?? '');

		              writeLaunchDefaults({ tier, agentId, mode, yolo, autoSendPrompt });

		              await this.launchAgentFromTaskCard({
		                provider: state.provider,
		                boardId,
		                card: c,
	                tier,
	                agentId,
	                mode,
	                yolo,
	                autoSendPrompt,
	                promptText
	              });
	            } catch (err) {
	              console.error('Launch from card failed:', err);
	              this.showToast(String(err?.message || err), 'error');
	            } finally {
	              launchBtn.disabled = false;
	            }
	          });

          promptSaveBtn?.addEventListener('click', async () => {
            if (!state.selectedCardId) return;
            try {
              const pid = String(detailEl.querySelector('#tasks-prompt-id')?.value || '').trim();
              if (!pid) throw new Error('Prompt id is required');
              const desc = String(detailEl.querySelector('#tasks-card-desc')?.value ?? c?.desc ?? '');
              promptSaveBtn.disabled = true;
              const res = await fetch(`${serverUrl}/api/prompts/${encodeURIComponent(pid)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: desc })
              });
              const data = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(data?.error || 'Failed to save prompt');
              this.showToast('Prompt saved', 'success');
            } catch (err) {
              this.showToast(String(err?.message || err), 'error');
            } finally {
              promptSaveBtn.disabled = false;
            }
          });

          promptOpenBtn?.addEventListener('click', async () => {
            if (!state.selectedCardId) return;
            try {
              const pid = String(detailEl.querySelector('#tasks-prompt-id')?.value || '').trim();
              if (!pid) throw new Error('Prompt id is required');
              promptOpenBtn.disabled = true;
              await openPromptEditorForCard({ promptId: pid, provider: state.provider, cardId: state.selectedCardId });
            } catch (err) {
              this.showToast(String(err?.message || err), 'error');
            } finally {
              promptOpenBtn.disabled = false;
            }
          });

          detailEl.querySelectorAll('[data-remove-member]').forEach((btn) => {
            btn.addEventListener('click', async () => {
              const removeId = btn.getAttribute('data-remove-member');
              if (!state.selectedCardId || !removeId) return;
              const currentMembers = Array.isArray(c?.members) ? c.members : [];
              const ids = currentMembers.map(m => m?.id).filter(Boolean).filter(id => id !== removeId);
              try {
                btn.disabled = true;
                const updated = await updateCard({ cardId: state.selectedCardId, fields: { idMembers: ids } });
                if (updated) setDetail(updated);
                this.showToast('Member unassigned', 'success');
              } catch (err) {
                console.error('Unassign member failed:', err);
                this.showToast(String(err?.message || err), 'error');
              } finally {
                btn.disabled = false;
              }
            });
          });

          detailEl.querySelectorAll('[data-toggle-label]').forEach((btn) => {
            btn.addEventListener('click', async () => {
              const labelId = btn.getAttribute('data-toggle-label');
              if (!state.selectedCardId || !labelId) return;
              const current = Array.isArray(c?.labels) ? c.labels : [];
              const ids = current.map(l => l?.id).filter(Boolean);
              const next = ids.includes(labelId)
                ? ids.filter(id => id !== labelId)
                : [...ids, labelId];

              try {
                btn.disabled = true;
                const updated = await updateCard({ cardId: state.selectedCardId, fields: { idLabels: next } });
                if (updated) setDetail(updated);
                this.showToast('Labels updated', 'success');
              } catch (err) {
                console.error('Update labels failed:', err);
                this.showToast(String(err?.message || err), 'error');
              } finally {
                btn.disabled = false;
              }
            });
          });

          detailEl.querySelectorAll('.tasks-cf-input').forEach((el) => {
            const type = el.getAttribute('data-cf-type') || '';
            const customFieldId = el.getAttribute('data-cf-id') || '';
            if (!type || !customFieldId) return;

            const currentValueString = () => {
              if (type === 'checkbox') return el.checked ? 'true' : 'false';
              return String(el.value ?? '');
            };

            const buildPayload = () => {
              if (type === 'list') {
                return { idValue: String(el.value || '') };
              }
              if (type === 'checkbox') {
                return { value: { checked: el.checked ? 'true' : 'false' } };
              }
              if (type === 'date') {
                const iso = fromDatetimeLocalValue(el.value || '');
                return { value: { date: iso || '' } };
              }
              if (type === 'number') {
                return { value: { number: String(el.value || '') } };
              }
              return { value: { text: String(el.value || '') } };
            };

            const save = async () => {
              if (!state.selectedCardId) return;
              const initial = el.getAttribute('data-cf-initial') ?? '';
              const currentVal = currentValueString();
              if (currentVal === initial) return;
              try {
                el.disabled = true;
                const updated = await updateCustomField({ cardId: state.selectedCardId, customFieldId, payload: buildPayload() });
                el.setAttribute('data-cf-initial', currentVal);
                if (updated) setDetail(updated);
                this.showToast('Custom field updated', 'success');
              } catch (err) {
                console.error('Custom field update failed:', err);
                this.showToast(String(err?.message || err), 'error');
              } finally {
                el.disabled = false;
              }
            };

            const saveOnBlur = type === 'text' || type === 'number';
            if (saveOnBlur) {
              el.addEventListener('blur', save);
              el.addEventListener('keydown', (evt) => {
                if (evt.key === 'Enter') {
                  evt.preventDefault();
                  save();
                }
              });
            } else {
              el.addEventListener('change', save);
            }
          });

          const depAddBtn = detailEl.querySelector('#tasks-dep-add-btn');
          depAddBtn?.addEventListener('click', async () => {
            const input = detailEl.querySelector('#tasks-dep-input');
            const value = input?.value || '';
            if (!state.selectedCardId) return;
            try {
              depAddBtn.disabled = true;
              const checklistName = resolveDependencyChecklistName();
              const updated = await addDependency({ cardId: state.selectedCardId, value, checklistName });
              if (input) input.value = '';
              if (updated) setDetail(updated);
              this.showToast('Dependency added', 'success');
            } catch (err) {
              console.error('Add dependency failed:', err);
              this.showToast(String(err?.message || err), 'error');
            } finally {
              depAddBtn.disabled = false;
            }
          });

          detailEl.querySelectorAll('[data-remove-dep]').forEach((btn) => {
            btn.addEventListener('click', async () => {
              const itemId = btn.getAttribute('data-remove-dep');
              if (!state.selectedCardId || !itemId) return;
              try {
                btn.disabled = true;
                const checklistName = resolveDependencyChecklistName();
                const updated = await removeDependency({ cardId: state.selectedCardId, itemId, checklistName });
                if (updated) setDetail(updated);
                this.showToast('Dependency removed', 'success');
              } catch (err) {
                console.error('Remove dependency failed:', err);
                this.showToast(String(err?.message || err), 'error');
              } finally {
                btn.disabled = false;
              }
            });
          });

          detailEl.querySelectorAll('[data-dep-id]').forEach((checkbox) => {
            checkbox.addEventListener('change', async () => {
              const itemId = checkbox.getAttribute('data-dep-id');
              if (!state.selectedCardId || !itemId) return;
              const desired = checkbox.checked ? 'complete' : 'incomplete';
              try {
                checkbox.disabled = true;
                const checklistName = resolveDependencyChecklistName();
                const updated = await setDependencyState({ cardId: state.selectedCardId, itemId, state: desired, checklistName });
                if (updated) setDetail(updated);
                this.showToast('Dependency updated', 'success');
              } catch (err) {
                console.error('Toggle dependency failed:', err);
                checkbox.checked = !checkbox.checked;
                this.showToast(String(err?.message || err), 'error');
              } finally {
                checkbox.disabled = false;
              }
	            });
	          });
	        };

	        setDetail(card);
	      } catch (error) {
	        console.error('Failed to fetch card detail:', error);
	        detailEl.innerHTML = `<div class="no-ports">${String(error?.message || error)}</div>`;
	      }
	    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

	    // Allow closing the full-screen Tasks panel quickly.
	    // (Clicking outside doesn't work when the panel is full-viewport.)
	    const onTasksKeyDown = (e) => {
	      const tag = String(e?.target?.tagName || '').toLowerCase();
	      const isTypingTarget = tag === 'input' || tag === 'textarea' || tag === 'select' || e?.target?.isContentEditable;

	      const applyDefaultsUi = (boardId) => {
	        syncLaunchDefaultsUi({ mappingTier: getMappingTierForBoard(boardId) });
	      };

	      const getRows = () => Array.from(cardsEl?.querySelectorAll?.('.task-card-row') || []);

	      const getActiveRow = () => {
	        // Works for list + board views (both use .task-card-row).
	        const active = cardsEl?.querySelector?.('.task-card-row.active');
	        if (active) return active;
	        // Fallback: first visible card.
	        return cardsEl?.querySelector?.('.task-card-row');
	      };

	      const setActiveRow = (row) => {
	        if (!row || !cardsEl) return;
	        try {
	          cardsEl.querySelectorAll('.task-card-row.active').forEach(el => el.classList.remove('active'));
	          row.classList.add('active');
            const isBoardView = state.view === 'board' && state.boardId !== ALL_BOARDS_ID;
	          row.scrollIntoView?.({ block: 'nearest', inline: isBoardView ? 'start' : 'nearest' });
	        } catch {
	          // ignore
	        }
	      };

	      const resolveRowBoardId = (row) => {
	        if (!row) return String(state.boardId || '').trim();
	        if (state.boardId === ALL_BOARDS_ID || state.boardId === COMBINED_VIEW_ID) return String(row.dataset?.boardId || '').trim();
	        return String(state.boardId || '').trim();
	      };

	      const canQuickLaunchFromBoard = (boardId) => {
	        const bid = String(boardId || '').trim();
	        if (!bid || bid === ALL_BOARDS_ID) return false;
	        const mapping = getBoardMapping(state.provider, bid) || null;
	        const enabled = mapping ? (mapping.enabled !== false) : true;
	        const localPath = mapping ? String(mapping.localPath || '') : '';
	        return !!(enabled && localPath);
	      };

	      const quickLaunchWithTier = async (tier) => {
	        if (isTypingTarget) return;
	        if (!(tier >= 1 && tier <= 4)) return;
	        const row = getActiveRow();
	        const cardId = String(row?.dataset?.cardId || '').trim();
	        if (!cardId) return;
	        const boardId = resolveRowBoardId(row);
	        if (!canQuickLaunchFromBoard(boardId)) {
	          this.showToast('Set Board Settings to enable Launch', 'error');
	          return;
	        }

	        try {
	          const defaults = readLaunchDefaults();
	          writeLaunchDefaults({ tier });
	          applyDefaultsUi(boardId);
	          const card = await fetchCardDetail(cardId);
	          const promptText = String(card?.desc ?? '');
	          await this.launchAgentFromTaskCard({
	            provider: state.provider,
	            boardId,
	            card,
	            tier,
	            agentId: defaults.agentId || 'claude',
	            mode: defaults.mode || 'fresh',
	            yolo: defaults.yolo !== false,
	            autoSendPrompt: defaults.autoSendPrompt !== false,
	            promptText
	          });
	        } catch (err) {
	          console.error('Keyboard quick launch failed:', err);
	          this.showToast(String(err?.message || err), 'error');
	        }
	      };

		      if (!isTypingTarget) {
		        if (e.key === '?' || e.key === 'h' || e.key === 'H') {
		          e.preventDefault();
		          openHotkeysOverlay();
		          return;
		        }
		        if (e.key === '/' && searchEl) {
		          e.preventDefault();
		          try {
		            searchEl.focus();
	            searchEl.select?.();
	          } catch {
	            // ignore
	          }
	          return;
	        }
	        if (e.key === 'b' || e.key === 'B') {
	          e.preventDefault();
	          if (typeof openBoardMenu === 'function') {
	            openBoardMenu({ focusSearch: true });
	          } else {
	            try {
	              boardBtnEl?.click?.();
	            } catch {
	              // ignore
	            }
	          }
	          return;
	        }
	        if (e.key === 'ArrowDown') {
	          e.preventDefault();
	          const rows = getRows();
	          if (rows.length === 0) return;
	          const active = cardsEl?.querySelector?.('.task-card-row.active');
	          if (!active) {
	            setActiveRow(rows[0]);
	            return;
	          }
	          const idx = rows.indexOf(active);
	          const next = rows[Math.min(rows.length - 1, Math.max(0, idx + 1))];
	          setActiveRow(next);
	          return;
	        }
	        if (e.key === 'ArrowUp') {
	          e.preventDefault();
	          const rows = getRows();
	          if (rows.length === 0) return;
	          const active = cardsEl?.querySelector?.('.task-card-row.active');
	          if (!active) {
	            setActiveRow(rows[0]);
	            return;
	          }
	          const idx = rows.indexOf(active);
	          const prev = rows[Math.max(0, idx - 1)];
	          setActiveRow(prev);
	          return;
	        }
	        if (e.key === 'Enter') {
	          const row = getActiveRow();
	          if (!row) return;
	          e.preventDefault();
	          try {
	            row.click();
	          } catch {
	            // ignore
	          }
	          return;
	        }
	        if (e.key === 'o' || e.key === 'O') {
	          const row = getActiveRow();
	          const url = String(row?.dataset?.url || '').trim();
	          if (!url) return;
	          e.preventDefault();
	          try {
	            window.open(url, '_blank');
	          } catch {
	            // ignore
	          }
	          return;
	        }
	        if (e.key === 'c' || e.key === 'C') {
	          e.preventDefault();
	          writeLaunchDefaults({ agentId: 'claude' });
	          applyDefaultsUi(state.boardId);
	          return;
	        }
	        if (e.key === 'x' || e.key === 'X') {
	          e.preventDefault();
	          writeLaunchDefaults({ agentId: 'codex' });
	          applyDefaultsUi(state.boardId);
	          return;
	        }
	        if (e.key === 'f' || e.key === 'F') {
	          e.preventDefault();
	          writeLaunchDefaults({ mode: 'fresh' });
	          applyDefaultsUi(state.boardId);
	          return;
	        }
	        if (e.key === 'n' || e.key === 'N') {
	          e.preventDefault();
	          writeLaunchDefaults({ mode: 'continue' });
	          applyDefaultsUi(state.boardId);
	          return;
	        }
	        if (e.key === 'r' || e.key === 'R') {
	          e.preventDefault();
	          writeLaunchDefaults({ mode: 'resume' });
	          applyDefaultsUi(state.boardId);
	          return;
	        }
	        if (e.key === 'y' || e.key === 'Y') {
	          e.preventDefault();
	          const d = readLaunchDefaults();
	          writeLaunchDefaults({ yolo: !(d.yolo !== false) });
	          applyDefaultsUi(state.boardId);
	          return;
	        }
	        if (e.key === 'p' || e.key === 'P') {
	          e.preventDefault();
	          const d = readLaunchDefaults();
	          writeLaunchDefaults({ autoSendPrompt: !(d.autoSendPrompt !== false) });
	          applyDefaultsUi(state.boardId);
	          return;
	        }
	        if (e.key === 'l' || e.key === 'L') {
	          e.preventDefault();
	          const defaults = readLaunchDefaults();
	          const tier = Number(defaults?.tier || 3);
	          quickLaunchWithTier(tier);
	          return;
	        }
	        if (e.key === '1') {
	          e.preventDefault();
	          quickLaunchWithTier(1);
	          return;
	        }
	        if (e.key === '2') {
	          e.preventDefault();
	          quickLaunchWithTier(2);
	          return;
	        }
	        if (e.key === '3') {
	          e.preventDefault();
	          quickLaunchWithTier(3);
	          return;
	        }
	        if (e.key === '4') {
	          e.preventDefault();
	          quickLaunchWithTier(4);
	          return;
	        }
	      }

		      if (e.key === 'Escape') {
		        e.preventDefault();
            const hasPopover = !!modal.querySelector('#tasks-launch-popover-overlay');
            if (hasPopover) {
              closeLaunchPopover();
              return;
            }
		        const hasHotkeys = !!modal.querySelector('#tasks-hotkeys-overlay');
		        if (hasHotkeys) {
		          closeHotkeysOverlay();
		          return;
		        }
		        const hasBoardMenu = typeof isBoardMenuOpen === 'function' && isBoardMenuOpen();
		        if (hasBoardMenu) {
		          closeBoardMenu();
		          return;
		        }
		        modal.remove();
		      }
		    };
    document.addEventListener('keydown', onTasksKeyDown);

    const originalRemove = modal.remove.bind(modal);
    modal.remove = () => {
      document.removeEventListener('keydown', onTasksKeyDown);
      originalRemove();
    };

    // Drag/drop (board view): inspired by Fizzy's simple DnD controller.
    let dragCardId = null;
    let dragFromListId = null;

    cardsEl.addEventListener('dragstart', (e) => {
      if (state.view !== 'board') return;
      const row = e.target.closest('.task-card-board');
      if (!row) return;
      dragCardId = row.dataset.cardId || null;
      dragFromListId = row.dataset.originListId || null;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.dropEffect = 'move';

      // If the board view is in a narrow (single-expanded) mode, ensure the source column is expanded.
      const sourceCol = dragFromListId ? cardsEl.querySelector(`.tasks-column[data-list-id="${CSS.escape(dragFromListId)}"]`) : null;
      sourceCol?.classList?.remove?.('is-collapsed');
      sourceCol?.classList?.add?.('is-expanded');
    });

    cardsEl.addEventListener('dragend', (e) => {
      const row = e.target.closest('.task-card-board');
      row?.classList.remove('dragging');
      cardsEl.querySelectorAll('.tasks-column.hover').forEach(col => col.classList.remove('hover'));
      dragCardId = null;
      dragFromListId = null;
    });

    cardsEl.addEventListener('dragover', (e) => {
      if (state.view !== 'board') return;
      if (!dragCardId) return;
      const column = e.target.closest('.tasks-column');
      if (!column) return;
      e.preventDefault();
      cardsEl.querySelectorAll('.tasks-column.hover').forEach(col => col.classList.remove('hover'));
      column.classList.add('hover');
    });

    cardsEl.addEventListener('drop', async (e) => {
      if (state.view !== 'board') return;
      const column = e.target.closest('.tasks-column');
      if (!column) return;
      e.preventDefault();

      const toListId = column.dataset.listId;
      if (!dragCardId || !toListId || toListId === dragFromListId) return;

      const draggedEl = cardsEl.querySelector(`.task-card-board[data-card-id="${dragCardId}"]`);
      const targetContainer = column.querySelector('[data-dropzone]');
      const fromColumn = dragFromListId ? cardsEl.querySelector(`.tasks-column[data-list-id="${dragFromListId}"]`) : null;
      const fromContainer = fromColumn?.querySelector('[data-dropzone]') || null;

      const updateCount = (col) => {
        if (!col) return;
        const countEl = col.querySelector('[data-count]');
        if (!countEl) return;
        countEl.textContent = String(col.querySelectorAll('.task-card-board').length);
      };

      // Optimistic DOM move: place at top of target column
      if (draggedEl && targetContainer) {
        targetContainer.prepend(draggedEl);
        draggedEl.dataset.originListId = toListId;
      }
      updateCount(column);
      updateCount(fromColumn);

      try {
        await updateCard({ cardId: dragCardId, fields: { idList: toListId, pos: 'top' } });
        this.showToast('Moved', 'success');
      } catch (err) {
        console.error('Move card failed:', err);
        if (draggedEl && fromContainer) {
          fromContainer.appendChild(draggedEl);
          draggedEl.dataset.originListId = dragFromListId || '';
        }
        updateCount(column);
        updateCount(fromColumn);
        this.showToast(String(err?.message || err), 'error');
      } finally {
        cardsEl.querySelectorAll('.tasks-column.hover').forEach(col => col.classList.remove('hover'));
      }
    });

    await refreshAll({ force: false });
  }

  async showQueuePanel(opts = {}) {
    console.log('Opening Queue panel...');

    const existing = document.getElementById('queue-panel');
    if (existing) existing.remove();

    const serverUrl = window.location.origin;
    const initialSelectedId = String(opts?.selectedId || '').trim() || null;

			    const state = {
			      mode: 'mine', // mine | all
			      query: '',
			      tasks: [],
			      selectedId: initialSelectedId,
			      reviewTier: 'all', // all | none | 1..4
            tierSet: null, // null | number[] (multi-tier presets like [3,4])
			      unreviewedOnly: false,
            blockedOnly: localStorage.getItem('queue-blocked-only') === 'true',
			      autoOpenDiff: false,
            triageMode: localStorage.getItem('queue-triage') === 'true',
            snoozes: {}, // taskId -> untilMs
            snoozeCounts: {}, // taskId -> count
				      autoAdvance: localStorage.getItem('queue-auto-advance') === 'true',
				      autoReviewer: localStorage.getItem('queue-auto-reviewer') === 'true',
				      autoFixer: localStorage.getItem('queue-auto-fixer') === 'true',
				      autoRecheck: localStorage.getItem('queue-auto-recheck') === 'true',
				      depGraphDepth: Math.max(1, Math.min(6, Number(localStorage.getItem('queue-dep-graph-depth') || 2) || 2)),
				      depGraphView: (['tree', 'graph'].includes(String(localStorage.getItem('queue-dep-graph-view') || 'tree'))) ? String(localStorage.getItem('queue-dep-graph-view') || 'tree') : 'tree',
			      depGraphShowSatisfied: localStorage.getItem('queue-dep-graph-show-satisfied') !== 'false',
			      reviewActive: false,
			      reviewTimer: { taskId: null, startedAtMs: null },
			      reviewerSpawning: new Set(),
			      fixerSpawning: new Set(),
			      recheckSpawning: new Set()
			    };

    const loadSnoozes = () => {
      try {
        const raw = localStorage.getItem('queue-snoozes');
        const parsed = raw ? JSON.parse(raw) : {};
        return (parsed && typeof parsed === 'object') ? parsed : {};
      } catch {
        return {};
      }
    };

    const saveSnoozes = (next) => {
      state.snoozes = (next && typeof next === 'object') ? next : {};
      try {
        localStorage.setItem('queue-snoozes', JSON.stringify(state.snoozes));
      } catch {
        // ignore
      }
    };

    const loadSnoozeCounts = () => {
      try {
        const raw = localStorage.getItem('queue-snooze-counts');
        const parsed = raw ? JSON.parse(raw) : {};
        return (parsed && typeof parsed === 'object') ? parsed : {};
      } catch {
        return {};
      }
    };

    const saveSnoozeCounts = (next) => {
      state.snoozeCounts = (next && typeof next === 'object') ? next : {};
      try {
        localStorage.setItem('queue-snooze-counts', JSON.stringify(state.snoozeCounts));
      } catch {
        // ignore
      }
    };

    const getSnoozeUntilMs = (taskId) => {
      const id = String(taskId || '').trim();
      if (!id) return 0;
      const v = Number(state.snoozes?.[id] || 0);
      return Number.isFinite(v) ? v : 0;
    };

    saveSnoozes(loadSnoozes());
    saveSnoozeCounts(loadSnoozeCounts());

    // Apply any one-shot preset (e.g. workflow review button).
    if (this.queuePanelPreset && typeof this.queuePanelPreset === 'object') {
      const preset = this.queuePanelPreset;
      this.queuePanelPreset = null;
      if (preset.reviewTier !== undefined) {
        state.reviewTier = preset.reviewTier === 'all' || preset.reviewTier === 'none'
          ? preset.reviewTier
          : Number.parseInt(String(preset.reviewTier), 10);
      }
      if (Array.isArray(preset.tierSet)) {
        state.tierSet = preset.tierSet.map(Number).filter((n) => n >= 1 && n <= 4);
        if (!state.tierSet.length) state.tierSet = null;
      }
      if (preset.triageMode !== undefined) state.triageMode = !!preset.triageMode;
      if (preset.unreviewedOnly !== undefined) state.unreviewedOnly = !!preset.unreviewedOnly;
      if (preset.autoOpenDiff !== undefined) state.autoOpenDiff = !!preset.autoOpenDiff;
      state.reviewActive = preset.reviewActive !== undefined ? !!preset.reviewActive : true;
    }

    state.allowAutoOpenDiff = false;

    const escapeHtml = (value) => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const modal = document.createElement('div');
    modal.id = 'queue-panel';
    modal.className = 'modal tasks-modal';
    const tasksThemeSetting = this.userSettings?.global?.ui?.tasks?.theme;
    const resolvedTheme = (tasksThemeSetting === 'light' || tasksThemeSetting === 'dark')
      ? tasksThemeSetting
      : (this.settings.theme === 'light' ? 'light' : 'dark');
    modal.classList.add(`tasks-theme-${resolvedTheme}`);
    modal.innerHTML = `
      <div class="modal-content tasks-content">
        <div class="modal-header">
          <h2>📥 Queue</h2>
          <button class="close-btn tasks-close-btn" id="queue-close-btn" aria-label="Close Queue" title="Close (Esc)">×</button>
        </div>
        <div class="tasks-toolbar">
          <input type="text" id="queue-search" class="search-input tasks-search" placeholder="Search PRs/worktrees/sessions…">
          <div class="tasks-view-toggle" role="group" aria-label="Queue mode">
            <button class="btn-secondary tasks-view-btn" id="queue-mode-mine" data-mode="mine" title="My PRs">Mine</button>
            <button class="btn-secondary tasks-view-btn" id="queue-mode-all" data-mode="all" title="All PRs">All</button>
          </div>
          <div class="tasks-view-toggle" role="group" aria-label="Review tier">
            <button class="btn-secondary tasks-view-btn" id="queue-tier-all" data-tier="all" title="All tiers">All</button>
            <button class="btn-secondary tasks-view-btn" id="queue-tier-1" data-tier="1" title="Tier 1">T1</button>
            <button class="btn-secondary tasks-view-btn" id="queue-tier-2" data-tier="2" title="Tier 2">T2</button>
            <button class="btn-secondary tasks-view-btn" id="queue-tier-3" data-tier="3" title="Tier 3">T3</button>
            <button class="btn-secondary tasks-view-btn" id="queue-tier-4" data-tier="4" title="Tier 4">T4</button>
            <button class="btn-secondary tasks-view-btn" id="queue-tier-bg" data-tier="bg" title="Background tiers (T3+T4)">T3+</button>
            <button class="btn-secondary tasks-view-btn" id="queue-tier-none" data-tier="none" title="No tier">None</button>
          </div>
		          <div class="tasks-view-toggle" role="group" aria-label="Review filters">
		            <button class="btn-secondary tasks-view-btn" id="queue-triage" title="Triage ordering + snooze (safe backoff)">Triage</button>
		            <button class="btn-secondary tasks-view-btn" id="queue-unreviewed" title="Toggle: show unreviewed only">Unreviewed</button>
		            <button class="btn-secondary tasks-view-btn" id="queue-blocked" title="Toggle: show blocked only (dependency-blocked items)">Blocked</button>
		            <button class="btn-secondary tasks-view-btn" id="queue-auto-diff" title="Toggle: auto-open diff for PR items">Auto Diff</button>
		            <button class="btn-secondary tasks-view-btn" id="queue-auto-next" title="Toggle: auto-advance when you complete a review">Auto Next</button>
		            <button class="btn-secondary tasks-view-btn" id="queue-auto-reviewer" title="Toggle: auto-spawn a reviewer agent for Tier 3 PRs">Auto Reviewer</button>
		            <button class="btn-secondary tasks-view-btn" id="queue-auto-fixer" title="Toggle: auto-spawn a fixer when Outcome=needs_fix and Notes is set">Auto Fixer</button>
		            <button class="btn-secondary tasks-view-btn" id="queue-auto-recheck" title="Toggle: auto-spawn a recheck reviewer after fixes land on the PR">Auto Recheck</button>
		            <button class="btn-secondary tasks-view-btn" id="queue-conveyor-t2" title="Conveyor: Tier 2 + unreviewed + auto-next (one-at-a-time)">Conveyor T2</button>
		            <button class="btn-secondary tasks-view-btn" id="queue-start-review" title="Start review from the top">Start Review</button>
		          </div>
          <div class="tasks-view-toggle" role="group" aria-label="Queue navigation">
            <button class="btn-secondary tasks-view-btn" id="queue-prev" title="Previous item (unblocked first)">Prev</button>
            <button class="btn-secondary tasks-view-btn" id="queue-next" title="Next item (unblocked first)">Next</button>
          </div>
          <button class="btn-secondary" id="queue-refresh">🔄 Refresh</button>
        </div>
        <div class="tasks-body">
          <div class="tasks-cards" id="queue-list">
            <div class="loading">Loading queue…</div>
          </div>
          <div class="tasks-detail" id="queue-detail">
            <div class="tasks-detail-empty">Select an item to edit tier/risk or open it.</div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const listEl = modal.querySelector('#queue-list');
    const detailEl = modal.querySelector('#queue-detail');
    const searchEl = modal.querySelector('#queue-search');
    const refreshBtn = modal.querySelector('#queue-refresh');
    const mineBtn = modal.querySelector('#queue-mode-mine');
    const allBtn = modal.querySelector('#queue-mode-all');
    const tierAllBtn = modal.querySelector('#queue-tier-all');
    const tier1Btn = modal.querySelector('#queue-tier-1');
    const tier2Btn = modal.querySelector('#queue-tier-2');
    const tier3Btn = modal.querySelector('#queue-tier-3');
    const tier4Btn = modal.querySelector('#queue-tier-4');
    const tierBgBtn = modal.querySelector('#queue-tier-bg');
	    const tierNoneBtn = modal.querySelector('#queue-tier-none');
		    const unreviewedBtn = modal.querySelector('#queue-unreviewed');
        const blockedBtn = modal.querySelector('#queue-blocked');
        const triageBtn = modal.querySelector('#queue-triage');
		    const autoDiffBtn = modal.querySelector('#queue-auto-diff');
		    const autoNextBtn = modal.querySelector('#queue-auto-next');
		    const autoReviewerBtn = modal.querySelector('#queue-auto-reviewer');
		    const autoFixerBtn = modal.querySelector('#queue-auto-fixer');
		    const autoRecheckBtn = modal.querySelector('#queue-auto-recheck');
		    const conveyorT2Btn = modal.querySelector('#queue-conveyor-t2');
		    const startReviewBtn = modal.querySelector('#queue-start-review');
		    const prevBtn = modal.querySelector('#queue-prev');
		    const nextBtn = modal.querySelector('#queue-next');
		    const closeBtn = modal.querySelector('#queue-close-btn');

    const setMode = (mode) => {
      state.mode = mode === 'all' ? 'all' : 'mine';
      mineBtn.classList.toggle('active', state.mode === 'mine');
      allBtn.classList.toggle('active', state.mode === 'all');
    };
    setMode('mine');

    const normalizeReviewTier = (tier) => {
      const raw = String(tier ?? '').trim().toLowerCase();
      if (raw === '' || raw === 'all') return 'all';
      if (raw === 'none') return 'none';
      const n = Number.parseInt(raw, 10);
      if (n >= 1 && n <= 4) return n;
      return 'all';
    };

		    const syncReviewControlsUI = () => {
		      const tier = normalizeReviewTier(state.reviewTier);
          const tierSet = Array.isArray(state.tierSet) && state.tierSet.length ? state.tierSet : null;
		      tierAllBtn?.classList.toggle('active', tier === 'all' && !tierSet);
		      tierNoneBtn?.classList.toggle('active', tier === 'none');
		      tier1Btn?.classList.toggle('active', tier === 1);
		      tier2Btn?.classList.toggle('active', tier === 2);
		      tier3Btn?.classList.toggle('active', (tier === 3) || (tierSet && tierSet.includes(3)));
		      tier4Btn?.classList.toggle('active', (tier === 4) || (tierSet && tierSet.includes(4)));
          tierBgBtn?.classList.toggle('active', !!(tierSet && tierSet.length === 2 && tierSet.includes(3) && tierSet.includes(4)));

          triageBtn?.classList.toggle('active', !!state.triageMode);
		      unreviewedBtn?.classList.toggle('active', !!state.unreviewedOnly);
          blockedBtn?.classList.toggle('active', !!state.blockedOnly);
		      autoDiffBtn?.classList.toggle('active', !!state.autoOpenDiff);
		      autoNextBtn?.classList.toggle('active', !!state.autoAdvance);
		      autoReviewerBtn?.classList.toggle('active', !!state.autoReviewer);
		      autoFixerBtn?.classList.toggle('active', !!state.autoFixer);
		      autoRecheckBtn?.classList.toggle('active', !!state.autoRecheck);
		      startReviewBtn?.classList.toggle('active', !!state.reviewActive);
		      if (startReviewBtn) startReviewBtn.textContent = state.reviewActive ? 'Stop Review' : 'Start Review';
		    };

    const applyFiltersAndMaybeClampSelection = ({ renderSelectedDetail = true } = {}) => {
      syncReviewControlsUI();
      renderList();
      const ordered = getOrderedTasks(getFilteredTasks());
      if (state.selectedId && !ordered.some(t => t.id === state.selectedId)) {
        state.selectedId = ordered[0]?.id || null;
      }
      if (renderSelectedDetail && state.selectedId) {
        renderDetail(getTaskById(state.selectedId));
      }
    };

    const setReviewTier = (tier) => {
      state.tierSet = null;
      state.reviewTier = normalizeReviewTier(tier);
      applyFiltersAndMaybeClampSelection();
    };

    tierAllBtn?.addEventListener('click', () => setReviewTier('all'));
    tier1Btn?.addEventListener('click', () => setReviewTier(1));
    tier2Btn?.addEventListener('click', () => setReviewTier(2));
    tier3Btn?.addEventListener('click', () => setReviewTier(3));
    tier4Btn?.addEventListener('click', () => setReviewTier(4));
    tierNoneBtn?.addEventListener('click', () => setReviewTier('none'));
    tierBgBtn?.addEventListener('click', () => {
      state.reviewTier = 'all';
      state.tierSet = [3, 4];
      state.triageMode = true;
      try { localStorage.setItem('queue-triage', 'true'); } catch {}
      applyFiltersAndMaybeClampSelection();
    });

    triageBtn?.addEventListener('click', () => {
      state.triageMode = !state.triageMode;
      try { localStorage.setItem('queue-triage', state.triageMode ? 'true' : 'false'); } catch {}
      applyFiltersAndMaybeClampSelection();
    });

    unreviewedBtn?.addEventListener('click', () => {
      state.unreviewedOnly = !state.unreviewedOnly;
      syncReviewControlsUI();
      renderList();
      if (state.selectedId) renderDetail(getTaskById(state.selectedId));
    });

    blockedBtn?.addEventListener('click', () => {
      state.blockedOnly = !state.blockedOnly;
      try { localStorage.setItem('queue-blocked-only', state.blockedOnly ? 'true' : 'false'); } catch {}
      applyFiltersAndMaybeClampSelection();
    });

	    autoDiffBtn?.addEventListener('click', () => {
	      state.autoOpenDiff = !state.autoOpenDiff;
	      syncReviewControlsUI();
	      if (state.selectedId) renderDetail(getTaskById(state.selectedId));
	    });

	    autoNextBtn?.addEventListener('click', () => {
	      state.autoAdvance = !state.autoAdvance;
	      localStorage.setItem('queue-auto-advance', state.autoAdvance ? 'true' : 'false');
	      syncReviewControlsUI();
	    });

		    autoReviewerBtn?.addEventListener('click', () => {
		      state.autoReviewer = !state.autoReviewer;
		      localStorage.setItem('queue-auto-reviewer', state.autoReviewer ? 'true' : 'false');
		      syncReviewControlsUI();
		      if (state.selectedId) renderDetail(getTaskById(state.selectedId));
	    });

	    autoFixerBtn?.addEventListener('click', () => {
	      state.autoFixer = !state.autoFixer;
	      localStorage.setItem('queue-auto-fixer', state.autoFixer ? 'true' : 'false');
	      syncReviewControlsUI();
	      if (state.selectedId) renderDetail(getTaskById(state.selectedId));
	    });

		    autoRecheckBtn?.addEventListener('click', () => {
		      state.autoRecheck = !state.autoRecheck;
		      localStorage.setItem('queue-auto-recheck', state.autoRecheck ? 'true' : 'false');
		      syncReviewControlsUI();
		      if (state.selectedId) renderDetail(getTaskById(state.selectedId));
		    });

	    startReviewBtn?.addEventListener('click', async () => {
	      if (state.reviewActive) {
	        state.reviewActive = false;
	        syncReviewControlsUI();
	        await stopReviewTimer({ reason: 'stop', nudge: false }).catch(() => {});
	        return;
	      }

	      state.reviewActive = true;
	      syncReviewControlsUI();
	      const ordered = getOrderedTasks(getFilteredTasks());
	      if (!ordered.length) {
	        this.showToast('No items to review', 'info');
	        return;
	      }
	      selectById(ordered[0].id, { allowAutoOpenDiff: true });
	    });

	    conveyorT2Btn?.addEventListener('click', () => {
	      state.reviewActive = true;
	      state.reviewTier = 2;
	      state.unreviewedOnly = true;
	      state.autoOpenDiff = true;
	      state.autoAdvance = true;
	      localStorage.setItem('queue-auto-advance', 'true');
	      syncReviewControlsUI();
	      renderList();

	      const ordered = getOrderedTasks(getFilteredTasks());
	      if (!ordered.length) {
	        this.showToast('No Tier 2 items to review', 'info');
	        return;
	      }
	      selectById(ordered[0].id, { allowAutoOpenDiff: true });
	    });

	    const maybeAutoAdvanceAfterReview = (currentTaskId) => {
	      if (!state.reviewActive || !state.autoAdvance) return;
	      const ordered = getOrderedTasks(getFilteredTasks());
	      if (!ordered.length) {
	        state.reviewActive = false;
	        syncReviewControlsUI();
	        this.notifyWorkflow?.({ type: 'completed', message: 'Review queue complete' });
	        stopReviewTimer({ reason: 'queue_complete', nudge: false }).catch(() => {});
	        return;
	      }
	      const currentIndex = currentTaskId ? ordered.findIndex(t => t.id === currentTaskId) : -1;
	      const nextIndex = currentIndex >= 0 ? ((currentIndex + 1) % ordered.length) : 0;
	      selectById(ordered[nextIndex].id, { allowAutoOpenDiff: true });
	    };

    const calcTierCounts = (tasks) => {
      const counts = { 1: 0, 2: 0, 3: 0, 4: 0, none: 0 };
      for (const t of tasks) {
        const tier = Number(t?.record?.tier);
        if (tier >= 1 && tier <= 4) counts[tier] += 1;
        else counts.none += 1;
      }
      return counts;
    };

    const getFilteredTasks = () => {
      const q = String(state.query || '').trim().toLowerCase();
      return (Array.isArray(state.tasks) ? state.tasks : []).filter((t) => {
        const tier = Number(t?.record?.tier);
        if (state.tierSet && Array.isArray(state.tierSet) && state.tierSet.length) {
          if (!state.tierSet.includes(tier)) return false;
        }
        if (state.reviewTier !== 'all') {
          if (state.reviewTier === 'none') {
            if (Number.isFinite(tier)) return false;
          } else if (tier !== state.reviewTier) {
            return false;
          }
        }
        if (state.unreviewedOnly) {
          if (t?.record?.reviewedAt) return false;
        }
        if (state.blockedOnly) {
          const blockedCount = Number(t?.dependencySummary?.blocked || 0);
          if (!(blockedCount > 0)) return false;
        }
        if (state.triageMode) {
          const until = getSnoozeUntilMs(t?.id);
          if (until && Date.now() < until) return false;
        }
        if (!q) return true;
        const hay = [
          t?.title,
          t?.project,
          t?.repository,
          t?.worktree,
          t?.worktreeId,
          t?.worktreePath,
          t?.branch,
          t?.sessionId,
          t?.url
        ].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      });
    };

    const getOrderedTasks = (tasks) => {
      const unblocked = [];
      const blocked = [];
      for (const t of (Array.isArray(tasks) ? tasks : [])) {
        const blockedCount = Number(t?.dependencySummary?.blocked || 0);
        if (blockedCount > 0) blocked.push(t);
        else unblocked.push(t);
      }

      const parseUpdatedMs = (t) => {
        const ms = Date.parse(String(t?.updatedAt || t?.createdAt || ''));
        return Number.isFinite(ms) ? ms : 0;
      };

      const triagePriority = (t) => {
        if (!state.triageMode) return 0;
        if (t?.kind === 'session' && String(t?.status || '').toLowerCase() === 'waiting') return 0;
        const outcome = String(t?.record?.reviewOutcome || '').toLowerCase();
        if (!t?.record?.doneAt && outcome === 'needs_fix') return 1;
        if (t?.kind === 'worktree') return 2;
        if (t?.kind === 'pr' && !t?.record?.reviewedAt) return 3;
        return 4;
      };

      const triageSort = (arr) => {
        return [...arr].sort((a, b) => {
          const pa = triagePriority(a);
          const pb = triagePriority(b);
          if (pa !== pb) return pa - pb;
          const at = parseUpdatedMs(a);
          const bt = parseUpdatedMs(b);
          if (bt !== at) return bt - at;
          return String(a?.title || a?.id || '').localeCompare(String(b?.title || b?.id || ''));
        });
      };

      if (!state.reviewActive) {
        if (state.triageMode) return triageSort(unblocked).concat(triageSort(blocked));
        return unblocked.concat(blocked);
      }

      const me = String(this.userSettings?.global?.ui?.tasks?.me?.trelloUsername || localStorage.getItem('orchestrator-claim-name') || 'me').trim() || 'me';
      const byClaim = (arr) => {
        const unclaimed = [];
        const mine = [];
        const others = [];
        for (const x of arr) {
          const by = String(x?.record?.claimedBy || '').trim();
          if (!by) unclaimed.push(x);
          else if (by === me) mine.push(x);
          else others.push(x);
        }
        return unclaimed.concat(mine, others);
      };

      return byClaim(unblocked).concat(byClaim(blocked));
    };

	    const getTaskById = (id) => (Array.isArray(state.tasks) ? state.tasks : []).find(x => x.id === id) || null;

	    const maybeApplyTrelloNeedsFixLabel = async ({ taskId, outcome, notes = '' } = {}) => {
	      const id = String(taskId || '').trim();
	      const o = String(outcome || '').trim().toLowerCase();
	      if (!id || o !== 'needs_fix') return false;

	      const task = getTaskById(id);
	      const record = task?.record && typeof task.record === 'object' ? task.record : {};
	      const providerId = String(record?.ticketProvider || 'trello').trim().toLowerCase();
	      if (providerId !== 'trello') return false;

	      const cardRef = String(record?.ticketCardId || '').trim();
	      if (!cardRef) return false;

	      try {
	        const cardUrl = new URL(`${serverUrl}/api/tasks/cards/${encodeURIComponent(cardRef)}`);
	        cardUrl.searchParams.set('provider', providerId);
	        cardUrl.searchParams.set('refresh', 'true');
	        const cardRes = await fetch(cardUrl.toString());
	        const cardData = await cardRes.json().catch(() => ({}));
	        if (!cardRes.ok) throw new Error(cardData?.error || 'Failed to load ticket card');
	        const card = cardData?.card || null;

	        const boardId = String(card?.idBoard || record?.ticketBoardId || '').trim();
	        if (!boardId) return false;

	        const conventionsAll = this.userSettings?.global?.ui?.tasks?.boardConventions;
	        const conventions = conventionsAll && typeof conventionsAll === 'object' && !Array.isArray(conventionsAll) ? conventionsAll : {};
	        const key = `${providerId}:${boardId}`;
	        const conv = conventions[key] && typeof conventions[key] === 'object' && !Array.isArray(conventions[key]) ? conventions[key] : {};
	        const labelName = String(conv?.needsFixLabelName || '').trim();
	        if (!labelName) return false;

	        const labelsUrl = new URL(`${serverUrl}/api/tasks/boards/${encodeURIComponent(boardId)}/labels`);
	        labelsUrl.searchParams.set('provider', providerId);
	        const labelsRes = await fetch(labelsUrl.toString());
	        const labelsData = await labelsRes.json().catch(() => ({}));
	        if (!labelsRes.ok) throw new Error(labelsData?.error || 'Failed to load board labels');
	        const labels = Array.isArray(labelsData?.labels) ? labelsData.labels : [];

	        const norm = (s) => String(s || '').trim().toLowerCase();
	        const target = labels.find((l) => norm(l?.name) === norm(labelName)) || null;
	        const targetId = String(target?.id || '').trim();
	        if (!targetId) {
	          this.showToast(`needs_fix label not found on board: ${labelName}`, 'warning');
	          return false;
	        }

	        const existing = Array.isArray(card?.idLabels)
	          ? card.idLabels
	          : (Array.isArray(card?.labels) ? card.labels.map((l) => l?.id) : []);
	        const set = new Set((Array.isArray(existing) ? existing : []).filter(Boolean));
	        set.add(targetId);

	        const patch = { idLabels: Array.from(set) };
	        const putRes = await fetch(`${serverUrl}/api/tasks/cards/${encodeURIComponent(cardRef)}?provider=${encodeURIComponent(providerId)}`, {
	          method: 'PUT',
	          headers: { 'Content-Type': 'application/json' },
	          body: JSON.stringify(patch)
	        });
	        const putData = await putRes.json().catch(() => ({}));
	        if (!putRes.ok) throw new Error(putData?.error || 'Failed to apply needs_fix label');

	        const noteText = String(notes || '').trim();
	        if (noteText) {
	          const comment = `Orchestrator review outcome: needs_fix\n\n${noteText}`;
	          await fetch(`${serverUrl}/api/tasks/cards/${encodeURIComponent(cardRef)}/comments?provider=${encodeURIComponent(providerId)}`, {
	            method: 'POST',
	            headers: { 'Content-Type': 'application/json' },
	            body: JSON.stringify({ text: comment })
	          }).catch(() => {});
	        }

	        return true;
	      } catch (err) {
	        console.warn('Failed to apply Trello needs_fix automation:', err);
	        this.showToast(String(err?.message || err), 'error');
	        return false;
	      }
	    };

	    const renderList = () => {
	      const tasks = getFilteredTasks();
	      const ordered = getOrderedTasks(tasks);

      const counts = calcTierCounts(tasks);
      const header = `
        <div class="queue-summary">
          <span class="pr-badge">T1 ${counts[1]}</span>
          <span class="pr-badge">T2 ${counts[2]}</span>
          <span class="pr-badge">T3 ${counts[3]}</span>
          <span class="pr-badge">T4 ${counts[4]}</span>
          <span class="pr-badge">No tier ${counts.none}</span>
        </div>
      `;

      if (tasks.length === 0) {
        listEl.innerHTML = `${header}<div class="no-ports">No items.</div>`;
        return;
      }

    const row = (t) => {
      const kind = t.kind || 'task';
      const title = escapeHtml(t.title || t.id || '');
      const projectLabel = escapeHtml(t.project || '');
      const worktreeLabel = escapeHtml(t.worktree || '');
      const branchLabel = escapeHtml(t.branch || '');
      const repoLabel = escapeHtml(t.repository || '');
      const worktreePathLabel = escapeHtml(t.worktreePath || '');
      const tier = t?.record?.tier ? `T${t.record.tier}` : '';
      const risk = t?.record?.changeRisk ? `risk:${t.record.changeRisk}` : '';
      const depTotal = t?.dependencySummary?.total ? `deps:${t.dependencySummary.total}` : '';
      const depBlocked = t?.dependencySummary?.blocked ? `blocked:${t.dependencySummary.blocked}` : '';
      const reviewed = t?.record?.reviewedAt ? 'reviewed' : '';
      const outcome = t?.record?.reviewOutcome ? `review:${t.record.reviewOutcome}` : '';
      const claim = t?.record?.claimedBy ? `claimed:${t.record.claimedBy}` : '';
      const snoozedUntil = getSnoozeUntilMs(t?.id);
      const snoozed = state.triageMode && snoozedUntil && Date.now() < snoozedUntil ? 'snoozed' : '';
      const meta = [tier, risk].filter(Boolean).join(' • ');
      const meta2 = [depTotal, depBlocked, claim, reviewed, outcome, snoozed].filter(Boolean).join(' • ');
      const selected = state.selectedId === t.id;

      const tags = [];
      if (projectLabel) tags.push(`<span class="pr-badge" title="Project">${projectLabel}</span>`);
      if (worktreeLabel) tags.push(`<span class="pr-badge" title="Worktree">${worktreeLabel}</span>`);
      if (branchLabel) tags.push(`<span class="pr-badge" title="Branch">${branchLabel}</span>`);

      const hover = [repoLabel, worktreePathLabel, t?.sessionId ? `session:${escapeHtml(t.sessionId)}` : '']
        .filter(Boolean)
        .join(' • ');

	      return `
	          <div class="task-card-row ${selected ? 'selected' : ''}" data-queue-id="${escapeHtml(t.id)}" draggable="true" ${hover ? `title="${hover}"` : ''}>
	            <div class="task-card-title">${title}</div>
	            <div class="task-card-meta">
	              <span class="queue-kind">${escapeHtml(kind)}</span>
	              ${tags.length ? ` ${tags.join(' ')}` : ''}
              ${meta ? ` • ${escapeHtml(meta)}` : ''}
              ${meta2 ? ` • ${escapeHtml(meta2)}` : ''}
            </div>
          </div>
        `;
    };

      listEl.innerHTML = header + ordered.map(row).join('');
    };

    const fetchTasks = async () => {
      const url = new URL(`${serverUrl}/api/process/tasks`);
      url.searchParams.set('mode', state.mode);
      url.searchParams.set('state', 'open');
      url.searchParams.set('include', 'dependencySummary');
      const res = await fetch(url.toString());
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to load queue');
      state.tasks = data.tasks || [];
      const selectedStillExists = !!(state.selectedId && getTaskById(state.selectedId));
      if (!selectedStillExists) {
        const ordered = getOrderedTasks(getFilteredTasks());
        state.selectedId = ordered[0]?.id || null;
      }
      renderList();
    };

    const upsertRecord = async (id, patch) => {
      const res = await fetch(`${serverUrl}/api/process/task-records/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch || {})
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to save record');
      return data.record || null;
    };

	    const updateTaskRecordInState = (id, record) => {
	      if (!id) return;
	      const idx = state.tasks.findIndex(x => x.id === id);
	      if (idx >= 0) {
	        const existing = state.tasks[idx]?.record && typeof state.tasks[idx].record === 'object' ? state.tasks[idx].record : {};
	        const merged = record ? { ...existing, ...record } : {};
	        state.tasks[idx] = { ...state.tasks[idx], record: merged };
	      }
	      if (record) {
	        const existing = this.taskRecords.get(id) || {};
	        this.taskRecords.set(id, { ...(existing && typeof existing === 'object' ? existing : {}), ...record });
	      }
	      else this.taskRecords.delete(id);
	    };

    const stopReviewTimer = async ({ endedAtIso, reason = 'manual', nudge = false } = {}) => {
      const activeId = state.reviewTimer?.taskId;
      if (!activeId) return;
      const endIso = endedAtIso || new Date().toISOString();
      state.reviewTimer.taskId = null;
      state.reviewTimer.startedAtMs = null;
      try {
        const rec = await upsertRecord(activeId, { reviewEndedAt: endIso });
        updateTaskRecordInState(activeId, rec);
        renderList();
        const cfg = this.getWorkflowNotificationConfig();
        const shouldNudge = !!(nudge && cfg.reviewCompleteNudges);
        if (shouldNudge) maybeNudgeReviewComplete(activeId, { reason });
      } catch {
        // best-effort
      }
    };

    const reviewNudgeAtByTaskIdMs = {};
    const maybeNudgeReviewComplete = (taskId, { reason = 'manual' } = {}) => {
      const cfg = this.getWorkflowNotificationConfig();
      if (!cfg.reviewCompleteNudges) return false;
      if (cfg.mode === 'quiet') return false;

      const id = String(taskId || '').trim();
      if (!id) return false;

      const now = Date.now();
      const last = Number(reviewNudgeAtByTaskIdMs[id] || 0);
      if (last && (now - last < 45_000)) return false;
      reviewNudgeAtByTaskIdMs[id] = now;

      const task = getTaskById(id) || { id };
      const title = String(task?.title || id).trim();
      const prUrl = String(task?.url || '').trim();
      this.notifyWorkflow({
        type: 'completed',
        message: `Review complete: ${title}`,
        metadata: {
          taskId: id,
          prUrl: task?.kind === 'pr' ? prUrl : '',
          reason: String(reason || 'manual')
        }
      });
      return true;
    };

    const startReviewTimer = async (taskId) => {
      const id = String(taskId || '').trim();
      if (!state.reviewActive || !id) return;
      if (state.reviewTimer?.taskId === id) return;

      // End previous timer (best-effort) when switching items (no nudge).
      await stopReviewTimer({ reason: 'switch', nudge: false });

      const nowMs = Date.now();
      state.reviewTimer.taskId = id;
      state.reviewTimer.startedAtMs = nowMs;
      try {
        const rec = await upsertRecord(id, {
          reviewStartedAt: new Date(nowMs).toISOString(),
          reviewEndedAt: null
        });
        updateTaskRecordInState(id, rec);
        renderList();
      } catch {
        // best-effort
      }
    };

	    const openPromptEditor = async (promptId, opts = {}) => {
	      const pid = String(promptId || '').trim();
	      if (!pid) return;
	      const task = opts && typeof opts === 'object' ? opts.task : null;
	      const commentTarget = opts && typeof opts === 'object' ? (opts.commentTarget || null) : null;
	      const hasCommentTarget = !!(commentTarget && typeof commentTarget === 'object' && String(commentTarget.cardId || '').trim());
	      const taskId = task?.id ? String(task.id) : null;
	      const taskRecord = task?.record && typeof task.record === 'object' ? task.record : {};

	      const existing = document.getElementById('prompt-editor');
	      if (existing) existing.remove();

	      const editor = document.createElement('div');
      editor.id = 'prompt-editor';
      editor.className = 'modal tasks-modal';
      editor.classList.add(`tasks-theme-${resolvedTheme}`);
	      const initialStore = String(taskRecord.promptVisibility || 'private').trim().toLowerCase();
	      const initialRepoRoot = String(taskRecord.promptRepoRoot || '').trim();
	      const initialRelPath = String(taskRecord.promptPath || '').trim();

	      editor.innerHTML = `
	        <div class="modal-content tasks-content">
	          <div class="modal-header">
	            <h2>📝 Prompt: ${escapeHtml(pid)}</h2>
	            <button class="close-btn tasks-close-btn" aria-label="Close" onclick="this.closest('.modal').remove()">×</button>
	          </div>
	          <div class="tasks-body" style="grid-template-columns: 1fr;">
	            <div class="tasks-detail" style="overflow:auto;">
	              <div class="tasks-inline-row" style="margin-bottom: 10px;">
	                <button class="btn-secondary" id="prompt-load">🔄 Load</button>
	                <button class="btn-secondary" id="prompt-save">💾 Save</button>
	                <span style="flex:1"></span>
	                <label class="tasks-detail-meta" style="display:flex; align-items:center; gap:8px;">
	                  store:
	                  <select id="prompt-store" class="tasks-select tasks-select-inline" style="width: 140px;">
	                    <option value="private">private</option>
	                    <option value="shared">shared</option>
	                    <option value="encrypted">encrypted</option>
	                  </select>
	                </label>
	              </div>
	              <div class="tasks-inline-row" id="prompt-store-extra" style="margin-bottom: 10px; gap: 8px; flex-wrap: wrap;">
	                <input id="prompt-repo-root" class="tasks-input" style="min-width: 340px; flex: 1;" placeholder="Repo root (for shared/encrypted), e.g. /home/<user>/GitHub/games/hytopia/zoo-game" />
	                <input id="prompt-rel-path" class="tasks-input" style="min-width: 260px; flex: 1;" placeholder="Repo-relative path (optional; default .orchestrator/prompts/<id>.md)" />
	                <label class="tasks-toggle" id="prompt-comment-pointer-wrap" style="display:none" title="Add a pointer comment back to the selected card">
	                  <input type="checkbox" id="prompt-comment-pointer" checked />
	                  <span>Comment pointer</span>
	                </label>
	                <button class="btn-secondary" id="prompt-promote" title="Copy private prompt into repo store (shared/encrypted)">⬆ Promote</button>
	                <span class="tasks-detail-meta" id="prompt-sha"></span>
	              </div>
	              <div class="tasks-detail-meta" id="prompt-meta" style="margin-bottom: 8px;"></div>
	              <textarea id="prompt-text" class="tasks-textarea" rows="24" placeholder="Write your prompt…"></textarea>
	            </div>
	          </div>
	        </div>
      `;
      document.body.appendChild(editor);

	      const metaEl = editor.querySelector('#prompt-meta');
	      const shaEl = editor.querySelector('#prompt-sha');
	      const textEl = editor.querySelector('#prompt-text');
	      const storeEl = editor.querySelector('#prompt-store');
	      const extraEl = editor.querySelector('#prompt-store-extra');
	      const repoRootEl = editor.querySelector('#prompt-repo-root');
	      const relPathEl = editor.querySelector('#prompt-rel-path');
	      const commentWrapEl = editor.querySelector('#prompt-comment-pointer-wrap');
	      const commentEl = editor.querySelector('#prompt-comment-pointer');
	      const loadBtn = editor.querySelector('#prompt-load');
	      const promoteBtn = editor.querySelector('#prompt-promote');
	      const saveBtn = editor.querySelector('#prompt-save');

	      let dirty = false;
	      let loaded = { store: initialStore, repoRoot: initialRepoRoot, relPath: initialRelPath };

	      const setMeta = (m) => {
	        if (!metaEl) return;
	        metaEl.innerHTML = m ? String(m) : '';
	      };

	      const storeNeedsRepo = (store) => store === 'shared' || store === 'encrypted';

	      const updateStoreUI = ({ store, repoRoot, relPath } = {}) => {
	        const s = String(store || 'private').trim().toLowerCase();
	        if (storeEl) storeEl.value = ['private', 'shared', 'encrypted'].includes(s) ? s : 'private';
	        if (repoRootEl) repoRootEl.value = String(repoRoot || '').trim();
	        if (relPathEl) relPathEl.value = String(relPath || '').trim();
	        const needs = storeNeedsRepo(storeEl?.value || 'private');
	        if (extraEl) extraEl.style.display = 'flex';
	        if (repoRootEl) repoRootEl.style.display = needs ? '' : 'none';
	        if (relPathEl) relPathEl.style.display = needs ? '' : 'none';
	        if (commentWrapEl) commentWrapEl.style.display = (needs && hasCommentTarget) ? '' : 'none';
	        if (promoteBtn) promoteBtn.style.display = needs ? '' : 'none';
	      };

	      const load = async () => {
	        const store = String(storeEl?.value || 'private').trim().toLowerCase();
	        const repoRoot = String(repoRootEl?.value || '').trim();
	        const relPath = String(relPathEl?.value || '').trim();

	        const url = new URL(`${serverUrl}/api/prompts/${encodeURIComponent(pid)}`);
	        if (storeNeedsRepo(store)) {
	          if (!repoRoot) throw new Error('Repo root is required for shared/encrypted prompts');
	          url.searchParams.set('visibility', store);
	          url.searchParams.set('repoRoot', repoRoot);
	          if (relPath) url.searchParams.set('relPath', relPath);
	        }

	        const res = await fetch(url.toString());
	        if (res.status === 404) {
	          shaEl.textContent = 'new';
	          textEl.value = '';
	          setMeta(storeNeedsRepo(store) ? `store: <code>${escapeHtml(store)}</code> • (new file)` : 'store: <code>private</code> • (new file)');
	          dirty = false;
	          return;
	        }
	        const data = await res.json().catch(() => ({}));
	        if (!res.ok) throw new Error(data?.error || 'Failed to load prompt');
	        textEl.value = data.text || '';
	        shaEl.textContent = data.sha256 ? `sha256: ${data.sha256.slice(0, 12)}…` : '';
	        const effectiveStore = String(data.visibility || store).trim().toLowerCase();
	        loaded = {
	          store: effectiveStore,
	          repoRoot: String(data.repoRoot || repoRoot || ''),
	          relPath: String(data.relPath || relPath || '')
	        };
	        updateStoreUI(loaded);
	        setMeta(storeNeedsRepo(effectiveStore)
	          ? `store: <code>${escapeHtml(effectiveStore)}</code> • <code>${escapeHtml(loaded.relPath || '')}</code>`
	          : 'store: <code>private</code>');
	        dirty = false;

	        if (taskId) {
	          try {
	            const patch = { promptRef: pid, promptVisibility: loaded.store };
	            if (storeNeedsRepo(loaded.store)) {
	              patch.promptRepoRoot = loaded.repoRoot || null;
	              patch.promptPath = loaded.relPath || null;
	            } else {
	              patch.promptRepoRoot = null;
	              patch.promptPath = null;
	            }
	            const rec = await upsertRecord(taskId, patch);
	            updateTaskRecordInState(taskId, rec);
	            renderList();
	            renderDetail(getTaskById(taskId));
	          } catch {
	            // ignore
	          }
	        }
	      };

	      const save = async () => {
	        saveBtn.disabled = true;
	        try {
	          const store = String(storeEl?.value || 'private').trim().toLowerCase();
	          const repoRoot = String(repoRootEl?.value || '').trim();
	          const relPath = String(relPathEl?.value || '').trim();

	          const url = new URL(`${serverUrl}/api/prompts/${encodeURIComponent(pid)}`);
	          if (storeNeedsRepo(store)) {
	            if (!repoRoot) throw new Error('Repo root is required for shared/encrypted prompts');
	            url.searchParams.set('visibility', store);
	            url.searchParams.set('repoRoot', repoRoot);
	            if (relPath) url.searchParams.set('relPath', relPath);
	          }

	          const res = await fetch(url.toString(), {
	            method: 'PUT',
	            headers: { 'Content-Type': 'application/json' },
	            body: JSON.stringify({ text: textEl.value })
	          });
	          const data = await res.json().catch(() => ({}));
	          if (!res.ok) throw new Error(data?.error || 'Failed to save prompt');
	          shaEl.textContent = data.sha256 ? `sha256: ${data.sha256.slice(0, 12)}…` : '';
	          loaded = {
	            store: String(data.visibility || store).trim().toLowerCase(),
	            repoRoot: String(data.repoRoot || repoRoot || ''),
	            relPath: String(data.relPath || relPath || '')
	          };
	          updateStoreUI(loaded);
	          setMeta(storeNeedsRepo(loaded.store)
	            ? `store: <code>${escapeHtml(loaded.store)}</code> • <code>${escapeHtml(loaded.relPath || '')}</code>`
	            : 'store: <code>private</code>');
	          dirty = false;

	          if (taskId) {
	            try {
	              const patch = { promptRef: pid, promptVisibility: loaded.store };
	              if (storeNeedsRepo(loaded.store)) {
	                patch.promptRepoRoot = loaded.repoRoot || null;
	                patch.promptPath = loaded.relPath || null;
	              } else {
	                patch.promptRepoRoot = null;
	                patch.promptPath = null;
	              }
	              const rec = await upsertRecord(taskId, patch);
	              updateTaskRecordInState(taskId, rec);
	              renderList();
	              renderDetail(getTaskById(taskId));
	            } catch {
	              // ignore
	            }
	          }

	          this.showToast('Prompt saved', 'success');
	        } catch (e) {
	          this.showToast(String(e?.message || e), 'error');
	        } finally {
	          saveBtn.disabled = false;
	        }
	      };

	      const promote = async () => {
	        const store = String(storeEl?.value || '').trim().toLowerCase();
	        if (!storeNeedsRepo(store)) return;
	        const repoRoot = String(repoRootEl?.value || '').trim();
	        const relPath = String(relPathEl?.value || '').trim();
	        if (!repoRoot) throw new Error('Repo root is required for shared/encrypted prompts');

	        const pointerEnabled = !!(commentEl && commentEl.checked && hasCommentTarget);
	        const pointer = pointerEnabled
	          ? { provider: String(commentTarget?.provider || 'trello'), cardId: String(commentTarget?.cardId || '') }
	          : undefined;

	        const res = await fetch(`${serverUrl}/api/prompts/${encodeURIComponent(pid)}/promote`, {
	          method: 'POST',
	          headers: { 'Content-Type': 'application/json' },
	          body: JSON.stringify({ visibility: store, repoRoot, relPath: relPath || undefined, commentPointer: pointer })
	        });
	        const data = await res.json().catch(() => ({}));
	        if (!res.ok) throw new Error(data?.error || 'Failed to promote prompt');
	        if (data?.relPath && relPathEl) relPathEl.value = String(data.relPath);
	        this.showToast(`Prompt promoted (${store})`, 'success');
	        await load();
	      };

	      textEl?.addEventListener('input', () => { dirty = true; });
	      loadBtn?.addEventListener('click', async () => {
	        try {
	          loadBtn.disabled = true;
	          await load();
	        } catch (e) {
	          this.showToast(String(e?.message || e), 'error');
	        } finally {
	          loadBtn.disabled = false;
	        }
	      });
	      saveBtn.addEventListener('click', save);
	      promoteBtn?.addEventListener('click', async () => {
	        try {
	          promoteBtn.disabled = true;
	          await promote();
	        } catch (e) {
	          this.showToast(String(e?.message || e), 'error');
	        } finally {
	          promoteBtn.disabled = false;
	        }
	      });

	      storeEl?.addEventListener('change', async () => {
	        if (dirty && !window.confirm('Discard unsaved changes?')) {
	          storeEl.value = loaded.store || initialStore || 'private';
	          return;
	        }
	        updateStoreUI({ store: storeEl.value, repoRoot: repoRootEl?.value, relPath: relPathEl?.value });
	      });

	      updateStoreUI(loaded);
	      await load();
	    };

	    const openDependencyGraphModal = async (taskId) => {
	      const id = String(taskId || '').trim();
	      if (!id) return;

	      const depth = Math.max(1, Math.min(6, Number(state.depGraphDepth) || 2));

      const existing = document.getElementById('queue-dep-graph-modal');
      if (existing) existing.remove();

      const overlay = document.createElement('div');
	      overlay.id = 'queue-dep-graph-modal';
	      overlay.className = 'modal tasks-modal';
	      overlay.classList.add(`tasks-theme-${resolvedTheme}`);
	      overlay.innerHTML = `
	        <div class="modal-content tasks-content" style="max-width: 980px; width: 95vw; height: 80vh;">
	          <div class="modal-header">
	            <h2>🧩 Dependency Graph</h2>
	            <button class="close-btn tasks-close-btn" id="queue-dep-graph-close" aria-label="Close" title="Close (Esc)">×</button>
	          </div>
	          <div class="tasks-toolbar">
	            <div id="queue-dep-graph-meta" class="tasks-detail-meta"></div>
	            <select id="queue-dep-graph-view" class="tasks-select tasks-select-inline" title="View" style="width: 140px; margin-left: 10px;">
	              <option value="tree">tree</option>
	              <option value="graph">graph</option>
	            </select>
	            <label class="tasks-checkbox" style="margin-left:10px; gap:8px;">
	              <input type="checkbox" id="queue-dep-graph-show-satisfied" ${state.depGraphShowSatisfied ? 'checked' : ''} />
	              <span>Show satisfied</span>
	            </label>
	            <select id="queue-dep-graph-pins" class="tasks-select tasks-select-inline" title="Pinned" style="width: 180px; margin-left: 10px;">
	              <option value="">Pinned…</option>
	            </select>
	            <button class="btn-secondary" id="queue-dep-graph-pin" title="Pin/unpin current root">📌 Pin</button>
	            <span style="flex:1"></span>
	            <button class="btn-secondary" id="queue-dep-graph-jump" title="Jump to this node (Queue/Trello)">↩ Jump</button>
	            <button class="btn-secondary" id="queue-dep-graph-refresh">🔄 Refresh</button>
	          </div>
	          <div class="tasks-body" style="grid-template-columns: 1fr;">
	            <div id="queue-dep-graph-tree" style="display:grid; grid-template-columns: 1fr 1fr; gap: 12px;">
	              <div class="tasks-detail" style="padding: 14px;">
	                <div class="tasks-detail-block">
	                  <div class="tasks-detail-block-title">Blocked By</div>
	                  <div id="queue-dep-graph-up" class="tasks-detail-meta">Loading…</div>
	                </div>
	              </div>
	              <div class="tasks-detail" style="padding: 14px;">
	                <div class="tasks-detail-block">
	                  <div class="tasks-detail-block-title">Unblocks</div>
	                  <div id="queue-dep-graph-down" class="tasks-detail-meta">Loading…</div>
	                </div>
	              </div>
	            </div>
	            <div id="queue-dep-graph-viz" class="tasks-detail" style="padding: 14px; display:none; overflow:auto;">
	              <div class="tasks-detail-block">
	                <div class="tasks-detail-block-title">Graph</div>
	                <div class="tasks-detail-meta" style="margin-bottom: 8px;">Click a node to focus it. Ctrl/Cmd+Click to jump (Queue/Trello).</div>
	                <div id="queue-dep-graph-viz-scroll" style="overflow:auto; border-radius: 10px;">
	                  <svg id="queue-dep-graph-svg"></svg>
	                </div>
	              </div>
	            </div>
	          </div>
	        </div>
	      `;
	      document.body.appendChild(overlay);

      const close = () => overlay.remove();
      overlay.querySelector('#queue-dep-graph-close')?.addEventListener('click', close);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') overlay.remove(); }, { once: true });

	      let lastGraph = null;
	      let currentRoot = id;

	      const loadPins = () => {
	        try {
	          const raw = localStorage.getItem('queue-dep-graph-pins');
	          const arr = JSON.parse(raw || '[]');
	          return Array.isArray(arr) ? arr.map(v => String(v || '').trim()).filter(Boolean).slice(0, 20) : [];
	        } catch {
	          return [];
	        }
	      };
	      const savePins = (pins) => {
	        try {
	          localStorage.setItem('queue-dep-graph-pins', JSON.stringify((Array.isArray(pins) ? pins : []).slice(0, 20)));
	        } catch {}
	      };

	      let pins = loadPins();

	      const renderPins = () => {
	        const pinsEl = overlay.querySelector('#queue-dep-graph-pins');
	        if (!pinsEl) return;
	        pinsEl.innerHTML = `<option value="">Pinned…</option>` + pins.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
	      };

	      const updateToolbarMeta = (graph) => {
	        const metaEl = overlay.querySelector('#queue-dep-graph-meta');
	        const cycles = Array.isArray(graph?.cycles) ? graph.cycles : [];
	        const cycleInfo = cycles.length ? ` • cycles: ${cycles.length}` : '';
	        if (metaEl) metaEl.innerHTML = `root: <code>${escapeHtml(currentRoot)}</code> • depth: ${depth}${cycleInfo}`;

	        const pinBtn = overlay.querySelector('#queue-dep-graph-pin');
	        const pinned = pins.includes(currentRoot);
	        if (pinBtn) pinBtn.textContent = pinned ? '📌 Unpin' : '📌 Pin';
	      };

	      const jumpTo = (targetId) => {
	        const tid = String(targetId || '').trim();
	        if (!tid) return;
	        const mTrello = tid.match(/^trello:([a-zA-Z0-9]+)$/i);
	        if (mTrello?.[1]) {
	          window.open(`https://trello.com/c/${mTrello[1]}`, '_blank', 'noreferrer');
	          close();
	          return;
	        }
	        if (/^https?:\/\//i.test(tid)) {
	          window.open(tid, '_blank', 'noreferrer');
	          close();
	          return;
	        }
	        const t2 = getTaskById(tid);
	        if (!t2) {
	          this.showToast(`Not in Queue: ${tid}`, 'info');
	          return;
	        }
	        close();
	        selectById(tid, { allowAutoOpenDiff: true });
	      };

	      const setView = (view) => {
	        const v = (view === 'graph') ? 'graph' : 'tree';
	        state.depGraphView = v;
	        localStorage.setItem('queue-dep-graph-view', v);
	        const viewEl = overlay.querySelector('#queue-dep-graph-view');
	        if (viewEl) viewEl.value = v;
	        const treeEl = overlay.querySelector('#queue-dep-graph-tree');
	        const vizEl = overlay.querySelector('#queue-dep-graph-viz');
	        if (treeEl) treeEl.style.display = v === 'tree' ? 'grid' : 'none';
	        if (vizEl) vizEl.style.display = v === 'graph' ? 'block' : 'none';
	        if (lastGraph) renderGraph(lastGraph);
	      };

	      const renderSvgGraph = (graph) => {
	        const svg = overlay.querySelector('#queue-dep-graph-svg');
	        const container = overlay.querySelector('#queue-dep-graph-viz-scroll');
	        if (!svg || !container) return;

	        const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
	        const edgesAll = Array.isArray(graph?.edges) ? graph.edges : [];
	        const edges = state.depGraphShowSatisfied ? edgesAll : edgesAll.filter(e => !e?.satisfied);
	        const nodeById = new Map(nodes.map((n) => [String(n.id), n]));
	        const outgoing = new Map(); // from -> [{to,satisfied}]
	        const incoming = new Map(); // to -> [{from,satisfied}]
	        for (const e of edges) {
	          const from = String(e.from || '').trim();
	          const to = String(e.to || '').trim();
	          if (!from || !to) continue;
	          if (!outgoing.has(from)) outgoing.set(from, []);
	          outgoing.get(from).push({ to, satisfied: !!e.satisfied });
	          if (!incoming.has(to)) incoming.set(to, []);
	          incoming.get(to).push({ from, satisfied: !!e.satisfied });
	        }

	        const bfs = (start, nextFn, max) => {
	          const dist = new Map();
	          const q = [{ id: start, d: 0 }];
	          dist.set(start, 0);
	          while (q.length) {
	            const cur = q.shift();
	            if (cur.d >= max) continue;
	            const next = nextFn(cur.id) || [];
	            for (const nid of next) {
	              const nd = cur.d + 1;
	              const prev = dist.get(nid);
	              if (prev === undefined || nd < prev) {
	                dist.set(nid, nd);
	                q.push({ id: nid, d: nd });
	              }
	            }
	          }
	          return dist;
	        };

	        const upDist = bfs(currentRoot, (nid) => (outgoing.get(nid) || []).map(x => x.to), depth);
	        const downDist = bfs(currentRoot, (nid) => (incoming.get(nid) || []).map(x => x.from), depth);

	        const colById = new Map();
	        colById.set(id, 0);
	        for (const [nid, d] of upDist.entries()) {
	          if (nid === id) continue;
	          colById.set(nid, -d);
	        }
	        for (const [nid, d] of downDist.entries()) {
	          if (nid === id) continue;
	          if (!colById.has(nid)) colById.set(nid, d);
	        }

	        const cols = Array.from(new Set(Array.from(colById.values()))).sort((a, b) => a - b);
	        if (!cols.length) cols.push(0);
	        const minCol = Math.min(...cols);
	        const nodeW = 230;
	        const nodeH = 34;
	        const colGap = 130;
	        const rowGap = 14;
	        const padX = 30;
	        const padY = 26;

	        const colToIds = new Map();
	        for (const [nid, c] of colById.entries()) {
	          if (!colToIds.has(c)) colToIds.set(c, []);
	          colToIds.get(c).push(nid);
	        }
	        for (const [c, ids] of colToIds.entries()) {
	          ids.sort((a, b) => {
	            const na = nodeById.get(a) || {};
	            const nb = nodeById.get(b) || {};
	            const ta = Number.isFinite(na.tier) ? na.tier : 9;
	            const tb = Number.isFinite(nb.tier) ? nb.tier : 9;
	            if (ta !== tb) return ta - tb;
	            return String(na.label || a).localeCompare(String(nb.label || b));
	          });
	        }

	        const pos = new Map(); // id -> {x,y}
	        let maxRows = 0;
	        for (const c of cols) {
	          const ids = colToIds.get(c) || [];
	          maxRows = Math.max(maxRows, ids.length);
	          const x = padX + (c - minCol) * (nodeW + colGap);
	          ids.forEach((nid, idx) => {
	            const y = padY + idx * (nodeH + rowGap);
	            pos.set(nid, { x, y });
	          });
	        }

	        const width = padX * 2 + cols.length * nodeW + (cols.length - 1) * colGap;
	        const height = padY * 2 + maxRows * nodeH + Math.max(0, maxRows - 1) * rowGap;
	        svg.setAttribute('width', String(width));
	        svg.setAttribute('height', String(height));
	        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
	        svg.innerHTML = '';

	        const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

	        const edgeEls = edges
	          .map((e) => {
	            const from = String(e.from || '').trim();
	            const to = String(e.to || '').trim();
	            const pf = pos.get(from);
	            const pt = pos.get(to);
	            if (!pf || !pt) return '';
	            const x1 = pf.x + nodeW;
	            const y1 = pf.y + nodeH / 2;
	            const x2 = pt.x;
	            const y2 = pt.y + nodeH / 2;
	            const midX = (x1 + x2) / 2;
	            const c1x = midX;
	            const c1y = y1;
	            const c2x = midX;
	            const c2y = y2;
	            const stroke = e.satisfied ? '#2dbf71' : '#d15757';
	            return `<path d="M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}" fill="none" stroke="${stroke}" stroke-width="2" opacity="0.85" />`;
	          })
	          .join('');

	        const nodeEls = nodes
	          .filter((n) => pos.has(String(n.id)))
	          .map((n) => {
	            const nid = String(n.id);
	            const p = pos.get(nid);
	            const label = String(n.label || nid);
	            const tier = Number.isFinite(n.tier) ? `T${n.tier}` : '';
	            const done = n.doneAt ? '✅' : '';
	            const isRoot = nid === currentRoot;
	            const bg = isRoot ? '#2d6cdf' : (n.doneAt ? '#2b7a4b' : '#2b2b2b');
	            const text = isRoot ? '#fff' : '#fff';
	            const display = esc([done, tier, label].filter(Boolean).join(' '));
	            return `<g data-queue-jump="${esc(nid)}" style="cursor:pointer;">
	              <rect x="${p.x}" y="${p.y}" rx="8" ry="8" width="${nodeW}" height="${nodeH}" fill="${bg}" opacity="0.95"></rect>
	              <text x="${p.x + 10}" y="${p.y + 22}" fill="${text}" font-size="12" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial">${display}</text>
	            </g>`;
	          })
	          .join('');

	        svg.innerHTML = edgeEls + nodeEls;

	        svg.querySelectorAll('[data-queue-jump]').forEach((g) => {
	          g.addEventListener('click', (e) => {
	            e.preventDefault();
	            const targetId = g.getAttribute('data-queue-jump');
	            if (!targetId) return;
	            if (e.metaKey || e.ctrlKey) {
	              jumpTo(targetId);
	              return;
	            }
	            currentRoot = targetId;
	            fetchGraph().catch((err) => this.showToast(String(err?.message || err), 'error'));
	          });
	        });
	      };

	      const renderGraph = (graph) => {
	        lastGraph = graph;
	        const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
	        const edgesAll = Array.isArray(graph?.edges) ? graph.edges : [];
	        const edges = state.depGraphShowSatisfied ? edgesAll : edgesAll.filter(e => !e?.satisfied);
	        const nodeById = new Map(nodes.map((n) => [String(n.id), n]));

        const upAdj = new Map();   // id -> [{id, satisfied, reason}]
        const downAdj = new Map(); // id -> [{id, satisfied, reason}]
        for (const e of edges) {
          const from = String(e.from || '').trim();
          const to = String(e.to || '').trim();
          if (!from || !to) continue;
          if (!upAdj.has(from)) upAdj.set(from, []);
          upAdj.get(from).push({ id: to, satisfied: !!e.satisfied, reason: String(e.reason || '') });
          if (!downAdj.has(to)) downAdj.set(to, []);
          downAdj.get(to).push({ id: from, satisfied: !!e.satisfied, reason: String(e.reason || '') });
        }

        const walk = (startId, adj, remaining, visited) => {
          const id2 = String(startId || '').trim();
          if (!id2 || remaining <= 0) return '';
          const children = (adj.get(id2) || []).slice();
          if (!children.length) return '';
          const nextVisited = new Set(visited);
          nextVisited.add(id2);
          return `<ul style="margin: 8px 0 8px 18px; padding: 0;">
            ${children.map((c) => {
              const cid = String(c.id || '').trim();
              const node = nodeById.get(cid) || { label: cid, id: cid };
              const label = escapeHtml(node.label || cid);
              const icon = (adj === upAdj) ? (c.satisfied ? '✅' : '⛔') : (node.doneAt ? '✅' : '⛔');
              const reason = (adj === upAdj) ? (c.reason ? ` <span style="opacity:0.7">(${escapeHtml(c.reason)})</span>` : '') : '';
              const childTree = nextVisited.has(cid) ? '' : walk(cid, adj, remaining - 1, nextVisited);
              return `<li style="list-style:none; margin: 6px 0;">
                <a href="#" data-queue-jump="${escapeHtml(cid)}" style="color: inherit; text-decoration: none;">
                  ${icon} <code>${label}</code>${reason}
                </a>
                ${childTree}
              </li>`;
            }).join('')}
          </ul>`;
        };

	        const upEl = overlay.querySelector('#queue-dep-graph-up');
	        const downEl = overlay.querySelector('#queue-dep-graph-down');
	        if (upEl) upEl.innerHTML = walk(currentRoot, upAdj, depth, new Set()) || 'No dependencies.';
	        if (downEl) downEl.innerHTML = walk(currentRoot, downAdj, depth, new Set()) || 'No dependents.';

	        overlay.querySelectorAll('[data-queue-jump]').forEach((a) => {
	          a.addEventListener('click', (e) => {
	            e.preventDefault();
	            const targetId = a.getAttribute('data-queue-jump');
	            if (!targetId) return;
	            if (e.metaKey || e.ctrlKey) {
	              jumpTo(targetId);
	              return;
	            }
	            currentRoot = targetId;
	            fetchGraph().catch((err) => this.showToast(String(err?.message || err), 'error'));
	          });
	        });

	        updateToolbarMeta(graph);

	        if (state.depGraphView === 'graph') {
	          renderSvgGraph(graph);
	        }
	      };

	      const fetchGraph = async () => {
	        const url = new URL(`${serverUrl}/api/process/dependency-graph/${encodeURIComponent(currentRoot)}`);
	        url.searchParams.set('depth', String(depth));
	        const res = await fetch(url.toString());
	        const data = await res.json().catch(() => ({}));
	        if (!res.ok) throw new Error(data?.error || 'Failed to load graph');
	        renderGraph(data);
	      };

	      const viewEl = overlay.querySelector('#queue-dep-graph-view');
	      if (viewEl) {
	        viewEl.value = state.depGraphView || 'tree';
	        viewEl.addEventListener('change', () => setView(viewEl.value));
	      }
	      setView(state.depGraphView || 'tree');

	      const showSatisfiedEl = overlay.querySelector('#queue-dep-graph-show-satisfied');
	      if (showSatisfiedEl) {
	        showSatisfiedEl.checked = !!state.depGraphShowSatisfied;
	        showSatisfiedEl.addEventListener('change', () => {
	          state.depGraphShowSatisfied = !!showSatisfiedEl.checked;
	          localStorage.setItem('queue-dep-graph-show-satisfied', state.depGraphShowSatisfied ? 'true' : 'false');
	          if (lastGraph) renderGraph(lastGraph);
	        });
	      }

	      renderPins();
	      const pinsEl = overlay.querySelector('#queue-dep-graph-pins');
	      pinsEl?.addEventListener('change', () => {
	        const v = String(pinsEl.value || '').trim();
	        if (!v) return;
	        currentRoot = v;
	        pinsEl.value = '';
	        fetchGraph().catch((err) => this.showToast(String(err?.message || err), 'error'));
	      });

	      overlay.querySelector('#queue-dep-graph-pin')?.addEventListener('click', () => {
	        const pinned = pins.includes(currentRoot);
	        pins = pinned ? pins.filter(p => p !== currentRoot) : [...new Set([currentRoot, ...pins])];
	        savePins(pins);
	        renderPins();
	        updateToolbarMeta(lastGraph);
	      });

	      overlay.querySelector('#queue-dep-graph-jump')?.addEventListener('click', () => jumpTo(currentRoot));

	      overlay.querySelector('#queue-dep-graph-refresh')?.addEventListener('click', () => {
	        fetchGraph().catch((e) => this.showToast(String(e?.message || e), 'error'));
	      });

      await fetchGraph().catch((e) => this.showToast(String(e?.message || e), 'error'));
	    };

    const renderDetail = (t) => {
      if (!t) {
        detailEl.innerHTML = `<div class="tasks-detail-empty">Select an item to edit tier/risk or open it.</div>`;
        return;
      }

      const record = t.record || {};
      const tier = record.tier ?? '';
      const tierValue = tier === '' || tier === null || tier === undefined ? '' : String(tier);
      const changeRisk = record.changeRisk || '';
      const pFail = record.pFailFirstPass ?? '';
      const verify = record.verifyMinutes ?? '';
      const promptRef = record.promptRef || '';
      const doneAt = record.doneAt || '';
      const reviewedAt = record.reviewedAt || '';
      const reviewOutcome = record.reviewOutcome || '';
      const reviewStartedAt = record.reviewStartedAt || '';
      const reviewEndedAt = record.reviewEndedAt || '';
      const promptSentAt = record.promptSentAt || '';
      const promptChars = record.promptChars ?? '';
      const claimedBy = record.claimedBy || '';
      const claimedAt = record.claimedAt || '';
      const ticketProvider = record.ticketProvider || '';
      const ticketCardId = record.ticketCardId || '';
      const ticketCardUrl = record.ticketCardUrl || '';
      const notes = record.notes || '';

      const url = t.url || '';
      const hasPR = t.kind === 'pr' && url;

      const parseIso = (v) => {
        const ms = Date.parse(String(v || ''));
        return Number.isFinite(ms) ? ms : 0;
      };
      const formatDuration = (ms) => {
        const s = Math.max(0, Math.round(ms / 1000));
        const m = Math.floor(s / 60);
        const rem = s % 60;
        return m > 0 ? `${m}m ${rem}s` : `${rem}s`;
      };
      const nowMs = Date.now();
      const startedMs = parseIso(reviewStartedAt);
      const endedMs = parseIso(reviewEndedAt);
      const isTimerActive = state.reviewTimer?.taskId === t.id;
      const effectiveEndMs = isTimerActive ? nowMs : endedMs;
      const durationLabel = startedMs ? formatDuration((effectiveEndMs || nowMs) - startedMs) : '';
      const snoozedUntilMs = getSnoozeUntilMs(t.id);
      const isSnoozed = !!(snoozedUntilMs && nowMs < snoozedUntilMs);
      const snoozeUntilLabel = isSnoozed ? new Date(snoozedUntilMs).toLocaleString() : '';
      const snoozeCount = Number(state.snoozeCounts?.[String(t.id || '').trim()] || 0) || 0;
      const computeBackoffMs = (attempt) => {
        const a = Math.max(1, Number(attempt) || 1);
        // Tiered retries (safe backoff): 15m → 1h → 4h → 24h (cap)
        if (a <= 1) return 15 * 60 * 1000;
        if (a === 2) return 60 * 60 * 1000;
        if (a === 3) return 4 * 60 * 60 * 1000;
        return 24 * 60 * 60 * 1000;
      };
      const formatBackoff = (ms) => {
        const m = Math.round(ms / 60000);
        if (m < 60) return `${m}m`;
        const h = Math.round(m / 60);
        if (h < 24) return `${h}h`;
        const d = Math.round(h / 24);
        return `${d}d`;
      };
      const nextAutoSnoozeMs = computeBackoffMs(snoozeCount + 1);
      const nextAutoSnoozeLabel = formatBackoff(nextAutoSnoozeMs);

      detailEl.innerHTML = `
        <div class="tasks-detail-header">
          <div class="tasks-detail-title">
            <div class="pr-subtitle">${escapeHtml(t.title || t.id)}</div>
            <div class="tasks-detail-meta">${escapeHtml(t.id)}</div>
          </div>
          <div class="tasks-detail-actions">
            ${hasPR ? `<a class="btn-secondary" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">↗ GitHub</a>` : ''}
            ${hasPR ? `<button class="btn-secondary" id="queue-open-diff">🔍 Diff</button>` : ''}
            ${hasPR ? `<button class="btn-secondary" id="queue-spawn-reviewer" title="Start a reviewer agent in a clean worktree">🧑‍⚖️ Reviewer</button>` : ''}
            ${hasPR ? `<button class="btn-secondary" id="queue-spawn-fixer" title="Start a fixer agent for this PR (uses Notes)">🛠 Fixer</button>` : ''}
            ${hasPR ? `<button class="btn-secondary" id="queue-spawn-recheck" title="Spawn a reviewer agent to recheck after fixes">🔁 Recheck</button>` : ''}
          </div>
        </div>

        ${state.triageMode ? `
        <div class="tasks-detail-block">
          <div class="tasks-detail-block-title">Triage (safe backoff)</div>
          <div class="tasks-inline-row" style="gap:8px; flex-wrap:wrap;">
            <button class="btn-secondary" id="queue-snooze-auto" type="button" title="Escalates duration each time you auto-snooze this task">😴 Snooze ${escapeHtml(nextAutoSnoozeLabel)}</button>
            <button class="btn-secondary" id="queue-snooze-15m" type="button">😴 Snooze 15m</button>
            <button class="btn-secondary" id="queue-snooze-1h" type="button">😴 Snooze 1h</button>
            <button class="btn-secondary" id="queue-unsnooze" type="button" ${isSnoozed ? '' : 'disabled'}>🔔 Unsnooze</button>
            <span class="tasks-detail-meta" style="opacity:0.9;">${isSnoozed ? `snoozed until <strong>${escapeHtml(snoozeUntilLabel)}</strong>` : 'not snoozed'} • attempts: ${escapeHtml(String(snoozeCount))}</span>
          </div>
        </div>
        ` : ''}

        <div class="tasks-detail-block">
          <div class="tasks-detail-block-title">Tier + Risk</div>
          <div class="tasks-kv">
            <div class="tasks-kv-row tasks-kv-row-edit">
              <div class="tasks-kv-key">Tier</div>
              <div class="tasks-kv-val tasks-kv-val-edit">
                <select id="queue-tier" class="tasks-select tasks-select-inline">
                  <option value="">(none)</option>
                  <option value="1" ${tierValue === '1' ? 'selected' : ''}>Tier 1</option>
                  <option value="2" ${tierValue === '2' ? 'selected' : ''}>Tier 2</option>
                  <option value="3" ${tierValue === '3' ? 'selected' : ''}>Tier 3</option>
                  <option value="4" ${tierValue === '4' ? 'selected' : ''}>Tier 4</option>
                </select>
              </div>
            </div>
            <div class="tasks-kv-row tasks-kv-row-edit">
              <div class="tasks-kv-key">Change Risk</div>
              <div class="tasks-kv-val tasks-kv-val-edit">
                <select id="queue-change-risk" class="tasks-select tasks-select-inline">
                  <option value="">(none)</option>
                  <option value="low" ${changeRisk === 'low' ? 'selected' : ''}>low</option>
                  <option value="medium" ${changeRisk === 'medium' ? 'selected' : ''}>medium</option>
                  <option value="high" ${changeRisk === 'high' ? 'selected' : ''}>high</option>
                  <option value="critical" ${changeRisk === 'critical' ? 'selected' : ''}>critical</option>
                </select>
              </div>
            </div>
            <div class="tasks-kv-row tasks-kv-row-edit">
              <div class="tasks-kv-key">pFailFirstPass</div>
              <div class="tasks-kv-val tasks-kv-val-edit">
                <input id="queue-pfail" class="tasks-input tasks-input-inline" type="number" step="0.05" min="0" max="1" value="${escapeHtml(pFail)}" placeholder="0..1" style="width:120px;" />
              </div>
            </div>
	            <div class="tasks-kv-row tasks-kv-row-edit">
	              <div class="tasks-kv-key">Verify (min)</div>
	              <div class="tasks-kv-val tasks-kv-val-edit">
	                <input id="queue-verify" class="tasks-input tasks-input-inline" type="number" step="1" min="0" value="${escapeHtml(verify)}" placeholder="minutes" style="width:120px;" />
	              </div>
	            </div>
	            <div class="tasks-kv-row tasks-kv-row-edit">
	              <div class="tasks-kv-key">Done</div>
	              <div class="tasks-kv-val tasks-kv-val-edit">
	                <label style="display:flex;align-items:center;gap:8px;">
	                  <input id="queue-done" type="checkbox" ${doneAt ? 'checked' : ''} />
	                  <span class="tasks-detail-meta">${doneAt ? `doneAt: ${escapeHtml(doneAt)}` : 'not done'}</span>
	                </label>
	              </div>
	            </div>
	            <div class="tasks-kv-row tasks-kv-row-edit">
	              <div class="tasks-kv-key">Reviewed</div>
	              <div class="tasks-kv-val tasks-kv-val-edit">
	                <label style="display:flex;align-items:center;gap:8px;">
	                  <input id="queue-reviewed" type="checkbox" ${reviewedAt ? 'checked' : ''} />
	                  <span class="tasks-detail-meta">${reviewedAt ? `reviewedAt: ${escapeHtml(reviewedAt)}` : 'not reviewed'}</span>
	                </label>
	              </div>
	            </div>
	            <div class="tasks-kv-row tasks-kv-row-edit">
	              <div class="tasks-kv-key">Outcome</div>
	              <div class="tasks-kv-val tasks-kv-val-edit">
	                <select id="queue-review-outcome" class="tasks-select tasks-select-inline" style="width:180px;">
	                  <option value="">(none)</option>
	                  <option value="approved" ${reviewOutcome === 'approved' ? 'selected' : ''}>approved</option>
	                  <option value="needs_fix" ${reviewOutcome === 'needs_fix' ? 'selected' : ''}>needs_fix</option>
	                  <option value="commented" ${reviewOutcome === 'commented' ? 'selected' : ''}>commented</option>
	                  <option value="skipped" ${reviewOutcome === 'skipped' ? 'selected' : ''}>skipped</option>
	                </select>
	              </div>
	            </div>
	          </div>
	        </div>

	        <div class="tasks-detail-block">
	          <div class="tasks-detail-block-title">Claim</div>
	          <div class="tasks-inline-row" style="gap:8px; flex-wrap:wrap;">
	            <span class="tasks-detail-meta" id="queue-claim-meta">
	              ${claimedBy ? `claimedBy: <code>${escapeHtml(claimedBy)}</code>${claimedAt ? ` • <span>${escapeHtml(claimedAt)}</span>` : ''}` : 'unclaimed'}
	            </span>
	            <span style="flex:1"></span>
	            <button class="btn-secondary" id="queue-claim" ${claimedBy ? 'disabled' : ''} title="Claim this item for review">🔒 Claim</button>
	            <button class="btn-secondary" id="queue-release" ${claimedBy ? '' : 'disabled'} title="Release claim">🔓 Release</button>
	          </div>
	        </div>

	        <div class="tasks-detail-block">
	          <div class="tasks-detail-block-title">Prompt Artifact</div>
	          <div class="tasks-inline-row">
	            <input id="queue-prompt-ref" class="tasks-input" value="${escapeHtml(promptRef)}" placeholder="e.g. pr:web3dev1337/repo#123" />
	            <button class="btn-secondary" id="queue-open-prompt">📝 Open</button>
	          </div>
	          <div class="tasks-detail-meta">Saved locally in <code>~/.orchestrator/prompts</code>.</div>
	        </div>

	        ${(hasPR || ticketCardId || ticketCardUrl) ? `
	        <div class="tasks-detail-block">
	          <div class="tasks-detail-block-title">Ticket (Trello)</div>
	          <div class="tasks-inline-row">
	            <input id="queue-ticket" class="tasks-input" value="${escapeHtml(ticketCardUrl || ticketCardId)}" placeholder="Paste Trello card URL or trello:<shortLink>" />
	            <button class="btn-secondary" id="queue-ticket-open" ${ticketCardId || ticketCardUrl ? '' : 'disabled'} title="Open card in Trello">↗ Open</button>
	          </div>
	          <div class="tasks-detail-meta">PR-merge automation can auto-move/comment when enabled in settings.</div>
	        </div>
	        ` : ''}

	        <div class="tasks-detail-block">
	          <div class="tasks-detail-block-title">Notes / Fix Request</div>
	          <textarea id="queue-notes" class="tasks-textarea" rows="5" placeholder="Reviewer feedback / fix request (used by Fixer automation)…">${escapeHtml(notes)}</textarea>
	          <div class="tasks-detail-meta">Tip: set Outcome to <code>needs_fix</code> and paste review feedback here, then click <strong>🛠 Fixer</strong>.</div>
	        </div>

	        <div class="tasks-detail-block">
	          <div class="tasks-detail-block-title">Telemetry</div>
	          <div class="tasks-kv">
	            <div class="tasks-kv-row">
	              <div class="tasks-kv-key">Review timer</div>
	              <div class="tasks-kv-val">
	                <span class="tasks-detail-meta">${durationLabel ? escapeHtml(durationLabel) : '—'}</span>
	              </div>
	            </div>
	            <div class="tasks-kv-row">
	              <div class="tasks-kv-key">Review started</div>
	              <div class="tasks-kv-val"><span class="tasks-detail-meta">${reviewStartedAt ? escapeHtml(reviewStartedAt) : '—'}</span></div>
	            </div>
	            <div class="tasks-kv-row">
	              <div class="tasks-kv-key">Review ended</div>
	              <div class="tasks-kv-val"><span class="tasks-detail-meta">${reviewEndedAt ? escapeHtml(reviewEndedAt) : (isTimerActive ? 'running…' : '—')}</span></div>
	            </div>
	            <div class="tasks-kv-row">
	              <div class="tasks-kv-key">Prompt sent</div>
	              <div class="tasks-kv-val"><span class="tasks-detail-meta">${promptSentAt ? escapeHtml(promptSentAt) : '—'}</span></div>
	            </div>
	            <div class="tasks-kv-row">
	              <div class="tasks-kv-key">Prompt chars</div>
	              <div class="tasks-kv-val"><span class="tasks-detail-meta">${promptChars !== '' ? escapeHtml(promptChars) : '—'}</span></div>
	            </div>
	          </div>
	          <div class="tasks-inline-row" style="margin-top: 10px;">
	            <button class="btn-secondary" id="queue-review-timer-start" ${state.reviewActive ? '' : 'disabled'}>⏱ Start</button>
	            <button class="btn-secondary" id="queue-review-timer-stop" ${state.reviewTimer?.taskId === t.id ? '' : 'disabled'}>⏹ Stop</button>
	            ${state.reviewActive ? '' : `<span class="tasks-detail-meta">Enable “Start Review” to auto-time items.</span>`}
	          </div>
	        </div>

		        <div class="tasks-detail-block" id="queue-dep-dropzone">
		          <div class="tasks-detail-block-title">Dependencies</div>
		          <div class="tasks-inline-row" style="margin-bottom: 10px; gap: 8px;">
		            <button class="btn-secondary" id="queue-dep-graph" title="View dependency graph">🧩 Graph</button>
		            <select id="queue-dep-graph-depth" class="tasks-select tasks-select-inline" title="Graph depth" style="width: 140px;">
		              ${[1,2,3,4,5,6].map((d) => `<option value="${d}" ${Number(state.depGraphDepth) === d ? 'selected' : ''}>depth ${d}</option>`).join('')}
		            </select>
		          </div>
		          ${ticketCardId ? `
		          <div class="tasks-inline-row" style="margin-bottom: 10px; gap: 8px;">
		            <button class="btn-secondary" id="queue-dep-import-ticket" title="Import Trello card Dependencies checklist into this task record">⬇ Import ticket deps</button>
		            <span class="tasks-detail-meta" style="opacity:0.85;">Adds <code>trello:&lt;shortLink&gt;</code> items from the card “Dependencies” checklist.</span>
		          </div>
		          ` : ''}
		          <div class="tasks-inline-row" style="margin-bottom: 10px;">
		            <select id="queue-dep-pick" class="tasks-select" title="Pick from queue" style="flex:1;min-width:0;">
		              <option value="">Pick from queue…</option>
		            </select>
		            <button class="btn-secondary" id="queue-dep-pick-add" title="Add selected dependency">➕ Add</button>
		          </div>
		          <div class="tasks-inline-row" style="margin-bottom: 10px;">
		            <input id="queue-dep-add" class="tasks-input" list="queue-dep-suggest" placeholder="Add dependency id(s) (comma/newline separated) e.g. pr:owner/repo#123" />
		            <button class="btn-secondary" id="queue-dep-add-btn">➕ Add</button>
		          </div>
		          <datalist id="queue-dep-suggest"></datalist>
		          <div id="queue-deps" class="tasks-detail-meta">Loading…</div>
		        </div>

	        <div class="tasks-detail-block">
	          <div class="tasks-detail-block-title">Dependents</div>
	          <div id="queue-reverse-deps" class="tasks-detail-meta">Loading…</div>
	        </div>
	      `;

      const tierEl = detailEl.querySelector('#queue-tier');
      const riskEl = detailEl.querySelector('#queue-change-risk');
      const pfEl = detailEl.querySelector('#queue-pfail');
      const vEl = detailEl.querySelector('#queue-verify');
      const prEl = detailEl.querySelector('#queue-prompt-ref');
      const claimMetaEl = detailEl.querySelector('#queue-claim-meta');
      const claimBtn = detailEl.querySelector('#queue-claim');
      const releaseBtn = detailEl.querySelector('#queue-release');
      const ticketEl = detailEl.querySelector('#queue-ticket');
      const ticketOpenBtn = detailEl.querySelector('#queue-ticket-open');
      const doneEl = detailEl.querySelector('#queue-done');
      const reviewedEl = detailEl.querySelector('#queue-reviewed');
      const outcomeEl = detailEl.querySelector('#queue-review-outcome');
      const openPromptBtn = detailEl.querySelector('#queue-open-prompt');
      const openDiffBtn = detailEl.querySelector('#queue-open-diff');
      const spawnReviewerBtn = detailEl.querySelector('#queue-spawn-reviewer');
      const spawnFixerBtn = detailEl.querySelector('#queue-spawn-fixer');
      const spawnRecheckBtn = detailEl.querySelector('#queue-spawn-recheck');
      const timerStartBtn = detailEl.querySelector('#queue-review-timer-start');
      const timerStopBtn = detailEl.querySelector('#queue-review-timer-stop');
      const notesEl = detailEl.querySelector('#queue-notes');
      const snoozeAutoBtn = detailEl.querySelector('#queue-snooze-auto');
      const snooze15Btn = detailEl.querySelector('#queue-snooze-15m');
      const snooze1hBtn = detailEl.querySelector('#queue-snooze-1h');
      const unsnoozeBtn = detailEl.querySelector('#queue-unsnooze');
      const depsEl = detailEl.querySelector('#queue-deps');
      const reverseDepsEl = detailEl.querySelector('#queue-reverse-deps');
      const depGraphBtn = detailEl.querySelector('#queue-dep-graph');
      const depGraphDepthEl = detailEl.querySelector('#queue-dep-graph-depth');
	      const depPickEl = detailEl.querySelector('#queue-dep-pick');
	      const depPickAddBtn = detailEl.querySelector('#queue-dep-pick-add');
		      const depAddEl = detailEl.querySelector('#queue-dep-add');
		      const depAddBtn = detailEl.querySelector('#queue-dep-add-btn');
		      const depSuggestEl = detailEl.querySelector('#queue-dep-suggest');
		      const depImportTicketBtn = detailEl.querySelector('#queue-dep-import-ticket');
		      const depDropzoneEl = detailEl.querySelector('#queue-dep-dropzone');

	      const parseTrelloTicket = (raw) => {
        const s = String(raw || '').trim();
        if (!s) return null;
        const mUrl = s.match(/https?:\/\/trello\.com\/c\/([a-zA-Z0-9]+)(?:\/|\b)/i);
        if (mUrl && mUrl[1]) return { provider: 'trello', cardId: String(mUrl[1]), cardUrl: s };
        const mTag = s.match(/^trello:([a-zA-Z0-9]+)$/i);
        if (mTag && mTag[1]) return { provider: 'trello', cardId: String(mTag[1]), cardUrl: `https://trello.com/c/${String(mTag[1])}` };
        // Assume raw is a shortLink-ish token.
        if (/^[a-zA-Z0-9]{6,}$/.test(s)) return { provider: 'trello', cardId: s, cardUrl: `https://trello.com/c/${s}` };
        return null;
      };

      const getClaimName = () => {
        const fromSettings = String(this.userSettings?.global?.ui?.tasks?.me?.trelloUsername || '').trim();
        const fromStorage = String(localStorage.getItem('orchestrator-claim-name') || '').trim();
        return fromSettings || fromStorage || 'me';
      };

      const applyClaimUI = (rec) => {
        const by = String(rec?.claimedBy || '').trim();
        const at = String(rec?.claimedAt || '').trim();
        if (claimMetaEl) {
          claimMetaEl.innerHTML = by
            ? `claimedBy: <code>${escapeHtml(by)}</code>${at ? ` • <span>${escapeHtml(at)}</span>` : ''}`
            : 'unclaimed';
        }
        if (claimBtn) claimBtn.disabled = !!by;
        if (releaseBtn) releaseBtn.disabled = !by;
      };

	      applyClaimUI(record);

      const applySnooze = (msFromNow, { incrementCount = false } = {}) => {
          const id = String(t?.id || '').trim();
          if (!id) return;
          const until = Date.now() + Math.max(1, Number(msFromNow) || 0);
          const next = { ...(state.snoozes || {}) };
          next[id] = until;
          saveSnoozes(next);

          if (incrementCount) {
            const counts = { ...(state.snoozeCounts || {}) };
            counts[id] = Number(counts?.[id] || 0) + 1;
            saveSnoozeCounts(counts);
          }

          renderList();
          if (state.selectedId === id) {
            // If the current item was snoozed, move to next visible item (best-effort).
            const ordered = getOrderedTasks(getFilteredTasks());
            state.selectedId = ordered[0]?.id || null;
            renderList();
            renderDetail(getTaskById(state.selectedId));
          }
        };

      const clearSnooze = () => {
          const id = String(t?.id || '').trim();
          if (!id) return;
          const next = { ...(state.snoozes || {}) };
          delete next[id];
          saveSnoozes(next);
          renderList();
          if (state.selectedId) renderDetail(getTaskById(state.selectedId));
        };

        snoozeAutoBtn?.addEventListener('click', () => {
          const id = String(t?.id || '').trim();
          if (!id) return;
          const prev = Number(state.snoozeCounts?.[id] || 0) || 0;
          let ms = 15 * 60 * 1000;
          if (prev >= 1) ms = 60 * 60 * 1000;
          if (prev >= 2) ms = 4 * 60 * 60 * 1000;
          if (prev >= 3) ms = 24 * 60 * 60 * 1000;
          applySnooze(ms, { incrementCount: true });
        });
        snooze15Btn?.addEventListener('click', () => applySnooze(15 * 60 * 1000));
        snooze1hBtn?.addEventListener('click', () => applySnooze(60 * 60 * 1000));
        unsnoozeBtn?.addEventListener('click', () => clearSnooze());

	      let depSelection = new Set();

	      const renderReverseDeps = () => {
	        if (!reverseDepsEl) return;

        const id = String(t?.id || '').trim();
        if (!id) {
          reverseDepsEl.textContent = 'No dependents.';
          return;
        }

        const dependents = (Array.isArray(state.tasks) ? state.tasks : []).filter((other) => {
          if (!other || other.id === id) return false;
          const deps = other?.record?.dependencies;
          if (!Array.isArray(deps) || deps.length === 0) return false;
          return deps.some((d) => String(d || '').trim() === id);
        });

        if (!dependents.length) {
          reverseDepsEl.textContent = 'No dependents.';
          return;
        }

        reverseDepsEl.innerHTML = dependents.map((dep) => {
          const title = escapeHtml(dep.title || dep.id || '');
          const kind = escapeHtml(dep.kind || '');
          const tier = dep?.record?.tier ? `T${dep.record.tier}` : '';
          const meta = [kind, tier].filter(Boolean).join(' • ');
          return `
            <div class="task-card-row" data-queue-jump="${escapeHtml(dep.id)}" style="margin:6px 0;cursor:pointer;">
              <div class="task-card-title">${title}</div>
              ${meta ? `<div class="task-card-meta" style="opacity:0.8;">${meta}</div>` : ''}
            </div>
          `;
        }).join('');

        reverseDepsEl.querySelectorAll('[data-queue-jump]').forEach((row) => {
          row.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = row.getAttribute('data-queue-jump');
            if (!targetId) return;
            state.selectedId = targetId;
            renderList();
            renderDetail(getTaskById(targetId));
          });
        });
      };

	      const loadDeps = async () => {
	        if (!depsEl) return;
	        try {
	          const res = await fetch(`${serverUrl}/api/process/task-records/${encodeURIComponent(t.id)}/dependencies`);
	          const data = await res.json().catch(() => ({}));
	          if (!res.ok) throw new Error(data?.error || 'Failed to load dependencies');
	          const deps = Array.isArray(data.dependencies) ? data.dependencies : [];
	          if (!deps.length) {
	            depsEl.innerHTML = 'No dependencies. <span style="opacity:0.8;">Tip: drag items from Queue into this box.</span>';
	            return;
	          }

	          const escAttr = (v) => escapeHtml(v).replace(/\"/g, '&quot;');
	          const anySelected = deps.some((d) => depSelection.has(String(d?.id || '')));
	          const allSelected = deps.length > 0 && deps.every((d) => depSelection.has(String(d?.id || '')));

	          depsEl.innerHTML = `
	            <div class="tasks-inline-row" style="margin: 0 0 10px 0; gap:8px; flex-wrap:wrap;">
	              <button class="btn-secondary" id="queue-dep-remove-selected" ${anySelected ? '' : 'disabled'} title="Remove checked dependencies">🗑 Remove selected</button>
	              <button class="btn-secondary" id="queue-dep-select-all" title="Toggle selection">${allSelected ? 'Clear selection' : 'Select all'}</button>
	              <span class="tasks-detail-meta" style="opacity:0.8;">Tip: drag items from Queue into this box.</span>
	            </div>
	            ${deps.map((d) => {
	              const status = d.satisfied ? '✅' : '⛔';
	              const reason = escapeHtml(d.reason || '');
	              const idRaw = String(d.id || '');
	              const id = escapeHtml(idRaw);
	              const idAttr = escAttr(idRaw);
	              const checked = depSelection.has(idRaw) ? 'checked' : '';
	              return `<div style="display:flex;gap:10px;align-items:center;justify-content:space-between;margin:6px 0;">
	                <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1;">
	                  <input type="checkbox" class="queue-dep-check" data-dep="${idAttr}" ${checked} />
	                  <div style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${status} <code>${id}</code> <span style="opacity:0.75">${reason ? `(${reason})` : ''}</span></div>
	                </div>
	                <button class="btn-secondary queue-dep-remove" data-dep="${idAttr}" title="Remove">✕</button>
	              </div>`;
	            }).join('')}
	          `;

	          const removeSelectedBtn = depsEl.querySelector('#queue-dep-remove-selected');
	          const selectAllBtn = depsEl.querySelector('#queue-dep-select-all');
	          const updateBulkUI = () => {
	            const any = deps.some((d) => depSelection.has(String(d?.id || '')));
	            const all = deps.length > 0 && deps.every((d) => depSelection.has(String(d?.id || '')));
	            if (removeSelectedBtn) removeSelectedBtn.disabled = !any;
	            if (selectAllBtn) selectAllBtn.textContent = all ? 'Clear selection' : 'Select all';
	          };

	          depsEl.querySelectorAll('.queue-dep-check').forEach((cb) => {
	            cb.addEventListener('change', () => {
	              const dep = cb.getAttribute('data-dep') || '';
	              if (!dep) return;
	              if (cb.checked) depSelection.add(dep);
	              else depSelection.delete(dep);
	              updateBulkUI();
	            });
	          });

	          selectAllBtn?.addEventListener('click', (e) => {
	            e.preventDefault();
	            const all = deps.length > 0 && deps.every((d) => depSelection.has(String(d?.id || '')));
	            if (all) depSelection = new Set();
	            else depSelection = new Set(deps.map(d => String(d?.id || '')).filter(Boolean));
	            loadDeps().catch(() => {});
	          });

	          removeSelectedBtn?.addEventListener('click', async (e) => {
	            e.preventDefault();
	            const selected = deps.filter(d => depSelection.has(String(d?.id || ''))).map(d => String(d?.id || '')).filter(Boolean);
	            if (!selected.length) return;
	            removeSelectedBtn.disabled = true;
	            try {
	              for (const dep of selected) {
	                // eslint-disable-next-line no-await-in-loop
	                const del = await fetch(`${serverUrl}/api/process/task-records/${encodeURIComponent(t.id)}/dependencies/${encodeURIComponent(dep)}`, { method: 'DELETE' });
	                const delData = await del.json().catch(() => ({}));
	                if (!del.ok) throw new Error(delData?.error || `Failed to remove dependency: ${dep}`);
	              }
	              depSelection = new Set();
	              await fetchTasks();
	              await loadDeps();
	              renderReverseDeps();
	            } catch (err) {
	              this.showToast(String(err?.message || err), 'error');
	            } finally {
	              removeSelectedBtn.disabled = false;
	            }
	          });

	          depsEl.querySelectorAll('.queue-dep-remove').forEach((btn) => {
	            btn.addEventListener('click', async (e) => {
	              e.preventDefault();
	              const dep = btn.getAttribute('data-dep');
	              if (!dep) return;
	              const del = await fetch(`${serverUrl}/api/process/task-records/${encodeURIComponent(t.id)}/dependencies/${encodeURIComponent(dep)}`, { method: 'DELETE' });
	              const delData = await del.json().catch(() => ({}));
	              if (!del.ok) throw new Error(delData?.error || 'Failed to remove dependency');
	              await fetchTasks();
	              await loadDeps();
	              renderReverseDeps();
	            });
	          });
	        } catch (e) {
	          depsEl.textContent = String(e?.message || e);
	        }
	      };

      const savePatch = async () => {
        try {
          let ticketPatch = {};
          if (ticketEl) {
            const v = String(ticketEl.value || '').trim();
            if (!v) {
              ticketPatch = { ticketProvider: null, ticketCardId: null, ticketCardUrl: null, ticketBoardId: null };
            } else {
              const parsed = parseTrelloTicket(v);
              if (!parsed) throw new Error('Invalid ticket format (paste a Trello URL or trello:<shortLink>)');
              ticketPatch = { ticketProvider: parsed.provider, ticketCardId: parsed.cardId, ticketCardUrl: parsed.cardUrl || null };
            }
          }

          const patch = {
            tier: tierEl?.value ? Number(tierEl.value) : null,
            changeRisk: riskEl?.value || null,
            pFailFirstPass: pfEl?.value === '' ? null : Number(pfEl.value),
            verifyMinutes: vEl?.value === '' ? null : Number(vEl.value),
            promptRef: prEl?.value || null,
            ...ticketPatch
          };
	          const rec = await upsertRecord(t.id, patch);
	          updateTaskRecordInState(t.id, rec);
	          this.showToast('Saved', 'success');
	          applyClaimUI(rec);
	          renderList();
	          this.buildSidebar();
	          this.updateTerminalGrid();
	        } catch (e) {
	          this.showToast(String(e?.message || e), 'error');
	        }
	      };

	      const normalizeDependencyId = (raw) => {
	        const s = String(raw || '').trim();
	        if (!s) return '';
	        const mUrl = s.match(/https?:\/\/trello\.com\/c\/([a-zA-Z0-9]+)(?:\/|\b)/i);
	        if (mUrl?.[1]) return `trello:${String(mUrl[1])}`;
	        const mTag = s.match(/^trello:([a-zA-Z0-9]+)$/i);
	        if (mTag?.[1]) return `trello:${String(mTag[1])}`;
	        return s;
	      };

	      const splitDependencyIds = (raw) => {
	        const text = String(raw || '');
	        return text
	          .split(/[\n,]+/g)
	          .map(s => normalizeDependencyId(s))
	          .map(s => String(s || '').trim())
	          .filter(Boolean);
	      };

	      const addDependenciesBulk = async (ids) => {
	        const list = [...new Set((Array.isArray(ids) ? ids : []).map(normalizeDependencyId).filter(Boolean))];
	        if (!list.length) return;
	        for (const depId of list) {
	          const res = await fetch(`${serverUrl}/api/process/task-records/${encodeURIComponent(t.id)}/dependencies`, {
	            method: 'POST',
	            headers: { 'Content-Type': 'application/json' },
	            body: JSON.stringify({ dependencyId: depId })
	          });
	          const data = await res.json().catch(() => ({}));
	          if (!res.ok) throw new Error(data?.error || `Failed to add dependency: ${depId}`);
	        }
	        await fetchTasks();
	        await loadDeps();
	        renderReverseDeps();
	      };

      [tierEl, riskEl, pfEl, vEl, prEl].forEach((el) => {
        el?.addEventListener('change', () => savePatch());
        el?.addEventListener('blur', () => savePatch());
      });

      if (ticketEl) {
        ticketEl.addEventListener('change', () => savePatch());
        ticketEl.addEventListener('blur', () => savePatch());
      }

      if (ticketOpenBtn && ticketEl) {
        const openTicket = () => {
          const parsed = parseTrelloTicket(ticketEl.value);
          const url2 = parsed?.cardUrl || (String(ticketCardUrl || '').trim() || (ticketCardId ? `https://trello.com/c/${ticketCardId}` : ''));
          if (url2) window.open(url2, '_blank', 'noreferrer');
        };
        ticketOpenBtn.addEventListener('click', (e) => {
          e.preventDefault();
          openTicket();
        });
      }

      claimBtn?.addEventListener('click', async () => {
        try {
          claimBtn.disabled = true;
          const who = getClaimName();
          const rec = await upsertRecord(t.id, { claimedBy: who, claimedAt: new Date().toISOString() });
          updateTaskRecordInState(t.id, rec);
          applyClaimUI(rec);
          renderList();
        } catch (e) {
          this.showToast(String(e?.message || e), 'error');
        } finally {
          if (claimBtn) claimBtn.disabled = !!(getTaskById(t.id)?.record?.claimedBy);
        }
      });

      releaseBtn?.addEventListener('click', async () => {
        try {
          releaseBtn.disabled = true;
          const rec = await upsertRecord(t.id, { claimedBy: null, claimedAt: null });
          updateTaskRecordInState(t.id, rec);
          applyClaimUI(rec);
          renderList();
        } catch (e) {
          this.showToast(String(e?.message || e), 'error');
        } finally {
          if (releaseBtn) releaseBtn.disabled = !getTaskById(t.id)?.record?.claimedBy;
        }
      });

      const saveNotes = async () => {
        if (!notesEl) return;
        try {
          const rec = await upsertRecord(t.id, { notes: String(notesEl.value || '') });
          updateTaskRecordInState(t.id, rec);
          renderList();
        } catch (e) {
          this.showToast(String(e?.message || e), 'error');
        }
      };

      notesEl?.addEventListener('change', saveNotes);
      notesEl?.addEventListener('blur', saveNotes);

      doneEl?.addEventListener('change', async () => {
        try {
          const rec = await upsertRecord(t.id, { done: !!doneEl.checked });
          updateTaskRecordInState(t.id, rec);
          await fetchTasks();
          await loadDeps();
        } catch (e) {
          this.showToast(String(e?.message || e), 'error');
        }
      });

      // Dependency graph controls
      if (depGraphDepthEl) {
        depGraphDepthEl.value = String(state.depGraphDepth || 2);
        depGraphDepthEl.addEventListener('change', () => {
          const next = Math.max(1, Math.min(6, Number(depGraphDepthEl.value) || 2));
          state.depGraphDepth = next;
          localStorage.setItem('queue-dep-graph-depth', String(next));
        });
      }

      depGraphBtn?.addEventListener('click', async () => {
        try {
          depGraphBtn.disabled = true;
          await openDependencyGraphModal(t.id);
        } catch (e) {
          this.showToast(String(e?.message || e), 'error');
        } finally {
          depGraphBtn.disabled = false;
        }
      });

	      // Quick dependency pick from current queue
	      if (depPickEl) {
	        const options = (Array.isArray(state.tasks) ? state.tasks : [])
	          .filter((other) => other && other.id && other.id !== t.id)
	          .map((other) => {
	            const id = String(other.id);
	            const title = other.title ? String(other.title) : id;
	            const kind = other.kind ? String(other.kind) : '';
	            const tier = other?.record?.tier ? `T${other.record.tier}` : '';
	            const label = [title, kind ? `(${kind})` : '', tier].filter(Boolean).join(' ');
	            return { id, label };
	          });

	        depPickEl.innerHTML = `<option value="">Pick from queue…</option>`
	          + options.map((o) => `<option value="${escapeHtml(o.id)}">${escapeHtml(o.label)}</option>`).join('');

	        if (depSuggestEl) {
	          depSuggestEl.innerHTML = options.map((o) => `<option value="${escapeHtml(o.id)}">${escapeHtml(o.label)}</option>`).join('');
	        }
	      }

	      depPickAddBtn?.addEventListener('click', async () => {
	        try {
	          const depId = String(depPickEl?.value || '').trim();
	          if (!depId) return;
	          depPickAddBtn.disabled = true;
	          await addDependenciesBulk([depId]);
	          if (depPickEl) depPickEl.value = '';
	        } catch (e) {
	          this.showToast(String(e?.message || e), 'error');
	        } finally {
	          depPickAddBtn.disabled = false;
	        }
	      });

	      depAddBtn?.addEventListener('click', async () => {
	        try {
	          const depIds = splitDependencyIds(depAddEl?.value || '');
	          if (!depIds.length) return;
	          depAddBtn.disabled = true;
	          await addDependenciesBulk(depIds);
	          depAddEl.value = '';
	        } catch (e) {
	          this.showToast(String(e?.message || e), 'error');
	        } finally {
	          depAddBtn.disabled = false;
	        }
	      });

	      depAddEl?.addEventListener('keydown', (e) => {
	        if (e.key === 'Enter') {
	          e.preventDefault();
	          depAddBtn?.click();
	        }
	      });

		      depImportTicketBtn?.addEventListener('click', async () => {
		        try {
		          if (!ticketCardId) return;
		          depImportTicketBtn.disabled = true;
              let ticketBoardId = '';
              try {
                const cardRes = await fetch(`${serverUrl}/api/tasks/cards/${encodeURIComponent(ticketCardId)}?provider=trello`);
                const cardData = await cardRes.json().catch(() => ({}));
                if (cardRes.ok) {
                  ticketBoardId = String(cardData?.card?.idBoard || '').trim();
                }
              } catch {
                // ignore
              }

              const conventionsAll = this.userSettings?.global?.ui?.tasks?.boardConventions;
              const conventions = conventionsAll && typeof conventionsAll === 'object' && !Array.isArray(conventionsAll) ? conventionsAll : {};
              const key = ticketBoardId ? `trello:${ticketBoardId}` : '';
              const checklistName = key ? String(conventions?.[key]?.dependencyChecklistName || '').trim() : '';

              const depsUrl = new URL(`${serverUrl}/api/tasks/cards/${encodeURIComponent(ticketCardId)}/dependencies`);
              depsUrl.searchParams.set('provider', 'trello');
              if (checklistName) depsUrl.searchParams.set('checklistName', checklistName);
		          const res = await fetch(depsUrl.toString());
	          const data = await res.json().catch(() => ({}));
	          if (!res.ok) throw new Error(data?.error || 'Failed to load ticket dependencies');
	          const items = Array.isArray(data?.dependencies?.items) ? data.dependencies.items : [];
	          const depIds = items.map((i) => i?.shortLink ? `trello:${String(i.shortLink)}` : String(i?.url || i?.name || '').trim()).filter(Boolean);
	          if (!depIds.length) {
	            this.showToast('No ticket dependencies found.', 'info');
	            return;
	          }
	          await addDependenciesBulk(depIds);
	          this.showToast(`Imported ${depIds.length} dependency(s).`, 'success');
	        } catch (e) {
	          this.showToast(String(e?.message || e), 'error');
		        } finally {
		          depImportTicketBtn.disabled = false;
		        }
		      });

		      // Drag/drop linking: drop queue ids (or Trello URLs) onto Dependencies block.
		      if (depDropzoneEl) {
		        depDropzoneEl.addEventListener('dragover', (e) => {
		          e.preventDefault();
		          depDropzoneEl.classList.add('tasks-dropzone-hover');
		        });
		        depDropzoneEl.addEventListener('dragleave', () => depDropzoneEl.classList.remove('tasks-dropzone-hover'));
		        depDropzoneEl.addEventListener('drop', async (e) => {
		          e.preventDefault();
		          depDropzoneEl.classList.remove('tasks-dropzone-hover');
		          const raw = String(e.dataTransfer?.getData('text/plain') || '').trim();
		          const ids = splitDependencyIds(raw);
		          if (!ids.length) return;
		          try {
		            await addDependenciesBulk(ids);
		            this.showToast(`Added ${ids.length} dependency(s).`, 'success');
		          } catch (err) {
		            this.showToast(String(err?.message || err), 'error');
		          }
		        });
		      }

		      openPromptBtn?.addEventListener('click', async () => {
		        const pid = (prEl?.value || t.id).trim();
		        await openPromptEditor(pid, { task: t });
	      });

      openDiffBtn?.addEventListener('click', async () => {
        try {
          if (!url) return;
          const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
          if (!m) {
            window.open(url, '_blank', 'noreferrer');
            return;
          }
          const [, owner, repo, prNum] = m;
          const diffUrl = `${serverUrl.replace(/:\\d+$/, '')}:7655/pr/${owner}/${repo}/${prNum}`;
          window.open(diffUrl, 'orchestrator_diff', 'noreferrer');
        } catch {
          window.open(url, '_blank', 'noreferrer');
        }
      });

      spawnReviewerBtn?.addEventListener('click', async () => {
        try {
          spawnReviewerBtn.disabled = true;
          await this.spawnReviewAgentForPRTask(t, { tier: 3, agentId: 'claude', mode: 'fresh', yolo: true });
        } catch (e) {
          this.showToast(String(e?.message || e), 'error');
        } finally {
          spawnReviewerBtn.disabled = false;
        }
      });

      spawnFixerBtn?.addEventListener('click', async () => {
        try {
          spawnFixerBtn.disabled = true;
          const info = await this.spawnFixAgentForPRTask(t, { tier: 2, agentId: 'claude', mode: 'fresh', yolo: true, notes: String(notesEl?.value || '') });
          if (info) {
            const rec = await upsertRecord(t.id, {
              fixerSpawnedAt: new Date().toISOString(),
              fixerWorktreeId: info.worktreeId || null
            });
            updateTaskRecordInState(t.id, rec);
            renderList();
            renderDetail(getTaskById(t.id));
          }
        } catch (e) {
          this.showToast(String(e?.message || e), 'error');
        } finally {
          spawnFixerBtn.disabled = false;
        }
      });

      spawnRecheckBtn?.addEventListener('click', async () => {
        try {
          spawnRecheckBtn.disabled = true;
          const info = await this.spawnReviewAgentForPRTask(t, { tier: 3, agentId: 'claude', mode: 'fresh', yolo: true });
          if (info) {
            const rec = await upsertRecord(t.id, {
              recheckSpawnedAt: new Date().toISOString(),
              recheckWorktreeId: info.worktreeId || null
            });
            updateTaskRecordInState(t.id, rec);
            renderList();
            renderDetail(getTaskById(t.id));
          }
        } catch (e) {
          this.showToast(String(e?.message || e), 'error');
        } finally {
          spawnRecheckBtn.disabled = false;
        }
      });

      reviewedEl?.addEventListener('change', async () => {
        try {
          reviewedEl.disabled = true;
          let nudged = false;
          if (reviewedEl.checked && state.reviewTimer?.taskId === t.id) {
            await stopReviewTimer({ reason: 'reviewed', nudge: true });
            nudged = true;
          }
          const patch = { reviewed: !!reviewedEl.checked };
          if (reviewedEl.checked) patch.reviewEndedAt = new Date().toISOString();
          if (reviewedEl.checked) {
            patch.claimedBy = null;
            patch.claimedAt = null;
          }
          const rec = await upsertRecord(t.id, patch);
          updateTaskRecordInState(t.id, rec);
	          renderList();
	          renderDetail(getTaskById(t.id));
	          if (reviewedEl.checked && !nudged) {
	            maybeNudgeReviewComplete(t.id, { reason: 'reviewed' });
	          }
	          if (reviewedEl.checked) {
	            maybeAutoAdvanceAfterReview(t.id);
	          }
	        } catch (e) {
	          this.showToast(String(e?.message || e), 'error');
	        } finally {
	          reviewedEl.disabled = false;
	        }
      });

	      outcomeEl?.addEventListener('change', async () => {
	        try {
	          outcomeEl.disabled = true;
	          const value = String(outcomeEl.value || '').trim();
          let nudged = false;
          if (value && state.reviewTimer?.taskId === t.id) {
            await stopReviewTimer({ reason: 'outcome', nudge: true });
            nudged = true;
          }
          const patch = { reviewOutcome: value || null };
          if (value) patch.reviewEndedAt = new Date().toISOString();
          if (value) {
            patch.claimedBy = null;
            patch.claimedAt = null;
          }
	          const rec = await upsertRecord(t.id, patch);
	          updateTaskRecordInState(t.id, rec);
	          if (value === 'needs_fix') {
	            await maybeApplyTrelloNeedsFixLabel({ taskId: t.id, outcome: value, notes: String(notesEl?.value || '') });
	          }
	          await fetchTasks();
	          renderDetail(getTaskById(t.id));
	          if (value && !nudged) {
	            maybeNudgeReviewComplete(t.id, { reason: 'outcome' });
	          }
	          if (value) {
	            maybeAutoAdvanceAfterReview(t.id);
	          }
	        } catch (e) {
	          this.showToast(String(e?.message || e), 'error');
	        } finally {
	          outcomeEl.disabled = false;
	        }
      });

      timerStartBtn?.addEventListener('click', async () => {
        try {
          timerStartBtn.disabled = true;
          await startReviewTimer(t.id);
          renderDetail(getTaskById(t.id));
        } catch (e) {
          this.showToast(String(e?.message || e), 'error');
        } finally {
          timerStartBtn.disabled = false;
        }
      });

      timerStopBtn?.addEventListener('click', async () => {
        try {
          timerStopBtn.disabled = true;
          if (state.reviewTimer?.taskId === t.id) {
            await stopReviewTimer({ reason: 'manual', nudge: true });
          }
          renderDetail(getTaskById(t.id));
        } catch (e) {
          this.showToast(String(e?.message || e), 'error');
        } finally {
          timerStopBtn.disabled = false;
        }
      });

      renderReverseDeps();
      loadDeps().catch(() => {});

      if (state.autoOpenDiff && t.kind === 'pr') {
        if (state.allowAutoOpenDiff) {
          state.allowAutoOpenDiff = false;
          openDiffBtn?.click?.();
        }
      }
    };

	    const maybeAutoSpawnReviewer = async (t) => {
	      if (!state.autoReviewer) return;
	      const task = t || {};
	      if (task.kind !== 'pr') return;

      const tier = Number(task?.record?.tier);
      if (tier !== 3) return;

      if (task?.record?.reviewedAt) return;
      if (task?.record?.reviewerSpawnedAt) return;

      if (state.reviewerSpawning?.has?.(task.id)) return;
      state.reviewerSpawning.add(task.id);

      try {
        const info = await this.spawnReviewAgentForPRTask(task, { tier: 3, agentId: 'claude', mode: 'fresh', yolo: true });
        if (!info) return;
        const patch = { reviewerSpawnedAt: new Date().toISOString() };
        if (info?.worktreeId) patch.reviewerWorktreeId = info.worktreeId;
        const rec = await upsertRecord(task.id, patch);
        updateTaskRecordInState(task.id, rec);
        renderList();
        renderDetail(getTaskById(task.id));
      } catch (e) {
        // best-effort; keep it silent unless it was user-initiated
        console.warn('Auto reviewer spawn failed:', e);
      } finally {
        state.reviewerSpawning.delete(task.id);
      }
	    };

	    const parseIsoMaybe = (v) => {
	      const ms = Date.parse(String(v || ''));
	      return Number.isFinite(ms) ? ms : 0;
	    };

	    const maybeAutoSpawnFixer = async (t) => {
	      if (!state.autoFixer) return;
	      const task = t || {};
	      if (task.kind !== 'pr') return;

	      const tier = Number(task?.record?.tier);
	      if (tier !== 3) return;

	      const rec = (task?.record && typeof task.record === 'object') ? task.record : {};
	      if (rec?.fixerSpawnedAt) return;
	      const outcome = String(rec?.reviewOutcome || '').trim().toLowerCase();
	      if (outcome !== 'needs_fix') return;
	      const notes = String(rec?.notes || '').trim();
	      if (!notes) return;

	      if (state.fixerSpawning?.has?.(task.id)) return;
	      state.fixerSpawning.add(task.id);

	      try {
	        const info = await this.spawnFixAgentForPRTask(task, { tier: 2, agentId: 'claude', mode: 'fresh', yolo: true, notes });
	        if (!info) return;
	        const patch = { fixerSpawnedAt: new Date().toISOString() };
	        if (info?.worktreeId) patch.fixerWorktreeId = info.worktreeId;
	        const next = await upsertRecord(task.id, patch);
	        updateTaskRecordInState(task.id, next);
	        renderList();
	        renderDetail(getTaskById(task.id));
	      } catch (e) {
	        console.warn('Auto fixer spawn failed:', e);
	      } finally {
	        state.fixerSpawning.delete(task.id);
	      }
	    };

	    const maybeAutoSpawnRecheck = async (t) => {
	      if (!state.autoRecheck) return;
	      const task = t || {};
	      if (task.kind !== 'pr') return;

	      const tier = Number(task?.record?.tier);
	      if (tier !== 3) return;

	      const rec = (task?.record && typeof task.record === 'object') ? task.record : {};
	      if (!rec?.fixerSpawnedAt) return;
	      if (rec?.recheckSpawnedAt) return;
	      const outcome = String(rec?.reviewOutcome || '').trim().toLowerCase();
	      if (outcome !== 'needs_fix') return;

	      const prUpdatedMs = parseIsoMaybe(task?.updatedAt);
	      const fixerMs = parseIsoMaybe(rec?.fixerSpawnedAt);
	      if (!prUpdatedMs || !fixerMs || prUpdatedMs <= fixerMs) return;

	      if (state.recheckSpawning?.has?.(task.id)) return;
	      state.recheckSpawning.add(task.id);

	      try {
	        const info = await this.spawnReviewAgentForPRTask(task, { tier: 3, agentId: 'claude', mode: 'fresh', yolo: true });
	        if (!info) return;
	        const patch = { recheckSpawnedAt: new Date().toISOString() };
	        if (info?.worktreeId) patch.recheckWorktreeId = info.worktreeId;
	        const next = await upsertRecord(task.id, patch);
	        updateTaskRecordInState(task.id, next);
	        renderList();
	        renderDetail(getTaskById(task.id));
	      } catch (e) {
	        console.warn('Auto recheck spawn failed:', e);
	      } finally {
	        state.recheckSpawning.delete(task.id);
	      }
	    };

	    const selectById = (id, { allowAutoOpenDiff } = {}) => {
	      state.selectedId = id;
	      state.allowAutoOpenDiff = !!allowAutoOpenDiff;
	      const t = getTaskById(id);
	      renderList();
	      renderDetail(t);
	      if (state.reviewActive && t?.id) {
	        startReviewTimer(t.id).catch(() => {});
	      }
	      maybeAutoSpawnReviewer(t).catch(() => {});
	      maybeAutoSpawnFixer(t).catch(() => {});
	      maybeAutoSpawnRecheck(t).catch(() => {});
	    };

	    listEl.addEventListener('click', (e) => {
	      const row = e.target.closest('.task-card-row[data-queue-id]');
	      if (!row) return;
	      const id = row.getAttribute('data-queue-id');
	      selectById(id, { allowAutoOpenDiff: true });
	    });

	    listEl.addEventListener('dragstart', (e) => {
	      const row = e.target.closest('.task-card-row[data-queue-id]');
	      if (!row) return;
	      const id = String(row.getAttribute('data-queue-id') || '').trim();
	      if (!id) return;
	      try {
	        e.dataTransfer?.setData('text/plain', id);
	        e.dataTransfer.effectAllowed = 'copy';
	      } catch {}
	    });

    searchEl.addEventListener('input', () => {
      state.query = searchEl.value || '';
      renderList();
      if (state.selectedId) renderDetail(getTaskById(state.selectedId));
    });

    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      try {
        await fetchTasks();
      } catch (e) {
        this.showToast(String(e?.message || e), 'error');
      } finally {
        refreshBtn.disabled = false;
      }
    });

    mineBtn.addEventListener('click', async () => {
      setMode('mine');
      await fetchTasks().catch((e) => this.showToast(String(e?.message || e), 'error'));
      if (state.selectedId) renderDetail(getTaskById(state.selectedId));
    });
    allBtn.addEventListener('click', async () => {
      setMode('all');
      await fetchTasks().catch((e) => this.showToast(String(e?.message || e), 'error'));
      if (state.selectedId) renderDetail(getTaskById(state.selectedId));
    });

    const navigate = (dir) => {
      const ordered = getOrderedTasks(getFilteredTasks());
      if (!ordered.length) return;
      const currentIndex = state.selectedId ? ordered.findIndex(t => t.id === state.selectedId) : -1;
      const nextIndex = currentIndex === -1
        ? 0
        : (currentIndex + dir + ordered.length) % ordered.length;
      selectById(ordered[nextIndex].id, { allowAutoOpenDiff: true });
    };

    prevBtn?.addEventListener('click', () => navigate(-1));
    nextBtn?.addEventListener('click', () => navigate(1));

    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    const close = () => {
      document.removeEventListener('keydown', onKey);
      stopReviewTimer({ reason: 'close', nudge: false }).catch(() => {});
      modal.remove();
    };

    document.addEventListener('keydown', onKey);
    closeBtn?.addEventListener('click', close);

    try {
      await fetchTasks();
      // Initial render respects triage mode + tierSet presets.
      applyFiltersAndMaybeClampSelection({ renderSelectedDetail: false });
      if (state.selectedId) selectById(state.selectedId, { allowAutoOpenDiff: state.reviewActive });
    } catch (e) {
      this.showToast(String(e?.message || e), 'error');
      listEl.innerHTML = `<div class="no-ports">Failed to load queue.</div>`;
    }
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
          <label class="quick-checkbox" title="Keep this modal open after adding so you can add multiple worktrees">
            <input type="checkbox" id="worktree-modal-keep-open">
            Keep open
          </label>
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
    const keepOpenEl = modal.querySelector('#worktree-modal-keep-open');
    if (keepOpenEl) {
      keepOpenEl.checked = this.getWorktreeModalKeepOpen();
      keepOpenEl.addEventListener('change', () => {
        this.setWorktreeModalKeepOpenPreference(!!keepOpenEl.checked);
      });
    }
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
    this.quickWorktreeCreateBackground = localStorage.getItem('quick-worktree-create-background') === 'true';
    const createCountRaw = Number(localStorage.getItem('quick-worktree-create-count') || '1');
    this.quickWorktreeCreateCount = Number.isFinite(createCountRaw) && createCountRaw >= 1 ? Math.min(8, Math.round(createCountRaw)) : 1;
    this.quickWorktreeStartTier = localStorage.getItem('quick-worktree-start-tier') || '';
    if (!['', '1', '2', '3', '4'].includes(this.quickWorktreeStartTier)) {
      this.quickWorktreeStartTier = '';
    }
    if (!this.quickWorktreeStartTier) {
      const tierFilter = Number(this.tierFilter);
      this.quickWorktreeStartTier = (tierFilter >= 1 && tierFilter <= 4) ? String(tierFilter) : '2';
      localStorage.setItem('quick-worktree-start-tier', this.quickWorktreeStartTier);
    }
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
          <label class="quick-checkbox" title="Keep this modal open after starting so you can start multiple worktrees">
            <input type="checkbox" id="worktree-modal-keep-open">
            Keep open
          </label>
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
                <span class="quick-control-label">Start tier</span>
                <label class="quick-radio">
                  <input type="radio" name="quick-tier" value="1">
                  T1
                </label>
                <label class="quick-radio">
                  <input type="radio" name="quick-tier" value="2">
                  T2
                </label>
                <label class="quick-radio">
                  <input type="radio" name="quick-tier" value="3">
                  T3
                </label>
                <label class="quick-radio">
                  <input type="radio" name="quick-tier" value="4">
                  T4
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
              <div class="quick-control-group">
                <span class="quick-control-label">Create</span>
                <input type="number" id="quick-worktree-create-count" class="quick-number-input" min="1" max="8" value="${this.quickWorktreeCreateCount}" title="How many new worktrees to create (work9+)" />
                <label class="quick-checkbox" title="Create terminals but keep them hidden (skip auto-start)">
                  <input type="checkbox" id="quick-worktree-create-background" ${this.quickWorktreeCreateBackground ? 'checked' : ''}>
                  Background
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
    modal.querySelectorAll('input[name="quick-tier"]').forEach(input => {
      input.checked = input.value === this.quickWorktreeStartTier;
    });
    modal.querySelectorAll('input[name="quick-recency"]').forEach(input => {
      input.checked = input.value === this.quickWorktreeRecencyFilter;
    });
    const favoritesOnlyCheckbox = modal.querySelector('#quick-favorites-only');
    if (favoritesOnlyCheckbox) {
      favoritesOnlyCheckbox.checked = !!this.quickWorktreeFavoritesOnly;
    }

    const keepOpenCheckbox = modal.querySelector('#worktree-modal-keep-open');
    if (keepOpenCheckbox) {
      keepOpenCheckbox.checked = this.getWorktreeModalKeepOpen();
    }

    modal.addEventListener('change', (e) => {
      if (e.target && e.target.id === 'worktree-modal-keep-open') {
        this.setWorktreeModalKeepOpenPreference(!!e.target.checked);
        return;
      }
      if (e.target && e.target.id === 'quick-worktree-create-background') {
        this.quickWorktreeCreateBackground = !!e.target.checked;
        localStorage.setItem('quick-worktree-create-background', this.quickWorktreeCreateBackground ? 'true' : 'false');
        return;
      }
      if (e.target && e.target.id === 'quick-worktree-create-count') {
        const raw = Number(e.target.value || '');
        this.quickWorktreeCreateCount = Number.isFinite(raw) && raw >= 1 ? Math.min(8, Math.round(raw)) : 1;
        try { e.target.value = String(this.quickWorktreeCreateCount); } catch {}
        localStorage.setItem('quick-worktree-create-count', String(this.quickWorktreeCreateCount));
        return;
      }
      const sortInput = e.target.closest('input[name="quick-sort"]');
      if (sortInput) {
        this.quickWorktreeSortMode = sortInput.value;
        localStorage.setItem('quick-worktree-sort', this.quickWorktreeSortMode);
        this.renderQuickWorktreeRepoList();
        return;
      }

      const tierInput = e.target.closest('input[name="quick-tier"]');
      if (tierInput) {
        this.quickWorktreeStartTier = tierInput.value;
        localStorage.setItem('quick-worktree-start-tier', this.quickWorktreeStartTier);
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

      const presetBtn = event.target.closest('.quick-create-preset-btn');
      if (presetBtn) {
        event.preventDefault();
        event.stopPropagation();
        const repoPath = presetBtn.dataset.repoPath;
        const preset = presetBtn.dataset.preset;
        (async () => {
          try {
            presetBtn.disabled = true;
            await this.toggleQuickWorktreeCreatePresetForRepoPath(repoPath, preset);
            this.renderQuickWorktreeRepoList();
          } catch (err) {
            console.error('Failed to set create preset:', err);
            this.showToast(String(err?.message || err), 'error');
          } finally {
            presetBtn.disabled = false;
          }
        })();
        return;
      }

      const createBtn = event.target.closest('.quick-create-btn');
      if (createBtn) {
        event.preventDefault();
        event.stopPropagation();
        const repoPath = createBtn.dataset.repoPath;
        const repoType = createBtn.dataset.repoType;
        const repoName = createBtn.dataset.repoName;
        const count = this.getQuickWorktreeCreateCountForRepoPath(repoPath);
        const background = !!this.quickWorktreeCreateBackground;
        const startTier = Number(this.quickWorktreeStartTier);

        (async () => {
          try {
            createBtn.disabled = true;
            createBtn.classList.add('is-starting');
            await this.quickCreateExtraWorktreesForRepo({ repoPath, repoType, repoName, count, background, startTier });
          } catch (err) {
            console.error('Quick create worktrees failed:', err);
            this.showToast(String(err?.message || err), 'error');
          } finally {
            createBtn.disabled = false;
            createBtn.classList.remove('is-starting');
          }
        })();
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
      const keepOpen = (event && (event.ctrlKey || event.metaKey)) || this.getWorktreeModalKeepOpen();

      if (!worktreeId || !worktreePath) {
        this.showTemporaryMessage('No available worktrees for this repo', 'error');
        return;
      }

      (async () => {
        const prevText = btn.textContent;
        try {
          btn.disabled = true;
          btn.classList.add('is-starting');
          btn.textContent = 'Starting…';
          await this.quickStartWorktree({
            repoPath,
            repoType,
            repoName,
            worktreeId,
            worktreePath,
            repositoryRoot,
            keepOpen,
            explicitSelection: false
          });
        } catch (err) {
          console.error('Quick start worktree failed:', err);
          this.showToast(String(err?.message || err), 'error');
        } finally {
          btn.disabled = false;
          btn.classList.remove('is-starting');
          btn.textContent = prevText;
        }
      })();
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
          const statusLabel = inUse ? ' • in use' : '';
          return `
            <button class="quick-menu-item"
                    data-in-use="${inUse ? 'true' : 'false'}"
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
      if (!item) return;
      const keepOpen = (e.ctrlKey || e.metaKey) || this.getWorktreeModalKeepOpen();

      const worktreeId = item.dataset.worktreeId;
      const worktreePath = item.dataset.worktreePath;
      if (!worktreeId || !worktreePath) return;

      const inUse = item.dataset.inUse === 'true';
      const repoPath = item.dataset.repoPath;
      const repoType = item.dataset.repoType;
      const repoName = item.dataset.repoName;

      if (inUse) {
        this.addWorktreeToWorkspace(repoPath, worktreeId, repoType, repoName, true, keepOpen);
      } else {
        this.quickStartWorktree({
          repoPath,
          repoType,
          repoName,
          worktreeId,
          worktreePath,
          repositoryRoot: item.dataset.repoRoot || repoPath,
          keepOpen,
          explicitSelection: true
        }).catch(() => {});
      }

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

    const data = await this.fetchWorktreeMetadataBatch(paths);
    items.forEach(btn => {
      const meta = data[btn.dataset.worktreePath];
      if (!meta) return;

      const branch = meta.git?.branch || 'unknown';
      const pr = meta.pr || {};
      const risk = String(meta.project?.baseImpactRisk || '').toLowerCase();
      const dirty = meta.git?.hasUncommittedChanges ? Number(meta.git?.total || 0) : 0;
      const ahead = Number(meta.git?.ahead || 0);
      const behind = Number(meta.git?.behind || 0);

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
      let suffix = prLabel ? ` • ${prLabel}` : '';
      if (dirty > 0) suffix += ` • dirty:${dirty}`;
      if (behind > 0 || ahead > 0) {
        const parts = [];
        if (behind > 0) parts.push(`⇣${behind}`);
        if (ahead > 0) parts.push(`⇡${ahead}`);
        suffix += ` • ${parts.join(' ')}`;
      }
      if (risk) {
        suffix += ` • risk: ${risk}`;
        btn.classList.remove('risk-low', 'risk-medium', 'risk-high', 'risk-critical');
        if (risk === 'critical') btn.classList.add('risk-critical');
        else if (risk === 'high') btn.classList.add('risk-high');
        else if (risk === 'medium') btn.classList.add('risk-medium');
        else if (risk === 'low') btn.classList.add('risk-low');
      }

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

  getQuickWorktreeCreatePresets() {
    const fromServer = this.userSettings?.global?.ui?.worktrees?.createPresets;
    if (fromServer && typeof fromServer === 'object' && !Array.isArray(fromServer)) return fromServer;
    return { small: 2, medium: 4, large: 6 };
  }

  getQuickWorktreeCreatePresetByRepoPath() {
    const fromServer = this.userSettings?.global?.ui?.worktrees?.createPresetByRepoPath;
    if (fromServer && typeof fromServer === 'object' && !Array.isArray(fromServer)) return fromServer;
    try {
      const raw = localStorage.getItem('quick-worktree-createPresetByRepoPath');
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // ignore
    }
    return {};
  }

  getQuickWorktreeCreatePresetForRepoPath(repoPath) {
    const key = String(repoPath || '').trim();
    if (!key) return '';
    const map = this.getQuickWorktreeCreatePresetByRepoPath();
    const preset = String(map?.[key] || '').trim().toLowerCase();
    return (preset === 'small' || preset === 'medium' || preset === 'large') ? preset : '';
  }

  getQuickWorktreeCreateCountForRepoPath(repoPath) {
    const preset = this.getQuickWorktreeCreatePresetForRepoPath(repoPath);
    const presets = this.getQuickWorktreeCreatePresets();
    const presetCount = preset ? Number(presets?.[preset]) : NaN;
    const raw = Number.isFinite(presetCount) && presetCount >= 1 ? presetCount : Number(this.quickWorktreeCreateCount || 1);
    const n = Number.isFinite(raw) && raw >= 1 ? Math.min(8, Math.round(raw)) : 1;
    return n;
  }

  async toggleQuickWorktreeCreatePresetForRepoPath(repoPath, presetName) {
    const repoKey = String(repoPath || '').trim();
    if (!repoKey) return;
    const preset = String(presetName || '').trim().toLowerCase();
    if (!['small', 'medium', 'large'].includes(preset)) return;

    const current = this.getQuickWorktreeCreatePresetByRepoPath();
    const currentPreset = String(current?.[repoKey] || '').trim().toLowerCase();
    const next = { ...(current || {}) };
    if (currentPreset === preset) delete next[repoKey];
    else next[repoKey] = preset;

    try {
      await this.updateGlobalUserSetting('ui.worktrees.createPresetByRepoPath', next);
    } catch {
      // ignore
    }

    // Local fallback (for robustness if server settings aren't loaded yet).
    try {
      localStorage.setItem('quick-worktree-createPresetByRepoPath', JSON.stringify(next));
    } catch {
      // ignore
    }
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
    const nextId = this.getNextWorktreeIdForRepo(repo);
    const nextNumber = Number(String(nextId || '').replace(/^work/i, ''));
    const canCreate = !!(this.currentWorkspace?.id && Number.isFinite(nextNumber) && nextNumber <= this.autoCreateWorktreeMaxNumber);
    const createCount = this.getQuickWorktreeCreateCountForRepoPath(repo.path);
    const createPreset = this.getQuickWorktreeCreatePresetForRepoPath(repo.path);
    const presetCounts = this.getQuickWorktreeCreatePresets();
    const presetTitleFor = (name) => {
      const n = Number(presetCounts?.[name]);
      const safe = Number.isFinite(n) && n >= 1 ? Math.min(8, Math.round(n)) : '';
      return `${name} (${safe || '?'})`;
    };
    const presetButtons = `
      <div class="quick-create-presets" title="Per-repo create presets">
        <button class="btn-secondary quick-create-preset-btn ${createPreset === 'small' ? 'is-selected' : ''}"
                type="button"
                data-repo-path="${repo.path}"
                data-preset="small"
                title="${this.escapeHtml(presetTitleFor('small'))}">
          S
        </button>
        <button class="btn-secondary quick-create-preset-btn ${createPreset === 'medium' ? 'is-selected' : ''}"
                type="button"
                data-repo-path="${repo.path}"
                data-preset="medium"
                title="${this.escapeHtml(presetTitleFor('medium'))}">
          M
        </button>
        <button class="btn-secondary quick-create-preset-btn ${createPreset === 'large' ? 'is-selected' : ''}"
                type="button"
                data-repo-path="${repo.path}"
                data-preset="large"
                title="${this.escapeHtml(presetTitleFor('large'))}">
          L
        </button>
      </div>
    `;

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
          ${presetButtons}
          <button class="btn-secondary quick-create-btn"
                  data-repo-path="${repo.path}"
                  data-repo-type="${repo.type}"
                  data-repo-name="${repo.name}"
                  title="${canCreate ? `Create ${createCount} new worktree(s) starting at ${nextId}` : 'Cannot create more worktrees for this repo'}"
                  ${canCreate ? '' : 'disabled'}>
            ➕ ${this.escapeHtml(nextId)}×${createCount}
          </button>
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
          const keepOpen = (event && (event.ctrlKey || event.metaKey)) || this.getWorktreeModalKeepOpen();

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
                data-repo-path="${this.escapeHtml(repo.path)}"
                data-repo-type="${this.escapeHtml(repo.type)}"
                data-repo-name="${this.escapeHtml(repo.name)}"
                data-worktree-id="${this.escapeHtml(worktreeId)}"
                onclick="window.orchestrator.handleAddWorktreeOptionClick(event, '${repo.path}', '${worktreeId}', '${repo.type}', '${repo.name}', ${isInUse})">
          <span class="worktree-id">${worktreeId}</span>
          <span class="worktree-status">${statusIcon} ${statusText}</span>
        </button>
      `);
    }

    return `
      <div class="repo-section" data-repo-name="${repo.name.toLowerCase()}" data-repo-type="${repo.type}" data-repo-path="${this.escapeHtml(repo.path)}">
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

  handleAddWorktreeOptionClick(event, repoPath, worktreeId, repoType, repoName, isInUse = false) {
    try {
      event?.preventDefault?.();
      event?.stopPropagation?.();
    } catch {
      // ignore
    }

    const keepOpen = (event && (event.ctrlKey || event.metaKey)) || this.getWorktreeModalKeepOpen();

    const btn = event?.currentTarget || event?.target?.closest?.('.worktree-option');
    if (btn) {
      btn.disabled = true;
      btn.classList.add('is-starting');
      const statusEl = btn.querySelector('.worktree-status');
      if (statusEl) statusEl.textContent = '⏳ Starting…';
    }

    this.addWorktreeToWorkspace(repoPath, worktreeId, repoType, repoName, !!isInUse, keepOpen);
  }

  refreshAdvancedAddWorktreeModalAvailability() {
    const modal = document.getElementById('add-worktree-modal');
    if (!modal) return;

    modal.querySelectorAll('.repo-section').forEach((section) => {
      const repoPath = section.getAttribute('data-repo-path') || '';
      const repoName = section.getAttribute('data-repo-name') || '';
      let available = 0;

      section.querySelectorAll('.worktree-option[data-worktree-id]').forEach((btn) => {
        const worktreeId = btn.getAttribute('data-worktree-id') || '';
        if (!repoPath || !worktreeId) return;

        const inUse = this.isWorktreeInUse(repoPath, worktreeId, repoName || null);
        btn.disabled = false;
        btn.classList.remove('is-starting');
        btn.classList.toggle('in-use', inUse);
        btn.classList.toggle('available', !inUse);

        const statusEl = btn.querySelector('.worktree-status');
        if (statusEl) {
          statusEl.textContent = inUse ? '⚠️ In use' : '✅ Available';
        }

        if (!inUse) available += 1;
      });

      const countEl = section.querySelector('.available-count');
      if (countEl) countEl.textContent = `${available}/8 available`;
    });
  }

	  isWorktreeInUse(repoPath, worktreeId, repoNameOverride = null) {
	    // Check if this worktree has ACTIVE SESSIONS, not just workspace config
	    // A worktree is "in use" only if there are actual terminal sessions for it

    if (!this.currentWorkspace) return false;
    const considerOtherWorkspaces = this.userSettings?.global?.ui?.worktrees?.considerOtherWorkspaces !== false;

	    const normalizePath = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').trim();
	    const repoPathNorm = normalizePath(repoPath);

    // While worktree sessions are spinning up, we reserve the worktree so it isn't recommended again.
    this.cleanupExpiredWorktreeReservations();
    if (this.isWorktreeReserved(repoPathNorm, worktreeId)) return true;
	
	    // Extract repo name from path for session matching
	    const repoName = (repoNameOverride || repoPathNorm.split('/').pop() || '').toLowerCase();

    // Check if any session is using this worktree.
    // Session IDs follow patterns like: "work1-claude", "work1-server",
    // or for mixed-repo: "repoName-work1-claude", "repoName-work1-server".
    for (const [sessionId, session] of this.sessions) {
      // Default: consider sessions across workspaces too (stronger "in use" heuristic),
      // because the same worktree should not be shared across active sessions.
      // If disabled, keep legacy behavior (current workspace only).
      if (!considerOtherWorkspaces && this.currentWorkspace) {
        if (session.workspace) {
          if (session.workspace !== this.currentWorkspace.id) continue;
        } else if (this.currentWorkspace.workspaceType === 'mixed-repo') {
          const terminals = Array.isArray(this.currentWorkspace.terminals) ? this.currentWorkspace.terminals : [];
          if (!terminals.some(t => t && t.id === sessionId)) continue;
        }
      }

	      const sessionWorktreeId = session.worktreeId
	        || sessionId.match(/-(work\d+)-/)?.[1]
	        || sessionId.split('-')[0];
	      const sessionRepoName = (session.repositoryName || this.extractRepositoryName(sessionId) || '').toLowerCase();
	      const cwd = normalizePath(session?.config?.cwd || session?.cwd || '');
	      const derivedRepoRoot = (cwd && sessionWorktreeId && cwd.endsWith(`/${sessionWorktreeId}`))
	        ? cwd.slice(0, -(`/${sessionWorktreeId}`).length)
	        : cwd;
	      const sessionRepoPath = normalizePath(session?.repositoryRoot || derivedRepoRoot || '');

	      // Prefer exact repo path matches when we can infer them (avoids name collisions across repos).
	      if (repoPathNorm && sessionRepoPath && repoPathNorm === sessionRepoPath) {
	        if (sessionWorktreeId === worktreeId) return true;
	      }

	      // For single-repo workspaces (no repo name in session)
	      if (!sessionRepoName && normalizePath(this.currentWorkspace.repository?.path) === repoPathNorm) {
	        if (sessionWorktreeId === worktreeId) return true;
	      }

	      // For mixed-repo workspaces (repo name in session). Only use name matching when we
	      // can't infer a conflicting repo path.
	      if (sessionRepoName && repoName && sessionRepoName === repoName) {
	        if (repoPathNorm && sessionRepoPath && repoPathNorm !== sessionRepoPath) {
	          continue;
	        }
	        if (sessionWorktreeId === worktreeId) return true;
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

  async applyStartTierToNewSessions(sessionIds, tier) {
    const selectedTier = Number(tier);
    if (!(selectedTier >= 1 && selectedTier <= 4)) return;

    const ids = Array.isArray(sessionIds)
      ? sessionIds.map(x => String(x || '').trim()).filter(Boolean)
      : [];
    if (!ids.length) return;

    const agentSessionIds = ids.filter(id => id.includes('-claude'));
    if (!agentSessionIds.length) return;

    // Update local state immediately so gating/UI reads the tier before async persistence completes.
    for (const sid of agentSessionIds) {
      const recordId = `session:${sid}`;
      const prev = this.taskRecords.get(recordId) || {};
      this.taskRecords.set(recordId, { ...prev, tier: selectedTier });
    }

    try {
      await Promise.all(agentSessionIds.map((sid) => this.upsertTaskRecord(`session:${sid}`, { tier: selectedTier })));
      this.refreshTier1Busy({ suppressRerender: true });
      this.buildSidebar();
      this.updateTerminalGrid();
    } catch (error) {
      console.warn('Failed to persist start tier for new sessions', error);
    }
  }

  getQuickWorktreeCandidatesForRepo(repo) {
    const r = repo && typeof repo === 'object' ? repo : {};
    const repoPath = String(r.path || '').trim();
    const repoName = String(r.name || '').trim();
    const entries = Array.isArray(r.worktreeDirs) ? r.worktreeDirs : [];

    if (!entries.length) {
      if (!repoPath) return [];
      return [{
        id: 'root',
        path: repoPath,
        number: 0,
        effectiveLastUsedMs: Number(r.lastModifiedMs || 0)
      }].filter((c) => !this.isWorktreeInUse(repoPath, c.id, repoName));
    }

    return entries
      .filter((e) => e && e.id && !this.isWorktreeInUse(repoPath, e.id, repoName))
      .map((e) => {
        const id = String(e.id || '').trim();
        const lastActivity = this.getWorktreeLastActivity(r, id);
        const entryMtime = typeof e.lastModifiedMs === 'number' ? e.lastModifiedMs : 0;
        const effectiveLastUsedMs = Math.max(entryMtime, lastActivity || 0);
        const number = Number(e.number || parseInt(id.replace(/^work/i, ''), 10) || 0);
        return {
          id,
          path: String(e.path || `${repoPath}/${id}`),
          number,
          effectiveLastUsedMs
        };
      })
      .sort((a, b) => (a.number || 0) - (b.number || 0));
  }

  async fetchWorktreeMetadataBatch(paths) {
    const raw = Array.isArray(paths) ? paths.map((p) => String(p || '').trim()).filter(Boolean) : [];
    const unique = Array.from(new Set(raw));
    if (!unique.length) return {};

    const serverUrl = window.location.origin;
    const response = await fetch(`${serverUrl}/api/worktree-metadata/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: unique })
    });
    if (!response.ok) return {};
    const data = await response.json();
    return data && typeof data === 'object' ? data : {};
  }

  scoreQuickWorktreeCandidate(candidate, meta) {
    const c = candidate && typeof candidate === 'object' ? candidate : {};
    const m = meta && typeof meta === 'object' ? meta : {};
    const git = m.git || {};
    const pr = m.pr || {};

    const now = Date.now();
    const usedMs = Number(c.effectiveLastUsedMs || 0);
    const ageDays = usedMs ? Math.max(0, (now - usedMs) / (24 * 60 * 60 * 1000)) : 0;

    let score = 0;
    // Prefer reusing older worktrees (minimize churn) but cap the effect.
    score += Math.min(90, ageDays);

    // Avoid reusing in-progress PR worktrees.
    if (pr && pr.hasPR) {
      const state = String(pr.state || '').toLowerCase();
      if (state === 'open') score -= 1200;
      else if (state === 'merged') score -= 250;
      else if (state === 'closed') score -= 150;
      else score -= 300;
    }

    // Prefer clean worktrees.
    if (git && git.hasUncommittedChanges) {
      const total = Number(git.total || 0);
      score -= 200 + Math.min(400, total * 12);
    } else {
      score += 20;
    }

    // Prefer up-to-date worktrees.
    const behind = Number(git.behind || 0);
    if (behind > 0) score -= Math.min(240, behind * 30);

    // Avoid starting directly on main/master if there are multiple candidates.
    const branch = String(git.branch || '').toLowerCase();
    if (branch === 'main' || branch === 'master') score -= 600;

    return score;
  }

  async pickBestFreeWorktreeForRepo(repo, { fallbackId = '', fallbackPath = '' } = {}) {
    const r = repo && typeof repo === 'object' ? repo : null;
    if (!r || !r.path) return null;

    if (!this.quickWorktreeBestPickCache) this.quickWorktreeBestPickCache = new Map();
    const cacheKey = String(r.path || '').trim();
    const cached = this.quickWorktreeBestPickCache.get(cacheKey);
    const ttlMs = 15_000;

    if (cached && (Date.now() - (cached.at || 0) < ttlMs)) {
      const cachedId = String(cached?.value?.id || '').trim();
      if (cachedId && !this.isWorktreeInUse(r.path, cachedId, r.name)) return cached.value;
    }

    const candidates = this.getQuickWorktreeCandidatesForRepo(r);
    if (!candidates.length) return null;
    if (candidates.length === 1) {
      const only = candidates[0];
      this.quickWorktreeBestPickCache.set(cacheKey, { value: only, at: Date.now() });
      return only;
    }

    const metaByPath = await this.fetchWorktreeMetadataBatch(candidates.map((c) => c.path)).catch(() => ({}));

    let best = null;
    let bestScore = -Infinity;
    for (const c of candidates) {
      const meta = metaByPath?.[c.path] || null;
      const score = this.scoreQuickWorktreeCandidate(c, meta);
      if (score > bestScore) {
        bestScore = score;
        best = c;
        continue;
      }

      if (score === bestScore && best) {
        const a = Number(c.effectiveLastUsedMs || 0);
        const b = Number(best.effectiveLastUsedMs || 0);
        if (a && b && a < b) best = c;
        else if (a === b && Number(c.number || 0) < Number(best.number || 0)) best = c;
      }
    }

    if (!best && fallbackId && fallbackPath) {
      best = { id: fallbackId, path: fallbackPath, number: 0, effectiveLastUsedMs: 0 };
    }

    if (best) this.quickWorktreeBestPickCache.set(cacheKey, { value: best, at: Date.now() });
    return best;
  }

  async quickStartWorktree({ repoPath, repoType, repoName, worktreeId, worktreePath, repositoryRoot, keepOpen = false, explicitSelection = false }) {
    if (!this.socket) {
      this.showTemporaryMessage('Socket not connected', 'error');
      return;
    }

    let resolvedWorktreeId = String(worktreeId || '').trim();
    let resolvedWorktreePath = String(worktreePath || '').trim();

    if (!explicitSelection) {
      const repos = Array.isArray(this.quickWorktreeReposRaw) ? this.quickWorktreeReposRaw : [];
      const repo = repos.find((r) => String(r?.path || '').trim() === String(repoPath || '').trim()) || null;
      const best = await this.pickBestFreeWorktreeForRepo(repo, {
        fallbackId: resolvedWorktreeId,
        fallbackPath: resolvedWorktreePath
      }).catch(() => null);
      if (best?.id && best?.path) {
        resolvedWorktreeId = String(best.id || '').trim();
        resolvedWorktreePath = String(best.path || '').trim();
      }
    }

    if (!resolvedWorktreeId || !resolvedWorktreePath) {
      this.showTemporaryMessage('No available worktrees for this repo', 'error');
      return;
    }

    this.reserveWorktree(repositoryRoot || repoPath, resolvedWorktreeId);
    this.showTemporaryMessage(`Starting ${repoName} ${resolvedWorktreeId}...`, 'success');
    const startTier = Number(this.quickWorktreeStartTier);
    this.socket.emit('add-worktree-sessions', {
      worktreeId: resolvedWorktreeId,
      worktreePath: resolvedWorktreePath,
      repositoryName: repoName,
      repositoryType: repoType,
      repositoryRoot: repositoryRoot || repoPath,
      startTier: (startTier >= 1 && startTier <= 4) ? startTier : undefined
    });

    if (!keepOpen) {
      document.getElementById('quick-worktree-modal')?.remove();
    }
  }

  async quickCreateExtraWorktreesForRepo({ repoPath, repoType, repoName, count, background, startTier } = {}) {
    const path = String(repoPath || '').trim();
    if (!path) throw new Error('Missing repoPath');
    if (!this.currentWorkspace?.id) throw new Error('No workspace selected');

    const desired = Number(count);
    const n = Number.isFinite(desired) && desired >= 1 ? Math.min(8, Math.round(desired)) : 1;

    const repos = Array.isArray(this.quickWorktreeReposRaw) ? this.quickWorktreeReposRaw : [];
    const repo = repos.find(r => String(r?.path || '').trim() === path) || {
      path,
      type: repoType,
      name: repoName || path.split('/').filter(Boolean).slice(-1)[0] || 'repo',
      worktreeDirs: []
    };

    const tier = Number(startTier);
    const startTierSafe = (tier >= 1 && tier <= 4) ? tier : undefined;

    const baseId = this.getNextWorktreeIdForRepo(repo);
    const baseNumber = Number(String(baseId || '').replace(/^work/i, ''));
    if (!Number.isFinite(baseNumber) || baseNumber < 1) {
      throw new Error(`Failed to compute next worktree id for ${repo.name || path}`);
    }

    const createdIds = [];
    for (let i = 0; i < n; i += 1) {
      const nextNumber = baseNumber + i;
      if (nextNumber > this.autoCreateWorktreeMaxNumber) {
        this.showToast(`Auto-create limit reached (max work${this.autoCreateWorktreeMaxNumber})`, 'warning');
        break;
      }

      const worktreeId = `work${nextNumber}`;
      this.reserveWorktree(repo.path, worktreeId);
      if (background) this.pendingBackgroundWorktrees.add(worktreeId);

      let created = null;
      try {
        created = await this.autoCreateExtraWorktreeForRepo(repo, { startTier: startTierSafe, worktreeId });
      } catch (err) {
        this.pendingBackgroundWorktrees.delete(worktreeId);
        this.clearWorktreeReservation(repo.path, worktreeId);
        throw err;
      }

      if (!created) {
        this.pendingBackgroundWorktrees.delete(worktreeId);
        this.clearWorktreeReservation(repo.path, worktreeId);
        throw new Error(`Failed to create ${repo.name} ${worktreeId}`);
      }

      createdIds.push(worktreeId);
    }

    if (!createdIds.length) {
      this.showToast('No worktrees created', 'warning');
      return;
    }

    const suffix = background ? ' (background)' : '';
    this.showToast(`Creating ${repo.name}: ${createdIds.join(', ')}${suffix}`, 'success');

    // Refresh the repo list so the new worktrees show up immediately.
    try {
      await this.loadQuickWorktreeRepos();
    } catch {
      // ignore
    }
  }

  async addWorktreeToWorkspace(repoPath, worktreeId, repoType, repoName, isInUse = false, keepOpen = false) {
    try {
      console.log(`Adding ${worktreeId} from ${repoName} to workspace...`);

      if (isInUse) {
        // If the worktree already exists in this workspace, don't block selection.
        // Instead, make sure it is visible again (user likely hid it).
        const sessionIds = [];
        const targetRepoName = (repoName || '').toLowerCase();

        for (const [sessionId, session] of this.sessions) {
          if (this.currentWorkspace) {
            if (session.workspace) {
              if (session.workspace !== this.currentWorkspace.id) continue;
            } else if (this.currentWorkspace.workspaceType === 'mixed-repo') {
              const terminals = Array.isArray(this.currentWorkspace.terminals) ? this.currentWorkspace.terminals : [];
              if (!terminals.some(t => t && t.id === sessionId)) continue;
            }
          }

          const sessionWorktreeId = session.worktreeId
            || sessionId.match(/-(work\d+)-/)?.[1]
            || sessionId.split('-')[0];
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
          if (!keepOpen) {
            document.getElementById('add-worktree-modal')?.remove();
            document.getElementById('quick-worktree-modal')?.remove();
          }
          this.showTemporaryMessage(`Showing ${repoName} ${worktreeId}`, 'success');
          return;
        }
      }

      // Optimistically reserve so Quick Work doesn't recommend it again while sessions are being created.
      this.reserveWorktree(repoPath, worktreeId);

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
        if (!keepOpen) {
          document.getElementById('add-worktree-modal')?.remove();
          document.getElementById('quick-worktree-modal')?.remove();
        }

        // Server will emit 'worktree-sessions-added' which is handled by our socket listener
      } else {
        const error = await response.text();
        this.clearWorktreeReservation(repoPath, worktreeId);
        this.showTemporaryMessage('Failed to add worktree: ' + error, 'error');
      }
    } catch (error) {
      console.error('Error adding worktree:', error);
      this.clearWorktreeReservation(repoPath, worktreeId);
      this.showTemporaryMessage('Error: ' + error.message, 'error');
    }
  }

  maybeAutoSendPrompt(sessionId, status) {
    const pending = this.pendingAutoPrompts.get(sessionId);
    if (!pending || pending.sentAt) return;
    const normalized = String(status || '').toLowerCase();
    if (normalized !== 'waiting') return;
    if (!this.socket || !this.socket.connected) return;

    const text = String(pending.text || '').trim();
    if (!text) {
      this.pendingAutoPrompts.delete(sessionId);
      return;
    }

    const payload = text.endsWith('\n') ? text : `${text}\n`;
    this.socket.emit('terminal-input', { sessionId, data: payload });
    pending.sentAt = Date.now();
    this.pendingAutoPrompts.set(sessionId, pending);

    // Best-effort telemetry: record when we auto-sent a prompt (session task record).
    this.upsertTaskRecord(`session:${sessionId}`, {
      promptSentAt: new Date(pending.sentAt).toISOString(),
      promptChars: payload.length
    }).then((rec) => {
      if (rec) this.taskRecords.set(`session:${sessionId}`, rec);
    }).catch(() => {});

    // Best-effort cleanup to avoid unbounded growth if something goes weird.
    setTimeout(() => {
      const cur = this.pendingAutoPrompts.get(sessionId);
      if (cur && cur.sentAt === pending.sentAt) this.pendingAutoPrompts.delete(sessionId);
    }, 60_000);
  }

  getTaskBoardMapping(provider, boardId) {
    const key = `${provider}:${boardId}`;
    const mappings = this.userSettings?.global?.ui?.tasks?.boardMappings;
    if (!mappings || typeof mappings !== 'object') return null;
    const m = mappings[key];
    return m && typeof m === 'object' ? m : null;
  }

  async getScannedRepos({ force = false } = {}) {
    const now = Date.now();
    const ttlMs = 20_000;
    if (!force && this.scannedReposCache?.value && (now - (this.scannedReposCache.fetchedAt || 0) < ttlMs)) {
      return this.scannedReposCache.value;
    }

    const res = await fetch('/api/workspaces/scan-repos');
    if (!res.ok) throw new Error('Failed to scan repos');
    const repos = await res.json();
    const arr = Array.isArray(repos) ? repos : [];
    this.scannedReposCache = { value: arr, fetchedAt: now };
    return arr;
  }

  buildAgentConfigForLaunch({ agentId, mode, yolo } = {}) {
    const id = String(agentId || 'claude').toLowerCase();
    if (id === 'codex') {
      // v1: minimal. If you want more advanced flags, use the Agent modal.
      return { agentId: 'codex', mode: 'search', flags: [] };
    }

    const m = ['fresh', 'continue', 'resume'].includes(String(mode)) ? String(mode) : 'fresh';
    const flags = [];
    if (yolo) flags.push('skipPermissions');
    return { agentId: 'claude', mode: m, flags };
  }

  async spawnReviewAgentForPRTask(prTask, { tier = 3, agentId = 'claude', mode = 'fresh', yolo = true, worktreeId = null } = {}) {
    const t = prTask || {};
    if (t.kind !== 'pr') return;

    const url = String(t.url || '').trim();
    const repoSlug = String(t.repository || '').trim();
    if (!repoSlug) {
      this.showToast('PR task is missing repository slug', 'error');
      return;
    }

    const repoName = repoSlug.split('/').filter(Boolean).slice(-1)[0] || repoSlug;
    const repos = await this.getScannedRepos({ force: false });
    const repo = repos.find((r) => String(r?.name || '').toLowerCase() === String(repoName).toLowerCase());
    if (!repo) {
      this.showToast(`Repo not found locally: ${repoName} (scan-repos)`, 'error');
      return;
    }

    const requestedWorktreeId = String(worktreeId || '').trim();
    const requested = requestedWorktreeId
      ? (Array.isArray(repo.worktrees) ? repo.worktrees.find((w) => String(w?.id || '') === requestedWorktreeId) : null)
      : null;

    const recommended = requested || this.getRecommendedWorktree(repo);

    const prNum = t.prNumber ? Number(t.prNumber) : null;
    const prHint = prNum ? `${repoSlug}#${prNum}` : repoSlug;
    const prompt = [
      `You are a reviewer agent.`,
      ``,
      `Review PR: ${url || prHint}`,
      `Repo: ${repoSlug}`,
      ``,
      `Goals:`,
      `- Validate correctness and spot likely bugs/regressions`,
      `- Identify risky areas (auth, migrations, concurrency, perf, security)`,
      `- Suggest concrete fixes and tests to run`,
      ``,
      `Suggested commands:`,
      prNum ? `- gh pr checkout ${prNum}` : `- gh pr list --limit 20`,
      prNum ? `- gh pr diff ${prNum}` : `- gh pr diff <PR_NUMBER>`,
      `- git status`,
      `- run relevant tests (repo-specific)`,
      ``,
      `Output format:`,
      `1) Summary (3-8 bullets)`,
      `2) Risks (with severity)`,
      `3) Required fixes (if any)`,
      `4) Suggested follow-ups/tests`,
      `5) Verdict: approve | needs_fix`
    ].join('\n');

    const startTier = Number(tier);
    const startTierSafe = (startTier >= 1 && startTier <= 4) ? startTier : undefined;
    const agentConfig = this.buildAgentConfigForLaunch({ agentId, mode, yolo });

    if (!recommended && this.autoCreateExtraWorktreesWhenBusy) {
      const nextId = this.getNextWorktreeIdForRepo(repo);
      this.pendingWorktreeLaunches.set(nextId, { promptText: prompt, autoSendPrompt: true, agentConfig });
      try {
        await this.autoCreateExtraWorktreeForRepo(repo, { startTier: startTierSafe, worktreeId: nextId });
        this.showToast(`Creating ${repo.name} ${nextId} (work9+)`, 'success');
        return { worktreeId: nextId, worktreePath: `${repo.path}/${nextId}`, repositoryRoot: repo.path, repositoryName: repo.name };
      } catch (e) {
        this.pendingWorktreeLaunches.delete(nextId);
        this.clearWorktreeReservation(repo.path, nextId);
        this.showToast(String(e?.message || e), 'error');
      }
    }

    if (!recommended) {
      this.showToast('All worktrees busy for this repo; open Quick Work to choose one', 'warning');
      await this.showQuickWorktreeModal();
      const modal = document.getElementById('quick-worktree-modal');
      const input = modal?.querySelector('#quick-worktree-search');
      if (input) {
        input.value = String(repo?.name || '');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return;
    }

    this.pendingWorktreeLaunches.set(recommended.id, { promptText: prompt, autoSendPrompt: true, agentConfig });

	    if (!this.socket) {
	      this.pendingWorktreeLaunches.delete(recommended.id);
        this.clearWorktreeReservation(repo.path, recommended.id);
	      this.showToast('Socket not available', 'error');
	      return;
	    }
	    if (!this.socket.connected) {
	      this.showToast('Socket not connected (queued launch)', 'warning');
	    }

    this.socket.emit('add-worktree-sessions', {
      worktreeId: recommended.id,
      worktreePath: recommended.path,
      repositoryName: repo.name,
      repositoryType: repo.type,
      repositoryRoot: repo.path,
      startTier: startTierSafe
    });

    this.showToast(`Spawned reviewer in ${repo.name} ${recommended.id}`, 'success');
    return { worktreeId: recommended.id, worktreePath: recommended.path, repositoryRoot: repo.path, repositoryName: repo.name };
  }

  async spawnFixAgentForPRTask(prTask, { tier = 2, agentId = 'claude', mode = 'fresh', yolo = true, notes = '', worktreeId = null } = {}) {
    const t = prTask || {};
    if (t.kind !== 'pr') return null;

    const url = String(t.url || '').trim();
    const repoSlug = String(t.repository || '').trim();
    if (!repoSlug) {
      this.showToast('PR task is missing repository slug', 'error');
      return null;
    }

    const repoName = repoSlug.split('/').filter(Boolean).slice(-1)[0] || repoSlug;
    const repos = await this.getScannedRepos({ force: false });
    const repo = repos.find((r) => String(r?.name || '').toLowerCase() === String(repoName).toLowerCase());
    if (!repo) {
      this.showToast(`Repo not found locally: ${repoName} (scan-repos)`, 'error');
      return null;
    }

    const requestedWorktreeId = String(worktreeId || '').trim();
    const requested = requestedWorktreeId
      ? (Array.isArray(repo.worktrees) ? repo.worktrees.find((w) => String(w?.id || '') === requestedWorktreeId) : null)
      : null;
    const recommended = requested || this.getRecommendedWorktree(repo);

    const prNum = t.prNumber ? Number(t.prNumber) : null;
    const prHint = prNum ? `${repoSlug}#${prNum}` : repoSlug;
    const notesText = String(notes || '').trim();

    const prompt = [
      `You are a fixer agent.`,
      ``,
      `Fix PR: ${url || prHint}`,
      `Repo: ${repoSlug}`,
      ``,
      `Instructions:`,
      `- Checkout the PR branch and implement required fixes`,
      `- Keep the change scoped to the PR; do not open a new PR unless explicitly necessary`,
      `- Run relevant tests/lint where possible and report what you ran`,
      ``,
      `Reviewer feedback / fix request:`,
      notesText ? notesText : '(no notes provided; inspect PR diff + conversation context and propose fixes)',
      ``,
      `Suggested commands:`,
      prNum ? `- gh pr checkout ${prNum}` : `- gh pr list --limit 20`,
      prNum ? `- gh pr diff ${prNum}` : `- gh pr diff <PR_NUMBER>`,
      `- git status`,
      `- run relevant tests (repo-specific)`,
      ``,
      `Output format:`,
      `1) What you changed`,
      `2) Tests run`,
      `3) Anything still risky/uncertain`
    ].join('\n');

    const startTier = Number(tier);
    const startTierSafe = (startTier >= 1 && startTier <= 4) ? startTier : undefined;
    const agentConfig = this.buildAgentConfigForLaunch({ agentId, mode, yolo });

    if (!recommended && this.autoCreateExtraWorktreesWhenBusy) {
      const nextId = this.getNextWorktreeIdForRepo(repo);
      this.pendingWorktreeLaunches.set(nextId, { promptText: prompt, autoSendPrompt: true, agentConfig });
      try {
        await this.autoCreateExtraWorktreeForRepo(repo, { startTier: startTierSafe, worktreeId: nextId });
        this.showToast(`Creating ${repo.name} ${nextId} (work9+)`, 'success');
        return { worktreeId: nextId, worktreePath: `${repo.path}/${nextId}`, repositoryRoot: repo.path, repositoryName: repo.name };
      } catch (e) {
        this.pendingWorktreeLaunches.delete(nextId);
        this.showToast(String(e?.message || e), 'error');
      }
    }

    if (!recommended) {
      this.showToast('All worktrees busy for this repo; open Quick Work to choose one', 'warning');
      await this.showQuickWorktreeModal();
      const modal = document.getElementById('quick-worktree-modal');
      const input = modal?.querySelector('#quick-worktree-search');
      if (input) {
        input.value = String(repo?.name || '');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return null;
    }

    this.pendingWorktreeLaunches.set(recommended.id, { promptText: prompt, autoSendPrompt: true, agentConfig });

	    if (!this.socket) {
	      this.pendingWorktreeLaunches.delete(recommended.id);
	      this.showToast('Socket not available', 'error');
	      return null;
	    }
	    if (!this.socket.connected) {
	      this.showToast('Socket not connected (queued launch)', 'warning');
	    }

    this.socket.emit('add-worktree-sessions', {
      worktreeId: recommended.id,
      worktreePath: recommended.path,
      repositoryName: repo.name,
      repositoryType: repo.type,
      repositoryRoot: repo.path,
      startTier: startTierSafe
    });

    this.showToast(`Spawned fixer in ${repo.name} ${recommended.id}`, 'success');
    return { worktreeId: recommended.id, worktreePath: recommended.path, repositoryRoot: repo.path, repositoryName: repo.name };
  }

  async launchAgentFromTaskCard({ provider, boardId, card, tier, agentId, mode, yolo, autoSendPrompt, promptText } = {}) {
    const mapping = this.getTaskBoardMapping(provider, boardId);
    const mappingEnabled = mapping ? (mapping.enabled !== false) : true;
    if (!mappingEnabled) {
      this.showToast('Board is disabled; enable it in Board Settings first', 'warning');
      return;
    }

    const localPathRaw = String(mapping?.localPath || '').trim();
    const repoSlugRaw = String(mapping?.repoSlug || '').trim();

    if (!localPathRaw && !repoSlugRaw) {
      this.showToast('No board mapping set (Board Settings → Repo mapping)', 'warning');
      return;
    }

    const normalize = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').trim();
    const normalizeRel = (p) => normalize(p).replace(/^(\.\/)+/, '');

    const mapped = normalize(localPathRaw);
    let mappedAbs = mapped.startsWith('/') ? mapped : '';
    let mappedRel = mappedAbs ? '' : normalizeRel(mapped);

    // Accept "~/GitHub/..." or ".../GitHub/..." as a relativePath hint.
    if (!mappedAbs) {
      const idx = mapped.toLowerCase().indexOf('/github/');
      if (idx >= 0) mappedRel = normalizeRel(mapped.slice(idx + '/github/'.length));
    } else {
      const idx = mappedAbs.toLowerCase().indexOf('/github/');
      if (idx >= 0 && !mappedRel) mappedRel = normalizeRel(mappedAbs.slice(idx + '/github/'.length));
    }

    const repos = await this.getScannedRepos({ force: false });
    const repo = repos.find((r) => {
      const path = normalize(r?.path);
      const rel = normalizeRel(r?.relativePath);
      if (mappedAbs && path && path === mappedAbs) return true;
      if (mappedRel && rel && rel === mappedRel) return true;
      return false;
    }) || (repoSlugRaw ? repos.find((r) => String(r?.name || '').toLowerCase() === repoSlugRaw.split('/').slice(-1)[0].toLowerCase()) : null);

    if (!repo) {
      this.showToast('Mapped repo not found by scanner (/api/workspaces/scan-repos)', 'error');
      return;
    }

    const startTier = Number(tier);
    const startTierSafe = (startTier >= 1 && startTier <= 4) ? startTier : undefined;

    const agentConfig = this.buildAgentConfigForLaunch({ agentId, mode, yolo });
    const rawPrompt = String(promptText || card?.desc || '');
    const cardUrl = String(card?.url || '').trim();
    const cardShortLink = (cardUrl.match(/trello\.com\/c\/([a-zA-Z0-9]+)/)?.[1]) || '';
    const ticketProvider = String(provider || 'trello').trim().toLowerCase() || 'trello';
    const ticketCardId = cardShortLink || String(card?.id || '').trim();

    const preface = (cardUrl || ticketCardId) ? [
      `Task context: this work is for a ticket.`,
      cardUrl ? `Trello card: ${cardUrl}` : '',
      ticketCardId ? `Ticket id: trello:${ticketCardId}` : '',
      ``,
      `When you create/update a PR, include the Trello card URL in the PR description so automation can move the ticket on merge.`,
      ``
    ].filter(Boolean).join('\n') : '';

    const prompt = preface ? `${preface}\n${rawPrompt}` : rawPrompt;

    const recommended = this.getRecommendedWorktree(repo);

    if (!recommended && this.autoCreateExtraWorktreesWhenBusy) {
      const nextId = this.getNextWorktreeIdForRepo(repo);
      this.reserveWorktree(repo.path, nextId);
      this.pendingWorktreeLaunches.set(nextId, {
        promptText: prompt,
        autoSendPrompt: !!autoSendPrompt,
        agentConfig,
        ticket: (ticketProvider && ticketCardId) ? { provider: ticketProvider, cardId: ticketCardId, cardUrl } : null
      });
      try {
        await this.autoCreateExtraWorktreeForRepo(repo, { startTier: startTierSafe, worktreeId: nextId });
        this.showToast(`Creating ${repo.name} ${nextId} (work9+)`, 'success');
        return;
      } catch (e) {
        this.pendingWorktreeLaunches.delete(nextId);
        this.showToast(String(e?.message || e), 'error');
      }
    }

    if (!recommended) {
      this.showToast('All worktrees busy for this repo; open Quick Work to choose one', 'warning');
      await this.showQuickWorktreeModal();
      const modal = document.getElementById('quick-worktree-modal');
      const input = modal?.querySelector('#quick-worktree-search');
      if (input) {
        input.value = String(repo?.name || '');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return;
    }

    // Ensure we register the pending launch before emitting, to avoid races.
    this.reserveWorktree(repo.path, recommended.id);
    this.pendingWorktreeLaunches.set(recommended.id, {
      promptText: prompt,
      autoSendPrompt: !!autoSendPrompt,
      agentConfig,
      ticket: (ticketProvider && ticketCardId) ? { provider: ticketProvider, cardId: ticketCardId, cardUrl } : null
    });

	    if (!this.socket) {
	      this.pendingWorktreeLaunches.delete(recommended.id);
	      this.showToast('Socket not available', 'error');
	      return;
	    }
	    if (!this.socket.connected) {
	      this.showToast('Socket not connected (queued launch)', 'warning');
	    }

    this.socket.emit('add-worktree-sessions', {
      worktreeId: recommended.id,
      worktreePath: recommended.path,
      repositoryName: repo.name,
      repositoryType: repo.type,
      repositoryRoot: repo.path,
      startTier: startTierSafe
    });

    this.showToast(`Launching ${repo.name} ${recommended.id}`, 'success');
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

  closeTasksPanel() {
    const modal = this.tasksPanelModalEl || document.getElementById('tasks-panel');

    if (this.tasksWrapExpandResizeHandler) {
      window.removeEventListener('resize', this.tasksWrapExpandResizeHandler);
      this.tasksWrapExpandResizeHandler = null;
    }
    if (this.tasksWrapExpandResizeDebounce) {
      clearTimeout(this.tasksWrapExpandResizeDebounce);
      this.tasksWrapExpandResizeDebounce = null;
    }

    if (this.tasksPanelKeydownHandler) {
      document.removeEventListener('keydown', this.tasksPanelKeydownHandler);
      this.tasksPanelKeydownHandler = null;
    }

    if (modal) modal.remove();
    this.tasksPanelModalEl = null;
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
