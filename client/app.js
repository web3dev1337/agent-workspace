// Enhanced Claude Orchestrator with sidebar and flexible viewing
class ClaudeOrchestrator {
  constructor() {
    this.sessions = new Map();
    this.activeView = [];
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
      'grid-layout': null,
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
    
    // Sidebar worktree clicks
    if (elements['worktree-list']) {
      elements['worktree-list'].addEventListener('click', (e) => {
        const item = e.target.closest('.worktree-item');
        if (item) {
          const worktreeId = item.dataset.worktreeId;
          this.showWorktree(worktreeId);
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
    
    // Grid layout
    document.getElementById('grid-layout').addEventListener('change', (e) => {
      this.changeLayout(e.target.value);
    });
    
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
    
    // Claude startup modal handlers
    const startClaudeBtn = document.getElementById('start-claude');
    const cancelClaudeBtn = document.getElementById('cancel-claude-startup');
    
    if (startClaudeBtn) {
      startClaudeBtn.addEventListener('click', () => {
        this.handleClaudeStart();
      });
    }
    
    if (cancelClaudeBtn) {
      cancelClaudeBtn.addEventListener('click', () => {
        this.hideClaudeStartupModal();
      });
    }
    
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
    }
    
    // Hide loading message FIRST
    const loadingMessage = document.getElementById('loading-message');
    if (loadingMessage) {
      loadingMessage.style.display = 'none';
    }
    
    // Build sidebar
    this.buildSidebar();
    
    // Show default view (all terminals)
    this.showAllTerminals();
  }
  
  buildSidebar() {
    const worktreeList = document.getElementById('worktree-list');
    
    // Always ensure filter toggle exists and is updated FIRST
    this.ensureFilterToggleExists();
    
    // Clear and rebuild the worktree list
    worktreeList.innerHTML = '';
    
    // Group sessions by worktree
    const worktrees = new Map();
    
    for (const [sessionId, session] of this.sessions) {
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
      
      const item = document.createElement('div');
      item.className = `worktree-item ${!isActive ? 'inactive' : ''}`;
      item.dataset.worktreeId = worktreeId;
      
      const branch = worktree.claude?.branch || worktree.server?.branch || 'unknown';
      const worktreeNumber = worktreeId.replace('work', '');
      
      // Convert claude status for display (waiting -> ready for green color)
      const claudeDisplayStatus = worktree.claude?.status === 'waiting' ? 'ready' : worktree.claude?.status;
      
      item.innerHTML = `
        <div class="worktree-header">
          <div class="worktree-title">${worktreeNumber} - ${branch}</div>
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
      
      // Add click handler to show this worktree
      item.addEventListener('click', () => {
        this.showWorktree(worktreeId);
      });
      
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
    const activeSessions = [];
    
    // Find all sessions that belong to active worktrees
    for (const [sessionId, session] of this.sessions) {
      const worktreeId = session.worktreeId || sessionId.split('-')[0];
      if (this.isWorktreeActive(worktreeId)) {
        activeSessions.push(sessionId);
      }
    }
    
    if (activeSessions.length > 0) {
      this.showTerminals(activeSessions);
    } else {
      // No active sessions, show a message or default to all
      this.showAllTerminals();
    }
  }
  
  showWorktree(worktreeId) {
    const sessions = [];
    
    // Find Claude and server sessions for this worktree
    for (const [sessionId, session] of this.sessions) {
      if (session.worktreeId === worktreeId || sessionId.startsWith(worktreeId)) {
        sessions.push(sessionId);
      }
    }
    
    this.showTerminals(sessions);
    
    // Highlight active worktree
    document.querySelectorAll('.worktree-item').forEach(item => {
      item.classList.toggle('active', item.dataset.worktreeId === worktreeId);
    });
  }
  
  showAllTerminals() {
    // Get all sessions and create proper order: work1-claude, work1-server, work2-claude, work2-server, etc.
    const orderedSessions = [];
    for (let i = 1; i <= 8; i++) {
      const claudeId = `work${i}-claude`;
      const serverId = `work${i}-server`;
      
      if (this.sessions.has(claudeId)) {
        orderedSessions.push(claudeId);
      }
      if (this.sessions.has(serverId)) {
        orderedSessions.push(serverId);
      }
    }
    
    console.log('Showing all terminals in order:', orderedSessions);
    this.showTerminals(orderedSessions);
  }
  
  showClaudeOnly() {
    const sessions = Array.from(this.sessions.keys())
      .filter(id => id.includes('-claude'))
      .sort((a, b) => {
        const aNum = parseInt(a.match(/work(\d+)/)?.[1] || '0');
        const bNum = parseInt(b.match(/work(\d+)/)?.[1] || '0');
        return aNum - bNum;
      });
    this.showTerminals(sessions);
  }
  
  showServersOnly() {
    const sessions = Array.from(this.sessions.keys())
      .filter(id => id.includes('-server'))
      .sort((a, b) => {
        const aNum = parseInt(a.match(/work(\d+)/)?.[1] || '0');
        const bNum = parseInt(b.match(/work(\d+)/)?.[1] || '0');
        return aNum - bNum;
      });
    this.showTerminals(sessions);
  }
  
  applyPreset(preset) {
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
        this.showTerminals(['work1-claude', 'work1-server', 'work5-claude', 'work5-server']);
        break;
      case 'custom-claude':
        this.showTerminals(['work2-claude', 'work5-claude', 'work6-claude', 'work8-claude', 'work1-claude', 'work7-claude']);
        break;
    }
  }
  
  changeLayout(layout) {
    this.currentLayout = layout;
    const grid = document.getElementById('terminal-grid');
    
    // Remove all layout classes
    grid.className = 'terminal-grid';
    
    // Add new layout class
    if (layout !== '2x4') {
      grid.classList.add(`layout-${layout}`);
    }
    
    // Force re-render of terminals
    setTimeout(() => {
      this.activeView.forEach(sessionId => {
        if (this.terminalManager.terminals.has(sessionId)) {
          this.terminalManager.fitTerminal(sessionId);
        }
      });
    }, 100);
  }
  
  showTerminals(sessionIds) {
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
          
          // Auto-start Claude sessions with user settings after they're loaded
          if (sessionId.includes('-claude')) {
            this.waitForSettingsAndAutoStart(sessionId);
          }
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
          <button class="control-btn focus-btn" onclick="window.orchestrator.focusTerminal('${sessionId}')" title="Focus Terminal">🔍</button>
          <button class="control-btn" onclick="window.orchestrator.openReplayViewer('${sessionId}')" title="Open Replay Viewer">📹</button>
          ${isClaudeSession ? `
            <button class="control-btn claude-start-btn" id="claude-start-btn-${sessionId}" disabled onclick="window.orchestrator.autoStartClaude('${sessionId}')" title="Start Claude with Settings">🚀</button>
            <button class="control-btn" onclick="window.orchestrator.showClaudeStartupModal('${sessionId}')" title="Start Claude with Options">↻</button>
            <button class="control-btn" onclick="window.orchestrator.refreshTerminal('${sessionId}')" title="Refresh Terminal Display">🔄</button>
            <button class="control-btn review-btn" onclick="window.orchestrator.showCodeReviewDropdown('${sessionId}')" title="Assign Code Review">👥</button>
            ${this.getGitHubButtons(sessionId)}
          ` : ''}
          ${isServerSession ? `
            ${this.serverStatuses.get(sessionId) === 'running' ? 
              `<button class="control-btn" onclick="window.orchestrator.toggleServer('${sessionId}')" title="Stop Server">⏹</button>` :
              `<select class="control-btn env-select" onchange="window.orchestrator.toggleServer('${sessionId}', this.value); this.value='';" title="Start Server">
                <option value="" selected>▶</option>
                <option value="development">Dev</option>
                <option value="production">Prod</option>
              </select>`
            }
            ${this.serverStatuses.get(sessionId) === 'running' ? `
              <button class="control-btn" onclick="window.orchestrator.playInHytopia('${sessionId}')" title="Play in Hytopia">🎮</button>
              <button class="control-btn" onclick="window.orchestrator.copyLocalhostUrl('${sessionId}')" title="Copy HTTPS localhost URL">📋</button>
            ` : ''}
            <button class="control-btn" onclick="window.orchestrator.openHytopiaWebsite()" title="Open Hytopia Website">🌐</button>
            <button class="control-btn danger" onclick="window.orchestrator.killServer('${sessionId}')" title="Force Kill">✕</button>
          ` : ''}
        </div>
      </div>
      <div class="terminal-body">
        <div class="terminal" id="terminal-${sessionId}"></div>
        ${isClaudeSession ? `
          <div class="terminal-startup-ui" id="startup-ui-${sessionId}">
            <div class="startup-ui-content">
              <h3>🚀 Start Claude Session</h3>
              <div class="startup-options-inline">
                <div class="option-group-inline">
                  <label>Session Mode:</label>
                  <div class="radio-group-inline">
                    <label class="radio-option-inline">
                      <input type="radio" name="claude-mode-${sessionId}" value="fresh" checked>
                      <span>Fresh</span>
                    </label>
                    <label class="radio-option-inline">
                      <input type="radio" name="claude-mode-${sessionId}" value="continue">
                      <span>Continue</span>
                    </label>
                    <label class="radio-option-inline">
                      <input type="radio" name="claude-mode-${sessionId}" value="resume">
                      <span>Resume</span>
                    </label>
                  </div>
                </div>
                <div class="option-group-inline">
                  <label class="checkbox-option-inline">
                    <input type="checkbox" id="skip-permissions-${sessionId}" value="skip">
                    <span>Skip Permissions (YOLO mode)</span>
                  </label>
                </div>
                <button class="start-claude-inline" onclick="window.orchestrator.startClaudeFromTerminal('${sessionId}')">Start Claude</button>
              </div>
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
      
      // Don't mark fresh "waiting" sessions as active - they're just showing welcome screen
    }
    
    // Update quick actions for Claude sessions
    if (sessionId.includes('claude')) {
      this.updateQuickActions(sessionId, status);
      
      // Show notification when Claude becomes ready AFTER user input
      if (previousStatus === 'busy' && status === 'waiting' && session && session.hasUserInput) {
        this.showClaudeReadyNotification(sessionId);
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
    } else {
      // Start server with environment
      this.socket.emit('server-control', { sessionId, action: 'start', environment });
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
        const focusBtn = `<button class="control-btn focus-btn" onclick="window.orchestrator.focusTerminal('${sessionId}')" title="Focus Terminal">🔍</button>`;
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
    
    // Update controls HTML
    controlsDiv.innerHTML = `
      <button class="control-btn focus-btn" onclick="window.orchestrator.focusTerminal('${sessionId}')" title="Focus Terminal">🔍</button>
      ${isRunning ? 
        `<button class="control-btn" onclick="window.orchestrator.toggleServer('${sessionId}')" title="Stop Server">⏹` :
        `<select class="control-btn env-select" onchange="window.orchestrator.toggleServer('${sessionId}', this.value); this.value='';" title="Start Server">
          <option value="" selected>▶</option>
          <option value="development">Dev</option>
          <option value="production">Prod</option>
        </select>`
      }
      </button>
      ${isRunning ? `
        <button class="control-btn" onclick="window.orchestrator.playInHytopia('${sessionId}')" title="Play in Hytopia">🎮</button>
        <button class="control-btn" onclick="window.orchestrator.copyLocalhostUrl('${sessionId}')" title="Copy HTTPS localhost URL">📋</button>
      ` : ''}
      <button class="control-btn" onclick="window.orchestrator.openHytopiaWebsite()" title="Open Hytopia Website">🌐</button>
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
  }
  
  handleSessionRestart(sessionId) {
    console.log(`Session ${sessionId} restarted`);
    // Terminal will automatically reconnect and show new content
    
    // If it's a Claude session that restarted, show the startup UI
    if (sessionId.includes('-claude')) {
      const startupUI = document.getElementById(`startup-ui-${sessionId}`);
      if (startupUI) {
        startupUI.style.display = 'block';
      }
      
      // Enable the start button in menu strip
      const startBtn = document.getElementById(`claude-start-btn-${sessionId}`);
      if (startBtn) {
        startBtn.disabled = false;
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
    
    if (this.lastNotificationTime[sessionId] && (now - this.lastNotificationTime[sessionId]) < 5000) {
      console.log(`Rate limiting notification for ${sessionId}`);
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
  
  // Terminal Focus Feature
  focusTerminal(sessionId) {
    try {
      const terminalWrapper = document.getElementById(`wrapper-${sessionId}`);
      if (!terminalWrapper) {
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
      let effectiveSettings = { claudeFlags: { skipPermissions: false } };
      
      if (response.ok) {
        effectiveSettings = await response.json();
      } else {
        console.warn('Could not load effective settings, using defaults');
      }
      
      // Start Claude with effective settings
      const options = {
        mode: 'fresh', // Default to fresh for auto-start
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
      sessionInfo.textContent = `Session: ${sessionId.replace('-claude', '')}`;
      
      try {
        // Get effective settings for this session and pre-populate
        const response = await fetch(`/api/user-settings/effective/${sessionId}`);
        let effectiveSettings = { claudeFlags: { skipPermissions: false } };
        
        if (response.ok) {
          effectiveSettings = await response.json();
        }
        
        // Pre-populate form with effective settings
        document.querySelector('input[name="claude-mode"][value="fresh"]').checked = true;
        document.getElementById('skip-permissions').checked = effectiveSettings.claudeFlags.skipPermissions;
        
        console.log('Pre-populated modal with settings:', effectiveSettings);
        
      } catch (error) {
        console.error('Error loading effective settings for modal:', error);
        // Fall back to defaults
        document.querySelector('input[name="claude-mode"][value="fresh"]').checked = true;
        document.getElementById('skip-permissions').checked = false;
      }
      
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
  
  handleClaudeStart() {
    if (!this.pendingClaudeSession || !this.socket || !this.socket.connected) {
      return;
    }
    
    // Get selected options
    const mode = document.querySelector('input[name="claude-mode"]:checked')?.value || 'fresh';
    const skipPermissions = document.getElementById('skip-permissions')?.checked || false;
    
    // Send command to server
    this.socket.emit('start-claude', {
      sessionId: this.pendingClaudeSession,
      options: {
        mode: mode,
        skipPermissions: skipPermissions
      }
    });
    
    // Hide modal
    this.hideClaudeStartupModal();
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
    const effectiveSkipPermissions = hasOverride && hasOverride.claudeFlags 
      ? hasOverride.claudeFlags.skipPermissions
      : this.userSettings.global.claudeFlags.skipPermissions;

    div.innerHTML = `
      <div class="terminal-name">${sessionId}</div>
      <div class="terminal-controls">
        <label>
          <input type="checkbox" class="terminal-skip-permissions" 
                 data-session-id="${sessionId}" 
                 ${effectiveSkipPermissions ? 'checked' : ''}>
          Skip Permissions
        </label>
        ${hasOverride ? `
          <button class="clear-override-btn" data-session-id="${sessionId}" title="Use global setting">
            ↻
          </button>
        ` : ''}
      </div>
    `;

    // Add event listeners
    const checkbox = div.querySelector('.terminal-skip-permissions');
    checkbox.addEventListener('change', (e) => {
      this.updatePerTerminalSetting(sessionId, {
        claudeFlags: { skipPermissions: e.target.checked }
      });
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
}

// Initialize when DOM is ready
let orchestrator;
document.addEventListener('DOMContentLoaded', () => {
  orchestrator = new ClaudeOrchestrator();
  window.orchestrator = orchestrator; // Make globally available
});