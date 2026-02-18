/**
 * Commander Service - Top-Level AI as a Claude Code Terminal
 *
 * Instead of calling the Anthropic API, Commander IS a Claude Code terminal
 * running from a central location. This is consistent with how all other
 * worktree terminals work - they're all Claude Code instances.
 *
 * OpenClaw-style daemon mode: Commander runs continuously, auto-restarts on
 * crash, and maintains a persistent inbox so any channel (voice, Discord,
 * Trello, UI) can drop events in for it to process.
 */

const pty = require('node-pty');
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');
const winston = require('winston');

const HOME_DIR = process.env.HOME || os.homedir();

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/commander.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

// Commander runs from the orchestrator's own directory so it picks up CLAUDE.md
// Override with COMMANDER_CWD env var if needed
const COMMANDER_CWD = process.env.COMMANDER_CWD || path.resolve(__dirname, '..');

// Watchdog restart backoff: 15s, 30s, 60s, 120s, max 240s
const BACKOFF_STEPS_MS = [15_000, 30_000, 60_000, 120_000, 240_000];
const WATCHDOG_INTERVAL_MS = 10_000; // health-check every 10s

class CommanderService {
  constructor(options = {}) {
    this.io = options.io;
    this.sessionManager = options.sessionManager;
    this.session = null;
    this.outputBuffer = [];
    this.maxBufferLines = 500;
    this.isReady = false;
    this.claudeStarted = false;

    // --- Daemon state ---
    this.daemonEnabled = false;      // true once startDaemon() is called
    this.daemonRunning = false;      // watchdog loop active
    this._watchdogTimer = null;
    this._backoffIndex = 0;          // current position in BACKOFF_STEPS_MS
    this._restartCount = 0;
    this._lastCrashAt = null;
    this._restartScheduled = false;  // prevent double-restart scheduling

    // --- Inbox ---
    // Each event: { id, source, type, payload, createdAt, status }
    this._inbox = [];
    this._maxInboxSize = 200;
  }

  static getInstance(options) {
    if (!CommanderService.instance) {
      CommanderService.instance = new CommanderService(options);
    }
    return CommanderService.instance;
  }

  // ─── Daemon lifecycle ────────────────────────────────────────────────────────

  /**
   * Start in daemon mode: auto-start the terminal and keep it alive forever.
   * Safe to call multiple times (idempotent).
   */
  async startDaemon() {
    if (this.daemonEnabled) return;
    this.daemonEnabled = true;
    this.daemonRunning = true;
    logger.info('[daemon] Starting Commander daemon');

    // Boot the terminal immediately
    await this._daemonBoot();

    // Start watchdog loop
    this._scheduleWatchdog();

    this._emitDaemonStatus();
  }

  /**
   * Stop daemon mode. Commander will no longer auto-restart.
   */
  stopDaemon() {
    this.daemonEnabled = false;
    this.daemonRunning = false;
    if (this._watchdogTimer) {
      clearTimeout(this._watchdogTimer);
      this._watchdogTimer = null;
    }
    logger.info('[daemon] Commander daemon stopped');
    this._emitDaemonStatus();
  }

  /**
   * Internal: boot sequence for daemon restarts.
   * Uses --continue on restarts to preserve Claude's conversation history.
   */
  async _daemonBoot() {
    if (this.session) return; // already running

    const isRestart = this._restartCount > 0;
    logger.info(`[daemon] Booting Commander (restart=${isRestart}, count=${this._restartCount})`);

    const result = await this.start();
    if (!result.success) {
      logger.warn('[daemon] Boot failed, watchdog will retry', { error: result.error });
      return;
    }

    // Let shell settle, then start Claude
    await new Promise(r => setTimeout(r, 1000));

    // On restarts use --continue so Claude picks up where it left off
    const mode = isRestart ? 'continue' : 'fresh';
    await this.startClaude(mode, true);

    // Reset backoff on successful boot
    this._backoffIndex = 0;
    this._restartScheduled = false;
  }

  /**
   * Schedule the watchdog health check loop.
   */
  _scheduleWatchdog() {
    if (!this.daemonRunning) return;
    this._watchdogTimer = setTimeout(() => this._watchdogTick(), WATCHDOG_INTERVAL_MS);
  }

