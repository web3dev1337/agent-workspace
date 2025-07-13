const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/notifications.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

class NotificationService {
  constructor(io) {
    this.io = io;
    this.notificationHistory = [];
    this.maxHistorySize = 100;
    this.rateLimits = new Map(); // Per-session rate limiting
    this.rateLimitWindow = 60000; // 1 minute
    this.maxNotificationsPerWindow = 5;
  }
  
  notify(sessionId, type, message, metadata = {}) {
    // Check rate limit
    if (!this.checkRateLimit(sessionId)) {
      logger.warn('Notification rate limit exceeded', { sessionId });
      return false;
    }
    
    const notification = {
      id: Date.now().toString(),
      sessionId,
      type,
      message,
      metadata,
      timestamp: new Date().toISOString(),
      read: false
    };
    
    // Add to history
    this.notificationHistory.push(notification);
    if (this.notificationHistory.length > this.maxHistorySize) {
      this.notificationHistory.shift();
    }
    
    // Emit to all connected clients
    this.io.emit('notification', notification);
    
    logger.info('Notification sent', { 
      sessionId, 
      type, 
      message: message.substring(0, 50) 
    });
    
    return true;
  }
  
  notifyWaiting(sessionId, worktreeId, branch) {
    const message = `Claude in ${worktreeId} needs your input`;
    const metadata = {
      worktreeId,
      branch,
      priority: 'high',
      actionRequired: true,
      suggestedActions: ['yes', 'no', 'view']
    };
    
    return this.notify(sessionId, 'waiting', message, metadata);
  }
  
  notifyCompleted(sessionId, worktreeId, task) {
    const message = `Claude in ${worktreeId} completed: ${task}`;
    const metadata = {
      worktreeId,
      task,
      priority: 'normal',
      actionRequired: false
    };
    
    return this.notify(sessionId, 'completed', message, metadata);
  }
  
  notifyError(sessionId, worktreeId, error) {
    const message = `Error in ${worktreeId}: ${error}`;
    const metadata = {
      worktreeId,
      error,
      priority: 'high',
      actionRequired: true
    };
    
    return this.notify(sessionId, 'error', message, metadata);
  }
  
  notifySessionExit(sessionId, worktreeId, exitCode) {
    const message = `Session ${worktreeId} exited with code ${exitCode}`;
    const metadata = {
      worktreeId,
      exitCode,
      priority: exitCode === 0 ? 'normal' : 'high',
      actionRequired: exitCode !== 0
    };
    
    return this.notify(sessionId, 'session_exit', message, metadata);
  }
  
  notifyTokenUsage(sessionId, worktreeId, percentage) {
    // Only notify at certain thresholds
    const thresholds = [50, 75, 90, 95];
    const threshold = thresholds.find(t => percentage >= t && percentage < t + 5);
    
    if (!threshold) return false;
    
    // Check if we already notified for this threshold
    const lastNotification = this.getLastNotificationForSession(sessionId, 'token_usage');
    if (lastNotification && lastNotification.metadata.percentage >= threshold) {
      return false; // Already notified for this threshold
    }
    
    const message = `Claude in ${worktreeId} has used ${Math.round(percentage)}% of context`;
    const metadata = {
      worktreeId,
      percentage,
      threshold,
      priority: percentage >= 90 ? 'high' : 'normal',
      actionRequired: percentage >= 90
    };
    
    return this.notify(sessionId, 'token_usage', message, metadata);
  }
  
  checkRateLimit(sessionId) {
    const now = Date.now();
    const windowStart = now - this.rateLimitWindow;
    
    // Get or create rate limit entry
    let rateLimit = this.rateLimits.get(sessionId);
    if (!rateLimit) {
      rateLimit = { timestamps: [] };
      this.rateLimits.set(sessionId, rateLimit);
    }
    
    // Remove old timestamps
    rateLimit.timestamps = rateLimit.timestamps.filter(ts => ts > windowStart);
    
    // Check if under limit
    if (rateLimit.timestamps.length >= this.maxNotificationsPerWindow) {
      return false;
    }
    
    // Add current timestamp
    rateLimit.timestamps.push(now);
    return true;
  }
  
  getNotificationHistory(limit = 50) {
    return this.notificationHistory
      .slice(-limit)
      .reverse(); // Most recent first
  }
  
  getUnreadNotifications() {
    return this.notificationHistory.filter(n => !n.read);
  }
  
  markAsRead(notificationId) {
    const notification = this.notificationHistory.find(n => n.id === notificationId);
    if (notification) {
      notification.read = true;
      logger.info('Notification marked as read', { id: notificationId });
      return true;
    }
    return false;
  }
  
  markAllAsRead() {
    let count = 0;
    this.notificationHistory.forEach(n => {
      if (!n.read) {
        n.read = true;
        count++;
      }
    });
    
    logger.info('Marked all notifications as read', { count });
    return count;
  }
  
  clearHistory() {
    const count = this.notificationHistory.length;
    this.notificationHistory = [];
    logger.info('Cleared notification history', { count });
    return count;
  }
  
  getLastNotificationForSession(sessionId, type = null) {
    const filtered = this.notificationHistory.filter(n => {
      if (n.sessionId !== sessionId) return false;
      if (type && n.type !== type) return false;
      return true;
    });
    
    return filtered[filtered.length - 1] || null;
  }
  
  getStatistics() {
    const stats = {
      total: this.notificationHistory.length,
      unread: this.notificationHistory.filter(n => !n.read).length,
      byType: {},
      bySession: {},
      recentRate: 0
    };
    
    // Count by type
    this.notificationHistory.forEach(n => {
      stats.byType[n.type] = (stats.byType[n.type] || 0) + 1;
      stats.bySession[n.sessionId] = (stats.bySession[n.sessionId] || 0) + 1;
    });
    
    // Calculate recent rate (last 5 minutes)
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    const recentNotifications = this.notificationHistory.filter(n => 
      new Date(n.timestamp).getTime() > fiveMinutesAgo
    );
    stats.recentRate = recentNotifications.length;
    
    return stats;
  }
}

module.exports = { NotificationService };