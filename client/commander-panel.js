/**
 * Commander Panel - Frontend UI for Top-Level AI
 * Provides a chat interface to interact with Commander Claude
 */

class CommanderPanel {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.isVisible = false;
    this.isLoading = false;
    this.messages = [];
    this.serverUrl = window.location.port === '2080' || window.location.port === '2081'
      ? `http://localhost:${window.location.port === '2080' ? '3000' : '4000'}`
      : window.location.origin;
    this.status = null;
  }

  /**
   * Initialize the Commander Panel
   */
  async init() {
    this.createPanelHTML();
    this.attachEventListeners();
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
      toggleBtn.title = 'Commander (Top-Level AI)';
      toggleBtn.innerHTML = '🎖️';
      headerActions.insertBefore(toggleBtn, headerActions.firstChild);
    }

    // Create panel
    const panel = document.createElement('div');
    panel.id = 'commander-panel';
    panel.className = 'commander-panel hidden';
    panel.innerHTML = `
      <div class="commander-header">
        <div class="commander-title">
          <span class="commander-icon">🎖️</span>
          <h3>Commander Claude</h3>
          <span class="commander-status" id="commander-status-badge">Checking...</span>
        </div>
        <div class="commander-actions">
          <button id="commander-clear" class="icon-button" title="Clear history">🗑️</button>
          <button id="commander-close" class="icon-button" title="Close">✕</button>
        </div>
      </div>
      <div class="commander-messages" id="commander-messages">
        <div class="commander-welcome">
          <p>I'm Commander Claude, your top-level AI assistant for the orchestrator.</p>
          <p>I can help you:</p>
          <ul>
            <li>Create new projects</li>
            <li>Switch workspaces</li>
            <li>Send commands to terminals</li>
            <li>Check port usage</li>
            <li>Coordinate across sessions</li>
          </ul>
          <p>Try: "List all workspaces" or "What ports are in use?"</p>
        </div>
      </div>
      <div class="commander-input-area">
        <textarea id="commander-input" placeholder="Ask Commander..." rows="2"></textarea>
        <button id="commander-send" class="button-primary" disabled>
          <span class="send-icon">➤</span>
        </button>
      </div>
    `;
    document.body.appendChild(panel);
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Toggle button
    const toggleBtn = document.getElementById('commander-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => this.toggle());
    }

    // Close button
    const closeBtn = document.getElementById('commander-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.hide());
    }

    // Clear button
    const clearBtn = document.getElementById('commander-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clearHistory());
    }

    // Send button
    const sendBtn = document.getElementById('commander-send');
    if (sendBtn) {
      sendBtn.addEventListener('click', () => this.sendMessage());
    }

    // Input field
    const input = document.getElementById('commander-input');
    if (input) {
      input.addEventListener('input', () => {
        const sendBtn = document.getElementById('commander-send');
        sendBtn.disabled = !input.value.trim();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (input.value.trim()) {
            this.sendMessage();
          }
        }
      });
    }

    // ESC to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isVisible) {
        this.hide();
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
        this.status = await response.json();
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
    if (badge && this.status) {
      if (this.status.enabled) {
        badge.textContent = 'Online';
        badge.className = 'commander-status online';
      } else {
        badge.textContent = 'No API Key';
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
  show() {
    const panel = document.getElementById('commander-panel');
    if (panel) {
      panel.classList.remove('hidden');
      this.isVisible = true;
      const input = document.getElementById('commander-input');
      if (input) input.focus();
    }
  }

  /**
   * Hide the panel
   */
  hide() {
    const panel = document.getElementById('commander-panel');
    if (panel) {
      panel.classList.add('hidden');
      this.isVisible = false;
    }
  }

  /**
   * Send a message to Commander
   */
  async sendMessage() {
    const input = document.getElementById('commander-input');
    const message = input.value.trim();
    if (!message || this.isLoading) return;

    // Clear input
    input.value = '';
    document.getElementById('commander-send').disabled = true;

    // Add user message to UI
    this.addMessage('user', message);

    // Show loading
    this.isLoading = true;
    this.addMessage('loading', '');

    try {
      const response = await fetch(`${this.serverUrl}/api/commander/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: message })
      });

      // Remove loading message
      this.removeLoadingMessage();

      if (response.ok) {
        const result = await response.json();

        // Show tool calls if any
        if (result.toolCalls && result.toolCalls.length > 0) {
          for (const tc of result.toolCalls) {
            this.addMessage('tool', `Used: ${tc.tool}`);
          }
        }

        // Show response
        this.addMessage('assistant', result.response || 'Command executed.');
      } else {
        const error = await response.json();
        this.addMessage('error', `Error: ${error.error || 'Unknown error'}`);
      }
    } catch (error) {
      this.removeLoadingMessage();
      this.addMessage('error', `Connection error: ${error.message}`);
    }

    this.isLoading = false;
  }

  /**
   * Add a message to the chat
   */
  addMessage(type, content) {
    const container = document.getElementById('commander-messages');
    if (!container) return;

    // Remove welcome message on first real message
    const welcome = container.querySelector('.commander-welcome');
    if (welcome && type !== 'loading') {
      welcome.remove();
    }

    const msg = document.createElement('div');
    msg.className = `commander-message ${type}`;

    if (type === 'loading') {
      msg.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
    } else if (type === 'tool') {
      msg.innerHTML = `<span class="tool-badge">🔧 ${this.escapeHtml(content)}</span>`;
    } else {
      msg.innerHTML = `<div class="message-content">${this.formatMessage(content)}</div>`;
    }

    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;

    this.messages.push({ type, content });
  }

  /**
   * Remove loading message
   */
  removeLoadingMessage() {
    const container = document.getElementById('commander-messages');
    const loading = container?.querySelector('.commander-message.loading');
    if (loading) loading.remove();
  }

  /**
   * Format message content (basic markdown)
   */
  formatMessage(content) {
    if (!content) return '';

    // Escape HTML first
    let html = this.escapeHtml(content);

    // Code blocks
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Line breaks
    html = html.replace(/\n/g, '<br>');

    return html;
  }

  /**
   * Escape HTML
   */
  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Clear conversation history
   */
  async clearHistory() {
    try {
      await fetch(`${this.serverUrl}/api/commander/clear`, { method: 'POST' });
      this.messages = [];

      const container = document.getElementById('commander-messages');
      if (container) {
        container.innerHTML = `
          <div class="commander-welcome">
            <p>History cleared. How can I help you?</p>
          </div>
        `;
      }
    } catch (error) {
      console.error('Failed to clear history:', error);
    }
  }
}

// Export for use in app
window.CommanderPanel = CommanderPanel;
