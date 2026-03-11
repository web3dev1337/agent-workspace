/**
 * WorkspaceTabManager - Manages multiple workspace tabs with proper XTerm lifecycle
 *
 * Key responsibilities:
 * - Create/destroy workspace tabs
 * - Switch between tabs seamlessly
 * - Preserve XTerm instances and state
 * - Handle notifications for inactive tabs
 * - Route socket events to correct tab
 */
class WorkspaceTabManager {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.tabs = new Map(); // tabId -> TabState
    this.activeTabId = null;
    this.nextTabIndex = 1;

    // DOM references
    this.tabsContainer = null;
    this.viewsContainer = null;

    this.init();
  }

  init() {
    // Create tab bar container if not exists
    this.createTabBarContainer();

    // Set up keyboard shortcuts
    this.setupKeyboardShortcuts();
  }

  createTabBarContainer() {
    const mainContainer = document.querySelector('.main-container');
    if (!mainContainer) {
      console.error('Main container not found');
      return;
    }

    // Create tabs container
    const tabsContainer = document.createElement('div');
    tabsContainer.id = 'workspace-tabs-container';
    tabsContainer.className = 'workspace-tabs-container';
    tabsContainer.innerHTML = `
      <button id="dashboard-btn" class="header-btn workspace-dashboard-btn" title="Dashboard" data-ui-visibility="header.dashboard">
        🏠 Agent Workspace
      </button>
      <div class="workspace-tabs" id="workspace-tabs"></div>
    `;

    // Insert before header
    const header = mainContainer.querySelector('header');
    mainContainer.insertBefore(tabsContainer, header);

    this.tabsContainer = document.getElementById('workspace-tabs');

    // Create views container wrapper for all workspace views
    const terminalGrid = document.getElementById('terminal-grid');
    if (terminalGrid) {
      // Wrap terminal grid in a view container
      const viewsWrapper = document.createElement('div');
      viewsWrapper.id = 'workspace-views-container';
      viewsWrapper.className = 'workspace-views-container';

      terminalGrid.parentNode.insertBefore(viewsWrapper, terminalGrid);
      viewsWrapper.appendChild(terminalGrid);

      this.viewsContainer = viewsWrapper;
    }
  }

  /**
   * Create default UI state for a new tab
   */
  createDefaultUIState() {
    return {
      // Terminal/grid filters
      visibleTerminals: new Set(),
      sessionActivity: new Map(),
      showActiveOnly: false,

      // Per-workspace UI state (must not leak across tabs)
      githubLinks: new Map(),
      githubLinkLogs: new Map(),
      serverStatuses: new Map(),
      serverPorts: new Map(),
      dismissedStartupUI: new Map(),
      sessionAgentPreferences: new Map(),
      autoStartApplied: new Set(),
      worktreeConfigs: new Map()
    };
  }

  /**
   * Create a new tab for a workspace
   */
  createTab(workspace, sessions = []) {
    // Prevent duplicate tabs for the same workspace
    const existingTab = this.findTabByWorkspaceId(workspace?.id);
    if (existingTab) {
      // Keep workspace metadata fresh
      existingTab.workspace = workspace;
      existingTab.displayName = workspace.name || existingTab.displayName;
      if (existingTab.tabElement) {
        const nameEl = existingTab.tabElement.querySelector('.tab-name');
        if (nameEl) {
          nameEl.textContent = existingTab.displayName;
          nameEl.title = existingTab.displayName;
        }
      }
      return existingTab.id;
    }

    const tabId = `tab-${Date.now()}-${this.nextTabIndex++}`;

    // Create tab state
    const tabState = {
      id: tabId,
      workspaceId: workspace.id,
      workspace: workspace,
      displayName: workspace.name || `Workspace ${this.nextTabIndex - 1}`,
      isActive: false,
      notifications: 0,
      lastActivity: Date.now(),
      createdAt: Date.now(),

      // Session tracking
      sessions: new Map(), // sessionId -> session data

      // DOM references
      containerElement: null,
      tabElement: null,

      // XTerm state
      terminals: new Map(), // sessionId -> { xtermInstance, lastScrollPos, etc }

      // UI/filter state
      uiState: this.createDefaultUIState(),

      // Observer for resize handling
      resizeObserver: null,

      // Socket listeners for cleanup
      socketListeners: []
    };

    // Seed session map if we were given initial session states (e.g. from workspace-changed)
    // Accepts: object map ({[sessionId]: state}), Map, or array.
    if (sessions && typeof sessions === 'object' && !Array.isArray(sessions) && !(sessions instanceof Map)) {
      for (const [sessionId, state] of Object.entries(sessions)) {
        tabState.sessions.set(sessionId, { sessionId, ...state, hasUserInput: false });
      }
    } else if (sessions instanceof Map) {
      for (const [sessionId, state] of sessions.entries()) {
        tabState.sessions.set(sessionId, state);
      }
    } else if (Array.isArray(sessions)) {
      for (const item of sessions) {
        if (!item) continue;
        if (typeof item === 'string') {
          tabState.sessions.set(item, { sessionId: item });
        } else if (item.sessionId) {
          tabState.sessions.set(item.sessionId, item);
        }
      }
    }

    // Create tab UI element
    this.createTabElement(tabState);

    // Create workspace view container
    this.createWorkspaceView(tabState);

    // Store tab
    this.tabs.set(tabId, tabState);

    console.log(`Created tab ${tabId} for workspace ${workspace.name}`);

    // If this is the first tab, activate it
    if (this.tabs.size === 1) {
      this.switchTab(tabId);
    }

    return tabId;
  }

  /**
   * Create the tab UI element
   */
  createTabElement(tabState) {
    const tabEl = document.createElement('div');
    tabEl.className = 'workspace-tab';
    tabEl.dataset.tabId = tabState.id;

    tabEl.innerHTML = `
      <span class="tab-icon">📁</span>
      <span class="tab-name" title="${tabState.displayName}">${tabState.displayName}</span>
      <span class="tab-badge hidden" data-count="0">0</span>
      <button class="tab-close" title="Close tab">×</button>
    `;

    // Tab click handler
    tabEl.addEventListener('click', (e) => {
      if (!e.target.classList.contains('tab-close')) {
        this.switchTab(tabState.id);
      }
    });

    // Close button handler
    const closeBtn = tabEl.querySelector('.tab-close');
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeTab(tabState.id);
    });

    // Add to tabs container (before the + button if it exists)
    const newTabBtn = this.tabsContainer.querySelector('.tab-new');
    if (newTabBtn) {
      this.tabsContainer.insertBefore(tabEl, newTabBtn);
    } else {
      this.tabsContainer.appendChild(tabEl);

      // Create new tab button if it doesn't exist
      const newBtn = document.createElement('button');
      newBtn.className = 'tab-new';
      newBtn.title = 'New workspace';
      newBtn.innerHTML = '+';
      newBtn.addEventListener('click', () => this.showWorkspaceWizard());
      this.tabsContainer.appendChild(newBtn);
    }

    tabState.tabElement = tabEl;
  }

  /**
   * Create the workspace view container
   */
  createWorkspaceView(tabState) {
    // For the first tab, use the existing terminal-grid
    if (this.tabs.size === 0) {
      const existingGrid = document.getElementById('terminal-grid');
      if (existingGrid) {
        existingGrid.dataset.tabId = tabState.id;
        existingGrid.classList.add('workspace-view');
        tabState.containerElement = existingGrid;
        return;
      }
    }

    // Create new workspace view container
    const viewContainer = document.createElement('main');
    viewContainer.id = `workspace-view-${tabState.id}`;
    viewContainer.className = 'workspace-view terminal-grid hidden';
    viewContainer.dataset.tabId = tabState.id;

    this.viewsContainer.appendChild(viewContainer);
    tabState.containerElement = viewContainer;
  }

  /**
   * Switch to a different tab
   */
  async switchTab(tabId) {
    const targetTab = this.tabs.get(tabId);
    if (!targetTab) {
      console.error(`Tab ${tabId} not found`);
      return;
    }

    // IMPORTANT: The backend currently has a single "active workspace". If the user
    // activates a different workspace tab, request a workspace switch first to prevent
    // cross-workspace terminal/output contamination.
    const currentWorkspaceId = this.orchestrator?.currentWorkspace?.id || null;
    if (this.orchestrator?.socket?.connected && targetTab.workspaceId && targetTab.workspaceId !== currentWorkspaceId) {
      console.log(`Requesting backend workspace switch for tab ${tabId}: ${currentWorkspaceId} → ${targetTab.workspaceId}`);
      this.orchestrator.socket.emit('switch-workspace', { workspaceId: targetTab.workspaceId });
      return;
    }

    // If already active, do nothing
    if (this.activeTabId === tabId) {
      return;
    }

    const previousTabId = this.activeTabId;

    // Hide previous tab
    if (previousTabId) {
      const previousTab = this.tabs.get(previousTabId);
      if (previousTab) {
        this.hideWorkspace(previousTab);
      }
    }

    // Show new tab
    this.showWorkspace(targetTab);

    // Update active state
    this.activeTabId = tabId;

    // Update UI
    this.updateTabUI();

    // Clear notifications for this tab
    this.clearNotifications(tabId);

    // Update orchestrator's current workspace AND currentTabId
    this.orchestrator.currentWorkspace = targetTab.workspace;
    this.orchestrator.currentTabId = tabId; // CRITICAL: Keep in sync
    this.orchestrator.isDashboardMode = false;

    // CRITICAL: Restore session data from this tab
    // The sidebar and other UI elements depend on orchestrator.sessions
    this.orchestrator.sessions.clear();
    targetTab.sessions.forEach((sessionData, sessionId) => {
      this.orchestrator.sessions.set(sessionId, sessionData);
    });
    console.log(`Restored ${targetTab.sessions.size} sessions to orchestrator`);

    // Rebuild sidebar for new workspace
    if (this.orchestrator.buildSidebar) {
      this.orchestrator.buildSidebar();
    }

    // Restore UI/filter state and update terminal grid
    this.restoreTabUIState(targetTab);

    console.log(`Switched to tab ${tabId} (${targetTab.displayName})`);
  }

  /**
   * Switch to a workspace by name (for voice commands / Commander)
   */
  switchToWorkspace(workspaceName) {
    // Find tab by workspace name (case-insensitive)
    const searchName = workspaceName.toLowerCase();
    for (const [tabId, tabState] of this.tabs) {
      if (tabState.displayName.toLowerCase().includes(searchName) ||
          tabState.workspace?.name?.toLowerCase().includes(searchName)) {
        this.switchTab(tabId);
        return true;
      }
    }
    console.warn(`Workspace not found: ${workspaceName}`);
    return false;
  }

  /**
   * Hide a workspace (preserve state)
   */
  hideWorkspace(tabState) {
    if (!tabState || !tabState.containerElement) return;

    console.log(`Hiding workspace ${tabState.displayName}`);

    // Persist UI/filter state (visible terminals, filters, etc.) for later restoration
    this.saveTabUIState(tabState);

    // CRITICAL: Save session data from orchestrator to this tab
    // This prevents session data from being lost when switching tabs
    this.orchestrator.sessions.forEach((sessionData, sessionId) => {
      tabState.sessions.set(sessionId, sessionData);
    });
    console.log(`Saved ${tabState.sessions.size} sessions from orchestrator to tab`);

    // CRITICAL: Save terminal instances from global manager to this tab
    // This prevents them from being overwritten when another tab loads
    const terminalManager = this.orchestrator.terminalManager;
    if (terminalManager) {
      tabState.terminals.forEach((termData, sessionId) => {
        // Update with current instance from global manager
        const currentInstance = terminalManager.terminals.get(sessionId);
        if (currentInstance) {
          termData.xtermInstance = currentInstance;
          termData.fitAddon = terminalManager.fitAddons.get(sessionId);
        }

        if (termData.xtermInstance) {
          try {
            const xterm = termData.xtermInstance;
            const buffer = xterm.buffer.active;
            const scrollOffset = buffer.baseY - buffer.viewportY;

            termData.lastScrollPos = buffer.viewportY;
            termData.wasAtBottom = scrollOffset <= 5;
            termData.cursorState = {
              x: buffer.cursorX,
              y: buffer.cursorY
            };
          } catch (err) {
            console.warn(`Failed to save scroll position for ${sessionId}:`, err);
          }
        }
      });
    }

    // Disconnect resize observer
    if (tabState.resizeObserver) {
      tabState.resizeObserver.disconnect();
      tabState.resizeObserver = null;
    }

    // Hide container - XTerm instances stay in tab.terminals
    tabState.containerElement.classList.add('hidden');
    tabState.isActive = false;
  }

  /**
   * Show a workspace (restore state)
   */
  showWorkspace(tabState) {
    if (!tabState || !tabState.containerElement) return;

    console.log(`Showing workspace ${tabState.displayName}`);

    // CRITICAL: Restore terminal instances from this tab to global manager
    // This ensures the correct terminals are active
    const terminalManager = this.orchestrator.terminalManager;
    if (terminalManager) {
      console.log(`Restoring ${tabState.terminals.size} terminals to global manager`);

      // Clear global manager first
      terminalManager.terminals.clear();
      terminalManager.fitAddons.clear();

      // Restore this tab's terminals
      tabState.terminals.forEach((termData, sessionId) => {
        if (termData.xtermInstance) {
          terminalManager.terminals.set(sessionId, termData.xtermInstance);
          if (termData.fitAddon) {
            terminalManager.fitAddons.set(sessionId, termData.fitAddon);
          }
          console.log(`Restored terminal ${sessionId} to global manager`);
        }
      });
    }

    // Show container first
    tabState.containerElement.classList.remove('hidden');

    // CRITICAL: Wait for render before fitting terminals
    // Use double requestAnimationFrame to ensure DOM is fully painted
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Get terminal manager for robust fitting with retry logic
        const terminalManager = this.orchestrator?.terminalManager;

        // Refit all terminals
        tabState.terminals.forEach((termData, sessionId) => {
          if (!termData.xtermInstance) return;

          const xterm = termData.xtermInstance;

          // Use terminalManager's fitTerminal for robust fitting with retry logic
          if (terminalManager && terminalManager.fitTerminal) {
            terminalManager.fitTerminal(sessionId);
          } else {
            // Fallback: direct fit
            const terminalElement = document.getElementById(`terminal-${sessionId}`);
            if (terminalElement && terminalElement.offsetWidth > 0) {
              try {
                const fitAddon = termData.fitAddon || xterm._fitAddon;
                if (fitAddon && typeof fitAddon.fit === 'function') {
                  fitAddon.fit();
                }
              } catch (err) {
                console.error(`Failed to fit terminal ${sessionId}:`, err);
              }
            }
          }

          // Restore scroll position:
          // - If the user was at bottom when they left the tab, keep them at bottom (don't force old viewportY).
          // - If they were scrolled up, restore to their previous position.
          try {
            if (termData.wasAtBottom) {
              xterm.scrollToBottom();
            } else if (termData.lastScrollPos !== undefined) {
              xterm.scrollToLine(termData.lastScrollPos);
            }
          } catch (err) {
            // Ignore scroll errors
          }
        });

        // Schedule a secondary fit pass to catch any missed terminals
        setTimeout(() => {
          if (tabState.isActive && terminalManager) {
            tabState.terminals.forEach((termData, sessionId) => {
              if (termData.xtermInstance) {
                terminalManager.fitTerminal(sessionId);
              }
            });
          }
        }, 300);

        // Set up resize observer
        tabState.resizeObserver = new ResizeObserver(() => {
          if (tabState.isActive) {
            // Only fit terminals if this tab is still active
            this.fitTabTerminals(tabState.id);
          }
        });

        if (tabState.containerElement) {
          tabState.resizeObserver.observe(tabState.containerElement);
        }
      });
    });

    tabState.isActive = true;
  }

  /**
   * Fit all terminals in a tab
   */
  fitTabTerminals(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab || !tab.isActive) return;

    const terminalManager = this.orchestrator?.terminalManager;

    tab.terminals.forEach((termData, sessionId) => {
      if (termData.xtermInstance) {
        // Prefer the orchestrator's TerminalManager, which has visibility guards and
        // retry logic to avoid shrinking terminals while layout is transient.
        if (terminalManager && typeof terminalManager.fitTerminal === 'function') {
          terminalManager.fitTerminal(sessionId);
          return;
        }

        // Fallback: direct fit (best-effort).
        try {
          const fitAddon = termData.xtermInstance._fitAddon;
          if (fitAddon && typeof fitAddon.fit === 'function') {
            fitAddon.fit();
          }
        } catch (err) {
          console.warn(`Failed to fit terminal ${sessionId}:`, err);
        }
      }
    });
  }

  /**
   * Update tab UI (active state, badges, etc)
   */
  updateTabUI() {
    this.tabs.forEach((tab) => {
      if (tab.tabElement) {
        if (tab.id === this.activeTabId) {
          tab.tabElement.classList.add('active');
        } else {
          tab.tabElement.classList.remove('active');
        }
      }
    });
  }

  /**
   * Register a terminal with a tab
   */
  registerTerminal(tabId, sessionId, xtermInstance, fitAddon) {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      console.warn(`Cannot register terminal - tab ${tabId} not found`);
      return;
    }

    tab.terminals.set(sessionId, {
      xtermInstance: xtermInstance,
      fitAddon: fitAddon,
      // Only restore scroll position after we've captured it at least once.
      // Using 0 here can incorrectly jump the terminal to the top.
      lastScrollPos: undefined,
      wasAtBottom: true,
      cursorState: { x: 0, y: 0 }
    });

    // Store reference on xterm instance for fitting
    xtermInstance._fitAddon = fitAddon;

    console.log(`Registered terminal ${sessionId} with tab ${tabId}`);
  }

  /**
   * Unregister a terminal from a tab
   */
  unregisterTerminal(tabId, sessionId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    const termData = tab.terminals.get(sessionId);
    if (termData && termData.xtermInstance) {
      // Dispose XTerm instance
      try {
        termData.xtermInstance.dispose();
      } catch (err) {
        console.warn(`Error disposing terminal ${sessionId}:`, err);
      }
    }

    tab.terminals.delete(sessionId);
    console.log(`Unregistered terminal ${sessionId} from tab ${tabId}`);
  }

  /**
   * Add notification to inactive tab
   */
  notifyTab(tabId, eventType = 'output') {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.isActive) return;

    // Increment badge
    tab.notifications++;

    // Update UI
    if (tab.tabElement) {
      const badge = tab.tabElement.querySelector('.tab-badge');
      if (badge) {
        badge.textContent = tab.notifications;
        badge.classList.remove('hidden');
      }

      // Flash tab based on event type
      if (eventType === 'error') {
        tab.tabElement.classList.add('tab-flash-error');
        setTimeout(() => tab.tabElement.classList.remove('tab-flash-error'), 500);
      } else {
        tab.tabElement.classList.add('tab-flash');
        setTimeout(() => tab.tabElement.classList.remove('tab-flash'), 500);
      }
    }
  }

  /**
   * Clear notifications for a tab
   */
  clearNotifications(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    tab.notifications = 0;

    if (tab.tabElement) {
      const badge = tab.tabElement.querySelector('.tab-badge');
      if (badge) {
        badge.classList.add('hidden');
      }
    }
  }

  /**
   * Close a tab
   */
  async closeTab(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    // Confirm if there are active sessions
    if (tab.terminals.size > 0) {
      const confirm = window.confirm(
        `Close workspace "${tab.displayName}"?\n\n` +
        `This will terminate ${tab.terminals.size} terminal session(s).`
      );
      if (!confirm) return;
    }

    const wasActive = tab.isActive;

    console.log(`Closing tab ${tabId} (${tab.displayName})`);

    // Dispose all XTerm instances
    tab.terminals.forEach((termData, sessionId) => {
      if (termData.xtermInstance) {
        try {
          termData.xtermInstance.dispose();
        } catch (err) {
          console.warn(`Error disposing terminal ${sessionId}:`, err);
        }
      }
    });
    tab.terminals.clear();

    // Disconnect resize observer
    if (tab.resizeObserver) {
      tab.resizeObserver.disconnect();
    }

    // Tell backend to close all sessions for this tab
    if (this.orchestrator.socket) {
      const sessionIds = Array.from(tab.terminals.keys());
      this.orchestrator.socket.emit('close-tab', { tabId: tabId, sessionIds });
    }

    // Remove DOM elements
    if (tab.tabElement) {
      tab.tabElement.remove();
    }
    if (tab.containerElement && tab.containerElement.id !== 'terminal-grid') {
      // Don't remove the original terminal-grid
      tab.containerElement.remove();
    }

    // Remove from tabs map
    this.tabs.delete(tabId);

    // If we closed the active tab, switch to another
    if (wasActive) {
      if (this.tabs.size > 0) {
        const firstTab = Array.from(this.tabs.values())[0];
        await this.switchTab(firstTab.id);
      } else {
        // No tabs left - show dashboard/wizard
        this.activeTabId = null;
        this.showWorkspaceWizard();
      }
    }

    console.log(`Tab ${tabId} closed`);
  }

  /**
   * Show workspace wizard for new tab
   */
  showWorkspaceWizard() {
    if (this.orchestrator.dashboard) {
      this.orchestrator.dashboard.show();
      this.orchestrator.isDashboardMode = true;
    }
  }

  shouldIgnoreShortcutEvent(e) {
    if (!e || e.defaultPrevented) return true;
    const target = e.target;
    const tag = String(target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (target?.isContentEditable) return true;
    return false;
  }

  /**
   * Get active tab
   */
  getActiveTab() {
    return this.tabs.get(this.activeTabId);
  }

  /**
   * Get tab by ID
   */
  getTab(tabId) {
    return this.tabs.get(tabId);
  }

  /**
   * Find a tab by workspace ID
   */
  findTabByWorkspaceId(workspaceId) {
    if (!workspaceId) return null;
    for (const tab of this.tabs.values()) {
      if (tab.workspaceId === workspaceId) {
        return tab;
      }
    }
    return null;
  }

  /**
   * Remove a tab UI/state without closing backend sessions
   */
  discardTabUI(tabState) {
    if (!tabState) return;

    // Dispose XTerm instances (UI only)
    tabState.terminals.forEach((termData) => {
      if (termData?.xtermInstance) {
        try {
          termData.xtermInstance.dispose();
        } catch (err) {
          console.warn(`Error disposing terminal during tab discard:`, err);
        }
      }
    });
    tabState.terminals.clear();

    // Disconnect resize observer
    if (tabState.resizeObserver) {
      tabState.resizeObserver.disconnect();
      tabState.resizeObserver = null;
    }

    // Remove DOM elements
    if (tabState.tabElement) {
      tabState.tabElement.remove();
    }
    if (tabState.containerElement && tabState.containerElement.id !== 'terminal-grid') {
      tabState.containerElement.remove();
    }

    // Remove from tabs map
    this.tabs.delete(tabState.id);
  }

  /**
   * Prune duplicate tabs for the same workspace
   */
  pruneDuplicateWorkspaceTabs(workspaceId, keepTabId = null) {
    if (!workspaceId) return;

    const tabsForWorkspace = Array.from(this.tabs.values())
      .filter(tab => tab.workspaceId === workspaceId);

    if (tabsForWorkspace.length <= 1) return;

    const keepTab =
      tabsForWorkspace.find(tab => tab.id === keepTabId) ||
      tabsForWorkspace.find(tab => tab.isActive) ||
      tabsForWorkspace.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];

    tabsForWorkspace.forEach(tab => {
      if (tab.id !== keepTab.id) {
        this.discardTabUI(tab);
      }
    });

    // Ensure the kept tab is still active
    if (this.activeTabId !== keepTab.id) {
      this.switchTab(keepTab.id);
    }

    console.log(`Pruned ${tabsForWorkspace.length - 1} duplicate tab(s) for workspace ${workspaceId}`);
  }

  /**
   * Set up keyboard shortcuts (Alt-based to avoid browser conflicts)
   */
  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (this.shouldIgnoreShortcutEvent(e)) return;

      // Alt + Arrow Left - Previous tab
      if (e.altKey && e.key === 'ArrowLeft' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        this.previousTab();
      }

      // Alt + Arrow Right - Next tab
      if (e.altKey && e.key === 'ArrowRight' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        this.nextTab();
      }

      // Alt + W - Close current tab
      if (e.altKey && e.key === 'w' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        if (this.activeTabId) {
          e.preventDefault();
          this.closeTab(this.activeTabId);
        }
      }

      // Alt + Shift + N - New project wizard
      if (e.altKey && e.shiftKey && String(e.key || '').toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        this.orchestrator?.openGreenfieldWizard?.().catch?.(() => {});
      }

      // Alt + N - New tab
      if (e.altKey && e.key === 'n' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        this.showWorkspaceWizard();
      }

      // Alt + 1-9 - Switch to tab by index
      if (e.altKey && e.key >= '1' && e.key <= '9' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        const index = parseInt(e.key) - 1;
        const tabs = Array.from(this.tabs.values());
        if (tabs[index]) {
          this.switchTab(tabs[index].id);
        }
      }
    });
  }

  /**
   * Switch to next tab
   */
  nextTab() {
    if (this.tabs.size === 0) return;

    const tabs = Array.from(this.tabs.values());
    const currentIndex = tabs.findIndex(t => t.id === this.activeTabId);
    const nextIndex = (currentIndex + 1) % tabs.length;

    this.switchTab(tabs[nextIndex].id);
  }

  /**
   * Switch to previous tab
   */
  previousTab() {
    if (this.tabs.size === 0) return;

    const tabs = Array.from(this.tabs.values());
    const currentIndex = tabs.findIndex(t => t.id === this.activeTabId);
    const prevIndex = currentIndex === 0 ? tabs.length - 1 : currentIndex - 1;

    this.switchTab(tabs[prevIndex].id);
  }

  /**
   * Save UI/filter state for a tab (visible terminals, filters, etc.)
   */
  saveTabUIState(tabState) {
    if (!tabState || !this.orchestrator) return;

    const { visibleTerminals, sessionActivity, showActiveOnly } = this.orchestrator;

    // Cancel any pending startup UI timers; they can fire while hidden and resurrect overlays.
    if (this.orchestrator.startupUIDebounce) {
      for (const t of this.orchestrator.startupUIDebounce.values()) {
        clearTimeout(t);
      }
      this.orchestrator.startupUIDebounce.clear();
    }

    tabState.uiState = {
      visibleTerminals: visibleTerminals ? new Set(visibleTerminals) : new Set(),
      sessionActivity: sessionActivity ? new Map(sessionActivity) : new Map(),
      showActiveOnly: !!showActiveOnly,

      githubLinks: this.orchestrator.githubLinks ? new Map(this.orchestrator.githubLinks) : new Map(),
      githubLinkLogs: this.orchestrator.githubLinkLogs ? new Map(this.orchestrator.githubLinkLogs) : new Map(),
      serverStatuses: this.orchestrator.serverStatuses ? new Map(this.orchestrator.serverStatuses) : new Map(),
      serverPorts: this.orchestrator.serverPorts ? new Map(this.orchestrator.serverPorts) : new Map(),
      dismissedStartupUI: this.orchestrator.dismissedStartupUI ? new Map(this.orchestrator.dismissedStartupUI) : new Map(),
      sessionAgentPreferences: this.orchestrator.sessionAgentPreferences ? new Map(this.orchestrator.sessionAgentPreferences) : new Map(),
      autoStartApplied: this.orchestrator.autoStartApplied ? new Set(this.orchestrator.autoStartApplied) : new Set(),
      worktreeConfigs: this.orchestrator.worktreeConfigs ? new Map(this.orchestrator.worktreeConfigs) : new Map()
    };
  }

  /**
   * Restore UI/filter state for a tab and redraw the terminal grid
   */
  restoreTabUIState(tabState) {
    if (!tabState || !this.orchestrator) return;

    const orchestrator = this.orchestrator;
    const savedVisible = tabState.uiState?.visibleTerminals;
    const fallbackVisible = new Set(tabState.sessions ? tabState.sessions.keys() : []);

    let nextVisible;
    if (savedVisible instanceof Set) {
      nextVisible = new Set(savedVisible);
    } else if (savedVisible && typeof savedVisible[Symbol.iterator] === 'function') {
      nextVisible = new Set(savedVisible);
    } else {
      nextVisible = fallbackVisible;
    }

    if ((!nextVisible || nextVisible.size === 0) && fallbackVisible.size > 0) {
      nextVisible = fallbackVisible;
    }

    orchestrator.visibleTerminals = nextVisible || new Set();
    orchestrator.showActiveOnly = !!(tabState.uiState && tabState.uiState.showActiveOnly);

    if (tabState.uiState?.sessionActivity) {
      orchestrator.sessionActivity = new Map(tabState.uiState.sessionActivity);
    } else {
      orchestrator.sessionActivity = new Map();
    }

    // Restore per-workspace UI state (prevents cross-tab leakage)
    orchestrator.githubLinks = tabState.uiState?.githubLinks ? new Map(tabState.uiState.githubLinks) : new Map();
    orchestrator.githubLinkLogs = tabState.uiState?.githubLinkLogs ? new Map(tabState.uiState.githubLinkLogs) : new Map();
    orchestrator.serverStatuses = tabState.uiState?.serverStatuses ? new Map(tabState.uiState.serverStatuses) : new Map();
    orchestrator.serverPorts = tabState.uiState?.serverPorts ? new Map(tabState.uiState.serverPorts) : new Map();
    orchestrator.dismissedStartupUI = tabState.uiState?.dismissedStartupUI ? new Map(tabState.uiState.dismissedStartupUI) : new Map();
    orchestrator.sessionAgentPreferences = tabState.uiState?.sessionAgentPreferences ? new Map(tabState.uiState.sessionAgentPreferences) : new Map();
    orchestrator.autoStartApplied = tabState.uiState?.autoStartApplied ? new Set(tabState.uiState.autoStartApplied) : new Set();
    orchestrator.worktreeConfigs = tabState.uiState?.worktreeConfigs ? new Map(tabState.uiState.worktreeConfigs) : new Map();

    if (typeof orchestrator.updateTerminalGrid === 'function') {
      orchestrator.updateTerminalGrid();
    }
  }
}

// Make available globally
window.WorkspaceTabManager = WorkspaceTabManager;
