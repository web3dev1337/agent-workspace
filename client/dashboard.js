// Dashboard component for workspace management

class Dashboard {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.workspaces = [];
    this.config = {};
    this.isVisible = false;
    this.quickLinks = null;
    this._escHandler = null;
  }

	  async show() {
    console.log('Showing dashboard...');

    // Initialize Quick Links if available
    if (window.QuickLinks && !this.quickLinks) {
      this.quickLinks = new QuickLinks(this.orchestrator);
      window.quickLinks = this.quickLinks; // Make available globally for onclick handlers
    }

    // Fetch quick links data - re-render when complete
    if (this.quickLinks) {
      this.quickLinks.fetchData().then(() => {
        // Re-render to show quick links once loaded
        if (this.isVisible) {
          this.render();
        }
      }).catch(() => {});
    }

    // Request workspaces from server (with refresh to reload from disk)
    this.orchestrator.socket.emit('list-workspaces', { refresh: true });

	    // Wait for workspace data
	    this.orchestrator.socket.once('workspaces-list', (workspaces) => {
	      console.log('Received workspaces:', workspaces);
	      this.workspaces = workspaces;
	      // Also update orchestrator's cached list
	      this.orchestrator.availableWorkspaces = workspaces;
	      try {
	        const withHealth = Array.isArray(workspaces) ? workspaces : [];
	        const noisy = withHealth.filter((w) => (w?.health && (w.health.removedTerminals?.length || w.health.dedupedTerminalIds?.length)));
	        if (noisy.length) {
	          const count = noisy.reduce((sum, w) => sum + Number(w.health?.removedTerminals?.length || 0), 0);
	          this.orchestrator.showToast?.(`Cleaned ${count} stale terminal entries from workspace configs`, 'info');
	        }
	      } catch {}
	      this.render();
	      this.isVisible = true;
	    });
	  }

  hide() {
    const dashboard = document.getElementById('dashboard-container');
    if (dashboard) {
      dashboard.classList.add('hidden');
    }
    this.isVisible = false;

    if (this._escHandler) {
      document.removeEventListener('keydown', this._escHandler);
      this._escHandler = null;
    }
  }

  render() {
    // Create dashboard container if it doesn't exist
    let dashboard = document.getElementById('dashboard-container');
    if (!dashboard) {
      dashboard = document.createElement('div');
      dashboard.id = 'dashboard-container';
      dashboard.className = 'dashboard-container';
      document.body.appendChild(dashboard);
    }

    // Hide main content while showing dashboard
    const mainContainer = document.querySelector('.main-container');
    const sidebar = document.querySelector('.sidebar');
    if (mainContainer) mainContainer.classList.add('hidden');
    if (sidebar) sidebar.classList.add('hidden');

    // Render dashboard content
    dashboard.innerHTML = this.generateDashboardHTML();
    dashboard.classList.remove('hidden');

    // Set up event listeners
    this.setupEventListeners();

    // Set up quick links drag and drop
    if (this.quickLinks) {
      this.quickLinks.setupDragAndDrop();
    }

    // Load ports for dashboard
    this.loadDashboardPorts();

    // Load process status/telemetry/advice summaries
    this.loadDashboardProcessSummary();
  }

  generateDashboardHTML() {
		    const activeWorkspaces = this.workspaces.filter(ws => this.isWorkspaceActive(ws));
		    const inactiveWorkspaces = this.workspaces.filter(ws => !this.isWorkspaceActive(ws));
		    const canReturnToWorkspaces = !!(this.orchestrator.tabManager?.tabs?.size);

			    return `
			      <div class="dashboard-topbar">
		        ${canReturnToWorkspaces ? `
		          <button class="dashboard-topbar-btn" id="dashboard-back-btn" title="Back to workspaces">← Back to Workspaces</button>
		        ` : `<div></div>`}
            <div id="dashboard-process-banner" class="process-banner" title="WIP and queue status (click to open Queue)"></div>
		      </div>
		      <div class="dashboard-header">
		        <h1>🎯 Agent Orchestrator Dashboard</h1>
		        <p>Select a workspace to begin development</p>
		      </div>

          <div class="dashboard-section">
            <h2>📊 Process</h2>
	            <div class="dashboard-summary-grid">
	              <div class="dashboard-summary-card">
	                <div class="dashboard-summary-title">Status</div>
	                <div id="dashboard-status-summary" class="dashboard-summary-body">Loading…</div>
	              </div>
		              <div class="dashboard-summary-card">
		                <div class="dashboard-summary-title">Telemetry</div>
		                <div id="dashboard-telemetry-summary" class="dashboard-summary-body">Loading…</div>
		                <div class="dashboard-summary-actions">
		                  <button class="dashboard-topbar-btn" id="dashboard-open-telemetry-details" title="View trends and histograms">📈 Details</button>
		                  <button class="dashboard-topbar-btn" id="dashboard-open-performance" title="Per-terminal resource usage">⚙ Perf</button>
                      <button class="dashboard-topbar-btn" id="dashboard-open-polecats" title="Manage sessions (restart/kill/logs)">🐾 Polecats</button>
                      <button class="dashboard-topbar-btn" id="dashboard-open-hooks" title="Hook browser (automations/webhooks)">🪝 Hooks</button>
                      <button class="dashboard-topbar-btn" id="dashboard-open-deacon" title="Deacon monitor (health dashboard)">🛡 Deacon</button>
		                  <button class="dashboard-topbar-btn" id="dashboard-open-tests" title="Run tests across worktrees">🧪 Tests</button>
		                  <button class="dashboard-topbar-btn" id="dashboard-export-telemetry" title="Download telemetry CSV export">⬇ Export</button>
		                  <button class="dashboard-topbar-btn" id="dashboard-export-telemetry-json" title="Download telemetry JSON export">⬇ JSON</button>
		                </div>
		              </div>
                <div class="dashboard-summary-card">
                  <div class="dashboard-summary-title">Polecats</div>
                  <div id="dashboard-polecats-summary" class="dashboard-summary-body">Loading…</div>
                  <div class="dashboard-summary-actions">
                    <button class="dashboard-topbar-btn" id="dashboard-open-polecats-card" title="Open Polecats panel">🐾 Manage</button>
                  </div>
                </div>
                <div class="dashboard-summary-card">
                  <div class="dashboard-summary-title">Discord</div>
                  <div id="dashboard-discord-summary" class="dashboard-summary-body">Loading…</div>
                  <div class="dashboard-summary-actions">
                    <button class="dashboard-topbar-btn" id="dashboard-discord-ensure" title="Create/ensure Services workspace + terminals">🧰 Ensure</button>
                    <button class="dashboard-topbar-btn" id="dashboard-discord-process" title="Trigger Discord queue processing">📥 Process</button>
                    <button class="dashboard-topbar-btn" id="dashboard-discord-open-services" title="Open Services workspace">↗ Services</button>
                  </div>
                </div>
	              <div class="dashboard-summary-card">
	                <div class="dashboard-summary-title">Projects</div>
	                <div id="dashboard-projects-summary" class="dashboard-summary-body">Loading…</div>
	                <div class="dashboard-summary-actions">
                  <button class="dashboard-topbar-btn" id="dashboard-open-prs" title="Open Pull Requests">🔀 PRs</button>
                  <button class="dashboard-topbar-btn" id="dashboard-open-project-health" title="Open per-project health dashboard">🩺 Health</button>
                </div>
              </div>
              <div class="dashboard-summary-card">
                <div class="dashboard-summary-title">Advice</div>
                <div id="dashboard-advice-summary" class="dashboard-summary-body">Loading…</div>
                <div class="dashboard-summary-actions">
                  <button class="dashboard-topbar-btn" id="dashboard-open-queue" title="Open Queue">📥 Queue</button>
                  <button class="dashboard-topbar-btn" id="dashboard-open-queue-viz" title="Work queue visualization">🧭 Viz</button>
                  <button class="dashboard-topbar-btn" id="dashboard-open-convoys" title="Convoy dashboard (by assignment)">🚚 Convoys</button>
                  <button class="dashboard-topbar-btn" id="dashboard-open-advice" title="Open Commander Advice">🧠 Advice</button>
                  <button class="dashboard-topbar-btn" id="dashboard-open-suggestions" title="Open workspace suggestions">✨ Suggestions</button>
                  <button class="dashboard-topbar-btn" id="dashboard-open-distribution" title="Suggested terminal per PR/task">🎯 Distribution</button>
                </div>
              </div>
              <div class="dashboard-summary-card">
                <div class="dashboard-summary-title">Readiness</div>
                <div id="dashboard-readiness-summary" class="dashboard-summary-body">Loading…</div>
                <div class="dashboard-summary-actions">
                  <button class="dashboard-topbar-btn" id="dashboard-open-readiness" title="Open project readiness checklists">✅ Checklists</button>
                </div>
              </div>
            </div>
          </div>

	      ${activeWorkspaces.length > 0 ? `
	        <div class="dashboard-section">
	          <h2>Active Workspaces</h2>
	          <div class="workspace-grid">
	            ${activeWorkspaces.map(ws => this.generateWorkspaceCard(ws, true)).join('')}
          </div>
        </div>
      ` : ''}

      <div class="dashboard-section">
        <h2>All Workspaces</h2>
        <div class="workspace-grid">
          ${inactiveWorkspaces.map(ws => this.generateWorkspaceCard(ws, false)).join('')}
          ${this.generateCreateWorkspaceCard()}
        </div>
      </div>

      <div class="dashboard-split-row">
        <div class="dashboard-section dashboard-half">
          <h2>🔗 Quick Links</h2>
          <div class="quick-links-grid">
            ${this.generateQuickLinksHTML()}
          </div>
        </div>

        <div class="dashboard-section dashboard-half ports-dashboard-section">
          <h2>🔌 Running Services</h2>
          <div class="ports-dashboard-grid" id="ports-dashboard-grid">
            <div class="ports-loading">Loading services...</div>
          </div>
        </div>
      </div>
    `;
	  }

	  async loadDashboardProcessSummary() {
	    const statusEl = document.getElementById('dashboard-status-summary');
	    const telemetryEl = document.getElementById('dashboard-telemetry-summary');
      const polecatsEl = document.getElementById('dashboard-polecats-summary');
      const discordEl = document.getElementById('dashboard-discord-summary');
	    const projectsEl = document.getElementById('dashboard-projects-summary');
	    const adviceEl = document.getElementById('dashboard-advice-summary');
	    const readinessEl = document.getElementById('dashboard-readiness-summary');

	    document.getElementById('dashboard-open-telemetry-details')?.addEventListener('click', (e) => {
	      e.preventDefault();
	      this.showTelemetryOverlay();
	    });
		    document.getElementById('dashboard-open-performance')?.addEventListener('click', (e) => {
		      e.preventDefault();
		      this.showPerformanceOverlay();
		    });
        document.getElementById('dashboard-open-polecats')?.addEventListener('click', (e) => {
          e.preventDefault();
          this.showPolecatOverlay().catch(() => {});
        });
        document.getElementById('dashboard-open-hooks')?.addEventListener('click', (e) => {
          e.preventDefault();
          this.showHooksOverlay().catch(() => {});
        });
        document.getElementById('dashboard-open-deacon')?.addEventListener('click', (e) => {
          e.preventDefault();
          this.showDeaconOverlay().catch(() => {});
        });
        document.getElementById('dashboard-open-polecats-card')?.addEventListener('click', (e) => {
          e.preventDefault();
          this.showPolecatOverlay().catch(() => {});
        });
        document.getElementById('dashboard-discord-ensure')?.addEventListener('click', async (e) => {
          e.preventDefault();
          await this.ensureDiscordServices();
          await this.loadDashboardDiscordSummary(discordEl);
        });
        document.getElementById('dashboard-discord-process')?.addEventListener('click', async (e) => {
          e.preventDefault();
          await this.processDiscordQueue();
          await this.loadDashboardDiscordSummary(discordEl);
        });
        document.getElementById('dashboard-discord-open-services')?.addEventListener('click', async (e) => {
          e.preventDefault();
          await this.openDiscordServicesWorkspace();
        });
		    document.getElementById('dashboard-open-tests')?.addEventListener('click', (e) => {
		      e.preventDefault();
		      try {
		        this.showTestOrchestrationOverlay();
		      } catch {}
		    });
			    document.getElementById('dashboard-export-telemetry')?.addEventListener('click', (e) => {
			      e.preventDefault();
			      const hours = Number(this._telemetrySummary?.lookbackHours ?? 24);
			      this.downloadTelemetryCsv(hours);
		    });
		    document.getElementById('dashboard-export-telemetry-json')?.addEventListener('click', (e) => {
		      e.preventDefault();
		      const hours = Number(this._telemetrySummary?.lookbackHours ?? 24);
		      this.downloadTelemetryJson(hours);
		    });
	    document.getElementById('dashboard-open-queue')?.addEventListener('click', (e) => {
	      e.preventDefault();
	      this.orchestrator?.showQueuePanel?.().catch?.(() => {});
	    });
    document.getElementById('dashboard-open-queue-viz')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.showQueueVizOverlay().catch(() => {});
    });
    document.getElementById('dashboard-open-convoys')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.showConvoysOverlay().catch(() => {});
    });
    document.getElementById('dashboard-open-prs')?.addEventListener('click', (e) => {
      e.preventDefault();
      try {
        this.orchestrator?.showPRsPanel?.();
      } catch {}
    });
    document.getElementById('dashboard-open-project-health')?.addEventListener('click', (e) => {
      e.preventDefault();
      try {
        this.showProjectHealthOverlay();
      } catch {}
    });
    document.getElementById('dashboard-open-advice')?.addEventListener('click', (e) => {
      e.preventDefault();
      try {
        this.orchestrator?.handleCommanderAction?.('open-advice', {});
      } catch {}
    });
    document.getElementById('dashboard-open-readiness')?.addEventListener('click', (e) => {
      e.preventDefault();
      try {
        this.showReadinessOverlay();
      } catch {}
    });
    document.getElementById('dashboard-open-suggestions')?.addEventListener('click', (e) => {
      e.preventDefault();
      try {
        this.showSuggestionsOverlay();
      } catch {}
    });
    document.getElementById('dashboard-open-distribution')?.addEventListener('click', (e) => {
      e.preventDefault();
      try {
        this.showDistributionOverlay();
      } catch {}
    });

    try {
      this.updatePolecatSummary(polecatsEl);
    } catch {
      // ignore
    }

    const escapeHtml = (value) => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const renderAdvice = async ({ force = false } = {}) => {
      if (!adviceEl) return;
      adviceEl.textContent = 'Loading…';

      let adviceRes = null;
      let data = {};
      try {
        const url = new URL('/api/process/advice', window.location.origin);
        url.searchParams.set('mode', 'mine');
        if (force) url.searchParams.set('force', 'true');
        adviceRes = await fetch(url.toString()).catch(() => null);
        data = adviceRes ? await adviceRes.json().catch(() => ({})) : {};
      } catch {
        adviceRes = null;
        data = {};
      }

      if (adviceRes && adviceRes.ok) {
        const items = Array.isArray(data?.advice) ? data.advice : [];
        const m = data?.metrics || {};
        const reviewsCompleted = Number(m?.reviewsCompleted ?? 0);
        const needsFix = Number(m?.reviewsNeedsFix ?? 0);
        const blockedPrs = Number(m?.prsBlockedByDeps ?? 0);
        const needsFixRate = Number.isFinite(Number(m?.needsFixRate)) ? Number(m.needsFixRate) : null;
        const metricsHtml = `
          <div style="display:grid; gap:4px; margin-bottom:8px; opacity:0.92;">
            <div>Blocked PRs <strong>${blockedPrs}</strong></div>
            <div>Reviews <strong>${reviewsCompleted}</strong> • needs_fix <strong>${needsFix}</strong>${needsFixRate === null ? '' : ` • rate <strong>${Math.round(needsFixRate * 100)}%</strong>`}</div>
          </div>
        `;
        if (!items.length) {
          adviceEl.innerHTML = metricsHtml + '<div style="opacity:0.8;">No advice right now.</div>';
        } else {
          adviceEl.innerHTML = `
            ${metricsHtml}
            <ul style="margin:0;padding-left:18px;">
              ${items.slice(0, 3).map((a) => `<li><strong>${escapeHtml(a.title || '')}</strong> — ${escapeHtml(a.message || '')}</li>`).join('')}
            </ul>
          `;
        }
        return;
      }

      const statusText = adviceRes
        ? `HTTP ${Number(adviceRes.status || 0)}`
        : 'Network error';
      const errorText = String(data?.error || '').trim();
      adviceEl.innerHTML = `
        <div style="opacity:0.9;">Failed to load advice.</div>
        <div style="opacity:0.7; font-size:0.85rem; margin-top:4px;">${escapeHtml(statusText)}${errorText ? ` • ${escapeHtml(errorText)}` : ''}</div>
        <div style="margin-top:10px;">
          <button class="dashboard-topbar-btn" type="button" id="dashboard-advice-retry">↻ Retry</button>
        </div>
      `;
      adviceEl.querySelector('#dashboard-advice-retry')?.addEventListener('click', () => {
        renderAdvice({ force: true });
      });
    };

    try {
      const [statusRes, telemetryRes, projectsRes, readinessRes] = await Promise.all([
        fetch('/api/process/status?mode=mine').catch(() => null),
        fetch('/api/process/telemetry').catch(() => null),
        fetch('/api/process/projects?mode=mine').catch(() => null),
        fetch('/api/process/readiness/templates').catch(() => null)
      ]);

      if (statusEl) {
        const data = statusRes ? await statusRes.json().catch(() => ({})) : {};
        if (statusRes && statusRes.ok) {
          const q = data?.qByTier || {};
          statusEl.innerHTML = `
            <div>WIP <strong>${Number(data?.wip ?? 0)}</strong> (${escapeHtml(data?.wipKind || 'workspaces')})</div>
            <div>T1 ${Number(q[1] ?? 0)} • T2 ${Number(q[2] ?? 0)} • T3 ${Number(q[3] ?? 0)} • T4 ${Number(q[4] ?? 0)}</div>
            <div>Level <strong>${escapeHtml(data?.level || 'ok')}</strong></div>
          `;
        } else {
          statusEl.textContent = 'Failed to load.';
        }
      }

	      if (telemetryEl) {
	        const data = telemetryRes ? await telemetryRes.json().catch(() => ({})) : {};
		        if (telemetryRes && telemetryRes.ok) {
		          this._telemetrySummary = data;
		          const avgReview = data?.avgReviewSeconds ? `${Math.round(Number(data.avgReviewSeconds))}s` : '—';
		          const avgChars = Number.isFinite(Number(data?.avgPromptChars)) ? Math.round(Number(data.avgPromptChars)) : null;
		          const createdCount = Number(data?.createdCount ?? 0);
		          const doneCount = Number(data?.doneCount ?? 0);
		          const avgVerify = Number.isFinite(Number(data?.avgVerifyMinutes)) ? Math.round(Number(data.avgVerifyMinutes)) : null;
		          const oc = (data?.outcomeCounts && typeof data.outcomeCounts === 'object') ? data.outcomeCounts : {};
		          const needsFix = Number(oc?.needs_fix ?? 0);
		          telemetryEl.innerHTML = `
		            <div>Lookback <strong>${Number(data?.lookbackHours ?? 24)}h</strong></div>
		            <div>Avg review <strong>${escapeHtml(avgReview)}</strong></div>
		            <div>Avg prompt chars <strong>${avgChars === null ? '—' : avgChars}</strong></div>
		            <div>Created <strong>${createdCount}</strong> • Done <strong>${doneCount}</strong> • needs_fix <strong>${needsFix}</strong></div>
		            <div>Avg verify <strong>${avgVerify === null ? '—' : `${avgVerify}m`}</strong></div>
		          `;
		        } else {
		          telemetryEl.textContent = 'Failed to load.';
		        }
	      }

      if (projectsEl) {
        const data = projectsRes ? await projectsRes.json().catch(() => ({})) : {};
        if (projectsRes && projectsRes.ok) {
          const totals = data?.totals || {};
          const repos = Array.isArray(data?.repos) ? data.repos : [];
          const top = repos.slice(0, 6);

          const pickWorstRisk = (counts) => {
            const c = counts && typeof counts === 'object' ? counts : {};
            if (Number(c.critical || 0) > 0) return 'critical';
            if (Number(c.high || 0) > 0) return 'high';
            if (Number(c.medium || 0) > 0) return 'medium';
            if (Number(c.low || 0) > 0) return 'low';
            return '';
          };

          const riskChip = (risk) => {
            const r = String(risk || '').trim().toLowerCase();
            if (!r) return '';
            const cls = (r === 'critical' || r === 'high') ? 'level-warn' : '';
            return `<span class="process-chip ${cls}">${escapeHtml(r)}</span>`;
          };

          projectsEl.innerHTML = `
            <div>Repos <strong>${Number(totals?.repos ?? top.length ?? 0)}</strong> • Open PRs <strong>${Number(totals?.prsOpen ?? 0)}</strong></div>
            <div>Unreviewed <strong>${Number(totals?.prsUnreviewed ?? 0)}</strong> • Needs fix <strong>${Number(totals?.prsNeedsFix ?? 0)}</strong></div>
            <div style="margin-top:8px; display:flex; flex-direction:column; gap:6px;">
              ${top.length ? top.map((r) => {
                const repo = String(r?.repo || '').trim();
                const open = Number(r?.prsOpen ?? 0);
                const unrev = Number(r?.prsUnreviewed ?? 0);
                const avgReview = r?.telemetry?.avgReviewSeconds ? `${Math.round(Number(r.telemetry.avgReviewSeconds))}s` : '—';
                const worstRisk = pickWorstRisk(r?.riskCounts);
                return `
                  <button class="btn-secondary" type="button" data-open-repo="${escapeHtml(repo)}" title="Open PRs filtered to ${escapeHtml(repo)}" style="width:100%; display:flex; justify-content:space-between; align-items:center; gap:10px;">
                    <span style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(repo)} (${open} open, ${unrev} unrev)</span>
                    <span style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
                      ${worstRisk ? riskChip(worstRisk) : ''}
                      <span style="opacity:0.8;">${escapeHtml(avgReview)}</span>
                    </span>
                  </button>
                `;
              }).join('') : `<div style="opacity:0.8;">No PRs found.</div>`}
            </div>
          `;

          projectsEl.querySelectorAll('[data-open-repo]').forEach((btn) => {
            btn.addEventListener('click', () => {
              const repo = btn.getAttribute('data-open-repo') || '';
              if (!repo) return;
              try {
                localStorage.setItem('prs-panel-repo', repo);
              } catch {}
              try {
                this.orchestrator?.showPRsPanel?.();
              } catch {}
            });
          });
        } else {
          projectsEl.textContent = 'Failed to load.';
        }
      }

      if (readinessEl) {
        const data = readinessRes ? await readinessRes.json().catch(() => ({})) : {};
        if (readinessRes && readinessRes.ok) {
          const templates = Array.isArray(data?.templates) ? data.templates : [];
          const titles = templates.map(t => String(t?.title || '').trim()).filter(Boolean);
          readinessEl.innerHTML = `
            <div>Templates <strong>${templates.length}</strong></div>
            <div style="opacity:0.9;">${escapeHtml(titles.slice(0, 5).join(' • ') || '—')}</div>
          `;
        } else {
          readinessEl.textContent = 'Failed to load.';
        }
      }

      await this.loadDashboardDiscordSummary(discordEl);
      await renderAdvice({ force: false });
		    } catch (error) {
		      if (statusEl) statusEl.textContent = 'Failed to load.';
		      if (telemetryEl) telemetryEl.textContent = 'Failed to load.';
		      if (projectsEl) projectsEl.textContent = 'Failed to load.';
		      if (readinessEl) readinessEl.textContent = 'Failed to load.';
          if (discordEl) discordEl.textContent = 'Failed to load.';
		      await renderAdvice({ force: false });
		    }
		  }

      async ensureDiscordServices() {
        try {
          const res = await fetch('/api/discord/ensure-services', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          }).catch(() => null);
          if (!res || !res.ok) {
            this.orchestrator?.showTemporaryMessage?.('Failed to ensure Discord services', 'error');
            return null;
          }
          const data = await res.json().catch(() => ({}));
          this.orchestrator?.showTemporaryMessage?.('Discord services ensured', 'success');
          return data;
        } catch {
          this.orchestrator?.showTemporaryMessage?.('Failed to ensure Discord services', 'error');
          return null;
        }
      }

      async processDiscordQueue() {
        try {
          const res = await fetch('/api/discord/process-queue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          }).catch(() => null);
          const data = res ? await res.json().catch(() => ({})) : {};
          if (!res || !res.ok || data.ok === false) {
            this.orchestrator?.showTemporaryMessage?.(data?.message || 'Failed to process Discord queue', 'error');
            return null;
          }
          this.orchestrator?.showTemporaryMessage?.('Discord queue processing triggered', 'success');
          return data;
        } catch {
          this.orchestrator?.showTemporaryMessage?.('Failed to process Discord queue', 'error');
          return null;
        }
      }

      async openDiscordServicesWorkspace() {
        const status = await this.ensureDiscordServices();
        const workspaceId = status?.servicesWorkspaceId || 'services';
        return this.openWorkspace(workspaceId);
      }

      async loadDashboardDiscordSummary(el) {
        if (!el) return;
        el.textContent = 'Loading…';
        try {
          const res = await fetch('/api/discord/status').catch(() => null);
          const data = res ? await res.json().catch(() => ({})) : {};
          if (!res || !res.ok || data.ok === false) {
            el.textContent = 'Unavailable.';
            return;
          }

          const pending = Number(data?.queue?.pendingCount || 0);
          const pendingAt = data?.queue?.pendingUpdatedAt ? new Date(data.queue.pendingUpdatedAt).toLocaleString() : '—';
          const bot = data?.sessions?.botRunning ? 'running' : 'stopped';
          const proc = data?.sessions?.processorRunning ? 'running' : 'stopped';
          const ws = data?.workspace?.exists ? 'ok' : 'missing';

          el.innerHTML = `
            <div>Services workspace: <strong>${ws}</strong></div>
            <div>Bot: <strong>${bot}</strong> • Processor: <strong>${proc}</strong></div>
            <div>Queue: <strong>${pending}</strong> pending</div>
            <div style="opacity:0.75;">updated: ${pendingAt}</div>
          `;
        } catch {
          el.textContent = 'Unavailable.';
        }
      }

    updatePolecatSummary(targetEl = null) {
      const el = targetEl || document.getElementById('dashboard-polecats-summary');
      if (!el) return;

      const sessionsMap = this.orchestrator?.sessions;
      const sessions = sessionsMap && typeof sessionsMap.values === 'function'
        ? Array.from(sessionsMap.values())
        : [];

      if (!sessions.length) {
        el.textContent = 'No sessions.';
        return;
      }

      const byType = { claude: 0, codex: 0, server: 0, other: 0 };
      const byStatus = {};

      for (const s of sessions) {
        const type = String(s?.type || '').trim().toLowerCase();
        if (type === 'claude') byType.claude += 1;
        else if (type === 'codex') byType.codex += 1;
        else if (type === 'server') byType.server += 1;
        else byType.other += 1;

        const status = String(s?.status || 'idle').trim().toLowerCase() || 'idle';
        byStatus[status] = (byStatus[status] || 0) + 1;
      }

      const total = sessions.length;
      const busy = byStatus.busy || 0;
      const waiting = byStatus.waiting || 0;
      const idle = byStatus.idle || 0;
      const otherStatuses = Object.entries(byStatus)
        .filter(([k]) => k !== 'busy' && k !== 'waiting' && k !== 'idle')
        .sort((a, b) => (b[1] || 0) - (a[1] || 0))
        .map(([k, v]) => `${k}:${v}`)
        .slice(0, 4)
        .join(' • ');

      el.innerHTML = `
        <div>Total <strong>${total}</strong></div>
        <div style="opacity:0.85; margin-top:4px;">
          Types: claude ${byType.claude} • codex ${byType.codex} • server ${byType.server}${byType.other ? ` • other ${byType.other}` : ''}
        </div>
        <div style="opacity:0.85; margin-top:4px;">
          Status: busy ${busy} • waiting ${waiting} • idle ${idle}${otherStatuses ? ` • ${otherStatuses}` : ''}
        </div>
      `;
    }

	  downloadTelemetryCsv(lookbackHours) {
	    const hours = Number(lookbackHours);
	    const safe = Number.isFinite(hours) && hours > 0 ? hours : 24;
	    const url = `/api/process/telemetry/export?format=csv&lookbackHours=${encodeURIComponent(String(safe))}`;
	    try {
	      const a = document.createElement('a');
	      a.href = url;
	      a.target = '_blank';
	      a.rel = 'noopener';
	      a.click();
	    } catch {
	      window.open(url, '_blank', 'noopener');
	    }
	  }

	  downloadTelemetryJson(lookbackHours) {
	    const hours = Number(lookbackHours);
	    const safe = Number.isFinite(hours) && hours > 0 ? hours : 24;
	    const url = `/api/process/telemetry/export?format=json&lookbackHours=${encodeURIComponent(String(safe))}`;
	    try {
	      const a = document.createElement('a');
	      a.href = url;
	      a.target = '_blank';
	      a.rel = 'noopener';
	      a.click();
	    } catch {
	      window.open(url, '_blank', 'noopener');
	    }
	  }

	  showTelemetryOverlay() {
	    const existing = document.getElementById('dashboard-telemetry-overlay');
	    if (existing) {
	      existing.classList.remove('hidden');
	      return;
	    }

	    const overlay = document.createElement('div');
	    overlay.id = 'dashboard-telemetry-overlay';
	    overlay.className = 'dashboard-telemetry-overlay';
	    overlay.innerHTML = `
	      <div class="dashboard-telemetry-panel" role="dialog" aria-label="Telemetry details">
	        <div class="dashboard-telemetry-header">
	          <div class="dashboard-telemetry-title">Telemetry — Trends & Export</div>
	          <button class="dashboard-topbar-btn" id="dashboard-telemetry-close" title="Close (Esc)">✕</button>
	        </div>
	        <div class="dashboard-telemetry-controls">
	          <label class="dashboard-telemetry-field">
	            <span>Lookback</span>
	            <select id="dashboard-telemetry-lookback">
	              <option value="24">24h</option>
	              <option value="72">72h</option>
	              <option value="168">7d</option>
	              <option value="336">14d</option>
	            </select>
	          </label>
	          <label class="dashboard-telemetry-field">
	            <span>Bucket</span>
	            <select id="dashboard-telemetry-bucket">
	              <option value="15">15m</option>
	              <option value="30">30m</option>
	              <option value="60" selected>1h</option>
	              <option value="120">2h</option>
	              <option value="240">4h</option>
	            </select>
	          </label>
		          <div class="dashboard-telemetry-actions">
		            <button class="btn-secondary" type="button" id="dashboard-telemetry-refresh">Refresh</button>
		            <button class="btn-secondary" type="button" id="dashboard-telemetry-download">Download CSV</button>
		            <button class="btn-secondary" type="button" id="dashboard-telemetry-download-json">Download JSON</button>
		            <button class="btn-secondary" type="button" id="dashboard-telemetry-snapshot" title="Create a snapshot link for this telemetry view">Copy snapshot link</button>
		          </div>
		        </div>
		        <div id="dashboard-telemetry-body" class="dashboard-telemetry-body">Loading…</div>
		      </div>
		    `;

	    document.body.appendChild(overlay);

	    const close = () => this.hideTelemetryOverlay();
	    overlay.addEventListener('click', (e) => {
	      if (e.target === overlay) close();
	    });
	    overlay.querySelector('#dashboard-telemetry-close')?.addEventListener('click', close);

	    const lookbackEl = overlay.querySelector('#dashboard-telemetry-lookback');
	    const bucketEl = overlay.querySelector('#dashboard-telemetry-bucket');
	    const initialHours = Number(this._telemetrySummary?.lookbackHours ?? 24);
	    const maybeOption = overlay.querySelector(`#dashboard-telemetry-lookback option[value="${initialHours}"]`);
	    if (maybeOption) lookbackEl.value = String(initialHours);

	    overlay.querySelector('#dashboard-telemetry-download')?.addEventListener('click', () => {
	      const hours = Number(lookbackEl?.value ?? 24);
	      this.downloadTelemetryCsv(hours);
	    });
		    overlay.querySelector('#dashboard-telemetry-download-json')?.addEventListener('click', () => {
		      const hours = Number(lookbackEl?.value ?? 24);
		      this.downloadTelemetryJson(hours);
		    });
		    overlay.querySelector('#dashboard-telemetry-snapshot')?.addEventListener('click', async () => {
		      const hours = Number(lookbackEl?.value ?? 24);
		      const bucket = Number(bucketEl?.value ?? 60);
		      await this.createTelemetrySnapshotLink({ lookbackHours: hours, bucketMinutes: bucket });
		    });
		    overlay.querySelector('#dashboard-telemetry-refresh')?.addEventListener('click', () => {
		      this.loadTelemetryDetails({ lookbackHours: Number(lookbackEl?.value ?? 24), bucketMinutes: Number(bucketEl?.value ?? 60) });
		    });

	    const onKey = (e) => {
	      if (e.key !== 'Escape') return;
	      const el = document.getElementById('dashboard-telemetry-overlay');
	      if (!el || el.classList.contains('hidden')) return;
	      close();
	    };
	    overlay._escHandler = onKey;
	    document.addEventListener('keydown', onKey);

	    this.loadTelemetryDetails({ lookbackHours: Number(lookbackEl?.value ?? 24), bucketMinutes: Number(bucketEl?.value ?? 60) });
	  }

	  hideTelemetryOverlay() {
	    const overlay = document.getElementById('dashboard-telemetry-overlay');
	    if (!overlay) return;
	    overlay.classList.add('hidden');
	    const handler = overlay._escHandler;
	    if (handler) {
	      document.removeEventListener('keydown', handler);
	      overlay._escHandler = null;
	    }
	    overlay.remove();
	  }

	  async showPerformanceOverlay() {
	    const existing = document.getElementById('dashboard-performance-overlay');
	    if (existing) {
	      existing.classList.remove('hidden');
	      return;
	    }

	    const overlay = document.createElement('div');
	    overlay.id = 'dashboard-performance-overlay';
	    overlay.className = 'dashboard-telemetry-overlay';
	    overlay.innerHTML = `
	      <div class="dashboard-telemetry-panel" role="dialog" aria-label="Performance metrics">
	        <div class="dashboard-telemetry-header">
	          <div class="dashboard-telemetry-title">Performance — Sessions</div>
	          <button class="dashboard-topbar-btn" id="dashboard-performance-close" title="Close (Esc)">✕</button>
	        </div>
	        <div class="dashboard-telemetry-controls">
	          <div class="dashboard-telemetry-actions">
	            <button class="btn-secondary" type="button" id="dashboard-performance-refresh">Refresh</button>
	          </div>
	        </div>
	        <div id="dashboard-performance-body" class="dashboard-telemetry-body">Loading…</div>
	      </div>
	    `;

	    document.body.appendChild(overlay);

	    const close = () => this.hidePerformanceOverlay();
	    overlay.addEventListener('click', (e) => {
	      if (e.target === overlay) close();
	    });
	    overlay.querySelector('#dashboard-performance-close')?.addEventListener('click', close);

	    const onKey = (e) => {
	      if (e.key !== 'Escape') return;
	      const el = document.getElementById('dashboard-performance-overlay');
	      if (!el || el.classList.contains('hidden')) return;
	      close();
	    };
	    overlay._escHandler = onKey;
	    document.addEventListener('keydown', onKey);

	    overlay.querySelector('#dashboard-performance-refresh')?.addEventListener('click', () => {
	      this.loadPerformanceDetails();
	    });

	    await this.loadPerformanceDetails();
	  }

    async showQueueVizOverlay() {
      const existing = document.getElementById('dashboard-queue-viz-overlay');
      if (existing) {
        existing.classList.remove('hidden');
        return;
      }

      const overlay = document.createElement('div');
      overlay.id = 'dashboard-queue-viz-overlay';
      overlay.className = 'dashboard-telemetry-overlay';
      overlay.innerHTML = `
        <div class="dashboard-telemetry-panel" role="dialog" aria-label="Work queue visualization">
          <div class="dashboard-telemetry-header">
            <div class="dashboard-telemetry-title">Queue — Visualization</div>
            <button class="dashboard-topbar-btn" id="dashboard-queue-viz-close" title="Close (Esc)">✕</button>
          </div>
          <div class="dashboard-telemetry-controls">
            <div class="dashboard-telemetry-actions">
              <button class="btn-secondary" type="button" id="dashboard-queue-viz-open-queue">📥 Open Queue</button>
              <button class="btn-secondary" type="button" id="dashboard-queue-viz-refresh">Refresh</button>
            </div>
          </div>
          <div id="dashboard-queue-viz-body" class="dashboard-telemetry-body">Loading…</div>
        </div>
      `;

      document.body.appendChild(overlay);

      const close = () => this.hideQueueVizOverlay();
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
      });
      overlay.querySelector('#dashboard-queue-viz-close')?.addEventListener('click', close);
      overlay.querySelector('#dashboard-queue-viz-open-queue')?.addEventListener('click', () => {
        close();
        this.orchestrator?.showQueuePanel?.().catch?.(() => {});
      });
      overlay.querySelector('#dashboard-queue-viz-refresh')?.addEventListener('click', () => {
        this.loadQueueVizDetails().catch(() => {});
      });

      const onKey = (e) => {
        if (e.key !== 'Escape') return;
        const el = document.getElementById('dashboard-queue-viz-overlay');
        if (!el || el.classList.contains('hidden')) return;
        close();
      };
      overlay._escHandler = onKey;
      document.addEventListener('keydown', onKey);

      await this.loadQueueVizDetails();
    }

    hideQueueVizOverlay() {
      const overlay = document.getElementById('dashboard-queue-viz-overlay');
      if (!overlay) return;
      overlay.classList.add('hidden');
      const handler = overlay._escHandler;
      if (handler) {
        document.removeEventListener('keydown', handler);
        overlay._escHandler = null;
      }
      overlay.remove();
    }

    async loadQueueVizDetails() {
      const bodyEl = document.getElementById('dashboard-queue-viz-body');
      if (bodyEl) bodyEl.textContent = 'Loading…';

      let data = null;
      try {
        const url = new URL('/api/process/tasks', window.location.origin);
        url.searchParams.set('mode', 'all');
        url.searchParams.set('state', 'open');
        url.searchParams.set('include', 'dependencySummary');
        const res = await fetch(url.toString());
        data = res && res.ok ? await res.json().catch(() => null) : null;
      } catch {
        data = null;
      }

      if (!bodyEl) return;
      const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
      if (!data || !tasks) {
        bodyEl.textContent = 'Failed to load.';
        return;
      }

      const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      const tierKey = (t) => {
        const tier = t?.record?.tier;
        const n = Number(tier);
        return (Number.isFinite(n) && n >= 1 && n <= 4) ? `T${n}` : 'None';
      };

      const counts = { T1: 0, T2: 0, T3: 0, T4: 0, None: 0 };
      const unclaimed = { T1: 0, T2: 0, T3: 0, T4: 0, None: 0 };
      const unassigned = { T1: 0, T2: 0, T3: 0, T4: 0, None: 0 };
      const byAssignee = {};

      for (const t of tasks) {
        const k = tierKey(t);
        counts[k] = (counts[k] || 0) + 1;
        const claimedBy = String(t?.record?.claimedBy || '').trim();
        const assignedTo = String(t?.record?.assignedTo || '').trim();
        if (!claimedBy) unclaimed[k] = (unclaimed[k] || 0) + 1;
        if (!assignedTo) unassigned[k] = (unassigned[k] || 0) + 1;

        const bucket = assignedTo || '(unassigned)';
        if (!byAssignee[bucket]) byAssignee[bucket] = { T1: 0, T2: 0, T3: 0, T4: 0, None: 0, total: 0 };
        byAssignee[bucket][k] = (byAssignee[bucket][k] || 0) + 1;
        byAssignee[bucket].total += 1;
      }

      const assignees = Object.entries(byAssignee)
        .sort((a, b) => (b[1].total || 0) - (a[1].total || 0) || String(a[0]).localeCompare(String(b[0])));

      const rows = assignees.map(([who, c]) => {
        return `
          <tr>
            <td class="mono">${escapeHtml(who)}</td>
            <td class="mono">${escapeHtml(c.T1 || 0)}</td>
            <td class="mono">${escapeHtml(c.T2 || 0)}</td>
            <td class="mono">${escapeHtml(c.T3 || 0)}</td>
            <td class="mono">${escapeHtml(c.T4 || 0)}</td>
            <td class="mono">${escapeHtml(c.None || 0)}</td>
            <td class="mono">${escapeHtml(c.total || 0)}</td>
          </tr>
        `;
      }).join('');

      const sumRow = `
        <tr>
          <td class="mono"><strong>Total</strong></td>
          <td class="mono"><strong>${escapeHtml(counts.T1)}</strong></td>
          <td class="mono"><strong>${escapeHtml(counts.T2)}</strong></td>
          <td class="mono"><strong>${escapeHtml(counts.T3)}</strong></td>
          <td class="mono"><strong>${escapeHtml(counts.T4)}</strong></td>
          <td class="mono"><strong>${escapeHtml(counts.None)}</strong></td>
          <td class="mono"><strong>${escapeHtml(tasks.length)}</strong></td>
        </tr>
      `;

      bodyEl.innerHTML = `
        <div class="dashboard-telemetry-muted">
          Items: <strong>${escapeHtml(tasks.length)}</strong> • Unclaimed: <strong>${escapeHtml(Object.values(unclaimed).reduce((a, b) => a + (b || 0), 0))}</strong> • Unassigned: <strong>${escapeHtml(Object.values(unassigned).reduce((a, b) => a + (b || 0), 0))}</strong>
        </div>
        <div style="margin-top:10px; display:flex; flex-wrap:wrap; gap:8px;">
          <span class="pr-badge" title="Total items per tier">T1 ${escapeHtml(counts.T1)}</span>
          <span class="pr-badge">T2 ${escapeHtml(counts.T2)}</span>
          <span class="pr-badge">T3 ${escapeHtml(counts.T3)}</span>
          <span class="pr-badge">T4 ${escapeHtml(counts.T4)}</span>
          <span class="pr-badge">None ${escapeHtml(counts.None)}</span>
          <span class="pr-badge" title="Unclaimed items per tier">Unclaimed T1 ${escapeHtml(unclaimed.T1)} • T2 ${escapeHtml(unclaimed.T2)} • T3 ${escapeHtml(unclaimed.T3)} • T4 ${escapeHtml(unclaimed.T4)} • None ${escapeHtml(unclaimed.None)}</span>
          <span class="pr-badge" title="Unassigned items per tier">Unassigned T1 ${escapeHtml(unassigned.T1)} • T2 ${escapeHtml(unassigned.T2)} • T3 ${escapeHtml(unassigned.T3)} • T4 ${escapeHtml(unassigned.T4)} • None ${escapeHtml(unassigned.None)}</span>
        </div>

        <table class="worktree-inspector-table" style="margin-top:12px;">
          <thead>
            <tr>
              <th>Assigned to</th>
              <th>T1</th>
              <th>T2</th>
              <th>T3</th>
              <th>T4</th>
              <th>None</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${rows || `<tr><td colspan="7" style="opacity:0.8;">No items.</td></tr>`}
            ${sumRow}
          </tbody>
        </table>
      `;
	  }

    async showPolecatOverlay() {
      const existing = document.getElementById('dashboard-polecats-overlay');
      if (existing) {
        existing.classList.remove('hidden');
        return;
      }

      const overlay = document.createElement('div');
      overlay.id = 'dashboard-polecats-overlay';
      overlay.className = 'dashboard-telemetry-overlay';
      overlay.innerHTML = `
        <div class="dashboard-telemetry-panel" role="dialog" aria-label="Polecat management">
          <div class="dashboard-telemetry-header">
            <div class="dashboard-telemetry-title">Polecats — Sessions</div>
            <button class="dashboard-topbar-btn" id="dashboard-polecats-close" title="Close (Esc)">✕</button>
          </div>
          <div class="dashboard-telemetry-controls">
            <div class="dashboard-telemetry-actions">
              <button class="btn-secondary" type="button" id="dashboard-polecats-refresh">Refresh</button>
            </div>
          </div>
          <div id="dashboard-polecats-body" class="dashboard-telemetry-body">Loading…</div>
        </div>
      `;

      document.body.appendChild(overlay);

      const close = () => this.hidePolecatOverlay();
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
      });
      overlay.querySelector('#dashboard-polecats-close')?.addEventListener('click', close);
      overlay.querySelector('#dashboard-polecats-refresh')?.addEventListener('click', () => {
        this.loadPolecatDetails().catch(() => {});
      });

      const onKey = (e) => {
        if (e.key !== 'Escape') return;
        const el = document.getElementById('dashboard-polecats-overlay');
        if (!el || el.classList.contains('hidden')) return;
        close();
      };
      overlay._escHandler = onKey;
      document.addEventListener('keydown', onKey);

      await this.loadPolecatDetails();
    }

    hidePolecatOverlay() {
      const overlay = document.getElementById('dashboard-polecats-overlay');
      if (!overlay) return;
      overlay.classList.add('hidden');
      const handler = overlay._escHandler;
      if (handler) {
        document.removeEventListener('keydown', handler);
        overlay._escHandler = null;
      }
      overlay.remove();
    }

    async loadPolecatDetails() {
      const bodyEl = document.getElementById('dashboard-polecats-body');
      if (!bodyEl) return;

      const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      const sessions = Array.from(this.orchestrator?.sessions?.entries?.() || []);
      sessions.sort((a, b) => String(a[0]).localeCompare(String(b[0])));

      if (!sessions.length) {
        bodyEl.textContent = 'No sessions.';
        return;
      }

      const state = {
        selected: sessions[0]?.[0] || ''
      };

      const render = async () => {
        const selected = state.selected;
        const selectedSession = this.orchestrator?.sessions?.get?.(selected) || null;
        const selectedTitle = selectedSession ? `${selected} (${selectedSession.type || ''})` : selected;

        const rows = sessions.map(([id, s]) => {
          const status = escapeHtml(s?.status || 'idle');
          const branch = escapeHtml(s?.branch || '');
          const type = escapeHtml(s?.type || '');
          const worktreeId = escapeHtml(s?.worktreeId || '');
          const repo = escapeHtml(s?.repositoryName || '');
          const label = repo ? `${repo}/${worktreeId || ''}` : (worktreeId || '');
          const isSel = id === selected;
          return `
            <tr data-polecat-session="${escapeHtml(id)}" style="${isSel ? 'background: rgba(255,255,255,0.04);' : ''}">
              <td class="mono">${escapeHtml(id)}</td>
              <td>${escapeHtml(label)}</td>
              <td>${type}</td>
              <td>${status}</td>
              <td class="mono">${branch}</td>
              <td style="white-space:nowrap;">
                <button class="btn-secondary" type="button" data-polecat-restart="${escapeHtml(id)}" title="Restart session">↻</button>
                <button class="btn-secondary" type="button" data-polecat-kill="${escapeHtml(id)}" title="Kill/close session">✕</button>
              </td>
            </tr>
          `;
        }).join('');

        bodyEl.innerHTML = `
          <div style="display:flex; gap:12px; align-items:stretch; min-height: 50vh;">
            <div style="flex: 0 0 min(720px, 58vw); min-width: 320px; overflow:auto;">
              <table class="worktree-inspector-table">
                <thead>
                  <tr>
                    <th>Session</th>
                    <th>Worktree</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Branch</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows}
                </tbody>
              </table>
            </div>
            <div style="flex:1; min-width: 260px; display:flex; flex-direction:column;">
              <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:8px;">
                <div class="mono" style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(selectedTitle)}</div>
                <button class="btn-secondary" type="button" id="dashboard-polecats-log-refresh" ${selected ? '' : 'disabled'}>Refresh log</button>
              </div>
              <pre id="dashboard-polecats-log" style="flex:1; margin:0; padding:10px; border-radius:8px; border:1px solid var(--border-color); background: rgba(0,0,0,0.25); overflow:auto; white-space:pre-wrap; word-break:break-word;">Loading…</pre>
            </div>
          </div>
        `;

        const loadLog = async () => {
          const pre = bodyEl.querySelector('#dashboard-polecats-log');
          if (!pre) return;
          if (!selected) {
            pre.textContent = 'No session selected.';
            return;
          }
          pre.textContent = 'Loading…';
          try {
            const res = await fetch(`/api/sessions/${encodeURIComponent(selected)}/log?tailChars=20000`);
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to load log');
            pre.textContent = String(data.log || '');
          } catch (err) {
            pre.textContent = `Failed to load: ${String(err?.message || err)}`;
          }
        };

        await loadLog();

        bodyEl.querySelector('#dashboard-polecats-log-refresh')?.addEventListener('click', (e) => {
          e.preventDefault();
          loadLog().catch(() => {});
        });

        bodyEl.querySelectorAll('[data-polecat-session]').forEach((row) => {
          row.addEventListener('click', () => {
            const id = row.getAttribute('data-polecat-session');
            if (!id) return;
            state.selected = id;
            render().catch(() => {});
          });
        });

        bodyEl.querySelectorAll('button[data-polecat-restart]').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const id = btn.getAttribute('data-polecat-restart');
            if (!id) return;
            this.orchestrator?.socket?.emit?.('restart-session', { sessionId: id });
          });
        });
        bodyEl.querySelectorAll('button[data-polecat-kill]').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const id = btn.getAttribute('data-polecat-kill');
            if (!id) return;
            this.orchestrator?.socket?.emit?.('destroy-session', { sessionId: id });
          });
        });
      };

      await render();
    }

    async showConvoysOverlay() {
      const existing = document.getElementById('dashboard-convoys-overlay');
      if (existing) {
        existing.classList.remove('hidden');
        return;
      }

      const overlay = document.createElement('div');
      overlay.id = 'dashboard-convoys-overlay';
      overlay.className = 'dashboard-telemetry-overlay';
      overlay.innerHTML = `
        <div class="dashboard-telemetry-panel" role="dialog" aria-label="Convoy dashboard">
          <div class="dashboard-telemetry-header">
            <div class="dashboard-telemetry-title">Convoys — by assignment</div>
            <button class="dashboard-topbar-btn" id="dashboard-convoys-close" title="Close (Esc)">✕</button>
          </div>
          <div class="dashboard-telemetry-controls">
            <div class="dashboard-telemetry-actions">
              <button class="btn-secondary" type="button" id="dashboard-convoys-refresh">Refresh</button>
            </div>
          </div>
          <div id="dashboard-convoys-body" class="dashboard-telemetry-body">Loading…</div>
        </div>
      `;

      document.body.appendChild(overlay);

      const close = () => this.hideConvoysOverlay();
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
      });
      overlay.querySelector('#dashboard-convoys-close')?.addEventListener('click', close);
      overlay.querySelector('#dashboard-convoys-refresh')?.addEventListener('click', () => {
        this.loadConvoysDetails().catch(() => {});
      });

      const onKey = (e) => {
        if (e.key !== 'Escape') return;
        const el = document.getElementById('dashboard-convoys-overlay');
        if (!el || el.classList.contains('hidden')) return;
        close();
      };
      overlay._escHandler = onKey;
      document.addEventListener('keydown', onKey);

      await this.loadConvoysDetails();
    }

    hideConvoysOverlay() {
      const overlay = document.getElementById('dashboard-convoys-overlay');
      if (!overlay) return;
      overlay.classList.add('hidden');
      const handler = overlay._escHandler;
      if (handler) {
        document.removeEventListener('keydown', handler);
        overlay._escHandler = null;
      }
      overlay.remove();
    }

    async loadConvoysDetails() {
      const bodyEl = document.getElementById('dashboard-convoys-body');
      if (bodyEl) bodyEl.textContent = 'Loading…';

      let data = null;
      try {
        const url = new URL('/api/process/tasks', window.location.origin);
        url.searchParams.set('mode', 'all');
        url.searchParams.set('state', 'open');
        url.searchParams.set('include', 'dependencySummary');
        const res = await fetch(url.toString());
        data = res && res.ok ? await res.json().catch(() => null) : null;
      } catch {
        data = null;
      }

      if (!bodyEl) return;
      const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
      if (!data || !tasks) {
        bodyEl.textContent = 'Failed to load.';
        return;
      }

      const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      const tierKey = (t) => {
        const tier = t?.record?.tier;
        const n = Number(tier);
        return (Number.isFinite(n) && n >= 1 && n <= 4) ? `T${n}` : 'None';
      };

      const byConvoy = {};
      for (const t of tasks) {
        const assignedTo = String(t?.record?.assignedTo || '').trim() || '(unassigned)';
        const k = tierKey(t);
        if (!byConvoy[assignedTo]) {
          byConvoy[assignedTo] = { T1: 0, T2: 0, T3: 0, T4: 0, None: 0, total: 0, unclaimed: 0 };
        }
        byConvoy[assignedTo][k] = (byConvoy[assignedTo][k] || 0) + 1;
        byConvoy[assignedTo].total += 1;
        if (!String(t?.record?.claimedBy || '').trim()) byConvoy[assignedTo].unclaimed += 1;
      }

      const convoys = Object.entries(byConvoy)
        .sort((a, b) => (b[1].total || 0) - (a[1].total || 0) || String(a[0]).localeCompare(String(b[0])));

      const rows = convoys.map(([name, c]) => {
        const q = name === '(unassigned)' ? 'assigned:none' : `assigned:${name}`;
        return `
          <tr>
            <td class="mono">${escapeHtml(name)}</td>
            <td class="mono">${escapeHtml(c.T1 || 0)}</td>
            <td class="mono">${escapeHtml(c.T2 || 0)}</td>
            <td class="mono">${escapeHtml(c.T3 || 0)}</td>
            <td class="mono">${escapeHtml(c.T4 || 0)}</td>
            <td class="mono">${escapeHtml(c.None || 0)}</td>
            <td class="mono">${escapeHtml(c.total || 0)}</td>
            <td class="mono">${escapeHtml(c.unclaimed || 0)}</td>
            <td style="white-space:nowrap;">
              <button class="btn-secondary" type="button" data-open-queue-query="${escapeHtml(q)}" title="Open Queue filtered to this convoy">📥</button>
            </td>
          </tr>
        `;
      }).join('');

      bodyEl.innerHTML = `
        <div class="dashboard-telemetry-muted">Tip: use Queue search <code>assigned:NAME</code> (or <code>assigned:none</code> for unassigned).</div>
        <table class="worktree-inspector-table" style="margin-top:10px;">
          <thead>
            <tr>
              <th>Convoy</th>
              <th>T1</th>
              <th>T2</th>
              <th>T3</th>
              <th>T4</th>
              <th>None</th>
              <th>Total</th>
              <th>Unclaimed</th>
              <th>Queue</th>
            </tr>
          </thead>
          <tbody>
            ${rows || `<tr><td colspan="9" style="opacity:0.8;">No items.</td></tr>`}
          </tbody>
        </table>
      `;

      bodyEl.querySelectorAll('button[data-open-queue-query]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const q = String(btn.getAttribute('data-open-queue-query') || '').trim();
          this.hideConvoysOverlay();
          try {
            this.orchestrator.queuePanelPreset = { query: q };
          } catch {}
          this.orchestrator?.showQueuePanel?.().catch?.(() => {});
        });
      });
    }

    async showHooksOverlay() {
      const existing = document.getElementById('dashboard-hooks-overlay');
      if (existing) {
        existing.classList.remove('hidden');
        return;
      }

      const overlay = document.createElement('div');
      overlay.id = 'dashboard-hooks-overlay';
      overlay.className = 'dashboard-telemetry-overlay';
      overlay.innerHTML = `
        <div class="dashboard-telemetry-panel" role="dialog" aria-label="Hook browser">
          <div class="dashboard-telemetry-header">
            <div class="dashboard-telemetry-title">Hooks — Automations</div>
            <button class="dashboard-topbar-btn" id="dashboard-hooks-close" title="Close (Esc)">✕</button>
          </div>
          <div class="dashboard-telemetry-controls">
            <div class="dashboard-telemetry-actions">
              <button class="btn-secondary" type="button" id="dashboard-hooks-refresh">Refresh</button>
            </div>
          </div>
          <div id="dashboard-hooks-body" class="dashboard-telemetry-body">Loading…</div>
        </div>
      `;

      document.body.appendChild(overlay);

      const close = () => this.hideHooksOverlay();
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
      });
      overlay.querySelector('#dashboard-hooks-close')?.addEventListener('click', close);
      overlay.querySelector('#dashboard-hooks-refresh')?.addEventListener('click', () => {
        this.loadHooksDetails().catch(() => {});
      });

      const onKey = (e) => {
        if (e.key !== 'Escape') return;
        const el = document.getElementById('dashboard-hooks-overlay');
        if (!el || el.classList.contains('hidden')) return;
        close();
      };
      overlay._escHandler = onKey;
      document.addEventListener('keydown', onKey);

      await this.loadHooksDetails();
    }

    hideHooksOverlay() {
      const overlay = document.getElementById('dashboard-hooks-overlay');
      if (!overlay) return;
      overlay.classList.add('hidden');
      const handler = overlay._escHandler;
      if (handler) {
        document.removeEventListener('keydown', handler);
        overlay._escHandler = null;
      }
      overlay.remove();
    }

    async loadHooksDetails() {
      const bodyEl = document.getElementById('dashboard-hooks-body');
      if (!bodyEl) return;
      bodyEl.textContent = 'Loading…';

      const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      let automations = null;
      try {
        const res = await fetch('/api/process/automations');
        automations = res && res.ok ? await res.json().catch(() => null) : null;
      } catch {
        automations = null;
      }

      const trelloCfg = this.orchestrator?.userSettings?.global?.ui?.tasks?.automations?.trello?.onPrMerged || {};
      const enabled = trelloCfg.enabled !== false;
      const pollEnabled = trelloCfg.pollEnabled !== false;
      const webhookEnabled = !!trelloCfg.webhookEnabled;
      const comment = trelloCfg.comment !== false;
      const moveToDoneList = trelloCfg.moveToDoneList !== false;
      const closeIfNoDoneList = !!trelloCfg.closeIfNoDoneList;
      const pollMs = Number(trelloCfg.pollMs ?? 60000);

      const prMergeCfg = automations?.prMerge || {};
      const lastRunAt = automations?.lastRunAt || null;

      bodyEl.innerHTML = `
        <div style="display:grid; gap:14px;">
          <div>
            <div style="font-weight:600; margin-bottom:6px;">Trello hook (on PR merged)</div>
            <div class="tasks-detail-meta" style="margin-bottom:10px; opacity:0.9;">
              Stored in user settings: <code>ui.tasks.automations.trello.onPrMerged</code>
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:10px;">
              <label style="display:flex; align-items:center; gap:8px;"><input type="checkbox" id="hooks-trello-enabled" ${enabled ? 'checked' : ''}/> enabled</label>
              <label style="display:flex; align-items:center; gap:8px;"><input type="checkbox" id="hooks-trello-poll" ${pollEnabled ? 'checked' : ''}/> poll</label>
              <label style="display:flex; align-items:center; gap:8px;"><input type="checkbox" id="hooks-trello-webhook" ${webhookEnabled ? 'checked' : ''}/> webhook</label>
              <label style="display:flex; align-items:center; gap:8px;"><input type="checkbox" id="hooks-trello-comment" ${comment ? 'checked' : ''}/> comment</label>
              <label style="display:flex; align-items:center; gap:8px;"><input type="checkbox" id="hooks-trello-move" ${moveToDoneList ? 'checked' : ''}/> move card</label>
              <label style="display:flex; align-items:center; gap:8px;"><input type="checkbox" id="hooks-trello-close" ${closeIfNoDoneList ? 'checked' : ''}/> close if no done list</label>
            </div>
            <div style="margin-top:10px; display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
              <span class="tasks-detail-meta">pollMs</span>
              <input id="hooks-trello-pollms" type="number" min="5000" step="1000" value="${escapeHtml(String(Number.isFinite(pollMs) ? pollMs : 60000))}" style="width:140px;" />
              <button class="btn-secondary" type="button" id="hooks-trello-save">Save</button>
            </div>
          </div>

          <div>
            <div style="font-weight:600; margin-bottom:6px;">PR merge automation</div>
            <div class="tasks-detail-meta" style="margin-bottom:8px; opacity:0.9;">
              lastRunAt: ${lastRunAt ? `<code>${escapeHtml(lastRunAt)}</code>` : '—'}
            </div>
            <div class="tasks-detail-meta" style="margin-bottom:10px; opacity:0.9;">
              Config: pollMs <code>${escapeHtml(String(prMergeCfg?.pollMs ?? '—'))}</code> • enabled <code>${escapeHtml(String(prMergeCfg?.enabled ?? '—'))}</code>
            </div>
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
              <button class="btn-secondary" type="button" id="hooks-pr-merge-run">▶ Run once</button>
            </div>
            <div id="hooks-pr-merge-result" class="tasks-detail-meta" style="margin-top:10px; opacity:0.9;"></div>
          </div>
        </div>
      `;

      const update = async (path, value) => {
        try {
          await this.orchestrator?.updateGlobalUserSetting?.(path, value);
        } catch {}
      };

      bodyEl.querySelector('#hooks-trello-save')?.addEventListener('click', async () => {
        const next = {
          enabled: !!bodyEl.querySelector('#hooks-trello-enabled')?.checked,
          pollEnabled: !!bodyEl.querySelector('#hooks-trello-poll')?.checked,
          webhookEnabled: !!bodyEl.querySelector('#hooks-trello-webhook')?.checked,
          comment: !!bodyEl.querySelector('#hooks-trello-comment')?.checked,
          moveToDoneList: !!bodyEl.querySelector('#hooks-trello-move')?.checked,
          closeIfNoDoneList: !!bodyEl.querySelector('#hooks-trello-close')?.checked,
          pollMs: Number(bodyEl.querySelector('#hooks-trello-pollms')?.value || 60000)
        };
        await update('ui.tasks.automations.trello.onPrMerged', next);
        this.loadHooksDetails().catch(() => {});
      });

      bodyEl.querySelector('#hooks-pr-merge-run')?.addEventListener('click', async () => {
        const out = bodyEl.querySelector('#hooks-pr-merge-result');
        if (out) out.textContent = 'Running…';
        try {
          const res = await fetch('/api/process/automations/pr-merge/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ limit: 60 })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data?.error || 'Failed');
          if (out) out.innerHTML = `ok: <code>${escapeHtml(String(!!data.ok))}</code> • processed: <code>${escapeHtml(String(data?.processed ?? 0))}</code> • moved: <code>${escapeHtml(String(data?.moved ?? 0))}</code>`;
        } catch (err) {
          if (out) out.textContent = `Failed: ${String(err?.message || err)}`;
        }
      });
    }

    async showDeaconOverlay() {
      const existing = document.getElementById('dashboard-deacon-overlay');
      if (existing) {
        existing.classList.remove('hidden');
        return;
      }

      const overlay = document.createElement('div');
      overlay.id = 'dashboard-deacon-overlay';
      overlay.className = 'dashboard-telemetry-overlay';
      overlay.innerHTML = `
        <div class="dashboard-telemetry-panel" role="dialog" aria-label="Deacon monitor">
          <div class="dashboard-telemetry-header">
            <div class="dashboard-telemetry-title">Deacon — Health</div>
            <button class="dashboard-topbar-btn" id="dashboard-deacon-close" title="Close (Esc)">✕</button>
          </div>
          <div class="dashboard-telemetry-controls">
            <div class="dashboard-telemetry-actions">
              <button class="btn-secondary" type="button" id="dashboard-deacon-refresh">Refresh</button>
            </div>
          </div>
          <div id="dashboard-deacon-body" class="dashboard-telemetry-body">Loading…</div>
        </div>
      `;

      document.body.appendChild(overlay);

      const close = () => this.hideDeaconOverlay();
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
      });
      overlay.querySelector('#dashboard-deacon-close')?.addEventListener('click', close);
      overlay.querySelector('#dashboard-deacon-refresh')?.addEventListener('click', () => {
        this.loadDeaconDetails().catch(() => {});
      });

      const onKey = (e) => {
        if (e.key !== 'Escape') return;
        const el = document.getElementById('dashboard-deacon-overlay');
        if (!el || el.classList.contains('hidden')) return;
        close();
      };
      overlay._escHandler = onKey;
      document.addEventListener('keydown', onKey);

      await this.loadDeaconDetails();
    }

    hideDeaconOverlay() {
      const overlay = document.getElementById('dashboard-deacon-overlay');
      if (!overlay) return;
      overlay.classList.add('hidden');
      const handler = overlay._escHandler;
      if (handler) {
        document.removeEventListener('keydown', handler);
        overlay._escHandler = null;
      }
      overlay.remove();
    }

    async loadDeaconDetails() {
      const bodyEl = document.getElementById('dashboard-deacon-body');
      if (!bodyEl) return;
      bodyEl.textContent = 'Loading…';

      const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      const check = async (path) => {
        const started = performance.now();
        try {
          const res = await fetch(path);
          const ms = Math.round(performance.now() - started);
          const ok = !!res.ok;
          return { path, ok, ms, status: res.status };
        } catch (err) {
          const ms = Math.round(performance.now() - started);
          return { path, ok: false, ms, error: String(err?.message || err) };
        }
      };

      const endpoints = [
        '/api/user-settings',
        '/api/workspaces',
        '/api/process/status',
        '/api/process/performance',
        '/api/activity?limit=1'
      ];

      const results = await Promise.all(endpoints.map(check));

      let perf = null;
      try {
        const res = await fetch('/api/process/performance');
        perf = res && res.ok ? await res.json().catch(() => null) : null;
      } catch {
        perf = null;
      }

      let activity = null;
      try {
        const res = await fetch('/api/activity?limit=200');
        activity = res && res.ok ? await res.json().catch(() => null) : null;
      } catch {
        activity = null;
      }

      const events = Array.isArray(activity?.events) ? activity.events : [];
      const isErrorEvent = (ev) => {
        const kind = String(ev?.kind || '');
        const data = ev?.data && typeof ev.data === 'object' ? ev.data : {};
        if (data.ok === false) return true;
        if (kind.includes('failed')) return true;
        if (kind.includes('.error')) return true;
        if (kind.endsWith('.failed')) return true;
        if (kind.includes('close.failed')) return true;
        return false;
      };
      const errors = events.filter(isErrorEvent).slice(0, 20);

      const fmtBytes = (b) => {
        const n = Number(b);
        if (!Number.isFinite(n) || n < 0) return '—';
        const mb = n / (1024 * 1024);
        if (mb < 1024) return `${mb.toFixed(1)} MB`;
        return `${(mb / 1024).toFixed(2)} GB`;
      };

      const node = perf?.node || {};
      const uptime = Number(node?.uptimeSeconds || 0);
      const rss = fmtBytes(node?.rssBytes);

      const rows = results.map((r) => {
        const cls = r.ok ? 'process-chip ok' : 'process-chip danger';
        const statusText = r.ok ? `HTTP ${r.status}` : (r.error ? `ERR ${r.error}` : 'ERR');
        return `
          <tr>
            <td class="mono">${escapeHtml(r.path)}</td>
            <td><span class="${cls}">${r.ok ? 'ok' : 'fail'}</span></td>
            <td class="mono">${escapeHtml(String(r.ms))}ms</td>
            <td class="mono" style="opacity:0.85;">${escapeHtml(statusText)}</td>
          </tr>
        `;
      }).join('');

      const errorRows = errors.map((e) => {
        const t = escapeHtml(String(e?.time || e?.ts || ''));
        const kind = escapeHtml(String(e?.kind || ''));
        const data = escapeHtml(JSON.stringify(e?.data || {}));
        return `<div style="margin:6px 0;"><span class="mono" style="opacity:0.85;">${t}</span> • <code>${kind}</code><div class="mono" style="opacity:0.8; margin-top:4px;">${data}</div></div>`;
      }).join('');

      bodyEl.innerHTML = `
        <div class="dashboard-telemetry-muted">Node RSS: <code>${escapeHtml(rss)}</code> • Uptime: <code>${escapeHtml(String(uptime))}s</code></div>
        <table class="worktree-inspector-table" style="margin-top:10px;">
          <thead>
            <tr><th>Endpoint</th><th>Status</th><th>Latency</th><th>Detail</th></tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
        <div style="margin-top:14px;">
          <div style="font-weight:600; margin-bottom:6px;">Recent errors (Activity)</div>
          ${errorRows || '<div style="opacity:0.8;">No recent error events.</div>'}
        </div>
      `;
    }

    hidePerformanceOverlay() {
      const overlay = document.getElementById('dashboard-performance-overlay');
      if (!overlay) return;
	    overlay.classList.add('hidden');
	    const handler = overlay._escHandler;
	    if (handler) {
	      document.removeEventListener('keydown', handler);
	      overlay._escHandler = null;
	    }
	    overlay.remove();
	  }

		  async loadPerformanceDetails() {
		    const bodyEl = document.getElementById('dashboard-performance-body');
		    if (bodyEl) bodyEl.textContent = 'Loading…';

	    let data = null;
	    try {
	      const res = await fetch('/api/process/performance');
	      data = res && res.ok ? await res.json().catch(() => null) : null;
	    } catch {
	      data = null;
	    }

	    if (!bodyEl) return;
	    if (!data || !data.ok) {
	      bodyEl.textContent = 'Failed to load.';
	      return;
	    }

	    const escapeHtml = (value) => String(value ?? '')
	      .replace(/&/g, '&amp;')
	      .replace(/</g, '&lt;')
	      .replace(/>/g, '&gt;');

	    const fmtBytes = (b) => {
	      const n = Number(b);
	      if (!Number.isFinite(n) || n < 0) return '—';
	      const mb = n / (1024 * 1024);
	      if (mb < 1024) return `${mb.toFixed(1)} MB`;
	      return `${(mb / 1024).toFixed(2)} GB`;
	    };

	    const fmtKb = (kb) => {
	      const n = Number(kb);
	      if (!Number.isFinite(n) || n < 0) return '—';
	      return fmtBytes(n * 1024);
	    };

	    const sessions = Array.isArray(data.sessions) ? data.sessions : [];
	    const rows = sessions.map((s) => {
	      const repo = s.repositoryName ? `${escapeHtml(s.repositoryName)}/` : '';
	      const wt = escapeHtml(s.worktreeId || '');
	      const label = `${repo}${wt || escapeHtml(s.sessionId)}`;
	      const pid = s.pid ? escapeHtml(String(s.pid)) : '—';
	      const mem = s.totalRssKb ? escapeHtml(fmtKb(s.totalRssKb)) : '—';
	      const kids = escapeHtml(String(s.childCount ?? 0));
	      return `<tr><td class="mono">${escapeHtml(s.sessionId)}</td><td>${label}</td><td>${escapeHtml(s.type || '')}</td><td class="mono">${pid}</td><td class="mono">${mem}</td><td class="mono">${kids}</td></tr>`;
	    }).join('');

		    bodyEl.innerHTML = `
		      <div class="dashboard-telemetry-muted">Generated: ${escapeHtml(data.generatedAt)} • Node RSS: ${escapeHtml(fmtBytes(data?.node?.rssBytes))} • Uptime: ${escapeHtml(String(data?.node?.uptimeSeconds || 0))}s</div>
		      <table class="worktree-inspector-table" style="margin-top:10px;">
		        <thead>
		          <tr>
	            <th>Session</th>
	            <th>Worktree</th>
	            <th>Type</th>
	            <th>PID</th>
	            <th>Mem (RSS)</th>
	            <th>Children</th>
	          </tr>
	        </thead>
	        <tbody>
		          ${rows || `<tr><td colspan="6" style="opacity:0.8;">No sessions.</td></tr>`}
		        </tbody>
		      </table>
		    `;
		  }

		  async showTestOrchestrationOverlay() {
		    const existing = document.getElementById('dashboard-tests-overlay');
		    if (existing) {
		      existing.classList.remove('hidden');
		      return;
		    }

		    const overlay = document.createElement('div');
		    overlay.id = 'dashboard-tests-overlay';
		    overlay.className = 'dashboard-telemetry-overlay';
		    overlay.innerHTML = `
		      <div class="dashboard-telemetry-panel" role="dialog" aria-label="Test orchestration">
		        <div class="dashboard-telemetry-header">
		          <div class="dashboard-telemetry-title">Tests — Orchestration</div>
		          <button class="dashboard-topbar-btn" id="dashboard-tests-close" title="Close (Esc)">✕</button>
		        </div>
		        <div class="dashboard-telemetry-controls">
		          <label class="dashboard-telemetry-field">
		            <span>Script</span>
		            <select id="dashboard-tests-script">
		              <option value="auto" selected>auto</option>
		              <option value="test:unit">test:unit</option>
		              <option value="test">test</option>
		              <option value="test:ci">test:ci</option>
		            </select>
		          </label>
		          <label class="dashboard-telemetry-field">
		            <span>Concurrency</span>
		            <select id="dashboard-tests-concurrency">
		              <option value="1">1</option>
		              <option value="2" selected>2</option>
		              <option value="3">3</option>
		              <option value="4">4</option>
		              <option value="6">6</option>
		              <option value="8">8</option>
		            </select>
		          </label>
		          <div class="dashboard-telemetry-actions">
		            <button class="btn-primary" type="button" id="dashboard-tests-run">Run</button>
		            <button class="btn-secondary" type="button" id="dashboard-tests-cancel" disabled>Cancel</button>
		            <button class="btn-secondary" type="button" id="dashboard-tests-refresh">Refresh</button>
		          </div>
		        </div>
		        <div id="dashboard-tests-body" class="dashboard-telemetry-body">Loading…</div>
		      </div>
		    `;

		    document.body.appendChild(overlay);

		    const close = () => this.hideTestOrchestrationOverlay();
		    overlay.addEventListener('click', (e) => {
		      if (e.target === overlay) close();
		    });
		    overlay.querySelector('#dashboard-tests-close')?.addEventListener('click', close);

		    const onKey = (e) => {
		      if (e.key !== 'Escape') return;
		      const el = document.getElementById('dashboard-tests-overlay');
		      if (!el || el.classList.contains('hidden')) return;
		      close();
		    };
		    overlay._escHandler = onKey;
		    document.addEventListener('keydown', onKey);

		    const scriptEl = overlay.querySelector('#dashboard-tests-script');
		    const concurrencyEl = overlay.querySelector('#dashboard-tests-concurrency');
		    overlay.querySelector('#dashboard-tests-run')?.addEventListener('click', async () => {
		      const script = String(scriptEl?.value || 'auto');
		      const concurrency = Number(concurrencyEl?.value || 2);
		      await this.startTestOrchestrationRun({ script, concurrency });
		    });
		    overlay.querySelector('#dashboard-tests-cancel')?.addEventListener('click', async () => {
		      await this.cancelTestOrchestrationRun();
		    });
		    overlay.querySelector('#dashboard-tests-refresh')?.addEventListener('click', async () => {
		      await this.loadLatestTestOrchestrationRunOrCurrent();
		    });

		    await this.loadLatestTestOrchestrationRunOrCurrent();
		  }

		  hideTestOrchestrationOverlay() {
		    const overlay = document.getElementById('dashboard-tests-overlay');
		    if (!overlay) return;
		    overlay.classList.add('hidden');
		    const handler = overlay._escHandler;
		    if (handler) {
		      document.removeEventListener('keydown', handler);
		      overlay._escHandler = null;
		    }
		    if (this._testsPollTimer) {
		      clearTimeout(this._testsPollTimer);
		      this._testsPollTimer = null;
		    }
		    overlay.remove();
		  }

		  async startTestOrchestrationRun({ script = 'auto', concurrency = 2 } = {}) {
		    const bodyEl = document.getElementById('dashboard-tests-body');
		    if (bodyEl) bodyEl.textContent = 'Starting…';
		    if (this._testsPollTimer) {
		      clearTimeout(this._testsPollTimer);
		      this._testsPollTimer = null;
		    }

		    let data = null;
		    try {
		      const res = await fetch('/api/process/tests/run', {
		        method: 'POST',
		        headers: { 'Content-Type': 'application/json' },
		        body: JSON.stringify({ script, concurrency, existingOnly: true })
		      });
		      data = res && res.ok ? await res.json().catch(() => null) : null;
		    } catch {
		      data = null;
		    }

		    if (!data || !data.ok || !data.runId) {
		      if (bodyEl) bodyEl.textContent = 'Failed to start.';
		      return;
		    }

		    this._testRunId = String(data.runId);
		    await this.loadTestOrchestrationRun(this._testRunId, { poll: true });
		  }

		  async loadLatestTestOrchestrationRunOrCurrent() {
		    if (this._testRunId) {
		      await this.loadTestOrchestrationRun(this._testRunId, { poll: true });
		      return;
		    }

		    const bodyEl = document.getElementById('dashboard-tests-body');
		    if (bodyEl) bodyEl.textContent = 'Loading…';

		    let data = null;
		    try {
		      const res = await fetch('/api/process/tests/runs?limit=1');
		      data = res && res.ok ? await res.json().catch(() => null) : null;
		    } catch {
		      data = null;
		    }

		    const first = Array.isArray(data?.runs) ? data.runs[0] : null;
		    if (!first?.runId) {
		      if (bodyEl) bodyEl.textContent = 'No test runs yet.';
		      return;
		    }

		    this._testRunId = String(first.runId);
		    await this.loadTestOrchestrationRun(this._testRunId, { poll: true });
		  }

		  async loadTestOrchestrationRun(runId, { poll = false } = {}) {
		    const bodyEl = document.getElementById('dashboard-tests-body');
		    if (!bodyEl) return;

		    let data = null;
		    try {
		      const url = `/api/process/tests/runs/${encodeURIComponent(String(runId || '').trim())}`;
		      const res = await fetch(url);
		      data = res && res.ok ? await res.json().catch(() => null) : null;
		    } catch {
		      data = null;
		    }

		    if (!data || !data.ok) {
		      bodyEl.textContent = 'Failed to load.';
		      return;
		    }

		    const escapeHtml = (value) => String(value ?? '')
		      .replace(/&/g, '&amp;')
		      .replace(/</g, '&lt;')
		      .replace(/>/g, '&gt;');

		    const results = Array.isArray(data.results) ? data.results : [];
		    const rows = results.map((r) => {
		      const output = String(r.outputTail || '');
		      const tail = output.length > 2000 ? output.slice(output.length - 2000) : output;
		      return `
		        <tr>
		          <td class="mono">${escapeHtml(r.worktreeId || '')}</td>
		          <td class="mono">${escapeHtml(r.status || '')}</td>
		          <td class="mono">${escapeHtml(r.command || '—')}</td>
		          <td class="mono">${escapeHtml(r.durationMs != null ? String(r.durationMs) : '—')}</td>
		          <td class="mono">${escapeHtml(r.exitCode != null ? String(r.exitCode) : '—')}</td>
		          <td style="min-width: 340px;">
		            <pre style="white-space: pre-wrap; margin: 0; max-height: 140px; overflow: auto;">${escapeHtml(tail || '')}</pre>
		          </td>
		        </tr>
		      `;
		    }).join('');

		    const s = data.summary || {};
		    bodyEl.innerHTML = `
		      <div class="dashboard-telemetry-muted">Run: ${escapeHtml(data.runId)} • Workspace: ${escapeHtml(data.workspaceName || data.workspaceId || '')} • Script: ${escapeHtml(data.script)} • Concurrency: ${escapeHtml(String(data.concurrency || ''))} • Status: ${escapeHtml(data.status)}</div>
		      <div class="dashboard-telemetry-muted">Total: ${escapeHtml(String(s.total || 0))} • Running: ${escapeHtml(String(s.running || 0))} • Passed: ${escapeHtml(String(s.passed || 0))} • Failed: ${escapeHtml(String(s.failed || 0))} • Cancelled: ${escapeHtml(String(s.cancelled || 0))} • Unsupported: ${escapeHtml(String(s.unsupported || 0))}</div>
		      <table class="worktree-inspector-table" style="margin-top:10px;">
		        <thead>
		          <tr>
		            <th>Worktree</th>
		            <th>Status</th>
		            <th>Command</th>
		            <th>ms</th>
		            <th>Exit</th>
		            <th>Output (tail)</th>
		          </tr>
		        </thead>
		        <tbody>
		          ${rows || `<tr><td colspan="6" style="opacity:0.8;">No worktrees.</td></tr>`}
		        </tbody>
		      </table>
		    `;

		    const cancelBtn = document.getElementById('dashboard-tests-cancel');
		    if (cancelBtn) {
		      const canCancel = String(data.status) === 'running' && !!data.runId;
		      cancelBtn.disabled = !canCancel;
		    }

		    if (poll && String(data.status) === 'running') {
		      if (this._testsPollTimer) clearTimeout(this._testsPollTimer);
		      this._testsPollTimer = setTimeout(() => {
		        try { this.loadTestOrchestrationRun(data.runId, { poll: true }); } catch {}
		      }, 2000);
		    }
		  }

		  async cancelTestOrchestrationRun() {
		    const runId = String(this._testRunId || '').trim();
		    if (!runId) return;

		    const cancelBtn = document.getElementById('dashboard-tests-cancel');
		    if (cancelBtn) cancelBtn.disabled = true;

		    try {
		      await fetch(`/api/process/tests/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' }).catch(() => null);
		    } catch {}

		    await this.loadTestOrchestrationRun(runId, { poll: true });
		  }

		  async showReadinessOverlay() {
		    const existing = document.getElementById('dashboard-readiness-overlay');
		    if (existing) {
		      existing.classList.remove('hidden');
	      return;
	    }

	    const overlay = document.createElement('div');
	    overlay.id = 'dashboard-readiness-overlay';
	    overlay.className = 'dashboard-telemetry-overlay';
	    overlay.innerHTML = `
	      <div class="dashboard-telemetry-panel" role="dialog" aria-label="Project readiness checklists">
	        <div class="dashboard-telemetry-header">
	          <div class="dashboard-telemetry-title">Readiness — Checklists</div>
	          <button class="dashboard-topbar-btn" id="dashboard-readiness-close" title="Close (Esc)">✕</button>
	        </div>
	        <div class="dashboard-telemetry-controls">
	          <label class="dashboard-telemetry-field">
	            <span>Template</span>
	            <select id="dashboard-readiness-template"></select>
	          </label>
	          <div class="dashboard-telemetry-actions">
	            <button class="btn-secondary" type="button" id="dashboard-readiness-copy-md">Copy Markdown</button>
	            <button class="btn-secondary" type="button" id="dashboard-readiness-copy-text">Copy Text</button>
	            <button class="btn-secondary" type="button" id="dashboard-readiness-copy-all">Copy All</button>
	          </div>
	        </div>
	        <div id="dashboard-readiness-body" class="dashboard-telemetry-body">Loading…</div>
	      </div>
	    `;

	    document.body.appendChild(overlay);

	    const escapeHtml = (value) => String(value ?? '')
	      .replace(/&/g, '&amp;')
	      .replace(/</g, '&lt;')
	      .replace(/>/g, '&gt;');

	    const close = () => this.hideReadinessOverlay();
	    overlay.addEventListener('click', (e) => {
	      if (e.target === overlay) close();
	    });
	    overlay.querySelector('#dashboard-readiness-close')?.addEventListener('click', close);

	    const onKey = (e) => {
	      if (e.key !== 'Escape') return;
	      const el = document.getElementById('dashboard-readiness-overlay');
	      if (!el || el.classList.contains('hidden')) return;
	      close();
	    };
	    overlay._escHandler = onKey;
	    document.addEventListener('keydown', onKey);

	    const selectEl = overlay.querySelector('#dashboard-readiness-template');
	    const bodyEl = overlay.querySelector('#dashboard-readiness-body');
	    const copyMdBtn = overlay.querySelector('#dashboard-readiness-copy-md');
	    const copyTextBtn = overlay.querySelector('#dashboard-readiness-copy-text');
	    const copyAllBtn = overlay.querySelector('#dashboard-readiness-copy-all');

	    const res = await fetch('/api/process/readiness/templates').catch(() => null);
	    const data = res ? await res.json().catch(() => ({})) : {};
	    if (!res || !res.ok) {
	      if (bodyEl) bodyEl.textContent = 'Failed to load.';
	      return;
	    }

	    const templates = Array.isArray(data?.templates) ? data.templates : [];
	    if (!templates.length) {
	      if (bodyEl) bodyEl.textContent = 'No templates found.';
	      return;
	    }

	    const byId = new Map(templates.map((t) => [String(t?.id || '').trim(), t]));

	    const mdFor = (t) => {
	      const title = String(t?.title || '').trim() || String(t?.id || '').trim() || 'Checklist';
	      const items = Array.isArray(t?.items) ? t.items : [];
	      return `## ${title}\n` + items.map(i => `- [ ] ${String(i || '').trim()}`).join('\n') + '\n';
	    };

	    const textFor = (t) => {
	      const title = String(t?.title || '').trim() || String(t?.id || '').trim() || 'Checklist';
	      const items = Array.isArray(t?.items) ? t.items : [];
	      return `${title}\n` + items.map(i => `- ${String(i || '').trim()}`).join('\n') + '\n';
	    };

	    const render = () => {
	      const id = String(selectEl?.value || '').trim();
	      const t = byId.get(id) || templates[0];
	      const title = escapeHtml(String(t?.title || '').trim() || id);
	      const items = Array.isArray(t?.items) ? t.items : [];
	      if (!bodyEl) return;
	      bodyEl.innerHTML = `
	        <div class="dashboard-telemetry-meta">
	          <div><strong>${title}</strong></div>
	          <div style="opacity:0.85;">${items.length} items</div>
	        </div>
	        <ul style="margin:0; padding-left: 18px; display:flex; flex-direction:column; gap:6px;">
	          ${items.map((i) => `<li style="list-style: disc;"><label style="display:flex; gap:10px; align-items:flex-start;"><input type="checkbox" disabled /><span>${escapeHtml(String(i || '').trim())}</span></label></li>`).join('')}
	        </ul>
	      `;
	    };

	    if (selectEl) {
	      selectEl.innerHTML = templates
	        .map((t) => {
	          const id = String(t?.id || '').trim();
	          const title = String(t?.title || '').trim() || id;
	          return `<option value="${escapeHtml(id)}">${escapeHtml(title)}</option>`;
	        })
	        .join('');
	      selectEl.value = String(templates[0]?.id || '').trim();
	      selectEl.addEventListener('change', render);
	    }

	    const getSelected = () => {
	      const id = String(selectEl?.value || '').trim();
	      return byId.get(id) || templates[0];
	    };

	    copyMdBtn?.addEventListener('click', async () => {
	      const t = getSelected();
	      await this.copyToClipboard(mdFor(t));
	      try { this.orchestrator?.showToast?.('Checklist copied (Markdown)', 'success'); } catch {}
	    });

	    copyTextBtn?.addEventListener('click', async () => {
	      const t = getSelected();
	      await this.copyToClipboard(textFor(t));
	      try { this.orchestrator?.showToast?.('Checklist copied', 'success'); } catch {}
	    });

	    copyAllBtn?.addEventListener('click', async () => {
	      const all = templates.map(t => mdFor(t)).join('\n');
	      await this.copyToClipboard(all);
	      try { this.orchestrator?.showToast?.('All checklists copied (Markdown)', 'success'); } catch {}
	    });

	    render();
	  }

	  hideReadinessOverlay() {
	    const overlay = document.getElementById('dashboard-readiness-overlay');
	    if (!overlay) return;
	    overlay.classList.add('hidden');
	    const handler = overlay._escHandler;
	    if (handler) {
	      document.removeEventListener('keydown', handler);
	      overlay._escHandler = null;
	    }
	    overlay.remove();
	  }

	  async showSuggestionsOverlay() {
	    const existing = document.getElementById('dashboard-suggestions-overlay');
	    if (existing) {
	      existing.classList.remove('hidden');
	      return;
	    }

	    const overlay = document.createElement('div');
	    overlay.id = 'dashboard-suggestions-overlay';
	    overlay.className = 'dashboard-telemetry-overlay';
	    overlay.innerHTML = `
	      <div class="dashboard-telemetry-panel" role="dialog" aria-label="Workspace suggestions">
	        <div class="dashboard-telemetry-header">
	          <div class="dashboard-telemetry-title">Workspaces — Suggestions</div>
	          <button class="dashboard-topbar-btn" id="dashboard-suggestions-close" title="Close (Esc)">✕</button>
	        </div>
	        <div class="dashboard-telemetry-controls">
	          <div class="dashboard-telemetry-actions">
	            <button class="btn-secondary" type="button" id="dashboard-suggestions-create-recent" title="Create a new workspace from recent git activity">Create Recent Workspace</button>
	            <button class="btn-secondary" type="button" id="dashboard-suggestions-refresh">Refresh</button>
	            <button class="btn-secondary" type="button" id="dashboard-suggestions-copy">Copy JSON</button>
	          </div>
	        </div>
	        <div id="dashboard-suggestions-body" class="dashboard-telemetry-body">Loading…</div>
	      </div>
	    `;

	    document.body.appendChild(overlay);

	    const close = () => this.hideSuggestionsOverlay();
	    overlay.addEventListener('click', (e) => {
	      if (e.target === overlay) close();
	    });
	    overlay.querySelector('#dashboard-suggestions-close')?.addEventListener('click', close);

	    const onKey = (e) => {
	      if (e.key !== 'Escape') return;
	      const el = document.getElementById('dashboard-suggestions-overlay');
	      if (!el || el.classList.contains('hidden')) return;
	      close();
	    };
	    overlay._escHandler = onKey;
	    document.addEventListener('keydown', onKey);

	    overlay.querySelector('#dashboard-suggestions-refresh')?.addEventListener('click', () => {
	      this.loadWorkspaceSuggestions();
	    });
	    overlay.querySelector('#dashboard-suggestions-create-recent')?.addEventListener('click', async () => {
	      const btn = overlay.querySelector('#dashboard-suggestions-create-recent');
	      if (btn) btn.disabled = true;
	      try {
	        const resp = await fetch('/api/workspaces/create-recent', {
	          method: 'POST',
	          headers: { 'Content-Type': 'application/json' },
	          body: JSON.stringify({ count: 4 })
	        });
	        const data = await resp.json().catch(() => ({}));
	        if (!resp.ok || !data?.ok || !data?.workspace?.id) {
	          throw new Error(String(data?.error || 'Failed to create workspace'));
	        }
	        try { this.orchestrator?.showToast?.('Created recent workspace', 'success'); } catch {}
	        await this.loadWorkspaces();
	        this.render();
	        this.openWorkspace(data.workspace.id);
	      } catch (err) {
	        try { this.orchestrator?.showToast?.(`Create failed: ${String(err?.message || err)}`, 'error'); } catch {}
	      } finally {
	        if (btn) btn.disabled = false;
	      }
	    });
	    overlay.querySelector('#dashboard-suggestions-copy')?.addEventListener('click', async () => {
	      const data = this._workspaceSuggestions || null;
	      if (!data) return;
	      try {
	        await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
	        try { this.orchestrator?.showToast?.('Copied suggestions JSON', 'success'); } catch {}
	      } catch {}
	    });

	    await this.loadWorkspaceSuggestions();
	  }

	  hideSuggestionsOverlay() {
	    const overlay = document.getElementById('dashboard-suggestions-overlay');
	    if (!overlay) return;
	    overlay.classList.add('hidden');
	    const handler = overlay._escHandler;
	    if (handler) {
	      document.removeEventListener('keydown', handler);
	      overlay._escHandler = null;
	    }
	    overlay.remove();
	  }

	  async loadWorkspaceSuggestions() {
	    const bodyEl = document.getElementById('dashboard-suggestions-body');
	    if (bodyEl) bodyEl.textContent = 'Loading…';

	    let data = null;
	    try {
	      const res = await fetch('/api/workspaces/suggestions?limit=8');
	      data = res && res.ok ? await res.json().catch(() => null) : null;
	    } catch {
	      data = null;
	    }

	    this._workspaceSuggestions = data;
	    if (!bodyEl) return;
	    if (!data) {
	      bodyEl.textContent = 'Failed to load.';
	      return;
	    }

	    const escapeHtml = (value) => String(value ?? '')
	      .replace(/&/g, '&amp;')
	      .replace(/</g, '&lt;')
	      .replace(/>/g, '&gt;');

	    const combos = Array.isArray(data?.suggestions?.frequentCombos) ? data.suggestions.frequentCombos : [];
	    const recent = Array.isArray(data?.suggestions?.recentRepos) ? data.suggestions.recentRepos : [];

	    const renderRepos = (repos) => {
	      const list = Array.isArray(repos) ? repos : [];
	      if (!list.length) return '';
	      return `<ul class="dashboard-telemetry-list">${list.map(r => `<li><code>${escapeHtml(r?.path || '')}</code></li>`).join('')}</ul>`;
	    };

	    const renderSuggestion = (s) => {
	      const label = escapeHtml(s?.label || '');
	      const score = escapeHtml(String(s?.score ?? ''));
	      const kind = escapeHtml(s?.kind || '');
	      const seen = Array.isArray(s?.seenInWorkspaces) ? s.seenInWorkspaces : [];
	      const seenHtml = seen.length ? `<div class="dashboard-telemetry-muted">Seen in: ${seen.map(escapeHtml).join(', ')}</div>` : '';
	      return `
	        <div class="dashboard-telemetry-card">
	          <div><strong>${label}</strong> <span class="dashboard-telemetry-muted">(${kind}, score: ${score})</span></div>
	          ${seenHtml}
	          ${renderRepos(s?.repositories)}
	        </div>
	      `;
	    };

	    bodyEl.innerHTML = `
	      <div class="dashboard-telemetry-muted">Generated: ${escapeHtml(data.generatedAt)} • Workspaces: ${escapeHtml(data?.sources?.workspaceCount)} • Repos: ${escapeHtml(data?.sources?.repoCount)}</div>
	      <h4 style="margin-top: 14px;">Frequent repo combos</h4>
	      ${combos.length ? combos.map(renderSuggestion).join('') : '<div class="dashboard-telemetry-muted">None found.</div>'}
	      <h4 style="margin-top: 14px;">Recent activity</h4>
	      ${recent.length ? recent.map(renderSuggestion).join('') : '<div class="dashboard-telemetry-muted">None found.</div>'}
	    `;
	  }

	  async showDistributionOverlay() {
	    const existing = document.getElementById('dashboard-distribution-overlay');
	    if (existing) {
	      existing.classList.remove('hidden');
	      return;
	    }

	    const overlay = document.createElement('div');
	    overlay.id = 'dashboard-distribution-overlay';
	    overlay.className = 'dashboard-telemetry-overlay';
	    overlay.innerHTML = `
	      <div class="dashboard-telemetry-panel" role="dialog" aria-label="Task distribution">
	        <div class="dashboard-telemetry-header">
	          <div class="dashboard-telemetry-title">Distribution — Suggested terminals</div>
	          <button class="dashboard-topbar-btn" id="dashboard-distribution-close" title="Close (Esc)">✕</button>
	        </div>
	        <div class="dashboard-telemetry-controls">
	          <div class="dashboard-telemetry-actions">
	            <button class="btn-secondary" type="button" id="dashboard-distribution-refresh">Refresh</button>
	          </div>
	        </div>
	        <div id="dashboard-distribution-body" class="dashboard-telemetry-body">Loading…</div>
	      </div>
	    `;

	    document.body.appendChild(overlay);

	    const close = () => this.hideDistributionOverlay();
	    overlay.addEventListener('click', (e) => {
	      if (e.target === overlay) close();
	    });
	    overlay.querySelector('#dashboard-distribution-close')?.addEventListener('click', close);

	    const onKey = (e) => {
	      if (e.key !== 'Escape') return;
	      const el = document.getElementById('dashboard-distribution-overlay');
	      if (!el || el.classList.contains('hidden')) return;
	      close();
	    };
	    overlay._escHandler = onKey;
	    document.addEventListener('keydown', onKey);

	    overlay.querySelector('#dashboard-distribution-refresh')?.addEventListener('click', () => {
	      this.loadDistributionDetails();
	    });

	    await this.loadDistributionDetails();
	  }

	  hideDistributionOverlay() {
	    const overlay = document.getElementById('dashboard-distribution-overlay');
	    if (!overlay) return;
	    overlay.classList.add('hidden');
	    const handler = overlay._escHandler;
	    if (handler) {
	      document.removeEventListener('keydown', handler);
	      overlay._escHandler = null;
	    }
	    overlay.remove();
	  }

	  async loadDistributionDetails() {
	    const bodyEl = document.getElementById('dashboard-distribution-body');
	    if (bodyEl) bodyEl.textContent = 'Loading…';

	    let data = null;
	    try {
	      const res = await fetch('/api/process/distribution?mode=mine&state=open&sort=updated&limit=25');
	      data = res && res.ok ? await res.json().catch(() => null) : null;
	    } catch {
	      data = null;
	    }

	    if (!bodyEl) return;
	    if (!data || !data.ok) {
	      bodyEl.textContent = 'Failed to load.';
	      return;
	    }

	    const escapeHtml = (value) => String(value ?? '')
	      .replace(/&/g, '&amp;')
	      .replace(/</g, '&lt;')
	      .replace(/>/g, '&gt;');

	    const rows = (Array.isArray(data.suggestions) ? data.suggestions : []).map((s) => {
	      const t = s.task || {};
	      const title = escapeHtml(t.title || t.id || '');
	      const repo = escapeHtml(t.repository || '');
	      const url = escapeHtml(t.url || '');
	      const sid = escapeHtml(s.recommendedSessionId || '');
	      const agent = escapeHtml(s.recommendedAgent || '');
	      const reason = escapeHtml(s.reason || '');
	      const focusBtn = s.recommendedSessionId
	        ? `<button class="btn-secondary worktree-inspector-mini-btn" type="button" data-focus-session="${escapeHtml(s.recommendedSessionId)}">Focus</button>`
	        : '';
	      const prBtn = url ? `<button class="btn-secondary worktree-inspector-mini-btn" type="button" data-open-url="${url}">PR</button>` : '';
	      return `<tr><td>${title}</td><td class="mono">${repo}</td><td class="mono">${agent || '—'}</td><td class="mono">${sid || '—'}</td><td class="mono">${reason}</td><td>${prBtn} ${focusBtn}</td></tr>`;
	    }).join('');

	    bodyEl.innerHTML = `
	      <div class="dashboard-telemetry-muted">Generated: ${escapeHtml(data.generatedAt)} • PR tasks: ${escapeHtml(String(data.totalTasks || 0))}</div>
	      <table class="worktree-inspector-table" style="margin-top:10px;">
	        <thead>
	          <tr>
	            <th>Task</th>
	            <th>Repo</th>
	            <th>Agent</th>
	            <th>Suggested terminal</th>
	            <th>Reason</th>
	            <th>Actions</th>
	          </tr>
	        </thead>
	        <tbody>
	          ${rows || `<tr><td colspan="6" style="opacity:0.8;">No PR tasks found.</td></tr>`}
	        </tbody>
	      </table>
	    `;

	    bodyEl.querySelectorAll('[data-open-url]').forEach((btn) => {
	      btn.addEventListener('click', () => {
	        const u = String(btn?.dataset?.openUrl || '').trim();
	        if (!u) return;
	        try { window.open(u, '_blank'); } catch {}
	      });
	    });
	    bodyEl.querySelectorAll('[data-focus-session]').forEach((btn) => {
	      btn.addEventListener('click', () => {
	        const sid2 = String(btn?.dataset?.focusSession || '').trim();
	        if (!sid2) return;
	        try {
	          this.orchestrator?.hideDashboard?.();
	          setTimeout(() => {
	            try { this.orchestrator?.focusTerminal?.(sid2); } catch {}
	          }, 50);
	        } catch {}
	      });
	    });
	  }

	  async showProjectHealthOverlay() {
	    const existing = document.getElementById('dashboard-project-health-overlay');
	    if (existing) {
	      existing.classList.remove('hidden');
	      return;
	    }

	    const overlay = document.createElement('div');
	    overlay.id = 'dashboard-project-health-overlay';
	    overlay.className = 'dashboard-telemetry-overlay';
	    overlay.innerHTML = `
	      <div class="dashboard-telemetry-panel" role="dialog" aria-label="Project health dashboard">
	        <div class="dashboard-telemetry-header">
	          <div class="dashboard-telemetry-title">Projects — Health</div>
	          <button class="dashboard-topbar-btn" id="dashboard-project-health-close" title="Close (Esc)">✕</button>
	        </div>
	        <div class="dashboard-telemetry-controls">
	          <label class="dashboard-telemetry-field">
	            <span>Lookback</span>
	            <select id="dashboard-project-health-lookback">
	              <option value="168">7d</option>
	              <option value="336" selected>14d</option>
	              <option value="720">30d</option>
	              <option value="2160">90d</option>
	            </select>
	          </label>
	          <label class="dashboard-telemetry-field">
	            <span>Bucket</span>
	            <select id="dashboard-project-health-bucket">
	              <option value="360">6h</option>
	              <option value="720">12h</option>
	              <option value="1440" selected>1d</option>
	              <option value="2880">2d</option>
	            </select>
	          </label>
	          <label class="dashboard-telemetry-field" style="min-width: 220px; flex: 1;">
	            <span>Filter</span>
	            <input id="dashboard-project-health-filter" type="text" placeholder="owner/repo…" />
	          </label>
	          <div class="dashboard-telemetry-actions">
	            <button class="btn-secondary" type="button" id="dashboard-project-health-refresh">Refresh</button>
	          </div>
	        </div>
	        <div id="dashboard-project-health-body" class="dashboard-telemetry-body">Loading…</div>
	      </div>
	    `;

	    document.body.appendChild(overlay);

	    const close = () => this.hideProjectHealthOverlay();
	    overlay.addEventListener('click', (e) => {
	      if (e.target === overlay) close();
	    });
	    overlay.querySelector('#dashboard-project-health-close')?.addEventListener('click', close);

	    const onKey = (e) => {
	      if (e.key !== 'Escape') return;
	      const el = document.getElementById('dashboard-project-health-overlay');
	      if (!el || el.classList.contains('hidden')) return;
	      close();
	    };
	    overlay._escHandler = onKey;
	    document.addEventListener('keydown', onKey);

	    const lookbackEl = overlay.querySelector('#dashboard-project-health-lookback');
	    const bucketEl = overlay.querySelector('#dashboard-project-health-bucket');
	    const filterEl = overlay.querySelector('#dashboard-project-health-filter');

	    overlay.querySelector('#dashboard-project-health-refresh')?.addEventListener('click', () => {
	      this.loadProjectHealthDetails({
	        lookbackHours: Number(lookbackEl?.value ?? 336),
	        bucketMinutes: Number(bucketEl?.value ?? 1440)
	      });
	    });

	    lookbackEl?.addEventListener('change', () => {
	      this.loadProjectHealthDetails({
	        lookbackHours: Number(lookbackEl?.value ?? 336),
	        bucketMinutes: Number(bucketEl?.value ?? 1440)
	      });
	    });

	    bucketEl?.addEventListener('change', () => {
	      this.loadProjectHealthDetails({
	        lookbackHours: Number(lookbackEl?.value ?? 336),
	        bucketMinutes: Number(bucketEl?.value ?? 1440)
	      });
	    });

	    filterEl?.addEventListener('input', () => {
	      try {
	        const body = document.getElementById('dashboard-project-health-body');
	        if (!body) return;
	        body.innerHTML = this.renderProjectHealthDetails(this._projectHealthData || {}, { filter: String(filterEl.value || '') });
	        this.attachProjectHealthHandlers();
	      } catch {}
	    });

	    await this.loadProjectHealthDetails({ lookbackHours: 336, bucketMinutes: 1440 });
	  }

	  hideProjectHealthOverlay() {
	    const overlay = document.getElementById('dashboard-project-health-overlay');
	    if (!overlay) return;
	    overlay.classList.add('hidden');
	    const handler = overlay._escHandler;
	    if (handler) {
	      document.removeEventListener('keydown', handler);
	      overlay._escHandler = null;
	    }
	    overlay.remove();
	  }

	  async loadProjectHealthDetails({ lookbackHours = 336, bucketMinutes = 1440 } = {}) {
	    const body = document.getElementById('dashboard-project-health-body');
	    const overlay = document.getElementById('dashboard-project-health-overlay');
	    if (!overlay || !body) return;
	    body.textContent = 'Loading…';

	    const hours = Number(lookbackHours);
	    const bucket = Number(bucketMinutes);
	    const safeHours = Number.isFinite(hours) && hours > 0 ? hours : 336;
	    const safeBucket = Number.isFinite(bucket) && bucket > 0 ? bucket : 1440;

	    const filterEl = overlay.querySelector('#dashboard-project-health-filter');
	    const filter = String(filterEl?.value || '');

	    try {
	      const url = `/api/process/projects/health?lookbackHours=${encodeURIComponent(String(safeHours))}&bucketMinutes=${encodeURIComponent(String(safeBucket))}`;
	      const res = await fetch(url).catch(() => null);
	      const data = res ? await res.json().catch(() => ({})) : {};
	      if (!res || !res.ok) {
	        body.textContent = 'Failed to load.';
	        return;
	      }
	      this._projectHealthData = data;
	      body.innerHTML = this.renderProjectHealthDetails(data, { filter });
	      this.attachProjectHealthHandlers();
	    } catch {
	      body.textContent = 'Failed to load.';
	    }
	  }

	  attachProjectHealthHandlers() {
	    const root = document.getElementById('dashboard-project-health-body');
	    if (!root) return;
	    root.querySelectorAll('[data-open-repo-health]').forEach((btn) => {
	      btn.addEventListener('click', () => {
	        const repo = btn.getAttribute('data-open-repo-health') || '';
	        if (!repo) return;
	        try {
	          localStorage.setItem('prs-panel-repo', repo);
	        } catch {}
	        try {
	          this.orchestrator?.showPRsPanel?.();
	        } catch {}
	      });
	    });
	  }

	  renderProjectHealthDetails(data, { filter = '' } = {}) {
	    const escapeHtml = (value) => String(value ?? '')
	      .replace(/&/g, '&amp;')
	      .replace(/</g, '&lt;')
	      .replace(/>/g, '&gt;');

	    const repos = Array.isArray(data?.repos) ? data.repos : [];
	    const totals = data?.totals || {};
	    const filterText = String(filter || '').trim().toLowerCase();

	    const pickWorst = (counts) => {
	      const c = counts && typeof counts === 'object' ? counts : {};
	      if (Number(c.critical || 0) > 0) return 'critical';
	      if (Number(c.high || 0) > 0) return 'high';
	      if (Number(c.medium || 0) > 0) return 'medium';
	      if (Number(c.low || 0) > 0) return 'low';
	      return '';
	    };

	    const riskChip = (risk) => {
	      const r = String(risk || '').trim().toLowerCase();
	      if (!r) return '';
	      const cls = (r === 'critical' || r === 'high') ? 'level-warn' : '';
	      return `<span class="process-chip ${cls}">${escapeHtml(r)}</span>`;
	    };

	    const fmtHours = (n) => {
	      const v = Number(n);
	      if (!Number.isFinite(v) || v <= 0) return '—';
	      if (v < 2) return `${Math.round(v * 60)}m`;
	      if (v < 48) return `${v.toFixed(1)}h`;
	      const d = v / 24;
	      return `${d.toFixed(1)}d`;
	    };

	    const spark = (series) => {
	      const rows = Array.isArray(series) ? series : [];
	      if (!rows.length) return '';
	      const nets = rows.map((b) => Number(b?.createdCount || 0) - Number(b?.mergedCount || 0));
	      const maxAbs = Math.max(1, ...nets.map(n => Math.abs(n)));
	      return `
	        <div style="display:flex; align-items:flex-end; gap:2px; height:26px;">
	          ${rows.map((b, idx) => {
	            const net = nets[idx];
	            const abs = Math.abs(net);
	            const h = Math.max(2, Math.round(24 * abs / maxAbs));
	            const color = net > 0 ? '#d19a2b' : (net < 0 ? '#2dbf71' : '#4a5568');
	            const label = `${new Date(Number(b?.t || 0)).toLocaleDateString()} • net ${net}`;
	            return `<div style="width:6px; height:${h}px; background:${color}; border-radius:2px; opacity:0.9;" title="${escapeHtml(label)}"></div>`;
	          }).join('')}
	        </div>
	      `;
	    };

	    const filtered = filterText
	      ? repos.filter(r => String(r?.repo || '').toLowerCase().includes(filterText))
	      : repos;

	    return `
	      <div class="dashboard-telemetry-meta">
	        <div>Repos <strong>${Number(totals?.repos ?? filtered.length ?? 0)}</strong></div>
	        <div>Open backlog <strong>${Number(totals?.openBacklog ?? 0)}</strong></div>
	        <div>Created <strong>${Number(totals?.createdCount ?? 0)}</strong> • Merged <strong>${Number(totals?.mergedCount ?? 0)}</strong> • needs_fix <strong>${Number(totals?.needsFixCount ?? 0)}</strong></div>
	      </div>
	      <div style="display:flex; flex-direction:column; gap:10px;">
	        ${filtered.length ? filtered.map((r) => {
	          const repo = String(r?.repo || '').trim();
	          const t = r?.totals || {};
	          const open = Number(r?.openBacklog ?? 0);
	          const created = Number(t?.createdCount ?? 0);
	          const merged = Number(t?.mergedCount ?? 0);
	          const needsFix = Number(t?.needsFixCount ?? 0);
	          const worst = pickWorst(r?.openRiskCounts);
	          const avgCycle = fmtHours(t?.avgCycleHours);
	          const p50Cycle = fmtHours(t?.p50CycleHours);
	          return `
	            <div class="dashboard-telemetry-meta" style="display:flex; justify-content:space-between; gap:14px;">
	              <div style="min-width:0; flex:1; display:flex; flex-direction:column; gap:6px;">
	                <div style="display:flex; align-items:center; gap:10px;">
	                  <button class="btn-secondary" type="button" data-open-repo-health="${escapeHtml(repo)}" title="Open PRs filtered to ${escapeHtml(repo)}" style="max-width: 520px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
	                    ${escapeHtml(repo)}
	                  </button>
	                  ${worst ? riskChip(worst) : ''}
	                  <span style="opacity:0.8;">open <strong>${open}</strong></span>
	                </div>
	                <div style="opacity:0.9;">
	                  created <strong>${created}</strong> • merged <strong>${merged}</strong> • needs_fix <strong>${needsFix}</strong>
	                  <span style="opacity:0.75;"> • cycle avg <strong>${escapeHtml(avgCycle)}</strong> • p50 <strong>${escapeHtml(p50Cycle)}</strong></span>
	                </div>
	              </div>
	              <div style="flex:0 0 auto; display:flex; align-items:center;">
	                ${spark(r?.series)}
	              </div>
	            </div>
	          `;
	        }).join('') : `<div style="opacity:0.8;">No project records found.</div>`}
	      </div>
	    `;
	  }

	  async loadTelemetryDetails({ lookbackHours = 24, bucketMinutes = 60 } = {}) {
	    const overlay = document.getElementById('dashboard-telemetry-overlay');
	    const body = document.getElementById('dashboard-telemetry-body');
	    if (!overlay || !body) return;
	    body.textContent = 'Loading…';

	    const hours = Number(lookbackHours);
	    const bucket = Number(bucketMinutes);
	    const safeHours = Number.isFinite(hours) && hours > 0 ? hours : 24;
	    const safeBucket = Number.isFinite(bucket) && bucket > 0 ? bucket : 60;
	    const url = `/api/process/telemetry/details?lookbackHours=${encodeURIComponent(String(safeHours))}&bucketMinutes=${encodeURIComponent(String(safeBucket))}`;

	    try {
	      const res = await fetch(url).catch(() => null);
	      const data = res ? await res.json().catch(() => ({})) : {};
	      if (!res || !res.ok) {
	        body.textContent = 'Failed to load.';
	        return;
	      }
	      body.innerHTML = this.renderTelemetryDetails(data);
	    } catch {
	      body.textContent = 'Failed to load.';
	    }
	  }

	  async createTelemetrySnapshotLink({ lookbackHours = 24, bucketMinutes = 60 } = {}) {
	    const hours = Number(lookbackHours);
	    const bucket = Number(bucketMinutes);
	    const safeHours = Number.isFinite(hours) && hours > 0 ? hours : 24;
	    const safeBucket = Number.isFinite(bucket) && bucket > 0 ? bucket : 60;

	    try {
	      const res = await fetch('/api/process/telemetry/snapshots', {
	        method: 'POST',
	        headers: { 'Content-Type': 'application/json' },
	        body: JSON.stringify({ lookbackHours: safeHours, bucketMinutes: safeBucket })
	      }).catch(() => null);
	      const data = res ? await res.json().catch(() => ({})) : {};
	      if (!res || !res.ok) throw new Error(data?.error || 'Failed to create snapshot');

	      const url = String(data?.url || '').trim();
	      const full = url.startsWith('http') ? url : `${window.location.origin}${url}`;
	      await this.copyToClipboard(full);
	      try { this.orchestrator?.showToast?.('Snapshot link copied', 'success'); } catch {}
	    } catch (e) {
	      try { this.orchestrator?.showToast?.(String(e?.message || e), 'error'); } catch {}
	    }
	  }

	  async copyToClipboard(text) {
	    const t = String(text || '');
	    if (!t) return;
	    try {
	      if (navigator?.clipboard?.writeText) {
	        await navigator.clipboard.writeText(t);
	        return;
	      }
	    } catch {
	      // fall through
	    }
	    try {
	      window.prompt('Copy link:', t);
	    } catch {
	      // ignore
	    }
	  }

	  renderTelemetryDetails(data) {
	    const escapeHtml = (value) => String(value ?? '')
	      .replace(/&/g, '&amp;')
	      .replace(/</g, '&lt;')
	      .replace(/>/g, '&gt;');

	    const series = Array.isArray(data?.series) ? data.series : [];
	    const bucketMinutes = Number(data?.bucketMinutes ?? 60);
	    const reviewedCount = Number(data?.reviewedCount ?? 0);
	    const promptSentCount = Number(data?.promptSentCount ?? 0);
	    const doneCount = Number(data?.doneCount ?? 0);
	    const avgReviewSeconds = Number.isFinite(Number(data?.avgReviewSeconds)) ? Number(data.avgReviewSeconds) : null;
	    const avgPromptChars = Number.isFinite(Number(data?.avgPromptChars)) ? Number(data.avgPromptChars) : null;
	    const avgVerifyMinutes = Number.isFinite(Number(data?.avgVerifyMinutes)) ? Number(data.avgVerifyMinutes) : null;
	    const oc = (data?.outcomeCounts && typeof data.outcomeCounts === 'object') ? data.outcomeCounts : {};

	    const formatSeconds = (n) => {
	      const v = Number(n);
	      if (!Number.isFinite(v)) return '—';
	      if (v < 60) return `${Math.round(v)}s`;
	      const m = v / 60;
	      if (m < 60) return `${Math.round(m)}m`;
	      const h = m / 60;
	      return `${h.toFixed(1)}h`;
	    };

	    const sparkline = (points, key, { width = 460, height = 64 } = {}) => {
	      const vals = points.map((p) => Number(p?.[key])).filter((v) => Number.isFinite(v));
	      if (vals.length < 2) {
	        return `<div class="telemetry-empty">Not enough data.</div>`;
	      }
	      const min = Math.min(...vals);
	      const max = Math.max(...vals);
	      const range = max - min || 1;
	      const pad = 6;
	      const plotW = width - pad * 2;
	      const plotH = height - pad * 2;
	      const coords = points.map((p, idx) => {
	        const v = Number(p?.[key]);
	        if (!Number.isFinite(v)) return null;
	        const x = pad + (idx / (points.length - 1)) * plotW;
	        const y = pad + (1 - (v - min) / range) * plotH;
	        return `${x.toFixed(2)},${y.toFixed(2)}`;
	      }).filter(Boolean);
	      if (coords.length < 2) return `<div class="telemetry-empty">Not enough data.</div>`;
	      return `
	        <svg class="telemetry-sparkline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="Trend">
	          <polyline fill="none" stroke="var(--accent-primary)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${coords.join(' ')}"></polyline>
	        </svg>
	      `;
	    };

	    const histogram = (hist, { formatLabel = null } = {}) => {
	      const bins = Array.isArray(hist?.bins) ? hist.bins : [];
	      const maxCount = Number(hist?.maxCount ?? 0) || 0;
	      if (!bins.length || maxCount <= 0) return `<div class="telemetry-empty">No samples.</div>`;
	      const labelFor = (b) => {
	        const mid = (Number(b?.min) + Number(b?.max)) / 2;
	        if (typeof formatLabel === 'function') return formatLabel(mid);
	        return String(Math.round(mid));
	      };
	      return `
	        <div class="telemetry-bar-chart" role="img" aria-label="Histogram">
	          ${bins.map((b) => {
	            const c = Number(b?.count ?? 0) || 0;
	            const h = Math.round((c / maxCount) * 100);
	            return `<div class="telemetry-bar" title="${escapeHtml(labelFor(b))}: ${c}" style="height:${h}%;"></div>`;
	          }).join('')}
	        </div>
	      `;
	    };

	    const reviewHist = data?.histograms?.reviewSeconds;
	    const promptHist = data?.histograms?.promptChars;

	    return `
	      <div class="dashboard-telemetry-meta">
	        <div>Bucket <strong>${escapeHtml(bucketMinutes)}m</strong></div>
	        <div>Reviews <strong>${reviewedCount}</strong> • prompts <strong>${promptSentCount}</strong> • done <strong>${doneCount}</strong></div>
	        <div>Avg review <strong>${escapeHtml(formatSeconds(avgReviewSeconds))}</strong> • avg prompt <strong>${avgPromptChars === null ? '—' : escapeHtml(Math.round(avgPromptChars))}</strong></div>
	        <div>Avg verify <strong>${avgVerifyMinutes === null ? '—' : escapeHtml(`${Math.round(avgVerifyMinutes)}m`)}</strong></div>
	        <div>Outcomes: approved <strong>${Number(oc?.approved ?? 0)}</strong> • needs_fix <strong>${Number(oc?.needs_fix ?? 0)}</strong> • commented <strong>${Number(oc?.commented ?? 0)}</strong></div>
	      </div>
	      <div class="telemetry-chart-grid">
	        <div class="telemetry-chart-card">
	          <div class="telemetry-chart-title">Avg review time</div>
	          ${sparkline(series, 'avgReviewSeconds', { width: 520, height: 72 })}
	        </div>
	        <div class="telemetry-chart-card">
	          <div class="telemetry-chart-title">Avg prompt chars</div>
	          ${sparkline(series, 'avgPromptChars', { width: 520, height: 72 })}
	        </div>
	        <div class="telemetry-chart-card">
	          <div class="telemetry-chart-title">Done throughput</div>
	          ${sparkline(series, 'doneCount', { width: 520, height: 72 })}
	        </div>
	      </div>
	      <div class="telemetry-chart-grid">
	        <div class="telemetry-chart-card">
	          <div class="telemetry-chart-title">Review time distribution</div>
	          ${histogram(reviewHist, { formatLabel: (v) => formatSeconds(v) })}
	        </div>
	        <div class="telemetry-chart-card">
	          <div class="telemetry-chart-title">Prompt size distribution</div>
	          ${histogram(promptHist, { formatLabel: (v) => `${Math.round(Number(v) || 0)}` })}
	        </div>
	      </div>
	    `;
	  }

  generateWorkspaceCard(workspace, isActive) {
    const lastUsed = this.getLastUsed(workspace);
    const activityCount = this.getActivityCount(workspace.id);
    const terminalPairs = Array.isArray(workspace.terminals)
      ? Math.floor(workspace.terminals.length / 2)
      : (workspace.terminals?.pairs ?? 0);
	    const access = (workspace.access || 'unknown').toLowerCase();
	    const health = workspace?.health && typeof workspace.health === 'object' ? workspace.health : null;
	    const staleCount = Number(health?.staleCandidates?.length || 0);
	    const removedCount = Number(health?.removedTerminals?.length || 0);
	    const dedupedCount = Number(health?.dedupedTerminalIds?.length || 0);
	    const fixedCount = Number(health?.fixedWorktreePaths?.length || 0);
	    const warnCount = staleCount + removedCount + dedupedCount;
	    const warnChip = warnCount
	      ? `<span class="process-chip level-warn" title="Workspace has stale/invalid terminal entries">⚠ ${warnCount}</span>`
	      : '';

	    return `
	      <div class="workspace-card ${isActive ? 'active' : ''}" data-workspace-id="${workspace.id}">
	        <div class="workspace-card-header">
	          <span class="workspace-icon">${workspace.icon}</span>
	          <div class="workspace-info">
	            <h3>${workspace.name}</h3>
	            <p class="workspace-type">${this.getWorkspaceTypeLabel(workspace.type)}</p>
	          </div>
	          ${warnChip}
	        </div>

	        <div class="workspace-card-body">
	          <div class="workspace-stats">
            <div class="stat">
              <span class="stat-value">${activityCount}</span>
              <span class="stat-label">active</span>
            </div>
            <div class="stat">
              <span class="stat-value">${terminalPairs}</span>
              <span class="stat-label">terminals</span>
            </div>
          </div>

	          <div class="workspace-meta">
	            <p class="last-used">${lastUsed}</p>
	            <p class="access-level">${this.getAccessLevelIcon(access)} ${access}</p>
	          </div>

	          ${warnCount ? `
	            <div class="workspace-health" style="margin-top:10px; padding:8px 10px; border:1px solid var(--border-color); border-radius:10px; background: rgba(245, 158, 11, 0.08);">
	              <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
	                <div style="opacity:0.9;">
	                  <strong>Workspace cleanup</strong>
	                  <span style="opacity:0.85; margin-left:8px;">
	                    ${removedCount ? `${removedCount} removed` : ''}${removedCount && dedupedCount ? ' • ' : ''}${dedupedCount ? `${dedupedCount} deduped` : ''}${(removedCount || dedupedCount) && staleCount ? ' • ' : ''}${staleCount ? `${staleCount} stale` : ''}
	                  </span>
	                </div>
	                <button class="btn-secondary workspace-cleanup-btn" type="button" title="Remove stale/invalid terminals from this workspace config">🧹 Clean</button>
	              </div>
	              ${fixedCount ? `<div style="margin-top:6px; opacity:0.85;">Fixed ${fixedCount} worktree path${fixedCount === 1 ? '' : 's'}.</div>` : ''}
	            </div>
	          ` : ''}
	        </div>

	        <div class="workspace-card-footer">
	          <button class="btn-primary workspace-open-btn">
	            Open Workspace
	          </button>
	          <button class="btn-secondary workspace-export-btn" title="Export workspace config (JSON)">
	            ⬇
	          </button>
	          <button class="btn-secondary workspace-cleanup-btn" title="Remove stale/invalid terminals from this workspace config">
	            🧹
	          </button>
	          <button class="btn-danger workspace-delete-btn" title="Delete workspace (keeps worktrees)">
	            🗑️
	          </button>
	        </div>
	      </div>
	    `;
	  }

  generateCreateWorkspaceCard() {
    return `
      <div class="workspace-card create-card">
        <div class="workspace-card-header">
          <span class="workspace-icon">➕</span>
          <div class="workspace-info">
            <h3>Create New</h3>
            <p class="workspace-type">Workspace</p>
          </div>
        </div>

        <div class="workspace-card-body">
          <p>Set up a new development environment</p>
        </div>

        <div class="workspace-card-footer">
          <button class="btn-primary workspace-create-btn">Create Workspace</button>
          <button class="btn-cta-empty workspace-create-empty-btn">One‑Click Empty</button>
          <button class="btn-secondary workspace-import-btn" title="Import a workspace config (JSON)">⬆ Import</button>
        </div>
      </div>
    `;
  }

  generateQuickLinksHTML() {
    // Get globalShortcuts from config
    const globalShortcuts = this.orchestrator.orchestratorConfig?.globalShortcuts || [];

    // Check if QuickLinks has actual data
    const hasQuickLinksData = this.quickLinks &&
      (this.quickLinks.data?.favorites?.length > 0 ||
       this.quickLinks.data?.recentSessions?.length > 0 ||
       this.quickLinks.data?.customLinks?.length > 0 ||
       this.quickLinks.data?.products?.length > 0);

    // If QuickLinks has data, use it alongside globalShortcuts
    if (hasQuickLinksData) {
      return this.quickLinks.generateDashboardHTML();
    }

    // Otherwise show globalShortcuts
    if (globalShortcuts.length === 0) {
      return '<div class="quick-links-empty">No links configured. Add shortcuts in Settings.</div>';
    }

    return globalShortcuts.map(shortcut => `
      <a href="${shortcut.url}" target="_blank" class="quick-link-item"
         title="${shortcut.label}">
        <span class="quick-link-icon">${shortcut.icon || '🔗'}</span>
        <span class="quick-link-label">${shortcut.label}</span>
      </a>
    `).join('') + `
      <button class="quick-link-item settings-link" onclick="window.orchestrator.showSettings()">
        <span class="quick-link-icon">⚙️</span>
        <span class="quick-link-label">Settings</span>
      </button>
      <button class="quick-link-item setup-link" onclick="window.dashboard.installWindowsStartup()" title="Setup auto-start on Windows login">
        <span class="quick-link-icon">🚀</span>
        <span class="quick-link-label">Setup Windows Startup</span>
      </button>
    `;
  }

  setupEventListeners() {
    // Back button to return to the current tabbed workspace view (when available)
    document.getElementById('dashboard-back-btn')?.addEventListener('click', () => {
      this.orchestrator.hideDashboard();
    });

    // Workspace card click handlers
    document.querySelectorAll('.workspace-open-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = e.target.closest('.workspace-card');
        const workspaceId = card.dataset.workspaceId;
        this.openWorkspace(workspaceId);
      });
    });

    document.querySelectorAll('.workspace-cleanup-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const card = e.target.closest('.workspace-card');
        const workspaceId = card?.dataset?.workspaceId;
        if (!workspaceId) return;
        await this.cleanupWorkspaceTerminals(workspaceId);
      });
    });

    // Workspace delete handlers
    document.querySelectorAll('.workspace-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = e.target.closest('.workspace-card');
        const workspaceId = card.dataset.workspaceId;
        const workspace = this.workspaces.find(ws => ws.id === workspaceId);
        this.confirmDeleteWorkspace(workspace);
      });
    });

    // Workspace export handlers
    document.querySelectorAll('.workspace-export-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = e.target.closest('.workspace-card');
        const workspaceId = card?.dataset?.workspaceId;
        if (workspaceId) this.downloadWorkspaceExport(workspaceId);
      });
    });

    // Create workspace button
    const createBtn = document.querySelector('.workspace-create-btn');
    if (createBtn) {
      createBtn.addEventListener('click', () => {
        this.showCreateWorkspaceWizard();
      });
    }

    const createEmptyBtn = document.querySelector('.workspace-create-empty-btn');
    if (createEmptyBtn) {
      createEmptyBtn.addEventListener('click', () => {
        this.createEmptyWorkspaceQuick();
      });
    }

    const importBtn = document.querySelector('.workspace-import-btn');
    if (importBtn) {
      importBtn.addEventListener('click', () => {
        this.importWorkspaceFromFile();
      });
    }

    // ESC: return to tabbed workspaces if dashboard was opened from there
    if (this._escHandler) {
      document.removeEventListener('keydown', this._escHandler);
    }
    this._escHandler = (e) => {
      if (e.key !== 'Escape' || !this.isVisible) return;
      if (this.orchestrator.tabManager?.tabs?.size) {
        this.orchestrator.hideDashboard();
      }
    };
    document.addEventListener('keydown', this._escHandler);
  }

  async cleanupWorkspaceTerminals(workspaceId) {
    const id = String(workspaceId || '').trim();
    if (!id) return;
    try {
      this.orchestrator?.showToast?.('Cleaning workspace terminals…', 'info');
      const res = await fetch(`/api/workspaces/${encodeURIComponent(id)}/cleanup-terminals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(String(data?.error || data?.message || 'Cleanup failed'));
      }
      const removed = Number(data?.health?.removedTerminals?.length || 0);
      const deduped = Number(data?.health?.dedupedTerminalIds?.length || 0);
      const msg = (removed || deduped)
        ? `Cleaned ${removed} removed • ${deduped} deduped`
        : 'No stale terminals found';
      this.orchestrator?.showToast?.(msg, 'success');

      // Refresh workspace list (from disk) so cards update.
      this.orchestrator.socket.emit('list-workspaces', { refresh: true });
      this.orchestrator.socket.once('workspaces-list', (workspaces) => {
        this.workspaces = workspaces;
        this.orchestrator.availableWorkspaces = workspaces;
        this.render();
      });
    } catch (err) {
      this.orchestrator?.showToast?.(`Cleanup failed: ${String(err?.message || err)}`, 'error');
    }
  }

  async openWorkspace(workspaceId) {
    console.log('Opening workspace:', workspaceId);

    // Get recovery settings
    const recoverySettings = this.orchestrator.userSettings?.global?.sessionRecovery || {};
    const recoveryEnabled = recoverySettings.enabled !== false;
    const recoveryMode = recoverySettings.mode || 'ask';

    // Check for recovery state first (if enabled)
    if (recoveryEnabled) {
      const recoveryInfo = await this.checkRecoveryState(workspaceId);
      if (recoveryInfo && recoveryInfo.recoverableSessions > 0) {
        // If the user previously dismissed this exact snapshot, don't nag again.
        const savedAt = String(recoveryInfo.savedAt || '').trim();
        const dismissKey = `orchestrator-recovery-dismissed:${workspaceId}`;
        let dismissedSnapshot = false;
        if (savedAt) {
          try {
            const dismissedAt = String(localStorage.getItem(dismissKey) || '').trim();
            if (dismissedAt && dismissedAt === savedAt) {
              console.log('Skipping recovery dialog - dismissed for this snapshot');
              dismissedSnapshot = true;
            } else {
              // Clear stale dismiss markers when the snapshot changes.
              if (dismissedAt) localStorage.removeItem(dismissKey);
            }
          } catch {
            // ignore
          }
        }

        if (dismissedSnapshot) {
          // Do nothing: proceed to open workspace with no recovery.
        } else if (recoveryMode === 'auto') {
          // Auto-recover all sessions
          this.pendingRecovery = { mode: 'all', sessions: recoveryInfo.sessions };
          console.log('Auto-recovering all sessions');
        } else if (recoveryMode === 'ask') {
          // Show recovery dialog and wait for user choice
          const shouldRecover = await this.showRecoveryDialog(workspaceId, recoveryInfo);
          if (shouldRecover === 'cancel') {
            return; // User cancelled
          }
          this.pendingRecovery = shouldRecover;
        }
        // If mode === 'skip', don't set pendingRecovery
      }
    }

    // Show loading state
    const card = document.querySelector(`[data-workspace-id="${workspaceId}"]`);
    if (card) {
      const btn = card.querySelector('.workspace-open-btn');
      if (btn) {
        const originalText = btn.textContent;
        btn.textContent = 'Loading...';
        btn.disabled = true;

        // Restore button after timeout
        setTimeout(() => {
          if (btn) {
            btn.textContent = originalText;
            btn.disabled = false;
          }
        }, 5000);
      }
    }

    // Emit workspace switch event
    this.orchestrator.socket.emit('switch-workspace', { workspaceId });

    // Wait for workspace-changed event
    this.orchestrator.socket.once('workspace-changed', ({ workspace, sessions }) => {
      console.log('Workspace switched to:', workspace.name);

      // Hide dashboard
      this.hide();

      // Show main content
      const mainContainer = document.querySelector('.main-container');
      const sidebar = document.querySelector('.sidebar');
      if (mainContainer) mainContainer.classList.remove('hidden');
      if (sidebar) sidebar.classList.remove('hidden');

      // Update orchestrator with new workspace
      this.orchestrator.currentWorkspace = workspace;

      // Trigger UI rebuild with new sessions
      this.orchestrator.handleInitialSessions(sessions);
    });
  }

  showCreateWorkspaceWizard(options = {}) {
    console.log('Opening workspace creation wizard...');
    if (!window.WorkspaceWizard) {
      console.error('WorkspaceWizard not loaded');
      return;
    }

    const wizard = new WorkspaceWizard(this.orchestrator);
    wizard.show(options);
  }

  async createEmptyWorkspaceQuick() {
    try {
      const timestamp = new Date();
      const stamp = timestamp.toISOString().replace(/[:T]/g, '-').slice(0, 19);
      const name = `Empty Workspace ${timestamp.toLocaleString()}`;
      const baseId = `empty-${stamp}`;
      const randomSuffix = Math.random().toString(36).slice(2, 6);
      let workspaceId = `${baseId}-${randomSuffix}`;

      // Ensure ID is unique against current list
      const existingIds = new Set(this.workspaces.map(ws => ws.id));
      if (existingIds.has(workspaceId)) {
        workspaceId = `${baseId}-${Math.random().toString(36).slice(2, 8)}`;
      }

      const workspaceConfig = {
        id: workspaceId,
        name,
        type: 'custom',
        icon: '🧱',
        description: 'Empty workspace (add worktrees later)',
        access: 'private',
        empty: true,
        repository: {
          path: '',
          masterBranch: 'master',
          remote: ''
        },
        worktrees: {
          enabled: false,
          count: 0,
          namingPattern: 'work{n}',
          autoCreate: false
        },
        terminals: [],
        launchSettings: {
          type: 'custom',
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
          primaryColor: '#0ea5e9',
          icon: '🧱'
        },
        notifications: {
          enabled: true,
          background: true,
          types: {},
          priority: 'normal'
        },
        workspaceType: 'mixed-repo',
        layout: {
          type: 'dynamic',
          arrangement: 'auto'
        }
      };

      const serverUrl = window.location.origin;
      const response = await fetch(`${serverUrl}/api/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workspaceConfig)
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(error || 'Failed to create empty workspace');
      }

      const workspace = await response.json();
      this.workspaces.push(workspace);

      // Switch to new workspace
      this.openWorkspace(workspaceId);

      this.orchestrator.showTemporaryMessage(`Empty workspace "${name}" created`, 'success');
    } catch (error) {
      console.error('Failed to create empty workspace:', error);
      alert('Failed to create empty workspace: ' + error.message);
    }
  }

  async downloadWorkspaceExport(workspaceId) {
    const id = String(workspaceId || '').trim();
    if (!id) return;
    try {
      const url = `/api/workspaces/${encodeURIComponent(id)}/export`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(await resp.text());
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${id}.workspace.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2500);
    } catch (err) {
      try { this.orchestrator?.showToast?.(`Export failed: ${String(err?.message || err)}`, 'error'); } catch {}
    }
  }

  async importWorkspaceFromFile() {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.style.display = 'none';
      document.body.appendChild(input);

      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        input.remove();
        if (!file) return;
        try {
          const text = await file.text();
          const payload = JSON.parse(text);
          const resp = await fetch('/api/workspaces/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok || !data?.ok) {
            throw new Error(String(data?.error || 'Import failed'));
          }
          try { this.orchestrator?.showToast?.('Workspace imported', 'success'); } catch {}
          await this.loadWorkspaces();
          this.render();
        } catch (err) {
          try { this.orchestrator?.showToast?.(`Import failed: ${String(err?.message || err)}`, 'error'); } catch {}
        }
      });

      input.click();
    } catch (err) {
      try { this.orchestrator?.showToast?.(`Import failed: ${String(err?.message || err)}`, 'error'); } catch {}
    }
  }

  // Helper methods
  isWorkspaceActive(workspace) {
    // For now, consider workspace active if it's the current one
    // In future, this could check for running sessions, recent activity, etc.
    return workspace.id === this.orchestrator.currentWorkspace?.id;
  }

  getLastUsed(workspace) {
    if (!workspace || typeof workspace !== 'object') return 'Last used: unknown';

    const timeAgo = this.formatTimeAgo(workspace.lastAccess);
    if (!timeAgo) return 'Last used: never';
    return `Last used: ${timeAgo}`;
  }

  getActivityCount(workspaceId) {
    // Placeholder - in future, track actual active sessions
    if (workspaceId === 'hyfire2') return '3/8';
    return '0/4';
  }

  /**
   * Format timestamp as relative time (shared with QuickLinks)
   */
  formatTimeAgo(timestamp) {
    if (!timestamp) return '';

    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';

    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
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

  getAccessLevelIcon(access) {
    const icons = {
      'private': '🔒',
      'team': '👥',
      'public': '🌍',
      'unknown': '❔'
    };
    return icons[access] || '🔒';
  }

  confirmDeleteWorkspace(workspace) {
    const confirmed = confirm(
      `⚠️ DELETE WORKSPACE?\n\n` +
      `Workspace: ${workspace.name}\n` +
      `Type: ${workspace.type}\n\n` +
      `This will:\n` +
      `✅ Delete the workspace configuration\n` +
      `✅ Keep all git worktrees and code intact\n` +
      `✅ Stop any running sessions\n\n` +
      `Are you sure?`
    );

    if (confirmed) {
      this.deleteWorkspace(workspace.id);
    }
  }

  async deleteWorkspace(workspaceId) {
    try {
      const serverUrl = window.location.origin;
      const response = await fetch(`${serverUrl}/api/workspaces/${workspaceId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        console.log(`Deleted workspace: ${workspaceId}`);

        // Remove from local array
        this.workspaces = this.workspaces.filter(ws => ws.id !== workspaceId);

        // Refresh dashboard
        this.show();

        // Show success message
        window.orchestrator?.showTemporaryMessage(`Workspace deleted successfully`, 'success');
      } else {
        const error = await response.text();
        console.error('Delete failed:', error);
        window.orchestrator?.showTemporaryMessage(`Failed to delete workspace: ${error}`, 'error');
      }
    } catch (error) {
      console.error('Error deleting workspace:', error);
      window.orchestrator?.showTemporaryMessage(`Error: ${error.message}`, 'error');
    }
  }

  async loadDashboardPorts() {
    const gridEl = document.getElementById('ports-dashboard-grid');
    if (!gridEl) return;

    const serverUrl = window.location.origin;

    try {
      const response = await fetch(`${serverUrl}/api/ports/scan`);
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();

      if (!data.ports || data.ports.length === 0) {
        gridEl.innerHTML = '<div class="ports-empty">No services currently running</div>';
        return;
      }

      gridEl.innerHTML = data.ports.map(p => {
        const context = p.project?.project
          ? `${p.project.project}${p.project.worktree ? ' • ' + p.project.worktree : ''}`
          : (p.cwd ? p.cwd.split('/').slice(-2).join('/') : '');

        return `
          <div class="port-dashboard-card ${p.type || ''}"
               onclick="window.open('${p.url}', '_blank')"
               title="${p.cwd || p.name}">
            <div class="port-card-icon">${p.icon || '❓'}</div>
            <div class="port-card-info">
              <span class="port-card-name">${p.name}</span>
              <span class="port-card-context">${context}</span>
            </div>
            <div class="port-card-port">:${p.port}</div>
          </div>
        `;
      }).join('');

    } catch (error) {
      console.error('Failed to load dashboard ports:', error);
      gridEl.innerHTML = '<div class="ports-empty">Failed to load services</div>';
    }
  }

  async installWindowsStartup() {
    const serverUrl = window.location.port === '2080' ? 'http://localhost:3000' :
                      window.location.port === '2081' ? 'http://localhost:4000' :
                      window.location.origin;

    // First check if we're on WSL
    try {
      const infoRes = await fetch(`${serverUrl}/api/startup/info`);
      const info = await infoRes.json();

      if (!info.isWSL) {
        alert('This feature is for Windows (WSL) only.\n\nFor native Linux, run:\n  scripts/linux/install-startup.sh');
        return;
      }

      if (!info.scriptsAvailable.windows) {
        alert('Windows startup scripts not found.\n\nMake sure scripts/windows/ exists in the repo.');
        return;
      }

      // Confirm installation
      const confirmed = confirm(
        '🚀 Setup Windows Startup\n\n' +
        'This will:\n' +
        '• Create a Windows Task Scheduler task\n' +
        '• Add a desktop shortcut\n' +
        '• Auto-start orchestrator on Windows login\n\n' +
        'The startup script waits for WSL to be ready before launching.\n\n' +
        'Continue?'
      );

      if (!confirmed) return;

      // Run the installer
      const response = await fetch(`${serverUrl}/api/startup/install-windows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        const result = await response.json();
        alert('✅ Windows Startup Setup Complete!\n\n' +
              'The orchestrator will now start automatically when you log into Windows.\n\n' +
              'A desktop shortcut was also created.');
        console.log('Startup install output:', result.output);
      } else {
        const error = await response.json();
        alert('❌ Setup Failed\n\n' + (error.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Failed to install Windows startup:', error);
      alert('❌ Setup Failed\n\n' + error.message);
    }
  }

  async checkRecoveryState(workspaceId) {
    const serverUrl = window.location.port === '2080' ? 'http://localhost:3000' :
                      window.location.port === '2081' ? 'http://localhost:4000' :
                      window.location.origin;

    try {
      const response = await fetch(`${serverUrl}/api/recovery/${encodeURIComponent(workspaceId)}`);
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      console.error('Failed to check recovery state:', error);
    }
    return null;
  }

  showRecoveryDialog(workspaceId, recoveryInfo) {
    return new Promise((resolve) => {
      // Remove existing dialog
      const existing = document.getElementById('recovery-dialog');
      if (existing) existing.remove();

      const sessions = recoveryInfo.sessions || [];
      const savedAt = recoveryInfo.savedAt ? new Date(recoveryInfo.savedAt).toLocaleString() : 'Unknown';
      const savedAtRaw = String(recoveryInfo.savedAt || '').trim();

      const modal = document.createElement('div');
      modal.id = 'recovery-dialog';
      modal.className = 'modal recovery-modal';
      modal.innerHTML = `
        <div class="modal-content">
          <div class="recovery-header">
            <h2>🔄 Session Recovery</h2>
            <button class="close-btn" onclick="this.closest('.modal').remove()">×</button>
          </div>
          <div class="recovery-info">
            Found ${sessions.length} recoverable session${sessions.length !== 1 ? 's' : ''} from ${savedAt}
          </div>
          <div class="recovery-sessions">
            ${sessions.length === 0 ? '<div class="no-recovery">No sessions to recover</div>' :
              sessions.map((s, i) => `
                <div class="recovery-session" data-session-id="${s.sessionId}">
                  <input type="checkbox" class="recovery-checkbox" id="recover-${i}" checked>
                  <label for="recover-${i}" class="recovery-session-info">
                    <div class="recovery-session-id">${s.sessionId}</div>
                    <div class="recovery-session-details">
                      ${s.lastCwd ? `<span class="recovery-session-cwd">📁 ${s.lastCwd.split('/').slice(-2).join('/')}</span>` : ''}
                      ${s.lastAgent ? `<span class="recovery-session-agent">${s.lastAgent}</span>` : ''}
                      ${s.lastConversationId ? `<span>💬 ${s.lastConversationId.slice(0, 8)}...</span>` : ''}
                    </div>
                  </label>
                </div>
              `).join('')}
          </div>
          <div class="recovery-footer">
            <button class="btn-recovery btn-recovery-skip" id="recovery-skip" title="Hide this prompt (does not delete recovery info)">
              Skip (hide)
            </button>
            <div class="recovery-actions">
              <button class="btn-recovery btn-recovery-clear" id="recovery-clear" title="Delete stored recovery info for this workspace (won't kill processes)">
                Clear
              </button>
              <button class="btn-recovery btn-recovery-selected" id="recovery-selected">
                Recover Selected
              </button>
              <button class="btn-recovery btn-recovery-all" id="recovery-all">
                Recover All
              </button>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      const serverUrl = window.location.port === '2080' ? 'http://localhost:3000' :
                        window.location.port === '2081' ? 'http://localhost:4000' :
                        window.location.origin;

      const setButtonsDisabled = (disabled) => {
        modal.querySelectorAll('button').forEach((btn) => { btn.disabled = !!disabled; });
      };

      const clearRecoverySessions = async (sessionIds) => {
        const ids = Array.isArray(sessionIds)
          ? sessionIds.map((s) => String(s || '').trim()).filter(Boolean)
          : [];
        if (!ids.length) return;
        await Promise.all(ids.map(async (id) => {
          try {
            await fetch(`${serverUrl}/api/recovery/${encodeURIComponent(workspaceId)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
          } catch {
            // best-effort
          }
        }));
      };

      // Event handlers
      modal.querySelector('.close-btn').onclick = () => {
        modal.remove();
        resolve('cancel');
      };

      modal.querySelector('#recovery-skip').onclick = () => {
        if (savedAtRaw) {
          try {
            localStorage.setItem(`orchestrator-recovery-dismissed:${workspaceId}`, savedAtRaw);
          } catch {
            // ignore
          }
        }
        modal.remove();
        resolve({ mode: 'skip', sessions: [] });
      };

      modal.querySelector('#recovery-clear').onclick = async () => {
        setButtonsDisabled(true);
        try {
          await fetch(`${serverUrl}/api/recovery/${encodeURIComponent(workspaceId)}`, { method: 'DELETE' });
        } catch (error) {
          console.error('Failed to clear recovery state:', error);
        } finally {
          modal.remove();
          resolve({ mode: 'skip', sessions: [] });
        }
      };

      modal.querySelector('#recovery-selected').onclick = async () => {
        const selected = [];
        modal.querySelectorAll('.recovery-session').forEach(el => {
          const checkbox = el.querySelector('.recovery-checkbox');
          if (checkbox.checked) {
            selected.push(sessions.find(s => s.sessionId === el.dataset.sessionId));
          }
        });
        setButtonsDisabled(true);
        try {
          await clearRecoverySessions(selected.map((s) => s?.sessionId));
        } finally {
          modal.remove();
          resolve({ mode: 'selected', sessions: selected });
        }
      };

      modal.querySelector('#recovery-all').onclick = async () => {
        setButtonsDisabled(true);
        try {
          await clearRecoverySessions(sessions.map((s) => s?.sessionId));
        } finally {
          modal.remove();
          resolve({ mode: 'all', sessions: sessions });
        }
      };

      // Toggle selection on row click
      modal.querySelectorAll('.recovery-session').forEach(el => {
        el.onclick = (e) => {
          if (e.target.tagName !== 'INPUT') {
            const checkbox = el.querySelector('.recovery-checkbox');
            checkbox.checked = !checkbox.checked;
            el.classList.toggle('selected', checkbox.checked);
          }
        };
      });
    });
  }
}

// Export for use in main app
window.Dashboard = Dashboard;
