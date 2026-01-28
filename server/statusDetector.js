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
// Keep "busy" for longer silence windows (Claude can think silently for minutes).
// This primarily reduces green/orange/grey flicker during long tool runs.
const ASSUME_BUSY_SINCE_OUTPUT_MS = 180000; // 3 minutes
// When we have strong evidence a Claude session is active, use a longer quiet window.
const ASSUME_BUSY_SINCE_OUTPUT_CLAUDE_MS = 600000; // 10 minutes

class StatusDetector {
  constructor() {
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

    // Per-session state (StatusDetector is shared across sessions).
    this.sessionState = new Map(); // sessionId -> { lastBufferLength, lastOutputTime, claudeLikely }
  }
  
  getState(sessionId) {
    if (!this.sessionState.has(sessionId)) {
      this.sessionState.set(sessionId, {
        lastBufferLength: 0,
        lastOutputTime: Date.now(),
        claudeLikely: false
      });
    }
    return this.sessionState.get(sessionId);
  }

  getLastNonEmptyLine(lines) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const raw = String(lines[i] || '').replace(/\r/g, '');
      if (raw.trim() !== '') return raw;
    }
    return '';
  }

  getLastNonEmptyLines(lines, count) {
    const out = [];
    for (let i = lines.length - 1; i >= 0 && out.length < count; i--) {
      const raw = String(lines[i] || '').replace(/\r/g, '');
      if (raw.trim() !== '') out.push(raw);
    }
    return out;
  }

  detectStatus(sessionId, buffer) {
    const state = this.getState(sessionId);
    // Track output timing for activity detection
    const now = Date.now();
    if (buffer.length > state.lastBufferLength) {
      state.lastOutputTime = now;
      state.lastBufferLength = buffer.length;
    } else if (buffer.length < state.lastBufferLength) {
      // Buffer was truncated; keep output time, but update length to avoid negative diffs.
      state.lastBufferLength = buffer.length;
    }
    const timeSinceOutput = now - state.lastOutputTime;

    // Get recent output for analysis
    const recentOutput = buffer.slice(-2000);
    const lines = recentOutput.split('\n');
    const lastFewLines = lines.slice(-10).join('\n');
    const lastNonEmptyLine = this.getLastNonEmptyLine(lines);
    const trimmedLastNonEmptyLine = lastNonEmptyLine.trim();
    const lastNonEmptyLines = this.getLastNonEmptyLines(lines, 6);

    // Heuristic: determine whether Claude Code UI is likely active in this session.
    // This is used to avoid misclassifying shell-like prompts that can appear inside output while Claude is working.
    const recentAll = lastNonEmptyLines.join('\n');
    if (/Welcome to Claude Code!/.test(recentAll) || /\? for shortcuts/.test(recentAll)) {
      state.claudeLikely = true;
    }
    // When the orchestrator restarts a Claude worktree as an interactive bash, it prints this banner.
    if (/Claude session ended\./.test(recentAll) || /Type 'claude' to start a new Claude session\./.test(recentAll)) {
      state.claudeLikely = false;
    }

    // 1. HIGHEST PRIORITY: RELIABLE waiting prompt (must be the last non-empty line)
    // Avoid matching older prompt lines still visible in the last few lines.
    if (trimmedLastNonEmptyLine === '? for shortcuts') {
      return 'waiting';
    }
    // Treat ">" as the Claude input prompt only when we have evidence this is actually a prompt,
    // not just a markdown/code line ending with ">".
    // This prevents bash PS2 (multiline) prompts and occasional output lines from being treated as Claude "waiting".
    if (trimmedLastNonEmptyLine === '>' && state.claudeLikely) {
      const hasStartupMarkers = /Welcome to Claude Code!/.test(recentAll) || /\? for shortcuts/.test(recentAll);
      const hasRecentCompletion = lastNonEmptyLines
        .slice(1)
        .some(line => this.completionPatterns.some(pattern => pattern.test(String(line || '').trim())));

      if (hasStartupMarkers || hasRecentCompletion) {
        return 'waiting';
      }
    }

    // 2. Claude startup/welcome screen
    if (buffer.includes('Welcome to Claude Code!') && trimmedLastNonEmptyLine === '? for shortcuts') {
      logger.debug('Claude startup screen detected');
      return 'waiting';
    }

    // 3. RELIABLE completion indicators at the end (Cost line => Claude done)
    // Avoid matching older "Cost" lines still visible in the scrollback while Claude continues output.
    for (const pattern of this.completionPatterns) {
      if (pattern.test(trimmedLastNonEmptyLine)) {
        state.claudeLikely = true;
        logger.debug('Completion pattern matched - Claude done', { pattern: pattern.toString() });
        return 'waiting';
      }
    }

    // 4. Active tool usage (definitely busy)
    for (const pattern of this.toolPatterns) {
      if (pattern.test(lastFewLines)) {
        state.claudeLikely = true;
        // Completion is only considered reliable when it is the last non-empty line (handled above).
        // Do not suppress tool activity because an older "Cost:" line is still visible in scrollback.
        logger.debug('Tool activity detected - busy', { pattern: pattern.toString() });
        return 'busy';
      }
    }

    // 5. Check typing/thinking patterns
    for (const pattern of this.typingPatterns) {
      if (pattern.test(lastFewLines)) {
        state.claudeLikely = true;
        logger.debug('Typing pattern detected - busy');
        return 'busy';
      }
    }

    // 6. Check if last line looks like a shell/input prompt (not Claude waiting prompt)
    // Only classify as idle when Claude is NOT likely active.
    if (!state.claudeLikely && this.looksLikePrompt(trimmedLastNonEmptyLine)) {
      return 'idle';
    }

    // 7. Default: assume busy for a while after the last output (Claude can think silently)
    const assumeBusyWindowMs = state.claudeLikely ? ASSUME_BUSY_SINCE_OUTPUT_CLAUDE_MS : ASSUME_BUSY_SINCE_OUTPUT_MS;
    if (timeSinceOutput < assumeBusyWindowMs && buffer.length > 100) {
      return 'busy';
    }

    return 'idle';
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

  // Reset state (useful when session changes)
  reset(sessionId) {
    if (sessionId) {
      this.sessionState.delete(sessionId);
      return;
    }
    this.sessionState.clear();
  }
}

module.exports = { StatusDetector };
