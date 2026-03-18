// Greenfield framework modal for adding taxonomy entries

class GreenfieldFrameworkModal {
  constructor(wizard) {
    this.wizard = wizard;
    this.draft = null;
  }

  toKebabCase(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  getDefaultTemplateForCategory(categoryId) {
    const category = this.wizard.getCategoryById(categoryId);
    const preferred = String(category?.defaultTemplateId || '').trim();
    if (preferred && this.wizard.getTemplateById(preferred)) return preferred;
    const candidates = this.wizard.getTemplatesForCategory(categoryId);
    if (candidates.length) return candidates[0].id;
    return this.wizard.templates[0]?.id || '';
  }

  getTemplateLabel(template) {
    const category = template?.categoryId ? this.wizard.getCategoryById(template.categoryId) : null;
    const categoryName = category?.name || template?.categoryId || '';
    return categoryName ? `${template.name || template.id} (${categoryName})` : (template.name || template.id);
  }

  open() {
    if (document.getElementById('greenfield-framework-modal')) return;
    if (!this.wizard.templates.length) {
      alert('No templates available yet. Add a template before creating a new framework.');
      return;
    }

    const defaultCategoryId = this.wizard.data.category || this.wizard.categories[0]?.id || '';
    const defaultTemplateId = this.getDefaultTemplateForCategory(defaultCategoryId);
    this.draft = {
      name: '',
      id: '',
      description: '',
      categoryId: defaultCategoryId,
      defaultTemplateId,
      pathSuffix: '',
      idLocked: false
    };

    const categoryOptions = this.wizard.categories.map((category) => `
      <option value="${category.id}" ${category.id === this.draft.categoryId ? 'selected' : ''}>
        ${category.name || category.id}
      </option>
    `).join('');
    const templateOptions = this.wizard.templates.map((template) => `
      <option value="${template.id}" ${template.id === this.draft.defaultTemplateId ? 'selected' : ''}>
        ${this.getTemplateLabel(template)}
      </option>
    `).join('');

    const modal = document.createElement('div');
    modal.id = 'greenfield-framework-modal';
    modal.className = 'modal greenfield-framework-modal';
    modal.innerHTML = `
      <div class="modal-content framework-modal-content">
        <div class="wizard-header">
          <h2>Add Framework</h2>
          <button class="close-btn" onclick="window.greenfieldWizard.closeFrameworkBuilder()">×</button>
        </div>
        <div class="wizard-body">
          <div class="form-group">
            <label for="gf-framework-name">Framework name</label>
            <input type="text" id="gf-framework-name" value=""
                   placeholder="Unity"
                   oninput="window.greenfieldWizard.updateFrameworkDraft('name', this.value)">
          </div>
          <div class="form-group">
            <label for="gf-framework-id">Framework ID</label>
            <input type="text" id="gf-framework-id" value=""
                   placeholder="unity"
                   oninput="window.greenfieldWizard.updateFrameworkDraft('id', this.value)">
            <p class="field-help">Lowercase kebab-case used in config.</p>
          </div>
          <div class="form-group">
            <label for="gf-framework-category">Category</label>
            <select id="gf-framework-category" onchange="window.greenfieldWizard.updateFrameworkDraft('categoryId', this.value)">
              ${categoryOptions}
            </select>
          </div>
          <div class="form-group">
            <label for="gf-framework-template">Default template</label>
            <select id="gf-framework-template" onchange="window.greenfieldWizard.updateFrameworkDraft('defaultTemplateId', this.value)">
              ${templateOptions}
            </select>
          </div>
          <div class="form-group">
            <label for="gf-framework-path">Default subfolder (optional)</label>
            <input type="text" id="gf-framework-path" value=""
                   placeholder="unity"
                   oninput="window.greenfieldWizard.updateFrameworkDraft('pathSuffix', this.value)">
            <p class="field-help">Suggested folder under the category base path.</p>
          </div>
          <div class="form-group">
            <label for="gf-framework-description">Description (optional)</label>
            <textarea id="gf-framework-description" rows="3"
                      placeholder="Unity game projects"
                      oninput="window.greenfieldWizard.updateFrameworkDraft('description', this.value)"></textarea>
          </div>
          <div class="form-error" id="gf-framework-error" style="display:none;"></div>
        </div>
        <div class="wizard-footer">
          <button class="btn-secondary" type="button" onclick="window.greenfieldWizard.closeFrameworkBuilder()">Cancel</button>
          <button class="btn-primary" type="button" onclick="window.greenfieldWizard.submitFrameworkDraft()">Save framework</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        this.close();
      }
    });
  }

  updateDraft(key, value) {
    if (!this.draft) return;
    if (key === 'name') {
      this.draft.name = value;
      if (!this.draft.idLocked) {
        const nextId = this.toKebabCase(value);
        this.draft.id = nextId;
        const idInput = document.getElementById('gf-framework-id');
        if (idInput) idInput.value = nextId;
      }
      return;
    }
    if (key === 'id') {
      this.draft.idLocked = true;
      const nextId = this.toKebabCase(value);
      this.draft.id = nextId;
      const idInput = document.getElementById('gf-framework-id');
      if (idInput) idInput.value = nextId;
      return;
    }
    if (key === 'categoryId') {
      this.draft.categoryId = String(value || '').trim();
      if (!this.draft.defaultTemplateId) {
        this.draft.defaultTemplateId = this.getDefaultTemplateForCategory(this.draft.categoryId);
        const templateSelect = document.getElementById('gf-framework-template');
        if (templateSelect) templateSelect.value = this.draft.defaultTemplateId;
      }
      return;
    }
    if (key === 'defaultTemplateId') {
      this.draft.defaultTemplateId = String(value || '').trim();
      return;
    }
    if (key === 'pathSuffix') {
      this.draft.pathSuffix = String(value || '').trim();
      return;
    }
    if (key === 'description') {
      this.draft.description = value;
    }
  }

  close() {
    const modal = document.getElementById('greenfield-framework-modal');
    if (modal) {
      modal.remove();
    }
    this.draft = null;
  }

  async submit() {
    if (!this.draft) return;
    const name = String(this.draft.name || '').trim();
    const id = this.toKebabCase(this.draft.id || name);
    const categoryId = String(this.draft.categoryId || '').trim();
    const defaultTemplateId = String(this.draft.defaultTemplateId || '').trim();
    const errorEl = document.getElementById('gf-framework-error');
    const setError = (message) => {
      if (!errorEl) return;
      errorEl.textContent = message;
      errorEl.style.display = message ? 'block' : 'none';
    };

    if (!name) {
      setError('Framework name is required.');
      return;
    }
    if (!id) {
      setError('Framework id is required.');
      return;
    }
    if (!categoryId) {
      setError('Category is required.');
      return;
    }
    if (!defaultTemplateId) {
      setError('Choose a default template.');
      return;
    }

    setError('');
    const payload = {
      id,
      name,
      description: String(this.draft.description || '').trim() || undefined,
      categoryId,
      defaultTemplateId,
      templateIds: [defaultTemplateId],
      pathSuffix: String(this.draft.pathSuffix || '').trim() || undefined
    };

    try {
      const response = await fetch(`${this.wizard.serverUrl}/api/project-types/frameworks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.ok === false) {
        throw new Error(result?.error || `Failed to add framework (${response.status})`);
      }

      if (this.wizard.orchestrator?.ensureProjectTypeTaxonomy) {
        await this.wizard.orchestrator.ensureProjectTypeTaxonomy({ force: true });
      }
      await this.wizard.loadTaxonomy();
      this.wizard.data.category = categoryId;
      this.wizard.data.framework = id;
      this.wizard.data.template = defaultTemplateId;
      this.close();
      this.wizard.showStep(2);
    } catch (error) {
      setError(error.message);
    }
  }
}
