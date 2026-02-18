/**
 * Commander Service - Top-Level AI as a headless Claude Code process
 *
 * Primary mode (default): headless CLI daemon via CommanderDaemon.
 *   - Spawns `claude -p --output-format stream-json` per inbox batch
 *   - Uses --resume <session_id> for conversation continuity
 *   - Claude Code's built-in auto-compact handles context management
 *   - No API key management; no pty; clean stdin/stdout
 *
 * Fallback mode (COMMANDER_MODE=pty): original pty terminal approach.
 *   - Used if claude CLI is not found or user prefers the visible terminal
 */

const pty = require('node-pty');
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');
const winston = require('winston');
const { CommanderDaemon } = require('./commanderDaemon');

const HOME_DIR = process.env.HOME || os.homedir();
const COMMANDER_CWD = process.env.COMMANDER_CWD || path.resolve(__dirname, '..');
const USE_HEADLESS = (process.env.COMMANDER_MODE || 'headless') !== 'pty';

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

// Watchdog backoff for pty mode
const BACKOFF_STEPS_MS = [15_000, 30_000, 60_000, 120_000, 240_000];
const WATCHDOG_INTERVAL_MS = 10_000;

class CommanderService {
  constructor(options = {}) {
    this.io = options.io;
    this.sessionManager = options.sessionManager;

    // Headless daemon delegate
    this._daemon = USE_HEADLESS
      ? CommanderDaemon.getInstance({ io: this.io, sessionManager: this.sessionManager })
      : null;

    // ── pty-mode state (only used when COMMANDER_MODE=pty) ──
    this.session = null;
    this.outputBuffer = [];
    this.maxBufferLines = 500;
    this.isReady = false;
    this.claudeStarted = false;
    this.daemonEnabled = false;
    this.daemonRunning = false;
    this._watchdogTimer = null;
    this._backoffIndex = 0;
    this._restartCount = 0;
    this._lastCrashAt = null;
    this._restartScheduled = false;

    // Shared inbox (used by headless mode only; pty mode has its own delivery)
    this._inbox = this._daemon ? null : [];
    this._maxInboxSize = 200;
  }

  static getInstance(options) {
    if (!CommanderService.instance) {
      CommanderService.instance = new CommanderService(options);
    }
    return CommanderService.instance;
  }

  // ─── Daemon lifecycle (headless mode) ───────────────────────────────────────

  async startDaemon() {
    if (USE_HEADLESS) {
      return this._daemon.start();
    }
    // pty mode watchdog
    if (this.daemonEnabled) return;
    this.daemonEnabled = true;
    this.daemonRunning = true;
    logger.info('[commander] Starting pty daemon');
    await this._daemonBoot();
    this._scheduleWatchdog();
    this._emitDaemonStatus();
  }

  stopDaemon() {
    if (USE_HEADLESS) {
      return this._daemon.stop();
    }
    this.daemonEnabled = false;
    this.daemonRunning = false;
    if (this._watchdogTimer) clearTimeout(this._watchdogTimer);
    logger.info('[commander] pty daemon stopped');
    this._emitDaemonStatus();
  }

  getDaemonStatus() {
    if (USE_HEADLESS) {
      return this._daemon.getStatus();
    }
    return {
      mode: 'pty',
      daemonEnabled: this.daemonEnabled,
      daemonRunning: this.daemonRunning,
      running: !!this.session,
      ready: this.isReady,
      restartCount: this._restartCount,
      lastCrashAt: this._lastCrashAt,
      inboxSize: this._inbox?.length ?? 0
    };
  }

  // ─── Inbox (delegates to daemon in headless mode) ────────────────────────────

  enqueueEvent(event) {
    if (USE_HEADLESS) return this._daemon.enqueueEvent(event);

    // pty inbox
    if (this._inbox.length >= this._maxInboxSize) this._inbox.shift();
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
    if (this.io) {
      this.io.emit('commander-inbox-update', { action: 'added', event: queued, total: this._inbox.length });
    }
    this._deliverPending();
    return queued;
  }

  dismissEvent(id) {
    if (USE_HEADLESS) return this._daemon.dismissEvent(id);
    const idx = this._inbox.findIndex(e => e.id === id);
    if (idx === -1) return false;
    const [removed] = this._inbox.splice(idx, 1);
    if (this.io) {
      this.io.emit('commander-inbox-update', { action: 'dismissed', event: removed, total: this._inbox.length });
    }
    return true;
  }

