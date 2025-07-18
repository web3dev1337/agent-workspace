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
    this.lastBufferLength = 0; // For debug logging
  }
  
  detectStatus(buffer) {
    // Get last 1000 chars for analysis (more context than before)
    const recentOutput = buffer.slice(-1000);
    
    // Split into lines for better analysis
    const lines = recentOutput.split('\n');
    const lastFewLines = lines.slice(-5).join('\n');
    const lastLine = lines[lines.length - 1].trim();
    
    // Check if this looks like Claude startup/welcome screen
    const isClaudeStartup = buffer.includes('Welcome to Claude Code!') && 
                           buffer.includes('for shortcuts') &&
                           buffer.includes('See you in a minute');
    
    // If it's startup and shows the ready prompt, it should be waiting (ready)
    if (isClaudeStartup && buffer.includes('◯ See you in a minute')) {
      logger.debug('Claude startup detected - ready for input');
      return this.updateStatus('waiting', buffer);
    }
    
    // Debug logging to see what Claude actually outputs
    if (buffer.length > this.lastBufferLength + 100) { // Significant new output
      logger.debug('Claude output detected', {
        lastLine: lastLine,
        lastFewLines: lastFewLines.slice(-200),
        bufferGrowth: buffer.length - this.lastBufferLength,
        isStartup: isClaudeStartup
      });
      this.lastBufferLength = buffer.length;
    }
    
    // Check for specific Claude ready states
    const isClaudeReady = lastLine === ''; // Claude seems to end with empty line when ready
    const isBashConfirmation = /Do you want to proceed\?/.test(lastFewLines) || /\? 1\. Yes/.test(lastFewLines);
    const hasQuestionMark = lastLine.endsWith('?'); // Claude asking a question
    
    if (isBashConfirmation || hasQuestionMark) {
      logger.debug('Claude waiting for input', { 
        isClaudeReady, 
        isBashConfirmation,
        hasQuestionMark,
        lastLine: lastLine.slice(-50) // Last 50 chars for debugging
      });
      return this.updateStatus('waiting', buffer);
    }
    
    // Check other waiting patterns (less sensitive)
    for (const pattern of this.waitingPatterns.slice(3)) { // Skip the first 3 patterns we already checked
      if (pattern.test(lastLine)) { // Only check last line, not last few lines
        logger.debug('Other waiting pattern detected', { 
          pattern: pattern.toString(),
          match: lastLine.match(pattern)?.[0]
        });
        return this.updateStatus('waiting', buffer);
      }
    }
    
    // Check if Claude finished speaking (no activity for 2+ seconds)
    const timeSinceLastOutput = this.getTimeSinceLastOutput(buffer);
    if (timeSinceLastOutput > 2000) {
      // Check if the last content looks like Claude finished a response
      const lastContentLine = lines.reverse().find(line => line.trim().length > 0) || '';
      
      // Claude often ends with a bullet point message or question
      if (lastContentLine.match(/^●.*\?$/) || // Bullet ending with question
          lastContentLine.match(/What.*\?$/) || // Question starting with What
          lastContentLine.match(/\?$/) || // Any question
          lastContentLine.match(/^●.*\.$/) || // Bullet ending with period
          timeSinceLastOutput > 5000) { // Or just been quiet for 5+ seconds
        
        logger.debug('Claude appears ready (quiet period)', {
          timeSinceLastOutput,
          lastContentLine: lastContentLine.slice(-100)
        });
        return this.updateStatus('waiting', buffer);
      }
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