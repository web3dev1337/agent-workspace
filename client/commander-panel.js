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
  }

  fitTerminalSoon() {
    if (!this.fitAddon || !this.terminal) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.fitAddon?.fit();
        this.terminal?.refresh?.(0, Math.max(0, (this.terminal.rows || 1) - 1));
        this.terminal?.focus();
      });
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

    const container = document.getElementById('commander-terminal');
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

    const container = document.getElementById('commander-terminal');
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
      rendererType: 'canvas',
      experimentalCharAtlas: 'dynamic',
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

    // Use requestAnimationFrame to ensure renderer is ready before fitting
    this.fitTerminalSoon();

    // Write any pending output that was buffered before terminal was ready
    if (this.pendingOutput) {
      this.terminal.write(this.pendingOutput);
      this.pendingOutput = '';
    }

    // Fetch and display existing output from Commander
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
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Toggle button
    document.getElementById('commander-toggle')?.addEventListener('click', () => this.toggle());

    // Window controls
    document.getElementById('commander-close')?.addEventListener('click', () => this.hide());
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

    // ESC to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isVisible) {
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

    socket.on('commander-output', ({ data }) => {
      if (this.terminal) {
        this.terminal.write(data);
      } else {
        // Buffer output if terminal not ready
        this.pendingOutput = (this.pendingOutput || '') + data;
      }
    });

    socket.on('commander-exit', ({ exitCode }) => {
      this.isRunning = false;
      this.updateStatusBadge();
      if (this.terminal) {
        this.terminal.writeln(`\r\n[Commander exited with code ${exitCode}]`);
      }
    });
  }

  /**
   * Fetch Commander status
   */
  async fetchStatus() {
    try {
      const response = await fetch(`${this.serverUrl}/api/commander/status`);
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
      if (this.isStarting) {
        badge.textContent = 'Starting';
        badge.className = 'commander-status starting';
      } else if (this.isRunning) {
        badge.textContent = 'Running';
        badge.className = 'commander-status online';
      } else {
        badge.textContent = 'Stopped';
        badge.className = 'commander-status offline';
      }
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
        this.fitTerminalSoon();
      }
    }
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
        const response = await fetch(`${this.serverUrl}/api/commander/start`, {
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
      const response = await fetch(`${this.serverUrl}/api/commander/stop`, {
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
      const response = await fetch(`${this.serverUrl}/api/commander/start-claude`, {
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

  async executeTextCommand(text) {
    const input = String(text || '').trim();
    if (!input) return;
    try {
      const response = await fetch(`${this.serverUrl}/api/commander/execute-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: input })
      });
      const data = await response.json().catch(() => ({}));

      const ok = response.ok && data && data.ok === true;
      const parsed = data?.parsed;
      const result = data?.result;
      const cmdName = parsed?.success ? String(parsed.command || '').trim() : '';

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

  handleTerminalData(data) {
    // If we're currently capturing a command, don't forward to Commander PTY.
    if (this.commandCapture) {
      if (data === '\r' || data === '\n') {
        const text = String(this.commandCapture.text || '').trim();
        this.commandCapture = null;
        this.resetLocalLineBuffer();
        if (this.terminal) this.terminal.write('\r\n');
        this.executeTextCommand(text);
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
    try {
      await fetch(`${this.serverUrl}/api/commander/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input })
      });
    } catch (error) {
      console.error('Failed to send input:', error);
    }
  }

  /**
   * Fetch and display initial output from Commander
   * Called when terminal is first created to show existing buffer
   */
  async fetchInitialOutput() {
    try {
      const response = await fetch(`${this.serverUrl}/api/commander/output?lines=500`);
      if (response.ok) {
        const { output } = await response.json();
        if (output && this.terminal) {
          this.terminal.write(output);
        }
      }
    } catch (error) {
      console.error('Failed to fetch initial output:', error);
    }
  }

  /**
   * Check Commander status from server
   */
  async checkStatus() {
    try {
      const response = await fetch(`${this.serverUrl}/api/commander/status`);
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