  getInbox(status = null) {
    if (USE_HEADLESS) return this._daemon.getInbox(status);
    if (!status) return [...this._inbox];
    return this._inbox.filter(e => e.status === status);
  }

  // ─── Terminal ops (pty mode only; headless returns stubs) ───────────────────

  async start() {
    if (USE_HEADLESS) {
      return this._daemon.start();
    }
    return this._ptyStart();
  }

  async startClaude(mode = 'fresh', yolo = true) {
    if (USE_HEADLESS) {
      return { success: false, error: 'Not applicable in headless mode' };
    }
    return this._ptyStartClaude(mode, yolo);
  }

  stop() {
    if (USE_HEADLESS) {
      return this._daemon.stop();
    }
    return this._ptyStop();
  }

  async restart() {
    if (USE_HEADLESS) {
      return this._daemon.restart();
    }
    return this._ptyRestart();
  }

  sendInput(input) {
    if (USE_HEADLESS) {
      logger.warn('[commander] sendInput called in headless mode — use inbox instead');
      return false;
    }
    return this._ptySendInput(input);
  }

  getStatus() {
    if (USE_HEADLESS) {
      const d = this._daemon.getStatus();
      return {
        ...d,
        // aliases for legacy UI compatibility
        running: d.running,
        ready: d.initialized,
        status: d.running ? 'running' : 'stopped',
        cwd: COMMANDER_CWD,
        bufferLines: 0,
        lastActivity: null
      };
    }
    return {
      mode: 'pty',
      running: !!this.session,
      ready: this.isReady,
      status: this.session?.status || 'stopped',
      cwd: COMMANDER_CWD,
      bufferLines: this.outputBuffer.length,
      lastActivity: this.session?.lastActivity || null,
      daemon: this.getDaemonStatus()
    };
  }

  getRecentOutput(lines = 50) {
    return this.outputBuffer.slice(-lines).join('\n');
  }

  clearBuffer() {
    this.outputBuffer = [];
    if (this.session) this.session.buffer = '';
  }

  resize(cols, rows) {
    if (USE_HEADLESS) return false;
    if (this.session?.pty) {
      this.session.pty.resize(cols, rows);
      return true;
    }
    return false;
  }

  sendToSession(sessionId, input) {
    if (!this.sessionManager?.sessions) return false;
    const session = this.sessionManager.sessions.get(sessionId);
    if (session?.pty) {
      session.pty.write(input);
      return true;
    }
    return false;
  }

