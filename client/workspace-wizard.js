// Workspace creation wizard component

class WorkspaceWizard {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.currentStep = 1;
    this.data = {};
    this.discoveredProjects = [];
  }

  async show() {
    console.log('Opening workspace creation wizard...');

    // Scan for projects first
    await this.scanProjects();

    // Show wizard modal
    this.renderWizard();
    this.showStep(1);
  }

  async scanProjects() {
    try {
      const response = await fetch('/api/workspaces/scan-repos');
      if (response.ok) {
        this.discoveredProjects = await response.json();
        console.log('Discovered projects:', this.discoveredProjects);
      }
    } catch (error) {
      console.error('Failed to scan projects:', error);
      this.discoveredProjects = [];
    }
  }

  renderWizard() {
    // Remove existing wizard
    const existing = document.getElementById('workspace-wizard');
    if (existing) existing.remove();

    // Create wizard modal
    const wizard = document.createElement('div');
    wizard.id = 'workspace-wizard';
    wizard.className = 'modal workspace-wizard';
    wizard.innerHTML = `
      <div class="modal-content wizard-content">
        <div class="wizard-header">
          <h2>Create New Workspace</h2>
          <button class="close-btn" onclick="this.closest('.modal').remove()">✕</button>
        </div>

        <div class="wizard-progress">
          <div class="step-indicator" data-step="1">1. Type</div>
          <div class="step-indicator" data-step="2">2. Repository</div>
          <div class="step-indicator" data-step="3">3. Configuration</div>
          <div class="step-indicator" data-step="4">4. Review</div>
        </div>

        <div class="wizard-body">
          <!-- Step content will be populated here -->
        </div>

        <div class="wizard-footer">
          <button id="wizard-prev" class="btn-secondary" onclick="window.workspaceWizard.prevStep()">Previous</button>
          <button id="wizard-next" class="btn-primary" onclick="window.workspaceWizard.nextStep()">Next</button>
          <button id="wizard-create" class="btn-primary hidden" onclick="window.workspaceWizard.createWorkspace()">Create Workspace</button>
        </div>
      </div>
    `;

    document.body.appendChild(wizard);
    window.workspaceWizard = this;
  }

  showStep(step) {
    this.currentStep = step;

    // Update progress indicators
    document.querySelectorAll('.step-indicator').forEach((el, index) => {
      el.classList.toggle('active', index + 1 === step);
      el.classList.toggle('completed', index + 1 < step);
    });

    // Render step content
    const body = document.querySelector('.wizard-body');
    switch (step) {
      case 1: body.innerHTML = this.renderTypeSelection(); break;
      case 2: body.innerHTML = this.renderRepositorySelection(); break;
      case 3: body.innerHTML = this.renderConfiguration(); break;
      case 4: body.innerHTML = this.renderReview(); break;
    }

    // Update buttons
    document.getElementById('wizard-prev').style.display = step === 1 ? 'none' : 'block';
    document.getElementById('wizard-next').style.display = step === 4 ? 'none' : 'block';
    document.getElementById('wizard-create').style.display = step === 4 ? 'block' : 'none';
  }

  renderTypeSelection() {
    return `
      <div class="wizard-step">
        <h3>What type of project is this?</h3>
        <p>Choose the project type that best matches your workspace.</p>

        <div class="project-types">
          <div class="project-type-card" data-type="hytopia-game">
            <div class="type-icon">🎮</div>
            <div class="type-info">
              <h4>Hytopia Game</h4>
              <p>Full game development environment for Hytopia SDK</p>
            </div>
          </div>

          <div class="project-type-card" data-type="monogame-game">
            <div class="type-icon">🕹️</div>
            <div class="type-info">
              <h4>MonoGame Game</h4>
              <p>C# game development with MonoGame framework</p>
            </div>
          </div>

          <div class="project-type-card" data-type="website">
            <div class="type-icon">🌐</div>
            <div class="type-info">
              <h4>Website/Web App</h4>
              <p>Frontend or fullstack web application</p>
            </div>
          </div>

          <div class="project-type-card" data-type="writing">
            <div class="type-icon">📖</div>
            <div class="type-info">
              <h4>Writing Project</h4>
              <p>Books, articles, documentation</p>
            </div>
          </div>

          <div class="project-type-card" data-type="tool-project">
            <div class="type-icon">🛠️</div>
            <div class="type-info">
              <h4>Tool Project</h4>
              <p>Development tools, scripts, utilities</p>
            </div>
          </div>

          <div class="project-type-card" data-type="custom">
            <div class="type-icon">⚙️</div>
            <div class="type-info">
              <h4>Custom</h4>
              <p>Build from scratch with manual configuration</p>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderRepositorySelection() {
    const discoveredHTML = this.discoveredProjects.length > 0 ? `
      <div class="discovered-projects">
        <h4>Auto-detected Projects:</h4>
        <div class="project-list">
          ${this.discoveredProjects.map(project => `
            <div class="project-item" data-path="${project.path}">
              <div class="project-icon">${this.getProjectIcon(project.type)}</div>
              <div class="project-info">
                <div class="project-name">${project.name}</div>
                <div class="project-path">${project.path}</div>
                <div class="project-type">${project.type}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : '';

    return `
      <div class="wizard-step">
        <h3>Select Repository</h3>
        <p>Choose the repository for this workspace.</p>

        ${discoveredHTML}

        <div class="custom-path">
          <h4>Or enter custom path:</h4>
          <div class="path-input-group">
            <input type="text" id="custom-repo-path" placeholder="/path/to/repository" />
            <button class="btn-secondary" onclick="window.workspaceWizard.browsePath()">Browse...</button>
          </div>
        </div>
      </div>
    `;
  }

  renderConfiguration() {
    const selectedType = this.data.type;
    const typeInfo = this.getTypeInfo(selectedType);

    return `
      <div class="wizard-step">
        <h3>Configure Workspace</h3>
        <p>Set up the workspace configuration.</p>

        <div class="config-section">
          <label>Workspace Name:</label>
          <input type="text" id="workspace-name" placeholder="My Awesome Project" value="${this.data.suggestedName || ''}" />
        </div>

        <div class="config-section">
          <label>Icon:</label>
          <select id="workspace-icon">
            <option value="${typeInfo.icon}">${typeInfo.icon} ${typeInfo.name} (recommended)</option>
            <option value="🚀">🚀 Rocket</option>
            <option value="⭐">⭐ Star</option>
            <option value="🔥">🔥 Fire</option>
            <option value="💎">💎 Diamond</option>
            <option value="🎯">🎯 Target</option>
          </select>
        </div>

        <div class="config-section">
          <label>
            <input type="checkbox" id="enable-worktrees" ${typeInfo.defaultTerminalPairs > 1 ? 'checked' : ''} />
            Enable Git Worktrees
          </label>
          <small>Create multiple working directories for parallel development</small>
        </div>

        <div class="config-section worktree-config">
          <label>Number of terminal pairs:</label>
          <input type="range" id="terminal-pairs" min="1" max="${typeInfo.maxTerminalPairs}" value="${typeInfo.defaultTerminalPairs}" />
          <span id="pairs-value">${typeInfo.defaultTerminalPairs}</span>
        </div>

        <div class="config-section">
          <label>Access Level:</label>
          <select id="access-level">
            <option value="private">🔒 Private (only you)</option>
            <option value="team">👥 Team (shared with Anrokx)</option>
            <option value="public">🌍 Public</option>
          </select>
        </div>
      </div>
    `;
  }

  renderReview() {
    return `
      <div class="wizard-step">
        <h3>Review Workspace</h3>
        <p>Review your workspace configuration before creating.</p>

        <div class="review-section">
          <div class="review-item">
            <strong>Name:</strong> ${this.data.name || 'Unnamed Workspace'}
          </div>
          <div class="review-item">
            <strong>Type:</strong> ${this.getTypeInfo(this.data.type).name}
          </div>
          <div class="review-item">
            <strong>Repository:</strong> ${this.data.repositoryPath || 'Not selected'}
          </div>
          <div class="review-item">
            <strong>Terminal Pairs:</strong> ${this.data.terminalPairs || 1}
          </div>
          <div class="review-item">
            <strong>Worktrees:</strong> ${this.data.enableWorktrees ? 'Enabled' : 'Disabled'}
          </div>
          <div class="review-item">
            <strong>Access:</strong> ${this.data.accessLevel || 'private'}
          </div>
        </div>
      </div>
    `;
  }

  nextStep() {
    if (!this.validateCurrentStep()) return;

    this.collectCurrentStepData();
    if (this.currentStep < 4) {
      this.showStep(this.currentStep + 1);
    }
  }

  prevStep() {
    if (this.currentStep > 1) {
      this.showStep(this.currentStep - 1);
    }
  }

  validateCurrentStep() {
    switch (this.currentStep) {
      case 1:
        const selectedType = document.querySelector('.project-type-card.selected');
        if (!selectedType) {
          alert('Please select a project type');
          return false;
        }
        break;
      case 2:
        const selectedProject = document.querySelector('.project-item.selected');
        const customPath = document.getElementById('custom-repo-path').value;
        if (!selectedProject && !customPath) {
          alert('Please select a repository or enter a custom path');
          return false;
        }
        break;
      case 3:
        const name = document.getElementById('workspace-name').value;
        if (!name.trim()) {
          alert('Please enter a workspace name');
          return false;
        }
        break;
    }
    return true;
  }

  collectCurrentStepData() {
    switch (this.currentStep) {
      case 1:
        const selectedType = document.querySelector('.project-type-card.selected');
        this.data.type = selectedType.dataset.type;
        break;
      case 2:
        const selectedProject = document.querySelector('.project-item.selected');
        if (selectedProject) {
          this.data.repositoryPath = selectedProject.dataset.path;
          this.data.suggestedName = selectedProject.querySelector('.project-name').textContent;
        } else {
          this.data.repositoryPath = document.getElementById('custom-repo-path').value;
        }
        break;
      case 3:
        this.data.name = document.getElementById('workspace-name').value;
        this.data.icon = document.getElementById('workspace-icon').value;
        this.data.enableWorktrees = document.getElementById('enable-worktrees').checked;
        this.data.terminalPairs = parseInt(document.getElementById('terminal-pairs').value);
        this.data.accessLevel = document.getElementById('access-level').value;
        break;
    }
  }

  async createWorkspace() {
    try {
      console.log('Creating workspace with data:', this.data);

      // Generate workspace ID
      const workspaceId = this.data.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');

      // Build workspace config
      const workspaceConfig = {
        id: workspaceId,
        name: this.data.name,
        type: this.data.type,
        icon: this.data.icon,
        description: `${this.getTypeInfo(this.data.type).name} workspace`,
        access: this.data.accessLevel,
        repository: {
          path: this.data.repositoryPath,
          masterBranch: 'main',
          remote: ''
        },
        worktrees: {
          enabled: this.data.enableWorktrees,
          count: this.data.terminalPairs,
          namingPattern: 'work{n}',
          autoCreate: true
        },
        terminals: {
          pairs: this.data.terminalPairs,
          defaultVisible: [1],
          layout: 'dynamic'
        },
        launchSettings: {
          type: this.data.type,
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
          primaryColor: '#007acc',
          icon: this.data.icon
        },
        notifications: {
          enabled: true,
          background: true,
          types: {},
          priority: 'normal'
        }
      };

      // Send to server
      const response = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workspaceConfig)
      });

      if (response.ok) {
        const workspace = await response.json();
        console.log('Workspace created:', workspace);

        // Close wizard
        document.getElementById('workspace-wizard').remove();

        // Switch to new workspace
        this.orchestrator.switchToWorkspace(workspaceId);

        // Show success message
        this.orchestrator.showTemporaryMessage(`Workspace "${this.data.name}" created successfully!`, 'success');
      } else {
        const error = await response.text();
        console.error('Failed to create workspace:', error);
        alert('Failed to create workspace: ' + error);
      }
    } catch (error) {
      console.error('Error creating workspace:', error);
      alert('Error creating workspace: ' + error.message);
    }
  }

  // Event handlers (to be called from HTML)
  selectProjectType(type) {
    // Remove previous selection
    document.querySelectorAll('.project-type-card').forEach(card => {
      card.classList.remove('selected');
    });

    // Add selection to clicked card
    event.target.closest('.project-type-card').classList.add('selected');
  }

  selectProject(path) {
    // Remove previous selection
    document.querySelectorAll('.project-item').forEach(item => {
      item.classList.remove('selected');
    });

    // Add selection to clicked item
    event.target.closest('.project-item').classList.add('selected');

    // Clear custom path
    document.getElementById('custom-repo-path').value = '';
  }

  browsePath() {
    // Simple implementation - just focus the input
    document.getElementById('custom-repo-path').focus();
  }

  // Helper methods
  getTypeInfo(type) {
    const types = {
      'hytopia-game': { name: 'Hytopia Game', icon: '🎮', defaultTerminalPairs: 8, maxTerminalPairs: 16 },
      'monogame-game': { name: 'MonoGame Game', icon: '🕹️', defaultTerminalPairs: 6, maxTerminalPairs: 8 },
      'website': { name: 'Website', icon: '🌐', defaultTerminalPairs: 3, maxTerminalPairs: 6 },
      'writing': { name: 'Writing', icon: '📖', defaultTerminalPairs: 1, maxTerminalPairs: 4 },
      'tool-project': { name: 'Tool Project', icon: '🛠️', defaultTerminalPairs: 2, maxTerminalPairs: 4 },
      'custom': { name: 'Custom', icon: '⚙️', defaultTerminalPairs: 4, maxTerminalPairs: 16 }
    };
    return types[type] || types.custom;
  }

  getProjectIcon(type) {
    return this.getTypeInfo(type).icon;
  }
}

// Event delegation for wizard interactions
document.addEventListener('click', (e) => {
  if (e.target.closest('.project-type-card')) {
    const card = e.target.closest('.project-type-card');
    document.querySelectorAll('.project-type-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
  }

  if (e.target.closest('.project-item')) {
    const item = e.target.closest('.project-item');
    document.querySelectorAll('.project-item').forEach(i => i.classList.remove('selected'));
    item.classList.add('selected');
    document.getElementById('custom-repo-path').value = '';
  }
});

// Range slider updates
document.addEventListener('input', (e) => {
  if (e.target.id === 'terminal-pairs') {
    document.getElementById('pairs-value').textContent = e.target.value;
  }
});

window.WorkspaceWizard = WorkspaceWizard;