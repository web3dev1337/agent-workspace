class ProjectsBoardUI {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.modalId = 'projects-board-modal';
    this.visible = false;
    this.columns = [
      { id: 'backlog', label: 'Backlog' },
      { id: 'active', label: 'Active' },
      { id: 'next', label: 'Ship Next' },
      { id: 'done', label: 'Done' },
      { id: 'archived', label: 'Archived' }
    ];
    this.board = { projectToColumn: {} };
    this.storePath = '';
    this.projects = [];
    this.filter = '';
    this.dragProjectKey = null;
    this._escHandler = null;
  }

  async show() {
    if (!document.getElementById(this.modalId)) {
      this.createModal();
    }
    const modal = document.getElementById(this.modalId);
    if (!modal) return;
    modal.classList.remove('hidden');
    this.visible = true;
    await this.refresh({ force: false });

    if (!this._escHandler) {
      this._escHandler = (e) => {
        if (e.key === 'Escape') this.hide();
      };
      document.addEventListener('keydown', this._escHandler);
    }
  }

  hide() {
    const modal = document.getElementById(this.modalId);
    if (modal) modal.classList.add('hidden');
    this.visible = false;
    this.dragProjectKey = null;

    if (this._escHandler) {
      document.removeEventListener('keydown', this._escHandler);
      this._escHandler = null;
    }
  }

  createModal() {
    const modal = document.createElement('div');
    modal.id = this.modalId;
    modal.className = 'modal hidden projects-board-modal';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3>Projects Board</h3>
          <button type="button" class="close-btn" id="projects-board-close" aria-label="Close">✕</button>
        </div>
        <div class="projects-board-toolbar">
          <input id="projects-board-filter" class="search-input" type="search" placeholder="Filter projects…" autocomplete="off" />
          <button type="button" class="button-secondary" id="projects-board-refresh" title="Refresh repos + board">↻ Refresh</button>
        </div>
        <div class="projects-board-meta" id="projects-board-meta"></div>
        <div class="projects-board-columns" id="projects-board-columns"></div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#projects-board-close')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.hide();
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.hide();
    });

    modal.querySelector('#projects-board-refresh')?.addEventListener('click', async (e) => {
      e.preventDefault();
      await this.refresh({ force: true });
    });

    const filterEl = modal.querySelector('#projects-board-filter');
    if (filterEl) {
      filterEl.addEventListener('input', (e) => {
        this.filter = String(e.target.value || '').toLowerCase().trim();
        this.render();
      });
    }

    const columnsEl = modal.querySelector('#projects-board-columns');
    if (columnsEl) {
      columnsEl.addEventListener('dragstart', (e) => this.onDragStart(e));
      columnsEl.addEventListener('dragend', (e) => this.onDragEnd(e));
      columnsEl.addEventListener('dragover', (e) => this.onDragOver(e));
      columnsEl.addEventListener('dragleave', (e) => this.onDragLeave(e));
      columnsEl.addEventListener('drop', (e) => this.onDrop(e));
    }
  }

  async refresh({ force = false } = {}) {
    if (!this.visible) return;
    const modal = document.getElementById(this.modalId);
    if (!modal) return;

    const metaEl = modal.querySelector('#projects-board-meta');
    if (metaEl) metaEl.textContent = 'Loading…';

    try {
      const [boardRes, repos] = await Promise.all([
        this.fetchBoard({ force }),
        this.orchestrator?.getScannedRepos?.({ force }) || Promise.resolve([])
      ]);

      const board = boardRes?.board && typeof boardRes.board === 'object' ? boardRes.board : { projectToColumn: {} };
      this.board = board;
      this.storePath = String(boardRes?.storePath || '').trim();

      const fromServer = Array.isArray(boardRes?.columns) ? boardRes.columns : [];
      if (fromServer.length) {
        this.columns = fromServer
          .map((c) => ({ id: String(c?.id || '').trim().toLowerCase(), label: String(c?.label || '').trim() }))
          .filter((c) => !!c.id && !!c.label);
      }

      this.projects = (Array.isArray(repos) ? repos : []).map((p) => this.normalizeProjectRow(p)).filter(Boolean);
      this.render();
    } catch (error) {
      if (metaEl) metaEl.textContent = 'Failed to load projects board.';
      this.orchestrator?.showToast?.(String(error?.message || error), 'error');
    }
  }

  async fetchBoard({ force = false } = {}) {
    const url = new URL('/api/projects/board', window.location.origin);
    if (force) url.searchParams.set('refresh', 'true');
    const res = await fetch(url.toString());
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) throw new Error(String(data?.error || 'Failed to load project board'));
    return data;
  }

  normalizeProjectRow(raw) {
    const name = String(raw?.name || '').trim();
    const relativePath = String(raw?.relativePath || '').trim().replace(/\\/g, '/');
    const path = String(raw?.path || '').trim();
    const type = String(raw?.type || '').trim();
    const category = String(raw?.category || '').trim();
    if (!name || !relativePath) return null;
    return {
      key: relativePath,
      name,
      path,
      type,
      category
    };
  }

  getProjectColumn(projectKey) {
    const key = String(projectKey || '').trim().replace(/\\/g, '/');
    const mapped = this.board?.projectToColumn && typeof this.board.projectToColumn === 'object' ? this.board.projectToColumn[key] : null;
    return String(mapped || 'backlog').trim().toLowerCase() || 'backlog';
  }

  getFilteredProjects() {
    const term = String(this.filter || '').trim().toLowerCase();
    const rows = Array.isArray(this.projects) ? this.projects : [];
    if (!term) return rows;
    return rows.filter((p) => {
      const name = String(p?.name || '').toLowerCase();
      const key = String(p?.key || '').toLowerCase();
      const cat = String(p?.category || '').toLowerCase();
      return name.includes(term) || key.includes(term) || cat.includes(term);
    });
  }

  buildColumnModel() {
    const rows = this.getFilteredProjects();
    const byColumn = new Map();
    for (const col of this.columns) byColumn.set(col.id, []);
    for (const project of rows) {
      const colId = this.getProjectColumn(project.key);
      if (!byColumn.has(colId)) byColumn.set(colId, []);
      byColumn.get(colId).push(project);
    }
    for (const [colId, list] of byColumn.entries()) {
      list.sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
      byColumn.set(colId, list);
    }
    return byColumn;
  }

  render() {
    const modal = document.getElementById(this.modalId);
    if (!modal) return;

    const metaEl = modal.querySelector('#projects-board-meta');
    if (metaEl) {
      const total = Array.isArray(this.projects) ? this.projects.length : 0;
      const visible = this.getFilteredProjects().length;
      const fileHint = this.storePath ? ` • saved: ${this.storePath}` : '';
      metaEl.textContent = `${visible}/${total} projects${fileHint}`;
    }

    const columnsEl = modal.querySelector('#projects-board-columns');
    if (!columnsEl) return;

    const byColumn = this.buildColumnModel();
    const escapeHtml = (value) => this.orchestrator?.escapeHtml?.(value) ?? String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#039;');

    const renderCard = (project) => {
      const icon = this.orchestrator?.getProjectIcon?.(project.type) || '📁';
      const name = escapeHtml(project.name);
      const key = escapeHtml(project.key);
      const path = escapeHtml(project.path || '');
      const category = escapeHtml(project.category || '');
      const subtitle = category ? `${category} • ${key}` : key;
      return `
        <div class="projects-board-card" draggable="true" data-project-key="${key}" title="${path}">
          <div class="projects-board-card-title">${icon} ${name}</div>
          <div class="projects-board-card-subtitle">${escapeHtml(subtitle)}</div>
        </div>
      `;
    };

    columnsEl.innerHTML = this.columns.map((col) => {
      const list = byColumn.get(col.id) || [];
      return `
        <section class="projects-board-column" data-column-id="${escapeHtml(col.id)}">
          <div class="projects-board-column-header">
            <div class="projects-board-column-title">${escapeHtml(col.label)}</div>
            <div class="projects-board-column-count">${list.length}</div>
          </div>
          <div class="projects-board-column-body" data-dropzone="true">
            ${list.length ? list.map(renderCard).join('') : '<div class="projects-board-empty">Drop here</div>'}
          </div>
        </section>
      `;
    }).join('');
  }

  onDragStart(event) {
    const card = event.target?.closest?.('.projects-board-card');
    if (!card) return;
    const key = String(card.dataset?.projectKey || '').trim();
    if (!key) return;
    this.dragProjectKey = key;
    card.classList.add('dragging');
    try {
      event.dataTransfer?.setData?.('text/plain', key);
      event.dataTransfer.effectAllowed = 'move';
    } catch {}
  }

  onDragEnd(event) {
    const card = event.target?.closest?.('.projects-board-card');
    if (card) card.classList.remove('dragging');
    document.querySelectorAll('.projects-board-column.drag-over').forEach((el) => el.classList.remove('drag-over'));
    this.dragProjectKey = null;
  }

  onDragOver(event) {
    const col = event.target?.closest?.('.projects-board-column');
    if (!col) return;
    if (!this.dragProjectKey) return;
    event.preventDefault();
    col.classList.add('drag-over');
    try {
      event.dataTransfer.dropEffect = 'move';
    } catch {}
  }

  onDragLeave(event) {
    const col = event.target?.closest?.('.projects-board-column');
    if (!col) return;
    const related = event.relatedTarget && col.contains(event.relatedTarget);
    if (related) return;
    col.classList.remove('drag-over');
  }

  async onDrop(event) {
    const col = event.target?.closest?.('.projects-board-column');
    if (!col) return;
    event.preventDefault();
    col.classList.remove('drag-over');

    const columnId = String(col.dataset?.columnId || '').trim();
    const projectKey = String(this.dragProjectKey || '').trim() || String(event.dataTransfer?.getData?.('text/plain') || '').trim();
    this.dragProjectKey = null;
    if (!projectKey || !columnId) return;

    try {
      const res = await fetch('/api/projects/board/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectKey, columnId })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(String(data?.error || 'Failed to move project'));
      this.board = data.board || this.board;
      this.orchestrator?.showToast?.(`Moved ${projectKey} → ${columnId}`, 'success');
      this.render();
    } catch (error) {
      this.orchestrator?.showToast?.(String(error?.message || error), 'error');
    }
  }
}

window.ProjectsBoardUI = ProjectsBoardUI;

