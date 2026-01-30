class ActivityFeedPanel {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.events = [];
    this.eventIds = new Set();
    this.socket = null;
    this.serverUrl = window.location.origin;
    this.filterText = '';
    this.groupFilter = 'all';
    this.paused = false;
    this.unseenCount = 0;

    this._dismissPointerHandler = null;
    this._dismissKeyHandler = null;
    this._socketHandler = null;
  }

  isOpen() {
    const modal = document.getElementById('activity-feed-modal');
    return !!modal && !modal.classList.contains('hidden');
  }

  toggle() {
    if (this.isOpen()) this.close();
    else this.show();
  }

  async show() {
    this.renderModal();
    this.unseenCount = 0;
    this.updateButtonBadge();
    await this.refresh();
  }

  close() {
    this.cleanupDismissHandlers();
    const modal = document.getElementById('activity-feed-modal');
    if (modal) modal.classList.add('hidden');
  }

  attachDismissHandlers(modal) {
    this._dismissPointerHandler = (event) => {
      if (!modal) return;
      if (modal.querySelector('.modal-content')?.contains(event.target)) return;
      this.close();
    };

    this._dismissKeyHandler = (event) => {
      if (event.key !== 'Escape') return;
      if (this.isOpen()) {
        event.preventDefault();
        this.close();
      }
    };

    document.addEventListener('pointerdown', this._dismissPointerHandler, true);
    document.addEventListener('keydown', this._dismissKeyHandler, true);
  }

  cleanupDismissHandlers() {
    if (this._dismissPointerHandler) {
      document.removeEventListener('pointerdown', this._dismissPointerHandler, true);
      this._dismissPointerHandler = null;
    }
    if (this._dismissKeyHandler) {
      document.removeEventListener('keydown', this._dismissKeyHandler, true);
      this._dismissKeyHandler = null;
    }
  }

  renderModal() {
    this.cleanupDismissHandlers();

    let modal = document.getElementById('activity-feed-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'activity-feed-modal';
      modal.className = 'modal activity-feed-modal hidden';
      modal.innerHTML = `
        <div class="modal-content activity-feed-content">
          <div class="browser-header">
            <h2>Activity</h2>
            <button class="close-btn" onclick="window.activityFeedPanel.close()">✕</button>
          </div>

          <div class="browser-toolbar">
            <div class="browser-toolbar-row">
              <div class="search-container">
                <input type="text" id="activity-filter-text" placeholder="Filter (kind, sessionId, repo, PR...)">
              </div>

              <select id="activity-group-filter" title="Category">
                <option value="all">All</option>
                <option value="agent">Agent</option>
                <option value="session">Session</option>
                <option value="server">Server</option>
                <option value="git">Git</option>
                <option value="pr">PR</option>
                <option value="tests">Tests</option>
                <option value="build">Build</option>
              </select>

              <label class="option-toggle" title="Pause live updates while keeping history visible">
                <input type="checkbox" id="activity-pause-live">
                Pause live
              </label>

              <button class="btn-secondary" id="activity-refresh-btn">Refresh</button>
              <button class="btn-secondary" id="activity-clear-btn" title="Clear only this UI list (does not delete server history)">Clear</button>
            </div>
          </div>

          <div class="browser-stats" id="activity-stats">Loading...</div>
          <div class="activity-list" id="activity-list"></div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    window.activityFeedPanel = this;
    modal.classList.remove('hidden');
    this.attachDismissHandlers(modal);

    const textInput = document.getElementById('activity-filter-text');
    if (textInput) {
      textInput.value = this.filterText;
      textInput.oninput = () => {
        this.filterText = String(textInput.value || '');
        this.renderList();
      };
    }

    const groupSelect = document.getElementById('activity-group-filter');
    if (groupSelect) {
      groupSelect.value = this.groupFilter;
      groupSelect.onchange = () => {
        this.groupFilter = String(groupSelect.value || 'all');
        this.renderList();
      };
    }

    const pauseCb = document.getElementById('activity-pause-live');
    if (pauseCb) {
      pauseCb.checked = !!this.paused;
      pauseCb.onchange = () => {
        this.paused = !!pauseCb.checked;
        this.renderStats();
      };
    }

    document.getElementById('activity-refresh-btn')?.addEventListener('click', () => this.refresh());
    document.getElementById('activity-clear-btn')?.addEventListener('click', () => {
      this.events = [];
      this.eventIds.clear();
      this.renderList();
    });
  }

  onSocketConnected(socket) {
    this.socket = socket || null;
    if (!this.socket) return;

    if (this._socketHandler) {
      try {
        this.socket.off('activity-event', this._socketHandler);
      } catch {
        // ignore
      }
    }

    this._socketHandler = (event) => {
      if (!event || !event.id) return;
      if (this.eventIds.has(event.id)) return;

      this.eventIds.add(event.id);
      this.events.unshift(event);
      if (this.events.length > 500) {
        const removed = this.events.splice(500);
        for (const ev of removed) this.eventIds.delete(ev?.id);
      }

      if (!this.isOpen()) {
        this.unseenCount += 1;
        this.updateButtonBadge();
        return;
      }

      if (this.paused) {
        this.renderStats();
        return;
      }

      this.renderList();
    };

    this.socket.on('activity-event', this._socketHandler);
  }

  async refresh() {
    try {
      const limit = 200;
      const resp = await fetch(`${this.serverUrl}/api/activity?limit=${limit}`);
      const data = await resp.json();
      if (!data?.ok) throw new Error(data?.error || 'Failed to fetch activity');

      const next = Array.isArray(data.events) ? data.events : [];
      this.events = [];
      this.eventIds.clear();
      for (const ev of next) {
        if (!ev || !ev.id) continue;
        if (this.eventIds.has(ev.id)) continue;
        this.eventIds.add(ev.id);
        this.events.push(ev);
      }

      this.renderList();
    } catch (error) {
      this.renderError(error?.message || String(error));
    }
  }

  renderError(message) {
    const list = document.getElementById('activity-list');
    if (list) {
      list.innerHTML = `<div class="activity-empty">Failed to load activity: ${this.escapeHtml(message)}</div>`;
    }
    const stats = document.getElementById('activity-stats');
    if (stats) {
      stats.textContent = 'Failed to load';
    }
  }

  renderStats() {
    const stats = document.getElementById('activity-stats');
    if (!stats) return;
    const total = this.events.length;
    const paused = this.paused ? ' (paused)' : '';
    stats.textContent = `${total} events${paused}`;
  }

  renderList() {
    this.renderStats();
    const list = document.getElementById('activity-list');
    if (!list) return;

    const items = this.getFilteredEvents();
    if (items.length === 0) {
      list.innerHTML = `<div class="activity-empty">No activity events.</div>`;
      return;
    }

    const html = items.slice(0, 500).map(ev => this.renderEvent(ev)).join('\n');
    list.innerHTML = html;
  }

  getFilteredEvents() {
    const text = String(this.filterText || '').trim().toLowerCase();
    const group = String(this.groupFilter || 'all');
    return this.events.filter((ev) => {
      const kind = String(ev?.kind || '');
      const groupOk = group === 'all' ? true : this.getGroup(kind) === group;
      if (!groupOk) return false;
      if (!text) return true;
      const hay = `${kind} ${JSON.stringify(ev?.data || {})}`.toLowerCase();
      return hay.includes(text);
    });
  }

  getGroup(kind) {
    const k = String(kind || '');
    const head = k.split('.')[0] || '';
    return head || 'other';
  }

  renderEvent(ev) {
    const ts = Number(ev?.ts) || 0;
    const when = ts ? new Date(ts) : null;
    const time = when ? when.toLocaleString() : 'unknown time';
    const kind = String(ev?.kind || 'unknown');
    const summary = this.escapeHtml(this.summarizeEvent(ev));
    const dataJson = this.escapeHtml(this.compactJson(ev?.data));
    const group = this.getGroup(kind);
    const actions = this.renderEventActions(ev);

    return `
      <div class="activity-event">
        <div class="activity-meta">
          <span class="activity-time">${this.escapeHtml(time)}</span>
          <span class="activity-kind activity-kind-${this.escapeHtml(group)}">${this.escapeHtml(kind)}</span>
          ${actions}
        </div>
        <div class="activity-summary">${summary}</div>
        <div class="activity-data">${dataJson}</div>
      </div>
    `;
  }

  renderEventActions(ev) {
    const data = ev?.data && typeof ev.data === 'object' ? ev.data : {};
    const sessionId = String(data.sessionId || '').trim();
    const url = String(data.url || '').trim();

    const parts = [];
    if (sessionId) {
      parts.push(`<button class="btn-secondary activity-action-btn" onclick="event.stopPropagation(); window.activityFeedPanel.handleEventAction('focus', '${this.escapeHtml(ev.id)}')">Focus</button>`);
    }
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      parts.push(`<button class="btn-secondary activity-action-btn" onclick="event.stopPropagation(); window.activityFeedPanel.handleEventAction('open', '${this.escapeHtml(ev.id)}')">Open</button>`);
    }
    parts.push(`<button class="btn-secondary activity-action-btn" onclick="event.stopPropagation(); window.activityFeedPanel.handleEventAction('copy', '${this.escapeHtml(ev.id)}')">Copy</button>`);

    return `<div class="activity-actions">${parts.join('')}</div>`;
  }

  async handleEventAction(action, eventId) {
    const id = String(eventId || '').trim();
    if (!id) return;
    const ev = this.events.find((e) => e && e.id === id) || null;
    if (!ev) return;

    const data = ev?.data && typeof ev.data === 'object' ? ev.data : {};
    const sessionId = String(data.sessionId || '').trim();
    const url = String(data.url || '').trim();

    try {
      if (action === 'focus' && sessionId) {
        this.orchestrator?.focusTerminal?.(sessionId);
        return;
      }

      if (action === 'open' && url) {
        window.open(url, '_blank');
        return;
      }

      if (action === 'copy') {
        const text = JSON.stringify(ev, null, 2);
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
      }
    } catch {
      // ignore
    }
  }

  summarizeEvent(ev) {
    const kind = String(ev?.kind || '');
    const data = ev?.data && typeof ev.data === 'object' ? ev.data : {};

    if (kind === 'server.started') return `Server started (port ${data.port || 'unknown'})`;
    if (kind === 'workspace.switch.requested') return `Workspace switch requested (${data.fromWorkspaceId || '?'} → ${data.toWorkspaceId || '?'})`;
    if (kind === 'workspace.switch.completed') return `Workspace switched (${data.fromWorkspaceId || '?'} → ${data.toWorkspaceName || data.toWorkspaceId || '?'})`;
    if (kind === 'workspace.switch.failed') return `Workspace switch failed (${data.toWorkspaceId || '?'})`;
    if (kind === 'worktree.sessions.add.requested') return `Add worktree sessions requested (${data.repositoryName ? `${data.repositoryName}/` : ''}${data.worktreeId || '?'})`;
    if (kind === 'worktree.sessions.add.completed') return `Worktree sessions added (${data.worktreeId || '?'})`;
    if (kind === 'worktree.sessions.add.failed') return `Add worktree sessions failed (${data.worktreeId || '?'})`;
    if (kind === 'tab.closed') return `Tab closed (${data.tabId || '?'}, closed ${data.closed || 0})`;
    if (kind === 'session.closed') return `Session closed (${data.sessionId || '?'})`;
    if (kind === 'git.pull') return `Git pull (${data.ok ? 'ok' : 'failed'})`;
    if (kind === 'pr.merge') return `PR merge ${data.ok ? 'ok' : 'failed'} (${data.repo || 'repo'} #${data.prNumber || '?'})`;
    if (kind === 'pr.review') return `PR review ${data.ok ? 'ok' : 'failed'} (${data.repo || 'repo'} #${data.prNumber || '?'})`;
    if (kind === 'task-record.updated') {
      const id = data.id || 'record';
      const ch = data.changes && typeof data.changes === 'object' ? data.changes : {};
      const tierTo = ch.tier?.to ?? null;
      const riskTo = ch.risk?.to ?? null;
      const doneTo = ch.doneAt?.to ?? null;
      const parts = [];
      if (tierTo) parts.push(`T${tierTo}`);
      if (riskTo) parts.push(`risk:${riskTo}`);
      if (doneTo) parts.push('done');
      return `Task record updated (${id})${parts.length ? ` • ${parts.join(' • ')}` : ''}`;
    }
    if (kind.startsWith('tests.')) return `${kind} (${data.ok ? 'ok' : 'running'})`;
    if (kind.startsWith('agent.start')) return `Start agent (${data.agent || 'agent'}) for ${data.sessionId || 'session'}`;
    if (kind.startsWith('session.')) return `${kind} (${data.sessionId || ''})`.trim();
    if (kind.startsWith('server.control')) return `${kind} (${data.action || ''})`.trim();
    if (kind.startsWith('build.production')) return `${kind} (${data.ok ? 'ok' : data.error ? 'failed' : 'running'})`;

    if (data.sessionId) return `${kind} (${data.sessionId})`;
    return kind;
  }

  compactJson(data) {
    try {
      if (!data || typeof data !== 'object') return String(data || '');
      const s = JSON.stringify(data);
      if (s.length <= 280) return s;
      return `${s.slice(0, 260)}…`;
    } catch {
      return '';
    }
  }

  updateButtonBadge() {
    const btn = document.getElementById('activity-btn');
    if (!btn) return;
    const base = '📰 Activity';
    btn.textContent = this.unseenCount > 0 ? `${base} (${this.unseenCount})` : base;
  }

  escapeHtml(str) {
    return String(str || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }
}

window.ActivityFeedPanel = ActivityFeedPanel;
