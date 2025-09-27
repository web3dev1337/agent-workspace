// Enhanced Claude Orchestrator with sidebar and flexible viewing
class ClaudeOrchestrator {
  constructor() {
    this.sessions = new Map();
    this.activeView = [];
    this.visibleTerminals = new Set(); // Track which terminals are visible
    this.socket = null;
    this.terminalManager = null;
    this.notificationManager = null;
    this.settings = this.loadSettings();
    this.userSettings = null; // Will be loaded from server
    this.currentLayout = '2x4';
    this.serverStatuses = new Map(); // Track server running status
    this.serverPorts = new Map(); // Track server ports
    this.githubLinks = new Map(); // Track GitHub PR/branch links per session
    this.sessionActivity = new Map(); // Track which sessions have been used
    this.showActiveOnly = false; // Filter toggle
    this.serverLaunchSettings = this.loadServerLaunchSettings(); // Server launch flags

    // Workspace management
    this.currentWorkspace = null;
    this.availableWorkspaces = [];
    this.orchestratorConfig = {};
    this.dashboard = null;
    this.workspaceSwitcher = null;
    this.isDashboardMode = false;

    this.init();
  }
  
  async init() {
    try {
      // Initialize managers
      this.terminalManager = new TerminalManager(this);
      this.notificationManager = new NotificationManager(this);
      
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
      
      // Connect to server - detect correct port
      const serverUrl = window.location.port === '2080' ? 'http://localhost:3000' : window.location.origin;
      this.socket = io(serverUrl, socketOptions);
      console.log('Socket created, waiting for connection...');
      
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
      this.socket.on('sessions', (sessionStates) => {
        console.log('Received sessions event:', sessionStates);
        this.handleInitialSessions(sessionStates);
      });
      
      this.socket.on('terminal-output', ({ sessionId, data }) => {
        this.terminalManager.handleOutput(sessionId, data);
        
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
      
      this.socket.on('claude-started', ({ sessionId }) => {
        // Hide the startup UI when Claude starts
        const startupUI = document.getElementById(`startup-ui-${sessionId}`);
        if (startupUI) {
          startupUI.style.display = 'none';
        }
        
        // Enable the start button now that Claude has started
        const startBtn = document.getElementById(`claude-start-btn-${sessionId}`);
        if (startBtn) {
          startBtn.disabled = false;
        }
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
      this.socket.on('workspace-info', ({ active, available, config }) => {
        console.log('Received workspace info:', { active, available, config });
        this.currentWorkspace = active;
        this.availableWorkspaces = available;
        this.orchestratorConfig = config;

        // Initialize workspace switcher
        this.workspaceSwitcher = new WorkspaceSwitcher(this);
        this.workspaceSwitcher.render();

        // Initialize dashboard if configured
        if (config.ui.startupDashboard && !active) {
          this.showDashboard();
        }
      });

      this.socket.on('workspace-changed', ({ workspace, sessions }) => {
        console.log('Workspace changed:', workspace.name);
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
        this.sessionActivity.clear();
        this.serverStatuses.clear();
        this.serverPorts.clear();
        this.githubLinks.clear();

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
      
      this.socket.on('branch-update', ({ sessionId, branch, remoteUrl, defaultBranch }) => {
        const session = this.sessions.get(sessionId);
        if (session) {
          session.branch = branch;
          session.remoteUrl = remoteUrl;
          session.defaultBranch = defaultBranch;
          console.log(`Branch updated for ${sessionId}: ${branch}`);
          
          // Update sidebar display
          this.buildSidebar();
        }
      });
      
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
        const item = e.target.closest('.worktree-item');
        if (item) {
          const worktreeId = item.dataset.worktreeId;

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
    
    // Clear existing sessions and activity tracking
    this.sessions.clear();
    this.sessionActivity.clear();
    this.visibleTerminals.clear();
    
    // Process sessions
    for (const [sessionId, state] of Object.entries(sessionStates)) {
      this.sessions.set(sessionId, {
        sessionId,
        ...state,
        hasUserInput: false
      });
      
      // If there's an existing PR, add it to GitHub links automatically
      if (state.existingPR) {
        const links = this.githubLinks.get(sessionId) || {};
        links.pr = state.existingPR;
        this.githubLinks.set(sessionId, links);
        console.log('Loaded existing PR for session:', sessionId, state.existingPR);
      }
      
      // All fresh sessions start as inactive - they need user interaction to become active
      this.sessionActivity.set(sessionId, 'inactive');
      
      // Add all terminals to visible set by default
      this.visibleTerminals.add(sessionId);
    }
    
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
  }

  checkAndApplyAutoStart() {
    if (!this.userSettings) {
      console.log('User settings not loaded yet, skipping auto-start');
      return;
    }

    // Check each Claude session for auto-start
    for (const [sessionId, session] of this.sessions) {
      if (sessionId.includes('-claude')) {
        const effectiveSettings = this.getEffectiveSettings(sessionId);

        if (effectiveSettings && effectiveSettings.autoStart && effectiveSettings.autoStart.enabled) {
          console.log(`Auto-start enabled for ${sessionId}`, effectiveSettings.autoStart);

          // Hide the startup UI
          const startupUI = document.getElementById(`startup-ui-${sessionId}`);
          if (startupUI) {
            startupUI.style.display = 'none';
          }

          // Apply auto-start with configured delay
          const delay = effectiveSettings.autoStart.delay || 500;
          const mode = effectiveSettings.autoStart.mode || 'fresh';
          const skipPermissions = effectiveSettings.claudeFlags.skipPermissions || false;

          setTimeout(() => {
            console.log(`Auto-starting Claude ${sessionId} with mode: ${mode}, skip: ${skipPermissions}`);
            this.startClaudeWithOptions(sessionId, mode, skipPermissions);
          }, delay);
        } else {
          // Show the startup UI if auto-start is not enabled
          console.log(`Auto-start disabled for ${sessionId}, showing UI`);
          const startupUI = document.getElementById(`startup-ui-${sessionId}`);
          if (startupUI) {
            startupUI.style.display = 'block';
          }
        }
      }
    }
  }
  
  buildSidebar() {
    const worktreeList = document.getElementById('worktree-list');
    
    // Always ensure filter toggle exists and is updated FIRST
    this.ensureFilterToggleExists();
    
    // Clear and rebuild the worktree list
    worktreeList.innerHTML = '';
    
    // Group sessions by worktree - ONLY for current workspace
    const worktrees = new Map();

    for (const [sessionId, session] of this.sessions) {
      // Only show sessions that belong to current workspace
      if (this.currentWorkspace && session.workspace && session.workspace !== this.currentWorkspace.id) {
        continue; // Skip sessions from other workspaces
      }

      const worktreeId = session.worktreeId || sessionId.split('-')[0];

      if (!worktrees.has(worktreeId)) {
        worktrees.set(worktreeId, {
          id: worktreeId,
          claude: null,
          server: null
        });
      }

      const worktree = worktrees.get(worktreeId);
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
      const claudeId = `${worktreeId}-claude`;
      const serverId = `${worktreeId}-server`;
      const isVisible = this.visibleTerminals.has(claudeId) || this.visibleTerminals.has(serverId);
      
      const item = document.createElement('div');
      // Only show visibility state, not activity state (activity filtering is handled separately)
      item.className = `worktree-item ${!isVisible ? 'hidden-terminal' : ''}`;
      item.dataset.worktreeId = worktreeId;
      item.title = 'Click to toggle • Ctrl+Click to show only this worktree';
      
      const branch = worktree.claude?.branch || worktree.server?.branch || 'unknown';
      const worktreeNumber = worktreeId.replace('work', '');
      
      // Convert claude status for display (waiting -> ready for green color)
      const claudeDisplayStatus = worktree.claude?.status === 'waiting' ? 'ready' : worktree.claude?.status;
      
      item.innerHTML = `
        <div class="worktree-header">
          <div class="worktree-title">
            <span class="visibility-indicator">${isVisible ? '👁' : '🚫'}</span>
            ${worktreeNumber} - ${branch}
          </div>
        </div>
        <div class="worktree-sessions">
          ${worktree.claude ? `
            <div class="session-status">
              <span class="session-icon">🤖</span>
              <span class="status-dot ${claudeDisplayStatus}"></span>
              <span>Claude</span>
            </div>
          ` : ''}
          ${worktree.server ? `
            <div class="session-status">
              <span class="session-icon">💻</span>
              <span class="status-dot ${this.getServerStatusClass(worktree.server.sessionId)}"></span>
              <span>Server</span>
            </div>
          ` : ''}
        </div>
      `;
      
      // Click handler is already attached via event delegation in setupEventListeners
      
      worktreeList.appendChild(item);
    }
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
  
  isWorktreeActive(worktreeId) {
    // Check if any session in this worktree has been marked as active
    const claudeSessionId = `${worktreeId}-claude`;
    const serverSessionId = `${worktreeId}-server`;
    
    return this.sessionActivity.get(claudeSessionId) === 'active' || 
           this.sessionActivity.get(serverSessionId) === 'active';
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
      const worktreeId = session.worktreeId || sessionId.split('-')[0];
      if (this.isWorktreeActive(worktreeId)) {
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

  showOnlyWorktree(worktreeId) {
    console.log(`Showing only worktree: ${worktreeId}`);

    // Clear all visible terminals first
    this.visibleTerminals.clear();

    // Add only this worktree's sessions
    const claudeId = `${worktreeId}-claude`;
    const serverId = `${worktreeId}-server`;

    if (this.sessions.has(claudeId)) {
      this.visibleTerminals.add(claudeId);
    }
    if (this.sessions.has(serverId)) {
      this.visibleTerminals.add(serverId);
    }

    // Update the grid to show only these terminals
    this.updateTerminalGrid();
    this.buildSidebar();
  }

  toggleWorktreeVisibility(worktreeId) {
    console.log(`Toggling visibility for worktree: ${worktreeId}`);

    // Find Claude and server sessions for this worktree
    const claudeId = `${worktreeId}-claude`;
    const serverId = `${worktreeId}-server`;
    const sessions = [];

    if (this.sessions.has(claudeId)) sessions.push(claudeId);
    if (this.sessions.has(serverId)) sessions.push(serverId);

    if (sessions.length === 0) {
      console.warn(`No sessions found for worktree ${worktreeId}`);
      return;
    }

    // Check if ANY session from this worktree is currently visible
    const anyVisible = sessions.some(id => this.visibleTerminals.has(id));

    // Log current state for debugging
    const claudeSession = this.sessions.get(claudeId);
    console.log(`Toggling ${worktreeId}: currently ${anyVisible ? 'visible' : 'hidden'}, Claude status: ${claudeSession?.status || 'unknown'}`);

    if (anyVisible) {
      // Hide terminals - allow hiding even if Claude is running (user wants to focus elsewhere)
      sessions.forEach(id => {
        this.visibleTerminals.delete(id);
      });
      console.log(`Hidden worktree ${worktreeId}`);
    } else {
      // Show terminals - add back to visible set
      sessions.forEach(id => {
        this.visibleTerminals.add(id);
      });
      console.log(`Shown worktree ${worktreeId}`);
    }

    // IMPORTANT: Must update the entire grid to recalculate layout
    // This will re-render with correct data-visible-count and apply proper CSS grid
    this.updateTerminalGrid();
    this.buildSidebar();
  }
  
  showWorktree(worktreeId) {
    // Legacy function - now just ensures worktree is visible
    const sessions = [];
    for (const [sessionId, session] of this.sessions) {
      if (session.worktreeId === worktreeId || sessionId.startsWith(worktreeId)) {
        sessions.push(sessionId);
        this.visibleTerminals.add(sessionId);
      }
    }
    
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
  
  updateTerminalGrid() {
    // Get ALL sessions in proper order
    const allSessions = [];
    for (let i = 1; i <= 8; i++) {
      const claudeId = `work${i}-claude`;
      const serverId = `work${i}-server`;
      
      if (this.sessions.has(claudeId)) {
        allSessions.push(claudeId);
      }
      if (this.sessions.has(serverId)) {
        allSessions.push(serverId);
      }
    }
    
    console.log('Rendering all terminals, will hide non-visible ones');
    this.renderTerminalsWithVisibility(allSessions);
  }
  
  renderTerminalsWithVisibility(sessionIds) {
    // Render all terminals but apply visibility
    this.activeView = sessionIds.filter(id => this.visibleTerminals.has(id));
    const grid = document.getElementById('terminal-grid');

    // Set the data attribute for dynamic layout based on visible count
    const visibleCount = this.activeView.length;
    grid.setAttribute('data-visible-count', visibleCount);

    // Clear grid
    grid.innerHTML = '';

    // Only create and add VISIBLE terminal elements to the grid
    // This ensures CSS nth-child selectors work correctly
    sessionIds.forEach((sessionId) => {
      const session = this.sessions.get(sessionId);
      if (session && this.visibleTerminals.has(sessionId)) {
        const wrapper = this.createTerminalElement(sessionId, session);
        grid.appendChild(wrapper);
      }
    });
    
    // Initialize terminals
    sessionIds.forEach((sessionId, index) => {
      const session = this.sessions.get(sessionId);
      if (session) {
        setTimeout(() => {
          const terminalEl = document.getElementById(`terminal-${sessionId}`);
          if (!terminalEl) return;
          
          if (this.terminalManager.terminals.has(sessionId)) {
            const term = this.terminalManager.terminals.get(sessionId);
            terminalEl.innerHTML = '';
            term.open(terminalEl);
            
            // Only fit if visible
            if (this.visibleTerminals.has(sessionId)) {
              // Add a small delay to ensure CSS grid has applied
              setTimeout(() => {
                this.terminalManager.fitTerminal(sessionId);
                term.refresh(0, term.rows - 1);
              }, 100);
            }
          } else {
            this.terminalManager.createTerminal(sessionId, session);
          }
          
          // Don't auto-start Claude - let user choose via modal or button
        }, 50 + (index * 25));
      }
    });

    // Force a resize after everything is rendered to ensure terminals fit properly
    setTimeout(() => {
      this.resizeAllVisibleTerminals();
    }, 500);
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
    const grid = document.getElementById('terminal-grid');
    
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
    const worktreeNumber = session.worktreeId.replace('work', '');
    
    wrapper.innerHTML = `
      <div class="terminal-header">
        <div class="terminal-title">
          <span class="status-indicator ${session.status}" id="status-${sessionId}"></span>
          <span>${isClaudeSession ? '🤖 Claude' : '💻 Server'} ${worktreeNumber}</span>
          <span class="terminal-branch ${(session.branch === 'master' || session.branch === 'main' || session.branch?.startsWith('master-') || session.branch?.startsWith('main-')) ? 'master-branch' : ''}">${session.branch || ''}</span>
        </div>
        <div class="terminal-controls">
          <button class="control-btn focus-btn" onclick="window.orchestrator.focusTerminal('${sessionId}')" title="Show Only This Worktree">🔍</button>
          <button class="control-btn" onclick="window.orchestrator.openReplayViewer('${sessionId}')" title="Open Replay Viewer">📹</button>
          ${isClaudeSession ? `
            <button class="control-btn claude-start-btn" id="claude-start-btn-${sessionId}" disabled onclick="window.orchestrator.autoStartClaude('${sessionId}')" title="Start Claude with Settings">🚀</button>
            <button class="control-btn" onclick="window.orchestrator.showClaudeStartupModal('${sessionId}')" title="Start Claude with Options">↻</button>
            <button class="control-btn" onclick="window.orchestrator.refreshTerminal('${sessionId}')" title="Refresh Terminal Display">🔄</button>
            <button class="control-btn review-btn" onclick="window.orchestrator.showCodeReviewDropdown('${sessionId}')" title="Assign Code Review">👥</button>
            <button class="control-btn" onclick="window.orchestrator.buildProduction('${sessionId}')" title="Build Production ZIP">📦</button>
            ${this.getGitHubButtons(sessionId)}
          ` : ''}
          ${isServerSession ? `
            ${this.serverStatuses.get(sessionId) === 'running' ?
              `<button class="control-btn" onclick="window.orchestrator.toggleServer('${sessionId}')" title="Stop Server">⏹</button>` :
              `<div class="server-launch-group">
                <select class="control-btn env-select" onchange="window.orchestrator.toggleServer('${sessionId}', this.value); this.value='custom';" title="Start Server">
                  <option value="">▶</option>
                  <option value="development">Dev</option>
                  <option value="production">Prod</option>
                  <option value="custom" selected>Custom...</option>
                </select>
                <button class="control-btn" onclick="window.orchestrator.showServerLaunchSettings('${sessionId}')" title="Launch Settings">⚙️</button>
              </div>`
            }
            ${this.serverStatuses.get(sessionId) === 'running' ? `
              <button class="control-btn" onclick="window.orchestrator.playInHytopia('${sessionId}')" title="Play in Hytopia">🎮</button>
              <button class="control-btn" onclick="window.orchestrator.copyLocalhostUrl('${sessionId}')" title="Copy HTTPS localhost URL">📋</button>
            ` : ''}
            <button class="control-btn" onclick="window.orchestrator.openHytopiaWebsite()" title="Open Hytopia Website">🌐</button>
            <button class="control-btn" onclick="window.orchestrator.buildProduction('${sessionId}')" title="Build Production ZIP">📦</button>
            <button class="control-btn danger" onclick="window.orchestrator.killServer('${sessionId}')" title="Force Kill">✕</button>
          ` : ''}
        </div>
      </div>
      <div class="terminal-body">
        <div class="terminal" id="terminal-${sessionId}"></div>
        ${isClaudeSession ? `
          <div class="terminal-startup-ui" id="startup-ui-${sessionId}">
            <div class="startup-ui-simple">
              <div class="startup-buttons-inline">
                <button class="startup-btn-inline" id="btn-fresh-${sessionId}" onclick="window.orchestrator.quickStartClaude('${sessionId}', 'fresh')">
                  <span class="btn-icon">🆕</span>
                  <span>Fresh</span>
                </button>
                <button class="startup-btn-inline" id="btn-continue-${sessionId}" onclick="window.orchestrator.quickStartClaude('${sessionId}', 'continue')">
                  <span class="btn-icon">➡️</span>
                  <span>Continue</span>
                </button>
                <button class="startup-btn-inline" id="btn-resume-${sessionId}" onclick="window.orchestrator.quickStartClaude('${sessionId}', 'resume')">
                  <span class="btn-icon">⏸️</span>
                  <span>Resume</span>
                </button>
              </div>
              <label class="yolo-toggle">
                <input type="checkbox" id="yolo-${sessionId}" onchange="window.orchestrator.updateYoloState('${sessionId}', this.checked)">
                <span class="yolo-label">🚀 YOLO Mode</span>
              </label>
            </div>
          </div>
        ` : ''}
      </div>
      <div class="quick-actions" id="actions-${sessionId}"></div>
    `;
    
    return wrapper;
  }
  
  updateSessionStatus(sessionId, status) {
    // Convert 'waiting' to 'ready' for better UX (green instead of orange)
    const displayStatus = status === 'waiting' ? 'ready' : status;

    const statusElement = document.getElementById(`status-${sessionId}`);
    if (statusElement) {
      statusElement.className = `status-indicator ${displayStatus}`;
      statusElement.title = displayStatus;
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
          // Only show the startup UI if auto-start is not enabled AND Claude is not already running
          // Check if this is the first time (not a status change from busy->waiting)
          if (previousStatus === 'idle' || !previousStatus) {
            const startupUI = document.getElementById(`startup-ui-${sessionId}`);
            if (startupUI) {
              startupUI.style.display = 'block';
            }
          }
        }
      }

      // Don't mark fresh "waiting" sessions as active - they're just showing welcome screen
    }
    
    // Update quick actions for Claude sessions
    if (sessionId.includes('claude')) {
      this.updateQuickActions(sessionId, status);

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
    const worktreeId = sessionId.split('-')[0];
    const isClaudeSession = sessionId.includes('-claude');
    
    const worktreeItem = document.querySelector(`[data-worktree-id="${worktreeId}"]`);
    if (worktreeItem) {
      const sessionStatus = worktreeItem.querySelector(`.session-status:${isClaudeSession ? 'first-child' : 'last-child'} .status-dot`);
      if (sessionStatus) {
        sessionStatus.className = `status-dot ${status}`;
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
  
  updateQuickActions(sessionId, status) {
    const actionsElement = document.getElementById(`actions-${sessionId}`);
    if (!actionsElement) return;
    
    if (status === 'waiting') {
      actionsElement.innerHTML = `
        <button class="button-primary" onclick="orchestrator.sendQuickResponse('${sessionId}', 'y\\n')">Yes</button>
        <button class="button-secondary danger" onclick="orchestrator.sendQuickResponse('${sessionId}', 'n\\n')">No</button>
      `;
    } else {
      actionsElement.innerHTML = '';
    }
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
    const githubUrlPattern = /https:\/\/github\.com\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+(?:\/[^\s\)\]\}\>\"\'\`]*)?/g;
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
        
        // Validate URL format
        try {
          new URL(url);
        } catch (e) {
          console.warn('Invalid GitHub URL detected:', url);
          return;
        }
        
        // Categorize the URL
        if (url.includes('/pull/') && url.match(/\/pull\/\d+\/?$/)) {
          links.pr = url;
          console.log('PR link detected:', url);
        } else if (url.includes('/commit/') && url.match(/\/commit\/[a-f0-9]+\/?$/)) {
          links.commit = url;
          console.log('Commit link detected:', url);
        } else if (url.includes('/tree/') || url.includes('/commits/')) {
          links.branch = url;
          console.log('Branch link detected:', url);
        }
      });
      
      this.githubLinks.set(sessionId, links);
      this.updateTerminalControls(sessionId);
    }
  }
  
  clearGitHubLinks(sessionId) {
    this.githubLinks.delete(sessionId);
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
      // Add some debugging
      console.log('Adding PR button for session:', sessionId, 'URL:', links.pr);
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
  
  updateServerControls(sessionId) {
    const wrapper = document.getElementById(`wrapper-${sessionId}`);
    if (!wrapper) return;

    const controlsDiv = wrapper.querySelector('.terminal-controls');
    if (!controlsDiv) return;

    const isRunning = this.serverStatuses.get(sessionId) === 'running';

    // Update controls HTML - restore full control set including settings button
    controlsDiv.innerHTML = `
      <button class="control-btn focus-btn" onclick="window.orchestrator.focusTerminal('${sessionId}')" title="Show Only This Worktree">🔍</button>
      ${isRunning ?
        `<button class="control-btn" onclick="window.orchestrator.toggleServer('${sessionId}')" title="Stop Server">⏹</button>` :
        `<div class="server-launch-group">
          <select class="control-btn env-select" onchange="window.orchestrator.toggleServer('${sessionId}', this.value); this.value='custom';" title="Start Server">
            <option value="">▶</option>
            <option value="development">Dev</option>
            <option value="production">Prod</option>
            <option value="custom" selected>Custom...</option>
          </select>
          <button class="control-btn" onclick="window.orchestrator.showServerLaunchSettings('${sessionId}')" title="Launch Settings">⚙️</button>
        </div>`
      }
      ${isRunning ? `
        <button class="control-btn" onclick="window.orchestrator.playInHytopia('${sessionId}')" title="Play in Hytopia">🎮</button>
        <button class="control-btn" onclick="window.orchestrator.copyLocalhostUrl('${sessionId}')" title="Copy HTTPS localhost URL">📋</button>
      ` : ''}
      <button class="control-btn" onclick="window.orchestrator.openHytopiaWebsite()" title="Open Hytopia Website">🌐</button>
      <button class="control-btn" onclick="window.orchestrator.buildProduction('${sessionId}')" title="Build Production ZIP">📦</button>
      <button class="control-btn danger" onclick="window.orchestrator.killServer('${sessionId}')" title="Force Kill">✕</button>
    `;
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
        console.log(`Marking ${sessionId} as active due to user input`);
        this.sessionActivity.set(sessionId, 'active');
        this.buildSidebar(); // Refresh to update grey/active state
      }
    }
    
    this.socket.emit('terminal-input', { sessionId, data });
  }
  
  sendQuickResponse(sessionId, response) {
    this.sendTerminalInput(sessionId, response);
  }
  
  resizeTerminal(sessionId, cols, rows) {
    if (this.socket && this.socket.connected) {
      this.socket.emit('terminal-resize', { sessionId, cols, rows });
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

      // Also show the startup UI again
      const startupUI = document.getElementById(`startup-ui-${sessionId}`);
      if (startupUI) {
        startupUI.style.display = 'block';
      }
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
        const startupUI = document.getElementById(`startup-ui-${sessionId}`);
        if (startupUI) {
          startupUI.style.display = 'block';
        }

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
    
    console.log(`🎉 Claude ${worktreeId} is ready for input!`);
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
    const defaults = {
      global: {
        envVars: 'AUTO_START_WITH_BOTS=true NODE_ENV=development',
        nodeOptions: '--max-old-space-size=4096',
        gameArgs: '--mode=casual --roundtime=60 --buytime=10 --warmup=5 --maxrounds=13 --teamsize=5'
      },
      perWorktree: {}
    };

    if (stored) {
      return { ...defaults, ...JSON.parse(stored) };
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

  launchDiffViewer(githubUrl) {
    // Parse GitHub URL to extract owner, repo, and PR/commit
    const prMatch = githubUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/);
    const commitMatch = githubUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/commit\/([a-f0-9]{40})/);
    
    let diffViewerUrl = 'http://localhost:7655';
    
    if (prMatch) {
      const [, owner, repo, pr] = prMatch;
      diffViewerUrl += `/pr/${owner}/${repo}/${pr}`;
    } else if (commitMatch) {
      const [, owner, repo, sha] = commitMatch;
      diffViewerUrl += `/commit/${owner}/${repo}/${sha}`;
    } else {
      this.showToast('Unable to parse GitHub URL', 'error');
      return;
    }
    
    // Open in new tab
    window.open(diffViewerUrl, '_blank');
    
    // Show info toast
    this.showToast('Opening Advanced Diff Viewer...', 'info');
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
      
      if (focusedTitle) focusedTitle.textContent = `${isClaudeSession ? '🤖 Claude' : '💻 Server'} ${worktreeNumber}`;
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
  
  quickStartClaude(sessionId, mode) {
    // Check if YOLO mode is enabled
    const yoloCheckbox = document.getElementById(`yolo-${sessionId}`);
    const skipPermissions = yoloCheckbox ? yoloCheckbox.checked : false;
    
    // Hide the startup UI
    const startupUI = document.getElementById(`startup-ui-${sessionId}`);
    if (startupUI) {
      startupUI.style.display = 'none';
    }
    
    // Start Claude with selected options
    this.startClaudeWithOptions(sessionId, mode, skipPermissions);
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
      this.updatePerTerminalSetting(sessionId, {
        ...currentOverride,
        claudeFlags: { skipPermissions: e.target.checked }
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

  async showAddWorktreeModal() {
    console.log('Opening Add Worktree modal...');

    // Fetch available repositories
    try {
      const response = await fetch('/api/workspaces/scan-repos');
      const allRepos = await response.json();
      this.showAdvancedAddWorktreeModal(allRepos);
    } catch (error) {
      console.error('Failed to fetch repositories:', error);
      this.showSimpleAddWorktreeModal();
    }
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
      <div class="modal-content large-modal">
        <div class="modal-header">
          <h3>Add Worktree to "${this.currentWorkspace.name}"</h3>
          <button class="close-btn" onclick="this.closest('.modal').remove()">✕</button>
        </div>
        <div class="modal-body">
          ${Object.entries(categories).map(([category, repos]) => `
            <div class="repo-category">
              <h4>${category}</h4>
              ${repos.map(repo => this.renderRepoWorktreeOptions(repo)).join('')}
            </div>
          `).join('')}
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  renderRepoWorktreeOptions(repo) {
    const getIcon = (type) => this.getProjectIcon(type);
    const worktreeOptions = [];
    for (let i = 1; i <= 8; i++) {
      const worktreeId = `work${i}`;
      const isInUse = this.isWorktreeInUse(repo.path, worktreeId);
      const statusIcon = isInUse ? '⚠️' : '✅';
      const statusText = isInUse ? 'In use' : 'Available';

      worktreeOptions.push(`
        <button class="worktree-option ${isInUse ? 'in-use' : 'available'}"
                onclick="window.orchestrator.addWorktreeToWorkspace('${repo.path}', '${worktreeId}', '${repo.type}', '${repo.name}')"
                ${isInUse ? 'disabled' : ''}>
          <span class="worktree-id">${worktreeId}</span>
          <span class="worktree-status">${statusIcon} ${statusText}</span>
        </button>
      `);
    }

    return `
      <div class="repo-section">
        <div class="repo-header">
          <span class="repo-icon">${getIcon(repo.type)}</span>
          <span class="repo-name">${repo.name}</span>
          <span class="repo-path">~/${repo.relativePath}</span>
        </div>
        <div class="worktree-grid">
          ${worktreeOptions.join('')}
        </div>
      </div>
    `;
  }

  isWorktreeInUse(repoPath, worktreeId) {
    // Check if worktree is in use by scanning current workspace
    for (const workspace of this.availableWorkspaces) {
      if (workspace.repository?.path === repoPath) {
        const currentPairs = workspace.terminals?.pairs || 1;
        const worktreeNum = parseInt(worktreeId.replace('work', ''));
        if (worktreeNum <= currentPairs) return true;
      }
    }
    return false;
  }

  async addWorktreeToWorkspace(repoPath, worktreeId, repoType, repoName) {
    try {
      console.log(`Adding ${worktreeId} from ${repoName} to workspace...`);

      const response = await fetch('/api/workspaces/add-mixed-worktree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: this.currentWorkspace.id,
          repositoryPath: repoPath,
          repositoryType: repoType,
          repositoryName: repoName,
          worktreeId: worktreeId
        })
      });

      if (response.ok) {
        this.showTemporaryMessage(`Added ${repoName} ${worktreeId} to workspace!`, 'success');
        document.getElementById('add-worktree-modal').remove();
        setTimeout(() => {
          this.socket.emit('switch-workspace', { workspaceId: this.currentWorkspace.id });
        }, 1000);
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
        this.showTemporaryMessage(`Worktree work${worktreeNumber} created successfully!`, 'success');

        // Update workspace config to include new terminal pair
        this.currentWorkspace.terminals.pairs = worktreeNumber;

        // Refresh the workspace to show new worktree
        setTimeout(() => {
          this.socket.emit('switch-workspace', { workspaceId: this.currentWorkspace.id });
        }, 1000);
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
}

// Initialize when DOM is ready
let orchestrator;
document.addEventListener('DOMContentLoaded', () => {
  orchestrator = new ClaudeOrchestrator();
  window.orchestrator = orchestrator; // Make globally available
});