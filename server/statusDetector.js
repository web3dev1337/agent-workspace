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
const ASSUME_BUSY_SINCE_OUTPUT_MS = 8000; // 8s
const ASSUME_BUSY_SINCE_OUTPUT_AGENT_MS = 15000; // 15s
const ASSUME_BUSY_SINCE_OUTPUT_CLAUDE_MS = 30000; // 30s
const ASSUME_BUSY_SINCE_OUTPUT_CODEX_MS = 10000; // 10s
const ASSUME_BUSY_SINCE_OUTPUT_GEMINI_MS = 6000; // 6s
const ASSUME_BUSY_SINCE_OUTPUT_OPENCODE_MS = 5000; // 5s
const ASSUME_BUSY_SINCE_OUTPUT_AIDER_MS = 10000; // 10s

class StatusDetector {
  constructor() {
    // RELIABLE completion indicators - Claude shows these when done
    // The Cost line is the most reliable indicator Claude is done
    this.completionPatterns = [
      /Cost: \$[\d.]+/,               // Cost line - MOST RELIABLE done indicator
      /Total cost: \$[\d.]+/,
      /Session cost: \$[\d.]+/,
      /Total duration \(wall\):/,      // Session summary line
      /Total code changes:/,           // Session summary line
      /tokens used/i,                  // Token usage line
      /\d+ input, \d+ output.*cache/,  // Per-model token usage line
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
      /Agent\(.*\)/,                   // Sub-agent tool
      /WebFetch\(.*\)/,               // Web fetch tool
      /WebSearch\(.*\)/,              // Web search tool
      /NotebookEdit\(.*\)/,           // Notebook edit tool
      /NotebookRead\(.*\)/,           // Notebook read tool
      /Skill\(.*\)/,                  // Skill execution tool
      /AskUserQuestion\(.*\)/,        // User question tool
      /ToolSearch\(.*\)/,             // Tool search tool
      /TodoWrite\(.*\)/,              // Todo write tool
      /TaskOutput\(.*\)/,             // Task output tool
      /TaskStop\(.*\)/,               // Task stop tool
    ];

    // Patterns that suggest Claude is typing/processing (busy)
    this.typingPatterns = [
      /∴ Thinking…/,                   // Thinking indicator
      /Waiting for permission/,        // Permission prompt pending
      /Waiting for task/,              // Sub-agent task pending
      /Running command/,               // Bash tool executing
      /compacting conversation/i,      // Context compaction in progress
    ];

    // Per-session state (StatusDetector is shared across sessions).
    this.sessionState = new Map(); // sessionId -> { lastBufferLength, lastOutputTime, claudeLikely, agent }
  }

