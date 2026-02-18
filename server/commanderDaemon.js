/**
 * CommanderDaemon - Headless Claude Code CLI daemon
 *
 * OpenClaw-style always-on commander that runs headless Claude Code
 * (`claude -p --output-format stream-json`) as subprocesses instead of
 * a pty terminal. Each inbox event batch spawns a headless Claude process,
 * streams the response to the UI via Socket.IO, and exits cleanly.
 *
 * Context management: handled by Claude Code's built-in auto-compact.
 * Session continuity: `--resume <session_id>` after first run.
 * Model: configurable via COMMANDER_MODEL env var (default: claude-opus-4-6).
 */

const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const path = require('path');
const os = require('os');
const winston = require('winston');

const HOME_DIR = process.env.HOME || os.homedir();
const COMMANDER_CWD = process.env.COMMANDER_CWD || path.resolve(__dirname, '..');
const POLL_MS = parseInt(process.env.COMMANDER_POLL_MS) || 5000;
const COMMANDER_MODEL = process.env.COMMANDER_MODEL || 'claude-opus-4-6';

// Watchdog restart backoff: 15s, 30s, 60s, 120s, 240s
const BACKOFF_STEPS_MS = [15_000, 30_000, 60_000, 120_000, 240_000];

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: 'logs/commander.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

// System prompt injected on first run (before any inbox events)
const INIT_PROMPT = `You are Commander — the always-on AI orchestrator daemon for the Claude Orchestrator system.

You run continuously as a headless background process. Your inbox delivers tasks from any channel: voice commands, Discord messages, Trello cards, scheduled jobs, or the UI. Process them and coordinate the worktree agents.

Orchestrator API base: http://localhost:${process.env.ORCHESTRATOR_PORT || 3000}

Key endpoints:
- GET  /api/commander/sessions         — all active Claude sessions
- POST /api/commander/send-to-session  — send input to a session { sessionId, input }
- POST /api/commander/execute          — run any registered command { command, params }
- GET  /api/commander/context          — current workspace/worktree context
- GET  /api/workspaces                 — all workspaces
- GET  /api/workspaces/active          — currently active workspace

You are now initialized and listening for inbox events. Acknowledge with a brief greeting.`;

class CommanderDaemon {
  constructor(options = {}) {
    this.io = options.io;
    this.sessionManager = options.sessionManager;

    // Claude Code session ID — used for --resume on subsequent runs
    this._sessionId = null;
    this._initialized = false;

    // Daemon lifecycle
    this._running = false;
    this._processing = false;
    this._pollTimer = null;
    this._backoffIndex = 0;
    this._restartCount = 0;
    this._lastCrashAt = null;

    // Inbox
    this._inbox = [];
    this._maxInboxSize = 200;
  }

