// Dashboard component for workspace management

class Dashboard {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.workspaces = [];
    this.config = {};
    this.isVisible = false;
  }

  async show() {
    console.log('Showing dashboard...');

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
  }

  generateDashboardHTML() {
    const activeWorkspaces = this.workspaces.filter(ws => this.isWorkspaceActive(ws));
    const inactiveWorkspaces = this.workspaces.filter(ws => !this.isWorkspaceActive(ws));

    return `
      <div class="dashboard-header">
        <h1>🎯 Claude Orchestrator Dashboard</h1>
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

      <div class="dashboard-section">
        <h2>🔗 Quick Links</h2>
        <div class="quick-links-grid">
          ${this.generateQuickLinksHTML()}
        </div>
      </div>
    `;
  }

  generateWorkspaceCard(workspace, isActive) {
    const lastUsed = this.getLastUsed(workspace.id);
    const activityCount = this.getActivityCount(workspace.id);

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
              <span class="stat-value">${workspace.terminals?.pairs || 1}</span>
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
          <button class="btn-secondary workspace-create-btn">
            Create Workspace
          </button>
        </div>
      </div>
    `;
  }

  generateQuickLinksHTML() {
    const globalShortcuts = this.orchestrator.orchestratorConfig?.globalShortcuts || [];

    return globalShortcuts.map(shortcut => `
      <a href="${shortcut.url}" target="_blank" class="quick-link">
        <span class="quick-link-icon">${shortcut.icon}</span>
        <span class="quick-link-label">${shortcut.label}</span>
      </a>
    `).join('') + `
      <button class="quick-link settings-link" onclick="window.orchestrator.showSettings()">
        <span class="quick-link-icon">⚙️</span>
        <span class="quick-link-label">Settings</span>
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

    // Create workspace button
    const createBtn = document.querySelector('.workspace-create-btn');
    if (createBtn) {
      createBtn.addEventListener('click', () => {
        this.showCreateWorkspaceWizard();
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

    // Show loading state
    const card = document.querySelector(`[data-workspace-id="${workspaceId}"]`);
    if (card) {
      const btn = card.querySelector('.workspace-open-btn');
      const originalText = btn.textContent;
      btn.textContent = 'Loading...';
      btn.disabled = true;

      // Restore button after timeout
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      }, 5000);
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

  showCreateWorkspaceWizard() {
    console.log('Opening workspace creation wizard...');
    if (!window.WorkspaceWizard) {
      console.error('WorkspaceWizard not loaded');
      return;
    }

    const wizard = new WorkspaceWizard(this.orchestrator);
    wizard.show();
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
}

// Export for use in main app
window.Dashboard = Dashboard;