  stripControlSequences(text) {
    const input = String(text || '');
    return input
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
      .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
      .replace(/\x1b[()][A-Za-z0-9]/g, '');
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

  normalizeAgent(agent) {
    const normalized = String(agent || '').trim().toLowerCase();
    if (!normalized) return null;
    if (normalized === 'gemini-cli') return 'gemini';
    if (normalized === 'open-code') return 'opencode';
    return normalized;
  }

  getAssumeBusyWindowMs({ agent, isAgentTerminal, claudeLikely }) {
    const normalizedAgent = this.normalizeAgent(agent);
    if (normalizedAgent === 'codex') return ASSUME_BUSY_SINCE_OUTPUT_CODEX_MS;
    if (normalizedAgent === 'gemini') return ASSUME_BUSY_SINCE_OUTPUT_GEMINI_MS;
    if (normalizedAgent === 'opencode') return ASSUME_BUSY_SINCE_OUTPUT_OPENCODE_MS;
    if (normalizedAgent === 'aider') return ASSUME_BUSY_SINCE_OUTPUT_AIDER_MS;
    if (claudeLikely) return ASSUME_BUSY_SINCE_OUTPUT_CLAUDE_MS;
    if (isAgentTerminal) return ASSUME_BUSY_SINCE_OUTPUT_AGENT_MS;
    return ASSUME_BUSY_SINCE_OUTPUT_MS;
  }

  detectProviderStatus(agent, context = {}) {
    const normalizedAgent = this.normalizeAgent(agent);
    if (!normalizedAgent || normalizedAgent === 'claude') return null;

    const {
      recentOutput = '',
      recentAll = '',
      trimmedLastNonEmptyLine = '',
      hasRecentOutput = false,
    } = context;

    if (normalizedAgent === 'codex') {
      // Codex waiting: user-facing prompts and approval dialogs
      if (
        trimmedLastNonEmptyLine === '>' ||
        /^codex>\s*$/i.test(trimmedLastNonEmptyLine) ||
        (/OpenAI Codex/i.test(recentOutput) && /\? for shortcuts/i.test(recentOutput)) ||
        /Choose how you'd like Codex to proceed\./i.test(recentOutput) ||
        /Choose an action/i.test(recentOutput) ||
        /Select provider\?/i.test(recentOutput) ||
        /Use .*press enter to confirm/i.test(recentOutput)
      ) {
        return 'waiting';
      }
      // Codex busy: active processing indicators
      if (
        hasRecentOutput && (
          /esc to interrupt/i.test(recentOutput) ||
          /tab to add notes/i.test(recentOutput)
        )
      ) {
        return 'busy';
      }
      return null;
    }

    if (normalizedAgent === 'gemini') {
      const hasGeminiPrompt = /Type your message or @path\/to\/file/i.test(recentOutput);
      const hasGeminiChrome = (
        /\? for shortcuts/i.test(recentOutput)
        || /Shift\+Tab to accept edits/i.test(recentOutput)
        || /workspace \(/i.test(recentOutput)
      );

      // Gemini waiting: input prompts, auth dialogs, trust dialogs, tool confirmations
      if (
        /Waiting for authentication\.\.\./i.test(recentOutput) ||
        /Waiting for verification\.\.\./i.test(recentOutput) ||
        /Do you trust the files in this folder\?/i.test(recentOutput) ||
        /Need approval\?/i.test(recentOutput) ||
        /Apply this change\?/i.test(recentOutput) ||
        /Allow execution of/i.test(recentOutput) ||
        /Do you want to proceed\?/i.test(recentOutput) ||
        /Ready to start implementation\?/i.test(recentOutput) ||
        /Modify Trust Level/i.test(recentOutput) ||
        /Use arrow keys to navigate, Enter to confirm, Esc to cancel\./i.test(recentOutput) ||
        (/Press Ctrl\+[CD] again to exit\./i.test(recentOutput) && hasGeminiPrompt) ||
        (hasGeminiPrompt && hasGeminiChrome)
      ) {
        return 'waiting';
      }

      // Gemini busy: thinking, processing, initializing
      if (
        hasRecentOutput && (
          /Thinking\.\.\./i.test(recentOutput) ||
          /\(esc to cancel,\s*[\d:smh]+\)/i.test(recentOutput) ||
          /\(press tab to focus\)/i.test(recentOutput) ||
          /Waiting for MCP servers to initialize/i.test(recentAll)
        )
      ) {
        return 'busy';
      }

      return null;
    }

    if (normalizedAgent === 'opencode') {
      const hasOpenCodePrompt = /Ask anything\.\.\./i.test(recentOutput);
      const hasOpenCodeChrome = (
        /ctrl\+t\s+variants/i.test(recentOutput)
        || /ctrl\+p\s+commands/i.test(recentOutput)
        || /\btab\s+agents\b/i.test(recentOutput)
      );

      // OpenCode waiting: input prompt with chrome, or idle help text
      if (
        (hasOpenCodePrompt && hasOpenCodeChrome) ||
        /press enter to send the message/i.test(recentOutput)
      ) {
        return 'waiting';
      }

      // OpenCode busy: thinking, generating, tool calls, working
      if (
        hasRecentOutput && (
          /Thinking\.\.\./i.test(recentOutput) ||
          /Generating\.\.\./i.test(recentOutput) ||
          /Working\.\.\./i.test(recentOutput) ||
          /Waiting for tool response\.\.\./i.test(recentOutput) ||
          /Building tool call\.\.\./i.test(recentOutput) ||
          /press esc to exit cancel/i.test(recentOutput)
        )
      ) {
        return 'busy';
      }

      return null;
    }

    if (normalizedAgent === 'aider') {
      // Aider waiting: standard prompt or multiline prompt
      if (
        trimmedLastNonEmptyLine === '>' ||
        /^multi>\s*$/i.test(trimmedLastNonEmptyLine) ||
        /^aider>\s*$/i.test(trimmedLastNonEmptyLine)
      ) {
        return 'waiting';
      }
      // Aider busy: waiting for LLM, thinking
      if (
        hasRecentOutput && (
          /Waiting for .*LLM/i.test(recentOutput) ||
          /Waiting for .*model/i.test(recentOutput) ||
          /think tokens/i.test(recentOutput)
        )
      ) {
        return 'busy';
      }
      return null;
    }

    return null;
  }

  detectStatus(sessionId, buffer, options = {}) {
    const state = this.getState(sessionId);
    const agent = this.normalizeAgent(options?.agent);
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
    const isAgentTerminal = /-(claude|codex)$/.test(String(sessionId || ''));
    const assumeBusyWindowMs = this.getAssumeBusyWindowMs({
      agent,
      isAgentTerminal,
      claudeLikely: state.claudeLikely
    });
    const hasRecentOutput = timeSinceOutput < assumeBusyWindowMs;

    // Get recent output for analysis
    const recentOutput = this.stripControlSequences(buffer.slice(-2000));
    const lines = recentOutput.split('\n');
    const lastFewLines = lines.slice(-10).join('\n');
    const lastNonEmptyLine = this.getLastNonEmptyLine(lines);
    const trimmedLastNonEmptyLine = lastNonEmptyLine.trim();
    const lastNonEmptyLines = this.getLastNonEmptyLines(lines, 6);
    const recentAll = lastNonEmptyLines.join('\n');

    // If a different agent (e.g. Codex) is running in this terminal, avoid reusing Claude UI heuristics.
    if (isNonClaudeAgent) {
      state.claudeLikely = false;
    }

    const providerStatus = this.detectProviderStatus(agent, {
      recentOutput,
      recentAll,
      trimmedLastNonEmptyLine,
      hasRecentOutput,
    });
    if (providerStatus) {
      return providerStatus;
    }

    if (isNonClaudeAgent) {
      if (this.hasExplicitShellIndicator(recentAll, trimmedLastNonEmptyLine)) {
        return 'idle';
      }

      if (timeSinceOutput < assumeBusyWindowMs && buffer.length > 100) {
        return 'busy';
      }

      return 'idle';
    }

    // Heuristic: determine whether Claude Code UI is likely active in this session.
    // This is used to avoid misclassifying shell-like prompts that can appear inside output while Claude is working.
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
    if (hasRecentOutput) {
      for (const pattern of this.toolPatterns) {
        if (!pattern.test(lastFewLines)) continue;
        state.claudeLikely = true;
        // Completion is only considered reliable when it is the last non-empty line (handled above).
        // Do not suppress tool activity because an older "Cost:" line is still visible in scrollback.
        logger.debug('Tool activity detected - busy', { pattern: pattern.toString() });
        return 'busy';
      }
    }

    // 5. Check typing/thinking patterns
    if (hasRecentOutput) {
      for (const pattern of this.typingPatterns) {
        if (!pattern.test(lastFewLines)) continue;
        state.claudeLikely = true;
        logger.debug('Typing pattern detected - busy');
        return 'busy';
      }
    }
    if (hasRecentOutput && /(\.\.\.|…)$/.test(trimmedLastNonEmptyLine)) {
      state.claudeLikely = true;
      logger.debug('Trailing ellipsis detected - busy');
      return 'busy';
    }

    // 6. Shell prompt means no active AI is currently running in this terminal.
    // If we observe an explicit shell prompt, clear claudeLikely so stale
    // Claude activity doesn't keep the session marked busy.
    if (this.hasExplicitShellIndicator(recentAll, trimmedLastNonEmptyLine)) {
      state.claudeLikely = false;
      return 'idle';
    }

    // 7. Generic prompt fallback (only when Claude is not likely active).
    if (!state.claudeLikely && this.looksLikePrompt(trimmedLastNonEmptyLine)) {
      return 'idle';
    }

    // 8. Default: assume busy for a short quiet window after output.
    if (timeSinceOutput < assumeBusyWindowMs && buffer.length > 100) {
      return 'busy';
    }

    return 'idle';
  }

  hasExplicitShellIndicator(recentAll, trimmedLastNonEmptyLine = '') {
    const normalizedRecent = this.stripControlSequences(recentAll || '');
    const normalizedLine = this.stripControlSequences(trimmedLastNonEmptyLine || '').trim();
    return (
      /Type 'claude' to start a new Claude session\./i.test(normalizedRecent)
      || /Claude session ended\./i.test(normalizedRecent)
      || this.looksLikeShellPrompt(normalizedLine)
    );
  }
  
  looksLikePrompt(line) {
    // Common shell/input prompt patterns
    const promptPatterns = [
      /^>$/,
      /^\$$/,
      /^%$/,
      /^>>>$/,
      /^claude>$/i,
      /^assistant>$/i,
      /^codex>$/i,
      /^❯$/,
      /^\w+[@:~].*[\$#>]$/,  // user@host:~$ or similar
      /^\(.*\)\s*\$$/,        // (venv) $ style prompts
      /^.+\s[❯»›]$/,
    ];

    return promptPatterns.some(pattern => pattern.test(line));
  }

  looksLikeShellPrompt(line) {
    const shellPromptPatterns = [
      /^\$$/,
      /^#$/,
      /^%$/,
      /^PS .*>$/i,            // PowerShell prompt
      /^\w+@[\w.-]+:.*[\$#%]$/, // user@host:path$
      /^\(.*\)\s*[\$#%]$/,     // (venv) $
      /^.*[\/~].*[\$#%]$/,     // path-based prompts ending in $/#/%
      /^bash-[\d.]+\$$/i,
      /^zsh-[\d.]+%$/i,
      /^.+\s[❯»›]$/,
      /^.+[\/~].*[❯»›]$/,
      /^❯$/
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
