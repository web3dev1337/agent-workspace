// Greenfield project creation wizard

class GreenfieldWizard {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.currentStep = 1;
    this.data = {
      name: '',
      template: 'empty',
      path: '~/GitHub',
      initGit: true,
      worktreeCount: 1,
      createWorkspace: true
    };
    this.templates = [];
    this.serverUrl = window.location.port === '2080' ? 'http://localhost:3000' : window.location.origin;
  }

  async show() {
    console.log('Opening greenfield project wizard...');

    // Fetch available templates
    await this.loadTemplates();

    // Show wizard modal
    this.renderWizard();
    this.showStep(1);
  }

  async loadTemplates() {
    try {
      const response = await fetch(`${this.serverUrl}/api/greenfield/templates`);
      if (response.ok) {
        this.templates = await response.json();
        console.log('Loaded templates:', this.templates);
      }
    } catch (error) {
      console.error('Failed to load templates:', error);
      this.templates = [
        { id: 'empty', name: 'Empty Project', description: 'Blank project', defaultPath: '~/GitHub' }
      ];
    }
  }

  renderWizard() {
    // Remove existing wizard
    const existing = document.getElementById('greenfield-wizard');
    if (existing) existing.remove();

    // Create wizard modal
    const wizard = document.createElement('div');
    wizard.id = 'greenfield-wizard';
    wizard.className = 'modal greenfield-wizard';
    wizard.innerHTML = `
      <div class="modal-content wizard-content">
        <div class="wizard-header">
          <h2>Create New Project</h2>
          <button class="close-btn" onclick="this.closest('.modal').remove()">X</button>
        </div>

        <div class="wizard-progress">
          <div class="step-indicator" data-step="1">1. Project Info</div>
          <div class="step-indicator" data-step="2">2. Template</div>
          <div class="step-indicator" data-step="3">3. Options</div>
          <div class="step-indicator" data-step="4">4. Review</div>
        </div>

        <div class="wizard-body">
          <!-- Step content will be populated here -->
        </div>

        <div class="wizard-footer">
          <button id="gf-wizard-prev" class="btn-secondary" onclick="window.greenfieldWizard.prevStep()">Previous</button>
          <button id="gf-wizard-next" class="btn-primary" onclick="window.greenfieldWizard.nextStep()">Next</button>
          <button id="gf-wizard-create" class="btn-primary" onclick="window.greenfieldWizard.createProject()" style="display: none;">Create Project</button>
        </div>
      </div>
    `;

    document.body.appendChild(wizard);
    window.greenfieldWizard = this;
  }

  showStep(step) {
    this.currentStep = step;

    // Update progress indicators
    document.querySelectorAll('#greenfield-wizard .step-indicator').forEach((el, index) => {
      el.classList.toggle('active', index + 1 === step);
      el.classList.toggle('completed', index + 1 < step);
    });

    // Render step content
    const body = document.querySelector('#greenfield-wizard .wizard-body');
    switch (step) {
      case 1: body.innerHTML = this.renderProjectInfo(); break;
      case 2: body.innerHTML = this.renderTemplateSelection(); break;
      case 3: body.innerHTML = this.renderOptions(); break;
      case 4: body.innerHTML = this.renderReview(); break;
    }

    // Update buttons
    const prevBtn = document.getElementById('gf-wizard-prev');
    const nextBtn = document.getElementById('gf-wizard-next');
    const createBtn = document.getElementById('gf-wizard-create');

    if (prevBtn) prevBtn.style.display = step === 1 ? 'none' : 'block';
    if (nextBtn) nextBtn.style.display = step === 4 ? 'none' : 'block';
    if (createBtn) createBtn.style.display = step === 4 ? 'block' : 'none';
  }

  renderProjectInfo() {
    return `
      <div class="wizard-step">
        <h3>Project Information</h3>
        <p class="step-description">Enter basic information about your new project.</p>

        <div class="form-group">
          <label for="gf-project-name">Project Name</label>
          <input type="text" id="gf-project-name" value="${this.data.name}"
                 placeholder="my-awesome-project"
                 pattern="[a-zA-Z0-9_-]+"
                 oninput="window.greenfieldWizard.updateData('name', this.value)">
          <p class="field-help">Use only letters, numbers, underscores, and hyphens</p>
        </div>

        <div class="form-group">
          <label for="gf-project-path">Parent Directory</label>
          <input type="text" id="gf-project-path" value="${this.data.path}"
                 placeholder="~/GitHub"
                 oninput="window.greenfieldWizard.updateData('path', this.value)">
          <p class="field-help">The project will be created in: ${this.data.path}/${this.data.name || 'project-name'}</p>
        </div>
      </div>
    `;
  }

  renderTemplateSelection() {
    const templateCards = this.templates.map(t => `
      <div class="template-card ${this.data.template === t.id ? 'selected' : ''}"
           onclick="window.greenfieldWizard.selectTemplate('${t.id}')">
        <div class="template-icon">${this.getTemplateIcon(t.id)}</div>
        <div class="template-info">
          <h4>${t.name}</h4>
          <p>${t.description}</p>
        </div>
      </div>
    `).join('');

    return `
      <div class="wizard-step">
        <h3>Choose a Template</h3>
        <p class="step-description">Select a starting point for your project.</p>

        <div class="template-grid">
          ${templateCards}
        </div>
      </div>
    `;
  }

  renderOptions() {
    return `
      <div class="wizard-step">
        <h3>Project Options</h3>
        <p class="step-description">Configure how your project should be set up.</p>

        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="gf-init-git" ${this.data.initGit ? 'checked' : ''}
                   onchange="window.greenfieldWizard.updateData('initGit', this.checked)">
            Initialize Git Repository
          </label>
          <p class="field-help">Create a git repository with an initial commit</p>
        </div>

        <div class="form-group" ${!this.data.initGit ? 'style="opacity: 0.5; pointer-events: none;"' : ''}>
          <label for="gf-worktree-count">Number of Worktrees</label>
          <input type="number" id="gf-worktree-count" value="${this.data.worktreeCount}"
                 min="0" max="8"
                 onchange="window.greenfieldWizard.updateData('worktreeCount', parseInt(this.value))">
          <p class="field-help">Create work1, work2, etc. for parallel development (0 for no worktrees)</p>
        </div>

        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="gf-create-workspace" ${this.data.createWorkspace ? 'checked' : ''}
                   onchange="window.greenfieldWizard.updateData('createWorkspace', this.checked)">
            Create Workspace Configuration
          </label>
          <p class="field-help">Add this project to the orchestrator's workspace list</p>
        </div>
      </div>
    `;
  }

  renderReview() {
    const template = this.templates.find(t => t.id === this.data.template);
    const projectPath = `${this.data.path}/${this.data.name}`;

    return `
      <div class="wizard-step">
        <h3>Review & Create</h3>
        <p class="step-description">Review your project settings before creating.</p>

        <div class="review-summary">
          <div class="review-item">
            <strong>Project Name:</strong> ${this.data.name || '(not set)'}
          </div>
          <div class="review-item">
            <strong>Template:</strong> ${template?.name || this.data.template}
          </div>
          <div class="review-item">
            <strong>Location:</strong> ${projectPath}
          </div>
          <div class="review-item">
            <strong>Git Repository:</strong> ${this.data.initGit ? 'Yes' : 'No'}
          </div>
          ${this.data.initGit && this.data.worktreeCount > 0 ? `
          <div class="review-item">
            <strong>Worktrees:</strong> master + work1${this.data.worktreeCount > 1 ? ` to work${this.data.worktreeCount}` : ''}
          </div>
          ` : ''}
          <div class="review-item">
            <strong>Create Workspace:</strong> ${this.data.createWorkspace ? 'Yes' : 'No'}
          </div>
        </div>

        ${!this.data.name ? '<p class="error-message">Please enter a project name</p>' : ''}
      </div>
    `;
  }

  getTemplateIcon(templateId) {
    const icons = {
      'hytopia-game': 'G',
      'node-typescript': 'TS',
      'empty': 'E'
    };
    return icons[templateId] || 'P';
  }

  selectTemplate(templateId) {
    this.data.template = templateId;

    // Update default path based on template
    const template = this.templates.find(t => t.id === templateId);
    if (template?.defaultPath) {
      this.data.path = template.defaultPath;
    }

    this.showStep(this.currentStep); // Re-render
  }

  updateData(key, value) {
    this.data[key] = value;

    // Re-render if on review step
    if (this.currentStep === 4) {
      this.showStep(4);
    }
  }

  prevStep() {
    if (this.currentStep > 1) {
      this.showStep(this.currentStep - 1);
    }
  }

  nextStep() {
    // Validate current step
    if (!this.validateStep()) {
      return;
    }

    if (this.currentStep < 4) {
      this.showStep(this.currentStep + 1);
    }
  }

  validateStep() {
    switch (this.currentStep) {
      case 1:
        if (!this.data.name || !this.data.name.match(/^[a-zA-Z0-9_-]+$/)) {
          alert('Please enter a valid project name (letters, numbers, underscores, hyphens only)');
          return false;
        }
        if (!this.data.path) {
          alert('Please enter a parent directory path');
          return false;
        }
        return true;
      default:
        return true;
    }
  }

  async createProject() {
    if (!this.data.name) {
      alert('Please enter a project name');
      return;
    }

    const createBtn = document.getElementById('gf-wizard-create');
    if (createBtn) {
      createBtn.disabled = true;
      createBtn.textContent = 'Creating...';
    }

    try {
      const response = await fetch(`${this.serverUrl}/api/greenfield/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.data)
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create project');
      }

      console.log('Project created:', result);

      // Show success message
      this.showSuccess(result);

    } catch (error) {
      console.error('Failed to create project:', error);
      alert(`Failed to create project: ${error.message}`);

      if (createBtn) {
        createBtn.disabled = false;
        createBtn.textContent = 'Create Project';
      }
    }
  }

  showSuccess(result) {
    const body = document.querySelector('#greenfield-wizard .wizard-body');
    body.innerHTML = `
      <div class="wizard-step success-step">
        <div class="success-icon">OK</div>
        <h3>Project Created Successfully!</h3>

        <div class="success-details">
          <p><strong>Project:</strong> ${this.data.name}</p>
          <p><strong>Location:</strong> ${result.projectPath}</p>
          ${result.worktrees.length > 0 ? `
          <p><strong>Worktrees:</strong></p>
          <ul>
            ${result.worktrees.map(w => `<li>${w.id}: ${w.path}</li>`).join('')}
          </ul>
          ` : ''}
          ${result.workspace ? `<p><strong>Workspace:</strong> ${result.workspace.name} (created)</p>` : ''}
        </div>

        <div class="success-actions">
          ${result.workspace ? `
          <button class="btn-primary" onclick="window.greenfieldWizard.openWorkspace('${result.workspace.id}')">
            Open Workspace
          </button>
          ` : ''}
          <button class="btn-secondary" onclick="document.getElementById('greenfield-wizard').remove()">
            Close
          </button>
        </div>
      </div>
    `;

    // Hide footer buttons
    document.querySelector('#greenfield-wizard .wizard-footer').style.display = 'none';
  }

  async openWorkspace(workspaceId) {
    document.getElementById('greenfield-wizard').remove();

    // Switch to the new workspace
    if (this.orchestrator && this.orchestrator.socket) {
      this.orchestrator.socket.emit('switch-workspace', { workspaceId });
    }
  }
}

// Export for use
if (typeof window !== 'undefined') {
  window.GreenfieldWizard = GreenfieldWizard;
}
