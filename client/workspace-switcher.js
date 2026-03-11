// Workspace switcher dropdown component

// Keep this feature disabled until we re-introduce it intentionally.
const WORKSPACE_SWITCHER_ENABLED = false;

class WorkspaceSwitcher {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.isOpen = false;
  }

  render() {
    if (!WORKSPACE_SWITCHER_ENABLED) {
      const existing = document.getElementById('workspace-switcher');
      if (existing) {
        existing.remove();
      }
      return;
    }

    // Add workspace switcher to header
    const header = document.querySelector('header .header-content');
    if (!header) {
      console.warn('Header not found, cannot render workspace switcher');
      return;
    }

    // Remove existing switcher if present
    const existing = document.getElementById('workspace-switcher');
    if (existing) {
      existing.remove();
    }

    // Create switcher element
    const switcher = document.createElement('div');
    switcher.id = 'workspace-switcher';
    switcher.className = 'workspace-switcher';
    switcher.innerHTML = this.generateSwitcherHTML();

    // Insert after the title
    const title = header.querySelector('h1');
    if (title) {
      title.insertAdjacentElement('afterend', switcher);
    } else {
      header.appendChild(switcher);
    }

    this.setupEventListeners();
  }

  generateSwitcherHTML() {
    const current = this.orchestrator.currentWorkspace;
    const available = this.orchestrator.availableWorkspaces;

    if (!current || !available) {
      return `
        <div class="workspace-switcher-loading">
          <span>Loading workspaces...</span>
        </div>
      `;
    }

    return `
      <div class="workspace-dropdown">
        <button id="workspace-dropdown-btn" class="workspace-dropdown-btn">
          <span class="current-workspace-icon">${current.icon}</span>
          <span class="current-workspace-name">${current.name}</span>
          <span class="dropdown-arrow">▼</span>
        </button>

        <div class="workspace-dropdown-menu hidden" id="workspace-dropdown-menu">
          <div class="workspace-dropdown-header">
            <span>Switch Workspace</span>
          </div>

          <div class="workspace-dropdown-items">
            <button class="workspace-option dashboard-option" data-action="dashboard">
              <span class="workspace-option-icon">🏠</span>
              <span class="workspace-option-info">
                <span class="workspace-option-name">Agent Workspace</span>
                <span class="workspace-option-type">All workspaces</span>
              </span>
            </button>

            <div class="workspace-dropdown-divider"></div>

            ${available.map(workspace => this.generateWorkspaceOption(workspace)).join('')}
          </div>
        </div>
      </div>
    `;
  }

  generateWorkspaceOption(workspace) {
    const isCurrent = workspace.id === this.orchestrator.currentWorkspace?.id;
    const activityCount = this.getActivityCount(workspace.id);

    return `
      <button class="workspace-option ${isCurrent ? 'current' : ''}" data-workspace-id="${workspace.id}">
        <span class="workspace-option-icon">${workspace.icon}</span>
        <span class="workspace-option-info">
          <span class="workspace-option-name">${workspace.name}</span>
          <span class="workspace-option-type">${this.getWorkspaceTypeLabel(workspace.type)} • ${activityCount}</span>
        </span>
        ${isCurrent ? '<span class="current-indicator">✓</span>' : ''}
      </button>
    `;
  }

  setupEventListeners() {
    const dropdownBtn = document.getElementById('workspace-dropdown-btn');
    const dropdownMenu = document.getElementById('workspace-dropdown-menu');

    if (!dropdownBtn || !dropdownMenu) return;

    // Toggle dropdown
    dropdownBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleDropdown();
    });

    // Workspace selection
    dropdownMenu.addEventListener('click', (e) => {
      const option = e.target.closest('.workspace-option');
      if (!option) return;

      e.preventDefault();
      e.stopPropagation();

      if (option.dataset.action === 'dashboard') {
        this.orchestrator.showDashboard();
      } else if (option.dataset.workspaceId) {
        this.switchWorkspace(option.dataset.workspaceId);
      }

      this.closeDropdown();
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#workspace-switcher')) {
        this.closeDropdown();
      }
    });

    // ESC key to close dropdown
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeDropdown();
      }
    });
  }

  toggleDropdown() {
    if (this.isOpen) {
      this.closeDropdown();
    } else {
      this.openDropdown();
    }
  }

  openDropdown() {
    const menu = document.getElementById('workspace-dropdown-menu');
    const btn = document.getElementById('workspace-dropdown-btn');

    if (menu && btn) {
      menu.classList.remove('hidden');
      btn.classList.add('open');
      this.isOpen = true;

      // Refresh workspace list from disk when dropdown opens
      this.refreshWorkspaces();
    }
  }

  refreshWorkspaces() {
    // Request fresh workspace list from server (reloads from disk)
    this.orchestrator.socket.emit('list-workspaces', { refresh: true });

    // Update dropdown when response arrives
    this.orchestrator.socket.once('workspaces-list', (workspaces) => {
      console.log('Workspace switcher: refreshed workspaces', workspaces.length);
      this.orchestrator.availableWorkspaces = workspaces;
      // Re-render dropdown items if still open
      if (this.isOpen) {
        const itemsContainer = document.querySelector('.workspace-dropdown-items');
        if (itemsContainer) {
          // Regenerate items (keep dashboard option)
          const dashboardOption = `
            <button class="workspace-option dashboard-option" data-action="dashboard">
              <span class="workspace-option-icon">🏠</span>
              <span class="workspace-option-info">
                <span class="workspace-option-name">Agent Workspace</span>
                <span class="workspace-option-type">All workspaces</span>
              </span>
            </button>
            <div class="workspace-dropdown-divider"></div>
          `;
          itemsContainer.innerHTML = dashboardOption + workspaces.map(ws => this.generateWorkspaceOption(ws)).join('');
        }
      }
    });
  }

  closeDropdown() {
    const menu = document.getElementById('workspace-dropdown-menu');
    const btn = document.getElementById('workspace-dropdown-btn');

    if (menu && btn) {
      menu.classList.add('hidden');
      btn.classList.remove('open');
      this.isOpen = false;
    }
  }

  async switchWorkspace(workspaceId) {
    if (workspaceId === this.orchestrator.currentWorkspace?.id) {
      console.log('Already in workspace:', workspaceId);
      return;
    }

    console.log('Switching to workspace:', workspaceId);

    // Show loading state
    const btn = document.getElementById('workspace-dropdown-btn');
    if (btn) {
      btn.classList.add('loading');
      btn.querySelector('.current-workspace-name').textContent = 'Switching...';
    }

    // Emit switch request
    this.orchestrator.socket.emit('switch-workspace', { workspaceId });

    // Wait for workspace-changed event (handled in app.js)
    this.orchestrator.socket.once('workspace-changed', () => {
      // Update switcher display
      this.updateCurrentWorkspace();

      // Remove loading state
      if (btn) {
        btn.classList.remove('loading');
      }
    });
  }

  updateCurrentWorkspace() {
    const current = this.orchestrator.currentWorkspace;
    if (!current) return;

    const iconEl = document.querySelector('.current-workspace-icon');
    const nameEl = document.querySelector('.current-workspace-name');

    if (iconEl) iconEl.textContent = current.icon;
    if (nameEl) nameEl.textContent = current.name;

    // Re-render dropdown to update current selection
    this.render();
  }

  // Helper methods
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
}

// Make available globally
window.WorkspaceSwitcher = WorkspaceSwitcher;
