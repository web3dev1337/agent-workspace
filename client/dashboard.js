// Dashboard component for workspace management
const normalizeDashboardPath = (value) => String(value || '').replace(/\\/g, '/');
const formatDashboardPathTail = (value, count = 2) => normalizeDashboardPath(value).split('/').filter(Boolean).slice(-count).join('/');

class Dashboard {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.workspaces = [];
    this.deletedWorkspaces = [];
    this.deletedWorkspacesExpanded = this.loadDeletedWorkspacesExpandedPreference();
    this.config = {};
    this.isVisible = false;
    this.quickLinks = null;
    this._escHandler = null;
    this._projectLaunchInFlight = false;
  }

  async show() {
    console.log('Showing dashboard...');

    // Initialize Quick Links if available
    if (window.QuickLinks && !this.quickLinks) {
      this.quickLinks = new QuickLinks(this.orchestrator);
      window.quickLinks = this.quickLinks; // Make available globally for onclick handlers
    }

    const visibility = this.orchestrator.getUiVisibilityConfig()?.dashboard || {};
    // Fetch quick links data - re-render when complete
    if (this.quickLinks && visibility.quickLinks !== false) {
      this.quickLinks.fetchData().then(() => {
        // Re-render to show quick links once loaded
        if (this.isVisible) {
          this.render();
        }
      }).catch(() => {});
    }

    await this.refreshWorkspaceCollections({ refresh: true, render: true });
    this.isVisible = true;
  }

  async refreshWorkspaceCollections({ refresh = true, render = false } = {}) {
    const workspacesPromise = new Promise((resolve) => {
      this.orchestrator.socket.once('workspaces-list', (workspaces) => {
        resolve(Array.isArray(workspaces) ? workspaces : []);
      });
      this.orchestrator.socket.emit('list-workspaces', { refresh });
    });

    const deletedWorkspacesPromise = fetch('/api/workspaces/deleted')
      .then((response) => response.ok ? response.json() : [])
      .catch(() => []);

    const [workspaces, deletedWorkspaces] = await Promise.all([
      workspacesPromise,
      deletedWorkspacesPromise
    ]);

    console.log('Received workspaces:', workspaces);
    this.workspaces = workspaces;
    this.deletedWorkspaces = Array.isArray(deletedWorkspaces) ? deletedWorkspaces : [];
    this.orchestrator.availableWorkspaces = workspaces;

    try {
      const withHealth = Array.isArray(workspaces) ? workspaces : [];
      const noisy = withHealth.filter((w) => (w?.health && (w.health.removedTerminals?.length || w.health.dedupedTerminalIds?.length)));
      if (noisy.length) {
        const count = noisy.reduce((sum, w) => sum + Number(w.health?.removedTerminals?.length || 0), 0);
        this.orchestrator.showToast?.(`Cleaned ${count} stale terminal entries from workspace configs`, 'info');
      }
    } catch {}

    if (render) {
      this.render();
    }

    return {
      workspaces: this.workspaces,
      deletedWorkspaces: this.deletedWorkspaces
    };
  }

  hide() {
    const dashboard = document.getElementById('dashboard-container');
    if (dashboard) {
      dashboard.classList.add('hidden');
    }
    this.isVisible = false;

    if (this._escHandler) {
      document.removeEventListener('keydown', this._escHandler);
      this._escHandler = null;
    }
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
    const visibility = this.orchestrator.getUiVisibilityConfig()?.dashboard || {};
    if (this.quickLinks && visibility.quickLinks !== false) {
      this.quickLinks.setupDragAndDrop();
    }

    // Load ports for dashboard
    if (visibility.runningServices !== false) {
      this.loadDashboardPorts();
    }

    // Load GitHub status
    this.loadGitHubStatus();

    // Load process status/telemetry/advice summaries
    if (visibility.processSection !== false) {
      this.loadDashboardProcessSummary();
    }
  }

  generateDashboardHTML() {
    const sortByLastAccess = (a, b) => {
      const aTime = a.lastAccess ? new Date(a.lastAccess).getTime() : 0;
      const bTime = b.lastAccess ? new Date(b.lastAccess).getTime() : 0;
      return bTime - aTime;
    };
    const activeWorkspaces = this.workspaces.filter(ws => this.isWorkspaceActive(ws)).sort(sortByLastAccess);
    const inactiveWorkspaces = this.workspaces.filter(ws => !this.isWorkspaceActive(ws)).sort(sortByLastAccess);
    const deletedWorkspaces = (Array.isArray(this.deletedWorkspaces) ? this.deletedWorkspaces : [])
      .slice()
      .sort((a, b) => {
        const aTime = a?.deletedAt ? new Date(a.deletedAt).getTime() : 0;
        const bTime = b?.deletedAt ? new Date(b.deletedAt).getTime() : 0;
        return bTime - aTime;
      });
    const canReturnToWorkspaces = !!(this.orchestrator.tabManager?.tabs?.size);
    const visibility = this.orchestrator.getUiVisibilityConfig()?.dashboard || {};
    const showProcessBanner = visibility.processBanner !== false;

    // SVG Icons replacing Emojis
    const svgIcon = (path, cls="dashboard-svg-icon") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
    const SVGS = {
      back: svgIcon('<path d="M19 12H5M12 19l-7-7 7-7"/>'),
      status: svgIcon('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'),
      telemetry: svgIcon('<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>'),
      details: svgIcon('<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>'),
      perf: svgIcon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
      polecats: svgIcon('<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/>'),
      hooks: svgIcon('<path d="M12 22v-5"/><path d="M9 7H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2"/><path d="M15 7h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><circle cx="12" cy="7" r="3"/>'),
      deacon: svgIcon('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
      tests: svgIcon('<path d="M9 2v2"/><path d="M15 2v2"/><path d="M12 2v10"/><path d="M5 20a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-4-4H9L5 8v12Z"/>'),
      export: svgIcon('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
      discord: svgIcon('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
      projects: svgIcon('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'),
      prs: svgIcon('<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/>'),
      health: svgIcon('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'),
      board: svgIcon('<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>'),
      advice: svgIcon('<path d="M12 2a5 5 0 0 0-5 5v2a5 5 0 0 0 5 5h0a5 5 0 0 0 5-5V7a5 5 0 0 0-5-5z"/><path d="M12 14v7"/><path d="M9 21h6"/>'),
      queue: svgIcon('<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>'),
      viz: svgIcon('<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>'),
      convoys: svgIcon('<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>'),
      suggestions: svgIcon('<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>'),
      distribution: svgIcon('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>'),
      readiness: svgIcon('<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'),
      workspace: svgIcon('<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>'),
      ensure: svgIcon('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 9.36l-7.1 7.1a2.12 2.12 0 0 1-3-3l7.1-7.1a6 6 0 0 1 9.36-7.94z"/>'),
      services: svgIcon('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>'),
      add: svgIcon('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
      quickLinks: svgIcon('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>')
    };

    const processCards = [
      visibility.statusCard !== false ? `
        <div class="dashboard-bento-card dashboard-status">
          <div class="dashboard-bento-header">
            ℹ️ <span class="dashboard-bento-title">Status</span>
          </div>
          <div id="dashboard-status-summary" class="dashboard-bento-body">Loading…</div>
        </div>
      ` : '',
      visibility.telemetryCard !== false ? `
        <div class="dashboard-bento-card dashboard-telemetry">
          <div class="dashboard-bento-header">
            📈 <span class="dashboard-bento-title">Telemetry</span>
          </div>
          <div id="dashboard-telemetry-summary" class="dashboard-bento-body">Loading…</div>
          <div class="dashboard-bento-actions">
            <button class="bento-btn" id="dashboard-open-telemetry-details" title="View trends">📈 Details</button>
            <button class="bento-btn" id="dashboard-open-performance" title="Resource usage">⚙ Perf</button>
            <button class="bento-btn" id="dashboard-open-hooks" title="Hook browser">🪝 Hooks</button>
            <button class="bento-btn" id="dashboard-open-deacon" title="Health dashboard">🛡 Deacon</button>
            <button class="bento-btn" id="dashboard-open-tests" title="Run tests">🧪 Tests</button>
            <button class="bento-btn" id="dashboard-export-telemetry" title="Export CSV">⬇ CSV</button>
            <button class="bento-btn" id="dashboard-export-telemetry-json" title="Export JSON">⬇ JSON</button>
          </div>
        </div>
      ` : '',
      visibility.polecatsCard !== false ? `
        <div class="dashboard-bento-card dashboard-polecats">
          <div class="dashboard-bento-header">
            🐾 <span class="dashboard-bento-title">Polecats</span>
          </div>
          <div id="dashboard-polecats-summary" class="dashboard-bento-body">Loading…</div>
          <div class="dashboard-bento-actions">
            <button class="bento-btn" id="dashboard-open-polecats-card" title="Open Polecats panel">🐾 Manage</button>
          </div>
        </div>
      ` : '',
      visibility.discordCard !== false ? `
        <div class="dashboard-bento-card dashboard-discord">
          <div class="dashboard-bento-header">
            🎮 <span class="dashboard-bento-title">Discord</span>
          </div>
          <div id="dashboard-discord-summary" class="dashboard-bento-body">Loading…</div>
          <div class="dashboard-bento-actions">
            <label class="bento-checkbox-label" title="Auto-start Discord bot">
              <input type="checkbox" id="dashboard-discord-autostart" /> Auto-start
            </label>
            <button class="bento-btn" id="dashboard-discord-ensure" title="Ensure Services">🧰 Ensure</button>
            <button class="bento-btn" id="dashboard-discord-process" title="Trigger processing">📥 Process</button>
            <button class="bento-btn" id="dashboard-discord-open-services" title="Open Services">↗ Services</button>
          </div>
        </div>
      ` : '',
      visibility.projectsCard !== false ? `
        <div class="dashboard-bento-card dashboard-projects">
          <div class="dashboard-bento-header">
            🗂 <span class="dashboard-bento-title">Projects</span>
          </div>
          <div id="dashboard-projects-summary" class="dashboard-bento-body">Loading…</div>
          <div class="dashboard-bento-actions">
            <button class="bento-btn" id="dashboard-open-prs" title="Pull Requests">🔀 PRs</button>
            <button class="bento-btn" id="dashboard-open-project-health" title="Health dashboard">🩺 Health</button>
            <button class="bento-btn" id="dashboard-open-project-board" title="Kanban board">🗂 Board</button>
          </div>
        </div>
      ` : '',
      visibility.adviceCard !== false ? `
        <div class="dashboard-bento-card dashboard-advice">
          <div class="dashboard-bento-header">
            🧠 <span class="dashboard-bento-title">Advice</span>
          </div>
          <div id="dashboard-advice-summary" class="dashboard-bento-body">Loading…</div>
          <div class="dashboard-bento-actions">
            <button class="bento-btn" id="dashboard-open-queue" title="Queue">📥 Queue</button>
            <button class="bento-btn" id="dashboard-open-queue-viz" title="Queue visualization">🧭 Viz</button>
            <button class="bento-btn" id="dashboard-open-convoys" title="Convoys">🚚 Convoys</button>
            <button class="bento-btn" id="dashboard-open-advice" title="Advice">🧠 Advice</button>
            <button class="bento-btn" id="dashboard-open-suggestions" title="Suggestions">✨ Hints</button>
            <button class="bento-btn" id="dashboard-open-distribution" title="Distribution">🎯 Dist</button>
          </div>
        </div>
      ` : '',
      visibility.readinessCard !== false ? `
        <div class="dashboard-bento-card dashboard-readiness">
          <div class="dashboard-bento-header">
            ✅ <span class="dashboard-bento-title">Readiness</span>
          </div>
          <div id="dashboard-readiness-summary" class="dashboard-bento-body">Loading…</div>
          <div class="dashboard-bento-actions">
            <button class="bento-btn" id="dashboard-open-readiness" title="Checklists">✅ Checklists</button>
          </div>
        </div>
      ` : ''
    ].filter(Boolean).join('');

    const processSection = processCards ? `
      <div class="dashboard-bento-section">
        <h2 class="dashboard-section-title">Process & Telemetry</h2>
        <div class="bento-grid">
          ${processCards}
        </div>
      </div>
    ` : '';

    const createSection = (visibility.createSection !== false) ? `
      <div class="dashboard-create-banner">
        <div class="dashboard-create-info">
          <div class="dashboard-create-title">✨ Get Started</div>
          <div class="dashboard-create-desc">Set up a new workspace environment to begin building.</div>
        </div>
        <button id="dashboard-add-workspace-btn" class="btn-primary workspace-create-empty-btn dashboard-create-btn">
          + Create Workspace
        </button>
      </div>
    ` : '';

    const quickLinksSection = (visibility.quickLinks !== false) ? `
      <div class="dashboard-bento-card dashboard-quick-links">
        <div class="dashboard-bento-header">
          🔗 <span class="dashboard-bento-title">Quick Links</span>
        </div>
        <div class="quick-links-grid">
          ${this.generateQuickLinksHTML()}
        </div>
      </div>
    ` : '';

    const runningServicesSection = (visibility.runningServices !== false) ? `
      <div class="dashboard-bento-card ports-dashboard-section">
        <div class="dashboard-bento-header">
          📈 <span class="dashboard-bento-title">Ports Running on Your Computer</span>
        </div>
        <div class="ports-dashboard-grid" id="ports-dashboard-grid">
          <div class="ports-loading">Loading ports...</div>
        </div>
      </div>
    ` : '';

    const activeSection = (visibility.workspacesActive !== false && activeWorkspaces.length > 0) ? `
      <div class="dashboard-bento-section">
        <h2 class="dashboard-section-title">Active Workspaces</h2>
        <div class="workspace-grid bento-workspace-grid">
          ${activeWorkspaces.map(ws => this.generateWorkspaceCard(ws, true)).join('')}
        </div>
      </div>
    ` : '';

    const allSection = (visibility.workspacesAll !== false) ? `
      <div class="dashboard-bento-section">
        <h2 class="dashboard-section-title">Inactive Workspaces</h2>
        <div class="workspace-grid bento-workspace-grid">
          ${inactiveWorkspaces.map(ws => this.generateWorkspaceCard(ws, false)).join('')}
        </div>
      </div>
    ` : '';

    const deletedSection = (visibility.workspacesDeleted !== false && deletedWorkspaces.length > 0) ? `
      <div class="dashboard-bento-section ${this.deletedWorkspacesExpanded ? '' : 'is-collapsed'}" data-dashboard-section="deleted-workspaces">
        <div class="dashboard-section-header-row">
          <button
            class="dashboard-section-toggle"
            type="button"
            data-dashboard-toggle="deleted-workspaces"
            aria-expanded="${this.deletedWorkspacesExpanded ? 'true' : 'false'}"
            aria-controls="dashboard-deleted-workspaces-content"
          >
            <span class="dashboard-section-chevron" aria-hidden="true">▾</span>
            <span class="dashboard-section-title">Recently Deleted</span>
            <span class="dashboard-section-count">${deletedWorkspaces.length}</span>
          </button>
          <button class="btn-secondary dashboard-deleted-delete-all-btn" type="button" title="Permanently delete all recently deleted workspaces">
            Permanently Delete All
          </button>
        </div>
        <div class="workspace-grid bento-workspace-grid dashboard-section-content" id="dashboard-deleted-workspaces-content" ${this.deletedWorkspacesExpanded ? '' : 'hidden'}>
          ${deletedWorkspaces.map((workspace) => this.generateDeletedWorkspaceCard(workspace)).join('')}
        </div>
      </div>
    ` : '';

    return `
      <div class="dashboard-wrapper">
        <div class="dashboard-topbar">
          ${canReturnToWorkspaces ? `<button class="dashboard-topbar-btn" id="dashboard-back-btn" title="Back to workspaces">← Back to workspaces</button>` : '<div></div>'}
          ${showProcessBanner ? `<div id="dashboard-process-banner" class="process-banner" title="WIP and queue status"></div>` : '<div></div>'}
        </div>
        
        <div class="dashboard-header-modern">
          <div class="dashboard-title-group">
            <div class="dashboard-title-icon" aria-hidden="true"></div>
            <div>
              <h1>Agent Workspace</h1>
            </div>
          </div>
        </div>

        <div class="dashboard-main-content">
          <div class="dashboard-content-left">
            ${createSection}
            ${processSection}
            ${activeSection}
            ${allSection}
            ${deletedSection}
          </div>
          <div class="dashboard-content-right">
            ${quickLinksSection}
            <div class="dashboard-bento-card" id="github-status-card" style="display:none">
              <div class="dashboard-bento-header">
                🐙 <span class="dashboard-bento-title">GitHub</span>
              </div>
              <div id="github-status-content" style="padding: 8px 12px; font-size: 0.85rem;"></div>
            </div>
            ${runningServicesSection}
          </div>
        </div>
      </div>
    `;
  }


  async loadDashboardProcessSummary() {
    const visibility = this.orchestrator.getUiVisibilityConfig()?.dashboard || {};
    const showStatus = visibility.statusCard !== false;
    const showTelemetry = visibility.telemetryCard !== false;
    const showPolecats = visibility.polecatsCard !== false;
    const showDiscord = visibility.discordCard !== false;
    const showProjects = visibility.projectsCard !== false;
    const showAdvice = visibility.adviceCard !== false;
    const showReadiness = visibility.readinessCard !== false;
    const showAny = showStatus || showTelemetry || showPolecats || showDiscord || showProjects || showAdvice || showReadiness;
    if (!showAny) return;

    const statusEl = document.getElementById('dashboard-status-summary');
	    const telemetryEl = document.getElementById('dashboard-telemetry-summary');
      const polecatsEl = document.getElementById('dashboard-polecats-summary');
      const discordEl = document.getElementById('dashboard-discord-summary');
	    const projectsEl = document.getElementById('dashboard-projects-summary');
	    const adviceEl = document.getElementById('dashboard-advice-summary');
	    const readinessEl = document.getElementById('dashboard-readiness-summary');

	    document.getElementById('dashboard-open-telemetry-details')?.addEventListener('click', (e) => {
	      e.preventDefault();
	      this.showTelemetryOverlay();
	    });
		    document.getElementById('dashboard-open-performance')?.addEventListener('click', (e) => {
		      e.preventDefault();
		      this.showPerformanceOverlay();
		    });
        document.getElementById('dashboard-open-polecats')?.addEventListener('click', (e) => {
          e.preventDefault();
          this.showPolecatOverlay().catch(() => {});
        });
        document.getElementById('dashboard-open-hooks')?.addEventListener('click', (e) => {
          e.preventDefault();
          this.showHooksOverlay().catch(() => {});
        });
        document.getElementById('dashboard-open-deacon')?.addEventListener('click', (e) => {
          e.preventDefault();
          this.showDeaconOverlay().catch(() => {});
        });
        document.getElementById('dashboard-open-polecats-card')?.addEventListener('click', (e) => {
          e.preventDefault();
          this.showPolecatOverlay().catch(() => {});
        });
        // Discord auto-start checkbox
        const discordAutostartCb = document.getElementById('dashboard-discord-autostart');
        if (discordAutostartCb) {
          // Load current setting
          try {
            const res = await fetch('/api/user-settings').catch(() => null);
            const settings = res ? await res.json().catch(() => ({})) : {};
            discordAutostartCb.checked = settings?.global?.ui?.discord?.autoEnsureServicesAtStartup === true;
          } catch { /* leave unchecked */ }

          discordAutostartCb.addEventListener('change', async (e) => {
            const enabled = !!e.target.checked;
            await this.orchestrator?.updateGlobalUserSetting?.('ui.discord.autoEnsureServicesAtStartup', enabled);
            if (enabled) {
              await this.ensureDiscordServices();
              await this.loadDashboardDiscordSummary(discordEl);
            }
          });
        }

        document.getElementById('dashboard-discord-ensure')?.addEventListener('click', async (e) => {
          e.preventDefault();
          await this.ensureDiscordServices();
          await this.loadDashboardDiscordSummary(discordEl);
        });
        document.getElementById('dashboard-discord-process')?.addEventListener('click', async (e) => {
          e.preventDefault();
          await this.processDiscordQueue();
          await this.loadDashboardDiscordSummary(discordEl);
        });
        document.getElementById('dashboard-discord-open-services')?.addEventListener('click', async (e) => {
          e.preventDefault();
          await this.openDiscordServicesWorkspace();
        });
		    document.getElementById('dashboard-open-tests')?.addEventListener('click', (e) => {
		      e.preventDefault();
		      try {
		        this.showTestOrchestrationOverlay();
		      } catch {}
		    });
			    document.getElementById('dashboard-export-telemetry')?.addEventListener('click', (e) => {
			      e.preventDefault();
			      const hours = Number(this._telemetrySummary?.lookbackHours ?? 24);
			      this.downloadTelemetryCsv(hours);
		    });
		    document.getElementById('dashboard-export-telemetry-json')?.addEventListener('click', (e) => {
		      e.preventDefault();
		      const hours = Number(this._telemetrySummary?.lookbackHours ?? 24);
		      this.downloadTelemetryJson(hours);
		    });
	    document.getElementById('dashboard-open-queue')?.addEventListener('click', (e) => {
	      e.preventDefault();
	      this.orchestrator?.showQueuePanel?.().catch?.(() => {});
	    });
    document.getElementById('dashboard-open-queue-viz')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.showQueueVizOverlay().catch(() => {});
    });
    document.getElementById('dashboard-open-convoys')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.showConvoysOverlay().catch(() => {});
    });
    document.getElementById('dashboard-open-prs')?.addEventListener('click', (e) => {
      e.preventDefault();
      try {
        this.orchestrator?.showPRsPanel?.();
      } catch {}
    });
    document.getElementById('dashboard-open-project-health')?.addEventListener('click', (e) => {
      e.preventDefault();
      try {
        this.showProjectHealthOverlay();
      } catch {}
    });
    document.getElementById('dashboard-open-project-board')?.addEventListener('click', (e) => {
      e.preventDefault();
      try {
        this.orchestrator?.projectsBoardUI?.show?.();
      } catch {}
    });
    document.getElementById('dashboard-open-advice')?.addEventListener('click', (e) => {
      e.preventDefault();
      try {
        this.orchestrator?.handleCommanderAction?.('open-advice', {});
      } catch {}
    });
    document.getElementById('dashboard-open-readiness')?.addEventListener('click', (e) => {
      e.preventDefault();
      try {
        this.showReadinessOverlay();
      } catch {}
    });
    document.getElementById('dashboard-open-suggestions')?.addEventListener('click', (e) => {
      e.preventDefault();
      try {
        this.showSuggestionsOverlay();
      } catch {}
    });
    document.getElementById('dashboard-open-distribution')?.addEventListener('click', (e) => {
      e.preventDefault();
      try {
        this.showDistributionOverlay();
      } catch {}
    });

    if (showPolecats) {
      try {
        this.updatePolecatSummary(polecatsEl);
      } catch {
        // ignore
      }
    }

    const escapeHtml = (value) => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

		    const renderAdvice = async ({ force = false } = {}) => {
      if (!adviceEl) return;
      adviceEl.textContent = 'Loading…';

      let adviceRes = null;
      let data = {};
      try {
        const url = new URL('/api/process/advice', window.location.origin);
        url.searchParams.set('mode', 'mine');
        if (force) url.searchParams.set('force', 'true');
        adviceRes = await fetch(url.toString()).catch(() => null);
        data = adviceRes ? await adviceRes.json().catch(() => ({})) : {};
      } catch {
        adviceRes = null;
        data = {};
      }

      if (adviceRes && adviceRes.ok) {
        const items = Array.isArray(data?.advice) ? data.advice : [];
        const m = data?.metrics || {};
        const reviewsCompleted = Number(m?.reviewsCompleted ?? 0);
        const needsFix = Number(m?.reviewsNeedsFix ?? 0);
        const blockedPrs = Number(m?.prsBlockedByDeps ?? 0);
        const needsFixRate = Number.isFinite(Number(m?.needsFixRate)) ? Number(m.needsFixRate) : null;
        const metricsHtml = `
          <div style="display:grid; gap:4px; margin-bottom:8px; opacity:0.92;">
            <div>Blocked PRs <strong>${blockedPrs}</strong></div>
            <div>Reviews <strong>${reviewsCompleted}</strong> • needs_fix <strong>${needsFix}</strong>${needsFixRate === null ? '' : ` • rate <strong>${Math.round(needsFixRate * 100)}%</strong>`}</div>
          </div>
        `;
        if (!items.length) {
          adviceEl.innerHTML = metricsHtml + '<div style="opacity:0.8;">No advice right now.</div>';
        } else {
          adviceEl.innerHTML = `
            ${metricsHtml}
            <ul style="margin:0;padding-left:18px;">
              ${items.slice(0, 3).map((a) => `<li><strong>${escapeHtml(a.title || '')}</strong> — ${escapeHtml(a.message || '')}</li>`).join('')}
            </ul>
          `;
        }
        return;
      }

      const statusText = adviceRes
        ? `HTTP ${Number(adviceRes.status || 0)}`
        : 'Network error';
      const errorText = String(data?.error || '').trim();
      adviceEl.innerHTML = `
        <div style="opacity:0.9;">Failed to load advice.</div>
        <div style="opacity:0.7; font-size:0.85rem; margin-top:4px;">${escapeHtml(statusText)}${errorText ? ` • ${escapeHtml(errorText)}` : ''}</div>
        <div style="margin-top:10px;">
          <button class="dashboard-topbar-btn" type="button" id="dashboard-advice-retry">↻ Retry</button>
        </div>
      `;
      adviceEl.querySelector('#dashboard-advice-retry')?.addEventListener('click', () => {
        renderAdvice({ force: true });
      });
    };

	    try {
	      const projectsBoardPromise = (showProjects && this.orchestrator?.getProjectsBoard)
	        ? this.orchestrator.getProjectsBoard({ force: false }).catch(() => null)
	        : Promise.resolve(null);
	      const scannedReposPromise = (showProjects && this.orchestrator?.getScannedRepos)
	        ? this.orchestrator.getScannedRepos({ force: false }).catch(() => [])
	        : Promise.resolve([]);

	      const [statusRes, telemetryRes, projectsRes, readinessRes, projectsBoardData, scannedRepos] = await Promise.all([
	        showStatus ? fetch('/api/process/status?mode=mine').catch(() => null) : Promise.resolve(null),
	        showTelemetry ? fetch('/api/process/telemetry').catch(() => null) : Promise.resolve(null),
	        showProjects ? fetch('/api/process/projects?mode=mine').catch(() => null) : Promise.resolve(null),
	        showReadiness ? fetch('/api/process/readiness/templates').catch(() => null) : Promise.resolve(null),
	        projectsBoardPromise,
	        scannedReposPromise
	      ]);

      if (showStatus && statusEl) {
        const data = statusRes ? await statusRes.json().catch(() => ({})) : {};
        if (statusRes && statusRes.ok) {
          const q = data?.qByTier || {};
          statusEl.innerHTML = `
            <div>WIP <strong>${Number(data?.wip ?? 0)}</strong> (${escapeHtml(data?.wipKind || 'workspaces')})</div>
            <div>T1 ${Number(q[1] ?? 0)} • T2 ${Number(q[2] ?? 0)} • T3 ${Number(q[3] ?? 0)} • T4 ${Number(q[4] ?? 0)}</div>
            <div>Level <strong>${escapeHtml(data?.level || 'ok')}</strong></div>
          `;
        } else {
          statusEl.textContent = 'Failed to load.';
        }
      }

	      if (showTelemetry && telemetryEl) {
	        const data = telemetryRes ? await telemetryRes.json().catch(() => ({})) : {};
		        if (telemetryRes && telemetryRes.ok) {
		          this._telemetrySummary = data;
		          const avgReview = data?.avgReviewSeconds ? `${Math.round(Number(data.avgReviewSeconds))}s` : '—';
		          const avgChars = Number.isFinite(Number(data?.avgPromptChars)) ? Math.round(Number(data.avgPromptChars)) : null;
		          const createdCount = Number(data?.createdCount ?? 0);
		          const doneCount = Number(data?.doneCount ?? 0);
		          const avgVerify = Number.isFinite(Number(data?.avgVerifyMinutes)) ? Math.round(Number(data.avgVerifyMinutes)) : null;
		          const oc = (data?.outcomeCounts && typeof data.outcomeCounts === 'object') ? data.outcomeCounts : {};
		          const needsFix = Number(oc?.needs_fix ?? 0);
		          telemetryEl.innerHTML = `
		            <div>Lookback <strong>${Number(data?.lookbackHours ?? 24)}h</strong></div>
		            <div>Avg review <strong>${escapeHtml(avgReview)}</strong></div>
		            <div>Avg prompt chars <strong>${avgChars === null ? '—' : avgChars}</strong></div>
		            <div>Created <strong>${createdCount}</strong> • Done <strong>${doneCount}</strong> • needs_fix <strong>${needsFix}</strong></div>
		            <div>Avg verify <strong>${avgVerify === null ? '—' : `${avgVerify}m`}</strong></div>
		          `;
		        } else {
		          telemetryEl.textContent = 'Failed to load.';
		        }
	      }

	      if (showProjects && projectsEl) {
	        const data = projectsRes ? await projectsRes.json().catch(() => ({})) : {};
	        const projectsBoard = projectsBoardData?.board && typeof projectsBoardData.board === 'object' ? projectsBoardData.board : null;
	        const scanned = Array.isArray(scannedRepos) ? scannedRepos : [];

	        const normalizeKey = (value) => (this.orchestrator?.normalizeProjectsBoardProjectKey?.(value) ?? String(value || '').trim().replace(/\\/g, '/'));

	        const boardHtml = (() => {
	          if (!projectsBoard || scanned.length === 0) return '';

	          const repoByKey = new Map();
	          for (const repo of scanned) {
	            const key = normalizeKey(repo?.relativePath);
	            if (!key) continue;
	            if (!repoByKey.has(key)) repoByKey.set(key, repo);
	          }
	          if (!repoByKey.size) return '';

	          const getOrderIndex = (columnId) => {
	            const raw = projectsBoard?.orderByColumn && typeof projectsBoard.orderByColumn === 'object'
	              ? projectsBoard.orderByColumn[columnId]
	              : null;
	            const order = Array.isArray(raw) ? raw : [];
	            const index = new Map();
	            order.forEach((k, i) => {
	              const key = normalizeKey(k);
	              if (!key || index.has(key)) return;
	              index.set(key, i);
	            });
	            return index;
	          };

	          const collect = (columnId) => {
	            const out = [];
	            for (const [key, repo] of repoByKey.entries()) {
	              const col = this.orchestrator?.getProjectsBoardColumnForProjectKey?.(key, projectsBoardData) || 'backlog';
	              if (col === columnId) out.push({ key, repo });
	            }
	            const index = getOrderIndex(columnId);
	            out.sort((a, b) => {
	              const aRank = index.has(a.key) ? index.get(a.key) : Number.POSITIVE_INFINITY;
	              const bRank = index.has(b.key) ? index.get(b.key) : Number.POSITIVE_INFINITY;
	              if (aRank !== bRank) return aRank - bRank;
	              return String(a.repo?.name || '').localeCompare(String(b.repo?.name || ''));
	            });
	            return out;
	          };

	          const shipNext = collect('next');
	          const active = collect('active');
	          const total = shipNext.length + active.length;
	          if (total === 0) return '';

	          const tagMap = projectsBoard?.tagsByProjectKey && typeof projectsBoard.tagsByProjectKey === 'object'
	            ? projectsBoard.tagsByProjectKey
	            : {};

	          const renderTile = (item) => {
	            const icon = this.orchestrator?.getProjectIcon?.(item?.repo?.type) || '📁';
	            const name = String(item?.repo?.name || item?.key || '').trim();
	            const key = normalizeKey(item?.key);
	            const category = String(item?.repo?.category || '').trim();
	            const type = String(item?.repo?.type || '').trim();
	            const subtitle = category ? `${category} • ${key}` : key;
	            const isLive = !!tagMap[key]?.live;
	            return `
	              <button type="button"
	                      class="dashboard-project-tile ${isLive ? 'is-live' : ''}"
	                      data-dashboard-start-project="${escapeHtml(key)}"
	                      data-project-type="${escapeHtml(type)}"
	                      title="Start worktree: ${escapeHtml(name)}">
	                <span class="dashboard-project-tile-icon">${escapeHtml(icon)}</span>
	                <span class="dashboard-project-tile-text">
	                  <span class="dashboard-project-tile-name">${escapeHtml(name)}</span>
	                  <span class="dashboard-project-tile-subtitle">${escapeHtml(subtitle)}</span>
	                </span>
	                ${isLive ? `<span class="dashboard-project-tile-live" title="Shipped">★</span>` : ''}
	              </button>
	            `;
	          };

	          const renderGroup = (label, list) => {
	            if (!list.length) return '';
	            return `
	              <div class="dashboard-project-group">
	                <div class="dashboard-project-group-title">${escapeHtml(label)} <span class="dashboard-project-group-count">${list.length}</span></div>
	                <div class="dashboard-project-grid">
	                  ${list.map(renderTile).join('')}
	                </div>
	              </div>
	            `;
	          };

	          return `
	            <div class="dashboard-projects-board">
	              ${renderGroup('Ship Next', shipNext)}
	              ${renderGroup('Active', active)}
	            </div>
	          `;
	        })();

	        const prSummaryHtml = (() => {
	          if (!(projectsRes && projectsRes.ok)) {
	            return `<div style="opacity:0.85;">Failed to load PR summary.</div>`;
	          }

	          const totals = data?.totals || {};
	          const repos = Array.isArray(data?.repos) ? data.repos : [];
	          const top = repos.slice(0, 6);

	          const pickWorstRisk = (counts) => {
	            const c = counts && typeof counts === 'object' ? counts : {};
	            if (Number(c.critical || 0) > 0) return 'critical';
	            if (Number(c.high || 0) > 0) return 'high';
	            if (Number(c.medium || 0) > 0) return 'medium';
	            if (Number(c.low || 0) > 0) return 'low';
	            return '';
	          };

	          const riskChip = (risk) => {
	            const r = String(risk || '').trim().toLowerCase();
	            if (!r) return '';
	            const cls = (r === 'critical' || r === 'high') ? 'level-warn' : '';
	            return `<span class="process-chip ${cls}">${escapeHtml(r)}</span>`;
	          };

	          return `
	            <div>Repos <strong>${Number(totals?.repos ?? top.length ?? 0)}</strong> • Open PRs <strong>${Number(totals?.prsOpen ?? 0)}</strong></div>
	            <div>Unreviewed <strong>${Number(totals?.prsUnreviewed ?? 0)}</strong> • Needs fix <strong>${Number(totals?.prsNeedsFix ?? 0)}</strong></div>
	            <div style="margin-top:8px; display:flex; flex-direction:column; gap:6px;">
	              ${top.length ? top.map((r) => {
	                const repo = String(r?.repo || '').trim();
	                const open = Number(r?.prsOpen ?? 0);
	                const unrev = Number(r?.prsUnreviewed ?? 0);
	                const avgReview = r?.telemetry?.avgReviewSeconds ? `${Math.round(Number(r.telemetry.avgReviewSeconds))}s` : '—';
	                const worstRisk = pickWorstRisk(r?.riskCounts);
	                return `
	                  <button class="btn-secondary" type="button" data-open-repo="${escapeHtml(repo)}" title="Open PRs filtered to ${escapeHtml(repo)}" style="width:100%; display:flex; justify-content:space-between; align-items:center; gap:10px;">
	                    <span style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(repo)} (${open} open, ${unrev} unrev)</span>
	                    <span style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
	                      ${worstRisk ? riskChip(worstRisk) : ''}
	                      <span style="opacity:0.8;">${escapeHtml(avgReview)}</span>
	                    </span>
	                  </button>
	                `;
	              }).join('') : `<div style="opacity:0.8;">No PRs found.</div>`}
	            </div>
	          `;
	        })();

	        projectsEl.innerHTML = `${boardHtml}${prSummaryHtml}`;

	        projectsEl.querySelectorAll('[data-dashboard-start-project]').forEach((btn) => {
	          btn.addEventListener('click', async () => {
	            if (this._projectLaunchInFlight) return;
	            const key = String(btn.getAttribute('data-dashboard-start-project') || '').trim();
	            if (!key) return;
	            this._projectLaunchInFlight = true;
	            btn.disabled = true;
	            try {
	              const currentId = String(this.orchestrator?.currentWorkspace?.id || '').trim();
	              const workspaces = Array.isArray(this.workspaces) ? this.workspaces : [];
	              const pickRecent = () => {
	                if (currentId) return currentId;
	                let best = null;
	                let bestTime = 0;
	                for (const ws of workspaces) {
	                  const t = ws?.lastAccess ? new Date(ws.lastAccess).getTime() : 0;
	                  if (!best || t > bestTime) {
	                    best = ws;
	                    bestTime = t;
	                  }
	                }
	                return String(best?.id || '').trim();
	              };

	              const targetId = pickRecent();
	              try { this.orchestrator?.hideDashboard?.(); } catch {}
	              if (targetId && targetId !== currentId) {
	                this.orchestrator?.switchToWorkspace?.(targetId);
	                await this.orchestrator?.waitForWorkspaceActive?.(targetId).catch(() => false);
	              }
	              await this.orchestrator?.startProjectWorktreeFromBoardKey?.(key);
	            } catch {
	              this.orchestrator?.showToast?.('Failed to start worktree', 'error');
	            } finally {
	              btn.disabled = false;
	              this._projectLaunchInFlight = false;
	            }
	          });
	        });

	        projectsEl.querySelectorAll('[data-open-repo]').forEach((btn) => {
	          btn.addEventListener('click', () => {
	            const repo = btn.getAttribute('data-open-repo') || '';
	            if (!repo) return;
	            try {
	              localStorage.setItem('prs-panel-repo', repo);
	            } catch {}
	            try {
	              this.orchestrator?.showPRsPanel?.();
	            } catch {}
	          });
	        });
	      }

      if (showReadiness && readinessEl) {
        const data = readinessRes ? await readinessRes.json().catch(() => ({})) : {};
        if (readinessRes && readinessRes.ok) {
          const templates = Array.isArray(data?.templates) ? data.templates : [];
          const titles = templates.map(t => String(t?.title || '').trim()).filter(Boolean);
          readinessEl.innerHTML = `
            <div>Templates <strong>${templates.length}</strong></div>
            <div style="opacity:0.9;">${escapeHtml(titles.slice(0, 5).join(' • ') || '—')}</div>
          `;
        } else {
          readinessEl.textContent = 'Failed to load.';
        }
      }

      if (showDiscord) {
        await this.loadDashboardDiscordSummary(discordEl);
      }
      if (showAdvice) {
        await renderAdvice({ force: false });
      }
		    } catch (error) {
		      if (showStatus && statusEl) statusEl.textContent = 'Failed to load.';
		      if (showTelemetry && telemetryEl) telemetryEl.textContent = 'Failed to load.';
		      if (showProjects && projectsEl) projectsEl.textContent = 'Failed to load.';
		      if (showReadiness && readinessEl) readinessEl.textContent = 'Failed to load.';
          if (showDiscord && discordEl) discordEl.textContent = 'Failed to load.';
		      if (showAdvice) await renderAdvice({ force: false });
		    }
		  }

      async ensureDiscordServices() {
        try {
          const res = await fetch('/api/discord/ensure-services', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          }).catch(() => null);
          if (!res || !res.ok) {
            this.orchestrator?.showTemporaryMessage?.('Failed to ensure Discord services', 'error');
            return null;
          }
          const data = await res.json().catch(() => ({}));
          this.orchestrator?.showTemporaryMessage?.('Discord services ensured', 'success');
          return data;
        } catch {
          this.orchestrator?.showTemporaryMessage?.('Failed to ensure Discord services', 'error');
          return null;
        }
      }

      async processDiscordQueue() {
        try {
          const res = await fetch('/api/discord/process-queue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          }).catch(() => null);
          const data = res ? await res.json().catch(() => ({})) : {};
          if (!res || !res.ok || data.ok === false) {
            this.orchestrator?.showTemporaryMessage?.(data?.message || 'Failed to process Discord queue', 'error');
            return null;
          }
          this.orchestrator?.showTemporaryMessage?.('Discord queue processing triggered', 'success');
          return data;
        } catch {
          this.orchestrator?.showTemporaryMessage?.('Failed to process Discord queue', 'error');
          return null;
        }
      }

      async openDiscordServicesWorkspace() {
        const status = await this.ensureDiscordServices();
        const workspaceId = status?.servicesWorkspaceId || 'services';
        return this.openWorkspace(workspaceId);
      }

      async loadDashboardDiscordSummary(el) {
        if (!el) return;
        el.textContent = 'Loading…';
        try {
          const res = await fetch('/api/discord/status').catch(() => null);
          const data = res ? await res.json().catch(() => ({})) : {};
          if (!res || !res.ok || data.ok === false) {
            el.textContent = 'Unavailable.';
            return;
          }

          const pending = Number(data?.queue?.pendingCount || 0);
          const pendingAt = data?.queue?.pendingUpdatedAt ? new Date(data.queue.pendingUpdatedAt).toLocaleString() : '—';
          const bot = data?.sessions?.botRunning ? 'running' : 'stopped';
          const proc = data?.sessions?.processorRunning ? 'running' : 'stopped';
          const ws = data?.workspace?.exists ? 'ok' : 'missing';

          el.innerHTML = `
            <div>Services workspace: <strong>${ws}</strong></div>
            <div>Bot: <strong>${bot}</strong> • Processor: <strong>${proc}</strong></div>
            <div>Queue: <strong>${pending}</strong> pending</div>
            <div style="opacity:0.75;">updated: ${pendingAt}</div>
          `;
        } catch {
          el.textContent = 'Unavailable.';
        }
      }

	    updatePolecatSummary(targetEl = null) {
      const el = targetEl || document.getElementById('dashboard-polecats-summary');
      if (!el) return;

      const sessionsMap = this.orchestrator?.sessions;
      const sessions = sessionsMap && typeof sessionsMap.values === 'function'
        ? Array.from(sessionsMap.values())
        : [];

      if (!sessions.length) {
        el.textContent = 'No sessions.';
        return;
      }

      const byType = { claude: 0, codex: 0, server: 0, other: 0 };
      const byStatus = {};

      for (const s of sessions) {
        const type = String(s?.type || '').trim().toLowerCase();
        if (type === 'claude') byType.claude += 1;
        else if (type === 'codex') byType.codex += 1;
        else if (type === 'server') byType.server += 1;
        else byType.other += 1;

        const status = String(s?.status || 'idle').trim().toLowerCase() || 'idle';
        byStatus[status] = (byStatus[status] || 0) + 1;
      }

      const total = sessions.length;
      const busy = byStatus.busy || 0;
      const waiting = byStatus.waiting || 0;
      const idle = byStatus.idle || 0;
      const otherStatuses = Object.entries(byStatus)
        .filter(([k]) => k !== 'busy' && k !== 'waiting' && k !== 'idle')
        .sort((a, b) => (b[1] || 0) - (a[1] || 0))
        .map(([k, v]) => `${k}:${v}`)
        .slice(0, 4)
        .join(' • ');

      el.innerHTML = `
        <div>Total <strong>${total}</strong></div>
        <div style="opacity:0.85; margin-top:4px;">
          Types: claude ${byType.claude} • codex ${byType.codex} • server ${byType.server}${byType.other ? ` • other ${byType.other}` : ''}
        </div>
        <div style="opacity:0.85; margin-top:4px;">
          Status: busy ${busy} • waiting ${waiting} • idle ${idle}${otherStatuses ? ` • ${otherStatuses}` : ''}
        </div>
      `;
	    }

		  async ensureProEntitlement(featureLabel) {
		    try {
		      const res = await fetch('/api/license/status');
		      const data = await res.json().catch(() => ({}));
		      const pro = data?.entitlements?.pro === true;
		      if (pro) return true;

		      const msg = featureLabel ? `${featureLabel} requires Pro.` : 'This feature requires Pro.';
		      this.orchestrator.showToast?.(msg, 'error');
		      this.orchestrator.showSettings?.();
		      return false;
		    } catch (err) {
		      this.orchestrator.showToast?.(`Failed to check license: ${String(err?.message || err)}`, 'error');
		      return false;
		    }
		  }

		  downloadTelemetryCsv(lookbackHours) {
		    const hours = Number(lookbackHours);
		    const safe = Number.isFinite(hours) && hours > 0 ? hours : 24;
		    const url = `/api/process/telemetry/export?format=csv&lookbackHours=${encodeURIComponent(String(safe))}`;
		    this.ensureProEntitlement('Telemetry export').then((ok) => {
		      if (!ok) return;
		      try {
		        const a = document.createElement('a');
		        a.href = url;
		        a.target = '_blank';
		        a.rel = 'noopener';
		        a.click();
		      } catch {
		        window.open(url, '_blank', 'noopener');
		      }
		    });
		  }

		  downloadTelemetryJson(lookbackHours) {
		    const hours = Number(lookbackHours);
		    const safe = Number.isFinite(hours) && hours > 0 ? hours : 24;
		    const url = `/api/process/telemetry/export?format=json&lookbackHours=${encodeURIComponent(String(safe))}`;
		    this.ensureProEntitlement('Telemetry export').then((ok) => {
		      if (!ok) return;
		      try {
		        const a = document.createElement('a');
		        a.href = url;
		        a.target = '_blank';
		        a.rel = 'noopener';
		        a.click();
		      } catch {
		        window.open(url, '_blank', 'noopener');
		      }
		    });
		  }

	  showTelemetryOverlay() {
	    const existing = document.getElementById('dashboard-telemetry-overlay');
	    if (existing) {
	      existing.classList.remove('hidden');
	      return;
	    }

	    const overlay = document.createElement('div');
	    overlay.id = 'dashboard-telemetry-overlay';
	    overlay.className = 'dashboard-telemetry-overlay';
	    overlay.innerHTML = `
	      <div class="dashboard-telemetry-panel" role="dialog" aria-label="Telemetry details">
	        <div class="dashboard-telemetry-header">
	          <div class="dashboard-telemetry-title">Telemetry — Trends & Export</div>
	          <button class="dashboard-topbar-btn" id="dashboard-telemetry-close" title="Close (Esc)">✕</button>
	        </div>
	        <div class="dashboard-telemetry-controls">
	          <label class="dashboard-telemetry-field">
	            <span>Lookback</span>
	            <select id="dashboard-telemetry-lookback">
	              <option value="24">24h</option>
	              <option value="72">72h</option>
	              <option value="168">7d</option>
	              <option value="336">14d</option>
	            </select>
	          </label>
	          <label class="dashboard-telemetry-field">
	            <span>Bucket</span>
	            <select id="dashboard-telemetry-bucket">
	              <option value="15">15m</option>
	              <option value="30">30m</option>
	              <option value="60" selected>1h</option>
	              <option value="120">2h</option>
	              <option value="240">4h</option>
	            </select>
	          </label>
		          <div class="dashboard-telemetry-actions">
		            <button class="btn-secondary" type="button" id="dashboard-telemetry-refresh">Refresh</button>
		            <button class="btn-secondary" type="button" id="dashboard-telemetry-download">Download CSV</button>
		            <button class="btn-secondary" type="button" id="dashboard-telemetry-download-json">Download JSON</button>
		            <button class="btn-secondary" type="button" id="dashboard-telemetry-snapshot" title="Create a snapshot link for this telemetry view">Copy snapshot link</button>
		            <button class="btn-secondary" type="button" id="dashboard-telemetry-benchmark" title="Capture benchmark snapshot for release tracking">Capture benchmark</button>
		            <button class="btn-secondary" type="button" id="dashboard-telemetry-release-notes" title="Copy benchmark release-notes summary">Copy release notes</button>
		          </div>
		          <div class="dashboard-telemetry-actions" id="dashboard-telemetry-plugin-actions"></div>
		        </div>
		        <div id="dashboard-telemetry-body" class="dashboard-telemetry-body">Loading…</div>
		      </div>
		    `;

	    document.body.appendChild(overlay);

	    const close = () => this.hideTelemetryOverlay();
	    overlay.addEventListener('click', (e) => {
	      if (e.target === overlay) close();
	    });
	    overlay.querySelector('#dashboard-telemetry-close')?.addEventListener('click', close);

	    const lookbackEl = overlay.querySelector('#dashboard-telemetry-lookback');
	    const bucketEl = overlay.querySelector('#dashboard-telemetry-bucket');
	    const initialHours = Number(this._telemetrySummary?.lookbackHours ?? 24);
	    const maybeOption = overlay.querySelector(`#dashboard-telemetry-lookback option[value="${initialHours}"]`);
	    if (maybeOption) lookbackEl.value = String(initialHours);

	    overlay.querySelector('#dashboard-telemetry-download')?.addEventListener('click', () => {
	      const hours = Number(lookbackEl?.value ?? 24);
	      this.downloadTelemetryCsv(hours);
	    });
		    overlay.querySelector('#dashboard-telemetry-download-json')?.addEventListener('click', () => {
		      const hours = Number(lookbackEl?.value ?? 24);
		      this.downloadTelemetryJson(hours);
		    });
		    overlay.querySelector('#dashboard-telemetry-snapshot')?.addEventListener('click', async () => {
		      const hours = Number(lookbackEl?.value ?? 24);
		      const bucket = Number(bucketEl?.value ?? 60);
		      await this.createTelemetrySnapshotLink({ lookbackHours: hours, bucketMinutes: bucket });
		    });
		    overlay.querySelector('#dashboard-telemetry-benchmark')?.addEventListener('click', async () => {
		      const hours = Number(lookbackEl?.value ?? 24);
		      const bucket = Number(bucketEl?.value ?? 60);
		      await this.createTelemetryBenchmarkSnapshot({ lookbackHours: hours, bucketMinutes: bucket });
		    });
		    overlay.querySelector('#dashboard-telemetry-release-notes')?.addEventListener('click', async () => {
		      const hours = Number(lookbackEl?.value ?? 24);
		      const bucket = Number(bucketEl?.value ?? 60);
		      await this.copyTelemetryReleaseNotes({ lookbackHours: hours, bucketMinutes: bucket });
		    });
		    overlay.querySelector('#dashboard-telemetry-refresh')?.addEventListener('click', () => {
		      this.loadTelemetryDetails({ lookbackHours: Number(lookbackEl?.value ?? 24), bucketMinutes: Number(bucketEl?.value ?? 60) });
		    });
		    this.loadTelemetryPluginActions(overlay).catch(() => {});

	    const onKey = (e) => {
	      if (e.key !== 'Escape') return;
	      const el = document.getElementById('dashboard-telemetry-overlay');
	      if (!el || el.classList.contains('hidden')) return;
	      close();
	    };
	    overlay._escHandler = onKey;
	    document.addEventListener('keydown', onKey);

	    this.loadTelemetryDetails({ lookbackHours: Number(lookbackEl?.value ?? 24), bucketMinutes: Number(bucketEl?.value ?? 60) });
	  }

	  hideTelemetryOverlay() {
	    const overlay = document.getElementById('dashboard-telemetry-overlay');
	    if (!overlay) return;
	    overlay.classList.add('hidden');
	    const handler = overlay._escHandler;
	    if (handler) {
	      document.removeEventListener('keydown', handler);
	      overlay._escHandler = null;
	    }
	    overlay.remove();
	  }

	  async showPerformanceOverlay() {
	    const existing = document.getElementById('dashboard-performance-overlay');
	    if (existing) {
	      existing.classList.remove('hidden');
	      return;
	    }

	    const overlay = document.createElement('div');
	    overlay.id = 'dashboard-performance-overlay';
	    overlay.className = 'dashboard-telemetry-overlay';
	    overlay.innerHTML = `
	      <div class="dashboard-telemetry-panel" role="dialog" aria-label="Performance metrics">
	        <div class="dashboard-telemetry-header">
	          <div class="dashboard-telemetry-title">Performance — Sessions</div>
	          <button class="dashboard-topbar-btn" id="dashboard-performance-close" title="Close (Esc)">✕</button>
	        </div>
	        <div class="dashboard-telemetry-controls">
	          <div class="dashboard-telemetry-actions">
	            <button class="btn-secondary" type="button" id="dashboard-performance-refresh">Refresh</button>
	          </div>
	        </div>
	        <div id="dashboard-performance-body" class="dashboard-telemetry-body">Loading…</div>
	      </div>
	    `;

	    document.body.appendChild(overlay);

	    const close = () => this.hidePerformanceOverlay();
	    overlay.addEventListener('click', (e) => {
	      if (e.target === overlay) close();
	    });
	    overlay.querySelector('#dashboard-performance-close')?.addEventListener('click', close);

	    const onKey = (e) => {
	      if (e.key !== 'Escape') return;
	      const el = document.getElementById('dashboard-performance-overlay');
	      if (!el || el.classList.contains('hidden')) return;
	      close();
	    };
	    overlay._escHandler = onKey;
	    document.addEventListener('keydown', onKey);

	    overlay.querySelector('#dashboard-performance-refresh')?.addEventListener('click', () => {
	      this.loadPerformanceDetails();
	    });

	    await this.loadPerformanceDetails();
	  }

    async showQueueVizOverlay() {
      const existing = document.getElementById('dashboard-queue-viz-overlay');
      if (existing) {
        existing.classList.remove('hidden');
        return;
      }

      const overlay = document.createElement('div');
      overlay.id = 'dashboard-queue-viz-overlay';
      overlay.className = 'dashboard-telemetry-overlay';
      overlay.innerHTML = `
        <div class="dashboard-telemetry-panel" role="dialog" aria-label="Work queue visualization">
          <div class="dashboard-telemetry-header">
            <div class="dashboard-telemetry-title">Queue — Visualization</div>
            <button class="dashboard-topbar-btn" id="dashboard-queue-viz-close" title="Close (Esc)">✕</button>
          </div>
          <div class="dashboard-telemetry-controls">
            <div class="dashboard-telemetry-actions">
              <button class="btn-secondary" type="button" id="dashboard-queue-viz-open-queue">📥 Open Queue</button>
              <button class="btn-secondary" type="button" id="dashboard-queue-viz-refresh">Refresh</button>
            </div>
          </div>
          <div id="dashboard-queue-viz-body" class="dashboard-telemetry-body">Loading…</div>
        </div>
      `;

      document.body.appendChild(overlay);

      const close = () => this.hideQueueVizOverlay();
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
      });
      overlay.querySelector('#dashboard-queue-viz-close')?.addEventListener('click', close);
      overlay.querySelector('#dashboard-queue-viz-open-queue')?.addEventListener('click', () => {
        close();
        this.orchestrator?.showQueuePanel?.().catch?.(() => {});
      });
      overlay.querySelector('#dashboard-queue-viz-refresh')?.addEventListener('click', () => {
        this.loadQueueVizDetails().catch(() => {});
      });

      const onKey = (e) => {
        if (e.key !== 'Escape') return;
        const el = document.getElementById('dashboard-queue-viz-overlay');
        if (!el || el.classList.contains('hidden')) return;
        close();
      };
      overlay._escHandler = onKey;
      document.addEventListener('keydown', onKey);

      await this.loadQueueVizDetails();
    }

    hideQueueVizOverlay() {
      const overlay = document.getElementById('dashboard-queue-viz-overlay');
      if (!overlay) return;
      overlay.classList.add('hidden');
      const handler = overlay._escHandler;
      if (handler) {
        document.removeEventListener('keydown', handler);
        overlay._escHandler = null;
      }
      overlay.remove();
    }

    async loadQueueVizDetails() {
      const bodyEl = document.getElementById('dashboard-queue-viz-body');
      if (bodyEl) bodyEl.textContent = 'Loading…';

      let data = null;
      try {
        const url = new URL('/api/process/tasks', window.location.origin);
        url.searchParams.set('mode', 'all');
        url.searchParams.set('state', 'open');
        url.searchParams.set('include', 'dependencySummary');
        const res = await fetch(url.toString());
        data = res && res.ok ? await res.json().catch(() => null) : null;
      } catch {
        data = null;
      }

      if (!bodyEl) return;
      const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
      if (!data || !tasks) {
        bodyEl.textContent = 'Failed to load.';
        return;
      }

      const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      const tierKey = (t) => {
        const tier = t?.record?.tier;
        const n = Number(tier);
        return (Number.isFinite(n) && n >= 1 && n <= 4) ? `T${n}` : 'None';
      };

      const counts = { T1: 0, T2: 0, T3: 0, T4: 0, None: 0 };
      const unclaimed = { T1: 0, T2: 0, T3: 0, T4: 0, None: 0 };
      const unassigned = { T1: 0, T2: 0, T3: 0, T4: 0, None: 0 };
      const byAssignee = {};

      for (const t of tasks) {
        const k = tierKey(t);
        counts[k] = (counts[k] || 0) + 1;
        const claimedBy = String(t?.record?.claimedBy || '').trim();
        const assignedTo = String(t?.record?.assignedTo || '').trim();
        if (!claimedBy) unclaimed[k] = (unclaimed[k] || 0) + 1;
        if (!assignedTo) unassigned[k] = (unassigned[k] || 0) + 1;

        const bucket = assignedTo || '(unassigned)';
        if (!byAssignee[bucket]) byAssignee[bucket] = { T1: 0, T2: 0, T3: 0, T4: 0, None: 0, total: 0 };
        byAssignee[bucket][k] = (byAssignee[bucket][k] || 0) + 1;
        byAssignee[bucket].total += 1;
      }

      const assignees = Object.entries(byAssignee)
        .sort((a, b) => (b[1].total || 0) - (a[1].total || 0) || String(a[0]).localeCompare(String(b[0])));

      const rows = assignees.map(([who, c]) => {
        return `
          <tr>
            <td class="mono">${escapeHtml(who)}</td>
            <td class="mono">${escapeHtml(c.T1 || 0)}</td>
            <td class="mono">${escapeHtml(c.T2 || 0)}</td>
            <td class="mono">${escapeHtml(c.T3 || 0)}</td>
            <td class="mono">${escapeHtml(c.T4 || 0)}</td>
            <td class="mono">${escapeHtml(c.None || 0)}</td>
            <td class="mono">${escapeHtml(c.total || 0)}</td>
          </tr>
        `;
      }).join('');

      const sumRow = `
        <tr>
          <td class="mono"><strong>Total</strong></td>
          <td class="mono"><strong>${escapeHtml(counts.T1)}</strong></td>
          <td class="mono"><strong>${escapeHtml(counts.T2)}</strong></td>
          <td class="mono"><strong>${escapeHtml(counts.T3)}</strong></td>
          <td class="mono"><strong>${escapeHtml(counts.T4)}</strong></td>
          <td class="mono"><strong>${escapeHtml(counts.None)}</strong></td>
          <td class="mono"><strong>${escapeHtml(tasks.length)}</strong></td>
        </tr>
      `;

      bodyEl.innerHTML = `
        <div class="dashboard-telemetry-muted">
          Items: <strong>${escapeHtml(tasks.length)}</strong> • Unclaimed: <strong>${escapeHtml(Object.values(unclaimed).reduce((a, b) => a + (b || 0), 0))}</strong> • Unassigned: <strong>${escapeHtml(Object.values(unassigned).reduce((a, b) => a + (b || 0), 0))}</strong>
        </div>
        <div style="margin-top:10px; display:flex; flex-wrap:wrap; gap:8px;">
          <span class="pr-badge" title="Total items per tier">T1 ${escapeHtml(counts.T1)}</span>
          <span class="pr-badge">T2 ${escapeHtml(counts.T2)}</span>
          <span class="pr-badge">T3 ${escapeHtml(counts.T3)}</span>
          <span class="pr-badge">T4 ${escapeHtml(counts.T4)}</span>
          <span class="pr-badge">None ${escapeHtml(counts.None)}</span>
          <span class="pr-badge" title="Unclaimed items per tier">Unclaimed T1 ${escapeHtml(unclaimed.T1)} • T2 ${escapeHtml(unclaimed.T2)} • T3 ${escapeHtml(unclaimed.T3)} • T4 ${escapeHtml(unclaimed.T4)} • None ${escapeHtml(unclaimed.None)}</span>
          <span class="pr-badge" title="Unassigned items per tier">Unassigned T1 ${escapeHtml(unassigned.T1)} • T2 ${escapeHtml(unassigned.T2)} • T3 ${escapeHtml(unassigned.T3)} • T4 ${escapeHtml(unassigned.T4)} • None ${escapeHtml(unassigned.None)}</span>
        </div>

        <table class="worktree-inspector-table" style="margin-top:12px;">
          <thead>
            <tr>
              <th>Assigned to</th>
              <th>T1</th>
              <th>T2</th>
              <th>T3</th>
              <th>T4</th>
              <th>None</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${rows || `<tr><td colspan="7" style="opacity:0.8;">No items.</td></tr>`}
            ${sumRow}
          </tbody>
        </table>
      `;
	  }

    async showPolecatOverlay() {
      const existing = document.getElementById('dashboard-polecats-overlay');
      if (existing) {
        existing.classList.remove('hidden');
        return;
      }

      const overlay = document.createElement('div');
      overlay.id = 'dashboard-polecats-overlay';
      overlay.className = 'dashboard-telemetry-overlay';
      overlay.innerHTML = `
        <div class="dashboard-telemetry-panel" role="dialog" aria-label="Polecat management">
          <div class="dashboard-telemetry-header">
            <div class="dashboard-telemetry-title">Polecats — Sessions</div>
            <button class="dashboard-topbar-btn" id="dashboard-polecats-close" title="Close (Esc)">✕</button>
          </div>
          <div class="dashboard-telemetry-controls">
            <div class="dashboard-telemetry-actions">
              <button class="btn-secondary" type="button" id="dashboard-polecats-refresh">Refresh</button>
            </div>
          </div>
          <div id="dashboard-polecats-body" class="dashboard-telemetry-body">Loading…</div>
        </div>
      `;

      document.body.appendChild(overlay);

      const close = () => this.hidePolecatOverlay();
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
      });
      overlay.querySelector('#dashboard-polecats-close')?.addEventListener('click', close);
      overlay.querySelector('#dashboard-polecats-refresh')?.addEventListener('click', () => {
        this.loadPolecatDetails().catch(() => {});
      });

      const onKey = (e) => {
        if (e.key !== 'Escape') return;
        const el = document.getElementById('dashboard-polecats-overlay');
        if (!el || el.classList.contains('hidden')) return;
        close();
      };
      overlay._escHandler = onKey;
      document.addEventListener('keydown', onKey);

      await this.loadPolecatDetails();
    }

    hidePolecatOverlay() {
      const overlay = document.getElementById('dashboard-polecats-overlay');
      if (!overlay) return;
      overlay.classList.add('hidden');
      const handler = overlay._escHandler;
      if (handler) {
        document.removeEventListener('keydown', handler);
        overlay._escHandler = null;
      }
      overlay.remove();
    }

    async loadPolecatDetails() {
      const bodyEl = document.getElementById('dashboard-polecats-body');
      if (!bodyEl) return;

      const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      const sessions = Array.from(this.orchestrator?.sessions?.entries?.() || []);
      sessions.sort((a, b) => String(a[0]).localeCompare(String(b[0])));

      if (!sessions.length) {
        bodyEl.textContent = 'No sessions.';
        return;
      }

      const state = {
        selected: sessions[0]?.[0] || ''
      };

      const render = async () => {
        const selected = state.selected;
        const selectedSession = this.orchestrator?.sessions?.get?.(selected) || null;
        const selectedTitle = selectedSession ? `${selected} (${selectedSession.type || ''})` : selected;

        const rows = sessions.map(([id, s]) => {
          const status = escapeHtml(s?.status || 'idle');
          const branch = escapeHtml(s?.branch || '');
          const type = escapeHtml(s?.type || '');
          const worktreeId = escapeHtml(s?.worktreeId || '');
          const repo = escapeHtml(s?.repositoryName || '');
          const label = repo ? `${repo}/${worktreeId || ''}` : (worktreeId || '');
          const isSel = id === selected;
          return `
            <tr data-polecat-session="${escapeHtml(id)}" style="${isSel ? 'background: rgba(255,255,255,0.04);' : ''}">
              <td class="mono">${escapeHtml(id)}</td>
              <td>${escapeHtml(label)}</td>
              <td>${type}</td>
              <td>${status}</td>
              <td class="mono">${branch}</td>
              <td style="white-space:nowrap;">
                <button class="btn-secondary" type="button" data-polecat-restart="${escapeHtml(id)}" title="Restart session">↻</button>
                <button class="btn-secondary" type="button" data-polecat-kill="${escapeHtml(id)}" title="Kill/close session">✕</button>
              </td>
            </tr>
          `;
        }).join('');

        bodyEl.innerHTML = `
          <div style="display:flex; gap:12px; align-items:stretch; min-height: 50vh;">
            <div style="flex: 0 0 min(720px, 58vw); min-width: 320px; overflow:auto;">
              <table class="worktree-inspector-table">
                <thead>
                  <tr>
                    <th>Session</th>
                    <th>Worktree</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Branch</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows}
                </tbody>
              </table>
            </div>
            <div style="flex:1; min-width: 260px; display:flex; flex-direction:column;">
              <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:8px;">
                <div class="mono" style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(selectedTitle)}</div>
                <button class="btn-secondary" type="button" id="dashboard-polecats-log-refresh" ${selected ? '' : 'disabled'}>Refresh log</button>
              </div>
              <pre id="dashboard-polecats-log" style="flex:1; margin:0; padding:10px; border-radius:8px; border:1px solid var(--border-color); background: rgba(0,0,0,0.25); overflow:auto; white-space:pre-wrap; word-break:break-word;">Loading…</pre>
            </div>
          </div>
        `;

        const loadLog = async () => {
          const pre = bodyEl.querySelector('#dashboard-polecats-log');
          if (!pre) return;
          if (!selected) {
            pre.textContent = 'No session selected.';
            return;
          }
          pre.textContent = 'Loading…';
          try {
            const res = await fetch(`/api/sessions/${encodeURIComponent(selected)}/log?tailChars=20000`);
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to load log');
            pre.textContent = String(data.log || '');
          } catch (err) {
            pre.textContent = `Failed to load: ${String(err?.message || err)}`;
          }
        };

        await loadLog();

        bodyEl.querySelector('#dashboard-polecats-log-refresh')?.addEventListener('click', (e) => {
          e.preventDefault();
          loadLog().catch(() => {});
        });

        bodyEl.querySelectorAll('[data-polecat-session]').forEach((row) => {
          row.addEventListener('click', () => {
            const id = row.getAttribute('data-polecat-session');
            if (!id) return;
            state.selected = id;
            render().catch(() => {});
          });
        });

        bodyEl.querySelectorAll('button[data-polecat-restart]').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const id = btn.getAttribute('data-polecat-restart');
            if (!id) return;
            this.orchestrator?.socket?.emit?.('restart-session', { sessionId: id });
          });
        });
        bodyEl.querySelectorAll('button[data-polecat-kill]').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const id = btn.getAttribute('data-polecat-kill');
            if (!id) return;
            this.orchestrator?.socket?.emit?.('destroy-session', { sessionId: id });
          });
        });
      };

      await render();
    }

    async showConvoysOverlay() {
      const existing = document.getElementById('dashboard-convoys-overlay');
      if (existing) {
        existing.classList.remove('hidden');
        return;
      }

      const overlay = document.createElement('div');
      overlay.id = 'dashboard-convoys-overlay';
      overlay.className = 'dashboard-telemetry-overlay';
      overlay.innerHTML = `
        <div class="dashboard-telemetry-panel" role="dialog" aria-label="Convoy dashboard">
          <div class="dashboard-telemetry-header">
            <div class="dashboard-telemetry-title">Convoys — by assignment</div>
            <button class="dashboard-topbar-btn" id="dashboard-convoys-close" title="Close (Esc)">✕</button>
          </div>
          <div class="dashboard-telemetry-controls">
            <div class="dashboard-telemetry-actions">
              <button class="btn-secondary" type="button" id="dashboard-convoys-refresh">Refresh</button>
            </div>
          </div>
          <div id="dashboard-convoys-body" class="dashboard-telemetry-body">Loading…</div>
        </div>
      `;

      document.body.appendChild(overlay);

      const close = () => this.hideConvoysOverlay();
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
      });
      overlay.querySelector('#dashboard-convoys-close')?.addEventListener('click', close);
      overlay.querySelector('#dashboard-convoys-refresh')?.addEventListener('click', () => {
        this.loadConvoysDetails().catch(() => {});
      });

      const onKey = (e) => {
        if (e.key !== 'Escape') return;
        const el = document.getElementById('dashboard-convoys-overlay');
        if (!el || el.classList.contains('hidden')) return;
        close();
      };
      overlay._escHandler = onKey;
      document.addEventListener('keydown', onKey);

      await this.loadConvoysDetails();
    }

    hideConvoysOverlay() {
      const overlay = document.getElementById('dashboard-convoys-overlay');
      if (!overlay) return;
      overlay.classList.add('hidden');
      const handler = overlay._escHandler;
      if (handler) {
        document.removeEventListener('keydown', handler);
        overlay._escHandler = null;
      }
      overlay.remove();
    }

    async loadConvoysDetails() {
      const bodyEl = document.getElementById('dashboard-convoys-body');
      if (bodyEl) bodyEl.textContent = 'Loading…';

      let data = null;
      try {
        const url = new URL('/api/process/tasks', window.location.origin);
        url.searchParams.set('mode', 'all');
        url.searchParams.set('state', 'open');
        url.searchParams.set('include', 'dependencySummary');
        const res = await fetch(url.toString());
        data = res && res.ok ? await res.json().catch(() => null) : null;
      } catch {
        data = null;
      }

      if (!bodyEl) return;
      const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
      if (!data || !tasks) {
        bodyEl.textContent = 'Failed to load.';
        return;
      }

      const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      const tierKey = (t) => {
        const tier = t?.record?.tier;
        const n = Number(tier);
        return (Number.isFinite(n) && n >= 1 && n <= 4) ? `T${n}` : 'None';
      };

      const byConvoy = {};
      for (const t of tasks) {
        const assignedTo = String(t?.record?.assignedTo || '').trim() || '(unassigned)';
        const k = tierKey(t);
        if (!byConvoy[assignedTo]) {
          byConvoy[assignedTo] = { T1: 0, T2: 0, T3: 0, T4: 0, None: 0, total: 0, unclaimed: 0 };
        }
        byConvoy[assignedTo][k] = (byConvoy[assignedTo][k] || 0) + 1;
        byConvoy[assignedTo].total += 1;
        if (!String(t?.record?.claimedBy || '').trim()) byConvoy[assignedTo].unclaimed += 1;
      }

      const convoys = Object.entries(byConvoy)
        .sort((a, b) => (b[1].total || 0) - (a[1].total || 0) || String(a[0]).localeCompare(String(b[0])));

      const rows = convoys.map(([name, c]) => {
        const q = name === '(unassigned)' ? 'assigned:none' : `assigned:${name}`;
        return `
          <tr>
            <td class="mono">${escapeHtml(name)}</td>
            <td class="mono">${escapeHtml(c.T1 || 0)}</td>
            <td class="mono">${escapeHtml(c.T2 || 0)}</td>
            <td class="mono">${escapeHtml(c.T3 || 0)}</td>
            <td class="mono">${escapeHtml(c.T4 || 0)}</td>
            <td class="mono">${escapeHtml(c.None || 0)}</td>
            <td class="mono">${escapeHtml(c.total || 0)}</td>
            <td class="mono">${escapeHtml(c.unclaimed || 0)}</td>
            <td style="white-space:nowrap;">
              <button class="btn-secondary" type="button" data-open-queue-query="${escapeHtml(q)}" title="Open Queue filtered to this convoy">📥</button>
            </td>
          </tr>
        `;
      }).join('');

      bodyEl.innerHTML = `
        <div class="dashboard-telemetry-muted">Tip: use Queue search <code>assigned:NAME</code> (or <code>assigned:none</code> for unassigned).</div>
        <table class="worktree-inspector-table" style="margin-top:10px;">
          <thead>
            <tr>
              <th>Convoy</th>
              <th>T1</th>
              <th>T2</th>
              <th>T3</th>
              <th>T4</th>
              <th>None</th>
              <th>Total</th>
              <th>Unclaimed</th>
              <th>Queue</th>
            </tr>
          </thead>
          <tbody>
            ${rows || `<tr><td colspan="9" style="opacity:0.8;">No items.</td></tr>`}
          </tbody>
        </table>
      `;

      bodyEl.querySelectorAll('button[data-open-queue-query]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const q = String(btn.getAttribute('data-open-queue-query') || '').trim();
          this.hideConvoysOverlay();
          try {
            this.orchestrator.queuePanelPreset = { query: q };
          } catch {}
          this.orchestrator?.showQueuePanel?.().catch?.(() => {});
        });
      });
    }

    async showHooksOverlay() {
      const existing = document.getElementById('dashboard-hooks-overlay');
      if (existing) {
        existing.classList.remove('hidden');
        return;
      }

      const overlay = document.createElement('div');
      overlay.id = 'dashboard-hooks-overlay';
      overlay.className = 'dashboard-telemetry-overlay';
      overlay.innerHTML = `
        <div class="dashboard-telemetry-panel" role="dialog" aria-label="Hook browser">
          <div class="dashboard-telemetry-header">
            <div class="dashboard-telemetry-title">Hooks — Automations</div>
            <button class="dashboard-topbar-btn" id="dashboard-hooks-close" title="Close (Esc)">✕</button>
          </div>
          <div class="dashboard-telemetry-controls">
            <div class="dashboard-telemetry-actions">
              <button class="btn-secondary" type="button" id="dashboard-hooks-refresh">Refresh</button>
            </div>
          </div>
          <div id="dashboard-hooks-body" class="dashboard-telemetry-body">Loading…</div>
        </div>
      `;

      document.body.appendChild(overlay);

      const close = () => this.hideHooksOverlay();
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
      });
      overlay.querySelector('#dashboard-hooks-close')?.addEventListener('click', close);
      overlay.querySelector('#dashboard-hooks-refresh')?.addEventListener('click', () => {
        this.loadHooksDetails().catch(() => {});
      });

      const onKey = (e) => {
        if (e.key !== 'Escape') return;
        const el = document.getElementById('dashboard-hooks-overlay');
        if (!el || el.classList.contains('hidden')) return;
        close();
      };
      overlay._escHandler = onKey;
      document.addEventListener('keydown', onKey);

      await this.loadHooksDetails();
    }

    hideHooksOverlay() {
      const overlay = document.getElementById('dashboard-hooks-overlay');
      if (!overlay) return;
      overlay.classList.add('hidden');
      const handler = overlay._escHandler;
      if (handler) {
        document.removeEventListener('keydown', handler);
        overlay._escHandler = null;
      }
      overlay.remove();
    }

    async loadHooksDetails() {
      const bodyEl = document.getElementById('dashboard-hooks-body');
      if (!bodyEl) return;
      bodyEl.textContent = 'Loading…';

      const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      let automations = null;
      try {
        const res = await fetch('/api/process/automations');
        automations = res && res.ok ? await res.json().catch(() => null) : null;
      } catch {
        automations = null;
      }

      const trelloCfg = this.orchestrator?.userSettings?.global?.ui?.tasks?.automations?.trello?.onPrMerged || {};
      const enabled = trelloCfg.enabled !== false;
      const pollEnabled = trelloCfg.pollEnabled !== false;
      const webhookEnabled = !!trelloCfg.webhookEnabled;
      const comment = trelloCfg.comment !== false;
      const moveToDoneList = trelloCfg.moveToDoneList !== false;
      const closeIfNoDoneList = !!trelloCfg.closeIfNoDoneList;
      const pollMs = Number(trelloCfg.pollMs ?? 60000);

      const prMergeCfg = automations?.prMerge || {};
      const lastRunAt = automations?.lastRunAt || null;

      bodyEl.innerHTML = `
        <div style="display:grid; gap:14px;">
          <div>
            <div style="font-weight:600; margin-bottom:6px;">Trello hook (on PR merged)</div>
            <div class="tasks-detail-meta" style="margin-bottom:10px; opacity:0.9;">
              Stored in user settings: <code>ui.tasks.automations.trello.onPrMerged</code>
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:10px;">
              <label style="display:flex; align-items:center; gap:8px;"><input type="checkbox" id="hooks-trello-enabled" ${enabled ? 'checked' : ''}/> enabled</label>
              <label style="display:flex; align-items:center; gap:8px;"><input type="checkbox" id="hooks-trello-poll" ${pollEnabled ? 'checked' : ''}/> poll</label>
              <label style="display:flex; align-items:center; gap:8px;"><input type="checkbox" id="hooks-trello-webhook" ${webhookEnabled ? 'checked' : ''}/> webhook</label>
              <label style="display:flex; align-items:center; gap:8px;"><input type="checkbox" id="hooks-trello-comment" ${comment ? 'checked' : ''}/> comment</label>
              <label style="display:flex; align-items:center; gap:8px;"><input type="checkbox" id="hooks-trello-move" ${moveToDoneList ? 'checked' : ''}/> move card</label>
              <label style="display:flex; align-items:center; gap:8px;"><input type="checkbox" id="hooks-trello-close" ${closeIfNoDoneList ? 'checked' : ''}/> close if no done list</label>
            </div>
            <div style="margin-top:10px; display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
              <span class="tasks-detail-meta">pollMs</span>
              <input id="hooks-trello-pollms" type="number" min="5000" step="1000" value="${escapeHtml(String(Number.isFinite(pollMs) ? pollMs : 60000))}" style="width:140px;" />
              <button class="btn-secondary" type="button" id="hooks-trello-save">Save</button>
            </div>
          </div>

          <div>
            <div style="font-weight:600; margin-bottom:6px;">PR merge automation</div>
            <div class="tasks-detail-meta" style="margin-bottom:8px; opacity:0.9;">
              lastRunAt: ${lastRunAt ? `<code>${escapeHtml(lastRunAt)}</code>` : '—'}
            </div>
            <div class="tasks-detail-meta" style="margin-bottom:10px; opacity:0.9;">
              Config: pollMs <code>${escapeHtml(String(prMergeCfg?.pollMs ?? '—'))}</code> • enabled <code>${escapeHtml(String(prMergeCfg?.enabled ?? '—'))}</code>
            </div>
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
              <button class="btn-secondary" type="button" id="hooks-pr-merge-run">▶ Run once</button>
            </div>
            <div id="hooks-pr-merge-result" class="tasks-detail-meta" style="margin-top:10px; opacity:0.9;"></div>
          </div>
        </div>
      `;

      const update = async (path, value) => {
        try {
          await this.orchestrator?.updateGlobalUserSetting?.(path, value);
        } catch {}
      };

      bodyEl.querySelector('#hooks-trello-save')?.addEventListener('click', async () => {
        const next = {
          enabled: !!bodyEl.querySelector('#hooks-trello-enabled')?.checked,
          pollEnabled: !!bodyEl.querySelector('#hooks-trello-poll')?.checked,
          webhookEnabled: !!bodyEl.querySelector('#hooks-trello-webhook')?.checked,
          comment: !!bodyEl.querySelector('#hooks-trello-comment')?.checked,
          moveToDoneList: !!bodyEl.querySelector('#hooks-trello-move')?.checked,
          closeIfNoDoneList: !!bodyEl.querySelector('#hooks-trello-close')?.checked,
          pollMs: Number(bodyEl.querySelector('#hooks-trello-pollms')?.value || 60000)
        };
        await update('ui.tasks.automations.trello.onPrMerged', next);
        this.loadHooksDetails().catch(() => {});
      });

      bodyEl.querySelector('#hooks-pr-merge-run')?.addEventListener('click', async () => {
        const out = bodyEl.querySelector('#hooks-pr-merge-result');
        if (out) out.textContent = 'Running…';
        try {
          const res = await fetch('/api/process/automations/pr-merge/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ limit: 60 })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data?.error || 'Failed');
          if (out) out.innerHTML = `ok: <code>${escapeHtml(String(!!data.ok))}</code> • processed: <code>${escapeHtml(String(data?.processed ?? 0))}</code> • moved: <code>${escapeHtml(String(data?.moved ?? 0))}</code>`;
        } catch (err) {
          if (out) out.textContent = `Failed: ${String(err?.message || err)}`;
        }
      });
    }

    async showDeaconOverlay() {
      const existing = document.getElementById('dashboard-deacon-overlay');
      if (existing) {
        existing.classList.remove('hidden');
        return;
      }

      const overlay = document.createElement('div');
      overlay.id = 'dashboard-deacon-overlay';
      overlay.className = 'dashboard-telemetry-overlay';
      overlay.innerHTML = `
        <div class="dashboard-telemetry-panel" role="dialog" aria-label="Deacon monitor">
          <div class="dashboard-telemetry-header">
            <div class="dashboard-telemetry-title">Deacon — Health</div>
            <button class="dashboard-topbar-btn" id="dashboard-deacon-close" title="Close (Esc)">✕</button>
          </div>
          <div class="dashboard-telemetry-controls">
            <div class="dashboard-telemetry-actions">
              <button class="btn-secondary" type="button" id="dashboard-deacon-refresh">Refresh</button>
            </div>
          </div>
          <div id="dashboard-deacon-body" class="dashboard-telemetry-body">Loading…</div>
        </div>
      `;

      document.body.appendChild(overlay);

      const close = () => this.hideDeaconOverlay();
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
      });
      overlay.querySelector('#dashboard-deacon-close')?.addEventListener('click', close);
      overlay.querySelector('#dashboard-deacon-refresh')?.addEventListener('click', () => {
        this.loadDeaconDetails().catch(() => {});
      });

      const onKey = (e) => {
        if (e.key !== 'Escape') return;
        const el = document.getElementById('dashboard-deacon-overlay');
        if (!el || el.classList.contains('hidden')) return;
        close();
      };
      overlay._escHandler = onKey;
      document.addEventListener('keydown', onKey);

      await this.loadDeaconDetails();
    }

    hideDeaconOverlay() {
      const overlay = document.getElementById('dashboard-deacon-overlay');
      if (!overlay) return;
      overlay.classList.add('hidden');
      const handler = overlay._escHandler;
      if (handler) {
        document.removeEventListener('keydown', handler);
        overlay._escHandler = null;
      }
      overlay.remove();
    }

    async loadDeaconDetails() {
      const bodyEl = document.getElementById('dashboard-deacon-body');
      if (!bodyEl) return;
      bodyEl.textContent = 'Loading…';

      const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      const check = async (path) => {
        const started = performance.now();
        try {
          const res = await fetch(path);
          const ms = Math.round(performance.now() - started);
          const ok = !!res.ok;
          return { path, ok, ms, status: res.status };
        } catch (err) {
          const ms = Math.round(performance.now() - started);
          return { path, ok: false, ms, error: String(err?.message || err) };
        }
      };

      const endpoints = [
        '/api/user-settings',
        '/api/workspaces',
        '/api/process/status',
        '/api/process/performance',
        '/api/activity?limit=1'
      ];

      const results = await Promise.all(endpoints.map(check));

      let perf = null;
      try {
        const res = await fetch('/api/process/performance');
        perf = res && res.ok ? await res.json().catch(() => null) : null;
      } catch {
        perf = null;
      }

      let activity = null;
      try {
        const res = await fetch('/api/activity?limit=200');
        activity = res && res.ok ? await res.json().catch(() => null) : null;
      } catch {
        activity = null;
      }

      const events = Array.isArray(activity?.events) ? activity.events : [];
      const isErrorEvent = (ev) => {
        const kind = String(ev?.kind || '');
        const data = ev?.data && typeof ev.data === 'object' ? ev.data : {};
        if (data.ok === false) return true;
        if (kind.includes('failed')) return true;
        if (kind.includes('.error')) return true;
        if (kind.endsWith('.failed')) return true;
        if (kind.includes('close.failed')) return true;
        return false;
      };
      const errors = events.filter(isErrorEvent).slice(0, 20);

      const fmtBytes = (b) => {
        const n = Number(b);
        if (!Number.isFinite(n) || n < 0) return '—';
        const mb = n / (1024 * 1024);
        if (mb < 1024) return `${mb.toFixed(1)} MB`;
        return `${(mb / 1024).toFixed(2)} GB`;
      };

      const node = perf?.node || {};
      const uptime = Number(node?.uptimeSeconds || 0);
      const rss = fmtBytes(node?.rssBytes);

      const rows = results.map((r) => {
        const cls = r.ok ? 'process-chip ok' : 'process-chip danger';
        const statusText = r.ok ? `HTTP ${r.status}` : (r.error ? `ERR ${r.error}` : 'ERR');
        return `
          <tr>
            <td class="mono">${escapeHtml(r.path)}</td>
            <td><span class="${cls}">${r.ok ? 'ok' : 'fail'}</span></td>
            <td class="mono">${escapeHtml(String(r.ms))}ms</td>
            <td class="mono" style="opacity:0.85;">${escapeHtml(statusText)}</td>
          </tr>
        `;
      }).join('');

      const errorRows = errors.map((e) => {
        const t = escapeHtml(String(e?.time || e?.ts || ''));
        const kind = escapeHtml(String(e?.kind || ''));
        const data = escapeHtml(JSON.stringify(e?.data || {}));
        return `<div style="margin:6px 0;"><span class="mono" style="opacity:0.85;">${t}</span> • <code>${kind}</code><div class="mono" style="opacity:0.8; margin-top:4px;">${data}</div></div>`;
      }).join('');

      bodyEl.innerHTML = `
        <div class="dashboard-telemetry-muted">Node RSS: <code>${escapeHtml(rss)}</code> • Uptime: <code>${escapeHtml(String(uptime))}s</code></div>
        <table class="worktree-inspector-table" style="margin-top:10px;">
          <thead>
            <tr><th>Endpoint</th><th>Status</th><th>Latency</th><th>Detail</th></tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
        <div style="margin-top:14px;">
          <div style="font-weight:600; margin-bottom:6px;">Recent errors (Activity)</div>
          ${errorRows || '<div style="opacity:0.8;">No recent error events.</div>'}
        </div>
      `;
    }

    hidePerformanceOverlay() {
      const overlay = document.getElementById('dashboard-performance-overlay');
      if (!overlay) return;
	    overlay.classList.add('hidden');
	    const handler = overlay._escHandler;
	    if (handler) {
	      document.removeEventListener('keydown', handler);
	      overlay._escHandler = null;
	    }
	    overlay.remove();
	  }

		  async loadPerformanceDetails() {
		    const bodyEl = document.getElementById('dashboard-performance-body');
		    if (bodyEl) bodyEl.textContent = 'Loading…';

	    let data = null;
	    try {
	      const res = await fetch('/api/process/performance');
	      data = res && res.ok ? await res.json().catch(() => null) : null;
	    } catch {
	      data = null;
	    }

	    if (!bodyEl) return;
	    if (!data || !data.ok) {
	      bodyEl.textContent = 'Failed to load.';
	      return;
	    }

	    const escapeHtml = (value) => String(value ?? '')
	      .replace(/&/g, '&amp;')
	      .replace(/</g, '&lt;')
	      .replace(/>/g, '&gt;');

	    const fmtBytes = (b) => {
	      const n = Number(b);
	      if (!Number.isFinite(n) || n < 0) return '—';
	      const mb = n / (1024 * 1024);
	      if (mb < 1024) return `${mb.toFixed(1)} MB`;
	      return `${(mb / 1024).toFixed(2)} GB`;
	    };

	    const fmtKb = (kb) => {
	      const n = Number(kb);
	      if (!Number.isFinite(n) || n < 0) return '—';
	      return fmtBytes(n * 1024);
	    };

	    const sessions = Array.isArray(data.sessions) ? data.sessions : [];
	    const rows = sessions.map((s) => {
	      const repo = s.repositoryName ? `${escapeHtml(s.repositoryName)}/` : '';
	      const wt = escapeHtml(s.worktreeId || '');
	      const label = `${repo}${wt || escapeHtml(s.sessionId)}`;
	      const pid = s.pid ? escapeHtml(String(s.pid)) : '—';
	      const mem = s.totalRssKb ? escapeHtml(fmtKb(s.totalRssKb)) : '—';
	      const kids = escapeHtml(String(s.childCount ?? 0));
	      return `<tr><td class="mono">${escapeHtml(s.sessionId)}</td><td>${label}</td><td>${escapeHtml(s.type || '')}</td><td class="mono">${pid}</td><td class="mono">${mem}</td><td class="mono">${kids}</td></tr>`;
	    }).join('');

		    bodyEl.innerHTML = `
		      <div class="dashboard-telemetry-muted">Generated: ${escapeHtml(data.generatedAt)} • Node RSS: ${escapeHtml(fmtBytes(data?.node?.rssBytes))} • Uptime: ${escapeHtml(String(data?.node?.uptimeSeconds || 0))}s</div>
		      <table class="worktree-inspector-table" style="margin-top:10px;">
		        <thead>
		          <tr>
	            <th>Session</th>
	            <th>Worktree</th>
	            <th>Type</th>
	            <th>PID</th>
	            <th>Mem (RSS)</th>
	            <th>Children</th>
	          </tr>
	        </thead>
	        <tbody>
		          ${rows || `<tr><td colspan="6" style="opacity:0.8;">No sessions.</td></tr>`}
		        </tbody>
		      </table>
		    `;
		  }

		  async showTestOrchestrationOverlay() {
		    const existing = document.getElementById('dashboard-tests-overlay');
		    if (existing) {
		      existing.classList.remove('hidden');
		      return;
		    }

		    const overlay = document.createElement('div');
		    overlay.id = 'dashboard-tests-overlay';
		    overlay.className = 'dashboard-telemetry-overlay';
		    overlay.innerHTML = `
		      <div class="dashboard-telemetry-panel" role="dialog" aria-label="Test orchestration">
		        <div class="dashboard-telemetry-header">
		          <div class="dashboard-telemetry-title">Tests — Orchestration</div>
		          <button class="dashboard-topbar-btn" id="dashboard-tests-close" title="Close (Esc)">✕</button>
		        </div>
		        <div class="dashboard-telemetry-controls">
		          <label class="dashboard-telemetry-field">
		            <span>Script</span>
		            <select id="dashboard-tests-script">
		              <option value="auto" selected>auto</option>
		              <option value="test:unit">test:unit</option>
		              <option value="test">test</option>
		              <option value="test:ci">test:ci</option>
		            </select>
		          </label>
		          <label class="dashboard-telemetry-field">
		            <span>Concurrency</span>
		            <select id="dashboard-tests-concurrency">
		              <option value="1">1</option>
		              <option value="2" selected>2</option>
		              <option value="3">3</option>
		              <option value="4">4</option>
		              <option value="6">6</option>
		              <option value="8">8</option>
		            </select>
		          </label>
		          <div class="dashboard-telemetry-actions">
		            <button class="btn-primary" type="button" id="dashboard-tests-run">Run</button>
		            <button class="btn-secondary" type="button" id="dashboard-tests-cancel" disabled>Cancel</button>
		            <button class="btn-secondary" type="button" id="dashboard-tests-refresh">Refresh</button>
		          </div>
		        </div>
		        <div id="dashboard-tests-body" class="dashboard-telemetry-body">Loading…</div>
		      </div>
		    `;

		    document.body.appendChild(overlay);

		    const close = () => this.hideTestOrchestrationOverlay();
		    overlay.addEventListener('click', (e) => {
		      if (e.target === overlay) close();
		    });
		    overlay.querySelector('#dashboard-tests-close')?.addEventListener('click', close);

		    const onKey = (e) => {
		      if (e.key !== 'Escape') return;
		      const el = document.getElementById('dashboard-tests-overlay');
		      if (!el || el.classList.contains('hidden')) return;
		      close();
		    };
		    overlay._escHandler = onKey;
		    document.addEventListener('keydown', onKey);

		    const scriptEl = overlay.querySelector('#dashboard-tests-script');
		    const concurrencyEl = overlay.querySelector('#dashboard-tests-concurrency');
		    overlay.querySelector('#dashboard-tests-run')?.addEventListener('click', async () => {
		      const script = String(scriptEl?.value || 'auto');
		      const concurrency = Number(concurrencyEl?.value || 2);
		      await this.startTestOrchestrationRun({ script, concurrency });
		    });
		    overlay.querySelector('#dashboard-tests-cancel')?.addEventListener('click', async () => {
		      await this.cancelTestOrchestrationRun();
		    });
		    overlay.querySelector('#dashboard-tests-refresh')?.addEventListener('click', async () => {
		      await this.loadLatestTestOrchestrationRunOrCurrent();
		    });

		    await this.loadLatestTestOrchestrationRunOrCurrent();
		  }

		  hideTestOrchestrationOverlay() {
		    const overlay = document.getElementById('dashboard-tests-overlay');
		    if (!overlay) return;
		    overlay.classList.add('hidden');
		    const handler = overlay._escHandler;
		    if (handler) {
		      document.removeEventListener('keydown', handler);
		      overlay._escHandler = null;
		    }
		    if (this._testsPollTimer) {
		      clearTimeout(this._testsPollTimer);
		      this._testsPollTimer = null;
		    }
		    overlay.remove();
		  }

		  async startTestOrchestrationRun({ script = 'auto', concurrency = 2 } = {}) {
		    const bodyEl = document.getElementById('dashboard-tests-body');
		    if (bodyEl) bodyEl.textContent = 'Starting…';
		    if (this._testsPollTimer) {
		      clearTimeout(this._testsPollTimer);
		      this._testsPollTimer = null;
		    }

		    let data = null;
		    try {
		      const res = await fetch('/api/process/tests/run', {
		        method: 'POST',
		        headers: { 'Content-Type': 'application/json' },
		        body: JSON.stringify({ script, concurrency, existingOnly: true })
		      });
		      data = res && res.ok ? await res.json().catch(() => null) : null;
		    } catch {
		      data = null;
		    }

		    if (!data || !data.ok || !data.runId) {
		      if (bodyEl) bodyEl.textContent = 'Failed to start.';
		      return;
		    }

		    this._testRunId = String(data.runId);
		    await this.loadTestOrchestrationRun(this._testRunId, { poll: true });
		  }

		  async loadLatestTestOrchestrationRunOrCurrent() {
		    if (this._testRunId) {
		      await this.loadTestOrchestrationRun(this._testRunId, { poll: true });
		      return;
		    }

		    const bodyEl = document.getElementById('dashboard-tests-body');
		    if (bodyEl) bodyEl.textContent = 'Loading…';

		    let data = null;
		    try {
		      const res = await fetch('/api/process/tests/runs?limit=1');
		      data = res && res.ok ? await res.json().catch(() => null) : null;
		    } catch {
		      data = null;
		    }

		    const first = Array.isArray(data?.runs) ? data.runs[0] : null;
		    if (!first?.runId) {
		      if (bodyEl) bodyEl.textContent = 'No test runs yet.';
		      return;
		    }

		    this._testRunId = String(first.runId);
		    await this.loadTestOrchestrationRun(this._testRunId, { poll: true });
		  }

		  async loadTestOrchestrationRun(runId, { poll = false } = {}) {
		    const bodyEl = document.getElementById('dashboard-tests-body');
		    if (!bodyEl) return;

		    let data = null;
		    try {
		      const url = `/api/process/tests/runs/${encodeURIComponent(String(runId || '').trim())}`;
		      const res = await fetch(url);
		      data = res && res.ok ? await res.json().catch(() => null) : null;
		    } catch {
		      data = null;
		    }

		    if (!data || !data.ok) {
		      bodyEl.textContent = 'Failed to load.';
		      return;
		    }

		    const escapeHtml = (value) => String(value ?? '')
		      .replace(/&/g, '&amp;')
		      .replace(/</g, '&lt;')
		      .replace(/>/g, '&gt;');

		    const results = Array.isArray(data.results) ? data.results : [];
		    const rows = results.map((r) => {
		      const output = String(r.outputTail || '');
		      const tail = output.length > 2000 ? output.slice(output.length - 2000) : output;
		      return `
		        <tr>
		          <td class="mono">${escapeHtml(r.worktreeId || '')}</td>
		          <td class="mono">${escapeHtml(r.status || '')}</td>
		          <td class="mono">${escapeHtml(r.command || '—')}</td>
		          <td class="mono">${escapeHtml(r.durationMs != null ? String(r.durationMs) : '—')}</td>
		          <td class="mono">${escapeHtml(r.exitCode != null ? String(r.exitCode) : '—')}</td>
		          <td style="min-width: 340px;">
		            <pre style="white-space: pre-wrap; margin: 0; max-height: 140px; overflow: auto;">${escapeHtml(tail || '')}</pre>
		          </td>
		        </tr>
		      `;
		    }).join('');

		    const s = data.summary || {};
		    bodyEl.innerHTML = `
		      <div class="dashboard-telemetry-muted">Run: ${escapeHtml(data.runId)} • Workspace: ${escapeHtml(data.workspaceName || data.workspaceId || '')} • Script: ${escapeHtml(data.script)} • Concurrency: ${escapeHtml(String(data.concurrency || ''))} • Status: ${escapeHtml(data.status)}</div>
		      <div class="dashboard-telemetry-muted">Total: ${escapeHtml(String(s.total || 0))} • Running: ${escapeHtml(String(s.running || 0))} • Passed: ${escapeHtml(String(s.passed || 0))} • Failed: ${escapeHtml(String(s.failed || 0))} • Cancelled: ${escapeHtml(String(s.cancelled || 0))} • Unsupported: ${escapeHtml(String(s.unsupported || 0))}</div>
		      <table class="worktree-inspector-table" style="margin-top:10px;">
		        <thead>
		          <tr>
		            <th>Worktree</th>
		            <th>Status</th>
		            <th>Command</th>
		            <th>ms</th>
		            <th>Exit</th>
		            <th>Output (tail)</th>
		          </tr>
		        </thead>
		        <tbody>
		          ${rows || `<tr><td colspan="6" style="opacity:0.8;">No worktrees.</td></tr>`}
		        </tbody>
		      </table>
		    `;

		    const cancelBtn = document.getElementById('dashboard-tests-cancel');
		    if (cancelBtn) {
		      const canCancel = String(data.status) === 'running' && !!data.runId;
		      cancelBtn.disabled = !canCancel;
		    }

		    if (poll && String(data.status) === 'running') {
		      if (this._testsPollTimer) clearTimeout(this._testsPollTimer);
		      this._testsPollTimer = setTimeout(() => {
		        try { this.loadTestOrchestrationRun(data.runId, { poll: true }); } catch {}
		      }, 2000);
		    }
		  }

		  async cancelTestOrchestrationRun() {
		    const runId = String(this._testRunId || '').trim();
		    if (!runId) return;

		    const cancelBtn = document.getElementById('dashboard-tests-cancel');
		    if (cancelBtn) cancelBtn.disabled = true;

		    try {
		      await fetch(`/api/process/tests/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' }).catch(() => null);
		    } catch {}

		    await this.loadTestOrchestrationRun(runId, { poll: true });
		  }

		  async showReadinessOverlay() {
		    const existing = document.getElementById('dashboard-readiness-overlay');
		    if (existing) {
		      existing.classList.remove('hidden');
	      return;
	    }

	    const overlay = document.createElement('div');
	    overlay.id = 'dashboard-readiness-overlay';
	    overlay.className = 'dashboard-telemetry-overlay';
	    overlay.innerHTML = `
	      <div class="dashboard-telemetry-panel" role="dialog" aria-label="Project readiness checklists">
	        <div class="dashboard-telemetry-header">
	          <div class="dashboard-telemetry-title">Readiness — Checklists</div>
	          <button class="dashboard-topbar-btn" id="dashboard-readiness-close" title="Close (Esc)">✕</button>
	        </div>
	        <div class="dashboard-telemetry-controls">
	          <label class="dashboard-telemetry-field">
	            <span>Template</span>
	            <select id="dashboard-readiness-template"></select>
	          </label>
	          <div class="dashboard-telemetry-actions">
	            <button class="btn-secondary" type="button" id="dashboard-readiness-copy-md">Copy Markdown</button>
	            <button class="btn-secondary" type="button" id="dashboard-readiness-copy-text">Copy Text</button>
	            <button class="btn-secondary" type="button" id="dashboard-readiness-copy-all">Copy All</button>
	          </div>
	        </div>
	        <div id="dashboard-readiness-body" class="dashboard-telemetry-body">Loading…</div>
	      </div>
	    `;

	    document.body.appendChild(overlay);

	    const escapeHtml = (value) => String(value ?? '')
	      .replace(/&/g, '&amp;')
	      .replace(/</g, '&lt;')
	      .replace(/>/g, '&gt;');

	    const close = () => this.hideReadinessOverlay();
	    overlay.addEventListener('click', (e) => {
	      if (e.target === overlay) close();
	    });
	    overlay.querySelector('#dashboard-readiness-close')?.addEventListener('click', close);

	    const onKey = (e) => {
	      if (e.key !== 'Escape') return;
	      const el = document.getElementById('dashboard-readiness-overlay');
	      if (!el || el.classList.contains('hidden')) return;
	      close();
	    };
	    overlay._escHandler = onKey;
	    document.addEventListener('keydown', onKey);

	    const selectEl = overlay.querySelector('#dashboard-readiness-template');
	    const bodyEl = overlay.querySelector('#dashboard-readiness-body');
	    const copyMdBtn = overlay.querySelector('#dashboard-readiness-copy-md');
	    const copyTextBtn = overlay.querySelector('#dashboard-readiness-copy-text');
	    const copyAllBtn = overlay.querySelector('#dashboard-readiness-copy-all');

	    const res = await fetch('/api/process/readiness/templates').catch(() => null);
	    const data = res ? await res.json().catch(() => ({})) : {};
	    if (!res || !res.ok) {
	      if (bodyEl) bodyEl.textContent = 'Failed to load.';
	      return;
	    }

	    const templates = Array.isArray(data?.templates) ? data.templates : [];
	    if (!templates.length) {
	      if (bodyEl) bodyEl.textContent = 'No templates found.';
	      return;
	    }

	    const byId = new Map(templates.map((t) => [String(t?.id || '').trim(), t]));

	    const mdFor = (t) => {
	      const title = String(t?.title || '').trim() || String(t?.id || '').trim() || 'Checklist';
	      const items = Array.isArray(t?.items) ? t.items : [];
	      return `## ${title}\n` + items.map(i => `- [ ] ${String(i || '').trim()}`).join('\n') + '\n';
	    };

	    const textFor = (t) => {
	      const title = String(t?.title || '').trim() || String(t?.id || '').trim() || 'Checklist';
	      const items = Array.isArray(t?.items) ? t.items : [];
	      return `${title}\n` + items.map(i => `- ${String(i || '').trim()}`).join('\n') + '\n';
	    };

	    const render = () => {
	      const id = String(selectEl?.value || '').trim();
	      const t = byId.get(id) || templates[0];
	      const title = escapeHtml(String(t?.title || '').trim() || id);
	      const items = Array.isArray(t?.items) ? t.items : [];
	      if (!bodyEl) return;
	      bodyEl.innerHTML = `
	        <div class="dashboard-telemetry-meta">
	          <div><strong>${title}</strong></div>
	          <div style="opacity:0.85;">${items.length} items</div>
	        </div>
	        <ul style="margin:0; padding-left: 18px; display:flex; flex-direction:column; gap:6px;">
	          ${items.map((i) => `<li style="list-style: disc;"><label style="display:flex; gap:10px; align-items:flex-start;"><input type="checkbox" disabled /><span>${escapeHtml(String(i || '').trim())}</span></label></li>`).join('')}
	        </ul>
	      `;
	    };

	    if (selectEl) {
	      selectEl.innerHTML = templates
	        .map((t) => {
	          const id = String(t?.id || '').trim();
	          const title = String(t?.title || '').trim() || id;
	          return `<option value="${escapeHtml(id)}">${escapeHtml(title)}</option>`;
	        })
	        .join('');
	      selectEl.value = String(templates[0]?.id || '').trim();
	      selectEl.addEventListener('change', render);
	    }

	    const getSelected = () => {
	      const id = String(selectEl?.value || '').trim();
	      return byId.get(id) || templates[0];
	    };

	    copyMdBtn?.addEventListener('click', async () => {
	      const t = getSelected();
	      await this.copyToClipboard(mdFor(t));
	      try { this.orchestrator?.showToast?.('Checklist copied (Markdown)', 'success'); } catch {}
	    });

	    copyTextBtn?.addEventListener('click', async () => {
	      const t = getSelected();
	      await this.copyToClipboard(textFor(t));
	      try { this.orchestrator?.showToast?.('Checklist copied', 'success'); } catch {}
	    });

	    copyAllBtn?.addEventListener('click', async () => {
	      const all = templates.map(t => mdFor(t)).join('\n');
	      await this.copyToClipboard(all);
	      try { this.orchestrator?.showToast?.('All checklists copied (Markdown)', 'success'); } catch {}
	    });

	    render();
	  }

	  hideReadinessOverlay() {
	    const overlay = document.getElementById('dashboard-readiness-overlay');
	    if (!overlay) return;
	    overlay.classList.add('hidden');
	    const handler = overlay._escHandler;
	    if (handler) {
	      document.removeEventListener('keydown', handler);
	      overlay._escHandler = null;
	    }
	    overlay.remove();
	  }

	  async showSuggestionsOverlay() {
	    const existing = document.getElementById('dashboard-suggestions-overlay');
	    if (existing) {
	      existing.classList.remove('hidden');
	      return;
	    }

	    const overlay = document.createElement('div');
	    overlay.id = 'dashboard-suggestions-overlay';
	    overlay.className = 'dashboard-telemetry-overlay';
	    overlay.innerHTML = `
	      <div class="dashboard-telemetry-panel" role="dialog" aria-label="Workspace suggestions">
	        <div class="dashboard-telemetry-header">
	          <div class="dashboard-telemetry-title">Workspaces — Suggestions</div>
	          <button class="dashboard-topbar-btn" id="dashboard-suggestions-close" title="Close (Esc)">✕</button>
	        </div>
	        <div class="dashboard-telemetry-controls">
	          <div class="dashboard-telemetry-actions">
	            <button class="btn-secondary" type="button" id="dashboard-suggestions-create-recent" title="Create a new workspace from recent git activity">Create Recent Workspace</button>
	            <button class="btn-secondary" type="button" id="dashboard-suggestions-refresh">Refresh</button>
	            <button class="btn-secondary" type="button" id="dashboard-suggestions-copy">Copy JSON</button>
	          </div>
	        </div>
	        <div id="dashboard-suggestions-body" class="dashboard-telemetry-body">Loading…</div>
	      </div>
	    `;

	    document.body.appendChild(overlay);

	    const close = () => this.hideSuggestionsOverlay();
	    overlay.addEventListener('click', (e) => {
	      if (e.target === overlay) close();
	    });
	    overlay.querySelector('#dashboard-suggestions-close')?.addEventListener('click', close);

	    const onKey = (e) => {
	      if (e.key !== 'Escape') return;
	      const el = document.getElementById('dashboard-suggestions-overlay');
	      if (!el || el.classList.contains('hidden')) return;
	      close();
	    };
	    overlay._escHandler = onKey;
	    document.addEventListener('keydown', onKey);

	    overlay.querySelector('#dashboard-suggestions-refresh')?.addEventListener('click', () => {
	      this.loadWorkspaceSuggestions();
	    });
	    overlay.querySelector('#dashboard-suggestions-create-recent')?.addEventListener('click', async () => {
	      const btn = overlay.querySelector('#dashboard-suggestions-create-recent');
	      if (btn) btn.disabled = true;
	      try {
	        const resp = await fetch('/api/workspaces/create-recent', {
	          method: 'POST',
	          headers: { 'Content-Type': 'application/json' },
	          body: JSON.stringify({ count: 4 })
	        });
	        const data = await resp.json().catch(() => ({}));
	        if (!resp.ok || !data?.ok || !data?.workspace?.id) {
	          throw new Error(String(data?.error || 'Failed to create workspace'));
	        }
	        try { this.orchestrator?.showToast?.('Created recent workspace', 'success'); } catch {}
	        await this.loadWorkspaces();
	        this.render();
	        this.openWorkspace(data.workspace.id);
	      } catch (err) {
	        try { this.orchestrator?.showToast?.(`Create failed: ${String(err?.message || err)}`, 'error'); } catch {}
	      } finally {
	        if (btn) btn.disabled = false;
	      }
	    });
	    overlay.querySelector('#dashboard-suggestions-copy')?.addEventListener('click', async () => {
	      const data = this._workspaceSuggestions || null;
	      if (!data) return;
	      try {
	        await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
	        try { this.orchestrator?.showToast?.('Copied suggestions JSON', 'success'); } catch {}
	      } catch {}
	    });

	    await this.loadWorkspaceSuggestions();
	  }

	  hideSuggestionsOverlay() {
	    const overlay = document.getElementById('dashboard-suggestions-overlay');
	    if (!overlay) return;
	    overlay.classList.add('hidden');
	    const handler = overlay._escHandler;
	    if (handler) {
	      document.removeEventListener('keydown', handler);
	      overlay._escHandler = null;
	    }
	    overlay.remove();
	  }

	  async loadWorkspaceSuggestions() {
	    const bodyEl = document.getElementById('dashboard-suggestions-body');
	    if (bodyEl) bodyEl.textContent = 'Loading…';

	    let data = null;
	    try {
	      const res = await fetch('/api/workspaces/suggestions?limit=8');
	      data = res && res.ok ? await res.json().catch(() => null) : null;
	    } catch {
	      data = null;
	    }

	    this._workspaceSuggestions = data;
	    if (!bodyEl) return;
	    if (!data) {
	      bodyEl.textContent = 'Failed to load.';
	      return;
	    }

	    const escapeHtml = (value) => String(value ?? '')
	      .replace(/&/g, '&amp;')
	      .replace(/</g, '&lt;')
	      .replace(/>/g, '&gt;');

	    const combos = Array.isArray(data?.suggestions?.frequentCombos) ? data.suggestions.frequentCombos : [];
	    const recent = Array.isArray(data?.suggestions?.recentRepos) ? data.suggestions.recentRepos : [];

	    const renderRepos = (repos) => {
	      const list = Array.isArray(repos) ? repos : [];
	      if (!list.length) return '';
	      return `<ul class="dashboard-telemetry-list">${list.map(r => `<li><code>${escapeHtml(r?.path || '')}</code></li>`).join('')}</ul>`;
	    };

	    const renderSuggestion = (s) => {
	      const label = escapeHtml(s?.label || '');
	      const score = escapeHtml(String(s?.score ?? ''));
	      const kind = escapeHtml(s?.kind || '');
	      const seen = Array.isArray(s?.seenInWorkspaces) ? s.seenInWorkspaces : [];
	      const seenHtml = seen.length ? `<div class="dashboard-telemetry-muted">Seen in: ${seen.map(escapeHtml).join(', ')}</div>` : '';
	      return `
	        <div class="dashboard-telemetry-card">
	          <div><strong>${label}</strong> <span class="dashboard-telemetry-muted">(${kind}, score: ${score})</span></div>
	          ${seenHtml}
	          ${renderRepos(s?.repositories)}
	        </div>
	      `;
	    };

	    bodyEl.innerHTML = `
	      <div class="dashboard-telemetry-muted">Generated: ${escapeHtml(data.generatedAt)} • Workspaces: ${escapeHtml(data?.sources?.workspaceCount)} • Repos: ${escapeHtml(data?.sources?.repoCount)}</div>
	      <h4 style="margin-top: 14px;">Frequent repo combos</h4>
	      ${combos.length ? combos.map(renderSuggestion).join('') : '<div class="dashboard-telemetry-muted">None found.</div>'}
	      <h4 style="margin-top: 14px;">Recent activity</h4>
	      ${recent.length ? recent.map(renderSuggestion).join('') : '<div class="dashboard-telemetry-muted">None found.</div>'}
	    `;
	  }

	  async showDistributionOverlay() {
	    const existing = document.getElementById('dashboard-distribution-overlay');
	    if (existing) {
	      existing.classList.remove('hidden');
	      return;
	    }

	    const overlay = document.createElement('div');
	    overlay.id = 'dashboard-distribution-overlay';
	    overlay.className = 'dashboard-telemetry-overlay';
	    overlay.innerHTML = `
	      <div class="dashboard-telemetry-panel" role="dialog" aria-label="Task distribution">
	        <div class="dashboard-telemetry-header">
	          <div class="dashboard-telemetry-title">Distribution — Suggested terminals</div>
	          <button class="dashboard-topbar-btn" id="dashboard-distribution-close" title="Close (Esc)">✕</button>
	        </div>
	        <div class="dashboard-telemetry-controls">
	          <div class="dashboard-telemetry-actions">
	            <button class="btn-secondary" type="button" id="dashboard-distribution-refresh">Refresh</button>
	          </div>
	        </div>
	        <div id="dashboard-distribution-body" class="dashboard-telemetry-body">Loading…</div>
	      </div>
	    `;

	    document.body.appendChild(overlay);

	    const close = () => this.hideDistributionOverlay();
	    overlay.addEventListener('click', (e) => {
	      if (e.target === overlay) close();
	    });
	    overlay.querySelector('#dashboard-distribution-close')?.addEventListener('click', close);

	    const onKey = (e) => {
	      if (e.key !== 'Escape') return;
	      const el = document.getElementById('dashboard-distribution-overlay');
	      if (!el || el.classList.contains('hidden')) return;
	      close();
	    };
	    overlay._escHandler = onKey;
	    document.addEventListener('keydown', onKey);

	    overlay.querySelector('#dashboard-distribution-refresh')?.addEventListener('click', () => {
	      this.loadDistributionDetails();
	    });

	    await this.loadDistributionDetails();
	  }

	  hideDistributionOverlay() {
	    const overlay = document.getElementById('dashboard-distribution-overlay');
	    if (!overlay) return;
	    overlay.classList.add('hidden');
	    const handler = overlay._escHandler;
	    if (handler) {
	      document.removeEventListener('keydown', handler);
	      overlay._escHandler = null;
	    }
	    overlay.remove();
	  }

	  async loadDistributionDetails() {
	    const bodyEl = document.getElementById('dashboard-distribution-body');
	    if (bodyEl) bodyEl.textContent = 'Loading…';

	    let data = null;
	    try {
	      const res = await fetch('/api/process/distribution?mode=mine&state=open&sort=updated&limit=25');
	      data = res && res.ok ? await res.json().catch(() => null) : null;
	    } catch {
	      data = null;
	    }

	    if (!bodyEl) return;
	    if (!data || !data.ok) {
	      bodyEl.textContent = 'Failed to load.';
	      return;
	    }

	    const escapeHtml = (value) => String(value ?? '')
	      .replace(/&/g, '&amp;')
	      .replace(/</g, '&lt;')
	      .replace(/>/g, '&gt;');

	    const rows = (Array.isArray(data.suggestions) ? data.suggestions : []).map((s) => {
	      const t = s.task || {};
	      const title = escapeHtml(t.title || t.id || '');
	      const repo = escapeHtml(t.repository || '');
	      const url = escapeHtml(t.url || '');
	      const sid = escapeHtml(s.recommendedSessionId || '');
	      const agent = escapeHtml(s.recommendedAgent || '');
	      const reason = escapeHtml(s.reason || '');
	      const focusBtn = s.recommendedSessionId
	        ? `<button class="btn-secondary worktree-inspector-mini-btn" type="button" data-focus-session="${escapeHtml(s.recommendedSessionId)}">Focus</button>`
	        : '';
	      const prBtn = url ? `<button class="btn-secondary worktree-inspector-mini-btn" type="button" data-open-url="${url}">PR</button>` : '';
	      return `<tr><td>${title}</td><td class="mono">${repo}</td><td class="mono">${agent || '—'}</td><td class="mono">${sid || '—'}</td><td class="mono">${reason}</td><td>${prBtn} ${focusBtn}</td></tr>`;
	    }).join('');

	    bodyEl.innerHTML = `
	      <div class="dashboard-telemetry-muted">Generated: ${escapeHtml(data.generatedAt)} • PR tasks: ${escapeHtml(String(data.totalTasks || 0))}</div>
	      <table class="worktree-inspector-table" style="margin-top:10px;">
	        <thead>
	          <tr>
	            <th>Task</th>
	            <th>Repo</th>
	            <th>Agent</th>
	            <th>Suggested terminal</th>
	            <th>Reason</th>
	            <th>Actions</th>
	          </tr>
	        </thead>
	        <tbody>
	          ${rows || `<tr><td colspan="6" style="opacity:0.8;">No PR tasks found.</td></tr>`}
	        </tbody>
	      </table>
	    `;

	    bodyEl.querySelectorAll('[data-open-url]').forEach((btn) => {
	      btn.addEventListener('click', () => {
	        const u = String(btn?.dataset?.openUrl || '').trim();
	        if (!u) return;
	        try { window.open(u, '_blank'); } catch {}
	      });
	    });
	    bodyEl.querySelectorAll('[data-focus-session]').forEach((btn) => {
	      btn.addEventListener('click', () => {
	        const sid2 = String(btn?.dataset?.focusSession || '').trim();
	        if (!sid2) return;
	        try {
	          this.orchestrator?.hideDashboard?.();
	          setTimeout(() => {
	            try { this.orchestrator?.focusTerminal?.(sid2); } catch {}
	          }, 50);
	        } catch {}
	      });
	    });
	  }

	  async showProjectHealthOverlay() {
	    const existing = document.getElementById('dashboard-project-health-overlay');
	    if (existing) {
	      existing.classList.remove('hidden');
	      return;
	    }

	    const overlay = document.createElement('div');
	    overlay.id = 'dashboard-project-health-overlay';
	    overlay.className = 'dashboard-telemetry-overlay';
	    overlay.innerHTML = `
	      <div class="dashboard-telemetry-panel" role="dialog" aria-label="Project health dashboard">
	        <div class="dashboard-telemetry-header">
	          <div class="dashboard-telemetry-title">Projects — Health</div>
	          <button class="dashboard-topbar-btn" id="dashboard-project-health-close" title="Close (Esc)">✕</button>
	        </div>
	        <div class="dashboard-telemetry-controls">
	          <label class="dashboard-telemetry-field">
	            <span>Lookback</span>
	            <select id="dashboard-project-health-lookback">
	              <option value="168">7d</option>
	              <option value="336" selected>14d</option>
	              <option value="720">30d</option>
	              <option value="2160">90d</option>
	            </select>
	          </label>
	          <label class="dashboard-telemetry-field">
	            <span>Bucket</span>
	            <select id="dashboard-project-health-bucket">
	              <option value="360">6h</option>
	              <option value="720">12h</option>
	              <option value="1440" selected>1d</option>
	              <option value="2880">2d</option>
	            </select>
	          </label>
	          <label class="dashboard-telemetry-field" style="min-width: 220px; flex: 1;">
	            <span>Filter</span>
	            <input id="dashboard-project-health-filter" type="text" placeholder="owner/repo…" />
	          </label>
	          <div class="dashboard-telemetry-actions">
	            <button class="btn-secondary" type="button" id="dashboard-project-health-refresh">Refresh</button>
	          </div>
	        </div>
	        <div id="dashboard-project-health-body" class="dashboard-telemetry-body">Loading…</div>
	      </div>
	    `;

	    document.body.appendChild(overlay);

	    const close = () => this.hideProjectHealthOverlay();
	    overlay.addEventListener('click', (e) => {
	      if (e.target === overlay) close();
	    });
	    overlay.querySelector('#dashboard-project-health-close')?.addEventListener('click', close);

	    const onKey = (e) => {
	      if (e.key !== 'Escape') return;
	      const el = document.getElementById('dashboard-project-health-overlay');
	      if (!el || el.classList.contains('hidden')) return;
	      close();
	    };
	    overlay._escHandler = onKey;
	    document.addEventListener('keydown', onKey);

	    const lookbackEl = overlay.querySelector('#dashboard-project-health-lookback');
	    const bucketEl = overlay.querySelector('#dashboard-project-health-bucket');
	    const filterEl = overlay.querySelector('#dashboard-project-health-filter');

	    overlay.querySelector('#dashboard-project-health-refresh')?.addEventListener('click', () => {
	      this.loadProjectHealthDetails({
	        lookbackHours: Number(lookbackEl?.value ?? 336),
	        bucketMinutes: Number(bucketEl?.value ?? 1440)
	      });
	    });

	    lookbackEl?.addEventListener('change', () => {
	      this.loadProjectHealthDetails({
	        lookbackHours: Number(lookbackEl?.value ?? 336),
	        bucketMinutes: Number(bucketEl?.value ?? 1440)
	      });
	    });

	    bucketEl?.addEventListener('change', () => {
	      this.loadProjectHealthDetails({
	        lookbackHours: Number(lookbackEl?.value ?? 336),
	        bucketMinutes: Number(bucketEl?.value ?? 1440)
	      });
	    });

	    filterEl?.addEventListener('input', () => {
	      try {
	        const body = document.getElementById('dashboard-project-health-body');
	        if (!body) return;
	        body.innerHTML = this.renderProjectHealthDetails(this._projectHealthData || {}, { filter: String(filterEl.value || '') });
	        this.attachProjectHealthHandlers();
	      } catch {}
	    });

	    await this.loadProjectHealthDetails({ lookbackHours: 336, bucketMinutes: 1440 });
	  }

	  hideProjectHealthOverlay() {
	    const overlay = document.getElementById('dashboard-project-health-overlay');
	    if (!overlay) return;
	    overlay.classList.add('hidden');
	    const handler = overlay._escHandler;
	    if (handler) {
	      document.removeEventListener('keydown', handler);
	      overlay._escHandler = null;
	    }
	    overlay.remove();
	  }

	  async loadProjectHealthDetails({ lookbackHours = 336, bucketMinutes = 1440 } = {}) {
	    const body = document.getElementById('dashboard-project-health-body');
	    const overlay = document.getElementById('dashboard-project-health-overlay');
	    if (!overlay || !body) return;
	    body.textContent = 'Loading…';

	    const hours = Number(lookbackHours);
	    const bucket = Number(bucketMinutes);
	    const safeHours = Number.isFinite(hours) && hours > 0 ? hours : 336;
	    const safeBucket = Number.isFinite(bucket) && bucket > 0 ? bucket : 1440;

	    const filterEl = overlay.querySelector('#dashboard-project-health-filter');
	    const filter = String(filterEl?.value || '');

	    try {
	      const url = `/api/process/projects/health?lookbackHours=${encodeURIComponent(String(safeHours))}&bucketMinutes=${encodeURIComponent(String(safeBucket))}`;
	      const res = await fetch(url).catch(() => null);
	      const data = res ? await res.json().catch(() => ({})) : {};
	      if (!res || !res.ok) {
	        body.textContent = 'Failed to load.';
	        return;
	      }
	      this._projectHealthData = data;
	      body.innerHTML = this.renderProjectHealthDetails(data, { filter });
	      this.attachProjectHealthHandlers();
	    } catch {
	      body.textContent = 'Failed to load.';
	    }
	  }

	  attachProjectHealthHandlers() {
	    const root = document.getElementById('dashboard-project-health-body');
	    if (!root) return;
	    root.querySelectorAll('[data-open-repo-health]').forEach((btn) => {
	      btn.addEventListener('click', () => {
	        const repo = btn.getAttribute('data-open-repo-health') || '';
	        if (!repo) return;
	        try {
	          localStorage.setItem('prs-panel-repo', repo);
	        } catch {}
	        try {
	          this.orchestrator?.showPRsPanel?.();
	        } catch {}
	      });
	    });
	  }

	  renderProjectHealthDetails(data, { filter = '' } = {}) {
	    const escapeHtml = (value) => String(value ?? '')
	      .replace(/&/g, '&amp;')
	      .replace(/</g, '&lt;')
	      .replace(/>/g, '&gt;');

	    const repos = Array.isArray(data?.repos) ? data.repos : [];
	    const totals = data?.totals || {};
	    const filterText = String(filter || '').trim().toLowerCase();

	    const pickWorst = (counts) => {
	      const c = counts && typeof counts === 'object' ? counts : {};
	      if (Number(c.critical || 0) > 0) return 'critical';
	      if (Number(c.high || 0) > 0) return 'high';
	      if (Number(c.medium || 0) > 0) return 'medium';
	      if (Number(c.low || 0) > 0) return 'low';
	      return '';
	    };

	    const riskChip = (risk) => {
	      const r = String(risk || '').trim().toLowerCase();
	      if (!r) return '';
	      const cls = (r === 'critical' || r === 'high') ? 'level-warn' : '';
	      return `<span class="process-chip ${cls}">${escapeHtml(r)}</span>`;
	    };

	    const fmtHours = (n) => {
	      const v = Number(n);
	      if (!Number.isFinite(v) || v <= 0) return '—';
	      if (v < 2) return `${Math.round(v * 60)}m`;
	      if (v < 48) return `${v.toFixed(1)}h`;
	      const d = v / 24;
	      return `${d.toFixed(1)}d`;
	    };

	    const spark = (series) => {
	      const rows = Array.isArray(series) ? series : [];
	      if (!rows.length) return '';
	      const nets = rows.map((b) => Number(b?.createdCount || 0) - Number(b?.mergedCount || 0));
	      const maxAbs = Math.max(1, ...nets.map(n => Math.abs(n)));
	      return `
	        <div style="display:flex; align-items:flex-end; gap:2px; height:26px;">
	          ${rows.map((b, idx) => {
	            const net = nets[idx];
	            const abs = Math.abs(net);
	            const h = Math.max(2, Math.round(24 * abs / maxAbs));
	            const color = net > 0 ? '#d19a2b' : (net < 0 ? '#2dbf71' : '#4a5568');
	            const label = `${new Date(Number(b?.t || 0)).toLocaleDateString()} • net ${net}`;
	            return `<div style="width:6px; height:${h}px; background:${color}; border-radius:2px; opacity:0.9;" title="${escapeHtml(label)}"></div>`;
	          }).join('')}
	        </div>
	      `;
	    };

	    const filtered = filterText
	      ? repos.filter(r => String(r?.repo || '').toLowerCase().includes(filterText))
	      : repos;

	    return `
	      <div class="dashboard-telemetry-meta">
	        <div>Repos <strong>${Number(totals?.repos ?? filtered.length ?? 0)}</strong></div>
	        <div>Open backlog <strong>${Number(totals?.openBacklog ?? 0)}</strong></div>
	        <div>Created <strong>${Number(totals?.createdCount ?? 0)}</strong> • Merged <strong>${Number(totals?.mergedCount ?? 0)}</strong> • needs_fix <strong>${Number(totals?.needsFixCount ?? 0)}</strong></div>
	      </div>
	      <div style="display:flex; flex-direction:column; gap:10px;">
	        ${filtered.length ? filtered.map((r) => {
	          const repo = String(r?.repo || '').trim();
	          const t = r?.totals || {};
	          const open = Number(r?.openBacklog ?? 0);
	          const created = Number(t?.createdCount ?? 0);
	          const merged = Number(t?.mergedCount ?? 0);
	          const needsFix = Number(t?.needsFixCount ?? 0);
	          const worst = pickWorst(r?.openRiskCounts);
	          const avgCycle = fmtHours(t?.avgCycleHours);
	          const p50Cycle = fmtHours(t?.p50CycleHours);
	          return `
	            <div class="dashboard-telemetry-meta" style="display:flex; justify-content:space-between; gap:14px;">
	              <div style="min-width:0; flex:1; display:flex; flex-direction:column; gap:6px;">
	                <div style="display:flex; align-items:center; gap:10px;">
	                  <button class="btn-secondary" type="button" data-open-repo-health="${escapeHtml(repo)}" title="Open PRs filtered to ${escapeHtml(repo)}" style="max-width: 520px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
	                    ${escapeHtml(repo)}
	                  </button>
	                  ${worst ? riskChip(worst) : ''}
	                  <span style="opacity:0.8;">open <strong>${open}</strong></span>
	                </div>
	                <div style="opacity:0.9;">
	                  created <strong>${created}</strong> • merged <strong>${merged}</strong> • needs_fix <strong>${needsFix}</strong>
	                  <span style="opacity:0.75;"> • cycle avg <strong>${escapeHtml(avgCycle)}</strong> • p50 <strong>${escapeHtml(p50Cycle)}</strong></span>
	                </div>
	              </div>
	              <div style="flex:0 0 auto; display:flex; align-items:center;">
	                ${spark(r?.series)}
	              </div>
	            </div>
	          `;
	        }).join('') : `<div style="opacity:0.8;">No project records found.</div>`}
	      </div>
	    `;
	  }

	  async loadTelemetryDetails({ lookbackHours = 24, bucketMinutes = 60 } = {}) {
	    const overlay = document.getElementById('dashboard-telemetry-overlay');
	    const body = document.getElementById('dashboard-telemetry-body');
	    if (!overlay || !body) return;
	    body.textContent = 'Loading…';

	    const hours = Number(lookbackHours);
	    const bucket = Number(bucketMinutes);
	    const safeHours = Number.isFinite(hours) && hours > 0 ? hours : 24;
	    const safeBucket = Number.isFinite(bucket) && bucket > 0 ? bucket : 60;
	    const detailsUrl = `/api/process/telemetry/details?lookbackHours=${encodeURIComponent(String(safeHours))}&bucketMinutes=${encodeURIComponent(String(safeBucket))}`;
	    const benchmarkUrl = `/api/process/telemetry/benchmarks?lookbackHours=${encodeURIComponent(String(safeHours))}&bucketMinutes=${encodeURIComponent(String(safeBucket))}&limit=8`;

	    try {
	      const [detailsRes, benchmarkRes] = await Promise.all([
	        fetch(detailsUrl).catch(() => null),
	        fetch(benchmarkUrl).catch(() => null)
	      ]);

	      const data = detailsRes ? await detailsRes.json().catch(() => ({})) : {};
	      if (!detailsRes || !detailsRes.ok) {
	        body.textContent = 'Failed to load.';
	        return;
	      }
	      const benchmark = benchmarkRes && benchmarkRes.ok
	        ? await benchmarkRes.json().catch(() => null)
	        : null;
	      body.innerHTML = this.renderTelemetryDetails(data, benchmark);
	    } catch {
	      body.textContent = 'Failed to load.';
	    }
	  }

	  async createTelemetrySnapshotLink({ lookbackHours = 24, bucketMinutes = 60 } = {}) {
	    const hours = Number(lookbackHours);
	    const bucket = Number(bucketMinutes);
	    const safeHours = Number.isFinite(hours) && hours > 0 ? hours : 24;
	    const safeBucket = Number.isFinite(bucket) && bucket > 0 ? bucket : 60;

	    try {
	      const res = await fetch('/api/process/telemetry/snapshots', {
	        method: 'POST',
	        headers: { 'Content-Type': 'application/json' },
	        body: JSON.stringify({ lookbackHours: safeHours, bucketMinutes: safeBucket })
	      }).catch(() => null);
	      const data = res ? await res.json().catch(() => ({})) : {};
	      if (!res || !res.ok) throw new Error(data?.error || 'Failed to create snapshot');

	      const url = String(data?.url || '').trim();
	      const full = url.startsWith('http') ? url : `${window.location.origin}${url}`;
	      await this.copyToClipboard(full);
	      try { this.orchestrator?.showToast?.('Snapshot link copied', 'success'); } catch {}
	    } catch (e) {
	      try { this.orchestrator?.showToast?.(String(e?.message || e), 'error'); } catch {}
	    }
	  }

	  async createTelemetryBenchmarkSnapshot({ lookbackHours = 24, bucketMinutes = 60 } = {}) {
	    const hours = Number(lookbackHours);
	    const bucket = Number(bucketMinutes);
	    const safeHours = Number.isFinite(hours) && hours > 0 ? hours : 24;
	    const safeBucket = Number.isFinite(bucket) && bucket > 0 ? bucket : 60;
	    const defaultLabel = `release ${new Date().toISOString().slice(0, 10)}`;
	    const label = window.prompt('Benchmark label (release/tag)', defaultLabel);
	    if (label === null) return;

	    try {
	      const res = await fetch('/api/process/telemetry/benchmarks/snapshots', {
	        method: 'POST',
	        headers: { 'Content-Type': 'application/json' },
	        body: JSON.stringify({
	          label,
	          lookbackHours: safeHours,
	          bucketMinutes: safeBucket
	        })
	      }).catch(() => null);
	      const data = res ? await res.json().catch(() => ({})) : {};
	      if (!res || !res.ok) throw new Error(data?.error || 'Failed to create benchmark snapshot');
	      try { this.orchestrator?.showToast?.(`Benchmark saved: ${String(data?.label || 'snapshot')}`, 'success'); } catch {}
	      this.loadTelemetryDetails({ lookbackHours: safeHours, bucketMinutes: safeBucket });
	    } catch (e) {
	      try { this.orchestrator?.showToast?.(String(e?.message || e), 'error'); } catch {}
	    }
	  }

	  async copyTelemetryReleaseNotes({ lookbackHours = 24, bucketMinutes = 60 } = {}) {
	    const hours = Number(lookbackHours);
	    const bucket = Number(bucketMinutes);
	    const safeHours = Number.isFinite(hours) && hours > 0 ? hours : 24;
	    const safeBucket = Number.isFinite(bucket) && bucket > 0 ? bucket : 60;
	    const url = `/api/process/telemetry/benchmarks/release-notes?currentId=live&lookbackHours=${encodeURIComponent(String(safeHours))}&bucketMinutes=${encodeURIComponent(String(safeBucket))}`;
	    try {
	      const res = await fetch(url).catch(() => null);
	      const data = res ? await res.json().catch(() => ({})) : {};
	      if (!res || !res.ok) throw new Error(data?.error || 'Failed to build release notes');
	      const markdown = String(data?.markdown || '').trim();
	      if (!markdown) throw new Error('Release notes were empty');
	      await this.copyToClipboard(markdown);
	      try { this.orchestrator?.showToast?.('Release notes copied', 'success'); } catch {}
	    } catch (e) {
	      try { this.orchestrator?.showToast?.(String(e?.message || e), 'error'); } catch {}
	    }
	  }

	  async copyToClipboard(text) {
	    const t = String(text || '');
	    if (!t) return;
	    try {
	      if (navigator?.clipboard?.writeText) {
	        await navigator.clipboard.writeText(t);
	        return;
	      }
	    } catch {
	      // fall through
	    }
	    try {
	      window.prompt('Copy link:', t);
	    } catch {
	      // ignore
	    }
	  }

	  async loadTelemetryPluginActions(overlay) {
	    const holder = overlay?.querySelector?.('#dashboard-telemetry-plugin-actions');
	    if (!holder) return;
	    holder.innerHTML = '';
	    const host = window.orchestratorPluginHost;
	    if (!host || typeof host.refresh !== 'function') return;
	    try {
	      await host.refresh({ slot: 'dashboard.telemetry.actions', force: true });
	      const items = host.getSlotItems('dashboard.telemetry.actions');
	      if (!items.length) return;
	      for (const item of items) {
	        const btn = document.createElement('button');
	        btn.type = 'button';
	        btn.className = 'btn-secondary';
	        btn.textContent = String(item?.label || item?.id || 'Plugin');
	        const desc = String(item?.description || '').trim();
	        if (desc) btn.title = desc;
	        btn.addEventListener('click', async () => {
	          try {
	            const result = await host.runAction(item, { orchestrator: this.orchestrator });
	            if (result?.ok) return;
	            this.orchestrator?.showToast?.(String(result?.error || 'Plugin action failed'), 'error');
	          } catch (error) {
	            this.orchestrator?.showToast?.(String(error?.message || error), 'error');
	          }
	        });
	        holder.appendChild(btn);
	      }
	    } catch {
	      // ignore plugin slot errors in dashboard
	    }
	  }

	  renderTelemetryDetails(data, benchmarkData = null) {
	    const escapeHtml = (value) => String(value ?? '')
	      .replace(/&/g, '&amp;')
	      .replace(/</g, '&lt;')
	      .replace(/>/g, '&gt;');

	    const series = Array.isArray(data?.series) ? data.series : [];
	    const bucketMinutes = Number(data?.bucketMinutes ?? 60);
	    const reviewedCount = Number(data?.reviewedCount ?? 0);
	    const promptSentCount = Number(data?.promptSentCount ?? 0);
	    const doneCount = Number(data?.doneCount ?? 0);
	    const avgReviewSeconds = Number.isFinite(Number(data?.avgReviewSeconds)) ? Number(data.avgReviewSeconds) : null;
	    const avgPromptChars = Number.isFinite(Number(data?.avgPromptChars)) ? Number(data.avgPromptChars) : null;
	    const avgVerifyMinutes = Number.isFinite(Number(data?.avgVerifyMinutes)) ? Number(data.avgVerifyMinutes) : null;
	    const oc = (data?.outcomeCounts && typeof data.outcomeCounts === 'object') ? data.outcomeCounts : {};

	    const formatSeconds = (n) => {
	      const v = Number(n);
	      if (!Number.isFinite(v)) return '—';
	      if (v < 60) return `${Math.round(v)}s`;
	      const m = v / 60;
	      if (m < 60) return `${Math.round(m)}m`;
	      const h = m / 60;
	      return `${h.toFixed(1)}h`;
	    };

	    const sparkline = (points, key, { width = 460, height = 64 } = {}) => {
	      const vals = points.map((p) => Number(p?.[key])).filter((v) => Number.isFinite(v));
	      if (vals.length < 2) {
	        return `<div class="telemetry-empty">Not enough data.</div>`;
	      }
	      const min = Math.min(...vals);
	      const max = Math.max(...vals);
	      const range = max - min || 1;
	      const pad = 6;
	      const plotW = width - pad * 2;
	      const plotH = height - pad * 2;
	      const coords = points.map((p, idx) => {
	        const v = Number(p?.[key]);
	        if (!Number.isFinite(v)) return null;
	        const x = pad + (idx / (points.length - 1)) * plotW;
	        const y = pad + (1 - (v - min) / range) * plotH;
	        return `${x.toFixed(2)},${y.toFixed(2)}`;
	      }).filter(Boolean);
	      if (coords.length < 2) return `<div class="telemetry-empty">Not enough data.</div>`;
	      return `
	        <svg class="telemetry-sparkline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="Trend">
	          <polyline fill="none" stroke="var(--accent-primary)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${coords.join(' ')}"></polyline>
	        </svg>
	      `;
	    };

	    const histogram = (hist, { formatLabel = null } = {}) => {
	      const bins = Array.isArray(hist?.bins) ? hist.bins : [];
	      const maxCount = Number(hist?.maxCount ?? 0) || 0;
	      if (!bins.length || maxCount <= 0) return `<div class="telemetry-empty">No samples.</div>`;
	      const labelFor = (b) => {
	        const mid = (Number(b?.min) + Number(b?.max)) / 2;
	        if (typeof formatLabel === 'function') return formatLabel(mid);
	        return String(Math.round(mid));
	      };
	      return `
	        <div class="telemetry-bar-chart" role="img" aria-label="Histogram">
	          ${bins.map((b) => {
	            const c = Number(b?.count ?? 0) || 0;
	            const h = Math.round((c / maxCount) * 100);
	            return `<div class="telemetry-bar" title="${escapeHtml(labelFor(b))}: ${c}" style="height:${h}%;"></div>`;
	          }).join('')}
	        </div>
	      `;
	    };

	    const reviewHist = data?.histograms?.reviewSeconds;
	    const promptHist = data?.histograms?.promptChars;
	    const benchmarkSection = this.renderTelemetryBenchmark(benchmarkData);

	    return `
	      <div class="dashboard-telemetry-meta">
	        <div>Bucket <strong>${escapeHtml(bucketMinutes)}m</strong></div>
	        <div>Reviews <strong>${reviewedCount}</strong> • prompts <strong>${promptSentCount}</strong> • done <strong>${doneCount}</strong></div>
	        <div>Avg review <strong>${escapeHtml(formatSeconds(avgReviewSeconds))}</strong> • avg prompt <strong>${avgPromptChars === null ? '—' : escapeHtml(Math.round(avgPromptChars))}</strong></div>
	        <div>Avg verify <strong>${avgVerifyMinutes === null ? '—' : escapeHtml(`${Math.round(avgVerifyMinutes)}m`)}</strong></div>
	        <div>Outcomes: approved <strong>${Number(oc?.approved ?? 0)}</strong> • needs_fix <strong>${Number(oc?.needs_fix ?? 0)}</strong> • commented <strong>${Number(oc?.commented ?? 0)}</strong></div>
	      </div>
	      <div class="telemetry-chart-grid">
	        <div class="telemetry-chart-card">
	          <div class="telemetry-chart-title">Avg review time</div>
	          ${sparkline(series, 'avgReviewSeconds', { width: 520, height: 72 })}
	        </div>
	        <div class="telemetry-chart-card">
	          <div class="telemetry-chart-title">Avg prompt chars</div>
	          ${sparkline(series, 'avgPromptChars', { width: 520, height: 72 })}
	        </div>
	        <div class="telemetry-chart-card">
	          <div class="telemetry-chart-title">Done throughput</div>
	          ${sparkline(series, 'doneCount', { width: 520, height: 72 })}
	        </div>
	      </div>
	      <div class="telemetry-chart-grid">
	        <div class="telemetry-chart-card">
	          <div class="telemetry-chart-title">Review time distribution</div>
	          ${histogram(reviewHist, { formatLabel: (v) => formatSeconds(v) })}
	        </div>
	        <div class="telemetry-chart-card">
	          <div class="telemetry-chart-title">Prompt size distribution</div>
	          ${histogram(promptHist, { formatLabel: (v) => `${Math.round(Number(v) || 0)}` })}
	        </div>
	      </div>
	      ${benchmarkSection}
	    `;
	  }

	  renderTelemetryBenchmark(data) {
	    const escapeHtml = (value) => String(value ?? '')
	      .replace(/&/g, '&amp;')
	      .replace(/</g, '&lt;')
	      .replace(/>/g, '&gt;');
	    const rows = Array.isArray(data?.rows) ? data.rows : [];
	    if (!rows.length) {
	      return `
	        <div class="telemetry-chart-card">
	          <div class="telemetry-chart-title">Release benchmark</div>
	          <div class="telemetry-empty">No benchmark snapshots captured yet.</div>
	        </div>
	      `;
	    }

	    const formatSeconds = (value) => {
	      const n = Number(value);
	      if (!Number.isFinite(n) || n <= 0) return '—';
	      if (n < 60) return `${Math.round(n)}s`;
	      if (n < 3600) return `${Math.round(n / 60)}m`;
	      return `${(n / 3600).toFixed(1)}h`;
	    };
	    const sign = (value) => {
	      const n = Number(value);
	      if (!Number.isFinite(n)) return '—';
	      return n > 0 ? `+${Math.round(n)}` : `${Math.round(n)}`;
	    };

	    const listHtml = rows.slice(0, 6).map((row) => {
	      const metrics = row?.metrics || {};
	      const onboarding = Number(metrics?.onboarding?.score ?? 0);
	      const runtime = Number(metrics?.runtime?.score ?? 0);
	      const review = Number(metrics?.review?.score ?? 0);
	      const cycle = metrics?.review?.avgReviewSeconds;
	      const done = Number(metrics?.review?.doneCount ?? 0);
	      const merged = Number(metrics?.review?.prMergedCount ?? 0);
	      const delta = row?.deltaFromPrevious || null;
	      const deltaText = delta
	        ? `Δ onboarding ${sign(delta.onboardingScore)} • runtime ${sign(delta.runtimeScore)} • review ${sign(delta.reviewScore)}`
	        : 'Δ baseline n/a';
	      return `
	        <div class="dashboard-telemetry-meta" style="display:flex; justify-content:space-between; gap:10px; border-top:1px solid var(--border-color); padding-top:8px;">
	          <div style="min-width:0;">
	            <div><strong>${escapeHtml(String(row?.label || row?.id || 'snapshot'))}</strong> <span style="opacity:0.7;">(${escapeHtml(String(row?.createdAt || ''))})</span></div>
	            <div style="opacity:0.85;">${escapeHtml(deltaText)}</div>
	          </div>
	          <div style="text-align:right; white-space:nowrap;">
	            <div>onboarding <strong>${onboarding}</strong> • runtime <strong>${runtime}</strong> • review <strong>${review}</strong></div>
	            <div style="opacity:0.85;">cycle <strong>${escapeHtml(formatSeconds(cycle))}</strong> • done <strong>${done}</strong> • merged <strong>${merged}</strong></div>
	          </div>
	        </div>
	      `;
	    }).join('');

	    return `
	      <div class="telemetry-chart-card">
	        <div class="telemetry-chart-title">Release benchmark snapshots</div>
	        <div style="opacity:0.85; margin-bottom:6px;">Track onboarding, runtime and review metrics across releases.</div>
	        ${listHtml}
	      </div>
	    `;
	  }

  generateWorkspaceCard(workspace, isActive) {
    const lastUsed = this.getLastUsed(workspace);
    const health = workspace?.health && typeof workspace.health === 'object' ? workspace.health : null;
    const staleCount = Number(health?.staleCandidates?.length || 0);
    const removedCount = Number(health?.removedTerminals?.length || 0);
    const dedupedCount = Number(health?.dedupedTerminalIds?.length || 0);
    const fixedCount = Number(health?.fixedWorktreePaths?.length || 0);
    const warnCount = staleCount + removedCount + dedupedCount;
    
    const svgIcon = (path, cls="") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">${path}</svg>`;
    const SVGS = {
      warn: svgIcon('<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>', 'icon-warn'),
      clean: svgIcon('<path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'),
      open: svgIcon('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>'),
      rename: svgIcon('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>'),
      export: svgIcon('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
      trash: svgIcon('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>')
    };

    const warnChip = warnCount
      ? `<span class="process-chip level-warn" title="Workspace has stale/invalid terminal entries">⚠ ${warnCount}</span>`
      : '';

    return `
      <div class="workspace-card bento-workspace-card ${isActive ? 'active' : ''}" data-workspace-id="${workspace.id}" data-workspace-active="${isActive ? 'true' : 'false'}">
        <div class="workspace-card-header">
          <span class="workspace-icon bento-workspace-icon">${workspace.icon}</span>
          <div class="workspace-info">
            <h3>${workspace.name}</h3>
            ${workspace.type && workspace.type !== 'custom' ? `<p class="workspace-type">${this.getWorkspaceTypeLabel(workspace.type)}</p>` : ''}
          </div>
          ${warnChip}
        </div>

        <div class="workspace-card-body">
          <div class="workspace-meta">
            <p class="last-used">${lastUsed}</p>
          </div>

          ${warnCount ? `
            <div class="workspace-health bento-workspace-health">
              <div class="health-info-row">
                <div class="health-text">
                  <strong>Cleanup</strong>
                  <span>${removedCount ? `${removedCount} removed` : ''}${removedCount && dedupedCount ? ' • ' : ''}${dedupedCount ? `${dedupedCount} deduped` : ''}${(removedCount || dedupedCount) && staleCount ? ' • ' : ''}${staleCount ? `${staleCount} stale` : ''}</span>
                </div>
                <button class="btn-secondary workspace-cleanup-btn" type="button" title="Clean workspace">🧹 Clean</button>
              </div>
              ${fixedCount ? `<div class="health-subtext">Fixed ${fixedCount} worktree path${fixedCount === 1 ? '' : 's'}.</div>` : ''}
            </div>
          ` : ''}
        </div>

        <div class="workspace-card-footer bento-card-footer">
          <button class="${isActive ? 'btn-secondary workspace-open-btn workspace-open-btn-active' : 'btn-primary workspace-open-btn workspace-open-btn-inactive'} bento-btn-primary">
            ${isActive ? '↩ Return to Workspace' : 'Open Workspace'}
          </button>
          <div class="bento-action-group">
            <button class="btn-icon workspace-rename-btn" title="Rename workspace">
              ✏️
            </button>
            <button class="btn-icon workspace-delete-btn btn-danger-icon" title="Delete workspace">
              🗑️
            </button>
          </div>
        </div>
      </div>
    `;
  }

  generateDeletedWorkspaceCard(workspace) {
    const deletedAtLabel = this.formatTimeAgo(workspace?.deletedAt);
    const restoreDisabled = workspace?.restoreAvailable === false;
    const restoreTitle = restoreDisabled
      ? 'Restore unavailable because a workspace with this id already exists'
      : 'Restore workspace';

    return `
      <div class="workspace-card bento-workspace-card deleted-workspace-card" data-deleted-workspace-id="${workspace.deletedId}">
        <div class="workspace-card-header">
          <span class="workspace-icon bento-workspace-icon">${workspace.icon || '🧱'}</span>
          <div class="workspace-info">
            <h3>${workspace.name}</h3>
            <p class="workspace-type">Recently deleted</p>
          </div>
        </div>

        <div class="workspace-card-body">
          <div class="workspace-meta">
            <p class="last-used">${deletedAtLabel ? `Deleted ${deletedAtLabel}` : 'Deleted recently'}</p>
          </div>
        </div>

        <div class="workspace-card-footer bento-card-footer">
          <button class="btn-secondary workspace-restore-btn bento-btn-primary" type="button" title="${restoreTitle}" ${restoreDisabled ? 'disabled' : ''}>
            Restore Workspace
          </button>
          <div class="bento-action-group">
            <button
              class="btn-icon workspace-permanent-delete-btn btn-danger-icon"
              type="button"
              title="Permanently delete archived workspace"
              aria-label="Permanently delete archived workspace"
            >
              🗑️
            </button>
          </div>
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
          <button class="btn-secondary workspace-import-btn" title="Import a workspace config (JSON)">⬆ Import</button>
        </div>
      </div>
    `;
  }

  generateCreateProjectCard() {
    return `
      <div class="workspace-card create-card create-project-card">
        <div class="workspace-card-header">
          <span class="workspace-icon">✨</span>
          <div class="workspace-info">
            <h3>New Project</h3>
            <p class="workspace-type">Greenfield Flow</p>
          </div>
        </div>

        <div class="workspace-card-body">
          <p>Create a brand-new project, scaffold it, and open a workspace in one flow</p>
        </div>

        <div class="workspace-card-footer">
          <button class="btn-primary workspace-create-project-btn">Create Project</button>
        </div>
      </div>
    `;
  }

  generateQuickLinksHTML() {
    const globalShortcuts = this.orchestrator.orchestratorConfig?.globalShortcuts || [];
    const hasQuickLinksData = this.quickLinks &&
      (this.quickLinks.data?.favorites?.length > 0 ||
       this.quickLinks.data?.recentSessions?.length > 0 ||
       this.quickLinks.data?.customLinks?.length > 0 ||
       this.quickLinks.data?.products?.length > 0);

    if (hasQuickLinksData) {
      return this.quickLinks.generateDashboardHTML();
    }

    if (globalShortcuts.length === 0) {
      return '<div class="quick-links-empty">No links configured. Add shortcuts in Settings.</div>';
    }

    const svgIcon = (path) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">${path}</svg>`;
    const SVGS = {
      settings: svgIcon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
      rocket: svgIcon('<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>'),
      link: svgIcon('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>')
    };

    return globalShortcuts.map(shortcut => `
      <a href="${shortcut.url}" target="_blank" class="quick-link-item bento-quick-link" title="${shortcut.label}">
        <span class="quick-link-icon">🔗</span>
        <span class="quick-link-label">${shortcut.label}</span>
      </a>
    `).join('') + `
      <button class="quick-link-item bento-quick-link settings-link" onclick="window.orchestrator.showSettings()">
        <span class="quick-link-icon">⚙️</span>
        <span class="quick-link-label">Settings</span>
      </button>
      <button class="quick-link-item bento-quick-link setup-link" onclick="window.dashboard.installWindowsStartup()" title="Setup auto-start on Windows login">
        <span class="quick-link-icon">🚀</span>
        <span class="quick-link-label">Windows Startup</span>
      </button>
    `;
  }


  setupEventListeners() {
    // Back button to return to the current tabbed workspace view (when available)
    document.getElementById('dashboard-back-btn')?.addEventListener('click', () => {
      this.returnToWorkspaceView();
    });

    // Workspace card click handlers
    document.querySelectorAll('.workspace-open-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = e.target.closest('.workspace-card');
        const workspaceId = card?.dataset?.workspaceId;
        const isActive = card?.dataset?.workspaceActive === 'true';
        if (isActive) {
          this.returnToWorkspaceView(workspaceId);
          return;
        }
        this.openWorkspace(workspaceId);
      });
    });

    document.querySelectorAll('.workspace-cleanup-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const card = e.target.closest('.workspace-card');
        const workspaceId = card?.dataset?.workspaceId;
        if (!workspaceId) return;
        await this.cleanupWorkspaceTerminals(workspaceId);
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

    document.querySelectorAll('.workspace-restore-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const card = e.target.closest('.deleted-workspace-card');
        const deletedWorkspaceId = card?.dataset?.deletedWorkspaceId;
        if (!deletedWorkspaceId || btn.disabled) return;
        await this.restoreWorkspace(deletedWorkspaceId);
      });
    });

    document.querySelectorAll('.workspace-permanent-delete-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const card = e.target.closest('.deleted-workspace-card');
        const deletedWorkspaceId = card?.dataset?.deletedWorkspaceId;
        const workspace = this.deletedWorkspaces.find((entry) => String(entry?.deletedId || '').trim() === String(deletedWorkspaceId || '').trim());
        if (!workspace) return;
        await this.confirmPermanentDeleteDeletedWorkspace(workspace);
      });
    });

    document.querySelectorAll('.dashboard-section-toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const sectionKey = String(btn.getAttribute('data-dashboard-toggle') || '').trim();
        if (sectionKey === 'deleted-workspaces') {
          this.toggleDeletedWorkspacesSection();
        }
      });
    });

    document.querySelectorAll('.dashboard-deleted-delete-all-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await this.confirmPermanentDeleteAllDeletedWorkspaces();
      });
    });

    document.querySelectorAll('.workspace-rename-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = e.target.closest('.workspace-card');
        const workspaceId = card?.dataset?.workspaceId;
        const workspace = this.workspaces.find(ws => ws.id === workspaceId);
        if (!workspace) return;
        this.promptRenameWorkspace(workspace);
      });
    });

    // Workspace export handlers
    document.querySelectorAll('.workspace-export-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = e.target.closest('.workspace-card');
        const workspaceId = card?.dataset?.workspaceId;
        if (workspaceId) this.downloadWorkspaceExport(workspaceId);
      });
    });

    document.querySelectorAll('.workspace-create-empty-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.createEmptyWorkspaceQuick();
      });
    });

    // ESC: return to tabbed workspaces if dashboard was opened from there
    if (this._escHandler) {
      document.removeEventListener('keydown', this._escHandler);
    }
    this._escHandler = (e) => {
      if (e.key !== 'Escape' || !this.isVisible) return;
      if (this.orchestrator.tabManager?.tabs?.size) {
        this.returnToWorkspaceView();
      }
    };
    document.addEventListener('keydown', this._escHandler);
  }

  async cleanupWorkspaceTerminals(workspaceId) {
    const id = String(workspaceId || '').trim();
    if (!id) return;
    try {
      this.orchestrator?.showToast?.('Cleaning workspace terminals…', 'info');
      const res = await fetch(`/api/workspaces/${encodeURIComponent(id)}/cleanup-terminals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(String(data?.error || data?.message || 'Cleanup failed'));
      }
      const removed = Number(data?.health?.removedTerminals?.length || 0);
      const deduped = Number(data?.health?.dedupedTerminalIds?.length || 0);
      const msg = (removed || deduped)
        ? `Cleaned ${removed} removed • ${deduped} deduped`
        : 'No stale terminals found';
      this.orchestrator?.showToast?.(msg, 'success');

      await this.refreshWorkspaceCollections({ refresh: true, render: this.isVisible });
    } catch (err) {
      this.orchestrator?.showToast?.(`Cleanup failed: ${String(err?.message || err)}`, 'error');
    }
  }

  showCreateProjectWizard() {
    if (typeof this.orchestrator?.openGreenfieldWizard === 'function') {
      this.orchestrator.openGreenfieldWizard().catch((error) => {
        this.orchestrator?.showToast?.(`Failed to open New Project wizard: ${String(error?.message || error)}`, 'error');
      });
      return;
    }
    this.orchestrator?.showToast?.('New Project wizard is unavailable in this build', 'warning');
  }

  async openWorkspace(workspaceId) {
    console.log('Opening workspace:', workspaceId);

    const recoveryPlan = await this.planRecoveryForWorkspace(workspaceId, { interactive: true });
    if (recoveryPlan?.action === 'cancel') {
      return;
    }
    if (recoveryPlan?.pending) {
      this.pendingRecovery = recoveryPlan.pending;
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
  }

  async planRecoveryForWorkspace(workspaceId, { interactive = true } = {}) {
    const targetWorkspaceId = String(workspaceId || '').trim();
    if (!targetWorkspaceId) {
      return { action: 'skip', pending: null };
    }

    const recoverySettings = this.orchestrator.userSettings?.global?.sessionRecovery || {};
    const recoveryEnabled = recoverySettings.enabled !== false;
    const recoveryMode = recoverySettings.mode || 'ask';
    if (!recoveryEnabled) {
      return { action: 'skip', pending: null };
    }

    const recoveryInfo = await this.checkRecoveryState(targetWorkspaceId);
    if (!(recoveryInfo && recoveryInfo.recoverableSessions > 0)) {
      return { action: 'skip', pending: null };
    }

    const savedAt = String(recoveryInfo.savedAt || '').trim();
    const dismissKey = `orchestrator-recovery-dismissed:${targetWorkspaceId}`;
    if (savedAt) {
      try {
        const dismissedAt = String(localStorage.getItem(dismissKey) || '').trim();
        if (dismissedAt && dismissedAt === savedAt) {
          console.log('Skipping recovery dialog - dismissed for this snapshot');
          return { action: 'dismissed', pending: null };
        }
        if (dismissedAt) localStorage.removeItem(dismissKey);
      } catch {
        // ignore
      }
    }

    if (recoveryMode === 'auto') {
      console.log('Auto-recovering all sessions');
      return {
        action: 'recover',
        pending: { workspaceId: targetWorkspaceId, mode: 'all', sessions: recoveryInfo.sessions }
      };
    }

    if (recoveryMode === 'ask' && interactive) {
      const shouldRecover = await this.showRecoveryDialog(targetWorkspaceId, recoveryInfo);
      if (shouldRecover === 'cancel') {
        return { action: 'cancel', pending: null };
      }
      const pending = shouldRecover && typeof shouldRecover === 'object'
        ? { workspaceId: targetWorkspaceId, ...shouldRecover }
        : null;
      return pending ? { action: 'recover', pending } : { action: 'skip', pending: null };
    }

    return { action: 'skip', pending: null };
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

  returnToWorkspaceView(workspaceId = null) {
    const targetWorkspaceId = String(workspaceId || '').trim();
    const currentWorkspaceId = String(this.orchestrator.currentWorkspace?.id || '').trim();
    const tabManager = this.orchestrator.tabManager;
    const targetTab = targetWorkspaceId && tabManager?.findTabByWorkspaceId
      ? tabManager.findTabByWorkspaceId(targetWorkspaceId)
      : null;

    this.orchestrator.hideDashboard();

    if (!targetWorkspaceId || targetWorkspaceId === currentWorkspaceId || !targetTab || !tabManager) {
      return;
    }

    tabManager.switchTab(targetTab.id).catch?.((error) => {
      console.error('Failed to switch dashboard target tab:', error);
    });
  }

  async createEmptyWorkspaceQuick() {
    try {
      const existingIds = new Set(this.workspaces.map(ws => ws.id));
      const existingNumbers = this.workspaces
        .map(ws => {
          const match = String(ws?.name || '').match(/^Workspace\s+(\d+)$/i);
          return match ? Number(match[1]) : NaN;
        })
        .filter(n => Number.isFinite(n));
      const nextNumber = existingNumbers.length ? Math.max(...existingNumbers) + 1 : 1;
      const proposedName = `Workspace ${nextNumber}`;

      const requestedName = await this.orchestrator.showTextInputDialog('Add workspace', {
        message: 'Choose a name for the new workspace.',
        initialValue: proposedName,
        placeholder: 'Workspace name',
        confirmText: 'Create',
        cancelText: 'Cancel'
      });
      if (requestedName === null) return;

      const name = String(requestedName).trim() || proposedName;

      const sanitizeId = (value, fallback) => {
        const raw = String(value || '').trim().toLowerCase();
        const slug = raw
          .replace(/[^a-z0-9-]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-+|-+$/g, '');
        return slug || String(fallback || '').trim() || `workspace-${nextNumber}`;
      };

      const sanitizedBaseId = sanitizeId(name, `workspace-${nextNumber}`);
      let workspaceId = sanitizedBaseId;
      let dedupeIndex = 1;
      while (existingIds.has(workspaceId)) {
        dedupeIndex += 1;
        workspaceId = `${sanitizedBaseId}-${dedupeIndex}`;
      }

      const workspaceConfig = {
        id: workspaceId,
        name,
        type: 'custom',
        icon: '🧱',
        description: 'Workspace (add worktrees later)',
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

      const serverUrl = window.location.origin;
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
      this.orchestrator.upsertAvailableWorkspace?.(workspace);

      // Switch to new workspace
      this.openWorkspace(workspaceId);

      this.orchestrator.showTemporaryMessage(`Empty workspace "${name}" created`, 'success');
    } catch (error) {
      console.error('Failed to create empty workspace:', error);
      this.orchestrator.showTemporaryMessage(`Failed to create empty workspace: ${error.message}`, 'error');
    }
  }

  async promptRenameWorkspace(workspace) {
    if (!workspace || !workspace.id) return;

    const nextName = await this.orchestrator.showTextInputDialog('Rename workspace', {
      message: 'Enter a new name for this workspace.',
      initialValue: String(workspace.name || '').trim() || 'Workspace',
      placeholder: 'Workspace name',
      confirmText: 'Rename',
      cancelText: 'Cancel'
    });

    if (nextName === null) return;
    const cleanName = String(nextName).trim();
    if (!cleanName) {
      this.orchestrator.showToast?.('Workspace name cannot be empty', 'warning');
      return;
    }
    if (cleanName === String(workspace.name || '').trim()) return;

    await this.orchestrator.renameWorkspace?.(workspace.id, cleanName);
  }

  async updateCommanderToggle() {
    const btn = document.getElementById('dashboard-commander-toggle');
    if (!btn) return;
    try {
      const res = await fetch('/api/commander/status').catch(() => null);
      const data = res ? await res.json().catch(() => ({})) : {};
      const running = !!data?.running;
      btn.dataset.running = running ? 'true' : 'false';
      btn.textContent = running ? 'Commander: On' : 'Commander: Off';
    } catch {
      btn.dataset.running = 'false';
      btn.textContent = 'Commander: Off';
    }
  }

  async toggleCommanderFromDashboard() {
    const btn = document.getElementById('dashboard-commander-toggle');
    const running = btn?.dataset?.running === 'true';
    const endpoint = running ? '/api/commander/stop' : '/api/commander/start';
    try {
      await fetch(endpoint, { method: 'POST' }).catch(() => null);
    } catch {}
    await this.updateCommanderToggle();
  }

  async downloadWorkspaceExport(workspaceId) {
    const id = String(workspaceId || '').trim();
    if (!id) return;
    try {
      const url = `/api/workspaces/${encodeURIComponent(id)}/export`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(await resp.text());
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${id}.workspace.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2500);
    } catch (err) {
      try { this.orchestrator?.showToast?.(`Export failed: ${String(err?.message || err)}`, 'error'); } catch {}
    }
  }

  async importWorkspaceFromFile() {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.style.display = 'none';
      document.body.appendChild(input);

      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        input.remove();
        if (!file) return;
        try {
          const text = await file.text();
          const payload = JSON.parse(text);
          const resp = await fetch('/api/workspaces/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok || !data?.ok) {
            throw new Error(String(data?.error || 'Import failed'));
          }
          try { this.orchestrator?.showToast?.('Workspace imported', 'success'); } catch {}
          await this.loadWorkspaces();
          this.render();
        } catch (err) {
          try { this.orchestrator?.showToast?.(`Import failed: ${String(err?.message || err)}`, 'error'); } catch {}
        }
      });

      input.click();
    } catch (err) {
      try { this.orchestrator?.showToast?.(`Import failed: ${String(err?.message || err)}`, 'error'); } catch {}
    }
  }

  // Helper methods
  isWorkspaceActive(workspace) {
    const workspaceId = String(workspace?.id || '').trim();
    if (!workspaceId) return false;
    return this.getActiveWorkspaceIds().has(workspaceId);
  }

  getActiveWorkspaceIds() {
    const activeIds = new Set();
    const currentWorkspaceId = String(this.orchestrator.currentWorkspace?.id || '').trim();
    if (currentWorkspaceId) {
      activeIds.add(currentWorkspaceId);
    }

    const tabs = this.orchestrator.tabManager?.tabs;
    if (!(tabs instanceof Map)) {
      return activeIds;
    }

    for (const [, tab] of tabs.entries()) {
      const tabWorkspaceId = String(tab?.workspaceId || '').trim();
      if (tabWorkspaceId) {
        activeIds.add(tabWorkspaceId);
      }
    }

    return activeIds;
  }

  getLastUsed(workspace) {
    if (!workspace || typeof workspace !== 'object') return 'Last used: unknown';

    const timeAgo = this.formatTimeAgo(workspace.lastAccess);
    if (!timeAgo) return 'Last used: never';
    return `Last used: ${timeAgo}`;
  }

  /**
   * Format timestamp as relative time (shared with QuickLinks)
   */
  formatTimeAgo(timestamp) {
    if (!timestamp) return '';

    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';

    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
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

  async confirmDeleteWorkspace(workspace) {
    const confirmed = await this.orchestrator.showConfirmationDialog(
      'Delete Workspace',
      `Delete "${workspace.name}"?\n\nThis will move the workspace configuration to Recently Deleted, stop any running sessions, and keep all git worktrees and code intact.\n\nYou can restore it later from the dashboard.`,
      'Delete',
      'Cancel'
    );

    if (confirmed) {
      this.deleteWorkspace(workspace.id);
    }
  }

  loadDeletedWorkspacesExpandedPreference() {
    try {
      return localStorage.getItem('dashboard-deleted-workspaces-expanded') !== 'false';
    } catch {
      return true;
    }
  }

  saveDeletedWorkspacesExpandedPreference() {
    try {
      localStorage.setItem('dashboard-deleted-workspaces-expanded', this.deletedWorkspacesExpanded ? 'true' : 'false');
    } catch {}
  }

  toggleDeletedWorkspacesSection() {
    this.deletedWorkspacesExpanded = !this.deletedWorkspacesExpanded;
    this.saveDeletedWorkspacesExpandedPreference();

    const section = document.querySelector('[data-dashboard-section="deleted-workspaces"]');
    if (!section) return;

    section.classList.toggle('is-collapsed', !this.deletedWorkspacesExpanded);
    const toggleBtn = section.querySelector('.dashboard-section-toggle');
    const content = section.querySelector('.dashboard-section-content');
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-expanded', this.deletedWorkspacesExpanded ? 'true' : 'false');
    }
    if (content) {
      content.hidden = !this.deletedWorkspacesExpanded;
    }
  }

  async deleteWorkspace(workspaceId) {
    try {
      const serverUrl = window.location.origin;
      const response = await fetch(`${serverUrl}/api/workspaces/${workspaceId}`, {
        method: 'DELETE'
      });

      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload?.success) {
        console.log(`Deleted workspace: ${workspaceId}`);

        // Remove from local array
        this.workspaces = this.workspaces.filter(ws => ws.id !== workspaceId);
        this.deletedWorkspaces = Array.isArray(this.deletedWorkspaces)
          ? this.deletedWorkspaces
          : [];

        if (payload?.deletedWorkspace) {
          this.deletedWorkspaces = [
            payload.deletedWorkspace,
            ...this.deletedWorkspaces.filter((entry) => String(entry?.deletedId || '').trim() !== String(payload.deletedWorkspace?.deletedId || '').trim())
          ];
        }

        this.orchestrator.removeAvailableWorkspace?.(workspaceId);
        this.orchestrator.tabManager?.removeWorkspaceTabs?.(workspaceId, { activateFallback: true });

        await this.refreshWorkspaceCollections({ refresh: true, render: this.isVisible });

        // Show success message
        window.orchestrator?.showTemporaryMessage(`Workspace moved to Recently Deleted`, 'success');
      } else {
        const error = String(payload?.error || 'Failed to delete workspace');
        console.error('Delete failed:', error);
        window.orchestrator?.showTemporaryMessage(`Failed to delete workspace: ${error}`, 'error');
      }
    } catch (error) {
      console.error('Error deleting workspace:', error);
      window.orchestrator?.showTemporaryMessage(`Error: ${error.message}`, 'error');
    }
  }

  async confirmPermanentDeleteDeletedWorkspace(workspace) {
    const name = String(workspace?.name || 'this workspace').trim() || 'this workspace';
    const confirmed = await this.orchestrator.showConfirmationDialog(
      'Permanently Delete Workspace',
      `Permanently delete "${name}" from Recently Deleted?\n\nThis cannot be undone.`,
      'Delete Permanently',
      'Cancel'
    );

    if (confirmed) {
      await this.permanentlyDeleteDeletedWorkspace(String(workspace?.deletedId || '').trim());
    }
  }

  async permanentlyDeleteDeletedWorkspace(deletedWorkspaceId) {
    if (!deletedWorkspaceId) return;

    try {
      const response = await fetch(`/api/workspaces/deleted/${encodeURIComponent(deletedWorkspaceId)}`, {
        method: 'DELETE'
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        throw new Error(String(payload?.error || `Failed to permanently delete workspace (${response.status})`));
      }

      this.deletedWorkspaces = Array.isArray(this.deletedWorkspaces)
        ? this.deletedWorkspaces.filter((entry) => String(entry?.deletedId || '').trim() !== deletedWorkspaceId)
        : [];

      await this.refreshWorkspaceCollections({ refresh: true, render: this.isVisible });
      this.orchestrator?.showToast?.('Workspace permanently deleted', 'success');
    } catch (error) {
      this.orchestrator?.showToast?.(`Permanent delete failed: ${String(error?.message || error)}`, 'error');
    }
  }

  async confirmPermanentDeleteAllDeletedWorkspaces() {
    const deletedCount = Array.isArray(this.deletedWorkspaces) ? this.deletedWorkspaces.length : 0;
    if (deletedCount <= 0) return;

    const confirmed = await this.orchestrator.showConfirmationDialog(
      'Permanently Delete All',
      `Permanently delete all ${deletedCount} recently deleted workspace${deletedCount === 1 ? '' : 's'}?\n\nThis cannot be undone.`,
      'Delete All Permanently',
      'Cancel'
    );

    if (confirmed) {
      await this.permanentlyDeleteAllDeletedWorkspaces();
    }
  }

  async permanentlyDeleteAllDeletedWorkspaces() {
    try {
      const response = await fetch('/api/workspaces/deleted', {
        method: 'DELETE'
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        throw new Error(String(payload?.error || `Failed to permanently delete all workspaces (${response.status})`));
      }

      this.deletedWorkspaces = [];
      await this.refreshWorkspaceCollections({ refresh: true, render: this.isVisible });
      const deletedCount = Number(payload?.deletedCount || 0);
      this.orchestrator?.showToast?.(
        `Permanently deleted ${deletedCount} recently deleted workspace${deletedCount === 1 ? '' : 's'}`,
        'success'
      );
    } catch (error) {
      this.orchestrator?.showToast?.(`Permanent delete all failed: ${String(error?.message || error)}`, 'error');
    }
  }

  async restoreWorkspace(deletedWorkspaceId) {
    try {
      const response = await fetch(`/api/workspaces/deleted/${encodeURIComponent(deletedWorkspaceId)}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok || !payload?.workspace) {
        throw new Error(String(payload?.error || `Failed to restore workspace (${response.status})`));
      }

      this.orchestrator.upsertAvailableWorkspace?.(payload.workspace);
      await this.refreshWorkspaceCollections({ refresh: true, render: this.isVisible });
      this.orchestrator?.showToast?.(`Restored workspace "${payload.workspace.name}"`, 'success');
    } catch (error) {
      this.orchestrator?.showToast?.(`Restore failed: ${String(error?.message || error)}`, 'error');
    }
  }

  async loadDashboardPorts() {
    const gridEl = document.getElementById('ports-dashboard-grid');
    if (!gridEl) return;

    const serverUrl = window.location.origin;

    try {
      const response = await fetch(`${serverUrl}/api/ports/scan`);
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();

      if (!data.ports || data.ports.length === 0) {
        gridEl.innerHTML = '<div class="ports-empty">No ports detected</div>';
        return;
      }

      const knownTypes = new Set(['orchestrator', 'client', 'vite', 'react', 'node', 'game-server', 'flask', 'python', 'rails', 'diff-viewer']);
      const appPorts = data.ports.filter(p => knownTypes.has(p.type) || p.project?.project);
      const systemPorts = data.ports.filter(p => !knownTypes.has(p.type) && !p.project?.project);

      const renderCard = (p) => {
        const context = p.project?.project
          ? `${p.project.project}${p.project.worktree ? '/' + p.project.worktree : ''}`
          : formatDashboardPathTail(p.cwd, 1);
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
      };

      let html = '';
      if (appPorts.length) {
        html += `<div class="ports-group-label">Ports Related to Agent Workspace</div>`;
        html += appPorts.map(renderCard).join('');
      }
      if (systemPorts.length) {
        html += `<div class="ports-group-label ports-group-system">Other Ports</div>`;
        html += systemPorts.map(renderCard).join('');
      }
      gridEl.innerHTML = html;

    } catch (error) {
      console.error('Failed to load dashboard ports:', error);
      gridEl.innerHTML = '<div class="ports-empty">Failed to load ports</div>';
    }
  }

  async loadGitHubStatus() {
    const card = document.getElementById('github-status-card');
    const content = document.getElementById('github-status-content');
    if (!card || !content) return;

    try {
      const serverUrl = window.location.origin;
      const res = await fetch(`${serverUrl}/api/github/status`);
      const data = await res.json();

      card.style.display = '';

      if (data.authenticated) {
        content.innerHTML = `
          <div style="color: var(--success-color, #3fb950);">Connected</div>
          <div style="color: var(--text-muted); margin-top: 2px;">Signed in as <strong>${data.user || 'unknown'}</strong></div>
        `;
      } else if (!data.ghInstalled) {
        content.innerHTML = `
          <div style="color: var(--warning-color, #d29922);">GitHub CLI not installed</div>
          <div style="color: var(--text-muted); margin-top: 2px;">
            Install <a href="https://cli.github.com" target="_blank" rel="noopener">GitHub CLI</a> to enable repo discovery and PR features.
          </div>
        `;
      } else {
        content.innerHTML = `
          <div style="color: var(--warning-color, #d29922);">Not authenticated</div>
          <div style="color: var(--text-muted); margin-top: 2px;">
            Run <code>gh auth login</code> in a terminal to connect your GitHub account.
          </div>
        `;
      }
    } catch {
      // Silently skip if API unavailable
      card.style.display = 'none';
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

      let sessions = recoveryInfo.sessions || [];
      let savedAt = recoveryInfo.savedAt ? new Date(recoveryInfo.savedAt).toLocaleString() : 'Unknown';
      let savedAtRaw = String(recoveryInfo.savedAt || '').trim();
      let configuredTerminalCount = Number(recoveryInfo?.configuredTerminalCount || 0);
      let configuredWorktreeCount = Number(recoveryInfo?.configuredWorktreeCount || 0);

      const renderRecoverySummaryHtml = () => {
        const recoverableLabel = `${sessions.length} recoverable`;
        const worktreeLabel = `${configuredWorktreeCount || 0} configured worktree${configuredWorktreeCount === 1 ? '' : 's'}`;
        const terminalLabel = `${configuredTerminalCount || 0} configured terminal${configuredTerminalCount === 1 ? '' : 's'}`;
        return `
          <div class="recovery-metrics">
            <span class="recovery-metric-pill recovery-metric-primary">${recoverableLabel}</span>
            <span class="recovery-metric-pill">${worktreeLabel}</span>
            <span class="recovery-metric-pill">${terminalLabel}</span>
          </div>
          <div class="recovery-summary-text">
            Last recovery snapshot: ${savedAt}
          </div>
        `;
      };

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
            ${renderRecoverySummaryHtml()}
          </div>
          <div class="recovery-note">
            Recoverable sessions are only terminals with resumable agent/shell state. Opening the workspace still loads all configured worktrees/terminals.
          </div>
          <div class="recovery-sessions">
            ${sessions.length === 0 ? '<div class="no-recovery">No sessions to recover</div>' :
              sessions.map((s, i) => `
                <div class="recovery-session" data-session-id="${s.sessionId}">
                  <input type="checkbox" class="recovery-checkbox" id="recover-${i}" checked>
                  <label for="recover-${i}" class="recovery-session-info">
                    <div class="recovery-session-id">${s.sessionId}</div>
                    <div class="recovery-session-details">
                      ${s.lastCwd ? `<span class="recovery-session-cwd">📁 ${formatDashboardPathTail(s.lastCwd)}</span>` : ''}
                      ${s.lastAgent ? `<span class="recovery-session-agent">${s.lastAgent}</span>` : ''}
                      ${s.lastConversationId ? `<span>💬 ${s.lastConversationId.slice(0, 8)}...</span>` : ''}
                    </div>
                  </label>
                </div>
              `).join('')}
          </div>
          <div class="recovery-footer">
            <button class="btn-recovery btn-recovery-skip" id="recovery-skip" title="Hide this prompt (does not delete recovery info)">
              Skip (hide)
            </button>
            <div class="recovery-actions">
              <button class="btn-recovery btn-recovery-clear" id="recovery-clear" title="Delete stored recovery info for this workspace (won't kill processes)">
                Clear
              </button>
              <button class="btn-recovery btn-recovery-clear-old" id="recovery-clear-old" title="Delete stored recovery info older than 7 days (won't kill processes)">
                Clear old (7d)
              </button>
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

      const serverUrl = window.location.port === '2080' ? 'http://localhost:3000' :
                        window.location.port === '2081' ? 'http://localhost:4000' :
                        window.location.origin;

      const setButtonsDisabled = (disabled) => {
        modal.querySelectorAll('button').forEach((btn) => { btn.disabled = !!disabled; });
      };

      const clearRecoverySessions = async (sessionIds) => {
        const ids = Array.isArray(sessionIds)
          ? sessionIds.map((s) => String(s || '').trim()).filter(Boolean)
          : [];
        if (!ids.length) return;
        await Promise.all(ids.map(async (id) => {
          try {
            await fetch(`${serverUrl}/api/recovery/${encodeURIComponent(workspaceId)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
          } catch {
            // best-effort
          }
        }));
      };

      const infoEl = modal.querySelector('.recovery-info');
      const sessionsEl = modal.querySelector('.recovery-sessions');

      const renderSessions = () => {
        if (!sessionsEl) return;
        sessionsEl.innerHTML = sessions.length === 0
          ? '<div class="no-recovery">No sessions to recover</div>'
          : sessions.map((s, i) => `
              <div class="recovery-session" data-session-id="${s.sessionId}">
                <input type="checkbox" class="recovery-checkbox" id="recover-${i}" checked>
                <label for="recover-${i}" class="recovery-session-info">
                  <div class="recovery-session-id">${s.sessionId}</div>
                  <div class="recovery-session-details">
                    ${s.lastCwd ? `<span class="recovery-session-cwd">📁 ${formatDashboardPathTail(s.lastCwd)}</span>` : ''}
                    ${s.lastAgent ? `<span class="recovery-session-agent">${s.lastAgent}</span>` : ''}
                    ${s.lastConversationId ? `<span>💬 ${s.lastConversationId.slice(0, 8)}...</span>` : ''}
                  </div>
                </label>
              </div>
            `).join('');

        // Toggle selection on row click
        sessionsEl.querySelectorAll('.recovery-session').forEach(el => {
          el.onclick = (e) => {
            if (e.target.tagName !== 'INPUT') {
              const checkbox = el.querySelector('.recovery-checkbox');
              checkbox.checked = !checkbox.checked;
              el.classList.toggle('selected', checkbox.checked);
            }
          };
        });
      };

      // Event handlers
      modal.querySelector('.close-btn').onclick = () => {
        modal.remove();
        resolve('cancel');
      };

      modal.querySelector('#recovery-skip').onclick = () => {
        if (savedAtRaw) {
          try {
            localStorage.setItem(`orchestrator-recovery-dismissed:${workspaceId}`, savedAtRaw);
          } catch {
            // ignore
          }
        }
        modal.remove();
        resolve({ mode: 'skip', sessions: [] });
      };

      modal.querySelector('#recovery-clear').onclick = async () => {
        setButtonsDisabled(true);
        try {
          await fetch(`${serverUrl}/api/recovery/${encodeURIComponent(workspaceId)}`, { method: 'DELETE' });
        } catch (error) {
          console.error('Failed to clear recovery state:', error);
        } finally {
          modal.remove();
          resolve({ mode: 'skip', sessions: [] });
        }
      };

      modal.querySelector('#recovery-clear-old').onclick = async () => {
        setButtonsDisabled(true);
        try {
          await fetch(`${serverUrl}/api/recovery/${encodeURIComponent(workspaceId)}/prune`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ olderThanDays: 7 })
          });

          const next = await this.checkRecoveryState(workspaceId);
          sessions = next?.sessions || [];
          savedAt = next?.savedAt ? new Date(next.savedAt).toLocaleString() : savedAt;
          savedAtRaw = String(next?.savedAt || savedAtRaw || '').trim();
          configuredTerminalCount = Number(next?.configuredTerminalCount ?? configuredTerminalCount);
          configuredWorktreeCount = Number(next?.configuredWorktreeCount ?? configuredWorktreeCount);

          if (infoEl) {
            infoEl.innerHTML = renderRecoverySummaryHtml();
          }
          renderSessions();
        } catch (error) {
          console.error('Failed to prune recovery state:', error);
        } finally {
          setButtonsDisabled(false);
        }
      };

      modal.querySelector('#recovery-selected').onclick = async () => {
        const selected = [];
        modal.querySelectorAll('.recovery-session').forEach(el => {
          const checkbox = el.querySelector('.recovery-checkbox');
          if (checkbox.checked) {
            selected.push(sessions.find(s => s.sessionId === el.dataset.sessionId));
          }
        });
        setButtonsDisabled(true);
        try {
          await clearRecoverySessions(selected.map((s) => s?.sessionId));
        } finally {
          modal.remove();
          resolve({ mode: 'selected', sessions: selected });
        }
      };

      modal.querySelector('#recovery-all').onclick = async () => {
        setButtonsDisabled(true);
        try {
          await clearRecoverySessions(sessions.map((s) => s?.sessionId));
        } finally {
          modal.remove();
          resolve({ mode: 'all', sessions: sessions });
        }
      };

      renderSessions();
    });
  }
}

// Export for use in main app
window.Dashboard = Dashboard;
