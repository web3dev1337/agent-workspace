/**
 * JARVIS panel — what the supervisor handled, what is still waiting, the work
 * the team asked for, and the map's pending proposals.
 *
 * Deliberately leads with "handled", because that number going up while the
 * waiting list stays empty is the system working. A dashboard that only shows
 * problems trains you to read it as a problem list.
 */
(function initJarvisPanel() {
  const REFRESH_MS = 20_000;

  const api = async (path, options = {}) => {
    const token = window.AUTH_TOKEN || localStorage.getItem('authToken') || '';
    const response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'X-Auth-Token': token } : {}),
        ...(options.headers || {})
      }
    });
    if (!response.ok) throw new Error(`${options.method || 'GET'} ${path} -> ${response.status}`);
    return response.json();
  };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const relativeTime = (iso) => {
    const ms = Date.parse(String(iso || ''));
    if (!Number.isFinite(ms)) return '';
    // A future timestamp (clock skew between machines, or a message posted by a
    // client whose clock is ahead) must not render as "-40717s ago".
    const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
    return `${Math.round(seconds / 86400)}d ago`;
  };

  class JarvisPanel {
    constructor() {
      this.root = null;
      this.timer = null;
      this.open = false;
      this.state = { supervisor: null, digest: [], discord: [], proposals: [], atlasHits: null };
    }

    mount() {
      if (this.root) return this.root;

      this.root = el('div', 'jarvis-panel');
      this.root.innerHTML = `
        <div class="jarvis-header">
          <span class="jarvis-title">JARVIS</span>
          <span class="jarvis-autonomy" data-role="autonomy"></span>
          <div class="jarvis-header-actions">
            <button data-action="catch-up" title="Deliver the waiting digest now">Catch me up</button>
            <button data-action="refresh" title="Refresh">↻</button>
            <button data-action="close" title="Close">✕</button>
          </div>
        </div>
        <div class="jarvis-stats" data-role="stats"></div>
        <div class="jarvis-error" data-role="action-error" role="alert"></div>
        <div class="jarvis-sections">
          <section data-role="waiting"></section>
          <section data-role="discord"></section>
          <section data-role="proposals"></section>
          <section data-role="atlas">
            <h4>Atlas</h4>
            <div class="jarvis-atlas-search">
              <input type="text" placeholder="who did this well? e.g. networking" data-role="atlas-input" />
              <button data-action="atlas-find">Find</button>
            </div>
            <div data-role="atlas-results"></div>
          </section>
        </div>
      `;

      this.root.addEventListener('click', (event) => this.onClick(event));
      this.root.querySelector('[data-role="atlas-input"]').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') this.findInAtlas();
      });

      document.body.appendChild(this.root);
      return this.root;
    }

    async onClick(event) {
      const action = event.target?.dataset?.action;
      if (!action) return;

      if (action === 'close') return this.hide();

      // Every branch below hits the network; a failure must surface, not vanish
      // into an unhandled rejection that leaves the button looking dead.
      try {
        if (action === 'refresh') return await this.refresh();
        if (action === 'atlas-find') return await this.findInAtlas();

        if (action === 'catch-up') {
          await api('/api/supervisor/digest/deliver', { method: 'POST', body: '{}' });
          return await this.refresh();
        }
        if (action === 'approve-proposal' || action === 'reject-proposal') {
          const id = event.target.dataset.id;
          const verb = action === 'approve-proposal' ? 'approve' : 'reject';
          await api(`/api/atlas/proposals/${encodeURIComponent(id)}/${verb}`, { method: 'POST', body: '{}' });
          return await this.refresh();
        }
      } catch (error) {
        this.showActionError(action, error);
      }
      return undefined;
    }

    showActionError(action, error) {
      const banner = this.root?.querySelector('[data-role="action-error"]');
      const message = `${action} failed: ${error?.message || error}`;
      if (banner) {
        banner.textContent = message;
        banner.classList.add('jarvis-error-visible');
        clearTimeout(this._errorTimer);
        this._errorTimer = setTimeout(() => banner.classList.remove('jarvis-error-visible'), 5000);
      }
      console.error('[JARVIS]', message);
    }

    async refresh() {
      const settled = await Promise.allSettled([
        api('/api/supervisor/briefing'),
        api('/api/discord-watch/untracked'),
        api('/api/atlas/proposals')
      ]);

      const [briefing, discord, proposals] = settled.map((r) => (r.status === 'fulfilled' ? r.value : null));
      this.state.supervisor = briefing?.briefing || null;
      this.state.digest = briefing?.briefing?.waiting || [];
      this.state.discord = discord?.items || [];
      this.state.proposals = proposals?.proposals || [];
      this.render();
    }

    async findInAtlas() {
      const input = this.root.querySelector('[data-role="atlas-input"]');
      const topic = String(input.value || '').trim();
      if (!topic) return;

      try {
        const result = await api(`/api/atlas/find?topic=${encodeURIComponent(topic)}`);
        this.state.atlasHits = { topic, hits: result.hits || [] };
      } catch {
        this.state.atlasHits = { topic, hits: [], error: true };
      }
      this.renderAtlas();
    }

    renderStats() {
      const target = this.root.querySelector('[data-role="stats"]');
      const supervisor = this.state.supervisor;
      target.innerHTML = '';

      if (!supervisor) {
        target.appendChild(el('div', 'jarvis-stat-empty', 'Supervisor unreachable'));
        return;
      }

      const stats = supervisor.stats || {};
      const cells = [
        ['handled', (stats.resolved || 0) + (stats.delegated || 0)],
        ['delegated', stats.delegated || 0],
        ['waiting', this.state.digest.length],
        ['interrupts', `${supervisor.budget?.usedThisHour ?? 0}/${supervisor.budget?.maxPerHour ?? 0}`]
      ];

      for (const [label, value] of cells) {
        const cell = el('div', 'jarvis-stat');
        cell.appendChild(el('span', 'jarvis-stat-value', String(value)));
        cell.appendChild(el('span', 'jarvis-stat-label', label));
        target.appendChild(cell);
      }

      this.root.querySelector('[data-role="autonomy"]').textContent = supervisor.autonomy || '';
    }

    renderWaiting() {
      const target = this.root.querySelector('[data-role="waiting"]');
      target.innerHTML = '<h4>Needs you</h4>';

      if (!this.state.digest.length) {
        target.appendChild(el('p', 'jarvis-empty', 'Nothing. Everything else was handled.'));
        return;
      }

      for (const item of this.state.digest) {
        const row = el('div', `jarvis-item jarvis-sev-${item.severity}`);
        row.appendChild(el('span', 'jarvis-item-where', item.where));
        row.appendChild(el('span', 'jarvis-item-label', item.label));
        if (item.advice) row.appendChild(el('span', 'jarvis-item-advice', item.advice));
        row.appendChild(el('span', 'jarvis-item-meta', `urgency ${item.score} · seen ${item.count}× · ${relativeTime(item.lastSeenAt)}`));
        target.appendChild(row);
      }
    }

    renderDiscord() {
      const target = this.root.querySelector('[data-role="discord"]');
      target.innerHTML = '<h4>Asked for, not started</h4>';

      if (!this.state.discord.length) {
        target.appendChild(el('p', 'jarvis-empty', 'Nothing outstanding from chat.'));
        return;
      }

      for (const item of this.state.discord) {
        const row = el('div', `jarvis-item jarvis-tier-${item.tier}`);
        row.appendChild(el('span', 'jarvis-item-where', `T${item.tier} ${item.priority}`));
        row.appendChild(el('span', 'jarvis-item-label', item.summary));
        row.appendChild(el('span', 'jarvis-item-meta', `${item.assigneeNames?.join(', ') || 'unassigned'} · ${relativeTime(item.createdAt)}`));
        if (item.permalink) {
          const link = el('a', 'jarvis-item-link', 'open in Discord');
          link.href = item.permalink;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          row.appendChild(link);
        }
        target.appendChild(row);
      }
    }

    renderProposals() {
      const target = this.root.querySelector('[data-role="proposals"]');
      target.innerHTML = '<h4>Atlas proposals</h4>';

      if (!this.state.proposals.length) {
        target.appendChild(el('p', 'jarvis-empty', 'No proposals waiting.'));
        return;
      }

      for (const proposal of this.state.proposals) {
        const row = el('div', 'jarvis-item');
        row.appendChild(el('span', 'jarvis-item-where', `${proposal.repoId} · ${proposal.topic}${proposal.quality ? ` ${proposal.quality}/5` : ''}`));
        if (proposal.notes) row.appendChild(el('span', 'jarvis-item-label', proposal.notes));
        if (proposal.evidence) row.appendChild(el('span', 'jarvis-item-advice', `evidence: ${proposal.evidence}`));
        row.appendChild(el('span', 'jarvis-item-meta', `by ${proposal.proposedBy} · ${relativeTime(proposal.proposedAt)}`));

        const actions = el('div', 'jarvis-item-actions');
        const approve = el('button', 'jarvis-approve', 'Approve');
        approve.dataset.action = 'approve-proposal';
        approve.dataset.id = proposal.id;
        const reject = el('button', 'jarvis-reject', 'Reject');
        reject.dataset.action = 'reject-proposal';
        reject.dataset.id = proposal.id;
        actions.append(approve, reject);
        row.appendChild(actions);

        target.appendChild(row);
      }
    }

    renderAtlas() {
      const target = this.root.querySelector('[data-role="atlas-results"]');
      target.innerHTML = '';
      const found = this.state.atlasHits;
      if (!found) return;

      if (!found.hits.length) {
        target.appendChild(el('p', 'jarvis-empty', `Nothing recorded for "${found.topic}".`));
        return;
      }

      for (const hit of found.hits) {
        const row = el('div', 'jarvis-item');
        row.appendChild(el('span', 'jarvis-item-where', `${hit.quality ?? '?'}/5  ${hit.id}${hit.stale ? ' ⚠old' : ''}`));
        if (hit.notes) row.appendChild(el('span', 'jarvis-item-label', hit.notes));
        row.appendChild(el('span', 'jarvis-item-meta', hit.cloned ? hit.localPath : (hit.remoteUrl || 'not cloned')));
        target.appendChild(row);
      }
    }

    render() {
      if (!this.root) return;
      this.renderStats();
      this.renderWaiting();
      this.renderDiscord();
      this.renderProposals();
      this.renderAtlas();
    }

    show() {
      this.mount();
      this.root.classList.add('jarvis-open');
      this.open = true;
      this.refresh();
      if (!this.timer) this.timer = setInterval(() => this.open && this.refresh(), REFRESH_MS);
    }

    hide() {
      this.open = false;
      this.root?.classList.remove('jarvis-open');
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    }

    toggle() {
      return this.open ? this.hide() : this.show();
    }
  }

  const panel = new JarvisPanel();
  window.JarvisPanel = panel;

  // Alt+J — the fleet summary should be one keystroke away, not buried.
  document.addEventListener('keydown', (event) => {
    if (!event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key !== 'j' && event.key !== 'J') return;

    // Don't hijack the key while the user is typing (the same guard every other
    // Alt-shortcut in the app uses) — including the panel's own atlas search box.
    const target = event.target;
    const tag = String(target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return;

    event.preventDefault();
    panel.toggle();
  });
})();
