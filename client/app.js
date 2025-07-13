// Main application controller
class ClaudeOrchestrator {
  constructor() {
    this.socket = null;
    this.terminals = new Map();
    this.sessions = new Map();
    this.terminalManager = null;
    this.notificationManager = null;
    this.settings = this.loadSettings();
    this.authToken = this.getAuthToken();
    
    this.init();
  }
  
  async init() {
    try {
      // Initialize managers
      this.terminalManager = new TerminalManager(this);
      this.notificationManager = new NotificationManager(this);
      
      // Setup UI event listeners
      this.setupUIListeners();
      
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
  
  connectToServer() {
    return new Promise((resolve, reject) => {
      const socketOptions = {};
      
      // Add auth token if available
      if (this.authToken) {
        socketOptions.auth = { token: this.authToken };
      }
      
      this.socket = io(socketOptions);
      
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
        this.handleInitialSessions(sessionStates);
      });
      
      this.socket.on('terminal-output', ({ sessionId, data }) => {
        this.terminalManager.handleOutput(sessionId, data);
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
      
      // Set timeout for connection
      setTimeout(() => {
        if (!this.socket.connected) {
          reject(new Error('Connection timeout'));
        }
      }, 10000);
    });
  }
  
  setupUIListeners() {
    // Notification toggle
    document.getElementById('notification-toggle').addEventListener('click', () => {
      this.toggleNotificationPanel();
    });
    
    // Settings toggle
    document.getElementById('settings-toggle').addEventListener('click', () => {
      this.toggleSettingsPanel();
    });
    
    // Clear notifications
    document.getElementById('clear-notifications').addEventListener('click', () => {
      this.notificationManager.clearAll();
    });
    
    // Close settings
    document.getElementById('close-settings').addEventListener('click', () => {
      this.toggleSettingsPanel(false);
    });
    
    // Settings changes
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
    
    // Modal actions
    document.getElementById('modal-yes').addEventListener('click', () => {
      this.handleModalAction('yes');
    });
    
    document.getElementById('modal-no').addEventListener('click', () => {
      this.handleModalAction('no');
    });
    
    document.getElementById('modal-cancel').addEventListener('click', () => {
      this.hideModal();
    });
    
    // Click outside panels to close
    document.addEventListener('click', (e) => {
      const notificationPanel = document.getElementById('notification-panel');
      const settingsPanel = document.getElementById('settings-panel');
      const notificationToggle = document.getElementById('notification-toggle');
      const settingsToggle = document.getElementById('settings-toggle');
      
      if (!notificationPanel.contains(e.target) && e.target !== notificationToggle) {
        notificationPanel.classList.add('hidden');
      }
      
      if (!settingsPanel.contains(e.target) && e.target !== settingsToggle) {
        settingsPanel.classList.add('hidden');
      }
    });
  }
  
  handleInitialSessions(sessionStates) {
    console.log('Received initial sessions:', sessionStates);
    
    // Create dashboard layout
    this.createDashboard();
    
    // Initialize each session
    for (const [sessionId, state] of Object.entries(sessionStates)) {
      this.sessions.set(sessionId, state);
      this.terminalManager.createTerminal(sessionId, state);
      this.updateSessionUI(sessionId, state);
    }
    
    // Update statistics
    this.updateStatistics();
  }
  
  createDashboard() {
    const dashboard = document.getElementById('dashboard');
    if (!dashboard) {
      console.error('Dashboard element not found');
      return;
    }
    
    // Remove loading message
    const loadingMessage = document.getElementById('loading-message');
    if (loadingMessage) {
      loadingMessage.remove();
    }
    
    dashboard.innerHTML = '';
    
    // Group sessions by worktree
    const worktrees = new Map();
    
    for (const [sessionId, state] of Object.entries(this.sessions.size > 0 ? Object.fromEntries(this.sessions) : {})) {
      const worktreeId = state.worktreeId || sessionId.split('-')[0];
      
      if (!worktrees.has(worktreeId)) {
        worktrees.set(worktreeId, []);
      }
      worktrees.get(worktreeId).push({ sessionId, ...state });
    }
    
    // If no sessions yet, create default structure
    if (worktrees.size === 0) {
      for (let i = 1; i <= 8; i++) {
        const worktreeId = `work${i}`;
        worktrees.set(worktreeId, [
          { sessionId: `${worktreeId}-claude`, type: 'claude' },
          { sessionId: `${worktreeId}-server`, type: 'server' }
        ]);
      }
    }
    
    // Create UI for each worktree
    for (const [worktreeId, sessions] of worktrees) {
      const container = this.createWorktreeContainer(worktreeId, sessions);
      dashboard.appendChild(container);
    }
  }
  
  createWorktreeContainer(worktreeId, sessions) {
    const container = document.createElement('div');
    container.className = 'worktree-container';
    container.id = `worktree-${worktreeId}`;
    
    // Header
    const header = document.createElement('div');
    header.className = 'worktree-header';
    header.innerHTML = `
      <h2 class="worktree-title">Worktree ${worktreeId.replace('work', '')}</h2>
      <div class="worktree-actions">
        <button class="icon-button" title="Restart sessions" onclick="orchestrator.restartWorktree('${worktreeId}')">🔄</button>
      </div>
    `;
    container.appendChild(header);
    
    // Terminal row
    const row = document.createElement('div');
    row.className = 'terminal-row';
    
    // Create terminal containers
    for (const session of sessions) {
      const terminalContainer = this.createTerminalContainer(session.sessionId, session);
      row.appendChild(terminalContainer);
    }
    
    container.appendChild(row);
    return container;
  }
  
  createTerminalContainer(sessionId, sessionInfo) {
    const container = document.createElement('div');
    container.className = 'terminal-container';
    container.id = `container-${sessionId}`;
    
    const isClaudeSession = sessionInfo.type === 'claude';
    
    container.innerHTML = `
      <div class="terminal-header">
        <span class="terminal-title">${isClaudeSession ? 'Claude AI' : 'Server'}</span>
        <span class="branch-name" id="branch-${sessionId}">Loading...</span>
        <span class="status-indicator idle" id="status-${sessionId}" title="idle"></span>
        ${isClaudeSession ? `<button class="restart-btn" onclick="window.orchestrator.restartClaudeSession('${sessionId}')" title="Restart Claude">↻</button>` : ''}
      </div>
      <div class="terminal-body">
        <div class="terminal" id="terminal-${sessionId}"></div>
      </div>
      <div class="quick-actions" id="actions-${sessionId}"></div>
    `;
    
    return container;
  }
  
  updateSessionStatus(sessionId, status) {
    const statusElement = document.getElementById(`status-${sessionId}`);
    if (statusElement) {
      statusElement.className = `status-indicator ${status}`;
      statusElement.title = status;
    }
    
    // Update session data
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = status;
    }
    
    // Update quick actions for Claude sessions
    if (sessionId.includes('claude')) {
      this.updateQuickActions(sessionId, status);
    }
    
    // Update statistics
    this.updateStatistics();
  }
  
  updateSessionBranch(sessionId, branch) {
    const branchElement = document.getElementById(`branch-${sessionId}`);
    if (branchElement) {
      branchElement.textContent = branch ? `(${branch})` : '';
    }
    
    // Update session data
    const session = this.sessions.get(sessionId);
    if (session) {
      session.branch = branch;
    }
  }
  
  updateQuickActions(sessionId, status) {
    const actionsElement = document.getElementById(`actions-${sessionId}`);
    if (!actionsElement) return;
    
    if (status === 'waiting') {
      actionsElement.innerHTML = `
        <button class="quick-action-button" onclick="orchestrator.sendQuickResponse('${sessionId}', 'y\\n')">Yes</button>
        <button class="quick-action-button danger" onclick="orchestrator.sendQuickResponse('${sessionId}', 'n\\n')">No</button>
        <button class="icon-button" onclick="orchestrator.showTerminalSearch('${sessionId}')" title="Search">🔍</button>
      `;
    } else {
      actionsElement.innerHTML = `
        <button class="icon-button" onclick="orchestrator.showTerminalSearch('${sessionId}')" title="Search">🔍</button>
      `;
    }
  }
  
  updateSessionUI(sessionId, state) {
    this.updateSessionStatus(sessionId, state.status || 'idle');
    this.updateSessionBranch(sessionId, state.branch || 'unknown');
  }
  
  sendQuickResponse(sessionId, response) {
    this.socket.emit('terminal-input', { sessionId, data: response });
  }
  
  sendTerminalInput(sessionId, data) {
    this.socket.emit('terminal-input', { sessionId, data });
  }
  
  resizeTerminal(sessionId, cols, rows) {
    this.socket.emit('terminal-resize', { sessionId, cols, rows });
  }
  
  showTerminalSearch(sessionId) {
    this.terminalManager.showSearch(sessionId);
  }
  
  restartWorktree(worktreeId) {
    if (confirm(`Restart all sessions for ${worktreeId}?`)) {
      [`${worktreeId}-claude`, `${worktreeId}-server`].forEach(sessionId => {
        this.socket.emit('restart-session', { sessionId });
      });
    }
  }
  
  handleSessionExit(sessionId, exitCode) {
    console.log(`Session ${sessionId} exited with code ${exitCode}`);
    
    // Update UI
    this.updateSessionStatus(sessionId, 'exited');
    
    // Show notification
    this.notificationManager.addNotification({
      type: 'session_exit',
      message: `Session ${sessionId} exited (code: ${exitCode})`,
      sessionId
    });
  }
  
  handleSessionRestart(sessionId) {
    console.log(`Session ${sessionId} restarted`);
    
    // Reset terminal
    this.terminalManager.clearTerminal(sessionId);
    
    // Update status
    this.updateSessionStatus(sessionId, 'idle');
  }
  
  updateStatistics() {
    let active = 0;
    let waiting = 0;
    let idle = 0;
    
    for (const [sessionId, session] of this.sessions) {
      if (sessionId.includes('claude')) {
        switch (session.status) {
          case 'busy':
            active++;
            break;
          case 'waiting':
            waiting++;
            break;
          case 'idle':
            idle++;
            break;
        }
      }
    }
    
    document.getElementById('active-count').textContent = active;
    document.getElementById('waiting-count').textContent = waiting;
    document.getElementById('idle-count').textContent = idle;
  }
  
  updateConnectionStatus(connected) {
    const statusElement = document.getElementById('connection-status');
    const dot = statusElement.querySelector('.status-dot');
    const text = statusElement.querySelector('span:last-child');
    
    if (connected) {
      dot.className = 'status-dot connected';
      text.textContent = 'Connected';
    } else {
      dot.className = 'status-dot disconnected';
      text.textContent = 'Disconnected';
    }
  }
  
  toggleNotificationPanel(show) {
    const panel = document.getElementById('notification-panel');
    if (show === undefined) {
      panel.classList.toggle('hidden');
    } else {
      panel.classList.toggle('hidden', !show);
    }
  }
  
  toggleSettingsPanel(show) {
    const panel = document.getElementById('settings-panel');
    if (show === undefined) {
      panel.classList.toggle('hidden');
    } else {
      panel.classList.toggle('hidden', !show);
    }
    
    // Update UI to match settings
    if (!panel.classList.contains('hidden')) {
      document.getElementById('enable-notifications').checked = this.settings.notifications;
      document.getElementById('enable-sounds').checked = this.settings.sounds;
      document.getElementById('auto-scroll').checked = this.settings.autoScroll;
      document.getElementById('theme-select').value = this.settings.theme;
    }
  }
  
  showModal(title, message, sessionId) {
    const modal = document.getElementById('quick-action-modal');
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').textContent = message;
    modal.dataset.sessionId = sessionId;
    modal.classList.remove('hidden');
  }
  
  hideModal() {
    const modal = document.getElementById('quick-action-modal');
    modal.classList.add('hidden');
    delete modal.dataset.sessionId;
  }
  
  handleModalAction(action) {
    const modal = document.getElementById('quick-action-modal');
    const sessionId = modal.dataset.sessionId;
    
    if (sessionId && action !== 'cancel') {
      const response = action === 'yes' ? 'y\n' : 'n\n';
      this.sendQuickResponse(sessionId, response);
    }
    
    this.hideModal();
  }
  
  showError(message) {
    // For now, use alert. Could be improved with a toast notification
    alert(`Error: ${message}`);
  }
  
  loadSettings() {
    const stored = localStorage.getItem('claude-orchestrator-settings');
    const defaults = {
      notifications: false,
      sounds: false,
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
}

// Initialize when DOM is ready
let orchestrator;
document.addEventListener('DOMContentLoaded', () => {
  orchestrator = new ClaudeOrchestrator();
  window.orchestrator = orchestrator; // Make globally available for restart buttons
});