const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/status.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

// Configuration constants
const STATUS_DETECTION_WINDOW_MS = 2000; // 2 seconds for detection debouncing

class StatusDetector {
  constructor() {
    // RELIABLE waiting indicators - these must be exact matches or end-of-line
    // Claude shows these when truly waiting for user input
    this.waitingPatterns = [
      /\? for shortcuts$/m,           // Claude ready prompt (must be at line end)
      /^> $/m,                         // Input prompt (Claude waiting for input)
    ];

    // RELIABLE completion indicators - Claude shows these when done
    // The Cost line is the most reliable indicator Claude is done
    this.completionPatterns = [
      /Cost: \$[\d.]+/,               // Cost line - MOST RELIABLE done indicator
      /Total cost: \$[\d.]+/,
      /Session cost: \$[\d.]+/,
      /tokens used/i,                  // Token usage line
    ];

    // Patterns indicating active tool usage (Claude is busy)
    this.toolPatterns = [
      /^● /m,                          // Tool output bullet (Claude executing tool)
      /^⎿/m,                           // Tool result continuation
      /Read\(.*\)/,                    // Read tool
      /Write\(.*\)/,                   // Write tool
      /Edit\(.*\)/,                    // Edit tool
      /Bash\(.*\)/,                    // Bash tool
      /Update\(.*\)/,                  // Update tool
      /Grep\(.*\)/,                    // Grep tool
      /Glob\(.*\)/,                    // Glob tool
      /Task\(.*\)/,                    // Task tool
    ];

    // Patterns that suggest Claude is typing (busy) - more conservative
    this.typingPatterns = [
      /∴ Thinking…/,                   // Thinking indicator
      /\.\.\.$/m,                      // Ends with ellipsis (still going)
    ];

    // Track recent detections to avoid flip-flopping
    this.recentDetections = new Map();
    this.detectionWindow = STATUS_DETECTION_WINDOW_MS;
    this.lastBufferLength = 0;
    this.lastOutputTime = Date.now();
  }
  
  detectStatus(buffer) {
    // Track output timing for activity detection
    const now = Date.now();
    if (buffer.length > this.lastBufferLength) {
      this.lastOutputTime = now;
      this.lastBufferLength = buffer.length;
    }
    const timeSinceOutput = now - this.lastOutputTime;

    // Get recent output for analysis
    const recentOutput = buffer.slice(-2000);
    const lines = recentOutput.split('\n');
    const lastFewLines = lines.slice(-10).join('\n');
    const lastLine = lines[lines.length - 1] || '';
    const trimmedLastLine = lastLine.trim();

    // 1. HIGHEST PRIORITY: Check for RELIABLE waiting indicators
    // These patterns mean Claude is definitely waiting for input
    for (const pattern of this.waitingPatterns) {
      if (pattern.test(lastFewLines)) {
        logger.debug('Waiting pattern matched', { pattern: pattern.toString() });
        return this.updateStatus('waiting', buffer);
      }
    }

    // 2. Check for Claude startup/welcome screen
    if (buffer.includes('Welcome to Claude Code!') && buffer.includes('? for shortcuts')) {
      logger.debug('Claude startup screen detected');
      return this.updateStatus('waiting', buffer);
    }

    // 3. Check for RELIABLE completion indicators (Cost line = Claude is done)
    for (const pattern of this.completionPatterns) {
      if (pattern.test(lastFewLines)) {
        logger.debug('Completion pattern matched - Claude done', { pattern: pattern.toString() });
        return this.updateStatus('waiting', buffer);
      }
    }

    // 4. Check if Claude is actively using tools (definitely busy)
    for (const pattern of this.toolPatterns) {
      if (pattern.test(lastFewLines)) {
        // But only if we haven't also seen completion
        const hasCompletion = this.completionPatterns.some(p => p.test(lastFewLines));
        if (!hasCompletion) {
          logger.debug('Tool activity detected - busy', { pattern: pattern.toString() });
          return this.updateStatus('busy', buffer);
        }
      }
    }

    // 5. Check typing/thinking patterns
    for (const pattern of this.typingPatterns) {
      if (pattern.test(lastFewLines)) {
        logger.debug('Typing pattern detected - busy');
        return this.updateStatus('busy', buffer);
      }
    }

    // 6. Activity-based detection
    // If there's been recent output (within 1 second), Claude is probably still working
    if (timeSinceOutput < 1000 && buffer.length > 100) {
      return this.updateStatus('busy', buffer);
    }

    // 7. If no output for a while (>3 seconds) and no clear busy indicator, assume idle/waiting
    if (timeSinceOutput > 3000) {
      // Check if buffer ends with something that looks like Claude finished
      const hasQuestion = trimmedLastLine.endsWith('?');
      const hasPeriod = trimmedLastLine.endsWith('.');
      const isEmpty = trimmedLastLine === '';

      if (hasQuestion || isEmpty) {
        logger.debug('Quiet period with question/empty - waiting');
        return this.updateStatus('waiting', buffer);
      }
      if (hasPeriod) {
        logger.debug('Quiet period with complete sentence - idle');
        return this.updateStatus('idle', buffer);
      }
    }

    // 8. Check if last line looks like a shell/input prompt
    if (this.looksLikePrompt(trimmedLastLine)) {
      return this.updateStatus('idle', buffer);
    }

    // 9. Default: if there's content and recent activity, busy; otherwise idle
    if (timeSinceOutput < 5000) {
      return this.updateStatus('busy', buffer);
    }

    return this.updateStatus('idle', buffer);
  }
  
  looksLikePrompt(line) {
    // Common shell/input prompt patterns
    const promptPatterns = [
      /^>$/,
      /^\$$/,
      /^>>>$/,
      /^claude>$/i,
      /^assistant>$/i,
      /^\w+[@:~].*[\$#>]$/,  // user@host:~$ or similar
      /^\(.*\)\s*\$$/,        // (venv) $ style prompts
    ];

    return promptPatterns.some(pattern => pattern.test(line));
  }
  
  updateStatus(status, buffer) {
    // Implement debouncing to avoid rapid status changes
    const now = Date.now();
    const bufferHash = this.hashBuffer(buffer);
    
    const recent = this.recentDetections.get(bufferHash);
    if (recent && (now - recent.timestamp) < this.detectionWindow) {
      // Within detection window, check if status is stable
      if (recent.status !== status) {
        // Status is changing rapidly, keep previous
        return recent.status;
      }
    }
    
    // Update recent detection
    this.recentDetections.set(bufferHash, {
      status,
      timestamp: now
    });
    
    // Clean old detections
    this.cleanOldDetections();
    
    return status;
  }
  
  hashBuffer(buffer) {
    // Simple hash of last 200 chars for detection tracking
    const content = buffer.slice(-200);
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash;
  }
  
  cleanOldDetections() {
    const now = Date.now();
    const cutoff = now - (this.detectionWindow * 5);
    
    for (const [hash, detection] of this.recentDetections) {
      if (detection.timestamp < cutoff) {
        this.recentDetections.delete(hash);
      }
    }
  }
  
  // Reset state (useful when session changes)
  reset() {
    this.lastBufferLength = 0;
    this.lastOutputTime = Date.now();
    this.recentDetections.clear();
  }
}

module.exports = { StatusDetector };