  /**
   * Watchdog tick: check if Commander is alive, restart if not.
   */
  async _watchdogTick() {
    if (!this.daemonRunning) return;

    if (!this.session) {
      // Commander has died
      if (!this._restartScheduled) {
        this._scheduleRestart();
      }
    } else {
      // Still alive - emit heartbeat
      this._emitDaemonStatus();
    }

    this._scheduleWatchdog();
  }

  /**
   * Schedule a restart with exponential backoff.
   */
  _scheduleRestart() {
    if (this._restartScheduled || !this.daemonEnabled) return;
    this._restartScheduled = true;
    this._lastCrashAt = new Date().toISOString();

    const delay = BACKOFF_STEPS_MS[Math.min(this._backoffIndex, BACKOFF_STEPS_MS.length - 1)];
    this._backoffIndex = Math.min(this._backoffIndex + 1, BACKOFF_STEPS_MS.length - 1);
    this._restartCount++;

    logger.info(`[daemon] Commander crashed, restarting in ${delay}ms (attempt #${this._restartCount})`);

    if (this.io) {
      this.io.emit('commander-daemon-restarting', {
        delayMs: delay,
        restartCount: this._restartCount,
        lastCrashAt: this._lastCrashAt
      });
    }

    setTimeout(async () => {
      this._restartScheduled = false;
      if (this.daemonEnabled) {
        await this._daemonBoot();
        this._emitDaemonStatus();
      }
    }, delay);
  }

  /**
   * Emit daemon health status to all connected clients.
   */
  _emitDaemonStatus() {
    if (!this.io) return;
    this.io.emit('commander-daemon-status', this.getDaemonStatus());
  }

  /**
   * Get daemon health info.
   */
  getDaemonStatus() {
    return {
      daemonEnabled: this.daemonEnabled,
      daemonRunning: this.daemonRunning,
      running: !!this.session,
      ready: this.isReady,
      restartCount: this._restartCount,
      lastCrashAt: this._lastCrashAt,
      backoffIndex: this._backoffIndex,
      nextBackoffMs: BACKOFF_STEPS_MS[Math.min(this._backoffIndex, BACKOFF_STEPS_MS.length - 1)],
      inboxSize: this._inbox.length
    };
  }

  // ─── Inbox ───────────────────────────────────────────────────────────────────

  /**
   * Enqueue an event into Commander's inbox.
   * Commander can receive events from any channel: voice, Discord, Trello, UI, cron.
   *
   * @param {object} event
   * @param {string} event.source   - e.g. 'voice', 'discord', 'trello', 'ui', 'cron'
   * @param {string} event.type     - e.g. 'task', 'question', 'status-request', 'alert'
   * @param {string} event.payload  - freeform string (the actual message/task)
   * @param {object} [event.meta]   - optional extra context
   * @returns {object} the queued event with id
   */
  enqueueEvent(event) {
    if (this._inbox.length >= this._maxInboxSize) {
      // Drop oldest non-pending event or just the oldest
      this._inbox.shift();
    }

    const queued = {
      id: randomUUID(),
      source: event.source || 'unknown',
      type: event.type || 'task',
      payload: event.payload || '',
      meta: event.meta || {},
      createdAt: new Date().toISOString(),
      status: 'pending'  // pending | delivered | dismissed
    };

    this._inbox.push(queued);
    logger.info('[inbox] Event enqueued', { id: queued.id, source: queued.source, type: queued.type });

    if (this.io) {
      this.io.emit('commander-inbox-update', { action: 'added', event: queued, total: this._inbox.length });
    }

    // If Commander is alive and ready, deliver immediately
    this._deliverPending();

    return queued;
  }

  /**
   * Dismiss / remove an event from the inbox.
   */
  dismissEvent(id) {
    const idx = this._inbox.findIndex(e => e.id === id);
    if (idx === -1) return false;
    const [removed] = this._inbox.splice(idx, 1);
    logger.info('[inbox] Event dismissed', { id });
    if (this.io) {
      this.io.emit('commander-inbox-update', { action: 'dismissed', event: removed, total: this._inbox.length });
    }
    return true;
  }

  /**
   * Get all inbox events (optionally filtered by status).
   */
  getInbox(status = null) {
    if (!status) return [...this._inbox];
    return this._inbox.filter(e => e.status === status);
  }

