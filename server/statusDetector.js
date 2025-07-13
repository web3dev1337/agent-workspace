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

class StatusDetector {
  constructor() {
    // Patterns that indicate Claude is waiting for user input
    this.waitingPatterns = [
      /\? for shortcuts/i,  // Claude ready prompt
      /Do you want to proceed\?/i,  // Bash command confirmation
      /\? 1\. Yes/i,  // Bash command options
      /\(y\/N\)/i,
      /\(Y\/n\)/i,
      /\[y\/n\]/i,
      /\[Y\/N\]/i,
      /Proceed\?/i,
      /Continue\?/i,
      /Allow\?/i,
      /confirm/i,
      /Type 'yes' or 'no'/i,
      /Are you sure/i,
      /Do you want to/i,
      /Would you like to/i,
      /May I/i,
      /Should I/i,
      /Can I/i,
      /\? \$/,  // Question mark followed by prompt
      /\? >/,   // Question mark followed by prompt
    ];
    
    // Patterns indicating Claude is actively processing
    this.busyPatterns = [
      /Processing/i,
      /Working on/i,
      /Analyzing/i,
      /Generating/i,
      /Creating/i,
      /Implementing/i,
      /Building/i,
      /Searching/i,
      /Loading/i,
      /Fetching/i,
      /Calculating/i,
      /Thinking/i,
      /Let me/i,
      /I'll/i,
      /I will/i,
      /Starting/i,
      /Running/i,
      /Executing/i
    ];
    
    // Patterns indicating Claude has finished or is idle
    this.idlePatterns = [
      /Done\./i,
      /Completed\./i,
      /Finished\./i,
      /Here's/i,
      /Here is/i,
      /I've/i,
      /I have/i,
      /Successfully/i,
      /The .* has been/i,
      /Created/i,
      /Updated/i,
      /Modified/i,
      /Added/i,
      /Removed/i,
      /Deleted/i
    ];
    
    // Track recent detections to avoid flip-flopping
    this.recentDetections = new Map();
    this.detectionWindow = 2000; // 2 seconds
  }
  
  detectStatus(buffer) {
    // Get last 1000 chars for analysis (more context than before)
    const recentOutput = buffer.slice(-1000);
    
    // Split into lines for better analysis
    const lines = recentOutput.split('\n');
    const lastFewLines = lines.slice(-5).join('\n');
    const lastLine = lines[lines.length - 1].trim();
    
    // First, check if waiting for input (highest priority)
    for (const pattern of this.waitingPatterns) {
      if (pattern.test(lastFewLines)) {
        logger.debug('Waiting pattern detected', { 
          pattern: pattern.toString(),
          match: lastFewLines.match(pattern)?.[0]
        });
        return this.updateStatus('waiting', buffer);
      }
    }
    
    // Check if there's been no output for a while (might be waiting)
    const timeSinceLastOutput = this.getTimeSinceLastOutput(buffer);
    if (timeSinceLastOutput > 5000 && lastLine.match(/[?:>$]$/)) {
      // Ends with prompt-like character and no recent output
      return this.updateStatus('waiting', buffer);
    }
    
    // Check for busy patterns in recent output
    for (const pattern of this.busyPatterns) {
      if (pattern.test(recentOutput)) {
        // But not if we also see idle patterns in the very last lines
        const hasIdlePattern = this.idlePatterns.some(p => p.test(lastFewLines));
        if (!hasIdlePattern) {
          logger.debug('Busy pattern detected', { 
            pattern: pattern.toString() 
          });
          return this.updateStatus('busy', buffer);
        }
      }
    }
    
    // Check for completion/idle patterns
    for (const pattern of this.idlePatterns) {
      if (pattern.test(lastFewLines)) {
        logger.debug('Idle pattern detected', { 
          pattern: pattern.toString() 
        });
        return this.updateStatus('idle', buffer);
      }
    }
    
    // Check if last line looks like a prompt
    if (this.looksLikePrompt(lastLine)) {
      return this.updateStatus('idle', buffer);
    }
    
    // Default based on recent activity
    if (recentOutput.length > 50) {
      // Recent output suggests activity
      return this.updateStatus('busy', buffer);
    } else {
      // Little recent output, probably idle
      return this.updateStatus('idle', buffer);
    }
  }
  
  looksLikePrompt(line) {
    // Common prompt patterns
    const promptPatterns = [
      /^>$/,
      /^\$$/,
      /^>>>$/,
      /^claude>$/i,
      /^assistant>$/i,
      /^\w+>$/,  // Any word followed by >
      /^\w+\$$/,  // Any word followed by $
    ];
    
    return promptPatterns.some(pattern => pattern.test(line));
  }
  
  getTimeSinceLastOutput(buffer) {
    // This is a simplified check - in reality, we'd track actual timestamps
    // For now, we'll estimate based on buffer content
    const recentContent = buffer.slice(-100);
    if (recentContent.trim().length === 0) {
      return 10000; // Assume long time if empty
    }
    return 0;
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
  
  // Advanced detection for specific Claude responses
  detectClaudeSpecificPatterns(buffer) {
    // Claude-specific patterns we've learned from usage
    const claudePatterns = {
      thinking: /I need to|Let me think|I should/i,
      requesting_permission: /May I|Can I|Should I|Would you like me to/i,
      completed_task: /I've completed|I've finished|I've created|I've updated/i,
      error_occurred: /I encountered an error|failed to|couldn't/i,
      waiting_for_confirmation: /Please confirm|Is this correct|Does this look right/i
    };
    
    const recentOutput = buffer.slice(-500);
    
    for (const [type, pattern] of Object.entries(claudePatterns)) {
      if (pattern.test(recentOutput)) {
        logger.debug('Claude-specific pattern detected', { type });
        
        switch(type) {
          case 'thinking':
          case 'error_occurred':
            return 'busy';
          case 'requesting_permission':
          case 'waiting_for_confirmation':
            return 'waiting';
          case 'completed_task':
            return 'idle';
        }
      }
    }
    
    return null; // No specific pattern detected
  }
}

module.exports = { StatusDetector };