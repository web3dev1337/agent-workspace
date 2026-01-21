/**
 * Quick Links Component
 * Displays favorites, recent sessions, and custom links
 * Integrates with QuickLinksService backend API
 */

class QuickLinks {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.data = {
      favorites: [],
      recentSessions: [],
      customLinks: [],
      products: []
    };
    this.isLoading = false;
    this.serverUrl = window.location.port === '2080' || window.location.port === '2081'
      ? `http://localhost:${window.location.port === '2080' ? '3000' : '4000'}`
      : window.location.origin;
  }

  /**
   * Initialize the Quick Links component
   */
  async init() {
    await this.fetchData();
  }

  /**
   * Fetch all quick links data from API
   */
  async fetchData() {
    this.isLoading = true;
    try {
      const response = await fetch(`${this.serverUrl}/api/quick-links`);
      if (response.ok) {
        this.data = await response.json();
      }
    } catch (error) {
      console.debug('Failed to fetch quick links:', error);
    }
    this.isLoading = false;
  }

  /**
   * Track session access (call when switching to a worktree)
   */
  async trackSession(sessionInfo) {
    try {
      await fetch(`${this.serverUrl}/api/quick-links/track-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sessionInfo)
      });
    } catch (error) {
      console.debug('Failed to track session:', error);
    }
  }

  /**
   * Add a favorite link
   */
  async addFavorite(name, url, icon = 'link') {
    try {
      const response = await fetch(`${this.serverUrl}/api/quick-links/favorites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url, icon })
      });
      if (response.ok) {
        const data = await response.json();
        this.data.favorites = data.favorites;
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to add favorite:', error);
      return false;
    }
  }

  /**
   * Remove a favorite link
   */
  async removeFavorite(url) {
    try {
      const response = await fetch(`${this.serverUrl}/api/quick-links/favorites`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      if (response.ok) {
        const data = await response.json();
        this.data.favorites = data.favorites;
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to remove favorite:', error);
      return false;
    }
  }

  /**
   * Reorder favorites
   */
  async reorderFavorites(urls) {
    try {
      const response = await fetch(`${this.serverUrl}/api/quick-links/favorites/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls })
      });
      if (response.ok) {
        const data = await response.json();
        this.data.favorites = data.favorites;
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to reorder favorites:', error);
      return false;
    }
  }

  /**
   * Add a product (launchable service)
   */
  async addProduct(product) {
    try {
      const response = await fetch(`${this.serverUrl}/api/quick-links/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(product)
      });
      if (response.ok) {
        const data = await response.json();
        this.data.products = data.products;
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to add product:', error);
      return false;
    }
  }

  /**
   * Remove a product by id
   */
  async removeProduct(id) {
    try {
      const response = await fetch(`${this.serverUrl}/api/quick-links/products`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      if (response.ok) {
        const data = await response.json();
        this.data.products = data.products;
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to remove product:', error);
      return false;
    }
  }

  /**
   * Launch a product (pull latest master and start command)
   */
  async launchProduct(id, urlToOpen = null) {
    try {
      // Open first to avoid popup blockers (user gesture context)
      const openedWindow = urlToOpen ? window.open(urlToOpen, '_blank') : null;

      window.orchestrator?.showToast('Starting product…', 'info');
      const response = await fetch(`${this.serverUrl}/api/products/launch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        window.orchestrator?.showToast(data?.error || 'Failed to start product', 'error');
        return;
      }

      const url = data.url;
      if (data.alreadyRunning) {
        window.orchestrator?.showToast('Product already running', 'success');
      } else {
        window.orchestrator?.showToast('Product started', 'success');
      }

      if (openedWindow && url && url !== urlToOpen) {
        openedWindow.location.href = url;
      } else if (!openedWindow && url) {
        window.open(url, '_blank');
      }
    } catch (error) {
      console.error('Failed to launch product:', error);
      window.orchestrator?.showToast('Failed to start product', 'error');
    }
  }

  /**
   * Get icon HTML for a given icon name
   */
  getIconHTML(iconName) {
    const icons = {
      'github': '🐙',
      'gitlab': '🦊',
      'bitbucket': '🪣',
      'trello': '📋',
      'jira': '🎫',
      'notion': '📝',
      'figma': '🎨',
      'docs': '📚',
      'api': '⚡',
      'dashboard': '📊',
      'slack': '💬',
      'discord': '🎮',
      'teams': '👥',
      'link': '🔗',
      'folder': '📁',
      'code': '💻',
      'terminal': '🖥️',
      'rocket': '🚀'
    };
    return icons[iconName] || '🔗';
  }

  /**
   * Generate the Quick Links dashboard section HTML
   */
  generateDashboardHTML() {
    if (this.isLoading) {
      return '<div class="quick-links-loading">Loading quick links...</div>';
    }

    return `
      <div class="quick-links-container">
        ${this.generateProductsHTML()}
        ${this.generateFavoritesHTML()}
        ${this.generateRecentSessionsHTML()}
        ${this.generateCustomLinksHTML()}
      </div>
    `;
  }

  /**
   * Generate products section
   */
  generateProductsHTML() {
    const { products = [] } = this.data;

    return `
      <div class="quick-links-section">
        <h3>🚀 Products</h3>
        <div class="quick-links-grid" id="products-grid">
          ${products.map(product => `
            <div class="quick-link quick-product" title="${this.escapeHtml(product.masterPath || '')}">
              <span class="quick-link-icon">${this.getIconHTML(product.icon || 'rocket')}</span>
              <span class="quick-link-label">${this.escapeHtml(product.name)}</span>
              <div class="quick-product-actions">
                <button class="port-action-btn" onclick="event.preventDefault(); event.stopPropagation(); window.quickLinks.launchProduct(${JSON.stringify(product.id)}, ${JSON.stringify(product.url || '')})">Start</button>
                <button class="port-action-btn" onclick="event.preventDefault(); event.stopPropagation(); window.open(${JSON.stringify(product.url || '')},'_blank')">Open</button>
                <button class="port-action-btn" onclick="event.preventDefault(); event.stopPropagation(); window.quickLinks.copyText(${JSON.stringify(product.url || '')},'URL')">Copy</button>
              </div>
              <button class="quick-link-remove"
                      onclick="event.preventDefault(); event.stopPropagation(); window.quickLinks.removeProductAndRefresh(${JSON.stringify(product.id)})"
                      title="Remove product">×</button>
            </div>
          `).join('')}
          <button class="quick-link add-favorite-btn" onclick="window.quickLinks.showAddProductModal()">
            <span class="quick-link-icon">➕</span>
            <span class="quick-link-label">Add Product</span>
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Generate favorites section
   */
  generateFavoritesHTML() {
    const { favorites } = this.data;

    return `
      <div class="quick-links-section">
        <h3>⭐ Favorites</h3>
        <div class="quick-links-grid" id="favorites-grid">
          ${favorites.map((fav, index) => `
            <a href="${this.escapeHtml(fav.url)}" target="_blank" class="quick-link"
               data-url="${this.escapeHtml(fav.url)}"
               data-index="${index}"
               draggable="true"
               title="${this.escapeHtml(fav.name)}">
              <span class="quick-link-icon">${this.getIconHTML(fav.icon)}</span>
              <span class="quick-link-label">${this.escapeHtml(fav.name)}</span>
              <button class="quick-link-remove"
                      onclick="event.preventDefault(); event.stopPropagation(); window.quickLinks.removeFavoriteAndRefresh('${this.escapeHtml(fav.url)}')"
                      title="Remove from favorites">×</button>
            </a>
          `).join('')}
          <button class="quick-link add-favorite-btn" onclick="window.quickLinks.showAddFavoriteModal()">
            <span class="quick-link-icon">➕</span>
            <span class="quick-link-label">Add Link</span>
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Setup drag and drop for favorites reordering
   */
  setupDragAndDrop() {
    const grid = document.getElementById('favorites-grid');
    if (!grid) return;

    let draggedItem = null;

    grid.addEventListener('dragstart', (e) => {
      if (!e.target.classList.contains('quick-link') || e.target.classList.contains('add-favorite-btn')) return;
      draggedItem = e.target;
      e.target.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    grid.addEventListener('dragend', (e) => {
      if (!e.target.classList.contains('quick-link')) return;
      e.target.classList.remove('dragging');
      document.querySelectorAll('.quick-link.drag-over').forEach(el => el.classList.remove('drag-over'));
      draggedItem = null;
    });

    grid.addEventListener('dragover', (e) => {
      e.preventDefault();
      const target = e.target.closest('.quick-link');
      if (!target || target === draggedItem || target.classList.contains('add-favorite-btn')) return;
      target.classList.add('drag-over');
    });

    grid.addEventListener('dragleave', (e) => {
      const target = e.target.closest('.quick-link');
      if (target) target.classList.remove('drag-over');
    });

    grid.addEventListener('drop', async (e) => {
      e.preventDefault();
      const target = e.target.closest('.quick-link');
      if (!target || target === draggedItem || target.classList.contains('add-favorite-btn') || !draggedItem) return;

      target.classList.remove('drag-over');

      // Get new order
      const items = Array.from(grid.querySelectorAll('.quick-link:not(.add-favorite-btn)'));
      const draggedIndex = parseInt(draggedItem.dataset.index);
      const targetIndex = parseInt(target.dataset.index);

      // Reorder the data
      const newOrder = [...this.data.favorites];
      const [removed] = newOrder.splice(draggedIndex, 1);
      newOrder.splice(targetIndex, 0, removed);

      // Save new order
      const urls = newOrder.map(f => f.url);
      await this.reorderFavorites(urls);

      // Re-render
      if (window.orchestrator?.dashboard?.isVisible) {
        await this.fetchData();
        window.orchestrator.dashboard.render();
      }
    });
  }

  /**
   * Generate recent sessions section
   */
  generateRecentSessionsHTML() {
    const { recentSessions } = this.data;

    if (recentSessions.length === 0) {
      return `
        <div class="quick-links-section">
          <h3>🕐 Recent Sessions</h3>
          <p class="quick-links-empty">No recent sessions. Start working on a worktree to see it here.</p>
        </div>
      `;
    }

    return `
      <div class="quick-links-section">
        <h3>🕐 Recent Sessions</h3>
        <div class="recent-sessions-list">
          ${recentSessions.slice(0, 5).map(session => `
            <div class="recent-session-item" onclick="window.quickLinks.resumeSession('${session.workspaceId}', '${session.worktreeId}')">
              <div class="session-info">
                <span class="session-branch">${this.escapeHtml(session.branch || 'main')}</span>
                <span class="session-worktree">${this.escapeHtml(session.worktreeId || '')}</span>
              </div>
              <div class="session-goal">${this.escapeHtml(session.goal || 'No goal set')}</div>
              <div class="session-time">${this.formatTimeAgo(session.lastAccess)}</div>
            </div>
          `).join('')}
        </div>
        ${recentSessions.length > 5 ? `
          <button class="show-all-sessions-btn" onclick="window.quickLinks.showAllRecentSessions()">
            Show all (${recentSessions.length})
          </button>
        ` : ''}
      </div>
    `;
  }

  /**
   * Generate custom links section
   */
  generateCustomLinksHTML() {
    const { customLinks } = this.data;

    if (customLinks.length === 0) {
      return '';
    }

    // Group by category
    const grouped = {};
    customLinks.forEach(link => {
      const category = link.category || 'General';
      if (!grouped[category]) grouped[category] = [];
      grouped[category].push(link);
    });

    return Object.entries(grouped).map(([category, links]) => `
      <div class="quick-links-section">
        <h3>📁 ${this.escapeHtml(category)}</h3>
        <div class="quick-links-grid">
          ${links.map(link => `
            <a href="${this.escapeHtml(link.url)}" target="_blank" class="quick-link">
              <span class="quick-link-icon">🔗</span>
              <span class="quick-link-label">${this.escapeHtml(link.name)}</span>
            </a>
          `).join('')}
        </div>
      </div>
    `).join('');
  }

  /**
   * Format timestamp as relative time
   */
  formatTimeAgo(timestamp) {
    if (!timestamp) return '';

    const date = new Date(timestamp);
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

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Show add favorite modal
   */
  showAddFavoriteModal() {
    const modal = document.createElement('div');
    modal.className = 'modal quick-links-modal';
    modal.id = 'add-favorite-modal';
    modal.innerHTML = `
      <div class="modal-content">
        <h3>Add Favorite Link</h3>
        <div class="form-group">
          <label for="fav-name">Name:</label>
          <input type="text" id="fav-name" placeholder="GitHub" />
        </div>
        <div class="form-group">
          <label for="fav-url">URL:</label>
          <input type="url" id="fav-url" placeholder="https://github.com" />
        </div>
        <div class="form-group">
          <label for="fav-icon">Icon:</label>
          <select id="fav-icon">
            <option value="github">🐙 GitHub</option>
            <option value="gitlab">🦊 GitLab</option>
            <option value="trello">📋 Trello</option>
            <option value="jira">🎫 Jira</option>
            <option value="notion">📝 Notion</option>
            <option value="figma">🎨 Figma</option>
            <option value="docs">📚 Docs</option>
            <option value="api">⚡ API</option>
            <option value="dashboard">📊 Dashboard</option>
            <option value="slack">💬 Slack</option>
            <option value="discord">🎮 Discord</option>
            <option value="link" selected>🔗 Link</option>
          </select>
        </div>
        <div class="modal-actions">
          <button class="button-primary" onclick="window.quickLinks.submitAddFavorite()">Add</button>
          <button class="button-secondary" onclick="window.quickLinks.closeAddFavoriteModal()">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  /**
   * Show add product modal
   */
  showAddProductModal() {
    const modal = document.createElement('div');
    modal.className = 'modal quick-links-modal';
    modal.id = 'add-product-modal';
    modal.innerHTML = `
      <div class="modal-content modal-large">
        <h3>Add Product</h3>
        <div class="form-group">
          <label for="product-name">Name:</label>
          <input type="text" id="product-name" placeholder="Education Platform" />
        </div>
        <div class="form-group">
          <label for="product-master-path">Master Path:</label>
          <input type="text" id="product-master-path" placeholder="/home/<user>/GitHub/websites/my-app/master" />
        </div>
        <div class="form-group">
          <label for="product-start-command">Start Command:</label>
          <input type="text" id="product-start-command" placeholder="npm start" />
        </div>
        <div class="form-group">
          <label for="product-url">URL:</label>
          <input type="url" id="product-url" placeholder="http://localhost:3333" />
        </div>
        <div class="form-group">
          <label for="product-icon">Icon:</label>
          <select id="product-icon">
            <option value="rocket" selected>🚀 Rocket</option>
            <option value="dashboard">📊 Dashboard</option>
            <option value="code">💻 Code</option>
            <option value="terminal">🖥️ Terminal</option>
            <option value="link">🔗 Link</option>
          </select>
        </div>
        <div class="modal-actions">
          <button class="button-primary" onclick="window.quickLinks.submitAddProduct()">Add</button>
          <button class="button-secondary" onclick="window.quickLinks.closeAddProductModal()">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  /**
   * Submit add favorite form
   */
  async submitAddFavorite() {
    const name = document.getElementById('fav-name').value.trim();
    const url = document.getElementById('fav-url').value.trim();
    const icon = document.getElementById('fav-icon').value;

    if (!name || !url) {
      alert('Please fill in both name and URL');
      return;
    }

    const success = await this.addFavorite(name, url, icon);
    if (success) {
      this.closeAddFavoriteModal();
      // Refresh the dashboard if it's showing
      if (window.orchestrator?.dashboard?.isVisible) {
        await this.fetchData();
        window.orchestrator.dashboard.render();
      }
    } else {
      alert('Failed to add favorite. It may already exist.');
    }
  }

  /**
   * Close add favorite modal
   */
  closeAddFavoriteModal() {
    const modal = document.getElementById('add-favorite-modal');
    if (modal) modal.remove();
  }

  async submitAddProduct() {
    const name = document.getElementById('product-name').value.trim();
    const masterPath = document.getElementById('product-master-path').value.trim();
    const startCommand = document.getElementById('product-start-command').value.trim();
    const url = document.getElementById('product-url').value.trim();
    const icon = document.getElementById('product-icon').value;

    if (!name || !masterPath || !startCommand || !url) {
      alert('Please fill in name, master path, start command, and URL');
      return;
    }

    const success = await this.addProduct({ name, masterPath, startCommand, url, icon });
    if (success) {
      this.closeAddProductModal();
      if (window.orchestrator?.dashboard?.isVisible) {
        await this.fetchData();
        window.orchestrator.dashboard.render();
      }
    } else {
      alert('Failed to add product. It may already exist.');
    }
  }

  closeAddProductModal() {
    const modal = document.getElementById('add-product-modal');
    if (modal) modal.remove();
  }

  /**
   * Remove favorite and refresh UI
   */
  async removeFavoriteAndRefresh(url) {
    const success = await this.removeFavorite(url);
    if (success && window.orchestrator?.dashboard?.isVisible) {
      await this.fetchData();
      window.orchestrator.dashboard.render();
    }
  }

  async removeProductAndRefresh(id) {
    const success = await this.removeProduct(id);
    if (success && window.orchestrator?.dashboard?.isVisible) {
      await this.fetchData();
      window.orchestrator.dashboard.render();
    }
  }

  async copyText(text, label = 'text') {
    try {
      await navigator.clipboard.writeText(text);
      window.orchestrator?.showToast(`Copied ${label}`, 'success');
    } catch (e) {
      window.orchestrator?.showToast('Copy failed', 'error');
    }
  }

  /**
   * Resume a session from recent sessions
   */
  async resumeSession(workspaceId, worktreeId) {
    if (window.orchestrator) {
      // If we need to switch workspace first
      if (window.orchestrator.currentWorkspace?.id !== workspaceId) {
        window.orchestrator.socket.emit('switch-workspace', { workspaceId });
      }

      // Track this session access
      await this.trackSession({
        workspaceId,
        worktreeId,
        sessionId: `${worktreeId}-claude`
      });

      // Focus the terminal if possible
      // This is a simplified version - the orchestrator would handle the actual focusing
      console.log(`Resuming session: ${workspaceId} / ${worktreeId}`);
    }
  }

  /**
   * Show all recent sessions in a modal
   */
  showAllRecentSessions() {
    const modal = document.createElement('div');
    modal.className = 'modal quick-links-modal';
    modal.id = 'all-sessions-modal';
    modal.innerHTML = `
      <div class="modal-content modal-large">
        <h3>All Recent Sessions</h3>
        <div class="all-sessions-list">
          ${this.data.recentSessions.map(session => `
            <div class="recent-session-item" onclick="window.quickLinks.resumeSession('${session.workspaceId}', '${session.worktreeId}'); window.quickLinks.closeAllSessionsModal();">
              <div class="session-info">
                <span class="session-branch">${this.escapeHtml(session.branch || 'main')}</span>
                <span class="session-worktree">${this.escapeHtml(session.worktreeId || '')}</span>
              </div>
              <div class="session-goal">${this.escapeHtml(session.goal || 'No goal set')}</div>
              <div class="session-time">${this.formatTimeAgo(session.lastAccess)}</div>
            </div>
          `).join('')}
        </div>
        <div class="modal-actions">
          <button class="button-secondary" onclick="window.quickLinks.closeAllSessionsModal()">Close</button>
          <button class="button-danger" onclick="window.quickLinks.clearRecentSessions()">Clear History</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  /**
   * Close all sessions modal
   */
  closeAllSessionsModal() {
    const modal = document.getElementById('all-sessions-modal');
    if (modal) modal.remove();
  }

  /**
   * Clear recent sessions history
   */
  async clearRecentSessions() {
    if (!confirm('Clear all recent session history?')) return;

    try {
      await fetch(`${this.serverUrl}/api/quick-links/recent-sessions`, {
        method: 'DELETE'
      });
      this.data.recentSessions = [];
      this.closeAllSessionsModal();
      if (window.orchestrator?.dashboard?.isVisible) {
        window.orchestrator.dashboard.render();
      }
    } catch (error) {
      console.error('Failed to clear recent sessions:', error);
    }
  }
}

// Export for use in app
window.QuickLinks = QuickLinks;
