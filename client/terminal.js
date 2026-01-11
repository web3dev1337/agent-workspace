// Terminal management with Xterm.js
// Ensure Terminal is available globally
if (typeof Terminal === 'undefined' && typeof window !== 'undefined' && window.Terminal) {
  window.Terminal = window.Terminal;
}

class TerminalManager {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.terminals = new Map();
    this.fitAddons = new Map();
    this.searchAddons = new Map();
    this.webLinksAddons = new Map();
    
    // Paste debouncing
    this.lastPasteTimes = new Map();
    this.pasteCooldown = 200; // milliseconds
    
    // Word deletion debouncing
    this.lastWordDeleteTimes = new Map();
    this.wordDeleteCooldown = 150; // milliseconds
    
    // Track scroll state per terminal
    this.terminalScrollStates = new Map();
    this.userScrolling = new Map();
    
    // Apply global terminal scrollbar styles
    this.applyScrollbarStyles();
    
    // Terminal theme
    this.theme = {
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
    };
    
    // Light theme
    this.lightTheme = {
      background: '#ffffff',
      foreground: '#24292f',
      cursor: '#24292f',
      cursorAccent: '#ffffff',
      selection: 'rgba(9, 105, 218, 0.3)',
      black: '#24292f',
      red: '#cf222e',
      green: '#1a7f37',
      yellow: '#9a6700',
      blue: '#0969da',
      magenta: '#8250df',
      cyan: '#1b7c83',
      white: '#6e7781',
      brightBlack: '#57606a',
      brightRed: '#a40e26',
      brightGreen: '#116329',
      brightYellow: '#633c01',
      brightBlue: '#218bff',
      brightMagenta: '#a475f9',
      brightCyan: '#3192aa',
      brightWhite: '#8c959f'
    };
  }
  
  applyScrollbarStyles() {
    // Check if styles already exist
    if (document.getElementById('terminal-scrollbar-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'terminal-scrollbar-styles';
    style.textContent = `
      /* Custom scrollbar for ALL terminal elements - minimal dark squared design */
      .xterm .xterm-viewport::-webkit-scrollbar,
      .xterm-viewport::-webkit-scrollbar,
      .xterm-screen::-webkit-scrollbar,
      .xterm::-webkit-scrollbar,
      [id^="terminal-"]::-webkit-scrollbar,
      [id^="terminal-"] *::-webkit-scrollbar,
      .terminal-container::-webkit-scrollbar,
      .terminal-container *::-webkit-scrollbar {
        width: 8px !important;
        height: 8px !important;
        background: #0d1117 !important;
      }
      
      .xterm .xterm-viewport::-webkit-scrollbar-track,
      .xterm-viewport::-webkit-scrollbar-track,
      .xterm-screen::-webkit-scrollbar-track,
      .xterm::-webkit-scrollbar-track,
      [id^="terminal-"]::-webkit-scrollbar-track,
      [id^="terminal-"] *::-webkit-scrollbar-track,
      .terminal-container::-webkit-scrollbar-track,
      .terminal-container *::-webkit-scrollbar-track {
        background: #0d1117 !important;
        border: none !important;
        border-radius: 0 !important;
      }
      
      .xterm .xterm-viewport::-webkit-scrollbar-thumb,
      .xterm-viewport::-webkit-scrollbar-thumb,
      .xterm-screen::-webkit-scrollbar-thumb,
      .xterm::-webkit-scrollbar-thumb,
      [id^="terminal-"]::-webkit-scrollbar-thumb,
      [id^="terminal-"] *::-webkit-scrollbar-thumb,
      .terminal-container::-webkit-scrollbar-thumb,
      .terminal-container *::-webkit-scrollbar-thumb {
        background: #30363d !important;
        border: none !important;
        border-radius: 0 !important;
        transition: background 0.2s ease;
      }
      
      .xterm .xterm-viewport::-webkit-scrollbar-thumb:hover,
      .xterm-viewport::-webkit-scrollbar-thumb:hover,
      .xterm-screen::-webkit-scrollbar-thumb:hover,
      .xterm::-webkit-scrollbar-thumb:hover,
      [id^="terminal-"]::-webkit-scrollbar-thumb:hover,
      [id^="terminal-"] *::-webkit-scrollbar-thumb:hover,
      .terminal-container::-webkit-scrollbar-thumb:hover,
      .terminal-container *::-webkit-scrollbar-thumb:hover {
        background: #484f58 !important;
      }
      
      .xterm .xterm-viewport::-webkit-scrollbar-thumb:active,
      .xterm-viewport::-webkit-scrollbar-thumb:active,
      .xterm-screen::-webkit-scrollbar-thumb:active,
      .xterm::-webkit-scrollbar-thumb:active,
      [id^="terminal-"]::-webkit-scrollbar-thumb:active,
      [id^="terminal-"] *::-webkit-scrollbar-thumb:active,
      .terminal-container::-webkit-scrollbar-thumb:active,
      .terminal-container *::-webkit-scrollbar-thumb:active {
        background: #6e7681 !important;
      }
      
      .xterm .xterm-viewport::-webkit-scrollbar-corner,
      .xterm-viewport::-webkit-scrollbar-corner,
      .xterm-screen::-webkit-scrollbar-corner,
      .xterm::-webkit-scrollbar-corner,
      [id^="terminal-"]::-webkit-scrollbar-corner,
      [id^="terminal-"] *::-webkit-scrollbar-corner,
      .terminal-container::-webkit-scrollbar-corner,
      .terminal-container *::-webkit-scrollbar-corner {
        background: #0d1117 !important;
      }
      
      /* Firefox scrollbar styling */
      .xterm .xterm-viewport,
      .xterm-viewport,
      .xterm-screen,
      .xterm,
      [id^="terminal-"],
      [id^="terminal-"] *,
      .terminal-container,
      .terminal-container * {
        scrollbar-width: thin !important;
        scrollbar-color: #30363d #0d1117 !important;
      }
    `;
    
    document.head.appendChild(style);
  }
  
  createTerminal(sessionId, sessionInfo) {
    // Skip if already exists
    if (this.terminals.has(sessionId)) {
      console.warn(`Terminal ${sessionId} already exists, skipping creation`);
      return this.terminals.get(sessionId);
    }
    
    const terminalElement = document.getElementById(`terminal-${sessionId}`);
    if (!terminalElement) {
      console.error(`Terminal element not found for ${sessionId}`);
      return null;
    }
    
    // Create Xterm instance
    const terminal = new Terminal({
      fontSize: 12,
      fontFamily: 'Consolas, Monaco, "Courier New", monospace',
      theme: this.orchestrator.settings.theme === 'light' ? this.lightTheme : this.theme,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 5000,
      tabStopWidth: 4,
      bellStyle: 'none',
      allowTransparency: false,
      convertEol: false,  // CRITICAL: Don't convert \r to \r\n - needed for spinner animations
      wordSeparator: ' ()[]{}\'"',
      rightClickSelectsWord: true,
      rendererType: 'canvas',
      experimentalCharAtlas: 'dynamic'
    });
    
    // Load addons
    const fitAddon = new FitAddon.FitAddon();
    const searchAddon = new SearchAddon.SearchAddon();
    const webLinksAddon = new WebLinksAddon.WebLinksAddon();
    
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(webLinksAddon);
    
    // Store addon references
    this.fitAddons.set(sessionId, fitAddon);
    this.searchAddons.set(sessionId, searchAddon);
    this.webLinksAddons.set(sessionId, webLinksAddon);
    
    // Clear any existing content first
    terminalElement.innerHTML = '';

    // Use requestAnimationFrame to ensure renderer is ready before opening
    // This prevents "Cannot read properties of undefined (reading 'dimensions')" errors
    requestAnimationFrame(() => {
      // Open terminal in DOM
      terminal.open(terminalElement);

      // Fit terminal after opening
      requestAnimationFrame(() => {
        this.fitTerminal(sessionId);
      });
    });
    
    // Focus terminal when clicked
    terminalElement.addEventListener('click', () => {
      terminal.focus();
    });
    
    // Auto-focus if it's a Claude session
    if (sessionId.includes('claude')) {
      setTimeout(() => terminal.focus(), 100);
    }
    
    // Handle input
    terminal.onData((data) => {
      this.orchestrator.sendTerminalInput(sessionId, data);
    });
    
    // Handle resize
    terminal.onResize(({ cols, rows }) => {
      this.orchestrator.resizeTerminal(sessionId, cols, rows);
    });
    
    // Handle selection for copy
    terminal.onSelectionChange(() => {
      const selection = terminal.getSelection();
      if (selection) {
        // Copy to clipboard on selection
        navigator.clipboard.writeText(selection).catch(err => {
          console.error('Failed to copy selection:', err);
        });
      }
    });
    
    // Track user scrolling with mouse wheel
    terminalElement.addEventListener('wheel', (e) => {
      // User is scrolling, mark as user interaction
      this.userScrolling.set(sessionId, true);
      
      // Clear user scrolling flag after a short delay
      setTimeout(() => {
        this.checkScrollPosition(sessionId);
      }, 100);
    });
    
    // Track scrollbar dragging
    terminalElement.addEventListener('mousedown', (e) => {
      // Check if clicking on scrollbar (rough approximation)
      const rect = terminalElement.getBoundingClientRect();
      const isScrollbar = e.clientX > rect.right - 20; // Scrollbar is typically ~17px wide
      
      if (isScrollbar) {
        this.userScrolling.set(sessionId, true);
        
        // Monitor mouse up to check final position
        const handleMouseUp = () => {
          setTimeout(() => {
            this.checkScrollPosition(sessionId);
          }, 100);
          document.removeEventListener('mouseup', handleMouseUp);
        };
        document.addEventListener('mouseup', handleMouseUp);
      }
    });
    
    // Initialize scroll state
    this.userScrolling.set(sessionId, false);
    
    // Custom key handlers
    this.setupKeyHandlers(terminal, sessionId);
    
    // Store terminal reference
    this.terminals.set(sessionId, terminal);

    // Register with tab manager if available
    if (this.orchestrator.tabManager && this.orchestrator.currentTabId) {
      this.orchestrator.tabManager.registerTerminal(
        this.orchestrator.currentTabId,
        sessionId,
        terminal,
        fitAddon
      );
      console.log(`Registered terminal ${sessionId} with tab ${this.orchestrator.currentTabId}`);
    }

    // Setup resize observer
    this.setupResizeObserver(sessionId);

    return terminal;
  }
  
  checkScrollPosition(sessionId) {
    const terminal = this.terminals.get(sessionId);
    if (terminal) {
      const buffer = terminal.buffer.active;
      const scrollOffset = buffer.baseY - buffer.viewportY;
      // If user scrolled back to bottom (within 5 lines), clear the flag
      if (scrollOffset <= 5) {
        this.userScrolling.set(sessionId, false);
      }
    }
  }
  
  setupKeyHandlers(terminal, sessionId) {
    // Ctrl+Shift+F for search
    terminal.attachCustomKeyEventHandler((e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        this.showSearch(sessionId);
        return false;
      }
      
      // Ctrl+C for copy when there's selection
      if (e.ctrlKey && e.key === 'c' && terminal.hasSelection()) {
        e.preventDefault();
        const selection = terminal.getSelection();
        navigator.clipboard.writeText(selection);
        return false;
      }
      
      // Ctrl+V for paste with debouncing
      if (e.ctrlKey && e.key === 'v') {
        e.preventDefault();
        
        // Check if we're within the cooldown period
        const now = Date.now();
        const lastPaste = this.lastPasteTimes.get(sessionId) || 0;
        
        if (now - lastPaste < this.pasteCooldown) {
          // Still in cooldown, ignore this paste
          console.log(`Ignoring paste for ${sessionId}, cooldown active`);
          return false;
        }
        
        // Update last paste time
        this.lastPasteTimes.set(sessionId, now);
        
        // Perform the paste
        navigator.clipboard.readText().then(text => {
          this.orchestrator.sendTerminalInput(sessionId, text);
        }).catch(err => {
          console.error('Failed to read clipboard:', err);
          // Reset the paste time on error so user can retry immediately
          this.lastPasteTimes.delete(sessionId);
        });
        
        return false;
      }
      
      // Ctrl+Backspace or Alt+Backspace for word deletion with debouncing
      if ((e.ctrlKey || e.altKey) && e.key === 'Backspace') {
        e.preventDefault();
        
        // Check if we're within the cooldown period
        const now = Date.now();
        const lastDelete = this.lastWordDeleteTimes.get(sessionId) || 0;
        
        if (now - lastDelete < this.wordDeleteCooldown) {
          // Still in cooldown, ignore this word deletion
          console.log(`Ignoring word deletion for ${sessionId}, cooldown active`);
          return false;
        }
        
        // Update last word delete time
        this.lastWordDeleteTimes.set(sessionId, now);
        
        // Send Ctrl+W sequence to delete word backwards
        this.orchestrator.sendTerminalInput(sessionId, '\x17');
        return false;
      }
      
      // Track keyboard scrolling (Page Up, Page Down, Home, End, Ctrl+Home, Ctrl+End)
      if (e.key === 'PageUp' || e.key === 'PageDown' || 
          e.key === 'Home' || e.key === 'End' ||
          (e.ctrlKey && (e.key === 'Home' || e.key === 'End'))) {
        this.userScrolling.set(sessionId, true);
        
        // Check if at bottom after keyboard navigation
        setTimeout(() => {
          this.checkScrollPosition(sessionId);
        }, 100);
      }
      
      return true;
    });
  }
  
  setupResizeObserver(sessionId) {
    const terminalElement = document.getElementById(`terminal-${sessionId}`);
    if (!terminalElement) return;

    const resizeObserver = new ResizeObserver(() => {
      // Use requestAnimationFrame to ensure renderer is ready before fitting
      requestAnimationFrame(() => {
        this.fitTerminal(sessionId);
      });
    });

    resizeObserver.observe(terminalElement);

    // Store observer for cleanup
    terminalElement._resizeObserver = resizeObserver;
  }
  
  fitTerminal(sessionId, retryCount = 0) {
    const fitAddon = this.fitAddons.get(sessionId);
    if (!fitAddon) return;

    // Throttle fit operations to prevent dimension mismatch glitches
    if (!this.fitTimers) this.fitTimers = new Map();
    if (this.fitTimers.has(sessionId)) {
      clearTimeout(this.fitTimers.get(sessionId));
    }

    this.fitTimers.set(sessionId, setTimeout(() => {
      try {
        const terminal = this.terminals.get(sessionId);
        if (!terminal || terminal._core?.disposed) return;

        // Check that container has valid dimensions before fitting
        const terminalElement = document.getElementById(`terminal-${sessionId}`);
        const terminalBody = terminalElement?.closest('.terminal-body');

        if (terminalBody) {
          const bodyRect = terminalBody.getBoundingClientRect();

          // If container is too small (hidden or not laid out yet), retry
          if (bodyRect.width < 100 || bodyRect.height < 50) {
            if (retryCount < 5) {
              // Schedule retry with increasing delay
              const retryDelay = 100 * (retryCount + 1);
              console.log(`Terminal ${sessionId} container too small (${bodyRect.width}x${bodyRect.height}), retrying in ${retryDelay}ms (attempt ${retryCount + 1}/5)`);
              this.fitTimers.delete(sessionId);
              setTimeout(() => this.fitTerminal(sessionId, retryCount + 1), retryDelay);
              return;
            } else {
              console.warn(`Terminal ${sessionId} container still too small after 5 retries, fitting anyway`);
            }
          }
        }

        fitAddon.fit();

        // Verify fit produced reasonable dimensions
        if (terminal.cols < 10 || terminal.rows < 3) {
          console.warn(`Terminal ${sessionId} fit resulted in small dimensions: ${terminal.cols}x${terminal.rows}`);
          // Schedule another fit attempt
          if (retryCount < 3) {
            setTimeout(() => this.fitTerminal(sessionId, retryCount + 1), 200);
          }
        }

        // Get dimensions and notify server
        if (terminal) {
          const dimensions = { cols: terminal.cols, rows: terminal.rows };
          this.orchestrator.resizeTerminal(sessionId, dimensions.cols, dimensions.rows);

          // Force refresh after resize to prevent rendering artifacts
          requestAnimationFrame(() => {
            if (terminal && !terminal._core?.disposed) {
              terminal.refresh(0, terminal.rows - 1);
            }
          });
        }
      } catch (err) {
        console.error(`Failed to fit terminal ${sessionId}:`, err);
      }
      this.fitTimers.delete(sessionId);
    }, 100)); // Wait 100ms for size to stabilize
  }

  fitAllTerminals() {
    console.log('Fitting all active terminals...');
    for (const sessionId of this.terminals.keys()) {
      this.fitTerminal(sessionId);
    }
  }
  
  handleOutput(sessionId, data) {
    const terminal = this.terminals.get(sessionId);
    if (!terminal) {
      // Check if DOM element exists before trying to create terminal
      const terminalElement = document.getElementById(`terminal-${sessionId}`);
      if (!terminalElement) {
        // Buffer early output instead of ignoring it
        if (!this.pendingOutput) this.pendingOutput = new Map();
        if (!this.pendingOutput.has(sessionId)) {
          this.pendingOutput.set(sessionId, []);
        }
        this.pendingOutput.get(sessionId).push(data);

        // Try again in a short while
        setTimeout(() => this.handleOutput(sessionId, ''), 100);
        return;
      }

      // Create terminal if DOM element exists
      const sessionInfo = this.orchestrator.sessions.get(sessionId) || {};
      this.createTerminal(sessionId, sessionInfo);

      // Apply any buffered output
      if (this.pendingOutput && this.pendingOutput.has(sessionId)) {
        const bufferedOutput = this.pendingOutput.get(sessionId);
        this.pendingOutput.delete(sessionId);

        const newTerminal = this.terminals.get(sessionId);
        if (newTerminal) {
          bufferedOutput.forEach(output => newTerminal.write(output));
        }
      }

      // Try again with current data
      const newTerminal = this.terminals.get(sessionId);
      if (newTerminal && data) {
        newTerminal.write(data);
      }
      return;
    }

    // Check if user is manually scrolling
    const isUserScrolling = this.userScrolling.get(sessionId) || false;

    // Write data to terminal
    terminal.write(data);

    // Check if this is a carriage return update (like a spinner)
    // Don't auto-scroll for CR updates to avoid breaking the overwrite behavior
    const hasCarriageReturn = data.includes('\r') && !data.includes('\n');

    // Only auto-scroll if user is not manually scrolling and autoScroll is enabled
    // AND this isn't a carriage return update (spinner)
    if (this.orchestrator.settings.autoScroll && !isUserScrolling && !hasCarriageReturn) {
      terminal.scrollToBottom();
    }

    // Check for special patterns (optional enhancement)
    this.checkOutputPatterns(sessionId, data);
  }
  
  checkOutputPatterns(sessionId, data) {
    // Check for error patterns
    if (/error|failed|exception/i.test(data)) {
      // Could highlight the terminal or show a visual indicator
      const container = document.getElementById(`container-${sessionId}`);
      if (container) {
        container.classList.add('has-error');
        setTimeout(() => {
          container.classList.remove('has-error');
        }, 3000);
      }
    }
  }
  
  showSearch(sessionId) {
    const searchAddon = this.searchAddons.get(sessionId);
    const terminal = this.terminals.get(sessionId);
    
    if (!searchAddon || !terminal) return;
    
    // Create search UI if it doesn't exist
    let searchBar = document.getElementById(`search-${sessionId}`);
    if (!searchBar) {
      searchBar = this.createSearchBar(sessionId);
      const container = document.getElementById(`container-${sessionId}`);
      container.appendChild(searchBar);
    }
    
    // Show search bar
    searchBar.classList.remove('hidden');
    const searchInput = searchBar.querySelector('input');
    searchInput.focus();
    searchInput.select();
  }
  
  createSearchBar(sessionId) {
    const searchBar = document.createElement('div');
    searchBar.id = `search-${sessionId}`;
    searchBar.className = 'terminal-search-bar hidden';
    searchBar.innerHTML = `
      <input type="text" placeholder="Search..." class="search-input" />
      <button class="search-button" data-action="prev">↑</button>
      <button class="search-button" data-action="next">↓</button>
      <button class="search-button" data-action="close">✕</button>
      <span class="search-results"></span>
    `;
    
    const searchAddon = this.searchAddons.get(sessionId);
    const input = searchBar.querySelector('input');
    const results = searchBar.querySelector('.search-results');
    
    // Search on input
    input.addEventListener('input', (e) => {
      const term = e.target.value;
      if (term) {
        searchAddon.findNext(term, { 
          regex: false, 
          wholeWord: false, 
          caseSensitive: false 
        });
      }
    });
    
    // Handle enter key
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          searchAddon.findPrevious(input.value);
        } else {
          searchAddon.findNext(input.value);
        }
      } else if (e.key === 'Escape') {
        this.hideSearch(sessionId);
      }
    });
    
    // Button actions
    searchBar.addEventListener('click', (e) => {
      const button = e.target.closest('.search-button');
      if (!button) return;
      
      const action = button.dataset.action;
      switch (action) {
        case 'prev':
          searchAddon.findPrevious(input.value);
          break;
        case 'next':
          searchAddon.findNext(input.value);
          break;
        case 'close':
          this.hideSearch(sessionId);
          break;
      }
    });
    
    // Style
    const style = document.createElement('style');
    style.textContent = `
      .terminal-search-bar {
        position: absolute;
        top: 40px;
        right: 10px;
        background: var(--bg-tertiary);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-sm);
        padding: var(--space-sm);
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
        z-index: 100;
      }
      
      .search-input {
        background: var(--bg-primary);
        border: 1px solid var(--border-color);
        color: var(--text-primary);
        padding: 4px 8px;
        border-radius: var(--radius-sm);
        width: 200px;
        font-size: 0.875rem;
      }
      
      .search-button {
        background: var(--bg-primary);
        border: 1px solid var(--border-color);
        color: var(--text-primary);
        padding: 4px 8px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        font-size: 0.875rem;
        min-width: 28px;
      }
      
      .search-button:hover {
        background: var(--bg-secondary);
      }
      
      .search-results {
        font-size: 0.75rem;
        color: var(--text-secondary);
        margin-left: var(--space-sm);
      }
      
      .terminal-container.has-error {
        border-color: var(--accent-danger);
        animation: error-flash 0.5s;
      }
      
      @keyframes error-flash {
        0%, 100% { border-color: var(--border-color); }
        50% { border-color: var(--accent-danger); }
      }
    `;
    
    if (!document.getElementById('terminal-search-styles')) {
      style.id = 'terminal-search-styles';
      document.head.appendChild(style);
    }
    
    return searchBar;
  }
  
  hideSearch(sessionId) {
    const searchBar = document.getElementById(`search-${sessionId}`);
    if (searchBar) {
      searchBar.classList.add('hidden');
    }
  }
  
  clearTerminal(sessionId) {
    const terminal = this.terminals.get(sessionId);
    if (terminal) {
      terminal.clear();
    }
  }
  
  destroyTerminal(sessionId) {
    const terminal = this.terminals.get(sessionId);
    if (terminal) {
      terminal.dispose();
      this.terminals.delete(sessionId);
    }

    // Unregister from tab manager if available
    if (this.orchestrator.tabManager && this.orchestrator.currentTabId) {
      this.orchestrator.tabManager.unregisterTerminal(
        this.orchestrator.currentTabId,
        sessionId
      );
    }

    // Clean up paste tracking
    this.lastPasteTimes.delete(sessionId);
    this.lastWordDeleteTimes.delete(sessionId);

    // Clean up scroll state
    this.terminalScrollStates.delete(sessionId);
    this.userScrolling.delete(sessionId);

    // Clean up addons
    this.fitAddons.delete(sessionId);
    this.searchAddons.delete(sessionId);
    this.webLinksAddons.delete(sessionId);
    
    // Clean up resize observer
    const terminalElement = document.getElementById(`terminal-${sessionId}`);
    if (terminalElement) {
      if (terminalElement._resizeObserver) {
        terminalElement._resizeObserver.disconnect();
      }
      // Clear the element
      terminalElement.innerHTML = '';
    }
  }
  
  updateTheme(theme) {
    const themeConfig = theme === 'light' ? this.lightTheme : this.theme;
    
    for (const [sessionId, terminal] of this.terminals) {
      terminal.options.theme = themeConfig;
    }
  }
  
  // Utility method to focus a terminal
  focusTerminal(sessionId) {
    const terminal = this.terminals.get(sessionId);
    if (terminal) {
      terminal.focus();
    }
  }
  
  // Get terminal content as text
  getTerminalContent(sessionId) {
    const terminal = this.terminals.get(sessionId);
    if (!terminal) return '';
    
    const buffer = terminal.buffer.active;
    const lines = [];
    
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i);
      if (line) {
        lines.push(line.translateToString());
      }
    }
    
    return lines.join('\n');
  }

  clearAll() {
    console.log('Clearing all terminals for workspace switch');

    // Destroy all terminals
    for (const sessionId of this.terminals.keys()) {
      this.destroyTerminal(sessionId);
    }

    console.log('All terminals cleared');
  }
}