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
// Keep "busy" briefly after output to avoid status flicker.
// SessionManager now re-evaluates status on an interval, so these windows
// can stay short enough to avoid "busy forever" false positives.
const ASSUME_BUSY_SINCE_OUTPUT_MS = 30000; // 30s
const ASSUME_BUSY_SINCE_OUTPUT_AGENT_MS = 90000; // 90s
const ASSUME_BUSY_SINCE_OUTPUT_CLAUDE_MS = 120000; // 2m

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
    this.sessionState = new Map(); // sessionId -> { lastBufferLength, lastOutputTime, claudeLikely, agent }
  }
  
  getState(sessionId) {
    if (!this.sessionState.has(sessionId)) {
      this.sessionState.set(sessionId, {
        lastBufferLength: 0,
        lastOutputTime: Date.now(),
        claudeLikely: false,
        agent: null
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

  detectStatus(sessionId, buffer, options = {}) {
    const state = this.getState(sessionId);
    const agent = String(options?.agent || '').trim() || null;
    const isNonClaudeAgent = !!(agent && agent !== 'claude');
    if (agent) {
      state.agent = agent;
    }
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

    // If a different agent (e.g. Codex) is running in this terminal, avoid reusing Claude UI heuristics.
    if (isNonClaudeAgent) {
      state.claudeLikely = false;
    }

    // Best-effort Codex interactive prompt detection.
    // This prevents the ">" prompt from being misclassified as idle (grey) and reduces dot flicker.
    if (agent === 'codex') {
      if (trimmedLastNonEmptyLine === '>' || /^codex>\s*$/.test(trimmedLastNonEmptyLine)) {
        return 'waiting';
      }
    }

    // Heuristic: determine whether Claude Code UI is likely active in this session.
    // This is used to avoid misclassifying shell-like prompts that can appear inside output while Claude is working.
    const recentAll = lastNonEmptyLines.join('\n');
    if (!isNonClaudeAgent) {
      if (/Welcome to Claude Code!/.test(recentAll) || /\? for shortcuts/.test(recentAll)) {
        state.claudeLikely = true;
      }
      // When the orchestrator restarts a Claude worktree as an interactive bash, it prints this banner.
      if (/Claude session ended\./.test(recentAll) || /Type 'claude' to start a new Claude session\./.test(recentAll)) {
        state.claudeLikely = false;
      }
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

    // 6. Shell prompt means no active AI is currently running in this terminal.
    // If we observe an explicit shell prompt, clear claudeLikely so stale
    // Claude activity doesn't keep the session marked busy.
    if (this.looksLikeShellPrompt(trimmedLastNonEmptyLine)) {
      state.claudeLikely = false;
      return 'idle';
    }

    // 7. Generic prompt fallback (only when Claude is not likely active).
    if (!state.claudeLikely && this.looksLikePrompt(trimmedLastNonEmptyLine)) {
      return 'idle';
    }

    // 8. Default: assume busy for a short quiet window after output.
    const isAgentTerminal = /-(claude|codex)$/.test(String(sessionId || ''));
    const assumeBusyWindowMs = (state.claudeLikely || isAgentTerminal)
      ? (state.claudeLikely ? ASSUME_BUSY_SINCE_OUTPUT_CLAUDE_MS : ASSUME_BUSY_SINCE_OUTPUT_AGENT_MS)
      : ASSUME_BUSY_SINCE_OUTPUT_MS;
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

  looksLikeShellPrompt(line) {
    const shellPromptPatterns = [
      /^\$$/,
      /^#$/,
      /^PS .*>$/i,            // PowerShell prompt
      /^\w+@[\w.-]+:.*[\$#]$/, // user@host:path$
      /^\(.*\)\s*[\$#]$/,     // (venv) $
      /^.*[\/~].*[\$#]$/,     // path-based prompts ending in $/#
      /^bash-[\d.]+\$$/i
    ];

    return shellPromptPatterns.some(pattern => pattern.test(line));
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