  static getInstance(options) {
    if (!CommanderDaemon.instance) {
      CommanderDaemon.instance = new CommanderDaemon(options);
    }
    return CommanderDaemon.instance;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  async start() {
    if (this._running) return { success: false, error: 'Already running' };
    this._running = true;
    logger.info('[commander-daemon] Starting headless CLI daemon', { model: COMMANDER_MODEL, cwd: COMMANDER_CWD });

    // Send initialization prompt to establish session and greet
    await this._runClaude(INIT_PROMPT).catch((err) => {
      logger.warn('[commander-daemon] Init run failed', { error: err.message });
    });

    this._schedulePoll();
    this._emitStatus();
    return { success: true };
  }

  stop() {
    this._running = false;
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
    if (this._currentProcess) {
      try { this._currentProcess.kill('SIGTERM'); } catch { /* ignore */ }
      this._currentProcess = null;
    }
    logger.info('[commander-daemon] Stopped');
    this._emitStatus();
    return { success: true };
  }

  async restart() {
    this.stop();
    await new Promise(r => setTimeout(r, 500));
    return this.start();
  }

  getStatus() {
    return {
      running: this._running,
      processing: this._processing,
      initialized: this._initialized,
      sessionId: this._sessionId,
      model: COMMANDER_MODEL,
      restartCount: this._restartCount,
      lastCrashAt: this._lastCrashAt,
      inboxSize: this._inbox.length,
      mode: 'headless-cli'
    };
  }

  // ─── Poll loop ──────────────────────────────────────────────────────────────

  _schedulePoll() {
    if (!this._running) return;
    this._pollTimer = setTimeout(() => this._tick(), POLL_MS);
  }

  async _tick() {
    if (!this._running) return;

    const pending = this._inbox.filter(e => e.status === 'pending');
    if (pending.length > 0 && !this._processing) {
      await this._processEvents(pending);
    }

    this._schedulePoll();
  }

  // ─── Event processing ────────────────────────────────────────────────────────

  async _processEvents(events) {
    this._processing = true;
    events.forEach(e => { e.status = 'processing'; });

    const prompt = events.length === 1
      ? `📬 Inbox event from ${events[0].source} (${events[0].type}):\n${events[0].payload}`
      : `📬 ${events.length} inbox events:\n` +
        events.map((e, i) => `${i + 1}. [${e.source}/${e.type}] ${e.payload}`).join('\n');

    try {
      await this._runClaude(prompt);
      events.forEach(e => { e.status = 'delivered'; });
      this._backoffIndex = 0; // reset backoff on success
    } catch (err) {
      logger.error('[commander-daemon] Failed to process events', { error: err.message });
      events.forEach(e => { e.status = 'failed'; });
      this._scheduleRetryBackoff();
    } finally {
      this._processing = false;
    }

    if (this.io) {
      this.io.emit('commander-inbox-delivered', { count: events.length });
    }
  }

  // ─── Headless Claude runner ──────────────────────────────────────────────────

  /**
   * Spawn a headless Claude Code process for a single prompt.
   * Uses --resume <session_id> to continue the same conversation.
   * Streams JSON events from stdout to the Socket.IO commander panel.
   */
  async _runClaude(prompt) {
    const claudeBin = this._findClaudeBin();

    const args = [
      '--print',                      // headless / non-interactive
      '--output-format', 'stream-json',
      '--model', COMMANDER_MODEL,
      '--dangerously-skip-permissions',
    ];

    if (this._sessionId) {
      args.push('--resume', this._sessionId);
    }

    logger.info('[commander-daemon] Spawning headless Claude', {
      args: args.filter(a => a !== prompt).join(' '),
      sessionId: this._sessionId,
      promptLen: prompt.length
    });

    return new Promise((resolve, reject) => {
      const proc = spawn(claudeBin, args, {
        cwd: COMMANDER_CWD,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PATH: [
            `${HOME_DIR}/.nvm/versions/node/v22.16.0/bin`,
            `${HOME_DIR}/.nvm/versions/node/v22.19.0/bin`,
            '/snap/bin',
            '/usr/local/bin',
            '/usr/bin',
            '/bin',
            process.env.PATH || ''
          ].join(':'),
          HOME: HOME_DIR,
          TERM: 'xterm-256color'
        }
      });

      this._currentProcess = proc;

      // Write prompt to stdin and close so Claude knows input is done
      proc.stdin.write(prompt, 'utf8');
      proc.stdin.end();

      // Parse stream-json events from stdout
      let stdoutBuf = '';
      proc.stdout.on('data', (chunk) => {
        stdoutBuf += chunk.toString('utf8');
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop(); // hold incomplete line
        for (const line of lines) {
          this._handleStreamLine(line.trim());
        }
      });

      // Pipe stderr to log (Claude's debug/warning output)
      let stderrBuf = '';
      proc.stderr.on('data', (chunk) => {
        stderrBuf += chunk.toString('utf8');
      });

      proc.on('close', (code) => {
        this._currentProcess = null;
        // Flush any remaining stdout buffer
        if (stdoutBuf.trim()) this._handleStreamLine(stdoutBuf.trim());

        if (code !== 0 && code !== null) {
          const errMsg = stderrBuf.slice(-500) || `Exit code ${code}`;
          logger.warn('[commander-daemon] Claude exited with error', { code, stderr: errMsg.slice(0, 200) });
          // Emit error to panel so user sees it
          this._emit(`\n[Commander: process exited with code ${code}]\n`);
          reject(new Error(`Claude exited ${code}: ${errMsg.slice(0, 120)}`));
        } else {
          resolve();
        }
      });

      proc.on('error', (err) => {
        this._currentProcess = null;
        logger.error('[commander-daemon] Spawn error', { error: err.message });
        reject(err);
      });
    });
  }

