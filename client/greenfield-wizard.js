// Greenfield project creation wizard - Full project flow with GitHub and Claude

class GreenfieldWizard {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.currentStep = 1;
    this.data = {
      name: '',
      description: '',
      category: '',
      detectedCategory: '',
      isPrivate: true,
      worktreeCount: 8,
      spawnClaude: true,
      yolo: true
    };
    this.categories = [];
    // Always use same-origin API requests; the dev server proxies `/api` to the backend.
    this.serverUrl = window.location.origin;
  }

  async show() {
    console.log('Opening greenfield project wizard...');

    // Fetch available categories
    await this.loadCategories();

    // Show wizard modal
    this.renderWizard();
    this.showStep(1);
  }

  async loadCategories() {
    const mapCategory = (category) => ({
      id: String(category?.id || '').trim(),
      path: String(category?.basePathResolved || category?.path || category?.basePath || '').trim(),
      keywords: Array.isArray(category?.keywords) ? category.keywords : []
    });

    try {
      const taxonomy = await this.orchestrator?.ensureProjectTypeTaxonomy?.();
      if (taxonomy && Array.isArray(taxonomy.categories) && taxonomy.categories.length) {
        this.categories = taxonomy.categories.map(mapCategory).filter((item) => item.id);
        console.log('Loaded categories from project-type taxonomy:', this.categories);
        return;
      }

      const response = await fetch(`${this.serverUrl}/api/project-types/categories`);
      if (response.ok) {
        const categories = await response.json();
        this.categories = Array.isArray(categories) ? categories.map(mapCategory).filter((item) => item.id) : [];
        console.log('Loaded categories:', this.categories);
        return;
      }
    } catch (error) {
      console.error('Failed to load categories:', error);
    }

    this.categories = [
      { id: 'website', path: '~/GitHub/websites', keywords: ['website'] },
      { id: 'game', path: '~/GitHub/games', keywords: ['game'] },
      { id: 'tool', path: '~/GitHub/tools', keywords: ['tool'] },
      { id: 'other', path: '~/GitHub/projects', keywords: [] }
    ];
  }

  renderWizard() {
    // Remove existing wizard
    const existing = document.getElementById('greenfield-wizard');
    if (existing) existing.remove();

    // Create wizard modal
    const wizard = document.createElement('div');
    wizard.id = 'greenfield-wizard';
    wizard.className = 'modal greenfield-wizard-modal';
    wizard.innerHTML = `
      <div class="modal-content wizard-content">
        <div class="wizard-header">
          <h2>New Project</h2>
          <button class="close-btn" onclick="this.closest('.modal').remove()">X</button>
        </div>

        <div class="wizard-progress">
          <div class="step-indicator" data-step="1">1. Describe</div>
          <div class="step-indicator" data-step="2">2. Configure</div>
          <div class="step-indicator" data-step="3">3. Create</div>
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
      case 1: body.innerHTML = this.renderDescriptionStep(); break;
      case 2: body.innerHTML = this.renderConfigureStep(); break;
      case 3: body.innerHTML = this.renderReviewStep(); break;
    }

    // Update buttons
    const prevBtn = document.getElementById('gf-wizard-prev');
    const nextBtn = document.getElementById('gf-wizard-next');
    const createBtn = document.getElementById('gf-wizard-create');

    if (prevBtn) prevBtn.style.display = step === 1 ? 'none' : 'block';
    if (nextBtn) nextBtn.style.display = step === 3 ? 'none' : 'block';
    if (createBtn) createBtn.style.display = step === 3 ? 'block' : 'none';
  }

  renderDescriptionStep() {
    return `
      <div class="wizard-step">
        <h3>What do you want to build?</h3>
        <p class="step-description">Describe your project. We'll figure out where to put it.</p>

        <div class="form-group">
          <label for="gf-project-name">Project Name</label>
          <input type="text" id="gf-project-name" value="${this.data.name}"
                 placeholder="my-awesome-project"
                 pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
                 oninput="window.greenfieldWizard.updateData('name', this.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))">
          <p class="field-help">Lowercase letters, numbers, and hyphens only</p>
        </div>

        <div class="form-group">
          <label for="gf-project-description">Project Description</label>
          <textarea id="gf-project-description" rows="4"
                    placeholder="I want to build a website that shows cryptocurrency prices in real-time..."
                    oninput="window.greenfieldWizard.updateDescription(this.value)">${this.data.description}</textarea>
          <p class="field-help">Describe what you want to build. Claude will use this to understand the project.</p>
        </div>

        ${this.data.detectedCategory ? `
        <div class="detected-category">
          <span class="category-label">Detected category:</span>
          <span class="category-value">${this.data.detectedCategory}</span>
          <span class="category-path">${this.getCategoryPath(this.data.detectedCategory)}</span>
        </div>
        ` : ''}
      </div>
    `;
  }

  renderConfigureStep() {
    const categoryOptions = this.categories.map(c => `
      <option value="${c.id}" ${this.data.category === c.id ? 'selected' : ''}>
        ${c.id} (${c.path})
      </option>
    `).join('');

    return `
      <div class="wizard-step">
        <h3>Configure Project</h3>
        <p class="step-description">Fine-tune how your project will be set up.</p>

        <div class="form-group">
          <label for="gf-category">Category</label>
          <select id="gf-category" onchange="window.greenfieldWizard.updateData('category', this.value)">
            ${categoryOptions}
          </select>
          <p class="field-help">Determines the folder location</p>
        </div>

        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="gf-private" ${this.data.isPrivate ? 'checked' : ''}
                   onchange="window.greenfieldWizard.updateData('isPrivate', this.checked)">
            Private Repository
          </label>
          <p class="field-help">Create a private GitHub repository (recommended)</p>
        </div>

        <div class="form-group">
          <label for="gf-worktree-count">Number of Worktrees</label>
          <input type="number" id="gf-worktree-count" value="${this.data.worktreeCount}"
                 min="1" max="8"
                 onchange="window.greenfieldWizard.updateData('worktreeCount', parseInt(this.value))">
          <p class="field-help">work1-work8 for parallel development</p>
        </div>

        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="gf-spawn-claude" ${this.data.spawnClaude ? 'checked' : ''}
                   onchange="window.greenfieldWizard.updateData('spawnClaude', this.checked)">
            Start Claude in work1
          </label>
          <p class="field-help">Automatically spawn Claude Code with your project brief</p>
        </div>

        ${this.data.spawnClaude ? `
        <div class="form-group" style="margin-left: 24px;">
          <label class="checkbox-label">
            <input type="checkbox" id="gf-yolo" ${this.data.yolo ? 'checked' : ''}
                   onchange="window.greenfieldWizard.updateData('yolo', this.checked)">
            Skip Permissions (YOLO mode)
          </label>
          <p class="field-help">Run Claude with --dangerously-skip-permissions</p>
        </div>
        ` : ''}
      </div>
    `;
  }

  renderReviewStep() {
    const categoryPath = this.getCategoryPath(this.data.category);
    const fullPath = `${categoryPath}/${this.data.name}`;

    return `
      <div class="wizard-step">
        <h3>Review & Create</h3>
        <p class="step-description">Review your project settings.</p>

        <div class="review-summary">
          <div class="review-item">
            <strong>Project Name:</strong> ${this.data.name || '(not set)'}
          </div>
          <div class="review-item">
            <strong>Description:</strong>
            <p class="review-description">${this.data.description || '(not set)'}</p>
          </div>
          <div class="review-item">
            <strong>Location:</strong> ${fullPath}
          </div>
          <div class="review-item">
            <strong>GitHub:</strong> ${this.data.isPrivate ? 'Private' : 'Public'} repository
          </div>
          <div class="review-item">
            <strong>Worktrees:</strong> master + work1-work${this.data.worktreeCount}
          </div>
          <div class="review-item">
            <strong>Auto-start Claude:</strong> ${this.data.spawnClaude ? `Yes (${this.data.yolo ? 'YOLO mode' : 'safe mode'})` : 'No'}
          </div>
        </div>

        <div class="creation-flow">
          <h4>What will happen:</h4>
          <ol>
            <li>Create folder: <code>${fullPath}/master</code></li>
            <li>Initialize git repository</li>
            <li>Create GitHub repo (${this.data.isPrivate ? 'private' : 'public'})</li>
            <li>Push initial commit</li>
            <li>Create ${this.data.worktreeCount} worktrees</li>
            <li>Save PROJECT_BRIEF.md with your description</li>
            ${this.data.spawnClaude ? '<li>Start Claude Code in work1 with context</li>' : ''}
          </ol>
        </div>

        ${!this.data.name ? '<p class="error-message">Please enter a project name</p>' : ''}
        ${!this.data.description ? '<p class="error-message">Please enter a project description</p>' : ''}
      </div>
    `;
  }

  getCategoryPath(categoryId) {
    const cat = this.categories.find(c => c.id === categoryId);
    return cat?.path || '~/GitHub/projects';
  }

  async updateDescription(value) {
    this.data.description = value;

    // Detect category from description
    if (value.length > 10) {
      try {
        const response = await fetch(`${this.serverUrl}/api/greenfield/detect-category`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: value })
        });

        if (response.ok) {
          const result = await response.json();
          this.data.detectedCategory = result.category;
          if (!this.data.category) {
            this.data.category = result.category;
          }

          // Update UI
          const detected = document.querySelector('.detected-category');
          if (detected) {
            detected.querySelector('.category-value').textContent = result.category;
            detected.querySelector('.category-path').textContent = result.path;
          } else {
            // Re-render to show detected category
            this.showStep(1);
          }
        }
      } catch (error) {
        console.error('Failed to detect category:', error);
      }
    }
  }

  updateData(key, value) {
    this.data[key] = value;

    // Re-render if on review step
    if (this.currentStep === 3) {
      this.showStep(3);
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

    if (this.currentStep < 3) {
      this.showStep(this.currentStep + 1);
    }
  }

  validateStep() {
    switch (this.currentStep) {
      case 1:
        if (!this.data.name || !this.data.name.match(/^[a-z0-9-]+$/)) {
          alert('Please enter a valid project name (lowercase letters, numbers, hyphens only)');
          return false;
        }
        if (!this.data.description || this.data.description.length < 10) {
          alert('Please enter a project description (at least 10 characters)');
          return false;
        }
        // Set category if not set
        if (!this.data.category) {
          this.data.category = this.data.detectedCategory || 'other';
        }
        return true;
      default:
        return true;
    }
  }

  async createProject() {
    if (!this.data.name || !this.data.description) {
      alert('Please fill in all required fields');
      return;
    }

    const createBtn = document.getElementById('gf-wizard-create');
    if (createBtn) {
      createBtn.disabled = true;
      createBtn.textContent = 'Creating...';
    }

    // Show progress
    this.showProgress();

    try {
      const response = await fetch(`${this.serverUrl}/api/greenfield/create-full`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: this.data.name,
          description: this.data.description,
          category: this.data.category,
          isPrivate: this.data.isPrivate,
          worktreeCount: this.data.worktreeCount,
          spawnClaude: this.data.spawnClaude,
          yolo: this.data.yolo
        })
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
      this.showError(error.message);

      if (createBtn) {
        createBtn.disabled = false;
        createBtn.textContent = 'Create Project';
      }
    }
  }

  showProgress() {
    const body = document.querySelector('#greenfield-wizard .wizard-body');
    body.innerHTML = `
      <div class="wizard-step progress-step">
        <div class="progress-spinner"></div>
        <h3>Creating Project...</h3>
        <div class="progress-steps">
          <div class="progress-item">Creating directory structure...</div>
        </div>
      </div>
    `;
    document.querySelector('#greenfield-wizard .wizard-footer').style.display = 'none';
  }

  showSuccess(result) {
    const body = document.querySelector('#greenfield-wizard .wizard-body');
    body.innerHTML = `
      <div class="wizard-step success-step">
        <div class="success-icon">OK</div>
        <h3>Project Created!</h3>

        <div class="success-details">
          <p><strong>Project:</strong> ${this.data.name}</p>
          <p><strong>Location:</strong> ${result.projectPath}</p>
          ${result.repoUrl ? `<p><strong>GitHub:</strong> <a href="${result.repoUrl}" target="_blank">${result.repoUrl}</a></p>` : ''}
          <p><strong>Worktrees:</strong> ${result.worktrees?.map(w => w.id).join(', ')}</p>
          ${result.claudeSession ? `<p><strong>Claude:</strong> Started in work1</p>` : ''}
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
  }

  showError(message) {
    const body = document.querySelector('#greenfield-wizard .wizard-body');
    body.innerHTML = `
      <div class="wizard-step error-step">
        <div class="error-icon">!</div>
        <h3>Failed to Create Project</h3>
        <p class="error-message">${message}</p>

        <div class="error-actions">
          <button class="btn-secondary" onclick="window.greenfieldWizard.showStep(3)">
            Try Again
          </button>
          <button class="btn-secondary" onclick="document.getElementById('greenfield-wizard').remove()">
            Close
          </button>
        </div>
      </div>
    `;
    document.querySelector('#greenfield-wizard .wizard-footer').style.display = 'flex';
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
