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
    this.ephemeralLineState = new Map();

    // Guardrail: never resize the PTY to tiny dimensions (can hard-wrap output irreversibly).
    this.lastGoodPtyDimensions = new Map(); // sessionId -> { cols, rows }
    this.minPtyCols = 40;
    this.minPtyRows = 5;

    // Terminal fit logging (reduce console noise during layout transitions).
    this.fitLogLastAt = new Map(); // `${sessionId}:${key}` -> epoch ms
    this.fitLogCooldownMs = 2_000;
    this.debugTerminalFit = false;
    try {
      this.debugTerminalFit = window?.localStorage?.getItem('debug-terminal-fit') === 'true';
    } catch {
      // ignore
    }
    
    // Autosuggestion state
    this.inputBuffers = new Map();       // sessionId -> current input string
    this.suggestionOverlays = new Map(); // sessionId -> overlay DOM element
    this.currentSuggestions = new Map(); // sessionId -> { suggestion, prefix }
    this.suggestTimers = new Map();      // sessionId -> debounce timer
    this.suggestDebounceMs = 80;
    this.autosuggestEnabled = true;

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

  getDomId(prefix, sessionId) {
    const sid = String(sessionId || '').trim();
    if (!sid) return `${prefix}-`;
    if (this.orchestrator && typeof this.orchestrator.getSessionDomId === 'function') {
      return this.orchestrator.getSessionDomId(prefix, sid);
    }
    // Fallback: keep legacy behavior (may include selector-hostile chars, but works for getElementById).
    return `${prefix}-${sid}`;
  }

  getElementByScopedId(container, elementId) {
    if (!container || !elementId) return null;
    try {
      const escapedId = window.CSS?.escape ? window.CSS.escape(elementId) : String(elementId);
      return container.querySelector(`#${escapedId}`);
    } catch {
      return null;
    }
  }

  getTerminalElement(sessionId) {
    const terminalId = this.getDomId('terminal', sessionId);
    const activeContainer = this.orchestrator?.getTerminalGrid?.() || null;
    const scopedElement = this.getElementByScopedId(activeContainer, terminalId);
    if (scopedElement) return scopedElement;
    return document.getElementById(terminalId);
  }

  getWrapperElement(sessionId) {
    const wrapperId = this.getDomId('wrapper', sessionId);
    const activeContainer = this.orchestrator?.getTerminalGrid?.() || null;
    const scopedElement = this.getElementByScopedId(activeContainer, wrapperId);
    if (scopedElement) return scopedElement;
    return document.getElementById(wrapperId);
  }

  getContainerElement(sessionId) {
    const terminalElement = this.getTerminalElement(sessionId);
    if (!terminalElement) return null;
    return terminalElement.closest('.terminal-body') || terminalElement.closest('.terminal-wrapper') || terminalElement;
  }

  shouldLogFit(sessionId, key) {
    const now = Date.now();
    const mapKey = `${sessionId}:${key}`;
    const lastAt = this.fitLogLastAt.get(mapKey) || 0;
    if (now - lastAt < this.fitLogCooldownMs) return false;
    this.fitLogLastAt.set(mapKey, now);
    return true;
  }

  debugFit(sessionId, key, message) {
    if (!this.debugTerminalFit) return;
    if (!this.shouldLogFit(sessionId, `debug:${key}`)) return;
    console.log(message);
  }

  warnFit(sessionId, key, message) {
    if (!this.shouldLogFit(sessionId, `warn:${key}`)) return;
    console.warn(message);
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
    this.applyAutosuggestStyles();
  }

  applyAutosuggestStyles() {
    if (document.getElementById('terminal-autosuggest-styles')) return;

    const style = document.createElement('style');
    style.id = 'terminal-autosuggest-styles';
    style.textContent = `
      .terminal-autosuggest-overlay {
        position: absolute;
        pointer-events: none;
        z-index: 10;
        white-space: pre;
        overflow: hidden;
        color: rgba(108, 117, 125, 0.6);
        font-variant-ligatures: none;
      }
    `;
    document.head.appendChild(style);
  }

  createTerminal(sessionId, sessionInfo, terminalElementOverride = null) {
    // Skip if already exists
    if (this.terminals.has(sessionId)) {
      console.warn(`Terminal ${sessionId} already exists, skipping creation`);
      return this.terminals.get(sessionId);
    }
    
    const terminalElement = terminalElementOverride && terminalElementOverride.isConnected
      ? terminalElementOverride
      : this.getTerminalElement(sessionId);
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

      // Add id/name to xterm textarea for accessibility/linting
      this.setTerminalInputAttributes(sessionId, terminalElement);

      // Fit terminal after opening — multiple passes to handle renderer init timing
      requestAnimationFrame(() => {
        this.fitTerminal(sessionId);
        // Delayed refit catches cases where xterm renderer hasn't measured char dimensions yet
        setTimeout(() => this.fitTerminal(sessionId), 300);
        setTimeout(() => this.fitTerminal(sessionId), 1000);
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
    
    // Handle input with autosuggestion tracking
    terminal.onData((data) => {
      // Check for right-arrow acceptance of suggestion
      if (data === '\x1b[C') {
        const suggestion = this.currentSuggestions.get(sessionId);
        const inputBuf = this.inputBuffers.get(sessionId) || '';
        if (suggestion && suggestion.suggestion && inputBuf.length > 0) {
          const remainder = suggestion.suggestion.slice(inputBuf.length);
          if (remainder) {
            // Accept the suggestion: type the remaining text into the PTY
            this.orchestrator?.onManualTerminalInput?.(sessionId);
            this.orchestrator.sendTerminalInput(sessionId, remainder);
            this.inputBuffers.set(sessionId, suggestion.suggestion);
            this.clearSuggestion(sessionId);
            return; // Don't forward the arrow key
          }
        }
      }

      this.orchestrator?.onManualTerminalInput?.(sessionId);
      this.orchestrator.sendTerminalInput(sessionId, data);

      // Track input buffer for autosuggestions
      this.updateInputBuffer(sessionId, data);
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

    // Initialize autosuggestion for this terminal
    this.inputBuffers.set(sessionId, '');
    this.setupAutosuggestOverlay(sessionId, terminalElement);

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

  setTerminalInputAttributes(sessionId, terminalElement) {
    if (!terminalElement) return;
    const textarea = terminalElement.querySelector('.xterm-helper-textarea');
    if (!textarea) return;
    if (!textarea.id) {
      textarea.id = `terminal-input-${sessionId}`;
    }
    if (!textarea.name) {
      textarea.name = `terminal-input-${sessionId}`;
    }
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
      
      // Ctrl+V for paste with debouncing (supports both text and images)
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

        // Try to read clipboard with full access (images + text)
        this.handleClipboardPaste(sessionId).catch(err => {
          console.error('Failed to handle clipboard paste:', err);
          // Reset the paste time on error so user can retry immediately
          this.lastPasteTimes.delete(sessionId);
        });

        return false;
      }

      // Alt+↑ / Alt+↓: cycle tier for this terminal quickly.
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const delta = e.key === 'ArrowUp' ? 1 : -1;
        this.orchestrator?.cycleTierForSession?.(sessionId, delta);
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
        this.orchestrator?.onManualTerminalInput?.(sessionId);
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

  /**
   * Handle clipboard paste - supports both text and images
   * Images are uploaded to the server and the file path is pasted into the terminal
   */
  async handleClipboardPaste(sessionId) {
    try {
      // Try to use the modern clipboard API that supports images
      const clipboardItems = await navigator.clipboard.read();

      for (const item of clipboardItems) {
        // Check for image types first
        const imageType = item.types.find(type => type.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          await this.uploadAndPasteImage(sessionId, blob, imageType);
          return;
        }

        // Fall back to text
        if (item.types.includes('text/plain')) {
          const blob = await item.getType('text/plain');
          const text = await blob.text();
          this.orchestrator?.onManualTerminalInput?.(sessionId);
          this.orchestrator.sendTerminalInput(sessionId, text);
          return;
        }
      }

      // If no supported content found, try readText as fallback
      const text = await navigator.clipboard.readText();
      if (text) {
        this.orchestrator?.onManualTerminalInput?.(sessionId);
        this.orchestrator.sendTerminalInput(sessionId, text);
      }
    } catch (err) {
      // Some browsers don't support clipboard.read(), fall back to readText
      console.warn('clipboard.read() not supported, falling back to readText:', err.message);
      try {
        const text = await navigator.clipboard.readText();
        this.orchestrator?.onManualTerminalInput?.(sessionId);
        this.orchestrator.sendTerminalInput(sessionId, text);
      } catch (textErr) {
        console.error('Failed to read text from clipboard:', textErr);
        throw textErr;
      }
    }
  }

  /**
   * Upload an image blob to the server and paste the file path into the terminal
   */
  async uploadAndPasteImage(sessionId, blob, mimeType) {
    try {
      // Show a brief loading indicator in the terminal
      const terminal = this.terminals.get(sessionId);
      if (terminal) {
        terminal.write('\r\n[Uploading image...]\r');
      }

      // Create FormData with the image
      const formData = new FormData();
      const extension = mimeType.split('/')[1] || 'png';
      formData.append('image', blob, `clipboard_image.${extension}`);

      // Upload to server
      const response = await fetch('/api/terminal/upload-image', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }

      const result = await response.json();

      // Clear the loading indicator and paste the file path
      if (terminal) {
        // Clear the loading message (move cursor up and clear line)
        terminal.write('\x1b[1A\x1b[2K');
      }

      // Send the file path to the terminal
      this.orchestrator?.onManualTerminalInput?.(sessionId);
      this.orchestrator.sendTerminalInput(sessionId, result.filePath);

      console.log('Image uploaded and path pasted:', result.filePath);
    } catch (err) {
      console.error('Failed to upload image:', err);

      // Clear loading indicator and show error
      const terminal = this.terminals.get(sessionId);
      if (terminal) {
        terminal.write('\x1b[1A\x1b[2K');
        terminal.write(`\r\n[Image paste failed: ${err.message}]\r\n`);
      }

      throw err;
    }
  }

  setupResizeObserver(sessionId) {
    const terminalElement = this.getTerminalElement(sessionId);
    if (!terminalElement) return;

    // Observe the element whose size actually changes with layout.
    // In practice, the `.terminal-body` resizes with grid/sidebar/tab changes.
    const terminalBody = terminalElement.closest('.terminal-body');
    const wrapper = this.getWrapperElement(sessionId);
    const observeTarget = terminalBody || wrapper || terminalElement;

    const resizeObserver = new ResizeObserver(() => {
      // Use requestAnimationFrame to ensure renderer is ready before fitting
      requestAnimationFrame(() => {
        this.fitTerminal(sessionId);
      });
    });

    resizeObserver.observe(observeTarget);

    // Store observer for cleanup
    observeTarget._resizeObserver = resizeObserver;
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
        const terminalElement = this.getTerminalElement(sessionId);
        if (!terminalElement) {
          // Terminal DOM may not be mounted yet (e.g., tab switching before wrappers are rendered).
          // Avoid fitting (and noisy retries) until the element exists.
          if (retryCount < 3) {
            const retryDelay = 100 * (retryCount + 1);
            this.fitTimers.delete(sessionId);
            setTimeout(() => this.fitTerminal(sessionId, retryCount + 1), retryDelay);
          } else {
            this.fitTimers.delete(sessionId);
          }
          return;
        }
        const terminalBody = terminalElement?.closest('.terminal-body');
        const wrapper = this.getWrapperElement(sessionId);

        // If the terminal isn't visible (hidden tab/dashboard, hidden worktree, etc), NEVER fit.
        // Fitting while hidden can shrink the PTY to tiny dimensions and cause hard-wrapped output.
        const hiddenByWrapper = wrapper && wrapper.style.display === 'none';
        const hiddenByLayout = terminalElement && terminalElement.offsetParent === null;
        const detached = terminalElement && !terminalElement.isConnected;

        if (hiddenByWrapper || hiddenByLayout || detached) {
          this.fitTimers.delete(sessionId);
          return;
        }

        if (terminalBody) {
          const bodyRect = terminalBody.getBoundingClientRect();

          // If container is too small (hidden or not laid out yet), retry
          // Note: tiny containers can show up briefly during layout transitions (tab swaps, hide/show).
          // Fitting xterm while tiny causes hard reflow/wrapping that doesn't recover cleanly.
          if (bodyRect.width < 180 || bodyRect.height < 120) {
            if (retryCount < 5) {
              // Schedule retry with increasing delay
              const retryDelay = 100 * (retryCount + 1);
              this.debugFit(
                sessionId,
                'container-too-small',
                `Terminal ${sessionId} container too small (${bodyRect.width}x${bodyRect.height}), retrying in ${retryDelay}ms (attempt ${retryCount + 1}/5)`
              );
              this.fitTimers.delete(sessionId);
              setTimeout(() => this.fitTerminal(sessionId, retryCount + 1), retryDelay);
              return;
            } else {
              // If we still can't get a reasonable size, do NOT fit. We'll retry on the next resize/show,
              // and also schedule a delayed retry in case the browser doesn't emit a resize event after
              // a display/layout transition.
              this.warnFit(
                sessionId,
                'container-still-too-small',
                `Terminal ${sessionId} container still too small after 5 retries (${bodyRect.width}x${bodyRect.height}); skipping fit`
              );
              if (!this.delayedFitTimers) this.delayedFitTimers = new Map();
              if (!this.delayedFitTimers.has(sessionId)) {
                const t = setTimeout(() => {
                  this.delayedFitTimers.delete(sessionId);
                  this.fitTerminal(sessionId, 0);
                }, 1200);
                this.delayedFitTimers.set(sessionId, t);
              }
              this.fitTimers.delete(sessionId);
              return;
            }
          }
        }

        // Guard: if the fit addon predicts tiny dimensions, do NOT fit yet.
        // This avoids resizing xterm (and potentially reflowing the buffer) while layout/fonts are unstable.
        if (typeof fitAddon.proposeDimensions === 'function') {
          const proposed = fitAddon.proposeDimensions();
          const proposedCols = proposed?.cols || 0;
          const proposedRows = proposed?.rows || 0;

          const lastGood = this.lastGoodPtyDimensions.get(sessionId);
          const minStableCols = lastGood
            ? Math.max(this.minPtyCols, Math.floor(lastGood.cols * 0.6))
            : this.minPtyCols;
          const minStableRows = this.minPtyRows;

          if (proposedCols < minStableCols || proposedRows < minStableRows) {
            if (retryCount < 5) {
              const retryDelay = 120 * (retryCount + 1);
              this.debugFit(
                sessionId,
                'proposed-too-small',
                `Terminal ${sessionId} proposed fit too small (${proposedCols}x${proposedRows}; min ${minStableCols}x${minStableRows}), retrying in ${retryDelay}ms (attempt ${retryCount + 1}/5)`
              );
              this.fitTimers.delete(sessionId);
              setTimeout(() => this.fitTerminal(sessionId, retryCount + 1), retryDelay);
              return;
            }

            this.warnFit(
              sessionId,
              'proposed-still-too-small',
              `Terminal ${sessionId} proposed fit still too small after 5 retries (${proposedCols}x${proposedRows}; min ${minStableCols}x${minStableRows}); skipping fit`
            );
            this.fitTimers.delete(sessionId);
            return;
          }
        }

        fitAddon.fit();

        // Get dimensions and (only if reasonable) notify server. Resizing the PTY to
        // very small sizes can hard-wrap output in the shell, which can't be undone.
        const cols = terminal?.cols || 0;
        const rows = terminal?.rows || 0;
        const isReasonablePtySize = cols >= this.minPtyCols && rows >= this.minPtyRows;

        if (!isReasonablePtySize) {
          this.warnFit(
            sessionId,
            'fit-produced-tiny-size',
            `Terminal ${sessionId} fit produced tiny size: ${cols}x${rows}; not resizing PTY`
          );
          if (retryCount < 3) {
            setTimeout(() => this.fitTerminal(sessionId, retryCount + 1), 200);
          }
        } else {
          this.lastGoodPtyDimensions.set(sessionId, { cols, rows });
          this.orchestrator.resizeTerminal(sessionId, cols, rows);
        }

        // Force refresh after fit to prevent rendering artifacts
        requestAnimationFrame(() => {
          if (terminal && !terminal._core?.disposed) {
            terminal.refresh(0, Math.max(0, terminal.rows - 1));
          }
        });
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
      const terminalElement = this.getTerminalElement(sessionId);
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
        const normalized = this.normalizeOutput(sessionId, data);
        if (normalized) {
          newTerminal.write(normalized);
        }
      }
      return;
    }

    // Check if user is manually scrolling
    const isUserScrolling = this.userScrolling.get(sessionId) || false;

    const normalized = this.normalizeOutput(sessionId, data);
    if (!normalized) {
      return;
    }

    // Write data to terminal
    terminal.write(normalized);

    // Reposition or clear autosuggestion overlay after new output
    this.repositionSuggestion(sessionId);

    // Check if this is a carriage return update (like a spinner)
    // Don't auto-scroll for CR updates to avoid breaking the overwrite behavior
    const hasCarriageReturn = normalized.includes('\r') && !normalized.includes('\n');

    // Only auto-scroll if user is not manually scrolling and autoScroll is enabled
    // AND this isn't a carriage return update (spinner)
    if (this.orchestrator.settings.autoScroll && !isUserScrolling && !hasCarriageReturn) {
      terminal.scrollToBottom();
    }

    // Check for special patterns (optional enhancement)
    this.checkOutputPatterns(sessionId, normalized);
  }

  normalizeOutput(sessionId, data) {
    if (!data) return data;

    const state = this.ephemeralLineState.get(sessionId) || { pendingEol: false };
    let output = '';
    const parts = data.split('\n');

    for (let i = 0; i < parts.length; i++) {
      const rawLine = parts[i];
      const hasNewline = i < parts.length - 1;
      const line = rawLine.replace(/\r/g, '');

      if (this.isEphemeralLine(line)) {
        output += `\r\x1b[2K${line}`;
        state.pendingEol = true;
        continue;
      }

      if (state.pendingEol) {
        output += '\r\n';
        state.pendingEol = false;
      }

      output += rawLine;
      if (hasNewline) {
        output += '\n';
      }
    }

    this.ephemeralLineState.set(sessionId, state);
    return output;
  }

  isEphemeralLine(line) {
    if (!line) return false;
    return /ctrl\+c to interrupt/i.test(line) || /ctrl\+t to hide todos/i.test(line);
  }
  
  checkOutputPatterns(sessionId, data) {
    // Check for error patterns
    if (/error|failed|exception/i.test(data)) {
      // Could highlight the terminal or show a visual indicator
      const container = this.getContainerElement(sessionId);
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
    let searchBar = document.getElementById(this.getDomId('search', sessionId));
    if (!searchBar) {
      searchBar = this.createSearchBar(sessionId);
      const container = this.getContainerElement(sessionId);
      container?.appendChild(searchBar);
    }
    
    // Show search bar
    searchBar.classList.remove('hidden');
    const searchInput = searchBar.querySelector('input');
    searchInput.focus();
    searchInput.select();
  }
  
  createSearchBar(sessionId) {
    const searchBar = document.createElement('div');
    searchBar.id = this.getDomId('search', sessionId);
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
    const searchBar = document.getElementById(this.getDomId('search', sessionId));
    if (searchBar) {
      searchBar.classList.add('hidden');
    }
  }
  
  // ── Autosuggestion system ──────────────────────────────────────────

  setupAutosuggestOverlay(sessionId, terminalElement) {
    const overlay = document.createElement('span');
    overlay.className = 'terminal-autosuggest-overlay';
    overlay.style.display = 'none';

    // Attach to the xterm-screen element for correct positioning
    const screen = terminalElement.querySelector('.xterm-screen');
    if (screen) {
      screen.style.position = 'relative';
      screen.appendChild(overlay);
    } else {
      // Fallback: attach after terminal opens via RAF
      requestAnimationFrame(() => {
        const s = terminalElement.querySelector('.xterm-screen');
        if (s) {
          s.style.position = 'relative';
          s.appendChild(overlay);
        }
      });
    }

    this.suggestionOverlays.set(sessionId, overlay);
  }

  updateInputBuffer(sessionId, data) {
    let buf = this.inputBuffers.get(sessionId) || '';

    // Determine what happened based on the data
    if (data === '\r' || data === '\n') {
      // Enter pressed: save command to history, clear buffer
      if (buf.trim()) {
        this.orchestrator?.handleTerminalCommandExecuted?.(sessionId, buf);
        this.orchestrator?.socket?.emit('command-executed', { sessionId, command: buf });
      }
      this.inputBuffers.set(sessionId, '');
      if (this.autosuggestEnabled) this.clearSuggestion(sessionId);
      return;
    }

    if (data === '\x7f' || data === '\b') {
      // Backspace: remove last character
      buf = buf.slice(0, -1);
      this.inputBuffers.set(sessionId, buf);
      if (this.autosuggestEnabled) this.debounceSuggest(sessionId, buf);
      return;
    }

    if (data === '\x03' || data === '\x15' || data === '\x0c') {
      // Ctrl+C, Ctrl+U, Ctrl+L: clear the input buffer
      this.inputBuffers.set(sessionId, '');
      if (this.autosuggestEnabled) this.clearSuggestion(sessionId);
      return;
    }

    if (data === '\x17') {
      // Ctrl+W: delete last word
      buf = buf.replace(/\S+\s*$/, '');
      this.inputBuffers.set(sessionId, buf);
      if (this.autosuggestEnabled) this.debounceSuggest(sessionId, buf);
      return;
    }

    // Escape sequences (arrow keys, etc.) - ignore for buffer tracking
    if (data.startsWith('\x1b')) {
      return;
    }

    // Tab - clear suggestion (shell will handle completion)
    if (data === '\t') {
      this.inputBuffers.set(sessionId, '');
      if (this.autosuggestEnabled) this.clearSuggestion(sessionId);
      return;
    }

    // Regular printable characters
    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      buf += data;
      this.inputBuffers.set(sessionId, buf);
      if (this.autosuggestEnabled) this.debounceSuggest(sessionId, buf);
      return;
    }

    // Multi-character paste
    if (data.length > 1 && !data.startsWith('\x1b')) {
      buf += data;
      this.inputBuffers.set(sessionId, buf);
      if (this.autosuggestEnabled) this.debounceSuggest(sessionId, buf);
      return;
    }
  }

  debounceSuggest(sessionId, prefix) {
    // Clear any existing timer
    const existing = this.suggestTimers.get(sessionId);
    if (existing) clearTimeout(existing);

    if (!prefix || prefix.length < 2) {
      this.clearSuggestion(sessionId);
      return;
    }

    // Don't suggest when in alternate buffer (vim, less, etc.)
    const terminal = this.terminals.get(sessionId);
    if (terminal && terminal.buffer.active.type === 'alternate') {
      this.clearSuggestion(sessionId);
      return;
    }

    // Don't suggest when an agent is active (user is chatting with Claude, not in shell)
    const session = this.orchestrator?.sessions?.get(sessionId);
    if (session) {
      const status = session.status || session.state;
      if (status === 'thinking' || status === 'executing' || status === 'waiting') {
        this.clearSuggestion(sessionId);
        return;
      }
    }

    const timer = setTimeout(() => {
      this.suggestTimers.delete(sessionId);
      this.orchestrator?.socket?.emit('autosuggest-request', { sessionId, prefix });
    }, this.suggestDebounceMs);

    this.suggestTimers.set(sessionId, timer);
  }

  handleAutosuggestResponse(sessionId, suggestion, prefix) {
    // Only show if the prefix still matches what the user has typed
    const currentBuf = this.inputBuffers.get(sessionId) || '';
    if (currentBuf !== prefix) return;

    if (!suggestion) {
      this.clearSuggestion(sessionId);
      return;
    }

    this.currentSuggestions.set(sessionId, { suggestion, prefix });
    this.showSuggestion(sessionId, suggestion.slice(prefix.length));
  }

  showSuggestion(sessionId, remainderText) {
    if (!remainderText) {
      this.clearSuggestion(sessionId);
      return;
    }

    const terminal = this.terminals.get(sessionId);
    const overlay = this.suggestionOverlays.get(sessionId);
    if (!terminal || !overlay) return;

    // Get cell dimensions from the terminal renderer
    const dims = terminal._core?._renderService?.dimensions;
    if (!dims) {
      this.clearSuggestion(sessionId);
      return;
    }

    const cellWidth = dims.css.cell.width;
    const cellHeight = dims.css.cell.height;
    const cursorX = terminal.buffer.active.cursorX;
    const cursorY = terminal.buffer.active.cursorY;

    overlay.textContent = remainderText;
    overlay.style.left = `${cursorX * cellWidth}px`;
    overlay.style.top = `${cursorY * cellHeight}px`;
    overlay.style.lineHeight = `${cellHeight}px`;
    overlay.style.fontSize = `${terminal.options.fontSize}px`;
    overlay.style.fontFamily = terminal.options.fontFamily;
    overlay.style.display = 'inline';
  }

  repositionSuggestion(sessionId) {
    const suggestion = this.currentSuggestions.get(sessionId);
    if (!suggestion) return;

    const currentBuf = this.inputBuffers.get(sessionId) || '';
    if (!currentBuf || currentBuf !== suggestion.prefix) {
      this.clearSuggestion(sessionId);
      return;
    }

    // Reposition at current cursor
    this.showSuggestion(sessionId, suggestion.suggestion.slice(suggestion.prefix.length));
  }

  clearSuggestion(sessionId) {
    const overlay = this.suggestionOverlays.get(sessionId);
    if (overlay) {
      overlay.style.display = 'none';
      overlay.textContent = '';
    }
    this.currentSuggestions.delete(sessionId);
  }

  // ── End autosuggestion system ────────────────────────────────────

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

    // Clean up autosuggestion state
    this.clearSuggestion(sessionId);
    this.inputBuffers.delete(sessionId);
    const overlay = this.suggestionOverlays.get(sessionId);
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    this.suggestionOverlays.delete(sessionId);
    const suggestTimer = this.suggestTimers.get(sessionId);
    if (suggestTimer) clearTimeout(suggestTimer);
    this.suggestTimers.delete(sessionId);

    // Clean up scroll state
    this.terminalScrollStates.delete(sessionId);
    this.userScrolling.delete(sessionId);

    // Clean up addons
    this.fitAddons.delete(sessionId);
    this.searchAddons.delete(sessionId);
    this.webLinksAddons.delete(sessionId);
    
    // Clean up resize observer
    const terminalElement = this.getTerminalElement(sessionId);
    if (terminalElement) {
      // Disconnect any observer (may be stored on terminal body or on terminal element)
      const terminalBody = terminalElement.closest('.terminal-body');
      const observer = terminalElement._resizeObserver || terminalBody?._resizeObserver;
      if (observer) observer.disconnect();
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
