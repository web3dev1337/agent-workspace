class ProjectsBoardUI {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.modalId = 'projects-board-modal';
    this.visible = false;
    this.columns = [
      { id: 'archived', label: 'Archive' },
      { id: 'someday', label: 'Maybe One Day' },
      { id: 'backlog', label: 'Backlog' },
      { id: 'active', label: 'Active' },
      { id: 'next', label: 'Ship Next' },
      { id: 'done', label: 'Done' }
    ];
    this.board = { projectToColumn: {}, orderByColumn: {}, collapsedColumnIds: [], tagsByProjectKey: {} };
    this.storePath = '';
    this.projects = [];
    this.filter = '';
    this.dragProjectKey = null;
    this.dragSourceColumnId = null;
    this.dragCardEl = null;
    this.dragInsertTargetEl = null;
    this.dragInsertBeforeKey = null;
    this.dragInsertColumnId = null;
    this.dragHoverColumnId = null;
    this._dragOverRaf = null;
    this._pendingDragOver = null;
    this.hideForks = false;
    this.githubRepos = [];
    this._escHandler = null;
    this._wrapExpandResizeHandler = null;
    this._wrapExpandResizeDebounce = null;
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
    this.ensureWrapExpandHandler();

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

    if (this._wrapExpandResizeHandler) {
      window.removeEventListener('resize', this._wrapExpandResizeHandler);
      this._wrapExpandResizeHandler = null;
    }
    if (this._wrapExpandResizeDebounce) {
      clearTimeout(this._wrapExpandResizeDebounce);
      this._wrapExpandResizeDebounce = null;
    }
  }

  createModal() {
    const modal = document.createElement('div');
    modal.id = this.modalId;
    modal.className = 'modal hidden projects-board-modal';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <button type="button" class="btn-secondary" id="projects-board-back" aria-label="Back" title="Back to dashboard" style="margin-right: 8px; padding: 4px 10px; font-size: 0.85rem;">← Back</button>
          <h3>Projects Board</h3>
          <button type="button" class="close-btn" id="projects-board-close" aria-label="Close">✕</button>
        </div>
        <div class="projects-board-toolbar">
          <input id="projects-board-filter" class="search-input" type="search" placeholder="Filter projects…" autocomplete="off" />
          <label class="projects-board-toggle" title="Hide forked repositories (best-effort from GitHub)">
            <input type="checkbox" id="projects-board-hide-forks" />
            Hide forks
          </label>
          <button type="button" class="button-secondary" id="projects-board-refresh" title="Refresh repos + board">↻ Refresh</button>
        </div>
        <div class="projects-board-meta" id="projects-board-meta"></div>
        <div class="projects-board-columns projects-board-expand projects-board-grid" id="projects-board-columns"></div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#projects-board-close')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.hide();
    });

    modal.querySelector('#projects-board-back')?.addEventListener('click', (e) => {
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

    const hideForksEl = modal.querySelector('#projects-board-hide-forks');
    if (hideForksEl) {
      try {
        const raw = localStorage.getItem('projects-board-hide-forks');
        this.hideForks = raw === 'true';
        hideForksEl.checked = this.hideForks;
      } catch {}

      hideForksEl.addEventListener('change', async (e) => {
        this.hideForks = !!e.target.checked;
        try {
          localStorage.setItem('projects-board-hide-forks', this.hideForks ? 'true' : 'false');
        } catch {}
        if (this.hideForks) {
          await this.ensureGitHubRepos({ force: false });
        }
        this.render();
      });
    }

    const columnsEl = modal.querySelector('#projects-board-columns');
    if (columnsEl) {
      columnsEl.addEventListener('click', (e) => this.onClick(e));
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

      const board = boardRes?.board && typeof boardRes.board === 'object' ? boardRes.board : {};
      this.board = {
        ...(board || {}),
        projectToColumn: board?.projectToColumn && typeof board.projectToColumn === 'object' ? board.projectToColumn : {},
        orderByColumn: board?.orderByColumn && typeof board.orderByColumn === 'object' ? board.orderByColumn : {},
        collapsedColumnIds: Array.isArray(board?.collapsedColumnIds) ? board.collapsedColumnIds : [],
        tagsByProjectKey: board?.tagsByProjectKey && typeof board.tagsByProjectKey === 'object' ? board.tagsByProjectKey : {}
      };
      this.storePath = String(boardRes?.storePath || '').trim();

      const fromServer = Array.isArray(boardRes?.columns) ? boardRes.columns : [];
      if (fromServer.length) {
        this.columns = fromServer
          .map((c) => ({ id: String(c?.id || '').trim().toLowerCase(), label: String(c?.label || '').trim() }))
          .filter((c) => !!c.id && !!c.label);
      }

      this.projects = (Array.isArray(repos) ? repos : []).map((p) => this.normalizeProjectRow(p)).filter(Boolean);

      try {
        const hideForksEl = modal.querySelector('#projects-board-hide-forks');
        if (hideForksEl) hideForksEl.checked = !!this.hideForks;
      } catch {}

      if (this.hideForks) {
        await this.ensureGitHubRepos({ force });
      }

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

  getProjectIsLive(projectKey) {
    const key = String(projectKey || '').trim().replace(/\\/g, '/');
    const tags = this.board?.tagsByProjectKey && typeof this.board.tagsByProjectKey === 'object' ? this.board.tagsByProjectKey[key] : null;
    return !!tags?.live;
  }

  getForkMapByName() {
    const map = new Map();
    const rows = Array.isArray(this.githubRepos) ? this.githubRepos : [];
    for (const repo of rows) {
      const name = String(repo?.name || '').trim().toLowerCase();
      if (!name) continue;
      map.set(name, { isFork: !!repo?.isFork });
    }
    return map;
  }

  matchesFilter(project, term) {
    const t = String(term || '').trim().toLowerCase();
    if (!t) return true;
    const name = String(project?.name || '').toLowerCase();
    const key = String(project?.key || '').toLowerCase();
    const cat = String(project?.category || '').toLowerCase();
    return name.includes(t) || key.includes(t) || cat.includes(t);
  }

  buildFullColumnModel() {
    const rows = Array.isArray(this.projects) ? this.projects : [];
    const forkMap = this.hideForks ? this.getForkMapByName() : null;
    const visible = forkMap
      ? rows.filter((p) => !forkMap.get(String(p?.name || '').trim().toLowerCase())?.isFork)
      : rows;

    const byColumn = new Map();
    for (const col of this.columns) byColumn.set(col.id, []);
    for (const project of visible) {
      const colId = this.getProjectColumn(project.key);
      if (!byColumn.has(colId)) byColumn.set(colId, []);
      byColumn.get(colId).push(project);
    }

    for (const [colId, list] of byColumn.entries()) {
      const order = Array.isArray(this.board?.orderByColumn?.[colId]) ? this.board.orderByColumn[colId] : [];
      const index = new Map();
      order.forEach((k, i) => {
        const key = String(k || '').trim().replace(/\\/g, '/');
        if (key && !index.has(key)) index.set(key, i);
      });

      list.sort((a, b) => {
        const aKey = String(a?.key || '').trim().replace(/\\/g, '/');
        const bKey = String(b?.key || '').trim().replace(/\\/g, '/');
        const aRank = index.has(aKey) ? index.get(aKey) : Number.POSITIVE_INFINITY;
        const bRank = index.has(bKey) ? index.get(bKey) : Number.POSITIVE_INFINITY;
        if (aRank !== bRank) return aRank - bRank;
        return String(a?.name || '').localeCompare(String(b?.name || ''));
      });
      byColumn.set(colId, list);
    }
    return byColumn;
  }

  buildColumnModel(fullModel = null) {
    const full = fullModel || this.buildFullColumnModel();
    const term = String(this.filter || '').trim().toLowerCase();
    if (!term) return full;
    const filtered = new Map();
    for (const [colId, list] of full.entries()) {
      filtered.set(colId, list.filter((p) => this.matchesFilter(p, term)));
    }
    return filtered;
  }

  render() {
    const modal = document.getElementById(this.modalId);
    if (!modal) return;

    const full = this.buildFullColumnModel();
    const byColumn = this.buildColumnModel(full);

    const metaEl = modal.querySelector('#projects-board-meta');
    if (metaEl) {
      let total = 0;
      for (const list of full.values()) total += list.length;
      let visible = 0;
      for (const list of byColumn.values()) visible += list.length;
      const fileHint = this.storePath ? ` • saved: ${this.storePath}` : '';
      metaEl.textContent = `${visible}/${total} projects${fileHint}`;
    }

    const columnsEl = modal.querySelector('#projects-board-columns');
    if (!columnsEl) return;
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
      const type = escapeHtml(project.type || '');
      const subtitle = category ? `${category} • ${key}` : key;
      const isLive = this.getProjectIsLive(project.key);
      return `
        <div class="projects-board-card ${isLive ? 'is-live' : ''}" draggable="true" data-project-key="${key}" data-project-type="${type}" title="${path}">
          <div class="projects-board-card-top">
            <div class="projects-board-card-title">${icon} ${name}</div>
            <button type="button" class="projects-board-card-live ${isLive ? 'is-on' : ''}" data-no-drag="true" data-live-toggle="${key}" aria-label="Toggle shipped" title="Shipped" aria-pressed="${isLive ? 'true' : 'false'}">★</button>
          </div>
          <div class="projects-board-card-subtitle">${escapeHtml(subtitle)}</div>
        </div>
      `;
    };

    const collapsedSet = new Set(Array.isArray(this.board?.collapsedColumnIds) ? this.board.collapsedColumnIds : []);

    columnsEl.innerHTML = this.columns.map((col) => {
      const list = byColumn.get(col.id) || [];
      const isCollapsed = collapsedSet.has(col.id);
      return `
        <section class="projects-board-column ${isCollapsed ? 'is-collapsed' : ''}" data-column-id="${escapeHtml(col.id)}">
          <button type="button" class="projects-board-column-header" data-col-toggle="${escapeHtml(col.id)}" aria-expanded="${isCollapsed ? 'false' : 'true'}">
            <div class="projects-board-column-title">${escapeHtml(col.label)}</div>
            <div class="projects-board-column-count">${list.length}</div>
          </button>
          <div class="projects-board-column-body" data-dropzone="true">
            ${list.length ? list.map(renderCard).join('') : '<div class="projects-board-empty">Drop here</div>'}
          </div>
        </section>
      `;
    }).join('');

    this.bindDragHandlers(columnsEl);
    this.applyWrapExpandColumns();
  }

  bindDragHandlers(columnsEl) {
    if (!columnsEl) return;

    columnsEl.querySelectorAll('.projects-board-card').forEach((card) => {
      card.addEventListener('dragstart', (e) => this.onDragStart(e));
      card.addEventListener('dragend', (e) => this.onDragEnd(e));
    });

    columnsEl.querySelectorAll('.projects-board-column').forEach((target) => {
      target.addEventListener('dragenter', (e) => this.onDragEnter(e));
      target.addEventListener('dragover', (e) => this.onDragOver(e));
      target.addEventListener('dragleave', (e) => this.onDragLeave(e));
      target.addEventListener('drop', (e) => this.onDrop(e));
    });
  }

  ensureWrapExpandHandler() {
    if (this._wrapExpandResizeHandler) return;
    this._wrapExpandResizeHandler = () => {
      if (this._wrapExpandResizeDebounce) clearTimeout(this._wrapExpandResizeDebounce);
      this._wrapExpandResizeDebounce = setTimeout(() => this.applyWrapExpandColumns(), 120);
    };
    window.addEventListener('resize', this._wrapExpandResizeHandler);
  }

  applyWrapExpandColumns() {
    if (!this.visible) return;
    const modal = document.getElementById(this.modalId);
    if (!modal) return;
    const boardEl = modal.querySelector('#projects-board-columns');
    if (!boardEl) return;

    const columns = Array.from(boardEl.querySelectorAll('.projects-board-column'));

    const computeForColumn = (col) => {
      if (!col || col.classList.contains('is-collapsed')) return;
      const cardsContainer = col.querySelector('.projects-board-column-body');
      const header = col.querySelector('.projects-board-column-header');
      if (!cardsContainer || !header) return;

      col.style.width = '';
      col.style.minWidth = '';
      const baseWidth = col.getBoundingClientRect().width;

      const cards = Array.from(cardsContainer.querySelectorAll('.projects-board-card'));
      const cardCount = cards.length;
      if (cardCount === 0) {
        col.style.setProperty('--projects-card-columns', '1');
        col.style.setProperty('--projects-card-rows', '1');
        return;
      }

      const containerHeight = cardsContainer.clientHeight;
      if (!containerHeight || containerHeight < 40) return;

      const styles = window.getComputedStyle(cardsContainer);
      const rowGap = Number.parseFloat(styles.rowGap || styles.gap || '0') || 0;
      const columnGap = Number.parseFloat(styles.columnGap || styles.gap || '0') || 0;
      const padLeft = Number.parseFloat(styles.paddingLeft || '0') || 0;
      const padRight = Number.parseFloat(styles.paddingRight || '0') || 0;
      const sample = cards.slice(0, Math.min(6, cardCount));
      const heights = sample.map(el => el.getBoundingClientRect().height).filter(Boolean);
      const avg = heights.length ? (heights.reduce((a, b) => a + b, 0) / heights.length) : 80;
      const denom = Math.max(1, avg + rowGap);
      let rowsFit = Math.max(1, Math.floor((containerHeight + rowGap) / denom));
      rowsFit = Math.min(rowsFit, cardCount);

      const apply = (rows) => {
        const r = Math.max(1, Number(rows) || 1);
        const cols = Math.max(1, Math.ceil(cardCount / r));
        col.style.setProperty('--projects-card-rows', String(r));
        col.style.setProperty('--projects-card-columns', String(cols));

        if (cols <= 1) {
          col.style.width = '';
          col.style.minWidth = '';
        } else {
          const minCardWidth = 220;
          const cardsWidth = (cols * minCardWidth) + Math.max(0, cols - 1) * columnGap;
          const target = Math.max(baseWidth, cardsWidth + padLeft + padRight);
          col.style.width = `${Math.round(target)}px`;
          col.style.minWidth = `${Math.round(target)}px`;
        }
      };

      apply(rowsFit);

      for (let attempt = 0; attempt < 24; attempt++) {
        void cardsContainer.offsetHeight;
        if (cardsContainer.scrollHeight <= cardsContainer.clientHeight + 1) break;
        rowsFit = Math.max(1, rowsFit - 1);
        apply(rowsFit);
      }
    };

    for (const col of columns) {
      if (col.classList.contains('is-collapsed')) {
        col.style.removeProperty('--projects-card-columns');
        col.style.removeProperty('--projects-card-rows');
        col.style.width = '';
        col.style.minWidth = '';
      }
    }

    window.requestAnimationFrame(() => {
      columns.forEach(computeForColumn);
    });
  }

  async ensureGitHubRepos({ force = false } = {}) {
    try {
      const repos = await this.orchestrator?.getGitHubRepos?.({ force, limit: 2000 });
      this.githubRepos = Array.isArray(repos) ? repos : [];
    } catch {
      this.githubRepos = [];
    }
  }

  getColumnDropzone(columnEl) {
    if (!columnEl) return null;
    return columnEl.querySelector?.('.projects-board-column-body[data-dropzone="true"]') || null;
  }

  getColumnById(columnId) {
    const id = String(columnId || '').trim();
    if (!id) return null;

    const modal = document.getElementById(this.modalId);
    if (!modal) return null;

    return modal.querySelector(`.projects-board-column[data-column-id="${CSS.escape(id)}"]`) || null;
  }

  getColumnFromPoint(x, y) {
    const px = Number.isFinite(Number(x)) ? Number(x) : null;
    const py = Number.isFinite(Number(y)) ? Number(y) : null;
    if (!Number.isFinite(px) || !Number.isFinite(py)) return null;

    let target = null;
    try {
      target = document.elementFromPoint(px, py);
    } catch {
      target = null;
    }

    return target?.closest?.('.projects-board-column') || null;
  }

  getColumnFromDragEvent(event) {
    const currentTarget = event.currentTarget;
    if (currentTarget?.classList?.contains?.('projects-board-column')) {
      return currentTarget;
    }

    const currentTargetColumn = currentTarget?.closest?.('.projects-board-column');
    if (currentTargetColumn) return currentTargetColumn;

    const direct = event.target?.closest?.('.projects-board-column');
    if (direct) return direct;

    if (typeof event.composedPath === 'function') {
      for (const node of event.composedPath() || []) {
        if (!node || node.nodeType !== 1) continue;
        const col = node.closest?.('.projects-board-column');
        if (col) return col;
      }
    }

    const byPoint = this.getColumnFromPoint(event.clientX, event.clientY);
    if (byPoint) return byPoint;

    if (this.dragHoverColumnId) {
      return this.getColumnById(this.dragHoverColumnId);
    }

    return null;
  }

  clearDragInsertTarget() {
    if (this.dragInsertTargetEl) {
      this.dragInsertTargetEl.classList.remove('is-drop-target-before', 'is-drop-target-after');
    }
    this.dragInsertTargetEl = null;
    this.dragInsertBeforeKey = null;
    this.dragInsertColumnId = null;
    this.dragHoverColumnId = null;
  }

  computeClosestCardForPoint(cards, x, y) {
    const px = Number.isFinite(Number(x)) ? Number(x) : 0;
    const py = Number.isFinite(Number(y)) ? Number(y) : 0;
    let best = null;
    let bestDist = Number.POSITIVE_INFINITY;

    for (const card of cards) {
      if (!card) continue;
      let rect = null;
      try {
        rect = card.getBoundingClientRect();
      } catch {
        rect = null;
      }
      if (!rect) continue;

      const dx = (px < rect.left) ? (rect.left - px) : (px > rect.right ? (px - rect.right) : 0);
      const dy = (py < rect.top) ? (rect.top - py) : (py > rect.bottom ? (py - rect.bottom) : 0);
      const dist = (dx * dx) + (dy * dy);
      if (dist < bestDist) {
        bestDist = dist;
        best = { card, rect };
      }
    }

    return best;
  }

  computeInsertBeforeKey(dropzoneEl, { x, y } = {}) {
    const dropzone = dropzoneEl;
    if (!dropzone) return { beforeKey: null, targetEl: null, after: false };

    const cards = Array.from(dropzone.querySelectorAll('.projects-board-card')).filter((el) => !el.classList.contains('dragging'));
    if (!cards.length) return { beforeKey: null, targetEl: null, after: false };

    const closest = this.computeClosestCardForPoint(cards, x, y);
    const target = closest?.card || null;
    const rect = closest?.rect || null;
    if (!target || !rect) return { beforeKey: null, targetEl: null, after: false };

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (Number.isFinite(Number(x)) ? Number(x) : 0) - cx;
    const dy = (Number.isFinite(Number(y)) ? Number(y) : 0) - cy;
    const useY = Math.abs(dy) >= Math.abs(dx);
    const after = useY ? (dy > 0) : (dx > 0);

    const idx = cards.indexOf(target);
    if (after) {
      const next = idx >= 0 ? cards[idx + 1] : null;
      const beforeKey = String(next?.dataset?.projectKey || '').trim() || null;
      return { beforeKey, targetEl: target, after: true };
    }

    const beforeKey = String(target?.dataset?.projectKey || '').trim() || null;
    return { beforeKey, targetEl: target, after: false };
  }

  updateDragInsertTarget(dropzoneEl, { x, y } = {}) {
    const dropzone = dropzoneEl;
    const col = dropzone?.closest?.('.projects-board-column');
    const columnId = String(col?.dataset?.columnId || '').trim();

    const { beforeKey, targetEl, after } = this.computeInsertBeforeKey(dropzone, { x, y });
    this.dragInsertBeforeKey = beforeKey;
    this.dragInsertColumnId = columnId || null;

    if (this.dragInsertTargetEl && this.dragInsertTargetEl !== targetEl) {
      this.dragInsertTargetEl.classList.remove('is-drop-target-before', 'is-drop-target-after');
    }

    if (!targetEl) {
      this.dragInsertTargetEl = null;
      return;
    }

    targetEl.classList.remove('is-drop-target-before', 'is-drop-target-after');
    targetEl.classList.add(after ? 'is-drop-target-after' : 'is-drop-target-before');
    this.dragInsertTargetEl = targetEl;
  }

  onDragStart(event) {
    if (event.target?.closest?.('[data-no-drag="true"]')) return;
    const card = event.target?.closest?.('.projects-board-card');
    if (!card) return;
    const key = String(card.dataset?.projectKey || '').trim();
    if (!key) return;
    this.dragProjectKey = key;
    this.dragSourceColumnId = this.getProjectColumn(key);
    this.dragCardEl = card;
    this.clearDragInsertTarget();
    this.dragHoverColumnId = this.dragSourceColumnId;
    card.classList.add('dragging');
    try {
      event.dataTransfer?.setData?.('text/plain', key);
      event.dataTransfer?.setData?.('text', key);
      event.dataTransfer.effectAllowed = 'move';
    } catch {}
  }

  onDragEnter(event) {
    const col = this.getColumnFromDragEvent(event);
    if (!col || !this.dragProjectKey) return;
    event.preventDefault();
    try {
      event.dataTransfer.dropEffect = 'move';
    } catch {}
  }

  onDragEnd(event) {
    const card = event.target?.closest?.('.projects-board-card');
    if (card) card.classList.remove('dragging');
    document.querySelectorAll('.projects-board-column.drag-over').forEach((el) => el.classList.remove('drag-over'));
    this.clearDragInsertTarget();
    this.dragProjectKey = null;
    this.dragSourceColumnId = null;
    this.dragCardEl = null;
    if (this._dragOverRaf) {
      window.cancelAnimationFrame(this._dragOverRaf);
      this._dragOverRaf = null;
    }
    this._pendingDragOver = null;
  }

  onDragOver(event) {
    const col = this.getColumnFromDragEvent(event);
    if (!col) return;
    if (!this.dragProjectKey) return;
    event.preventDefault();
    document.querySelectorAll('.projects-board-column.drag-over').forEach((el) => {
      if (el !== col) el.classList.remove('drag-over');
    });
    col.classList.add('drag-over');
    try {
      event.dataTransfer.dropEffect = 'move';
    } catch {}

    this.dragHoverColumnId = String(col.dataset?.columnId || '').trim();

    const columnId = String(col.dataset?.columnId || '').trim();
    if (col.classList.contains('is-collapsed')) {
      this.clearDragInsertTarget();
      this.dragInsertBeforeKey = null;
      this.dragInsertColumnId = columnId || null;
      return;
    }

    const dropzone = this.getColumnDropzone(col);
    if (!dropzone) return;
    this._pendingDragOver = { dropzone, x: event.clientX, y: event.clientY };
    if (this._dragOverRaf) return;
    this._dragOverRaf = window.requestAnimationFrame(() => {
      this._dragOverRaf = null;
      const pending = this._pendingDragOver;
      this._pendingDragOver = null;
      if (!pending) return;
      this.updateDragInsertTarget(pending.dropzone, { x: pending.x, y: pending.y });
    });
  }

  onDragLeave(event) {
    const col = this.getColumnFromDragEvent(event);
    if (!col) return;
    const related = event.relatedTarget && col.contains(event.relatedTarget);
    if (related) return;
    col.classList.remove('drag-over');
    const columnId = String(col.dataset?.columnId || '').trim();
    if (columnId && columnId === this.dragInsertColumnId) {
      this.clearDragInsertTarget();
    }
    if (columnId && columnId === this.dragHoverColumnId) {
      this.dragHoverColumnId = null;
    }
  }

  async onDrop(event) {
    const col = this.getColumnFromDragEvent(event);
    if (!col) return;
    event.preventDefault();
    col.classList.remove('drag-over');

    const columnId = String(col.dataset?.columnId || '').trim();
    const projectKey = String(this.dragProjectKey || '').trim() || String(event.dataTransfer?.getData?.('text/plain') || '').trim();
    const sourceColumnId = this.dragSourceColumnId || this.getProjectColumn(projectKey);
    if (!projectKey || !columnId) return;
    this.dragHoverColumnId = null;

    const normalizedProjectKey = String(projectKey || '').trim().replace(/\\/g, '/');
    const dropzone = col.classList.contains('is-collapsed') ? null : this.getColumnDropzone(col);
    let insertBeforeKey = null;
    if (dropzone) {
      insertBeforeKey = this.computeInsertBeforeKey(dropzone, { x: event.clientX, y: event.clientY })?.beforeKey || null;
    }
    if (!insertBeforeKey && this.dragInsertColumnId === columnId) {
      insertBeforeKey = this.dragInsertBeforeKey;
    }

    this.dragProjectKey = null;
    this.dragSourceColumnId = null;
    this.dragCardEl = null;
    this.clearDragInsertTarget();

    const full = this.buildFullColumnModel();
    const sourceKeys = (full.get(sourceColumnId) || []).map((p) => p.key).filter((k) => k !== normalizedProjectKey);
    const destinationKeysBase = sourceColumnId === columnId
      ? sourceKeys.slice()
      : (full.get(columnId) || []).map((p) => p.key).filter((k) => k !== normalizedProjectKey);

    const destinationKeys = destinationKeysBase.slice();
    const normalizedBeforeKey = String(insertBeforeKey || '').trim().replace(/\\/g, '/');
    const anchorIndex = normalizedBeforeKey ? destinationKeys.indexOf(normalizedBeforeKey) : -1;
    const insertIndex = anchorIndex >= 0 ? anchorIndex : destinationKeys.length;
    destinationKeys.splice(insertIndex, 0, normalizedProjectKey);

    const orderByColumn = { [columnId]: destinationKeys };
    if (sourceColumnId !== columnId) orderByColumn[sourceColumnId] = sourceKeys;

    try {
      const res = await fetch('/api/projects/board/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectKey, columnId, orderByColumn })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(String(data?.error || 'Failed to move project'));
      this.board = data.board || this.board;
      this.orchestrator?.showToast?.(`Moved ${projectKey} → ${columnId}`, 'success');
      try {
        this.orchestrator?.invalidateProjectsBoardCache?.();
        this.orchestrator?.renderSidebarProjectShortcuts?.({ force: true });
      } catch {}
      this.render();
    } catch (error) {
      this.orchestrator?.showToast?.(String(error?.message || error), 'error');
    }
  }

  async onClick(event) {
    const toggle = event.target?.closest?.('[data-col-toggle]');
    if (toggle) {
      const columnId = String(toggle.getAttribute('data-col-toggle') || '').trim();
      if (!columnId) return;

      const current = new Set(Array.isArray(this.board?.collapsedColumnIds) ? this.board.collapsedColumnIds : []);
      if (current.has(columnId)) current.delete(columnId);
      else current.add(columnId);
      const next = Array.from(current);

      this.board = { ...(this.board || {}), collapsedColumnIds: next };
      this.render();

      try {
        const res = await fetch('/api/projects/board/patch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ collapsedColumnIds: next })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) throw new Error(String(data?.error || 'Failed to update board'));
        this.board = data.board || this.board;
        this.render();
      } catch (error) {
        this.orchestrator?.showToast?.(String(error?.message || error), 'error');
      }
      return;
    }

    const liveToggle = event.target?.closest?.('[data-live-toggle]');
    if (liveToggle) {
      event.preventDefault();
      const projectKey = String(liveToggle.getAttribute('data-live-toggle') || '').trim();
      if (!projectKey) return;
      const nextLive = !this.getProjectIsLive(projectKey);

      try {
        const res = await fetch('/api/projects/board/patch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectKey, live: nextLive })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) throw new Error(String(data?.error || 'Failed to update board'));
        this.board = data.board || this.board;
        this.render();
      } catch (error) {
        this.orchestrator?.showToast?.(String(error?.message || error), 'error');
      }
      return;
    }

    const projectCard = event.target?.closest?.('.projects-board-card');
    if (projectCard) {
      event.preventDefault();
      const projectKey = String(projectCard.dataset?.projectKey || '').trim();
      if (!projectKey) return;
      await this.orchestrator?.startProjectWorktreeFromBoardKey?.(projectKey);
    }
  }
}

window.ProjectsBoardUI = ProjectsBoardUI;
