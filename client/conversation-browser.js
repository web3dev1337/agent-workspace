/**
 * ConversationBrowser - UI for browsing and resuming Claude conversations
 *
 * Features:
 * - Search with autocomplete
 * - Filter by project, branch, folder, date
 * - Sort by date, tokens, messages
 * - Resume conversation in worktree
 * - Add worktree from conversation
 */

class ConversationBrowser {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.conversations = [];
    this.filteredConversations = [];
    this.searchTimeout = null;
    this.serverUrl = window.location.port === '2080' ? 'http://localhost:3000' :
                     window.location.port === '2081' ? 'http://localhost:4000' :
                     window.location.origin;
    this.currentSort = 'date';
    this.sortDirection = 'desc';
    this.filters = {
      project: '',
      branch: '',
      folder: '',
      query: ''
    };
  }

  async show() {
    console.log('Opening conversation browser...');

    // Create modal
    this.renderModal();

    // Load recent conversations
    await this.loadRecent();
  }

  renderModal() {
    // Remove existing modal
    const existing = document.getElementById('conversation-browser');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'conversation-browser';
    modal.className = 'modal conversation-browser-modal';
    modal.innerHTML = `
      <div class="modal-content browser-content">
        <div class="browser-header">
          <h2>Claude Conversations</h2>
          <button class="close-btn" onclick="this.closest('.modal').remove()">X</button>
        </div>

        <div class="browser-toolbar">
          <div class="search-container">
            <input type="text" id="conv-search" placeholder="Search conversations..."
                   oninput="window.conversationBrowser.handleSearch(this.value)">
            <div class="autocomplete-dropdown" id="autocomplete-dropdown"></div>
          </div>

          <div class="filter-container">
            <select id="conv-project-filter" onchange="window.conversationBrowser.applyFilter('project', this.value)">
              <option value="">All Projects</option>
            </select>

            <select id="conv-sort" onchange="window.conversationBrowser.handleSort(this.value)">
              <option value="date-desc">Newest First</option>
              <option value="date-asc">Oldest First</option>
              <option value="tokens-desc">Most Tokens</option>
              <option value="messages-desc">Most Messages</option>
            </select>

            <button class="btn-secondary" onclick="window.conversationBrowser.refresh()">
              Refresh
            </button>
          </div>
        </div>

        <div class="browser-stats" id="browser-stats">
          Loading...
        </div>

        <div class="browser-list" id="conversation-list">
          <div class="loading">Loading conversations...</div>
        </div>

        <div class="browser-footer">
          <span id="result-count">0 conversations</span>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    window.conversationBrowser = this;

    // Load projects for filter dropdown
    this.loadProjects();
  }

  async loadRecent() {
    try {
      const response = await fetch(`${this.serverUrl}/api/conversations/recent?limit=100`);
      if (!response.ok) throw new Error('Failed to load conversations');

      this.conversations = await response.json();
      this.filteredConversations = [...this.conversations];
      this.renderList();
      this.updateStats();
    } catch (error) {
      console.error('Failed to load conversations:', error);
      this.showError('Failed to load conversations');
    }
  }

  async loadProjects() {
    try {
      const response = await fetch(`${this.serverUrl}/api/conversations/projects`);
      if (!response.ok) return;

      const projects = await response.json();
      const select = document.getElementById('conv-project-filter');

      for (const project of projects) {
        const option = document.createElement('option');
        option.value = project;
        option.textContent = project;
        select.appendChild(option);
      }
    } catch (error) {
      console.error('Failed to load projects:', error);
    }
  }

  async handleSearch(query) {
    this.filters.query = query;

    // Debounce search
    clearTimeout(this.searchTimeout);

    if (query.length < 2) {
      this.hideAutocomplete();
      this.applyFilters();
      return;
    }

    this.searchTimeout = setTimeout(async () => {
      // Show autocomplete
      await this.showAutocomplete(query);

      // Search on server
      await this.serverSearch();
    }, 300);
  }

  async showAutocomplete(query) {
    try {
      const response = await fetch(`${this.serverUrl}/api/conversations/autocomplete?q=${encodeURIComponent(query)}`);
      if (!response.ok) return;

      const suggestions = await response.json();
      const dropdown = document.getElementById('autocomplete-dropdown');

      if (suggestions.length === 0) {
        this.hideAutocomplete();
        return;
      }

      dropdown.innerHTML = suggestions.map(s => `
        <div class="autocomplete-item" onclick="window.conversationBrowser.selectSuggestion('${s.type}', '${s.value}')">
          <span class="suggestion-type">${s.type}</span>
          <span class="suggestion-value">${s.value}</span>
        </div>
      `).join('');

      dropdown.style.display = 'block';
    } catch (error) {
      console.error('Autocomplete failed:', error);
    }
  }

  hideAutocomplete() {
    const dropdown = document.getElementById('autocomplete-dropdown');
    if (dropdown) dropdown.style.display = 'none';
  }

  selectSuggestion(type, value) {
    this.hideAutocomplete();

    if (type === 'project') {
      document.getElementById('conv-project-filter').value = value;
      this.applyFilter('project', value);
    } else {
      document.getElementById('conv-search').value = value;
      this.filters.query = value;
      this.serverSearch();
    }
  }

  async serverSearch() {
    try {
      const params = new URLSearchParams();
      if (this.filters.query) params.append('q', this.filters.query);
      if (this.filters.project) params.append('project', this.filters.project);
      if (this.filters.branch) params.append('branch', this.filters.branch);
      if (this.filters.folder) params.append('folder', this.filters.folder);
      params.append('limit', '100');

      const response = await fetch(`${this.serverUrl}/api/conversations/search?${params}`);
      if (!response.ok) throw new Error('Search failed');

      const data = await response.json();
      this.filteredConversations = data.results;
      this.renderList();
      this.updateResultCount(data.total);
    } catch (error) {
      console.error('Search failed:', error);
    }
  }

  applyFilter(type, value) {
    this.filters[type] = value;
    this.serverSearch();
  }

  applyFilters() {
    // Client-side filtering
    this.filteredConversations = this.conversations.filter(conv => {
      if (this.filters.project && conv.project !== this.filters.project) return false;
      if (this.filters.branch && (!conv.branch || !conv.branch.includes(this.filters.branch))) return false;
      if (this.filters.folder && (!conv.cwd || !conv.cwd.includes(this.filters.folder))) return false;
      if (this.filters.query) {
        const q = this.filters.query.toLowerCase();
        const matches = (conv.summary && conv.summary.toLowerCase().includes(q)) ||
                        (conv.preview && conv.preview.toLowerCase().includes(q)) ||
                        (conv.project && conv.project.toLowerCase().includes(q)) ||
                        (conv.branch && conv.branch.toLowerCase().includes(q)) ||
                        (conv.cwd && conv.cwd.toLowerCase().includes(q));
        if (!matches) return false;
      }
      return true;
    });

    this.sortConversations();
    this.renderList();
    this.updateResultCount(this.filteredConversations.length);
  }

  handleSort(value) {
    const [field, direction] = value.split('-');
    this.currentSort = field;
    this.sortDirection = direction;
    this.sortConversations();
    this.renderList();
  }

  sortConversations() {
    const dir = this.sortDirection === 'desc' ? -1 : 1;

    this.filteredConversations.sort((a, b) => {
      switch (this.currentSort) {
        case 'date':
          return dir * ((a.lastTimestamp || '').localeCompare(b.lastTimestamp || ''));
        case 'tokens':
          return dir * ((a.totalTokens || 0) - (b.totalTokens || 0));
        case 'messages':
          return dir * ((a.messageCount || 0) - (b.messageCount || 0));
        default:
          return 0;
      }
    });
  }

  renderList() {
    const container = document.getElementById('conversation-list');

    if (this.filteredConversations.length === 0) {
      container.innerHTML = '<div class="no-results">No conversations found</div>';
      return;
    }

    container.innerHTML = this.filteredConversations.map(conv => this.renderConversationItem(conv)).join('');
  }

  renderConversationItem(conv) {
    const date = conv.lastTimestamp ? new Date(conv.lastTimestamp).toLocaleDateString() : 'Unknown';
    const time = conv.lastTimestamp ? new Date(conv.lastTimestamp).toLocaleTimeString() : '';
    const folder = conv.cwd ? conv.cwd.split('/').slice(-2).join('/') : '';

    return `
      <div class="conversation-item" data-id="${conv.id}" data-project="${conv.project}">
        <div class="conv-header">
          <span class="conv-project">${conv.project}</span>
          <span class="conv-date">${date} ${time}</span>
        </div>

        <div class="conv-preview">${conv.preview || conv.summary || '(No preview)'}</div>

        <div class="conv-meta">
          ${conv.branch ? `<span class="meta-item branch">${conv.branch}</span>` : ''}
          ${folder ? `<span class="meta-item folder">${folder}</span>` : ''}
          <span class="meta-item tokens">${this.formatTokens(conv.totalTokens)} tokens</span>
          <span class="meta-item messages">${conv.messageCount} msgs</span>
        </div>

        <div class="conv-actions">
          <button class="btn-small" onclick="window.conversationBrowser.resumeConversation('${conv.id}', '${conv.project}', '${conv.cwd || ''}')">
            Resume
          </button>
          <button class="btn-small secondary" onclick="window.conversationBrowser.showDetails('${conv.id}', '${conv.project}')">
            Details
          </button>
        </div>
      </div>
    `;
  }

  formatTokens(tokens) {
    if (!tokens) return '0';
    if (tokens >= 1000000) return (tokens / 1000000).toFixed(1) + 'M';
    if (tokens >= 1000) return (tokens / 1000).toFixed(1) + 'K';
    return tokens.toString();
  }

  async updateStats() {
    try {
      const response = await fetch(`${this.serverUrl}/api/conversations/stats`);
      if (!response.ok) return;

      const stats = await response.json();
      const statsEl = document.getElementById('browser-stats');

      statsEl.innerHTML = `
        <span>${stats.totalConversations} conversations</span>
        <span>${stats.totalProjects} projects</span>
        <span>${this.formatTokens(stats.totalTokens)} total tokens</span>
      `;
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  }

  updateResultCount(count) {
    const el = document.getElementById('result-count');
    if (el) el.textContent = `${count} conversation${count !== 1 ? 's' : ''}`;
  }

  async resumeConversation(id, project, cwd) {
    console.log('Resuming conversation:', { id, project, cwd });

    // If we have a cwd, we can resume in that directory
    if (cwd && this.orchestrator) {
      // Find a matching worktree session
      const sessions = Array.from(this.orchestrator.sessions?.values() || []);
      const matchingSession = sessions.find(s =>
        s.worktreePath && cwd.includes(s.worktreePath)
      );

      if (matchingSession) {
        // Send resume command to the session
        this.orchestrator.socket?.emit('terminal-input', {
          sessionId: matchingSession.id,
          input: `claude --resume ${id}\n`
        });

        // Close browser
        document.getElementById('conversation-browser')?.remove();
        return;
      }
    }

    // Otherwise, show instructions
    alert(`To resume this conversation, run:\ncd ${cwd || '~'}\nclaude --resume ${id}`);
  }

  async showDetails(id, project) {
    try {
      const response = await fetch(`${this.serverUrl}/api/conversations/${id}?project=${project}`);
      if (!response.ok) throw new Error('Failed to load conversation');

      const conv = await response.json();
      this.renderDetailsModal(conv);
    } catch (error) {
      console.error('Failed to load conversation details:', error);
      alert('Failed to load conversation details');
    }
  }

  renderDetailsModal(conv) {
    // Remove existing details modal
    const existing = document.getElementById('conversation-details');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'conversation-details';
    modal.className = 'modal conversation-details-modal';
    modal.innerHTML = `
      <div class="modal-content details-content">
        <div class="details-header">
          <h3>${conv.project}</h3>
          <button class="close-btn" onclick="this.closest('.modal').remove()">X</button>
        </div>

        <div class="details-meta">
          <p><strong>Session:</strong> ${conv.sessionId || conv.id}</p>
          <p><strong>Branch:</strong> ${conv.branch || 'N/A'}</p>
          <p><strong>Folder:</strong> ${conv.cwd || 'N/A'}</p>
          <p><strong>Model:</strong> ${conv.model || 'N/A'}</p>
          <p><strong>Started:</strong> ${conv.firstTimestamp ? new Date(conv.firstTimestamp).toLocaleString() : 'N/A'}</p>
          <p><strong>Last activity:</strong> ${conv.lastTimestamp ? new Date(conv.lastTimestamp).toLocaleString() : 'N/A'}</p>
          <p><strong>Messages:</strong> ${conv.messageCount}</p>
          <p><strong>Tokens:</strong> ${this.formatTokens(conv.totalInputTokens)} in / ${this.formatTokens(conv.totalOutputTokens)} out</p>
        </div>

        ${conv.summary ? `<div class="details-summary"><strong>Summary:</strong> ${conv.summary}</div>` : ''}

        <div class="details-messages">
          <h4>Messages (${conv.messages?.length || 0})</h4>
          <div class="messages-list">
            ${(conv.messages || []).slice(0, 20).map(m => this.renderMessage(m)).join('')}
            ${(conv.messages?.length || 0) > 20 ? `<div class="more-messages">+ ${conv.messages.length - 20} more messages</div>` : ''}
          </div>
        </div>

        <div class="details-actions">
          <button class="btn-primary" onclick="window.conversationBrowser.resumeConversation('${conv.id}', '${conv.project}', '${conv.cwd || ''}')">
            Resume Conversation
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
  }

  renderMessage(msg) {
    const isUser = msg.role === 'user';
    const preview = (msg.content || '').slice(0, 500);

    return `
      <div class="message ${isUser ? 'user' : 'assistant'}">
        <div class="message-header">
          <span class="role">${isUser ? 'User' : 'Assistant'}</span>
          ${msg.timestamp ? `<span class="time">${new Date(msg.timestamp).toLocaleTimeString()}</span>` : ''}
        </div>
        <div class="message-content">${this.escapeHtml(preview)}${msg.content?.length > 500 ? '...' : ''}</div>
        ${msg.toolUses ? `<div class="tool-uses">${msg.toolUses.map(t => t.name).join(', ')}</div>` : ''}
      </div>
    `;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  async refresh() {
    const list = document.getElementById('conversation-list');
    list.innerHTML = '<div class="loading">Refreshing...</div>';

    try {
      await fetch(`${this.serverUrl}/api/conversations/refresh`, { method: 'POST' });
      await this.loadRecent();
    } catch (error) {
      console.error('Refresh failed:', error);
      this.showError('Failed to refresh');
    }
  }

  showError(message) {
    const list = document.getElementById('conversation-list');
    list.innerHTML = `<div class="error">${message}</div>`;
  }
}

// Export for use
if (typeof window !== 'undefined') {
  window.ConversationBrowser = ConversationBrowser;
}
