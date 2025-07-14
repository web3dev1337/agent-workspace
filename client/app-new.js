// Enhanced Claude Orchestrator with sidebar and flexible viewing
class ClaudeOrchestrator {
  constructor() {
    this.sessions = new Map();
    this.activeView = [];
    this.socket = null;
    this.terminalManager = null;
    this.notificationManager = null;
    this.settings = this.loadSettings();
    this.currentLayout = '2x4';
    this.serverStatuses = new Map(); // Track server running status
    this.serverPorts = new Map(); // Track server ports
    
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
      
      // Explicitly connect to the server URL
      this.socket = io(window.location.origin, socketOptions);
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
      });
      
      this.socket.on('status-update', ({ sessionId, status }) => {
        this.updateSessionStatus(sessionId, status);
      });
      
      this.socket.on('branch-update', ({ sessionId, branch }) => {
        this.updateSessionBranch(sessionId, branch);
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

      this.socket.on('claude-update-required', (updateInfo) => {
        this.showClaudeUpdateRequired(updateInfo);
      });
      
      this.socket.on('server-started', ({ sessionId, port }) => {
        this.serverPorts.set(sessionId, port);
        console.log(`Server ${sessionId} started on port ${port}`);
        
        // First open localhost to trigger server initialization
        setTimeout(() => {
          const localhostUrl = `http://localhost:${port}`;
          console.log(`Opening localhost for initialization: ${localhostUrl}`);
          window.open(localhostUrl, '_blank');
          
          // Then open Hytopia after a short delay
          setTimeout(() => {
            this.playInHytopia(sessionId);
          }, 1000);
        }, 2000); // Wait 2 seconds for server to fully start
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
      'theme-select': null
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
    
    // Notification toggle - for now, just open settings to notification section
    document.getElementById('notification-toggle').addEventListener('click', () => {
      // Open settings panel
      document.getElementById('settings-panel').classList.remove('hidden');
      // Focus on notifications checkbox
      document.getElementById('enable-notifications').focus();
    });
  }
  
  handleInitialSessions(sessionStates) {
    console.log('Received initial sessions:', sessionStates);
    
    // Clear existing sessions
    this.sessions.clear();
    
    // Process sessions
    for (const [sessionId, state] of Object.entries(sessionStates)) {
      this.sessions.set(sessionId, {
        sessionId,
        ...state,
        hasUserInput: false
      });
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
      const item = document.createElement('div');
      item.className = 'worktree-item';
      item.dataset.worktreeId = worktreeId;
      
      const branch = worktree.claude?.branch || worktree.server?.branch || 'unknown';
      const worktreeNumber = worktreeId.replace('work', '');
      
      item.innerHTML = `
        <div class="worktree-header">
          <div class="worktree-title">${worktreeNumber} - ${branch}</div>
        </div>
        <div class="worktree-sessions">
          ${worktree.claude ? `
            <div class="session-status">
              <span class="session-icon">🤖</span>
              <span class="status-dot ${worktree.claude.status}"></span>
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
      
      worktreeList.appendChild(item);
    }
  }
  
  getServerStatusClass(sessionId) {
    const status = this.serverStatuses.get(sessionId);
    if (status === 'running') return 'running';
    if (status === 'error') return 'error';
    return 'idle';
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
          
          // Always clear the element first to avoid duplicates
          terminalEl.innerHTML = '';
          
          if (this.terminalManager.terminals.has(sessionId)) {
            // Don't re-open existing terminals, they're already attached
            // Just resize them
            this.terminalManager.fitTerminal(sessionId);
          } else {
            // Create new terminal only if it doesn't exist
            this.terminalManager.createTerminal(sessionId, session);
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
          <span class="terminal-branch">${session.branch || ''}</span>
        </div>
        <div class="terminal-controls">
          ${isClaudeSession ? `
            <button class="control-btn" onclick="window.orchestrator.restartClaudeSession('${sessionId}')" title="Restart Claude">↻</button>
          ` : ''}
          ${isServerSession ? `
            <button class="control-btn" id="server-toggle-${sessionId}" onclick="window.orchestrator.toggleServer('${sessionId}')" title="${this.serverStatuses.get(sessionId) === 'running' ? 'Stop Server' : 'Start Server & Open Hytopia'}">
              ${this.serverStatuses.get(sessionId) === 'running' ? '⏹' : '▶'}
            </button>
            <button class="control-btn danger" onclick="window.orchestrator.killServer('${sessionId}')" title="Force Kill">✕</button>
          ` : ''}
        </div>
      </div>
      <div class="terminal-body">
        <div class="terminal" id="terminal-${sessionId}"></div>
      </div>
      <div class="quick-actions" id="actions-${sessionId}"></div>
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
  
  updateSessionBranch(sessionId, branch) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.branch = branch;
    }
    
    // Update terminal branch display
    const terminalElement = document.querySelector(`#wrapper-${sessionId} .terminal-branch`);
    if (terminalElement) {
      terminalElement.textContent = branch || '';
    }
    
    // Update sidebar
    this.buildSidebar();
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
  toggleServer(sessionId) {
    const status = this.serverStatuses.get(sessionId);
    
    if (status === 'running') {
      // Stop server
      this.socket.emit('server-control', { sessionId, action: 'stop' });
      this.serverStatuses.set(sessionId, 'idle');
      this.serverPorts.delete(sessionId); // Clear port info
    } else {
      // Start server
      this.socket.emit('server-control', { sessionId, action: 'start' });
      // Don't set to running immediately - wait for confirmation
    }
    
    // Update button
    const button = document.getElementById(`server-toggle-${sessionId}`);
    if (button) {
      button.textContent = status === 'running' ? '▶' : '⏹';
    }
    
    // Update sidebar
    this.updateSidebarStatus(sessionId, status === 'running' ? 'idle' : 'running');
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
    const port = this.serverPorts.get(sessionId);
    if (!port) {
      console.error('No port found for server', sessionId);
      return;
    }
    
    const serverUrl = `localhost:${port}`;
    const hytopiaUrl = `https://hytopia.com/play/?${serverUrl}`;
    
    console.log(`Opening Hytopia for ${sessionId} at ${hytopiaUrl}`);
    window.open(hytopiaUrl, '_blank');
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
      <button class="control-btn" id="server-toggle-${sessionId}" onclick="window.orchestrator.toggleServer('${sessionId}')" title="${isRunning ? 'Stop Server' : 'Start Server & Open Hytopia'}">
        ${isRunning ? '⏹' : '▶'}
      </button>
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
  }
  
  handleSessionRestart(sessionId) {
    console.log(`Session ${sessionId} restarted`);
    // Terminal will automatically reconnect and show new content
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
}

// Initialize when DOM is ready
let orchestrator;
document.addEventListener('DOMContentLoaded', () => {
  orchestrator = new ClaudeOrchestrator();
  window.orchestrator = orchestrator; // Make globally available
});