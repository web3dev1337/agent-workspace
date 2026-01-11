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
    this.serverUrl = window.location.port === '2080' || window.location.port === '2081'
      ? `http://localhost:${window.location.port === '2080' ? '3000' : '4000'}`
      : window.location.origin;
    this.terminal = null;
    this.fitAddon = null;
  }

  /**
   * Initialize the Commander Panel
   */
  async init() {
    this.createPanelHTML();
    this.attachEventListeners();
    this.setupSocketListeners();
    await this.fetchStatus();
  }

  /**
   * Create the panel HTML structure
   */
  createPanelHTML() {
    // Create toggle button in header
    const headerActions = document.querySelector('.header-actions');
    if (headerActions) {
      const toggleBtn = document.createElement('button');
      toggleBtn.id = 'commander-toggle';
      toggleBtn.className = 'icon-button';
      toggleBtn.title = 'Commander (Top-Level Claude)';
      toggleBtn.innerHTML = '🎖️';
      headerActions.insertBefore(toggleBtn, headerActions.firstChild);
    }

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
      <div class="commander-header">
        <div class="commander-title">
          <span class="commander-icon">🎖️</span>
          <h3>Commander Claude</h3>
          <span class="commander-status" id="commander-status-badge">Stopped</span>
        </div>
        <div class="commander-actions">
          <button id="commander-start" class="icon-button" title="Start Commander">▶️</button>
          <button id="commander-stop" class="icon-button" title="Stop Commander">⏹️</button>
          <button id="commander-clear" class="icon-button" title="Clear terminal">🗑️</button>
          <button id="commander-close" class="icon-button" title="Close">✕</button>
        </div>
      </div>
      <div class="commander-toolbar">
        <button id="commander-start-claude" class="commander-btn" title="Start Claude Code">
          Start Claude
        </button>
        <select id="commander-mode">
          <option value="fresh">Fresh</option>
          <option value="continue">Continue</option>
          <option value="resume">Resume</option>
        </select>
        <button id="commander-sessions" class="commander-btn" title="View sessions">
          Sessions
        </button>
      </div>
      <div class="commander-terminal" id="commander-terminal">
        <div class="commander-placeholder">
          <p>Commander is a Claude Code terminal for orchestrating your sessions.</p>
          <p>Click <strong>▶️ Start</strong> to launch the terminal, then <strong>Start Claude</strong> to begin.</p>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
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
      fontSize: 13,
      fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        selection: 'rgba(56, 139, 253, 0.4)',
        black: '#484f58',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#b1bac4'
      }
    });

    // Add fit addon
    this.fitAddon = new FitAddon.FitAddon();
    this.terminal.loadAddon(this.fitAddon);

    // Open terminal
    this.terminal.open(container);

    // Use requestAnimationFrame to ensure renderer is ready before fitting
    requestAnimationFrame(() => {
      this.fitAddon.fit();
      this.terminal.focus();

      // Write any pending output that was buffered before terminal was ready
      if (this.pendingOutput) {
        this.terminal.write(this.pendingOutput);
        this.pendingOutput = '';
      }

      // Fetch and display existing output from Commander
      this.fetchInitialOutput();
    });

    // Handle input - send to Commander service
    this.terminal.onData(data => {
      this.sendInput(data);
    });

    // Click to focus
    container.addEventListener('click', () => {
      if (this.terminal) {
        this.terminal.focus();
      }
    });

    // Handle resize
    window.addEventListener('resize', () => {
      if (this.isVisible && this.fitAddon) {
        requestAnimationFrame(() => this.fitAddon.fit());
      }
    });
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Toggle button
    document.getElementById('commander-toggle')?.addEventListener('click', () => this.toggle());

    // Close button
    document.getElementById('commander-close')?.addEventListener('click', () => this.hide());

    // Start button
    document.getElementById('commander-start')?.addEventListener('click', () => this.startCommander());

    // Stop button
    document.getElementById('commander-stop')?.addEventListener('click', () => this.stopCommander());

    // Clear button
    document.getElementById('commander-clear')?.addEventListener('click', () => this.clearTerminal());

    // Start Claude button
    document.getElementById('commander-start-claude')?.addEventListener('click', () => {
      const mode = document.getElementById('commander-mode')?.value || 'fresh';
      this.startClaude(mode);
    });

    // Sessions button
    document.getElementById('commander-sessions')?.addEventListener('click', () => this.showSessions());

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

  /**
   * Setup drag functionality for the panel header
   */
  setupDragging() {
    const panel = document.getElementById('commander-panel');
    const header = panel?.querySelector('.commander-header');
    if (!panel || !header) return;

    let isDragging = false;
    let startX, startY, startLeft, startTop;

    header.addEventListener('mousedown', (e) => {
      // Don't drag if clicking on buttons
      if (e.target.closest('button')) return;

      isDragging = true;
      panel.classList.add('dragging');

      // Get current position
      const rect = panel.getBoundingClientRect();
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

      panel.style.left = `${startLeft + deltaX}px`;
      panel.style.top = `${startTop + deltaY}px`;
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        panel.classList.remove('dragging');
      }
    });
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
      if (this.isRunning) {
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

      // Auto-start Commander if not running
      if (!this.isRunning) {
        await this.startCommander();
        // Give it a moment to be ready, then start Claude
        setTimeout(() => {
          this.startClaude('fresh');
        }, 1500);
      } else {
        // Already running, just init terminal if needed
        if (!this.terminal) {
          this.initTerminal();
        }
      }

      // Fit and focus terminal
      if (this.fitAddon && this.terminal) {
        requestAnimationFrame(() => {
          this.fitAddon.fit();
          this.terminal.focus();
        });
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
    try {
      const response = await fetch(`${this.serverUrl}/api/commander/start`, {
        method: 'POST'
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          this.isRunning = true;
          this.updateStatusBadge();
          this.initTerminal();
        }
      }
    } catch (error) {
      console.error('Failed to start commander:', error);
    }
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
