/**
 * Commander Panel - Frontend UI for Commander Claude Code Terminal
 * This provides a terminal interface to the Commander, which is itself
 * a Claude Code instance running from the orchestrator directory.
 */

class CommanderPanel {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.isVisible = false;
    this.isRunning = false;
    this.isStarting = false;
    this.startCommanderPromise = null;
    // Always use same-origin API requests; the dev server proxies `/api` to the backend.
    this.serverUrl = window.location.origin;
    this.terminal = null;
    this.fitAddon = null;
    this.lastPasteAt = 0;
    this.pasteCooldownMs = 200;
    this.commandModeEnabled = this.loadCommanderCommandModePreference();
    this.commandCapture = null; // { display: string, text: string }
    this.lineBuffer = '';
    this.historyPending = false;
    this.lastSyncedSize = null;
    this.resizeObserver = null;
    this.inputChain = Promise.resolve();
    // Commander tabs: 'main' always exists; extra instances are cmd-2..cmd-6.
    this.activeInstance = 'main';
    this.tabs = new Map([['main', { label: 'Commander 1', terminal: null, fitAddon: null, isRunning: false, isStarting: false, lastSyncedSize: null }]]);

    // xterm's Canvas renderer occasionally leaves stale/garbled rows after a
    // burst of output while the browser tab was backgrounded (rendering gets
    // throttled while hidden). fitTerminalSoon() already forces a full
    // repaint — that's why manually resizing "fixes" it — so run the same
    // heal on focus/visibility regain and a slow background sweep, matching
    // the pattern terminal.js already uses for worktree terminals.
    this.healIntervalMs = 15_000;
    window.addEventListener('focus', () => this.healTerminal());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.healTerminal();
    });
    setInterval(() => {
      if (!document.hidden) this.healTerminal();
    }, this.healIntervalMs);
  }

  healTerminal() {
    if (!this.isVisible || !this.terminal) return;
    // Passive repaint only — this runs on a timer and on every tab/window
    // focus regain, so it must never steal keyboard focus into Commander
    // while the user is typing somewhere else on the page.
    this.fitTerminalSoon({ focus: false });
  }

  // Instance-scoped API URL: main uses the bare endpoint (back-compat),
  // extra tabs append ?instance=<id>.
  apiUrl(path) {
    if (this.activeInstance === 'main') return `${this.serverUrl}${path}`;
    const sep = path.includes('?') ? '&' : '?';
    return `${this.serverUrl}${path}${sep}instance=${encodeURIComponent(this.activeInstance)}`;
  }

  // Per-tab terminal container; created on demand, shown only when active.
  getActiveContainer() {
    if (this.activeInstance === 'main') return document.getElementById('commander-terminal');
    const id = `commander-terminal-${this.activeInstance}`;
    let el = document.getElementById(id);
    if (!el) {
      const mainEl = document.getElementById('commander-terminal');
      if (!mainEl) return null;
      el = document.createElement('div');
      el.className = 'commander-terminal';
      el.id = id;
      mainEl.parentElement.insertBefore(el, mainEl.nextSibling);
    }
    return el;
  }

  renderTabs() {
    const bar = document.getElementById('commander-tabbar');
    if (!bar) return;
    bar.replaceChildren();
    for (const [id, tab] of this.tabs) {
      const btn = document.createElement('button');
      btn.className = `commander-tab${id === this.activeInstance ? ' active' : ''}`;
      const label = document.createElement('span');
      label.className = 'commander-tab-label';
      label.textContent = tab.label || id;
      btn.appendChild(label);
      btn.title = 'Click to switch · double-click to rename';
      btn.addEventListener('click', () => this.switchTab(id));
      label.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.startTabRename(id, label);
      });
      if (id !== 'main') {
        const close = document.createElement('span');
        close.className = 'commander-tab-close';
        close.textContent = '×';
        close.title = 'Close this Commander';
        close.addEventListener('click', (e) => {
          e.stopPropagation();
          this.closeTab(id);
        });
        btn.appendChild(close);
      }
      bar.appendChild(btn);
    }
    if (this.tabs.size < 6) {
      const add = document.createElement('button');
      add.className = 'commander-tab commander-tab-add';
      add.textContent = '+';
      add.title = 'Start a new Commander';
      add.addEventListener('click', () => this.addTab());
      bar.appendChild(add);
    }
    const title = document.getElementById('commander-title-text');
    if (title) title.textContent = this.tabs.get(this.activeInstance)?.label || 'Commander';
  }

  startTabRename(id, labelEl) {
    labelEl.contentEditable = 'true';
    labelEl.focus();
    document.getSelection()?.selectAllChildren(labelEl);
    const finish = async (commit) => {
      labelEl.contentEditable = 'false';
      const text = labelEl.textContent.trim().slice(0, 40);
      if (!commit || !text) {
        this.renderTabs();
        return;
      }
      try {
        await fetch(`${this.serverUrl}/api/commander/instances/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: text })
        });
        const tab = this.tabs.get(id);
        if (tab) tab.label = text;
      } catch { /* keep old label */ }
      this.renderTabs();
    };
    labelEl.addEventListener('blur', () => finish(true), { once: true });
    labelEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); labelEl.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
  }

  saveActiveTabState() {
    const tab = this.tabs.get(this.activeInstance);
    if (!tab) return;
    tab.terminal = this.terminal;
    tab.fitAddon = this.fitAddon;
    tab.isRunning = this.isRunning;
    tab.isStarting = this.isStarting;
    tab.lastSyncedSize = this.lastSyncedSize;
  }

  switchTab(id) {
    if (!this.tabs.has(id) || id === this.activeInstance) return;
    this.saveActiveTabState();
    const prevContainer = this.getActiveContainer();
    if (prevContainer) prevContainer.style.display = 'none';
    this.activeInstance = id;
    const tab = this.tabs.get(id);
    this.terminal = tab.terminal;
    this.fitAddon = tab.fitAddon;
    this.isRunning = tab.isRunning;
    this.isStarting = tab.isStarting;
    this.lastSyncedSize = null; // PTY may have drifted while hidden
    const container = this.getActiveContainer();
    if (container) container.style.display = '';
    this.updateStatusBadge();
    this.renderTabs();
    if (this.terminal) {
      this.fitTerminalSoon();
    } else {
      // A tab restored by syncTabsFromServer() (its PTY survived a page
      // refresh) never had a terminal attached locally — check status and
      // attach one now instead of leaving the container blank.
      this.checkStatus().then((status) => {
        if (this.activeInstance !== id) return; // switched away while awaiting
        if (status.running) {
          this.initTerminal();
          if (this.fitAddon && this.terminal) {
            this.lastSyncedSize = null;
            this.fitTerminalSoon();
          }
        } else {
          this.setPlaceholderMessages(['Commander is not running.', 'Click ▶️ Start to launch it.']);
        }
      });
    }
  }

  async addTab() {
    try {
      const res = await fetch(`${this.serverUrl}/api/commander/instances`, { method: 'POST' });
      const result = await res.json();
      if (!res.ok || !result.id) {
        this.orchestrator?.showNotification?.(result.error || 'Could not create Commander', 'error');
        return;
      }
      this.tabs.set(result.id, { label: `Commander ${result.id.replace('cmd-', '')}`, terminal: null, fitAddon: null, isRunning: false, isStarting: false, lastSyncedSize: null });
      this.switchTab(result.id);
      // Same auto-start flow as first open: start the PTY, Claude follows.
      await this.startCommander();
    } catch (error) {
      console.error('Failed to add commander tab:', error);
    }
  }

  async closeTab(id) {
    if (id === 'main') return;
    try {
      await fetch(`${this.serverUrl}/api/commander/instances/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch { /* remove locally regardless */ }
    const tab = this.tabs.get(id);
    try { tab?.terminal?.dispose?.(); } catch { /* already gone */ }
    document.getElementById(`commander-terminal-${id}`)?.remove();
    this.tabs.delete(id);
    if (this.activeInstance === id) {
      this.activeInstance = 'main';
      const main = this.tabs.get('main');
      this.terminal = main.terminal;
      this.fitAddon = main.fitAddon;
      this.isRunning = main.isRunning;
      this.isStarting = main.isStarting;
      const container = this.getActiveContainer();
      if (container) container.style.display = '';
      this.fitTerminalSoon();
    }
    this.updateStatusBadge();
    this.renderTabs();
  }

  fitTerminalSoon({ focus = true } = {}) {
    if (!this.fitAddon || !this.terminal) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const beforeCols = this.terminal.cols;
        const beforeRows = this.terminal.rows;
        this.fitAddon?.fit();
        // xterm-addon-fit only clears+redraws the renderer when the computed
        // size actually changed — a same-size fit (the common heal-sweep
        // case: nothing was actually resized, we're just recovering from a
        // stale/garbled canvas) leaves it untouched, so refresh() alone
        // schedules a repaint of the SAME stale render state. Force two real
        // resizes (nudge a column down, then back) so the renderer always
        // reconstructs — this is what an actual window resize does that a
        // same-size fit + refresh doesn't, which is why manually resizing
        // "fixes" it but the passive heal sometimes didn't.
        if (this.terminal.cols === beforeCols && this.terminal.rows === beforeRows) {
          const nudgedCols = Math.max(beforeCols - 1, 2);
          this.terminal.resize(nudgedCols, beforeRows);
          this.terminal.resize(beforeCols, beforeRows);
        }
        this.syncTerminalSize();
        this.terminal?.refresh?.(0, Math.max(0, (this.terminal.rows || 1) - 1));
        if (focus) this.terminal?.focus();
      });
    });
  }

  /**
   * Tell the backend PTY the panel's real grid size so Claude Code
   * renders for the dimensions the user actually sees.
   */
  syncTerminalSize() {
    if (!this.terminal) return;
    const cols = this.terminal.cols;
    const rows = this.terminal.rows;
    if (!cols || !rows) return;
    if (this.lastSyncedSize && this.lastSyncedSize.cols === cols && this.lastSyncedSize.rows === rows) {
      return;
    }
    this.lastSyncedSize = { cols, rows };
    fetch(this.apiUrl('/api/commander/resize'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cols, rows })
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true) {
        // PTY not running yet (or resize rejected) - retry on the next fit
        this.lastSyncedSize = null;
      }
    }).catch((error) => {
      this.lastSyncedSize = null;
      console.error('Failed to sync terminal size:', error);
    });
  }

  /**
   * Initialize the Commander Panel
   */
  async init() {
    this.createPanelHTML();
    this.attachEventListeners();
    this.updateCommanderCmdModeButton();
    this.setupSocketListeners();
    await this.fetchStatus();
    this.updateCommanderTitle();
    this.syncTabsFromServer();
  }

  // The server is the source of truth for Commander instances (it re-adopts
  // surviving cmd-N panes after a restart). Without this sync, a recovered
  // Commander 2 has no tab and "+" would create Commander 3 instead.
  async syncTabsFromServer() {
    try {
      const res = await fetch(`${this.serverUrl}/api/commander/instances`);
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      const rows = Array.isArray(data?.instances) ? data.instances : [];
      let changed = false;
      for (const row of rows) {
        const id = String(row?.id || '').trim();
        if (!id || this.tabs.has(id)) continue;
        this.tabs.set(id, {
          label: String(row?.label || `Commander ${id.replace('cmd-', '')}`),
          terminal: null,
          fitAddon: null,
          isRunning: !!row?.running,
          isStarting: false,
          lastSyncedSize: null
        });
        changed = true;
      }
      if (changed) this.renderTabs();
    } catch {
      // panel works without the sync; tabs just reflect local state
    }
  }

  /**
   * Update the Commander title based on the configured agent
   */
  async updateCommanderTitle() {
    const titleEl = document.getElementById('commander-title-text');
    if (!titleEl) return;
    try {
      const res = await fetch(`${this.serverUrl}/api/agents`);
      if (res.ok) {
        const agents = await res.json();
        if (agents.length === 1) {
          titleEl.textContent = `Commander ${agents[0].name}`;
        } else {
          titleEl.textContent = 'Commander';
        }
      }
    } catch {
      // keep default
    }
  }

  /**
   * Create the panel HTML structure
   */
  createPanelHTML() {
    // Toggle button is now in index.html

    // Create backdrop
    const backdrop = document.createElement('div');
    backdrop.id = 'commander-backdrop';
    backdrop.className = 'commander-backdrop hidden';
    document.body.appendChild(backdrop);

    // Create panel
    const panel = document.createElement('div');
    panel.id = 'commander-panel';
    panel.className = 'commander-panel hidden';
    panel.innerHTML = `
      <div class="commander-titlebar">
        <div class="commander-titlebar-drag">
          <span class="commander-titlebar-icon">🎖️</span>
          <span class="commander-titlebar-text" id="commander-title-text">Commander</span>
          <span class="commander-status" id="commander-status-badge">Stopped</span>
        </div>
        <div class="commander-titlebar-controls">
          <button id="commander-minimize" class="commander-window-btn minimize" title="Minimize">─</button>
          <button id="commander-close" class="commander-window-btn close" title="Close">✕</button>
        </div>
      </div>
      <div class="commander-tabbar" id="commander-tabbar"></div>
      <div class="commander-toolbar">
        <button id="commander-start" class="commander-btn" title="Start terminal" data-ui-visibility="commander.startStop">▶️ Start</button>
        <button id="commander-stop" class="commander-btn" title="Stop terminal" data-ui-visibility="commander.startStop">⏹️ Stop</button>
        <div class="commander-toolbar-divider" data-ui-visibility="commander.startStop"></div>
        <button id="commander-cmdmode" class="commander-btn" title="Command mode: type / then a natural-language command to control the UI" data-ui-visibility="commander.cmdMode">
          ⌨️ Cmd:on
        </button>
        <button id="commander-start-claude" class="commander-btn" title="Start Claude Code" data-ui-visibility="commander.startClaude">
          Start Claude
        </button>
        <select id="commander-mode" data-ui-visibility="commander.modeSelect">
          <option value="fresh">Fresh</option>
          <option value="continue">Continue</option>
          <option value="resume">Resume</option>
        </select>
        <button id="commander-advice" class="commander-btn" title="Show workflow advice" data-ui-visibility="commander.advice">
          Advice
        </button>
      </div>
      <div class="commander-terminal" id="commander-terminal">
        <div class="commander-placeholder">
          <p>Commander is a Claude Code terminal for orchestrating your sessions.</p>
          <p>Opening Commander starts it automatically. Claude will launch as soon as the terminal is ready.</p>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    this.renderTabs();

    // Advice overlay (rendered on demand)
    const advice = document.createElement('div');
    advice.id = 'commander-advice-panel';
    advice.className = 'commander-advice hidden';
    advice.innerHTML = `
      <div class="commander-advice-header">
        <div class="commander-advice-title">Advisor</div>
        <div class="commander-advice-controls">
          <button id="commander-advice-refresh" class="commander-btn" title="Refresh advice">🔄</button>
          <button id="commander-advice-close" class="commander-window-btn close" title="Close">✕</button>
        </div>
      </div>
      <div id="commander-advice-body" class="commander-advice-body">Loading…</div>
    `;
    document.body.appendChild(advice);

    this.orchestrator?.applyUiVisibility?.();
  }

  setPlaceholderMessages(lines = []) {
    if (this.terminal) return;

    const container = this.getActiveContainer();
    if (!container) return;

    const messages = Array.isArray(lines) && lines.length
      ? lines
      : [
          'Commander is a Claude Code terminal for orchestrating your sessions.',
          'Opening Commander starts it automatically. Claude will launch as soon as the terminal is ready.'
        ];

    const placeholder = document.createElement('div');
    placeholder.className = 'commander-placeholder';
    messages.forEach((message) => {
      const paragraph = document.createElement('p');
      paragraph.textContent = message;
      placeholder.appendChild(paragraph);
    });
    container.replaceChildren(placeholder);
  }

  /**
   * Initialize XTerm.js terminal
   */
  initTerminal() {
    if (this.terminal) return;

    const container = this.getActiveContainer();
    if (!container) return;

    // Clear placeholder
    container.innerHTML = '';

    // Create terminal
    this.terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 12,
      fontFamily: 'Consolas, Monaco, "Courier New", monospace',
      scrollback: 5000,
      tabStopWidth: 4,
      bellStyle: 'none',
      allowTransparency: false,
      convertEol: false,
      wordSeparator: ' ()[]{}\'"',
      rightClickSelectsWord: true,
      // xterm 5.x removed rendererType/experimentalCharAtlas; the Canvas renderer is
      // loaded as an addon after open() below (DOM renderer leaves garbled rows).
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#c9d1d9',
        cursorAccent: '#0d1117',
        selection: 'rgba(88, 166, 255, 0.3)',
        black: '#484f58',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#b1bac4',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#f0f6fc'
      }
    });

    // Add fit addon
    this.fitAddon = new FitAddon.FitAddon();
    this.terminal.loadAddon(this.fitAddon);

    // Open terminal
    this.terminal.open(container);

    // Select the Canvas renderer (must be loaded after open()); falls back to the
    // DOM renderer if the addon is unavailable.
    try {
      if (typeof CanvasAddon !== 'undefined' && CanvasAddon.CanvasAddon) {
        this.canvasAddon = new CanvasAddon.CanvasAddon();
        this.terminal.loadAddon(this.canvasAddon);
      }
    } catch (err) {
      console.warn('Canvas renderer unavailable for Commander terminal, using DOM renderer:', err);
    }

    // Use requestAnimationFrame to ensure renderer is ready before fitting
    this.fitTerminalSoon();

    // Replay server-side history first; live socket output stays buffered
    // until the replay finishes so nothing is written out of order.
    this.historyPending = true;
    this.fetchInitialOutput();

    // Handle input - send to Commander service (with optional command-mode interception)
    this.terminal.onData((data) => {
      this.handleTerminalData(data);
    });

    // Clipboard shortcuts (Commander terminal is not managed by TerminalManager)
    this.terminal.attachCustomKeyEventHandler((e) => {
      const key = (e.key || '').toLowerCase();
      const isModifier = e.ctrlKey || e.metaKey;

      // Ctrl/Cmd+V: allow browser paste event (xterm otherwise treats this as ^V / SYN).
      // We handle the actual paste in the `paste` event listener below, which is more reliable
      // than navigator.clipboard.readText() across webviews and avoids image-only quirks.
      if (isModifier && !e.altKey && key === 'v') {
        return false;
      }

      // Ctrl/Cmd+C: copy selection
      if (isModifier && key === 'c' && this.terminal?.hasSelection?.()) {
        e.preventDefault();
        const selection = this.terminal.getSelection();
        navigator.clipboard.writeText(selection).catch(err => {
          console.error('Failed to copy selection:', err);
        });
        return false;
      }

      return true;
    });

    // Paste handler: use the paste event (clipboardData) instead of navigator.clipboard.readText().
    // This is more reliable across webviews and avoids image-only paste quirks.
    if (!container._commanderPasteHandler) {
      const onPaste = (e) => {
        const text = e.clipboardData?.getData('text/plain') || e.clipboardData?.getData('text') || '';
        if (!text) return;

        // Intercept before xterm/default paste handling to avoid double-paste or unexpected behavior.
        e.preventDefault();
        e.stopPropagation();

        const now = Date.now();
        if (now - this.lastPasteAt < this.pasteCooldownMs) {
          return;
        }
        this.lastPasteAt = now;

        this.sendInput(text);
      };

      container.addEventListener('paste', onPaste, true);
      container._commanderPasteHandler = onPaste;
    }

    // Click to focus
    container.addEventListener('click', () => {
      if (this.terminal) {
        this.terminal.focus();
      }
    });

    // Handle resize
    window.addEventListener('resize', () => {
      if (this.isVisible && this.fitAddon) {
        this.fitTerminalSoon();
      }
    });

    // Refit when the panel itself changes size, not just the window
    if (window.ResizeObserver && !this.resizeObserver) {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.isVisible && this.fitAddon) {
          this.fitTerminalSoon();
        }
      });
      this.resizeObserver.observe(container);
    }
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Toggle button
    document.getElementById('commander-toggle')?.addEventListener('click', () => this.toggle());

    // Window controls
    document.getElementById('commander-close')?.addEventListener('click', () => this.closeSession());
    document.getElementById('commander-minimize')?.addEventListener('click', () => this.hide());

    // Terminal controls
    document.getElementById('commander-start')?.addEventListener('click', () => this.startCommander());
    document.getElementById('commander-stop')?.addEventListener('click', () => this.stopCommander());

    // Start Claude button
    document.getElementById('commander-start-claude')?.addEventListener('click', () => {
      const mode = document.getElementById('commander-mode')?.value || 'fresh';
      this.startClaude(mode);
    });

    // Command mode toggle
    document.getElementById('commander-cmdmode')?.addEventListener('click', () => {
      this.commandModeEnabled = !this.commandModeEnabled;
      this.saveCommanderCommandModePreference(this.commandModeEnabled);
      this.updateCommanderCmdModeButton();
      if (this.terminal) {
        this.terminal.writeln(`\r\n[cmd] command mode ${this.commandModeEnabled ? 'enabled' : 'disabled'}\r`);
      }
    });

    document.getElementById('commander-advice')?.addEventListener('click', () => this.toggleAdvice());
    document.getElementById('commander-advice-close')?.addEventListener('click', () => this.hideAdvice());
    document.getElementById('commander-advice-refresh')?.addEventListener('click', () => this.fetchAdvice({ force: true }));

    // ESC to close - but only when the terminal itself isn't focused,
    // because inside the terminal ESC means "interrupt Claude Code".
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isVisible) {
        const terminalContainer = document.getElementById('commander-terminal');
        if (terminalContainer && terminalContainer.contains(e.target)) return;
        this.hide();
      }
    });

    // Click backdrop to close
    document.getElementById('commander-backdrop')?.addEventListener('click', () => this.hide());

    // Setup dragging
    this.setupDragging();
  }

  toggleAdvice() {
    const panel = document.getElementById('commander-advice-panel');
    if (!panel) return;
    if (panel.classList.contains('hidden')) this.showAdvice();
    else this.hideAdvice();
  }

  async showAdvice() {
    const panel = document.getElementById('commander-advice-panel');
    if (!panel) return;
    panel.classList.remove('hidden');
    await this.fetchAdvice({ force: false });
  }

  hideAdvice() {
    const panel = document.getElementById('commander-advice-panel');
    if (!panel) return;
    panel.classList.add('hidden');
  }

  async fetchAdvice({ force = false } = {}) {
    const body = document.getElementById('commander-advice-body');
    if (!body) return;
    body.textContent = 'Loading…';
    try {
      const url = new URL(`${this.serverUrl}/api/process/advice`);
      url.searchParams.set('mode', 'mine');
      if (force) url.searchParams.set('force', 'true');
      const res = await fetch(url.toString());
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to load advice');

      const items = Array.isArray(data.advice) ? data.advice : [];
      if (!items.length) {
        body.innerHTML = '<div class="commander-advice-empty">No advice right now.</div>';
        return;
      }

      const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      body.innerHTML = items.map((a) => {
        const level = String(a.level || 'info');
        const title = escapeHtml(a.title || '');
        const message = escapeHtml(a.message || '');
        return `
          <div class="commander-advice-item ${level}">
            <div class="commander-advice-item-title">${title}</div>
            <div class="commander-advice-item-msg">${message}</div>
            ${(Array.isArray(a.actions) && a.actions.length) ? `
              <div class="commander-advice-actions">
                ${a.actions.map((act, idx) => {
                  const label = escapeHtml(act.label || 'Action');
                  const action = escapeHtml(act.action || '');
                  return `<button class="commander-btn commander-advice-action" data-action="${action}" data-idx="${idx}">${label}</button>`;
                }).join('')}
              </div>
            ` : ''}
          </div>
        `;
      }).join('');

      body.querySelectorAll('.commander-advice-action').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const action = btn.getAttribute('data-action');
          if (!action) return;
          // Minimal wiring: map advisor actions to orchestrator commander actions when possible.
          if (typeof this.orchestrator?.handleCommanderAction === 'function') {
            this.orchestrator.handleCommanderAction(action, {});
            return;
          }
          if (action === 'open-queue') this.orchestrator?.showQueuePanel?.();
        });
      });
    } catch (e) {
      body.textContent = String(e?.message || e);
    }
  }

  /**
   * Setup drag functionality for the panel header
   */
  setupDragging() {
    const panel = document.getElementById('commander-panel');
    const titlebar = panel?.querySelector('.commander-titlebar');
    if (!panel || !titlebar) return;

    let isDragging = false;
    let startX, startY, startLeft, startTop;
    let panelWidth = 0;
    let panelHeight = 0;

    const clampPanelWithinViewport = () => {
      if (!panel || panel.classList.contains('hidden')) return;
      const width = panelWidth || panel.offsetWidth || panel.getBoundingClientRect().width || 0;
      const height = panelHeight || panel.offsetHeight || panel.getBoundingClientRect().height || 0;
      if (!width || !height) return;

      const maxLeft = Math.max(0, window.innerWidth - width);
      const maxTop = Math.max(0, window.innerHeight - height);
      const currentLeft = Number.parseFloat(panel.style.left || `${panel.getBoundingClientRect().left}`) || 0;
      const currentTop = Number.parseFloat(panel.style.top || `${panel.getBoundingClientRect().top}`) || 0;
      const left = Math.min(Math.max(currentLeft, 0), maxLeft);
      const top = Math.min(Math.max(currentTop, 0), maxTop);
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    };

    titlebar.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      // Don't drag if clicking on buttons
      if (e.target.closest('button')) return;

      isDragging = true;
      panel.classList.add('dragging');

      // Get current position
      const rect = panel.getBoundingClientRect();
      panelWidth = rect.width;
      panelHeight = rect.height;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;

      // Reset transform so we can use left/top positioning
      panel.style.transform = 'none';
      panel.style.left = `${startLeft}px`;
      panel.style.top = `${startTop}px`;

      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      const maxLeft = Math.max(0, window.innerWidth - panelWidth);
      const maxTop = Math.max(0, window.innerHeight - panelHeight);
      const nextLeft = Math.min(Math.max(startLeft + deltaX, 0), maxLeft);
      const nextTop = Math.min(Math.max(startTop + deltaY, 0), maxTop);

      panel.style.left = `${nextLeft}px`;
      panel.style.top = `${nextTop}px`;
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        panel.classList.remove('dragging');
        clampPanelWithinViewport();
      }
    });

    window.addEventListener('resize', clampPanelWithinViewport);
  }

  /**
   * Setup Socket.IO listeners for Commander output
   */
  setupSocketListeners() {
    const socket = this.orchestrator?.socket;
    if (!socket) {
      // Retry when socket becomes available
      setTimeout(() => this.setupSocketListeners(), 500);
      return;
    }

    // Remove any existing listeners to avoid duplicates
    socket.off('commander-output');
    socket.off('commander-exit');

    socket.on('commander-output', ({ data, instanceId }) => {
      const id = instanceId || 'main';
      if (id === this.activeInstance) {
        if (this.terminal && !this.historyPending) {
          this.terminal.write(data);
        } else {
          // Buffer output until the terminal exists and history replay is done
          this.pendingOutput = (this.pendingOutput || '') + data;
        }
        return;
      }
      // Background tab: write straight into its terminal so scrollback stays live.
      const tab = this.tabs.get(id);
      tab?.terminal?.write?.(data);
    });

    socket.on('commander-exit', ({ exitCode, instanceId }) => {
      const id = instanceId || 'main';
      const tab = this.tabs.get(id);
      if (tab) tab.isRunning = false;
      if (id === this.activeInstance) {
        this.isRunning = false;
        // A restarted PTY comes back at its default size, so force a re-sync
        this.lastSyncedSize = null;
        this.updateStatusBadge();
        if (this.terminal) {
          this.terminal.writeln(`\r\n[Commander exited with code ${exitCode}]`);
        }
      } else {
        tab?.terminal?.writeln?.(`\r\n[Commander exited with code ${exitCode}]`);
      }
    });
  }

  /**
   * Fetch Commander status
   */
  async fetchStatus() {
    try {
      const response = await fetch(this.apiUrl('/api/commander/status'));
      if (response.ok) {
        const status = await response.json();
        this.isRunning = status.running;
        this.updateStatusBadge();
      }
    } catch (error) {
      console.error('Failed to fetch commander status:', error);
    }
  }

  /**
   * Update the status badge
   */
  updateStatusBadge() {
    const badge = document.getElementById('commander-status-badge');
    if (badge) {
      badge.textContent = '●';
      badge.className = `commander-status ${this.isStarting ? 'starting' : (this.isRunning ? 'online' : 'offline')}`;
      badge.title = this.isStarting ? 'Starting' : (this.isRunning ? 'Running' : 'Stopped');
    }
  }

  /**
   * Toggle panel visibility
   */
  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Show the panel
   */
  async show() {
    const panel = document.getElementById('commander-panel');
    const backdrop = document.getElementById('commander-backdrop');
    if (panel) {
      panel.classList.remove('hidden');
      backdrop?.classList.remove('hidden');
      this.isVisible = true;
      this.syncTabsFromServer();
      this.pinPanelPosition(panel);

      // Focus immediately so keystrokes land without waiting for the
      // status round-trip below.
      this.terminal?.focus();

      // Check Commander status from server
      const status = await this.checkStatus();

      if (!status.running) {
        this.isStarting = true;
        this.updateStatusBadge();
        this.setPlaceholderMessages([
          'Commander is starting.',
          'Claude will launch automatically as soon as the terminal is ready.'
        ]);

        await this.startCommander();
      } else if (!this.terminal) {
        // Terminal not initialized locally - set it up
        this.initTerminal();
      }

      // Fit and focus terminal
      if (this.fitAddon && this.terminal) {
        // The PTY size can drift while the panel is closed (e.g. a restart
        // or an API caller resized it), so always re-sync on open.
        this.lastSyncedSize = null;
        this.fitTerminalSoon();
      }
    }
  }

  /**
   * Convert the centered transform position into fixed left/top pixels so
   * the native CSS resize handle tracks the cursor instead of growing the
   * panel from its center.
   */
  pinPanelPosition(panel) {
    if (!panel || panel.style.left) return;
    const rect = panel.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    panel.style.transform = 'none';
  }

  /**
   * Hide the panel
   */
  hide() {
    const panel = document.getElementById('commander-panel');
    const backdrop = document.getElementById('commander-backdrop');
    if (panel) {
      panel.classList.add('hidden');
      backdrop?.classList.add('hidden');
      this.isVisible = false;
    }
  }

  // Close (✕): fully stop the Commander session, then hide the panel. Reopening
  // starts a fresh Commander. This is distinct from minimize (—), which only hides
  // the window and leaves the session running so it's instantly available again.
  // Stopping a live session is destructive (kills the Commander's agent process),
  // so gate it behind a confirm; hide immediately so the panel never hangs on the
  // stop round-trip (stopCommander handles its own errors and never throws).
  closeSession() {
    if (this.isRunning && !window.confirm('Close Commander and stop its running session? Use minimize (—) to keep it running in the background.')) {
      return;
    }
    this.hide();
    this.stopCommander();
  }

  /**
   * Start the Commander terminal
   */
  async startCommander() {
    if (this.startCommanderPromise) {
      return this.startCommanderPromise;
    }

    this.isStarting = true;
    this.updateStatusBadge();

    this.startCommanderPromise = (async () => {
      try {
        const response = await fetch(this.apiUrl('/api/commander/start'), {
          method: 'POST'
        });
        const result = response.ok
          ? await response.json()
          : { success: false, error: `Request failed (${response.status})` };

        if (result.success || result.error === 'Already running') {
          this.isRunning = true;
          this.initTerminal();
          return result;
        }

        this.isRunning = false;
        this.setPlaceholderMessages([
          'Commander could not be started.',
          String(result.error || 'Close and reopen the panel to try again.')
        ]);
        return result;
      } catch (error) {
        console.error('Failed to start commander:', error);
        this.isRunning = false;
        this.setPlaceholderMessages([
          'Commander could not be started.',
          'Close and reopen the panel to try again.'
        ]);
        return { success: false, error: error.message };
      } finally {
        this.isStarting = false;
        this.updateStatusBadge();
        this.startCommanderPromise = null;
      }
    })();

    return this.startCommanderPromise;
  }

  /**
   * Stop the Commander terminal
   */
  async stopCommander() {
    try {
      const response = await fetch(this.apiUrl('/api/commander/stop'), {
        method: 'POST'
      });

      if (response.ok) {
        this.isRunning = false;
        this.updateStatusBadge();
      }
    } catch (error) {
      console.error('Failed to stop commander:', error);
    }
  }

  /**
   * Start Claude Code in the Commander terminal
   */
  async startClaude(mode = 'fresh') {
    if (!this.isRunning) {
      await this.startCommander();
      // Wait for terminal to be ready
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    try {
      const response = await fetch(this.apiUrl('/api/commander/start-claude'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode })
      });

      if (response.ok) {
        if (this.terminal) {
          this.terminal.focus();
        }
      }
    } catch (error) {
      console.error('Failed to start Claude:', error);
    }
  }

  loadCommanderCommandModePreference() {
    try {
      const raw = localStorage.getItem('orchestrator-commander-command-mode');
      if (raw == null) return true;
      return String(raw).toLowerCase() !== 'false';
    } catch {
      return true;
    }
  }

  saveCommanderCommandModePreference(enabled) {
    try {
      localStorage.setItem('orchestrator-commander-command-mode', enabled ? 'true' : 'false');
    } catch {
      // ignore
    }
  }

  updateCommanderCmdModeButton() {
    const btn = document.getElementById('commander-cmdmode');
    if (!btn) return;
    btn.textContent = this.commandModeEnabled ? '⌨️ Cmd:on' : '⌨️ Cmd:off';
  }

  isPrintableChar(data) {
    if (!data) return false;
    if (data === '\r' || data === '\n' || data === '\x7f') return false;
    if (String(data).startsWith('\x1b')) return false; // escape sequences (arrows, etc.)
    return true;
  }

  resetLocalLineBuffer() {
    this.lineBuffer = '';
  }

  updateLocalLineBufferFromData(data) {
    if (!data) return;
    if (data === '\r' || data === '\n') {
      this.resetLocalLineBuffer();
      return;
    }
    if (data === '\x7f') {
      this.lineBuffer = this.lineBuffer.slice(0, -1);
      return;
    }
    if (this.isPrintableChar(data)) {
      this.lineBuffer += data;
    }
  }

  async executeTextCommand(text, typedInput = '') {
    const input = String(text || '').trim();
    if (!input) {
      if (this.terminal) this.terminal.write('\r\n');
      return;
    }
    try {
      const response = await fetch(`${this.serverUrl}/api/commander/execute-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: input, rulesOnly: true })
      });
      const data = await response.json().catch(() => ({}));

      const ok = response.ok && data && data.ok === true;
      const parsed = data?.parsed;
      const result = data?.result;
      const cmdName = parsed?.success ? String(parsed.command || '').trim() : '';

      if (!ok && parsed && parsed.success !== true) {
        // Not an orchestrator command — hand the original slash command to
        // the agent in the Commander terminal (e.g. Claude Code /resume).
        this.forwardCapturedInputToAgent(typedInput || `/${input}`);
        return;
      }

      if (this.terminal) {
        const header = cmdName ? `[cmd] ${cmdName}` : '[cmd]';
        if (!ok) {
          const err = String(parsed?.error || data?.error || 'Could not understand command');
          this.terminal.writeln(`\r\n${header} ✗ ${err}\r`);
          return;
        }
        const msg = String(result?.message || '').trim();
        this.terminal.writeln(`\r\n${header} ✓${msg ? ` ${msg}` : ''}\r`);
      }
    } catch (error) {
      if (this.terminal) {
        this.terminal.writeln(`\r\n[cmd] ✗ ${String(error?.message || error)}\r`);
      }
    }
  }

  /**
   * Erase the locally echoed slash command and send it to the Commander PTY
   * so the agent (Claude Code / Codex) can run it as its own slash command.
   */
  async forwardCapturedInputToAgent(typedInput) {
    const text = String(typedInput || '');
    if (!text) return;
    if (this.terminal) {
      this.terminal.write('\b \b'.repeat(text.length));
    }
    // sendInput swallows network errors (resolves undefined) and the server
    // replies { success: false } when the Commander PTY isn't running yet.
    // Either way the command went nowhere — say so instead of eating it.
    const response = await this.sendInput(`${text}\r`);
    let delivered = false;
    if (response && response.ok) {
      const data = await response.json().catch(() => null);
      delivered = data?.success !== false;
    }
    if (!delivered && this.terminal) {
      this.terminal.writeln(`\r\n[cmd] ✗ Commander agent is not running — ${text} was not delivered\r`);
    }
  }

  // Strip mouse-tracking MOTION reports (idle hover, no button held) from an input
  // chunk: SGR (mode 1006) "ESC[<btn;col;rowM/m" and X10-encoded (modes 1002/1003)
  // "ESC[M" + 3 bytes. Only motion-with-no-button reports are noise; clicks, drags,
  // and scroll-wheel reports are meaningful to mouse-aware apps (Claude Code's TUI,
  // vim, less) and must keep flowing. Stripping (vs dropping the whole chunk) also
  // preserves any real keystrokes xterm coalesced into the same data event.
  stripMouseMotionReports(data) {
    const s = String(data == null ? '' : data);
    if (!s.includes('\x1b[')) return s;
    const isIdleMotion = (btnCode) => (btnCode & 0x20) !== 0 && (btnCode & 0x03) === 3 && (btnCode & 0x40) === 0;
    return s
      .replace(/\x1b\[<(\d+);\d+;\d+[Mm]/g, (match, btn) => (isIdleMotion(Number(btn)) ? '' : match))
      .replace(/\x1b\[M([\s\S]{3})/g, (match, payload) => (isIdleMotion(payload.charCodeAt(0) - 32) ? '' : match));
  }

  handleTerminalData(data) {
    // Filter mouse-motion noise. Claude Code's TUI enables mouse reporting, so every
    // mouse move over the panel emits a report — and each was sent as its own chained
    // HTTP request, flooding the input queue and stalling real keystrokes (measured:
    // hundreds of mouse reports queued ahead of a single typed character). Hover
    // motion carries no meaning for the panel, so it's stripped; clicks/drags/scroll
    // still reach the PTY for apps that use them.
    data = this.stripMouseMotionReports(data);
    if (!data) return;

    // If we're currently capturing a command, don't forward to Commander PTY.
    if (this.commandCapture) {
      if (data === '\r' || data === '\n') {
        const text = String(this.commandCapture.text || '').trim();
        const typedInput = String(this.commandCapture.display || '');
        this.commandCapture = null;
        this.resetLocalLineBuffer();
        this.executeTextCommand(text, typedInput);
        return;
      }
      if (data === '\x03') {
        // Ctrl+C cancels command capture.
        this.commandCapture = null;
        this.resetLocalLineBuffer();
        if (this.terminal) this.terminal.write('^C\r\n');
        return;
      }
      if (data === '\x7f') {
        if (this.commandCapture.display.length > 1) {
          this.commandCapture.display = this.commandCapture.display.slice(0, -1);
          this.commandCapture.text = this.commandCapture.text.slice(0, -1);
          if (this.terminal) this.terminal.write('\b \b');
        }
        return;
      }
      if (this.isPrintableChar(data)) {
        this.commandCapture.display += data;
        this.commandCapture.text += data;
        if (this.terminal) this.terminal.write(data);
      }
      return;
    }

    // Start command capture only on a single "/" at the beginning of the current line buffer.
    if (this.commandModeEnabled && data === '/' && (this.lineBuffer || '') === '') {
      this.commandCapture = { display: '/', text: '' };
      if (this.terminal) this.terminal.write('/');
      return;
    }

    // Normal mode: forward to Commander PTY and keep a best-effort local line buffer.
    this.updateLocalLineBufferFromData(data);
    this.sendInput(data);
  }

  /**
   * Send input to Commander terminal
   */
  async sendInput(input) {
    // Chain requests so keystrokes reach the terminal in the order typed;
    // parallel fetches can otherwise arrive out of order and scramble input.
    this.inputChain = this.inputChain
      .then(() => fetch(this.apiUrl('/api/commander/input'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input })
      }))
      .catch((error) => {
        console.error('Failed to send input:', error);
      });
    return this.inputChain;
  }

  /**
   * Fetch and display initial output from Commander
   * Called when terminal is first created to show existing buffer
   */
  async fetchInitialOutput() {
    try {
      const response = await fetch(this.apiUrl('/api/commander/output?lines=500'));
      if (response.ok) {
        const { output } = await response.json();
        if (output && this.terminal) {
          this.terminal.write(output);
          // The history snapshot already includes anything buffered before now,
          // so drop the buffer instead of writing it twice.
          this.pendingOutput = '';
        }
      }
    } catch (error) {
      console.error('Failed to fetch initial output:', error);
    } finally {
      this.historyPending = false;
      if (this.pendingOutput && this.terminal) {
        this.terminal.write(this.pendingOutput);
        this.pendingOutput = '';
      }
    }
  }

  /**
   * Check Commander status from server
   */
  async checkStatus() {
    try {
      const response = await fetch(this.apiUrl('/api/commander/status'));
      if (response.ok) {
        const status = await response.json();
        this.isRunning = status.running;
        this.updateStatusBadge();
        return status;
      }
    } catch (error) {
      console.error('Failed to check status:', error);
    }
    return { running: false, ready: false };
  }

  /**
   * Clear the terminal
   */
  clearTerminal() {
    if (this.terminal) {
      this.terminal.clear();
    }
  }

  /**
   * Show active sessions
   */
  async showSessions() {
    try {
      const response = await fetch(`${this.serverUrl}/api/commander/sessions`);
      if (response.ok) {
        const { sessions } = await response.json();

        // Display sessions in terminal or modal
        if (this.terminal) {
          this.terminal.writeln('\r\n=== Active Sessions ===');
          sessions.forEach(s => {
            this.terminal.writeln(`  ${s.id} [${s.type}] - ${s.status} (${s.branch || 'no branch'})`);
          });
          this.terminal.writeln('======================\r\n');
        }
      }
    } catch (error) {
      console.error('Failed to get sessions:', error);
    }
  }
}

// Export for use in app
window.CommanderPanel = CommanderPanel;
