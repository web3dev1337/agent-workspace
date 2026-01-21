// Notification management
class NotificationManager {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.notifications = [];
    this.unreadCount = 0;
    this.permission = 'default';
    this.soundEnabled = false;
    
    // Create audio elements for notifications
    this.sounds = {
      waiting: this.createSound('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBjGH0fPTgjMGHm7A7+OZURE'),
      completed: this.createSound('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBjGH0fPTgjMGHm7A7+OZURE'),
      error: this.createSound('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBjGH0fPTgjMGHm7A7+OZURE')
    };
    
    this.init();
  }
  
  init() {
    // Check notification permission
    if ('Notification' in window) {
      this.permission = Notification.permission;
    }
    
    // Load settings
    this.soundEnabled = this.orchestrator.settings.sounds;
    
    // Setup notification list click handlers
    this.setupListHandlers();
  }
  
  createSound(dataUri) {
    const audio = new Audio(dataUri);
    audio.volume = 0.5;
    return audio;
  }
  
  async requestPermission() {
    if (!('Notification' in window)) {
      console.warn('Notifications not supported in this browser');
      return false;
    }
    
    if (Notification.permission === 'granted') {
      return true;
    }
    
    if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      this.permission = permission;
      return permission === 'granted';
    }
    
    return false;
  }
  
  handleNotification(data) {
    // Add to internal list
    this.addNotification(data);
    
    // Show browser notification if enabled
    if (this.orchestrator.settings.notifications && this.permission === 'granted') {
      this.showBrowserNotification(data);
    }
    
    // Play sound if enabled
    if (this.orchestrator.settings.sounds) {
      this.playSound(data.type);
    }
  }
  
  addNotification(data) {
    const notification = {
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      read: false,
      ...data
    };
    
    // Add to beginning of array (newest first)
    this.notifications.unshift(notification);
    
    // Limit to 100 notifications
    if (this.notifications.length > 100) {
      this.notifications = this.notifications.slice(0, 100);
    }
    
    // Update unread count
    this.updateUnreadCount();
    
    // Update UI
    this.renderNotifications();
  }
  
  showBrowserNotification(data) {
    const { type, message, sessionId, metadata = {} } = data;
    
    // Determine icon and title based on type
    let title = 'Agent Orchestrator';
    let icon = '🤖';
    let urgency = 'normal';
    
    switch (type) {
      case 'waiting':
        title = 'Action Required';
        icon = '⚠️';
        urgency = 'critical';
        break;
      case 'completed':
        title = 'Task Completed';
        icon = '✅';
        break;
      case 'error':
        title = 'Error Occurred';
        icon = '❌';
        urgency = 'critical';
        break;
      case 'session_exit':
        title = 'Session Exited';
        icon = '🛑';
        break;
      case 'token_usage':
        title = 'Token Usage Alert';
        icon = '📊';
        if (metadata.percentage >= 90) {
          urgency = 'critical';
        }
        break;
    }
    
    // Create notification
    const notification = new Notification(title, {
      body: message,
      icon: `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${icon}</text></svg>`,
      badge: `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🤖</text></svg>`,
      tag: sessionId || 'general',
      requireInteraction: urgency === 'critical',
      silent: false,
      data: { sessionId, type, metadata }
    });
    
    // Handle click
    notification.onclick = () => {
      window.focus();
      
      // Focus the relevant terminal if sessionId provided
      if (sessionId) {
        const terminalElement = document.getElementById(`terminal-${sessionId}`);
        if (terminalElement) {
          terminalElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          
          // Highlight the terminal briefly
          const container = document.getElementById(`container-${sessionId}`);
          if (container) {
            container.classList.add('highlighted');
            setTimeout(() => {
              container.classList.remove('highlighted');
            }, 2000);
          }
        }
      }
      
      notification.close();
    };
    
    // Auto-close non-critical notifications after 10 seconds
    if (urgency !== 'critical') {
      setTimeout(() => {
        notification.close();
      }, 10000);
    }
  }
  
  playSound(type) {
    const sound = this.sounds[type] || this.sounds.waiting;
    
    if (sound && this.orchestrator.settings.sounds) {
      sound.play().catch(err => {
        console.warn('Failed to play notification sound:', err);
      });
    }
  }
  
  renderNotifications() {
    const listElement = document.getElementById('notification-list');
    if (!listElement) return;
    
    if (this.notifications.length === 0) {
      listElement.innerHTML = '<div class="empty-message">No notifications</div>';
      return;
    }
    
    listElement.innerHTML = this.notifications.map(notification => {
      const time = this.formatTime(notification.timestamp);
      const typeClass = notification.type || 'info';
      const readClass = notification.read ? '' : 'unread';
      
      return `
        <div class="notification-item ${readClass}" data-id="${notification.id}">
          <div class="notification-header">
            <span class="notification-time">${time}</span>
            <span class="notification-type ${typeClass}">${this.formatType(notification.type)}</span>
          </div>
          <div class="notification-message">${this.escapeHtml(notification.message)}</div>
          ${notification.metadata?.worktreeId ? 
            `<div class="notification-meta">Worktree: ${notification.metadata.worktreeId}</div>` : ''}
        </div>
      `;
    }).join('');
  }
  
  setupListHandlers() {
    const listElement = document.getElementById('notification-list');
    if (!listElement) return;
    
    listElement.addEventListener('click', (e) => {
      const item = e.target.closest('.notification-item');
      if (!item) return;
      
      const id = item.dataset.id;
      const notification = this.notifications.find(n => n.id === id);
      
      if (notification) {
        // Mark as read
        if (!notification.read) {
          notification.read = true;
          this.updateUnreadCount();
          this.renderNotifications();
        }
        
        // Focus relevant terminal if available
        if (notification.sessionId) {
          const terminalElement = document.getElementById(`terminal-${notification.sessionId}`);
          if (terminalElement) {
            terminalElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      }
    });
  }
  
  updateUnreadCount() {
    this.unreadCount = this.notifications.filter(n => !n.read).length;
    
    const badge = document.getElementById('notification-badge');
    if (badge) {
      badge.textContent = this.unreadCount > 0 ? this.unreadCount : '';
      badge.style.display = this.unreadCount > 0 ? 'block' : 'none';
    }
    
    // Update page title with count
    if (this.unreadCount > 0) {
      document.title = `(${this.unreadCount}) Agent Orchestrator`;
    } else {
      document.title = 'Agent Orchestrator';
    }
  }
  
  clearAll() {
    if (confirm('Clear all notifications?')) {
      this.notifications = [];
      this.updateUnreadCount();
      this.renderNotifications();
    }
  }
  
  markAllAsRead() {
    this.notifications.forEach(n => n.read = true);
    this.updateUnreadCount();
    this.renderNotifications();
  }
  
  formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    // Less than a minute
    if (diff < 60000) {
      return 'Just now';
    }
    
    // Less than an hour
    if (diff < 3600000) {
      const minutes = Math.floor(diff / 60000);
      return `${minutes}m ago`;
    }
    
    // Less than a day
    if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      return `${hours}h ago`;
    }
    
    // More than a day
    return date.toLocaleDateString();
  }
  
  formatType(type) {
    const typeMap = {
      'waiting': 'Waiting',
      'completed': 'Complete',
      'error': 'Error',
      'session_exit': 'Exit',
      'token_usage': 'Tokens',
      'info': 'Info'
    };
    
    return typeMap[type] || type || 'Info';
  }
  
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Add notification styles
const notificationStyles = document.createElement('style');
notificationStyles.textContent = `
  .empty-message {
    padding: var(--space-xl);
    text-align: center;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }
  
  .notification-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--space-xs);
  }
  
  .notification-meta {
    font-size: 0.75rem;
    color: var(--text-secondary);
    margin-top: var(--space-xs);
  }
  
  .highlighted {
    animation: highlight 2s ease-out;
  }
  
  @keyframes highlight {
    0% {
      box-shadow: 0 0 0 0 var(--accent-primary);
    }
    50% {
      box-shadow: 0 0 0 4px var(--accent-primary);
    }
    100% {
      box-shadow: 0 0 0 0 var(--accent-primary);
    }
  }
`;

document.head.appendChild(notificationStyles);
