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

const normalizeBrowserPath = (value) => String(value || '').replace(/\\/g, '/');
const splitBrowserPathSegments = (value) => normalizeBrowserPath(value).split('/').filter(Boolean);

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
    this.loadAll = false;
    // Load YOLO mode from localStorage, default to true
    const savedYolo = localStorage.getItem('conversationBrowser.yoloMode');
    this.yoloMode = savedYolo === null ? true : savedYolo === 'true';
    this.totalIndexed = 0;
    this.filters = {
      source: 'all',
      repo: '',
      branch: '',
      folder: '',
      query: '',
      dateFilter: ''
    };

    this._dismissPointerHandler = null;
    this._dismissKeyHandler = null;
  }

  async show() {
    console.log('Opening conversation browser...');

    // Create modal
    this.renderModal();

    // Load recent conversations
    await this.loadRecent();
  }

  renderModal() {
    this.cleanupDismissHandlers();

    // Remove existing modal
    const existing = document.getElementById('conversation-browser');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'conversation-browser';
    modal.className = 'modal conversation-browser-modal';
    modal.innerHTML = `
      <div class="modal-content browser-content">
        <div class="browser-header">
          <h2>Conversations</h2>
          <button class="close-btn" onclick="window.conversationBrowser.close()">X</button>
        </div>

        <div class="browser-toolbar">
          <div class="browser-toolbar-row">
            <div class="search-container">
              <input type="text" id="conv-search" placeholder="Search all conversations..."
                     oninput="window.conversationBrowser.handleSearch(this.value)"
                     onkeydown="window.conversationBrowser.handleSearchKeydown(event)">
              <div class="autocomplete-dropdown" id="autocomplete-dropdown"></div>
            </div>
            <button class="btn-secondary" onclick="window.conversationBrowser.refresh()">
              Refresh
            </button>
          </div>

          <div class="browser-toolbar-row">
            <div class="filter-group">
              <select id="conv-source-filter" onchange="window.conversationBrowser.applyFilter('source', this.value)">
                <option value="all">All Sources</option>
                <option value="claude">Claude</option>
                <option value="codex">Codex</option>
              </select>

              <select id="conv-repo-filter" onchange="window.conversationBrowser.applyFilter('repo', this.value)">
                <option value="">All Repos</option>
              </select>

              <select id="conv-branch-filter" onchange="window.conversationBrowser.applyFilter('branch', this.value)">
                <option value="">All Branches</option>
              </select>

              <select id="conv-date-filter" onchange="window.conversationBrowser.applyDateFilter(this.value)">
                <option value="">All Time</option>
                <option value="1h">Last Hour</option>
                <option value="24h">Last 24 Hours</option>
                <option value="3d">Last 3 Days</option>
                <option value="7d">Last Week</option>
                <option value="30d">Last Month</option>
                <option value="90d">Last 3 Months</option>
              </select>

              <select id="conv-sort" onchange="window.conversationBrowser.handleSort(this.value)">
                <option value="date-desc">Newest First</option>
                <option value="date-asc">Oldest First</option>
                <option value="tokens-desc">Most Tokens</option>
                <option value="messages-desc">Most Messages</option>
              </select>
            </div>

            <div class="browser-options">
              <label class="option-toggle">
                <input type="checkbox" id="load-all-checkbox" onchange="window.conversationBrowser.toggleLoadAll(this.checked)">
                Load all
              </label>
              <label class="option-toggle">
                <input type="checkbox" id="yolo-mode-checkbox" checked onchange="window.conversationBrowser.toggleYoloMode(this.checked)">
                YOLO mode
              </label>
            </div>
          </div>
        </div>

        <div class="browser-stats" id="browser-stats">
          Loading...
        </div>

        <div class="browser-info" id="browser-info">
          <span class="info-note">Searching <span id="total-indexed">0</span> total conversations</span>
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
    this.attachDismissHandlers(modal);

    // Set checkbox states from saved values
    const yoloCheckbox = document.getElementById('yolo-mode-checkbox');
    if (yoloCheckbox) yoloCheckbox.checked = this.yoloMode;

    // Load projects for filter dropdown
    this.loadProjects();
  }

  close() {
    this.cleanupDismissHandlers();
    document.getElementById('conversation-browser')?.remove();
  }

  attachDismissHandlers(modal) {
    // Hide autocomplete when clicking anywhere outside the search container,
    // so the dropdown doesn't block the first search result.
    this._dismissPointerHandler = (event) => {
      const searchContainer = modal.querySelector('.search-container');
      if (searchContainer && searchContainer.contains(event.target)) return;
      this.hideAutocomplete();
    };

    this._dismissKeyHandler = (event) => {
      if (event.key !== 'Escape') return;

      const dropdown = document.getElementById('autocomplete-dropdown');
      const isOpen = dropdown && dropdown.style.display !== 'none' && dropdown.innerHTML.trim().length > 0;

      if (isOpen) {
        event.preventDefault();
        this.hideAutocomplete();
        return;
      }

      // If autocomplete is not open, Escape closes the modal.
      this.close();
    };

    document.addEventListener('pointerdown', this._dismissPointerHandler, true);
    document.addEventListener('keydown', this._dismissKeyHandler, true);
  }

  cleanupDismissHandlers() {
    if (this._dismissPointerHandler) {
      document.removeEventListener('pointerdown', this._dismissPointerHandler, true);
      this._dismissPointerHandler = null;
    }

    if (this._dismissKeyHandler) {
      document.removeEventListener('keydown', this._dismissKeyHandler, true);
      this._dismissKeyHandler = null;
    }
  }

  handleSearchKeydown(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    this.hideAutocomplete();
    event.target?.blur?.();
  }

  async loadRecent() {
    try {
      // Load all if checkbox is checked, otherwise limit to 500
      const limit = this.loadAll ? 10000 : 500;
      const response = await fetch(`${this.serverUrl}/api/conversations/recent?limit=${limit}`);
      if (!response.ok) throw new Error('Failed to load conversations');

      this.conversations = await response.json();
      this.filteredConversations = [...this.conversations];
      this.renderList();
      this.updateStats();
      this.updateResultCount(this.filteredConversations.length);
      // Load filters AFTER conversations are loaded
      this.loadFilters();
    } catch (error) {
      console.error('Failed to load conversations:', error);
      this.showError('Failed to load conversations');
    }
  }

  async loadFilters() {
    // Extract repos and repo/branch combinations from loaded conversations
    const sources = new Set();
    const repos = new Set();
    const repoBranches = new Map(); // Map of "repo/branch" -> { repo, branch, lastActivity }

    for (const conv of this.conversations) {
      sources.add(String(conv.source || 'claude').toLowerCase());
      // Use actual GitHub repo if available, fallback to path extraction
      const repo = conv.gitRepo || this.extractRepoFromPath(conv.cwd);
      if (repo) repos.add(repo);

      // Track repo/branch combinations with last activity
      if (conv.branch && repo) {
        const key = `${repo}::${conv.branch}`;
        const existing = repoBranches.get(key);
        if (!existing || conv.lastTimestamp > existing.lastActivity) {
          repoBranches.set(key, {
            repo,
            branch: conv.branch,
            lastActivity: conv.lastTimestamp || ''
          });
        }
      }
    }

    // Populate source filter
    const sourceSelect = document.getElementById('conv-source-filter');
    if (sourceSelect) {
      const prev = sourceSelect.value || 'all';
      sourceSelect.innerHTML = `<option value="all">All Sources</option>`;
      const preferredOrder = ['claude', 'codex'];
      const rest = Array.from(sources)
        .filter((s) => s && !preferredOrder.includes(s))
        .sort();
      const ordered = preferredOrder.filter((s) => sources.has(s)).concat(rest);

      for (const src of ordered) {
        const option = document.createElement('option');
        option.value = src;
        option.textContent = src.charAt(0).toUpperCase() + src.slice(1);
        sourceSelect.appendChild(option);
      }

      // Restore selection if still available
      const hasPrev = Array.from(sourceSelect.options).some((o) => o.value === prev);
      sourceSelect.value = hasPrev ? prev : 'all';
    }

    // Populate repo filter
    const repoSelect = document.getElementById('conv-repo-filter');
    if (repoSelect) {
      repoSelect.innerHTML = `<option value="">All Repos</option>`;
      const sortedRepos = Array.from(repos).sort();
      for (const repo of sortedRepos) {
        const option = document.createElement('option');
        option.value = repo;
        option.textContent = repo;
        repoSelect.appendChild(option);
      }
    }

    // Populate branch filter with repo/branch format, sorted by last activity
    const branchSelect = document.getElementById('conv-branch-filter');
    if (branchSelect) {
      branchSelect.innerHTML = `<option value="">All Branches</option>`;
      const sortedBranches = Array.from(repoBranches.values())
        .sort((a, b) => (b.lastActivity || '').localeCompare(a.lastActivity || ''));

      for (const { repo, branch } of sortedBranches) {
        const option = document.createElement('option');
        // Store just the branch as value for filtering, but show repo/branch in display
        option.value = `${repo}::${branch}`;
        option.textContent = `${repo} / ${branch}`;
        branchSelect.appendChild(option);
      }
    }
  }

  extractRepoFromPath(path) {
    if (!path) return null;
    const info = this.parseProjectPath(path);
    return info?.project || null;
  }

  /**
   * Parse a path into its components:
   * $HOME/GitHub/games/hytopia/zoo-game/work2
   * -> { category: 'games', project: 'hytopia/zoo-game', worktree: 'work2' }
   */
  parseProjectPath(path) {
    if (!path) return null;

    const normalizedPath = normalizeBrowserPath(path);
    const githubIdx = normalizedPath.indexOf('GitHub/');
    if (githubIdx < 0) return null;

    const afterGitHub = normalizedPath.slice(githubIdx + 7);
    const parts = afterGitHub.split('/').filter(p => p);

    if (parts.length === 0) return null;

    // Detect worktree (work1, work2, master, main, etc.)
    let worktree = null;
    const lastPart = parts[parts.length - 1];
    if (lastPart === 'master' || lastPart === 'main' || /^work\d+$/.test(lastPart)) {
      worktree = lastPart;
      parts.pop();
    }

    // First part is usually category (games, tools, websites, etc.)
    // Skip common category names to get to actual project
    const categories = ['games', 'tools', 'websites', 'monogame', 'automation'];
    let category = null;

    if (parts.length > 0 && categories.includes(parts[0])) {
      category = parts.shift();
    }

    // Remaining parts form the project name
    // For nested projects like hytopia/zoo-game, join them
    const project = parts.length > 0 ? parts.join('/') : null;

    return { category, project, worktree };
  }

  async loadProjects() {
    // Deprecated - now using loadFilters
    this.loadFilters();
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

    if (type === 'repo') {
      document.getElementById('conv-repo-filter').value = value;
      this.applyFilter('repo', value);
    } else if (type === 'branch') {
      document.getElementById('conv-branch-filter').value = value;
      this.applyFilter('branch', value);
    } else {
      document.getElementById('conv-search').value = value;
      this.filters.query = value;
      this.applyFilters();
    }
  }

  async serverSearch() {
    try {
      const params = new URLSearchParams();
      if (this.filters.query) params.append('q', this.filters.query);
      if (this.filters.source && this.filters.source !== 'all') params.append('source', this.filters.source);
      if (this.filters.repo) params.append('project', this.filters.repo);
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
    // Use client-side filtering for quick response
    this.applyFilters();
  }

  applyDateFilter(value) {
    this.filters.dateFilter = value;
    this.applyFilters();
  }

  toggleLoadAll(checked) {
    this.loadAll = checked;
    this.loadRecent();
  }

  toggleYoloMode(checked) {
    this.yoloMode = checked;
    // Could save to localStorage for persistence
    localStorage.setItem('conversationBrowser.yoloMode', checked ? 'true' : 'false');
  }

  quoteShellValue(value) {
    const v = String(value || '');
    return `"${v.replace(/"/g, '\\"')}"`;
  }

  getResumeCommand(id, source, cwd) {
    const src = String(source || 'claude').toLowerCase();
    if (src === 'codex') {
      let cmd = 'codex resume';
      if (this.yoloMode) cmd += ' --dangerously-bypass-approvals-and-sandbox';
      if (cwd) cmd += ` -C ${this.quoteShellValue(cwd)}`;
      if (id) cmd += ` ${id}`;
      return cmd;
    }

    const baseCmd = id ? `claude --resume ${id}` : 'claude --resume';
    return this.yoloMode ? `${baseCmd} --dangerously-skip-permissions` : baseCmd;
  }

  getFullResumeCommand(id, source, cwd) {
    const cmd = this.getResumeCommand(id, source, cwd);
    if (String(source || 'claude').toLowerCase() !== 'claude') return cmd;
    if (!cwd) return cmd;
    return `cd ${this.quoteShellValue(cwd)} && ${cmd}`;
  }

  getDateFilterCutoff() {
    if (!this.filters.dateFilter) return null;

    const now = new Date();
    const cutoff = new Date(now);

    switch (this.filters.dateFilter) {
      case '1h':
        cutoff.setHours(now.getHours() - 1);
        break;
      case '24h':
        cutoff.setHours(now.getHours() - 24);
        break;
      case '3d':
        cutoff.setDate(now.getDate() - 3);
        break;
      case '7d':
        cutoff.setDate(now.getDate() - 7);
        break;
      case '30d':
        cutoff.setDate(now.getDate() - 30);
        break;
      case '90d':
        cutoff.setDate(now.getDate() - 90);
        break;
      default:
        return null;
    }

    return cutoff.toISOString();
  }

  applyFilters() {
    // Client-side filtering
    const dateCutoff = this.getDateFilterCutoff();

    // Parse branch filter (format: "repo::branch" or just "branch")
    let filterRepo = null;
    let filterBranch = null;
    if (this.filters.branch) {
      if (this.filters.branch.includes('::')) {
        [filterRepo, filterBranch] = this.filters.branch.split('::');
      } else {
        filterBranch = this.filters.branch;
      }
    }

    this.filteredConversations = this.conversations.filter(conv => {
      // Source filter
      const src = String(conv.source || 'claude').toLowerCase();
      if (this.filters.source && this.filters.source !== 'all' && src !== this.filters.source) {
        return false;
      }

      // Repo filter - use gitRepo or fallback to path extraction
      if (this.filters.repo) {
        const convRepo = conv.gitRepo || this.extractRepoFromPath(conv.cwd);
        if (!convRepo || convRepo !== this.filters.repo) return false;
      }
      // Branch filter (now includes repo check if specified)
      if (filterBranch) {
        if (conv.branch !== filterBranch) return false;
        // If repo was specified in branch filter, also check repo matches
        if (filterRepo) {
          const convRepo = conv.gitRepo || this.extractRepoFromPath(conv.cwd);
          if (!convRepo || convRepo !== filterRepo) return false;
        }
      }
      // Folder filter
      if (this.filters.folder && (!conv.cwd || !conv.cwd.includes(this.filters.folder))) return false;
      // Date filter
      if (dateCutoff && conv.lastTimestamp && conv.lastTimestamp < dateCutoff) return false;
      // Text search - track what matched for display
      if (this.filters.query) {
        const q = this.filters.query.toLowerCase();
        const matchedFields = [];

        if (conv.branch && conv.branch.toLowerCase().includes(q)) matchedFields.push('branch');
        if (conv.gitRepo && conv.gitRepo.toLowerCase().includes(q)) matchedFields.push('repo');
        if (conv.cwd && conv.cwd.toLowerCase().includes(q)) matchedFields.push('path');
        if (conv.project && conv.project.toLowerCase().includes(q)) matchedFields.push('project');
        if (conv.preview && conv.preview.toLowerCase().includes(q)) matchedFields.push('content');
        if (conv.summary && conv.summary.toLowerCase().includes(q)) matchedFields.push('content');
        if (conv.firstUserMessage && conv.firstUserMessage.toLowerCase().includes(q)) matchedFields.push('content');
        if (conv.lastMessage && conv.lastMessage.toLowerCase().includes(q)) matchedFields.push('content');

        if (matchedFields.length === 0) return false;

        // Store match info for display (dedupe content)
        conv._matchedFields = [...new Set(matchedFields)];
        // Priority: branch/repo matches are more relevant than content matches
        conv._matchPriority = matchedFields.includes('branch') ? 0 :
                              matchedFields.includes('repo') ? 1 :
                              matchedFields.includes('path') ? 2 : 3;
      } else {
        conv._matchedFields = null;
        conv._matchPriority = 99;
      }
      return true;
    });

    // Sort by match priority first (branch matches before content matches)
    if (this.filters.query) {
      this.filteredConversations.sort((a, b) => (a._matchPriority || 99) - (b._matchPriority || 99));
    }

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
    const startDate = conv.firstTimestamp ? new Date(conv.firstTimestamp) : null;
    const lastDate = conv.lastTimestamp ? new Date(conv.lastTimestamp) : null;
    // Australian date format: DD/MM/YYYY HH:MM
    const startedStr = startDate ? this.formatDateAU(startDate) : 'Unknown';
    const lastStr = lastDate ? this.timeAgo(lastDate) : 'Unknown';
    const lastFullStr = lastDate ? this.formatDateAU(lastDate) : 'Unknown';

    // Parse path into components
    const fullPath = conv.cwd || '';
    const pathInfo = this.parseProjectPath(fullPath) || {};
    const worktree = pathInfo.worktree;

    // Use actual GitHub repo if available, fallback to parsed path
    const repoName = conv.gitRepo || pathInfo.project || splitBrowserPathSegments(fullPath).slice(-2).join('/') || 'Unknown';
    const repoUrl = conv.gitRepoUrl;

    // Clean messages - remove system messages and commands
    const firstMsg = this.cleanPreview(conv.firstUserMessage || conv.preview || '');
    const lastMsg = this.cleanPreview(conv.lastMessage || '');
    const lastRole = conv.lastMessageRole || 'assistant';
    const source = String(conv.source || 'claude').toLowerCase();
    const sourceBadge = source ? `<span class="conv-source conv-source-${this.escapeHtml(source)}">${source.toUpperCase()}</span>` : '';

    // Build match indicator if search is active
    const matchIndicator = conv._matchedFields && conv._matchedFields.length > 0
      ? `<span class="match-indicator ${conv._matchedFields.includes('branch') ? 'match-branch' : conv._matchedFields.includes('content') ? 'match-content' : 'match-meta'}" title="Matched: ${conv._matchedFields.join(', ')}">⚡ ${conv._matchedFields.join(', ')}</span>`
      : '';

    return `
      <div class="conversation-item" data-id="${conv.id}" data-project="${conv.project}" data-repo="${repoName}">
        <div class="conv-header">
          ${repoUrl
            ? `<a href="${repoUrl}" target="_blank" class="conv-project-name conv-repo-link">${repoName}</a>`
            : `<span class="conv-project-name">${repoName}</span>`
          }
          ${sourceBadge}
          ${worktree ? `<span class="conv-worktree">${worktree}</span>` : ''}
          ${conv.branch ? `<span class="conv-branch">${conv.branch}</span>` : ''}
          ${matchIndicator}
          <span class="conv-date last-used" title="Last used: ${lastFullStr}">Last: ${lastStr}</span>
        </div>

        <div class="conv-messages-preview">
          <div class="msg-preview first-msg">
            <span class="msg-label">You:</span>
            <span class="msg-text">${firstMsg || '(No message)'}</span>
          </div>
          ${lastMsg && lastMsg !== firstMsg ? `
          <div class="msg-preview last-msg ${lastRole}">
            <span class="msg-label">${lastRole === 'user' ? 'You:' : (source === 'codex' ? 'Codex:' : 'Claude:')}</span>
            <span class="msg-text">${lastMsg}</span>
          </div>
          ` : ''}
        </div>

        <div class="conv-full-preview" id="full-preview-${conv.id}" style="display: none;">
          <div class="full-preview-content">Loading...</div>
        </div>

        <div class="conv-meta-row">
          <span class="meta-item folder">${fullPath || 'Unknown'}</span>
        </div>

        <div class="conv-meta-row">
          <span class="meta-item">${conv.model || 'Unknown'}</span>
          <span class="meta-item">Started: ${startedStr}</span>
          <span class="meta-item">${conv.messageCount ?? '—'} msgs (${conv.userMessageCount ?? '—'} user)</span>
          <span class="meta-item">${this.formatTokens(conv.totalTokens)} tokens</span>
        </div>

        <div class="conv-actions">
          <button class="btn-small primary" onclick="window.conversationBrowser.resumeConversation('${this.escapeAttr(conv.id)}', '${this.escapeAttr(conv.project)}', '${this.escapeAttr(conv.cwd || '')}', '${this.escapeAttr(source)}')">
            Resume
          </button>
          <button class="btn-small secondary" onclick="window.conversationBrowser.copyResumeCommand('${this.escapeAttr(conv.id)}', '${this.escapeAttr(fullPath)}', '${this.escapeAttr(source)}')">
            Copy Cmd
          </button>
          <button class="btn-small secondary" onclick="window.conversationBrowser.exportConversation('${this.escapeAttr(conv.id)}', '${this.escapeAttr(conv.project)}', '${this.escapeAttr(source)}', 'json')">
            Export
          </button>
          <button class="btn-small secondary" onclick="window.conversationBrowser.viewConversation('${this.escapeAttr(conv.id)}', '${this.escapeAttr(source)}', event)">
            View All
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Clean preview text - remove system messages, commands, and XML tags
   */
  cleanPreview(text) {
    if (!text) return '';

    // Remove XML-like tags and their content
    let cleaned = text
      .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/gi, '')
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
      .replace(/<command-name>[\s\S]*?<\/command-name>/gi, '')
      .replace(/<command-message>[\s\S]*?<\/command-message>/gi, '')
      .replace(/<command-args>[\s\S]*?<\/command-args>/gi, '')
      .replace(/<[^>]+>/g, '') // Remove any remaining tags
      .replace(/Caveat:.*?consider them in your response[^.]*\./gi, '')
      .trim();

    // If cleaned is empty or very short, return original (truncated)
    if (cleaned.length < 10) {
      cleaned = text.replace(/<[^>]+>/g, '').trim();
    }

    // Escape HTML and truncate
    return this.escapeHtml(cleaned.slice(0, 200));
  }

  /**
   * Format date in Australian format: DD/MM/YYYY HH:MM
   */
  formatDateAU(date) {
    return date.toLocaleDateString('en-AU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  }

  timeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString('en-AU');
  }

  copyPath(path) {
    navigator.clipboard.writeText(path).then(() => {
      console.log('Path copied:', path);
    });
  }

  copyResumeCommand(id, cwd, source) {
    const cmd = this.getFullResumeCommand(id, source, cwd);
    navigator.clipboard.writeText(cmd).then(() => {
      console.log('Resume command copied:', cmd);
    });
  }

  async viewConversation(id, source, event) {
    event.stopPropagation();

    const previewEl = document.getElementById(`full-preview-${id}`);
    if (!previewEl) return;

    // Toggle visibility
      if (previewEl.style.display === 'none') {
        previewEl.style.display = 'block';
        const contentEl = previewEl.querySelector('.full-preview-content');

      // Load content if not already loaded
        if (contentEl.textContent === 'Loading...') {
          try {
            const params = new URLSearchParams();
            if (source && source !== 'claude') params.append('source', source);
            const qs = params.toString();
            const response = await fetch(`${this.serverUrl}/api/conversations/${id}${qs ? `?${qs}` : ''}`);
            if (!response.ok) throw new Error('Failed to load');

          const conv = await response.json();
          const messages = conv.messages || [];

          // Format messages for display
          let html = messages.slice(0, 20).map(msg => {
            const role = msg.role || 'unknown';
            const roleClass = role === 'user' ? 'user-msg' : role === 'assistant' ? 'assistant-msg' : 'system-msg';
            let content = '';

            if (typeof msg.content === 'string') {
              content = this.escapeHtml(msg.content.slice(0, 500));
            } else if (Array.isArray(msg.content)) {
              content = msg.content.map(c => {
                if (c.type === 'text') return this.escapeHtml(c.text?.slice(0, 500) || '');
                if (c.type === 'tool_use') return `[Tool: ${c.name}]`;
                if (c.type === 'tool_result') return `[Tool Result]`;
                return `[${c.type}]`;
              }).join(' ');
            }

            return `<div class="preview-msg ${roleClass}"><strong>${role}:</strong> ${content}</div>`;
          }).join('');

          if (messages.length > 20) {
            html += `<div class="preview-more">... and ${messages.length - 20} more messages</div>`;
          }

          contentEl.innerHTML = html || '<em>No messages found</em>';
        } catch (error) {
          contentEl.textContent = 'Failed to load conversation: ' + error.message;
        }
      }

      // Update button text
      const btn = event.target;
      btn.textContent = 'Hide';
    } else {
      previewEl.style.display = 'none';
      event.target.textContent = 'View Full';
    }
  }

  formatTokens(tokens) {
    if (tokens === null || tokens === undefined) return '—';
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
      this.totalIndexed = stats.totalConversations;

      const statsEl = document.getElementById('browser-stats');
      statsEl.innerHTML = `
        <span>${stats.totalConversations.toLocaleString('en-AU')} total</span>
        <span>${stats.totalProjects} projects</span>
        <span>${this.formatTokens(stats.totalTokens)} tokens</span>
        <span>${stats.totalMessages?.toLocaleString('en-AU') || 0} messages</span>
      `;

      // Update the info note
      const totalEl = document.getElementById('total-indexed');
      if (totalEl) totalEl.textContent = stats.totalConversations.toLocaleString('en-AU');
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  }

  updateResultCount(count) {
    const el = document.getElementById('result-count');
    if (el) el.textContent = `${count} conversation${count !== 1 ? 's' : ''}`;
  }

  async resumeConversation(id, project, cwd, source = 'claude') {
    const src = String(source || 'claude').toLowerCase();
    console.log('Resuming conversation:', { id, project, cwd, source: src });

    if (!cwd) {
      alert('Cannot resume: no working directory found for this conversation');
      return;
    }

    if (!this.orchestrator || !this.orchestrator.socket) {
      alert(`To resume this conversation, run:\n${this.getFullResumeCommand(id, src, cwd)}`);
      return;
    }

    const agentId = src === 'codex' ? 'codex' : 'claude';
    const flags = [];
    if (this.yoloMode) {
      flags.push(agentId === 'codex' ? 'yolo' : 'skipPermissions');
    }
    const agentConfig = {
      agentId,
      mode: 'resume',
      flags,
      resumeId: id,
      cwd
    };

    const matchesCwd = (session) => {
      const sessionCwd = normalizeBrowserPath(session?.worktreePath || session?.config?.cwd || session?.cwd || '');
      const targetCwd = normalizeBrowserPath(cwd);
      if (!sessionCwd) return false;
      return targetCwd === sessionCwd || targetCwd.startsWith(`${sessionCwd}/`);
    };

    // Find a matching agent terminal (worktree session)
    const sessions = Array.from(this.orchestrator.sessions?.entries?.() || []);
    const matchingClaudeSessionId = sessions.find(([sid, s]) => sid.endsWith('-claude') && matchesCwd(s))?.[0];

    if (matchingClaudeSessionId) {
      // Found existing session - start the selected agent in resume mode
      this.orchestrator.socket.emit('start-agent', {
        sessionId: matchingClaudeSessionId,
        config: agentConfig
      });

      // Close browser
      this.close();
      return;
    }

    // No matching session - need to add this as a new worktree
    const pathInfo = this.parseProjectPath(cwd);
    const cwdSegments = splitBrowserPathSegments(cwd);
    const worktreeId = pathInfo?.worktree || cwdSegments[cwdSegments.length - 1] || 'resumed';
    const repoName = pathInfo?.project || cwdSegments[cwdSegments.length - 2] || 'unknown';

    console.log('Adding new worktree for conversation:', { worktreeId, cwd, repoName });

    // Show loading state
    const resumeBtn = document.querySelector(`[data-id="${id}"] .btn-small`);
    if (resumeBtn) {
      resumeBtn.textContent = 'Adding...';
      resumeBtn.disabled = true;
    }

    // Listen for the session to be added
    const sessionAddedHandler = (data) => {
      console.log('Worktree sessions added:', data);

      if (data.worktreeId === worktreeId) {
        this.orchestrator.socket.off('worktree-sessions-added', sessionAddedHandler);

        // Find the agent session and send resume command
        const claudeSessionId = Object.keys(data.sessions).find(sid => sid.includes('claude'));
        if (claudeSessionId) {
          setTimeout(() => {
            this.orchestrator.socket.emit('start-agent', {
              sessionId: claudeSessionId,
              config: agentConfig
            });
          }, 500); // Small delay to let terminal initialize
        }

        // Close browser
        this.close();
      }
    };

    this.orchestrator.socket.on('worktree-sessions-added', sessionAddedHandler);

    // Request to add the worktree sessions
    this.orchestrator.socket.emit('add-worktree-sessions', {
      worktreeId,
      worktreePath: cwd,
      repositoryName: repoName,
      repositoryType: 'single' // Assume single repo
    });

    // Timeout handler
    setTimeout(() => {
      this.orchestrator.socket.off('worktree-sessions-added', sessionAddedHandler);
      if (resumeBtn) {
        resumeBtn.textContent = 'Resume';
        resumeBtn.disabled = false;
      }
    }, 10000);
  }

  async showDetails(id, project, source) {
    try {
      const params = new URLSearchParams();
      if (project) params.set('project', project);
      if (source) params.set('source', source);
      const qs = params.toString();
      const response = await fetch(`${this.serverUrl}/api/conversations/${id}${qs ? `?${qs}` : ''}`);
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
          <button class="btn-primary" onclick="window.conversationBrowser.resumeConversation('${conv.id}', '${conv.project}', '${conv.cwd || ''}', '${conv.source || 'claude'}')">
            Resume Conversation
          </button>
          <button class="btn-secondary" onclick="window.conversationBrowser.exportConversation('${conv.id}', '${conv.project}', '${conv.source || 'claude'}', 'json')">
            Download JSON
          </button>
          <button class="btn-secondary" onclick="window.conversationBrowser.exportConversation('${conv.id}', '${conv.project}', '${conv.source || 'claude'}', 'md')">
            Download MD
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

  // Escape value for use in onclick attribute with single quotes
  escapeAttr(text) {
    if (!text) return '';
    return text
      .replace(/\\/g, '\\\\')  // Escape backslashes first
      .replace(/'/g, "\\'")     // Escape single quotes
      .replace(/"/g, '&quot;')  // Escape double quotes
      .replace(/\n/g, '\\n');   // Escape newlines
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

  exportConversation(id, project, source = 'claude', format = 'json') {
    const cid = String(id || '').trim();
    if (!cid) return;
    const params = new URLSearchParams();
    const src = String(source || '').trim().toLowerCase();
    if (project) params.set('project', String(project));
    if (src && src !== 'claude') params.set('source', src);
    params.set('format', String(format || 'json'));
    const url = `${this.serverUrl}/api/conversations/${encodeURIComponent(cid)}/export?${params.toString()}`;
    try {
      window.open(url, '_blank');
    } catch {
      try { window.location.href = url; } catch {}
    }
  }
}

// Export for use
if (typeof window !== 'undefined') {
  window.ConversationBrowser = ConversationBrowser;
}
