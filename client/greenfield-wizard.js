// Greenfield project creation wizard - Full project flow with GitHub and Claude

class GreenfieldWizard {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.currentStep = 1;
    this.data = {
      name: '',
      description: '',
      category: '',
      framework: '',
      template: '',
      basePathOverride: '',
      subfolderPath: '',
      repo: '',
      githubOrg: '',
      createGithub: true,
      detectedCategory: '',
      isPrivate: true,
      worktreeCount: 8,
      spawnClaude: true,
      yolo: true
    };
    this.categories = [];
    this.frameworks = [];
    this.templates = [];
    this.contextSuggestion = null;
    this.frameworkModal = new GreenfieldFrameworkModal(this);
    // Always use same-origin API requests; the dev server proxies `/api` to the backend.
    this.serverUrl = window.location.origin;
    this._onEscape = null;
  }

  async show() {
    console.log('Opening greenfield project wizard...');

    // Fetch taxonomy and derive defaults before rendering.
    this.contextSuggestion = null;
    await this.loadTaxonomy();
    this.applyContextSuggestion();

    // Show wizard modal
    this.renderWizard();
    this.showStep(1);
  }

  async loadTaxonomy() {
    try {
      const taxonomy = await this.orchestrator?.ensureProjectTypeTaxonomy?.();
      if (taxonomy && Array.isArray(taxonomy.categories) && taxonomy.categories.length && Array.isArray(taxonomy.templates)) {
        this.categories = taxonomy.categories.map((category) => ({
          id: String(category?.id || '').trim(),
          name: String(category?.name || category?.id || '').trim(),
          description: String(category?.description || '').trim(),
          path: String(category?.basePathResolved || category?.path || category?.basePath || '').trim(),
          keywords: Array.isArray(category?.keywords) ? category.keywords : [],
          defaultTemplateId: String(category?.defaultTemplateId || '').trim(),
          frameworkIds: Array.isArray(category?.frameworkIds) ? category.frameworkIds.map((id) => String(id || '').trim()).filter(Boolean) : []
        })).filter((item) => item.id);
        this.frameworks = Array.isArray(taxonomy.frameworks) ? taxonomy.frameworks.map((framework) => ({
          id: String(framework?.id || '').trim(),
          name: String(framework?.name || framework?.id || '').trim(),
          description: String(framework?.description || '').trim(),
          categoryId: String(framework?.categoryId || '').trim(),
          pathSuffix: String(framework?.pathSuffix || '').trim(),
          defaultTemplateId: String(framework?.defaultTemplateId || '').trim(),
          templateIds: Array.isArray(framework?.templateIds) ? framework.templateIds.map((id) => String(id || '').trim()).filter(Boolean) : []
        })).filter((item) => item.id) : [];
        this.templates = taxonomy.templates.map((template) => ({
          id: String(template?.id || '').trim(),
          name: String(template?.name || template?.id || '').trim(),
          description: String(template?.description || '').trim(),
          categoryId: String(template?.categoryId || '').trim(),
          frameworkId: String(template?.frameworkId || '').trim(),
          defaultRepositoryType: String(template?.defaultRepositoryType || '').trim()
        })).filter((item) => item.id);
        console.log('Loaded project taxonomy:', {
          categories: this.categories.length,
          frameworks: this.frameworks.length,
          templates: this.templates.length
        });
        return;
      }

      const response = await fetch(`${this.serverUrl}/api/project-types`);
      if (response.ok) {
        const payload = await response.json();
        this.categories = Array.isArray(payload?.categories) ? payload.categories.map((category) => ({
          id: String(category?.id || '').trim(),
          name: String(category?.name || category?.id || '').trim(),
          description: String(category?.description || '').trim(),
          path: String(category?.basePathResolved || category?.path || category?.basePath || '').trim(),
          keywords: Array.isArray(category?.keywords) ? category.keywords : [],
          defaultTemplateId: String(category?.defaultTemplateId || '').trim(),
          frameworkIds: Array.isArray(category?.frameworkIds) ? category.frameworkIds.map((id) => String(id || '').trim()).filter(Boolean) : []
        })).filter((item) => item.id) : [];
        this.frameworks = Array.isArray(payload?.frameworks) ? payload.frameworks.map((framework) => ({
          id: String(framework?.id || '').trim(),
          name: String(framework?.name || framework?.id || '').trim(),
          description: String(framework?.description || '').trim(),
          categoryId: String(framework?.categoryId || '').trim(),
          pathSuffix: String(framework?.pathSuffix || '').trim(),
          defaultTemplateId: String(framework?.defaultTemplateId || '').trim(),
          templateIds: Array.isArray(framework?.templateIds) ? framework.templateIds.map((id) => String(id || '').trim()).filter(Boolean) : []
        })).filter((item) => item.id) : [];
        this.templates = Array.isArray(payload?.templates) ? payload.templates.map((template) => ({
          id: String(template?.id || '').trim(),
          name: String(template?.name || template?.id || '').trim(),
          description: String(template?.description || '').trim(),
          categoryId: String(template?.categoryId || '').trim(),
          frameworkId: String(template?.frameworkId || '').trim(),
          defaultRepositoryType: String(template?.defaultRepositoryType || '').trim()
        })).filter((item) => item.id) : [];
        return;
      }
    } catch (error) {
      console.error('Failed to load project taxonomy:', error);
    }

    this.categories = [
      { id: 'website', name: 'Website', path: '~/GitHub/websites', keywords: ['website'], defaultTemplateId: 'website-starter', frameworkIds: ['web-generic'] },
      { id: 'game', name: 'Game', path: '~/GitHub/games', keywords: ['game'], defaultTemplateId: 'hytopia-game-starter', frameworkIds: ['hytopia', 'monogame'] },
      { id: 'tool', name: 'Tool', path: '~/GitHub/tools', keywords: ['tool'], defaultTemplateId: 'node-typescript-tool', frameworkIds: ['nodejs'] },
      { id: 'other', name: 'Other', path: '~/GitHub/projects', keywords: [], defaultTemplateId: 'generic-empty', frameworkIds: ['generic'] }
    ];
    this.frameworks = [
      { id: 'web-generic', name: 'Web', categoryId: 'website', defaultTemplateId: 'website-starter', templateIds: ['website-starter'] },
      { id: 'hytopia', name: 'Hytopia', categoryId: 'game', defaultTemplateId: 'hytopia-game-starter', templateIds: ['hytopia-game-starter'] },
      { id: 'monogame', name: 'MonoGame', categoryId: 'game', defaultTemplateId: 'generic-empty', templateIds: ['generic-empty'] },
      { id: 'nodejs', name: 'Node.js', categoryId: 'tool', defaultTemplateId: 'node-typescript-tool', templateIds: ['node-typescript-tool', 'generic-empty'] },
      { id: 'generic', name: 'Generic', categoryId: 'other', defaultTemplateId: 'generic-empty', templateIds: ['generic-empty'] }
    ];
    this.templates = [
      { id: 'website-starter', name: 'Website Starter', description: 'Simple website scaffold', categoryId: 'website', frameworkId: 'web-generic', defaultRepositoryType: 'website' },
      { id: 'hytopia-game-starter', name: 'Hytopia Starter', description: 'Hytopia game scaffold', categoryId: 'game', frameworkId: 'hytopia', defaultRepositoryType: 'hytopia-game' },
      { id: 'node-typescript-tool', name: 'Node TypeScript', description: 'Node.js + TypeScript starter', categoryId: 'tool', frameworkId: 'nodejs', defaultRepositoryType: 'tool-project' },
      { id: 'generic-empty', name: 'Empty Project', description: 'Minimal scaffold', categoryId: 'other', frameworkId: 'generic', defaultRepositoryType: 'generic' }
    ];
  }

  getCategoryById(categoryId) {
    const id = String(categoryId || '').trim();
    return this.categories.find((category) => category.id === id) || null;
  }

  getFrameworkById(frameworkId) {
    const id = String(frameworkId || '').trim();
    return this.frameworks.find((framework) => framework.id === id) || null;
  }

  getTemplateById(templateId) {
    const id = String(templateId || '').trim();
    return this.templates.find((template) => template.id === id) || null;
  }

  getFrameworksForCategory(categoryId) {
    const id = String(categoryId || '').trim();
    if (!id) return [];
    const byCategory = this.frameworks.filter((framework) => framework.categoryId === id);
    if (byCategory.length) return byCategory;
    const category = this.getCategoryById(id);
    if (!category) return [];
    return this.frameworks.filter((framework) => (category.frameworkIds || []).includes(framework.id));
  }

  getTemplatesForFramework(frameworkId) {
    const id = String(frameworkId || '').trim();
    if (!id) return [];
    const framework = this.getFrameworkById(id);
    if (!framework) return [];
    const ids = Array.isArray(framework.templateIds) ? framework.templateIds : [];
    const byFrameworkId = this.templates.filter((template) => template.frameworkId === id);
    if (ids.length) {
      const idSet = new Set(ids);
      const ordered = [];
      for (const templateId of ids) {
        const row = this.getTemplateById(templateId);
        if (row) ordered.push(row);
      }
      for (const row of byFrameworkId) {
        if (!idSet.has(row.id)) ordered.push(row);
      }
      return ordered;
    }
    return byFrameworkId;
  }

  getTemplatesForCategory(categoryId) {
    const id = String(categoryId || '').trim();
    if (!id) return [];
    return this.templates.filter((template) => template.categoryId === id);
  }

  getSelectedCategory() {
    return this.getCategoryById(this.data.category);
  }

  getSelectedFramework() {
    return this.getFrameworkById(this.data.framework);
  }

  getSelectedTemplate() {
    return this.getTemplateById(this.data.template);
  }

  getCurrentRepositoryTypeHint() {
    const sessionId = this.orchestrator?.focusedTerminalInfo?.sessionId || this.orchestrator?.lastInteractedSessionId || '';
    const session = sessionId && this.orchestrator?.sessions?.get ? this.orchestrator.sessions.get(sessionId) : null;
    if (session?.repositoryType) return String(session.repositoryType).trim();

    const workspace = this.orchestrator?.currentWorkspace || null;
    if (!workspace) return '';

    if (workspace.workspaceType === 'mixed-repo') {
      const terminals = Array.isArray(workspace.terminals) ? workspace.terminals : workspace.terminals?.pairs;
      const first = Array.isArray(terminals) && terminals.length ? terminals[0] : null;
      return String(first?.repository?.type || '').trim();
    }

    return String(workspace.type || '').trim();
  }

  applyContextSuggestion() {
    const repoType = this.getCurrentRepositoryTypeHint();
    if (!repoType) return;

    const template = this.templates.find((row) => String(row?.defaultRepositoryType || '').trim().toLowerCase() === repoType.toLowerCase());
    if (!template) return;

    const framework = this.getFrameworkById(template.frameworkId);
    const categoryId = template.categoryId || framework?.categoryId || '';
    if (!categoryId) return;

    this.contextSuggestion = {
      repositoryType: repoType,
      categoryId,
      frameworkId: framework?.id || '',
      templateId: template.id
    };
  }

  acceptContextSuggestion() {
    if (!this.contextSuggestion) return;
    this.data.category = this.contextSuggestion.categoryId || '';
    this.data.framework = this.contextSuggestion.frameworkId || '';
    this.data.template = this.contextSuggestion.templateId || '';
    this.ensureValidSelection();
    this.showStep(this.currentStep);
  }

  acceptDetectedCategory() {
    const detected = String(this.data.detectedCategory || '').trim();
    if (!detected) return;
    this.data.category = detected;
    this.data.framework = '';
    this.data.template = '';
    this.ensureValidSelection();
    this.showStep(this.currentStep);
  }

  ensureValidSelection({ allowTemplateAuto = true } = {}) {
    const category = this.getSelectedCategory();
    if (!category) {
      this.data.framework = '';
      this.data.template = '';
      return;
    }

    const frameworks = this.getFrameworksForCategory(category.id);
    if (!frameworks.length) {
      this.data.framework = '';
      this.data.template = '';
      return;
    }

    const selectedFramework = frameworks.find((framework) => framework.id === this.data.framework);
    if (!selectedFramework) {
      this.data.framework = '';
      this.data.template = '';
      return;
    }

    const templates = this.getTemplatesForFramework(selectedFramework.id);
    if (!templates.length) {
      this.data.template = '';
      return;
    }

    const selectedTemplate = templates.find((template) => template.id === this.data.template);
    if (!selectedTemplate && allowTemplateAuto) {
      const preferredTemplateId = selectedFramework.defaultTemplateId
        || category.defaultTemplateId
        || templates[0].id;
      const preferredTemplate = templates.find((template) => template.id === preferredTemplateId) || templates[0];
      this.data.template = preferredTemplate.id;
    }
  }

  setCategory(categoryId) {
    const next = String(categoryId || '').trim();
    this.data.category = next;
    const frameworks = next ? this.getFrameworksForCategory(next) : [];
    if (!frameworks.find((framework) => framework.id === this.data.framework)) {
      this.data.framework = '';
      this.data.template = '';
    }
    this.ensureValidSelection();
  }

  setFramework(frameworkId) {
    const next = String(frameworkId || '').trim();
    this.data.framework = next;
    this.data.template = '';
    this.ensureValidSelection();
  }

  setTemplate(templateId) {
    const next = String(templateId || '').trim();
    this.data.template = next;
    this.ensureValidSelection({ allowTemplateAuto: false });
  }

  renderWizard() {
    // Remove existing wizard
    const existing = document.getElementById('greenfield-wizard');
    if (existing) this.closeWizard();

    // Create wizard modal
    const wizard = document.createElement('div');
    wizard.id = 'greenfield-wizard';
    wizard.className = 'modal greenfield-wizard-modal';
    wizard.innerHTML = `
      <div class="modal-content wizard-content greenfield-fullscreen-content">
        <div class="wizard-header">
          <h2>New Project</h2>
          <button class="close-btn" onclick="window.greenfieldWizard.closeWizard()">×</button>
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
    wizard.addEventListener('click', (event) => {
      if (event.target === wizard) {
        this.closeWizard();
      }
    });
    this._onEscape = (event) => {
      if (event.key !== 'Escape') return;
      this.closeWizard();
    };
    document.addEventListener('keydown', this._onEscape);
    window.greenfieldWizard = this;
  }

  showStep(step) {
    this.currentStep = step;
    if (step === 2 || step === 3) {
      this.ensureValidSelection({ allowTemplateAuto: true });
    }

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
    const detectedCategory = this.getCategoryById(this.data.detectedCategory);
    const suggestedTemplate = this.getTemplateById(this.contextSuggestion?.templateId || '');
    const suggestedFramework = this.getFrameworkById(this.contextSuggestion?.frameworkId || '');
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

        ${this.contextSuggestion ? `
        <div class="detected-category">
          <span class="category-label">Workspace suggestion:</span>
          <span class="category-value">${suggestedTemplate?.name || this.contextSuggestion.templateId}</span>
          <span class="category-path">based on current repo type ${this.contextSuggestion.repositoryType}</span>
          ${suggestedFramework ? `<span class="category-path">framework: ${suggestedFramework.name}</span>` : ''}
          <button class="btn-small secondary" onclick="window.greenfieldWizard.acceptContextSuggestion()">Use suggestion</button>
        </div>
        ` : ''}

        ${this.data.detectedCategory ? `
        <div class="detected-category">
          <span class="category-label">Detected category:</span>
          <span class="category-value">${detectedCategory?.name || this.data.detectedCategory}</span>
          <span class="category-path">${this.getCategoryPath(this.data.detectedCategory)}</span>
          <button class="btn-small secondary" onclick="window.greenfieldWizard.acceptDetectedCategory()">Use detected category</button>
        </div>
        ` : ''}
      </div>
    `;
  }

  renderConfigureStep() {
    this.ensureValidSelection({ allowTemplateAuto: true });
    const category = this.getSelectedCategory();
    const frameworks = category ? this.getFrameworksForCategory(category.id) : [];
    const templates = this.data.framework ? this.getTemplatesForFramework(this.data.framework) : [];
    const repoPreview = this.getRepositoryTargetPreview();
    const placementRoot = this.getPlacementRootPath();
    const projectPathPreview = this.getProjectRootPath();
    const frameworkSuggestion = this.getFrameworkSubfolderSuggestion();

    const categoryOptions = [
      '<option value="">(choose category)</option>',
      ...this.categories.map((c) => `
        <option value="${c.id}" ${this.data.category === c.id ? 'selected' : ''}>
          ${(c.name || c.id)} (${c.path})
        </option>
      `)
    ].join('');
    const frameworkOptions = [
      '<option value="">(choose framework)</option>',
      ...frameworks.map((framework) => `
        <option value="${framework.id}" ${this.data.framework === framework.id ? 'selected' : ''}>
          ${framework.name || framework.id}
        </option>
      `)
    ].join('');
    const templateOptions = [
      '<option value="">(choose template)</option>',
      ...templates.map((template) => `
        <option value="${template.id}" ${this.data.template === template.id ? 'selected' : ''}>
          ${template.name || template.id}
        </option>
      `)
    ].join('');
    const selectedTemplate = this.getSelectedTemplate();

    return `
      <div class="wizard-step">
        <h3>Configure Project</h3>
        <p class="step-description">Pick category, framework, and template before we scaffold your project.</p>

        <div class="form-group">
          <label for="gf-category">Category</label>
          <select id="gf-category" onchange="window.greenfieldWizard.setCategory(this.value); window.greenfieldWizard.showStep(2);">
            ${categoryOptions}
          </select>
          <p class="field-help">Determines the base folder: ${category?.path || '~/GitHub/projects'}</p>
        </div>

        <div class="form-group">
          <label for="gf-framework">Framework</label>
          <div class="field-row">
            <select id="gf-framework" ${category ? '' : 'disabled'} onchange="window.greenfieldWizard.setFramework(this.value); window.greenfieldWizard.showStep(2);">
              ${frameworkOptions}
            </select>
            <button class="btn-small secondary" type="button" onclick="window.greenfieldWizard.openFrameworkBuilder()">Add framework</button>
          </div>
          <p class="field-help">${this.getSelectedFramework()?.description || 'Framework-specific defaults and template options'}</p>
        </div>

        <div class="form-group">
          <label for="gf-template">Template</label>
          <select id="gf-template" ${this.data.framework ? '' : 'disabled'} onchange="window.greenfieldWizard.setTemplate(this.value); window.greenfieldWizard.showStep(2);">
            ${templateOptions}
          </select>
          <p class="field-help">${selectedTemplate?.description || 'Scaffold starter kit'}</p>
        </div>

        <div class="form-group">
          <label for="gf-base-path">Base folder (optional)</label>
          <input type="text" id="gf-base-path" value="${this.data.basePathOverride || ''}"
                 placeholder="${category?.path || '~/GitHub/projects'}"
                 oninput="window.greenfieldWizard.updateData('basePathOverride', this.value)">
          <p class="field-help">Leave blank to use the category default. Use ~ to reference your home directory.</p>
        </div>

        <div class="form-group">
          <label for="gf-subfolder-path">Subfolder (optional)</label>
          <input type="text" id="gf-subfolder-path" value="${this.data.subfolderPath || ''}"
                 placeholder="e.g., unity or experiments/alpha"
                 oninput="window.greenfieldWizard.updateData('subfolderPath', this.value)">
          <p class="field-help">Adds an extra folder level under the base folder.</p>
          ${frameworkSuggestion && !this.data.subfolderPath ? `
          <div class="field-suggestion">
            Suggested subfolder: <code>${frameworkSuggestion}</code>
            <button class="btn-small secondary" type="button" onclick="window.greenfieldWizard.applyFrameworkSubfolderSuggestion()">Use</button>
          </div>
          ` : ''}
          <p class="field-help">Preview: <code>${projectPathPreview || placementRoot || ''}</code></p>
        </div>

        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="gf-create-github" ${this.data.createGithub ? 'checked' : ''}
                   onchange="window.greenfieldWizard.updateData('createGithub', this.checked)">
            Create GitHub Repository
          </label>
          <p class="field-help">Disable for local-first projects that are not ready for GitHub yet</p>
        </div>

        <div class="form-group">
          <label for="gf-repo-target">Repository Target (optional)</label>
          <input type="text" id="gf-repo-target" value="${this.data.repo || ''}"
                 placeholder="owner/repo, repo-name, or full git URL"
                 oninput="window.greenfieldWizard.updateData('repo', this.value)">
          <p class="field-help">${this.data.createGithub ? 'GitHub slug/URL to create or attach' : 'Optional existing remote URL/slug to attach'}</p>
          ${repoPreview ? `<p class="field-help">Resolved target: <code>${repoPreview}</code></p>` : ''}
        </div>

        ${this.data.createGithub ? `
        <div class="form-group">
          <label for="gf-github-org">GitHub Org/User (optional)</label>
          <input type="text" id="gf-github-org" value="${this.data.githubOrg || ''}"
                 placeholder="web3dev1337"
                 oninput="window.greenfieldWizard.updateData('githubOrg', this.value)">
          <p class="field-help">Used when repository target is just a repo name</p>
        </div>
        ` : ''}

        ${this.data.createGithub ? `
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="gf-private" ${this.data.isPrivate ? 'checked' : ''}
                   onchange="window.greenfieldWizard.updateData('isPrivate', this.checked)">
            Private Repository
          </label>
          <p class="field-help">Create a private GitHub repository (recommended)</p>
        </div>
        ` : ''}

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
    const fullPath = this.getProjectRootPath();
    const selectedCategory = this.getSelectedCategory();
    const selectedFramework = this.getSelectedFramework();
    const selectedTemplate = this.getSelectedTemplate();
    const repoPreview = this.getRepositoryTargetPreview();

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
            <strong>Location:</strong> ${fullPath || '(not set)'}
          </div>
          <div class="review-item">
            <strong>Category:</strong> ${selectedCategory?.name || this.data.category || '(not set)'}
          </div>
          <div class="review-item">
            <strong>Framework:</strong> ${selectedFramework?.name || this.data.framework || '(not set)'}
          </div>
          <div class="review-item">
            <strong>Template:</strong> ${selectedTemplate?.name || this.data.template || '(not set)'}
          </div>
          <div class="review-item">
            <strong>GitHub:</strong> ${this.data.createGithub ? `${this.data.isPrivate ? 'Private' : 'Public'} repository` : 'Skip GitHub creation'}
          </div>
          ${repoPreview ? `
          <div class="review-item">
            <strong>Repository Target:</strong> ${repoPreview}
          </div>
          ` : ''}
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
            <li>Create folder: <code>${this.joinPathSegments(fullPath, 'master')}</code></li>
            <li>Initialize git repository</li>
            ${this.data.createGithub
              ? `<li>Create GitHub repo (${this.data.isPrivate ? 'private' : 'public'})${repoPreview ? ` as <code>${repoPreview}</code>` : ''}</li>`
              : '<li>Skip GitHub repo creation (local-only for now)</li>'}
            ${this.data.createGithub || repoPreview ? '<li>Push initial commit</li>' : ''}
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
    const cat = this.getCategoryById(categoryId);
    return cat?.path || '~/GitHub/projects';
  }

  getFrameworkSubfolderSuggestion() {
    const framework = this.getSelectedFramework();
    return String(framework?.pathSuffix || '').trim();
  }

  applyFrameworkSubfolderSuggestion() {
    const suggestion = this.getFrameworkSubfolderSuggestion();
    if (!suggestion) return;
    this.data.subfolderPath = suggestion;
    this.showStep(this.currentStep);
  }

  getPlacementBasePath() {
    const override = String(this.data.basePathOverride || '').trim();
    if (override) return override;
    return this.getCategoryPath(this.data.category);
  }

  getPlacementSubfolder() {
    const raw = String(this.data.subfolderPath || '').trim();
    if (!raw) return '';
    return raw.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  }

  joinPathSegments(base, segment) {
    const root = String(base || '').trim();
    const suffix = String(segment || '').trim();
    if (!root) return suffix;
    if (!suffix) return root;
    const sep = root.includes('\\') || /^[A-Za-z]:/.test(root) ? '\\' : '/';
    const cleanRoot = root.replace(/[\\/]+$/g, '');
    const cleanSuffix = suffix.replace(/^[\\/]+/g, '');
    return `${cleanRoot}${sep}${cleanSuffix}`;
  }

  getPlacementRootPath() {
    const basePath = this.getPlacementBasePath();
    const subfolder = this.getPlacementSubfolder();
    return this.joinPathSegments(basePath, subfolder);
  }

  getProjectRootPath() {
    const basePath = this.getPlacementRootPath();
    const name = String(this.data.name || '').trim();
    if (!name) return basePath;
    return this.joinPathSegments(basePath, name);
  }

  validatePlacement() {
    const basePath = String(this.data.basePathOverride || '').trim();
    if (basePath && /(^|[\\/])\\.\\.([\\/]|$)/.test(basePath)) {
      alert('Base folder cannot include ".." segments');
      return false;
    }
    const subfolder = String(this.data.subfolderPath || '').trim();
    if (subfolder) {
      if (/^[\\/]/.test(subfolder) || /^[A-Za-z]:/.test(subfolder)) {
        alert('Subfolder should be relative (no leading / or drive letters)');
        return false;
      }
      if (/(^|[\\/])\\.\\.([\\/]|$)/.test(subfolder)) {
        alert('Subfolder cannot include ".." segments');
        return false;
      }
    }
    return true;
  }

  getRepositoryTargetPreview() {
    const repo = String(this.data.repo || '').trim();
    const githubOrg = String(this.data.githubOrg || '').trim().replace(/^@+/, '').replace(/\/+$/, '');
    const fallback = String(this.data.name || '').trim();
    const candidate = repo || (this.data.createGithub ? fallback : '');
    if (!candidate) return '';

    if (/^(https?:\/\/|git@)/i.test(candidate)) {
      return candidate;
    }

    if (candidate.includes('/')) {
      return candidate;
    }

    return githubOrg ? `${githubOrg}/${candidate}` : candidate;
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

          if (this.currentStep === 1) {
            this.showStep(1);
          }
        }
      } catch (error) {
        console.error('Failed to detect category:', error);
      }
    }
  }

  updateData(key, value) {
    if (key === 'repo') {
      this.data.repo = String(value || '').trim();
    } else if (key === 'githubOrg') {
      this.data.githubOrg = String(value || '')
        .trim()
        .replace(/^@+/, '')
        .replace(/^https?:\/\/github\.com\//i, '')
        .replace(/\/+$/, '');
    } else if (key === 'basePathOverride') {
      this.data.basePathOverride = String(value || '').trim();
    } else if (key === 'subfolderPath') {
      this.data.subfolderPath = String(value || '').replace(/\\/g, '/');
    } else {
      this.data[key] = value;
    }
    if (key === 'worktreeCount') {
      const n = Number(value);
      this.data.worktreeCount = Number.isFinite(n) ? Math.min(8, Math.max(1, Math.round(n))) : 1;
    }

    // Re-render active step for dynamic controls and summaries.
    if (this.currentStep === 2 || this.currentStep === 3) {
      this.showStep(this.currentStep);
    }
  }

  openFrameworkBuilder() {
    this.frameworkModal?.open();
  }

  updateFrameworkDraft(key, value) {
    this.frameworkModal?.updateDraft(key, value);
  }

  closeFrameworkBuilder() {
    this.frameworkModal?.close();
  }

  submitFrameworkDraft() {
    this.frameworkModal?.submit();
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
        return true;
      case 2:
        this.ensureValidSelection({ allowTemplateAuto: true });
        if (!this.data.category) {
          alert('Please select a category');
          return false;
        }
        if (!this.data.framework) {
          alert('Please select a framework');
          return false;
        }
        if (!this.data.template) {
          alert('Please select a template');
          return false;
        }
        if (!this.validatePlacement()) {
          return false;
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
      const repoInput = String(this.data.repo || '').trim();
      const repoTarget = repoInput || (this.data.createGithub ? this.data.name : '');
      const githubOrg = String(this.data.githubOrg || '').trim();
      const basePathOverride = String(this.data.basePathOverride || '').trim();
      const subfolder = this.getPlacementSubfolder();
      const basePath = (basePathOverride || subfolder) ? this.getPlacementRootPath() : '';
      const payload = {
        name: this.data.name,
        description: this.data.description,
        category: this.data.category,
        framework: this.data.framework,
        template: this.data.template,
        basePath: basePath || undefined,
        repo: repoTarget || undefined,
        githubOrg: githubOrg || undefined,
        private: this.data.isPrivate,
        createGithub: this.data.createGithub,
        allowGitHubFailure: true,
        push: true,
        initGit: true,
        worktreeCount: this.data.worktreeCount,
        spawnClaude: this.data.spawnClaude,
        yolo: this.data.yolo
      };

      const normalizedResult = this.orchestrator?.createProjectWorkspace
        ? await this.orchestrator.createProjectWorkspace(payload)
        : await this.createProjectWorkspaceFallback(payload);

      console.log('Project created:', normalizedResult);

      // Show success message
      this.showSuccess(normalizedResult);

    } catch (error) {
      console.error('Failed to create project:', error);
      this.showError(error.message);

      if (createBtn) {
        createBtn.disabled = false;
        createBtn.textContent = 'Create Project';
      }
    }
  }

  async createProjectWorkspaceFallback(payload) {
    const response = await fetch(`${this.serverUrl}/api/projects/create-workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.ok === false) {
      throw new Error(String(result?.error || `Failed to create project (${response.status})`));
    }

    const normalized = {
      ...(result?.project || result || {}),
      workspace: result?.workspace || null
    };
    if (!normalized.repoUrl && normalized.remoteUrl) {
      normalized.repoUrl = normalized.remoteUrl;
    }
    return normalized;
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
          <p><strong>Framework:</strong> ${this.getSelectedFramework()?.name || this.data.framework || '—'}</p>
          <p><strong>Template:</strong> ${this.getSelectedTemplate()?.name || this.data.template || '—'}</p>
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
          <button class="btn-secondary" onclick="window.greenfieldWizard.closeWizard()">
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
          <button class="btn-secondary" onclick="window.greenfieldWizard.closeWizard()">
            Close
          </button>
        </div>
      </div>
    `;
    document.querySelector('#greenfield-wizard .wizard-footer').style.display = 'flex';
  }

  closeWizard() {
    const wizard = document.getElementById('greenfield-wizard');
    if (wizard) wizard.remove();
    if (this._onEscape) {
      document.removeEventListener('keydown', this._onEscape);
      this._onEscape = null;
    }
  }

  async openWorkspace(workspaceId) {
    this.closeWizard();

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