  /**
   * Parse a single line of stream-json output from the Claude CLI.
   */
  _handleStreamLine(line) {
    if (!line) return;

    let event;
    try {
      event = JSON.parse(line);
    } catch {
      // Plain text line (shouldn't happen with stream-json, but emit it anyway)
      this._emit(line + '\n');
      return;
    }

    // Capture session ID for --resume on next run
    if (event.session_id && !this._sessionId) {
      this._sessionId = event.session_id;
      this._initialized = true;
      logger.info('[commander-daemon] Session established', { sessionId: this._sessionId });
      this._emitStatus();
    }

    switch (event.type) {
      case 'system':
        if (event.subtype === 'init') {
          this._emit(`\n[Commander online — model: ${COMMANDER_MODEL} | session: ${this._sessionId}]\n`);
        }
        break;

      case 'assistant': {
        // Stream text content blocks to the UI panel
        const content = Array.isArray(event.message?.content) ? event.message.content : [];
        for (const block of content) {
          if (block.type === 'text' && block.text) {
            this._emit(block.text);
          }
        }
        break;
      }

      case 'result':
        if (event.total_tokens) {
          logger.info('[commander-daemon] Run complete', {
            tokens: event.total_tokens,
            cost: event.cost_usd,
            session: event.session_id
          });
          if (this.io) {
            this.io.emit('commander-usage', {
              tokens: event.total_tokens,
              costUsd: event.cost_usd,
              sessionId: event.session_id
            });
          }
        }
        if (event.subtype === 'error') {
          this._emit(`\n[Commander error: ${event.error || 'unknown'}]\n`);
        }
        break;

      case 'error':
        this._emit(`\n[Commander error: ${event.error?.message || JSON.stringify(event)}]\n`);
        break;

      default:
        break;
    }
  }

  // ─── Inbox ───────────────────────────────────────────────────────────────────

  enqueueEvent(event) {
    if (this._inbox.length >= this._maxInboxSize) {
      this._inbox.shift();
    }

    const queued = {
      id: randomUUID(),
      source: event.source || 'unknown',
      type: event.type || 'task',
      payload: event.payload || '',
      meta: event.meta || {},
      createdAt: new Date().toISOString(),
      status: 'pending'
    };

    this._inbox.push(queued);
    logger.info('[inbox] Event enqueued', { id: queued.id, source: queued.source });

    if (this.io) {
      this.io.emit('commander-inbox-update', { action: 'added', event: queued, total: this._inbox.length });
    }

    return queued;
  }

  dismissEvent(id) {
    const idx = this._inbox.findIndex(e => e.id === id);
    if (idx === -1) return false;
    const [removed] = this._inbox.splice(idx, 1);
    if (this.io) {
      this.io.emit('commander-inbox-update', { action: 'dismissed', event: removed, total: this._inbox.length });
    }
    return true;
  }

  getInbox(status = null) {
    if (!status) return [...this._inbox];
    return this._inbox.filter(e => e.status === status);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  _emit(text) {
    if (this.io) {
      this.io.emit('commander-output', { data: text });
    }
  }

  _emitStatus() {
    if (this.io) {
      this.io.emit('commander-daemon-status', this.getStatus());
    }
  }

  _scheduleRetryBackoff() {
    const delay = BACKOFF_STEPS_MS[Math.min(this._backoffIndex, BACKOFF_STEPS_MS.length - 1)];
    this._backoffIndex = Math.min(this._backoffIndex + 1, BACKOFF_STEPS_MS.length - 1);
    this._restartCount++;
    this._lastCrashAt = new Date().toISOString();
    logger.info(`[commander-daemon] Will retry in ${delay}ms (attempt #${this._restartCount})`);
    if (this.io) {
      this.io.emit('commander-daemon-restarting', { delayMs: delay, restartCount: this._restartCount });
    }
  }

  _findClaudeBin() {
    // Prefer nvm node bin paths where claude is installed
    const candidates = [
      `${HOME_DIR}/.nvm/versions/node/v22.19.0/bin/claude`,
      `${HOME_DIR}/.nvm/versions/node/v22.16.0/bin/claude`,
      '/usr/local/bin/claude',
      'claude'
    ];
    const fs = require('fs');
    for (const c of candidates) {
      try {
        if (c === 'claude') return c; // let PATH resolve it
        if (fs.existsSync(c)) return c;
      } catch { /* ignore */ }
    }
    return 'claude';
  }
}

module.exports = { CommanderDaemon };
