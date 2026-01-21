// Dashboard component for workspace management

class Dashboard {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.workspaces = [];
    this.config = {};
    this.isVisible = false;
    this.quickLinks = null;
  }

  async show() {
    console.log('Showing dashboard...');

    // Initialize Quick Links if available
    if (window.QuickLinks && !this.quickLinks) {
      this.quickLinks = new QuickLinks(this.orchestrator);
      window.quickLinks = this.quickLinks; // Make available globally for onclick handlers
    }

    // Fetch quick links data - re-render when complete
    if (this.quickLinks) {
      this.quickLinks.fetchData().then(() => {
        // Re-render to show quick links once loaded
        if (this.isVisible) {
          this.render();
        }
      }).catch(() => {});
    }

    // Request workspaces from server
    this.orchestrator.socket.emit('list-workspaces');

    // Wait for workspace data
    this.orchestrator.socket.once('workspaces-list', (workspaces) => {
      console.log('Received workspaces:', workspaces);
      this.workspaces = workspaces;
      this.render();
      this.isVisible = true;
    });
  }

  hide() {
    const dashboard = document.getElementById('dashboard-container');
    if (dashboard) {
      dashboard.classList.add('hidden');
    }
    this.isVisible = false;
  }

  render() {
    // Create dashboard container if it doesn't exist
    let dashboard = document.getElementById('dashboard-container');
    if (!dashboard) {
      dashboard = document.createElement('div');
      dashboard.id = 'dashboard-container';
      dashboard.className = 'dashboard-container';
      document.body.appendChild(dashboard);
    }

    // Hide main content while showing dashboard
    const mainContainer = document.querySelector('.main-container');
    const sidebar = document.querySelector('.sidebar');
    if (mainContainer) mainContainer.classList.add('hidden');
    if (sidebar) sidebar.classList.add('hidden');

    // Render dashboard content
    dashboard.innerHTML = this.generateDashboardHTML();
    dashboard.classList.remove('hidden');

    // Set up event listeners
    this.setupEventListeners();

    // Set up quick links drag and drop
    if (this.quickLinks) {
      this.quickLinks.setupDragAndDrop();
    }

    // Load ports for dashboard
    this.loadDashboardPorts();
  }

  generateDashboardHTML() {
    const activeWorkspaces = this.workspaces.filter(ws => this.isWorkspaceActive(ws));
    const inactiveWorkspaces = this.workspaces.filter(ws => !this.isWorkspaceActive(ws));

    return `
      <div class="dashboard-header">
        <h1>🎯 Agent Orchestrator Dashboard</h1>
        <p>Select a workspace to begin development</p>
      </div>

      ${activeWorkspaces.length > 0 ? `
        <div class="dashboard-section">
          <h2>Active Workspaces</h2>
          <div class="workspace-grid">
            ${activeWorkspaces.map(ws => this.generateWorkspaceCard(ws, true)).join('')}
          </div>
        </div>
      ` : ''}

      <div class="dashboard-section">
        <h2>All Workspaces</h2>
        <div class="workspace-grid">
          ${inactiveWorkspaces.map(ws => this.generateWorkspaceCard(ws, false)).join('')}
          ${this.generateCreateWorkspaceCard()}
        </div>
      </div>

      <div class="dashboard-split-row">
        <div class="dashboard-section dashboard-half">
          <h2>🔗 Quick Links</h2>
          <div class="quick-links-grid">
            ${this.generateQuickLinksHTML()}
          </div>
        </div>

        <div class="dashboard-section dashboard-half ports-dashboard-section">
          <h2>🔌 Running Services</h2>
          <div class="ports-dashboard-grid" id="ports-dashboard-grid">
            <div class="ports-loading">Loading services...</div>
          </div>
        </div>
      </div>
    `;
  }

  generateWorkspaceCard(workspace, isActive) {
    const lastUsed = this.getLastUsed(workspace.id);
    const activityCount = this.getActivityCount(workspace.id);
    const terminalPairs = Array.isArray(workspace.terminals)
      ? Math.floor(workspace.terminals.length / 2)
      : (workspace.terminals?.pairs ?? 0);

    return `
      <div class="workspace-card ${isActive ? 'active' : ''}" data-workspace-id="${workspace.id}">
        <div class="workspace-card-header">
          <span class="workspace-icon">${workspace.icon}</span>
          <div class="workspace-info">
            <h3>${workspace.name}</h3>
            <p class="workspace-type">${this.getWorkspaceTypeLabel(workspace.type)}</p>
          </div>
        </div>

        <div class="workspace-card-body">
          <div class="workspace-stats">
            <div class="stat">
              <span class="stat-value">${activityCount}</span>
              <span class="stat-label">active</span>
            </div>
            <div class="stat">
              <span class="stat-value">${terminalPairs}</span>
              <span class="stat-label">terminals</span>
            </div>
          </div>

          <div class="workspace-meta">
            <p class="last-used">${lastUsed}</p>
            <p class="access-level">${this.getAccessLevelIcon(workspace.access)} ${workspace.access || 'private'}</p>
          </div>
        </div>

        <div class="workspace-card-footer">
          <button class="btn-primary workspace-open-btn">
            Open Workspace
          </button>
          <button class="btn-danger workspace-delete-btn" title="Delete workspace (keeps worktrees)">
            🗑️
          </button>
        </div>
      </div>
    `;
  }

  generateCreateWorkspaceCard() {
    return `
      <div class="workspace-card create-card">
        <div class="workspace-card-header">
          <span class="workspace-icon">➕</span>
          <div class="workspace-info">
            <h3>Create New</h3>
            <p class="workspace-type">Workspace</p>
          </div>
        </div>

        <div class="workspace-card-body">
          <p>Set up a new development environment</p>
        </div>

        <div class="workspace-card-footer">
          <button class="btn-primary workspace-create-btn">Create Workspace</button>
          <button class="btn-cta-empty workspace-create-empty-btn">One‑Click Empty</button>
        </div>
      </div>
    `;
  }

  generateQuickLinksHTML() {
    // Get globalShortcuts from config
    const globalShortcuts = this.orchestrator.orchestratorConfig?.globalShortcuts || [];

    // Check if QuickLinks has actual data
    const hasQuickLinksData = this.quickLinks &&
      (this.quickLinks.data?.favorites?.length > 0 ||
       this.quickLinks.data?.recentSessions?.length > 0 ||
       this.quickLinks.data?.customLinks?.length > 0);

    // If QuickLinks has data, use it alongside globalShortcuts
    if (hasQuickLinksData) {
      return this.quickLinks.generateDashboardHTML();
    }

    // Otherwise show globalShortcuts
    if (globalShortcuts.length === 0) {
      return '<div class="quick-links-empty">No links configured. Add shortcuts in Settings.</div>';
    }

    return globalShortcuts.map(shortcut => `
      <a href="${shortcut.url}" target="_blank" class="quick-link-item"
         title="${shortcut.label}">
        <span class="quick-link-icon">${shortcut.icon || '🔗'}</span>
        <span class="quick-link-label">${shortcut.label}</span>
      </a>
    `).join('') + `
      <button class="quick-link-item settings-link" onclick="window.orchestrator.showSettings()">
        <span class="quick-link-icon">⚙️</span>
        <span class="quick-link-label">Settings</span>
      </button>
      <button class="quick-link-item setup-link" onclick="window.dashboard.installWindowsStartup()" title="Setup auto-start on Windows login">
        <span class="quick-link-icon">🚀</span>
        <span class="quick-link-label">Setup Windows Startup</span>
      </button>
    `;
  }

  setupEventListeners() {
    // Workspace card click handlers
    document.querySelectorAll('.workspace-open-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = e.target.closest('.workspace-card');
        const workspaceId = card.dataset.workspaceId;
        this.openWorkspace(workspaceId);
      });
    });

    // Workspace delete handlers
    document.querySelectorAll('.workspace-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = e.target.closest('.workspace-card');
        const workspaceId = card.dataset.workspaceId;
        const workspace = this.workspaces.find(ws => ws.id === workspaceId);
        this.confirmDeleteWorkspace(workspace);
      });
    });

    // Create workspace button
    const createBtn = document.querySelector('.workspace-create-btn');
    if (createBtn) {
      createBtn.addEventListener('click', () => {
        this.showCreateWorkspaceWizard();
      });
    }

    const createEmptyBtn = document.querySelector('.workspace-create-empty-btn');
    if (createEmptyBtn) {
      createEmptyBtn.addEventListener('click', () => {
        this.createEmptyWorkspaceQuick();
      });
    }

    // ESC key to close dashboard (future feature)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isVisible) {
        // For now, just open the first workspace
        if (this.workspaces.length > 0) {
          this.openWorkspace(this.workspaces[0].id);
        }
      }
    });
  }

  async openWorkspace(workspaceId) {
    console.log('Opening workspace:', workspaceId);

    // Get recovery settings
    const recoverySettings = this.orchestrator.userSettings?.global?.sessionRecovery || {};
    const recoveryEnabled = recoverySettings.enabled !== false;
    const recoveryMode = recoverySettings.mode || 'ask';

    // Check for recovery state first (if enabled)
    if (recoveryEnabled) {
      const recoveryInfo = await this.checkRecoveryState(workspaceId);
      if (recoveryInfo && recoveryInfo.recoverableSessions > 0) {
        if (recoveryMode === 'auto') {
          // Auto-recover all sessions
          this.pendingRecovery = { mode: 'all', sessions: recoveryInfo.sessions };
          console.log('Auto-recovering all sessions');
        } else if (recoveryMode === 'ask') {
          // Show recovery dialog and wait for user choice
          const shouldRecover = await this.showRecoveryDialog(workspaceId, recoveryInfo);
          if (shouldRecover === 'cancel') {
            return; // User cancelled
          }
          this.pendingRecovery = shouldRecover;
        }
        // If mode === 'skip', don't set pendingRecovery
      }
    }

    // Show loading state
    const card = document.querySelector(`[data-workspace-id="${workspaceId}"]`);
    if (card) {
      const btn = card.querySelector('.workspace-open-btn');
      if (btn) {
        const originalText = btn.textContent;
        btn.textContent = 'Loading...';
        btn.disabled = true;

        // Restore button after timeout
        setTimeout(() => {
          if (btn) {
            btn.textContent = originalText;
            btn.disabled = false;
          }
        }, 5000);
      }
    }

    // Emit workspace switch event
    this.orchestrator.socket.emit('switch-workspace', { workspaceId });

    // Wait for workspace-changed event
    this.orchestrator.socket.once('workspace-changed', ({ workspace, sessions }) => {
      console.log('Workspace switched to:', workspace.name);

      // Hide dashboard
      this.hide();

      // Show main content
      const mainContainer = document.querySelector('.main-container');
      const sidebar = document.querySelector('.sidebar');
      if (mainContainer) mainContainer.classList.remove('hidden');
      if (sidebar) sidebar.classList.remove('hidden');

      // Update orchestrator with new workspace
      this.orchestrator.currentWorkspace = workspace;

      // Trigger UI rebuild with new sessions
      this.orchestrator.handleInitialSessions(sessions);
    });
  }

  showCreateWorkspaceWizard(options = {}) {
    console.log('Opening workspace creation wizard...');
    if (!window.WorkspaceWizard) {
      console.error('WorkspaceWizard not loaded');
      return;
    }

    const wizard = new WorkspaceWizard(this.orchestrator);
    wizard.show(options);
  }

  async createEmptyWorkspaceQuick() {
    try {
      const timestamp = new Date();
      const stamp = timestamp.toISOString().replace(/[:T]/g, '-').slice(0, 19);
      const name = `Empty Workspace ${timestamp.toLocaleString()}`;
      const baseId = `empty-${stamp}`;
      const randomSuffix = Math.random().toString(36).slice(2, 6);
      let workspaceId = `${baseId}-${randomSuffix}`;

      // Ensure ID is unique against current list
      const existingIds = new Set(this.workspaces.map(ws => ws.id));
      if (existingIds.has(workspaceId)) {
        workspaceId = `${baseId}-${Math.random().toString(36).slice(2, 8)}`;
      }

      const workspaceConfig = {
        id: workspaceId,
        name,
        type: 'custom',
        icon: '🧱',
        description: 'Empty workspace (add worktrees later)',
        access: 'private',
        empty: true,
        repository: {
          path: '',
          masterBranch: 'master',
          remote: ''
        },
        worktrees: {
          enabled: false,
          count: 0,
          namingPattern: 'work{n}',
          autoCreate: false
        },
        terminals: [],
        launchSettings: {
          type: 'custom',
          defaults: {
            envVars: '',
            nodeOptions: '',
            gameArgs: ''
          },
          perWorktree: {}
        },
        shortcuts: [],
        quickLinks: [],
        theme: {
          primaryColor: '#0ea5e9',
          icon: '🧱'
        },
        notifications: {
          enabled: true,
          background: true,
          types: {},
          priority: 'normal'
        },
        workspaceType: 'mixed-repo',
        layout: {
          type: 'dynamic',
          arrangement: 'auto'
        }
      };

      const serverUrl = window.location.port === '2080' ? 'http://localhost:3000' : window.location.origin;
      const response = await fetch(`${serverUrl}/api/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workspaceConfig)
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(error || 'Failed to create empty workspace');
      }

      const workspace = await response.json();
      this.workspaces.push(workspace);

      // Switch to new workspace
      this.openWorkspace(workspaceId);

      this.orchestrator.showTemporaryMessage(`Empty workspace "${name}" created`, 'success');
    } catch (error) {
      console.error('Failed to create empty workspace:', error);
      alert('Failed to create empty workspace: ' + error.message);
    }
  }

  // Helper methods
  isWorkspaceActive(workspace) {
    // For now, consider workspace active if it's the current one
    // In future, this could check for running sessions, recent activity, etc.
    return workspace.id === this.orchestrator.currentWorkspace?.id;
  }

  getLastUsed(workspaceId) {
    // Placeholder - in future, track actual usage
    if (workspaceId === 'hyfire2') return 'Last used: 2 hours ago';
    return 'Last used: 3 days ago';
  }

  getActivityCount(workspaceId) {
    // Placeholder - in future, track actual active sessions
    if (workspaceId === 'hyfire2') return '3/8';
    return '0/4';
  }

  getWorkspaceTypeLabel(type) {
    const typeLabels = {
      'hytopia-game': 'Hytopia Game',
      'monogame-game': 'MonoGame',
      'website': 'Website',
      'writing': 'Writing',
      'tool-project': 'Tool',
      'ruby-rails': 'Ruby on Rails'
    };
    return typeLabels[type] || type;
  }

  getAccessLevelIcon(access) {
    const icons = {
      'private': '🔒',
      'team': '👥',
      'public': '🌍'
    };
    return icons[access] || '🔒';
  }

  confirmDeleteWorkspace(workspace) {
    const confirmed = confirm(
      `⚠️ DELETE WORKSPACE?\n\n` +
      `Workspace: ${workspace.name}\n` +
      `Type: ${workspace.type}\n\n` +
      `This will:\n` +
      `✅ Delete the workspace configuration\n` +
      `✅ Keep all git worktrees and code intact\n` +
      `✅ Stop any running sessions\n\n` +
      `Are you sure?`
    );

    if (confirmed) {
      this.deleteWorkspace(workspace.id);
    }
  }

  async deleteWorkspace(workspaceId) {
    try {
      const serverUrl = window.location.port === '2080' ? 'http://localhost:3000' : window.location.origin;
      const response = await fetch(`${serverUrl}/api/workspaces/${workspaceId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        console.log(`Deleted workspace: ${workspaceId}`);

        // Remove from local array
        this.workspaces = this.workspaces.filter(ws => ws.id !== workspaceId);

        // Refresh dashboard
        this.show();

        // Show success message
        window.orchestrator?.showTemporaryMessage(`Workspace deleted successfully`, 'success');
      } else {
        const error = await response.text();
        console.error('Delete failed:', error);
        window.orchestrator?.showTemporaryMessage(`Failed to delete workspace: ${error}`, 'error');
      }
    } catch (error) {
      console.error('Error deleting workspace:', error);
      window.orchestrator?.showTemporaryMessage(`Error: ${error.message}`, 'error');
    }
  }

  async loadDashboardPorts() {
    const gridEl = document.getElementById('ports-dashboard-grid');
    if (!gridEl) return;

    const serverUrl = window.location.port === '2080' ? 'http://localhost:3000' :
                      window.location.port === '2081' ? 'http://localhost:4000' :
                      window.location.origin;

    try {
      const response = await fetch(`${serverUrl}/api/ports/scan`);
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();

      if (!data.ports || data.ports.length === 0) {
        gridEl.innerHTML = '<div class="ports-empty">No services currently running</div>';
        return;
      }

      gridEl.innerHTML = data.ports.map(p => {
        const context = p.project?.project
          ? `${p.project.project}${p.project.worktree ? ' • ' + p.project.worktree : ''}`
          : (p.cwd ? p.cwd.split('/').slice(-2).join('/') : '');

        return `
          <div class="port-dashboard-card ${p.type || ''}"
               onclick="window.open('${p.url}', '_blank')"
               title="${p.cwd || p.name}">
            <div class="port-card-icon">${p.icon || '❓'}</div>
            <div class="port-card-info">
              <span class="port-card-name">${p.name}</span>
              <span class="port-card-context">${context}</span>
            </div>
            <div class="port-card-port">:${p.port}</div>
          </div>
        `;
      }).join('');

    } catch (error) {
      console.error('Failed to load dashboard ports:', error);
      gridEl.innerHTML = '<div class="ports-empty">Failed to load services</div>';
    }
  }

  async installWindowsStartup() {
    const serverUrl = window.location.port === '2080' ? 'http://localhost:3000' :
                      window.location.port === '2081' ? 'http://localhost:4000' :
                      window.location.origin;

    // First check if we're on WSL
    try {
      const infoRes = await fetch(`${serverUrl}/api/startup/info`);
      const info = await infoRes.json();

      if (!info.isWSL) {
        alert('This feature is for Windows (WSL) only.\n\nFor native Linux, run:\n  scripts/linux/install-startup.sh');
        return;
      }

      if (!info.scriptsAvailable.windows) {
        alert('Windows startup scripts not found.\n\nMake sure scripts/windows/ exists in the repo.');
        return;
      }

      // Confirm installation
      const confirmed = confirm(
        '🚀 Setup Windows Startup\n\n' +
        'This will:\n' +
        '• Create a Windows Task Scheduler task\n' +
        '• Add a desktop shortcut\n' +
        '• Auto-start orchestrator on Windows login\n\n' +
        'The startup script waits for WSL to be ready before launching.\n\n' +
        'Continue?'
      );

      if (!confirmed) return;

      // Run the installer
      const response = await fetch(`${serverUrl}/api/startup/install-windows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        const result = await response.json();
        alert('✅ Windows Startup Setup Complete!\n\n' +
              'The orchestrator will now start automatically when you log into Windows.\n\n' +
              'A desktop shortcut was also created.');
        console.log('Startup install output:', result.output);
      } else {
        const error = await response.json();
        alert('❌ Setup Failed\n\n' + (error.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Failed to install Windows startup:', error);
      alert('❌ Setup Failed\n\n' + error.message);
    }
  }

  async checkRecoveryState(workspaceId) {
    const serverUrl = window.location.port === '2080' ? 'http://localhost:3000' :
                      window.location.port === '2081' ? 'http://localhost:4000' :
                      window.location.origin;

    try {
      const response = await fetch(`${serverUrl}/api/recovery/${encodeURIComponent(workspaceId)}`);
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      console.error('Failed to check recovery state:', error);
    }
    return null;
  }

  showRecoveryDialog(workspaceId, recoveryInfo) {
    return new Promise((resolve) => {
      // Remove existing dialog
      const existing = document.getElementById('recovery-dialog');
      if (existing) existing.remove();

      const sessions = recoveryInfo.sessions || [];
      const savedAt = recoveryInfo.savedAt ? new Date(recoveryInfo.savedAt).toLocaleString() : 'Unknown';

      const modal = document.createElement('div');
      modal.id = 'recovery-dialog';
      modal.className = 'modal recovery-modal';
      modal.innerHTML = `
        <div class="modal-content">
          <div class="recovery-header">
            <h2>🔄 Session Recovery</h2>
            <button class="close-btn" onclick="this.closest('.modal').remove()">×</button>
          </div>
          <div class="recovery-info">
            Found ${sessions.length} recoverable session${sessions.length !== 1 ? 's' : ''} from ${savedAt}
          </div>
          <div class="recovery-sessions">
            ${sessions.length === 0 ? '<div class="no-recovery">No sessions to recover</div>' :
              sessions.map((s, i) => `
                <div class="recovery-session" data-session-id="${s.sessionId}">
                  <input type="checkbox" class="recovery-checkbox" id="recover-${i}" checked>
                  <label for="recover-${i}" class="recovery-session-info">
                    <div class="recovery-session-id">${s.sessionId}</div>
                    <div class="recovery-session-details">
                      ${s.lastCwd ? `<span class="recovery-session-cwd">📁 ${s.lastCwd.split('/').slice(-2).join('/')}</span>` : ''}
                      ${s.lastAgent ? `<span class="recovery-session-agent">${s.lastAgent}</span>` : ''}
                      ${s.lastConversationId ? `<span>💬 ${s.lastConversationId.slice(0, 8)}...</span>` : ''}
                    </div>
                  </label>
                </div>
              `).join('')}
          </div>
          <div class="recovery-footer">
            <button class="btn-recovery btn-recovery-skip" id="recovery-skip">
              Skip Recovery
            </button>
            <div class="recovery-actions">
              <button class="btn-recovery btn-recovery-selected" id="recovery-selected">
                Recover Selected
              </button>
              <button class="btn-recovery btn-recovery-all" id="recovery-all">
                Recover All
              </button>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      // Event handlers
      modal.querySelector('.close-btn').onclick = () => {
        modal.remove();
        resolve('cancel');
      };

      modal.querySelector('#recovery-skip').onclick = () => {
        modal.remove();
        resolve({ mode: 'skip', sessions: [] });
      };

      modal.querySelector('#recovery-selected').onclick = () => {
        const selected = [];
        modal.querySelectorAll('.recovery-session').forEach(el => {
          const checkbox = el.querySelector('.recovery-checkbox');
          if (checkbox.checked) {
            selected.push(sessions.find(s => s.sessionId === el.dataset.sessionId));
          }
        });
        modal.remove();
        resolve({ mode: 'selected', sessions: selected });
      };

      modal.querySelector('#recovery-all').onclick = () => {
        modal.remove();
        resolve({ mode: 'all', sessions: sessions });
      };

      // Toggle selection on row click
      modal.querySelectorAll('.recovery-session').forEach(el => {
        el.onclick = (e) => {
          if (e.target.tagName !== 'INPUT') {
            const checkbox = el.querySelector('.recovery-checkbox');
            checkbox.checked = !checkbox.checked;
            el.classList.toggle('selected', checkbox.checked);
          }
        };
      });
    });
  }
}

// Export for use in main app
window.Dashboard = Dashboard;