  /**
   * Deliver pending inbox events to the running Commander Claude session.
   * Formats them as a numbered list so Claude sees a clean digest.
   */
  _deliverPending() {
    if (!this.isReady || !this.claudeStarted) return;

    const pending = this._inbox.filter(e => e.status === 'pending');
    if (pending.length === 0) return;

    // Mark as delivered
    pending.forEach(e => { e.status = 'delivered'; });

    const lines = pending.map((e, i) =>
      `${i + 1}. [${e.source}/${e.type}] ${e.payload}`
    ).join('\n');

    const msg = pending.length === 1
      ? `📬 Inbox event from ${pending[0].source}:\n${lines}\n`
      : `📬 ${pending.length} inbox events:\n${lines}\n`;

    this.sendInput(msg + '\r');

    if (this.io) {
      this.io.emit('commander-inbox-delivered', { count: pending.length });
    }
  }

  // ─── Terminal lifecycle ──────────────────────────────────────────────────────

  /**
   * Start the Commander terminal session
   * This spawns a Claude Code instance from the orchestrator directory
   */
  async start() {
    if (this.session) {
      logger.warn('Commander session already running');
      return { success: false, error: 'Already running' };
    }

    logger.info('Starting Commander terminal', { cwd: COMMANDER_CWD });

    try {
      const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
      const shellArgs = process.platform === 'win32' ? ['-NoExit'] : [];

      const ptyProcess = pty.spawn(shell, shellArgs, {
        name: 'xterm-color',
        cols: 120,
        rows: 40,
        cwd: COMMANDER_CWD,
        env: process.platform === 'win32'
          ? { ...process.env }
          : {
              ...process.env,
              PATH: `${HOME_DIR}/.nvm/versions/node/v22.16.0/bin:/snap/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}`,
              HOME: HOME_DIR,
              TERM: 'xterm-color'
            }
      });

      this.session = {
        id: 'commander',
        pty: ptyProcess,
        type: 'commander',
        status: 'starting',
        buffer: '',
        lastActivity: Date.now()
      };

      ptyProcess.onData((data) => {
        if (!this.session) return;

        this.session.buffer += data;
        this.session.lastActivity = Date.now();
        this.addToOutputBuffer(data);

        if (this.io) {
          this.io.emit('commander-output', { data });
        }

        if (data.includes('>') || data.includes('$')) {
          if (!this.isReady) {
            this.session.status = 'ready';
            this.isReady = true;

            if (!this.claudeStarted) {
              setTimeout(() => {
                if (!this.claudeStarted) {
                  this.startClaude('fresh', true);
                }
              }, 1000);
            }
          }
        }
      });

      ptyProcess.onExit(({ exitCode }) => {
        logger.info('Commander terminal exited', { exitCode, daemonEnabled: this.daemonEnabled });
        this.session = null;
        this.isReady = false;
        this.claudeStarted = false;

        if (this.io) {
          this.io.emit('commander-exit', { exitCode });
        }

        // Daemon: schedule restart on unexpected exit
        if (this.daemonEnabled && !this._restartScheduled) {
          this._scheduleRestart();
        }
      });

      return { success: true, message: 'Commander terminal started' };
    } catch (error) {
      logger.error('Failed to start Commander terminal', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Start Claude Code in the Commander terminal
   * @param {string} mode - 'fresh', 'continue', or 'resume'
   * @param {boolean} yolo - Use --dangerously-skip-permissions (default: true for Commander)
   */
  async startClaude(mode = 'fresh', yolo = true) {
    if (!this.session) {
      await this.start();
    }

    if (this.claudeStarted) {
      logger.warn('Claude already started, ignoring duplicate call');
      return { success: false, error: 'Already started' };
    }
    this.claudeStarted = true;

    let cmd = 'claude';
    if (mode === 'continue') {
      cmd += ' --continue';
    } else if (mode === 'resume') {
      cmd += ' --resume';
    }
    if (yolo) {
      cmd += ' --dangerously-skip-permissions';
    }

    logger.info('Starting Claude in Commander', { mode, yolo, cmd, daemonEnabled: this.daemonEnabled });
    const success = this.sendInput(cmd + '\n');
    logger.info('Sent claude command', { success, cmd });

    // Self-updating control surface pointer
    setTimeout(() => {
      try {
        const port = process.env.ORCHESTRATOR_PORT || 3000;
        const baseUrl = `http://localhost:${port}`;
        this.sendInput(
          `\n# Orchestrator control (self-updating)\n` +
          `# - Commands: curl -s ${baseUrl}/api/commander/capabilities | jq\n` +
          `# - Execute:  curl -s ${baseUrl}/api/commander/execute -H 'Content-Type: application/json' -d '{\"command\":\"...\",\"params\":{...}}'\n` +
          `# - Context:  curl -s ${baseUrl}/api/commander/context | jq\n` +
          `# - Inbox:    curl -s ${baseUrl}/api/commander/inbox | jq\n` +
          `# - Help:     curl -s ${baseUrl}/api/commander/prompt\n\n`
        );

        // Deliver any inbox events that arrived before Claude was ready
        setTimeout(() => this._deliverPending(), 2000);
      } catch {
        // ignore
      }
    }, 1200);

    return { success: true, message: `Starting Claude (${mode})` };
  }

  async gatherSessionsInfo() {
    try {
      const http = require('http');
      const port = process.env.ORCHESTRATOR_PORT || 3000;

      return new Promise((resolve) => {
        const req = http.get(`http://localhost:${port}/api/commander/sessions`, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const { sessions } = JSON.parse(data);
              if (!sessions || sessions.length === 0) {
                resolve('No active sessions.');
                return;
              }
              const summary = sessions.map(s =>
                `- ${s.id}: ${s.status} ${s.branch ? `(${s.branch})` : ''}`
              ).join('\n');
              resolve(summary);
            } catch {
              resolve('Could not fetch sessions.');
            }
          });
        });
        req.on('error', () => resolve('Could not fetch sessions.'));
        req.setTimeout(2000, () => {
          req.destroy();
          resolve('Sessions request timed out.');
        });
      });
    } catch {
      return 'Could not fetch sessions.';
    }
  }

  sendInput(input) {
    if (!this.session || !this.session.pty) {
      logger.warn('Cannot send input - Commander not running');
      return false;
    }

    const processedInput = process.platform === 'win32'
      ? input.replace(/\n/g, '\r\n')
      : input;

    this.session.pty.write(processedInput);
    return true;
  }

  stop() {
    // Pause daemon auto-restart during manual stop
    const wasDaemon = this.daemonEnabled;
    this.daemonEnabled = false;

    if (this.session && this.session.pty) {
      logger.info('Stopping Commander terminal');
      this.session.pty.kill();
      this.session = null;
      this.isReady = false;
    }

    // Restore daemon flag so watchdog can resume if needed
    this.daemonEnabled = wasDaemon;

    return { success: true };
  }

  async restart() {
    // Temporarily disable daemon to prevent double-restart race
    const wasDaemon = this.daemonEnabled;
    this.daemonEnabled = false;
    this._restartScheduled = false;

    this.stop();
    await new Promise(resolve => setTimeout(resolve, 500));
    const result = await this.start();

    this.daemonEnabled = wasDaemon;
    return result;
  }

  addToOutputBuffer(data) {
    const lines = data.split('\n');
    this.outputBuffer.push(...lines);
    if (this.outputBuffer.length > this.maxBufferLines) {
      this.outputBuffer = this.outputBuffer.slice(-this.maxBufferLines);
    }
  }

  getRecentOutput(lines = 50) {
    return this.outputBuffer.slice(-lines).join('\n');
  }

  clearBuffer() {
    this.outputBuffer = [];
    if (this.session) {
      this.session.buffer = '';
    }
  }

  getStatus() {
    return {
      running: !!this.session,
      ready: this.isReady,
      status: this.session?.status || 'stopped',
      cwd: COMMANDER_CWD,
      bufferLines: this.outputBuffer.length,
      lastActivity: this.session?.lastActivity || null,
      daemon: this.getDaemonStatus()
    };
  }

  resize(cols, rows) {
    if (this.session && this.session.pty) {
      this.session.pty.resize(cols, rows);
      return true;
    }
    return false;
  }

  sendToSession(sessionId, input) {
    if (!this.sessionManager || !this.sessionManager.sessions) {
      logger.warn('SessionManager not available');
      return false;
    }

    const session = this.sessionManager.sessions.get(sessionId);
    if (!session) {
      logger.warn('Target session not found', { sessionId });
      return false;
    }

    if (session.pty) {
      session.pty.write(input);
      return true;
    }

    return false;
  }

  listSessions() {
    if (!this.sessionManager || !this.sessionManager.sessions) {
      return [];
    }

    const sessions = [];
    for (const [id, session] of this.sessionManager.sessions) {
      sessions.push({
        id: session.id,
        type: session.type,
        status: session.status,
        branch: session.branch,
        worktreeId: session.worktreeId
      });
    }
    return sessions;
  }
}

module.exports = { CommanderService };