  listSessions() {
    if (!this.sessionManager?.sessions) return [];
    const sessions = [];
    for (const [, session] of this.sessionManager.sessions) {
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
              if (!sessions?.length) { resolve('No active sessions.'); return; }
              resolve(sessions.map(s => `- ${s.id}: ${s.status} ${s.branch ? `(${s.branch})` : ''}`).join('\n'));
            } catch { resolve('Could not fetch sessions.'); }
          });
        });
        req.on('error', () => resolve('Could not fetch sessions.'));
        req.setTimeout(2000, () => { req.destroy(); resolve('Timed out.'); });
      });
    } catch { return 'Could not fetch sessions.'; }
  }

  // ─── pty-mode internals ─────────────────────────────────────────────────────

  async _ptyStart() {
    if (this.session) return { success: false, error: 'Already running' };
    try {
      const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
      const shellArgs = process.platform === 'win32' ? ['-NoExit'] : [];
      const ptyProcess = pty.spawn(shell, shellArgs, {
        name: 'xterm-color',
        cols: 120, rows: 40,
        cwd: COMMANDER_CWD,
        env: process.platform === 'win32' ? { ...process.env } : {
          ...process.env,
          PATH: `${HOME_DIR}/.nvm/versions/node/v22.16.0/bin:/snap/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}`,
          HOME: HOME_DIR,
          TERM: 'xterm-color'
        }
      });

      this.session = { id: 'commander', pty: ptyProcess, type: 'commander', status: 'starting', buffer: '', lastActivity: Date.now() };

      ptyProcess.onData((data) => {
        if (!this.session) return;
        this.session.buffer += data;
        this.session.lastActivity = Date.now();
        this.addToOutputBuffer(data);
        if (this.io) this.io.emit('commander-output', { data });
        if ((data.includes('>') || data.includes('$')) && !this.isReady) {
          this.session.status = 'ready';
          this.isReady = true;
          if (!this.claudeStarted) {
            setTimeout(() => { if (!this.claudeStarted) this._ptyStartClaude('fresh', true); }, 1000);
          }
        }
      });

      ptyProcess.onExit(({ exitCode }) => {
        logger.info('Commander pty exited', { exitCode, daemonEnabled: this.daemonEnabled });
        this.session = null; this.isReady = false; this.claudeStarted = false;
        if (this.io) this.io.emit('commander-exit', { exitCode });
        if (this.daemonEnabled && !this._restartScheduled) this._scheduleRestart();
      });

      return { success: true };
    } catch (error) {
      logger.error('Failed to start pty', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  async _ptyStartClaude(mode = 'fresh', yolo = true) {
    if (!this.session) await this._ptyStart();
    if (this.claudeStarted) return { success: false, error: 'Already started' };
    this.claudeStarted = true;
    let cmd = 'claude';
    if (mode === 'continue') cmd += ' --continue';
    else if (mode === 'resume') cmd += ' --resume';
    if (yolo) cmd += ' --dangerously-skip-permissions';
    this._ptySendInput(cmd + '\n');
    return { success: true };
  }

  _ptyStop() {
    const wasDaemon = this.daemonEnabled;
    this.daemonEnabled = false;
    if (this.session?.pty) {
      this.session.pty.kill();
      this.session = null; this.isReady = false;
    }
    this.daemonEnabled = wasDaemon;
    return { success: true };
  }

  async _ptyRestart() {
    const wasDaemon = this.daemonEnabled;
    this.daemonEnabled = false;
    this._restartScheduled = false;
    this._ptyStop();
    await new Promise(r => setTimeout(r, 500));
    const result = await this._ptyStart();
    this.daemonEnabled = wasDaemon;
    return result;
  }

  _ptySendInput(input) {
    if (!this.session?.pty) return false;
    const processed = process.platform === 'win32' ? input.replace(/\n/g, '\r\n') : input;
    this.session.pty.write(processed);
    return true;
  }

  _deliverPending() {
    if (!this.isReady || !this.claudeStarted) return;
    const pending = this._inbox?.filter(e => e.status === 'pending') || [];
    if (!pending.length) return;
    pending.forEach(e => { e.status = 'delivered'; });
    const lines = pending.map((e, i) => `${i + 1}. [${e.source}/${e.type}] ${e.payload}`).join('\n');
    this._ptySendInput((pending.length === 1 ? `📬 Inbox:\n${lines}` : `📬 ${pending.length} inbox events:\n${lines}`) + '\r');
  }

  addToOutputBuffer(data) {
    const lines = data.split('\n');
    this.outputBuffer.push(...lines);
    if (this.outputBuffer.length > this.maxBufferLines) {
      this.outputBuffer = this.outputBuffer.slice(-this.maxBufferLines);
    }
  }

  // ─── pty watchdog ───────────────────────────────────────────────────────────

  async _daemonBoot() {
    if (this.session) return;
    const isRestart = this._restartCount > 0;
    await this._ptyStart();
    await new Promise(r => setTimeout(r, 1000));
    await this._ptyStartClaude(isRestart ? 'continue' : 'fresh', true);
    this._backoffIndex = 0;
    this._restartScheduled = false;
  }

  _scheduleWatchdog() {
    if (!this.daemonRunning) return;
    this._watchdogTimer = setTimeout(() => this._watchdogTick(), WATCHDOG_INTERVAL_MS);
  }

  async _watchdogTick() {
    if (!this.daemonRunning) return;
    if (!this.session && !this._restartScheduled) this._scheduleRestart();
    this._scheduleWatchdog();
  }

  _scheduleRestart() {
    if (this._restartScheduled || !this.daemonEnabled) return;
    this._restartScheduled = true;
    this._lastCrashAt = new Date().toISOString();
    const delay = BACKOFF_STEPS_MS[Math.min(this._backoffIndex, BACKOFF_STEPS_MS.length - 1)];
    this._backoffIndex = Math.min(this._backoffIndex + 1, BACKOFF_STEPS_MS.length - 1);
    this._restartCount++;
    if (this.io) {
      this.io.emit('commander-daemon-restarting', { delayMs: delay, restartCount: this._restartCount });
    }
    setTimeout(async () => {
      this._restartScheduled = false;
      if (this.daemonEnabled) { await this._daemonBoot(); this._emitDaemonStatus(); }
    }, delay);
  }

  _emitDaemonStatus() {
    if (this.io) this.io.emit('commander-daemon-status', this.getDaemonStatus());
  }
}

module.exports = { CommanderService };
