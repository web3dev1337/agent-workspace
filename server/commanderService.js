/**
 * Commander Service - Top-Level AI as a Claude Code Terminal
 *
 * Instead of calling the Anthropic API, Commander IS a Claude Code terminal
 * running from a central location. This is consistent with how all other
 * worktree terminals work - they're all Claude Code instances.
 */

const pty = require('node-pty');
const fs = require('fs');
const path = require('path');
const os = require('os');
const winston = require('winston');
const { augmentProcessEnv, buildPowerShellArgs } = require('./utils/processUtils');

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
// In packaged mode (__dirname is inside resources/backend/server), use ORCHESTRATOR_DATA_DIR so
// desktop users can edit their Commander CLAUDE.md / AGENTS.md without touching app resources.
const defaultCwd = path.resolve(__dirname, '..');
const isPackaged = defaultCwd.includes('resources') && defaultCwd.includes('backend');
const packagedDataDirRaw = String(process.env.ORCHESTRATOR_DATA_DIR || '').trim();
const packagedDataDir = (() => {
  if (!packagedDataDirRaw) return null;
  try { return path.resolve(packagedDataDirRaw); } catch { return packagedDataDirRaw; }
})();
const packagedCommanderDir = packagedDataDir ? path.join(packagedDataDir, 'commander') : null;
const COMMANDER_CWD = process.env.COMMANDER_CWD || (isPackaged ? (packagedCommanderDir || (process.env.HOME || process.env.USERPROFILE || defaultCwd)) : defaultCwd);
const TRUST_PROMPT_BUFFER_CHARS = 6000;
const TRUST_PROMPT_MAX_WAIT_MS = 15000;

function seedCommanderInstructionsIfNeeded() {
  if (!isPackaged) return;
  if (process.env.COMMANDER_CWD) return;
  if (!packagedCommanderDir) return;

  try {
    fs.mkdirSync(packagedCommanderDir, { recursive: true });
  } catch {
    return;
  }

  const templateCandidates = [
    path.join(defaultCwd, 'COMMANDER_CLAUDE.md'),
    path.join(defaultCwd, 'CLAUDE.md'),
    path.join(defaultCwd, 'AGENTS.md')
  ];
  const templatePath = templateCandidates.find((candidate) => {
    try { return fs.existsSync(candidate); } catch { return false; }
  });

  const fallback = [
    '# Commander',
    '',
    'You are Commander (Claude or Codex). Control the Orchestrator via its HTTP APIs.',
    '',
    'Base URL:',
    '  http://${ORCHESTRATOR_HOST:-127.0.0.1}:${ORCHESTRATOR_PORT:-3000}',
    '',
    'If AUTH_TOKEN is set, include:',
    '  -H "X-Auth-Token: $AUTH_TOKEN"',
    '',
    'Self-updating help prompt:',
    '  GET /api/commander/prompt',
    ''
  ].join('\n');

  const writeFromTemplateOrFallback = (filename) => {
    const destPath = path.join(packagedCommanderDir, filename);
    try {
      if (fs.existsSync(destPath)) return;
    } catch {
      return;
    }

    if (templatePath) {
      try {
        fs.copyFileSync(templatePath, destPath);
        return;
      } catch {
        // fall back to inline content
      }
    }

    try {
      fs.writeFileSync(destPath, fallback, 'utf8');
    } catch {
      // ignore
    }
  };

  writeFromTemplateOrFallback('COMMANDER_CLAUDE.md');
  writeFromTemplateOrFallback('CLAUDE.md');
  writeFromTemplateOrFallback('AGENTS.md');
}

class CommanderService {
  constructor(options = {}) {
    this.io = options.io;
    this.sessionManager = options.sessionManager;
    this.session = null;
    this.outputBuffer = '';
    this.maxBufferChars = 200000;
    this.isReady = false;
    this.claudeStarted = false; // Track if Claude has been auto-started
    this.claudeLaunchState = null;
  }

  static getInstance(options) {
    if (!CommanderService.instance) {
      CommanderService.instance = new CommanderService(options);
    }
    return CommanderService.instance;
  }

  /**
   * Start the Commander terminal session
   * This spawns a Claude Code instance from the orchestrator directory
   */
  async start() {
    if (this.session) {
      logger.warn('Commander session already running');
      return { success: false, error: 'Already running' };
    }

    seedCommanderInstructionsIfNeeded();
    logger.info('Starting Commander terminal', { cwd: COMMANDER_CWD });

    try {
      // Detect shell based on platform
      const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
      const shellArgs = process.platform === 'win32'
        ? buildPowerShellArgs(null, { keepOpen: true, hideWindow: false })
        : [];

      const env = process.platform === 'win32'
        ? augmentProcessEnv({
            ...process.env,
            HOME: HOME_DIR,
            TERM: 'xterm-color'
          })
        : {
            ...process.env,
            PATH: `${HOME_DIR}/.nvm/versions/node/v22.16.0/bin:/snap/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}`,
            HOME: HOME_DIR,
            TERM: 'xterm-color'
          };

      const ptyOptions = {
        name: 'xterm-color',
        cols: 120,
        rows: 40,
        cwd: COMMANDER_CWD,
        env
      };

      if (process.platform === 'win32') {
        ptyOptions.useConpty = true;
      }

      // Spawn Claude Code terminal
      const ptyProcess = pty.spawn(shell, shellArgs, ptyOptions);

      this.session = {
        id: 'commander',
        pty: ptyProcess,
        type: 'commander',
        status: 'starting',
        buffer: '',
        lastActivity: Date.now()
      };

      // Handle output
      ptyProcess.onData((data) => {
        // Guard against data arriving after stop() nullifies session
        if (!this.session) return;

        this.session.buffer += data;
        this.session.lastActivity = Date.now();

        // Keep buffer manageable
        this.addToOutputBuffer(data);
        this.handleClaudeLaunchOutput(data);

        // Emit to Commander panel
        if (this.io) {
          this.io.emit('commander-output', { data });
        }

        // Detect when shell is ready
        if (data.includes('>') || data.includes('$')) {
          if (!this.isReady) {
            this.session.status = 'ready';
            this.isReady = true;

            // Auto-start Claude when shell becomes ready (only once)
            if (!this.claudeStarted) {
              setTimeout(() => {
                if (!this.claudeStarted) {  // Double-check before calling
                  this.startClaude('fresh', true);
                }
              }, 1000);
            }
          }
        }
      });

      // Handle exit
      ptyProcess.onExit(({ exitCode }) => {
        logger.info('Commander terminal exited', { exitCode });
        this.session = null;
        this.isReady = false;
        this.claudeStarted = false; // Reset for next start
        this.resetClaudeLaunchState();
        if (this.io) {
          this.io.emit('commander-exit', { exitCode });
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

    // Prevent duplicate calls
    if (this.claudeStarted) {
      logger.warn('Claude already started, ignoring duplicate call');
      return { success: false, error: 'Already started' };
    }
    this.claudeStarted = true;

    // Build the claude command
    let cmd = 'claude';

    // Add flags based on mode
    if (mode === 'continue') {
      cmd += ' --continue';
    } else if (mode === 'resume') {
      cmd += ' --resume';
    }

    // Commander runs in YOLO mode by default for orchestration capabilities
    if (yolo) {
      cmd += ' --dangerously-skip-permissions';
    }

    logger.info('Starting Claude in Commander', { mode, yolo, cmd, platform: process.platform });
    this.beginClaudeLaunch({ expectTrustPrompt: yolo });
    const success = this.sendInput(cmd + '\n', { bypassLaunchQueue: true });
    logger.info('Sent claude command', { success, cmd });

    // If Commander has no local instructions file, provide a stable, self-updating control surface pointer
    // so it can recover without manual prompt edits when new commands are added.
    setTimeout(() => {
      try {
        const hasLocalInstructions =
          fs.existsSync(path.join(COMMANDER_CWD, 'CLAUDE.md'))
          || fs.existsSync(path.join(COMMANDER_CWD, 'AGENTS.md'))
          || fs.existsSync(path.join(COMMANDER_CWD, 'COMMANDER_CLAUDE.md'));
        if (hasLocalInstructions) return;

        const host = process.env.ORCHESTRATOR_HOST || '127.0.0.1';
        const port = process.env.ORCHESTRATOR_PORT || 3000;
        const baseUrl = `http://${host}:${port}`;
        const authHint = process.env.AUTH_TOKEN
          ? ' -H "X-Auth-Token: $AUTH_TOKEN"'
          : '';
        this.sendInput(
          `\n# Orchestrator control (self-updating)\n` +
          `# - Commands: curl -sS "${baseUrl}/api/commander/capabilities"${authHint} | jq\n` +
          `# - Execute:  curl -sS "${baseUrl}/api/commander/execute"${authHint} -H "Content-Type: application/json" -d '{\"command\":\"...\",\"params\":{...}}'\n` +
          `# - Context:  curl -sS "${baseUrl}/api/commander/context"${authHint} | jq\n` +
          `# - Help:     curl -sS "${baseUrl}/api/commander/prompt"${authHint}\n\n`
        );
      } catch {
        // ignore
      }
    }, 1200);

    return { success: true, message: `Starting Claude (${mode})` };
  }

  /**
   * Gather current sessions info for Commander context
   */
  async gatherSessionsInfo() {
    try {
      const http = require('http');
      const host = process.env.ORCHESTRATOR_HOST || '127.0.0.1';
      const port = process.env.ORCHESTRATOR_PORT || 3000;
      const authToken = String(process.env.AUTH_TOKEN || '').trim();

      return new Promise((resolve) => {
        const req = http.get({
          hostname: host,
          port,
          path: '/api/commander/sessions',
          headers: authToken ? { 'X-Auth-Token': authToken } : undefined
        }, (res) => {
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

  /**
   * Send input to the Commander terminal
   */
  sendInput(input, options = {}) {
    if (!this.session || !this.session.pty) {
      logger.warn('Cannot send input - Commander not running');
      return false;
    }

    const text = String(input ?? '');

    if (this.shouldQueueLaunchInput(options)) {
      this.claudeLaunchState.queuedInputs.push(text);
      return true;
    }

    // On Windows, convert \n to \r\n for proper line endings
    const processedInput = process.platform === 'win32'
      ? text.replace(/\n/g, '\r\n')
      : text;

    this.session.pty.write(processedInput);
    return true;
  }

  /**
   * Stop the Commander terminal
   */
  stop() {
    if (this.session && this.session.pty) {
      logger.info('Stopping Commander terminal');
      this.session.pty.kill();
      this.session = null;
      this.isReady = false;
      this.claudeStarted = false;
      this.resetClaudeLaunchState();
      return { success: true };
    }
    return { success: false, error: 'Not running' };
  }

  /**
   * Restart the Commander terminal
   */
  async restart() {
    this.stop();
    await new Promise(resolve => setTimeout(resolve, 500));
    return await this.start();
  }

  /**
   * Add data to the output buffer (for history)
   */
  addToOutputBuffer(data) {
    this.outputBuffer += String(data || '');
    if (this.outputBuffer.length > this.maxBufferChars) {
      this.outputBuffer = this.outputBuffer.slice(-this.maxBufferChars);
    }
  }

  /**
   * Get recent output from the Commander
   */
  getRecentOutput(lines = 50) {
    const limit = Number(lines);
    if (!Number.isFinite(limit) || limit <= 0) {
      return this.outputBuffer;
    }
    return this.outputBuffer.split('\n').slice(-limit).join('\n');
  }

  /**
   * Clear the output buffer
   */
  clearBuffer() {
    this.outputBuffer = '';
    if (this.session) {
      this.session.buffer = '';
    }
  }

  /**
   * Get Commander status
   */
  getStatus() {
    return {
      running: !!this.session,
      ready: this.isReady,
      status: this.session?.status || 'stopped',
      cwd: COMMANDER_CWD,
      bufferLines: this.outputBuffer ? this.outputBuffer.split('\n').length : 0,
      lastActivity: this.session?.lastActivity || null
    };
  }

  /**
   * Resize the Commander terminal
   */
  resize(cols, rows) {
    if (this.session && this.session.pty) {
      this.session.pty.resize(cols, rows);
      return true;
    }
    return false;
  }

  /**
   * Send a command to a worktree terminal via the orchestrator
   * This allows Commander to coordinate with other sessions
   */
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

    // Use pty.write directly since sendInput may not exist
    if (session.pty) {
      session.pty.write(input);
      return true;
    }

    return false;
  }

  /**
   * List all active sessions (for Commander to see)
   */
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

  stripControlSequences(text) {
    return String(text || '')
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
      .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
      .replace(/\x1b[()][A-Za-z0-9]/g, '');
  }

  beginClaudeLaunch({ expectTrustPrompt = false } = {}) {
    this.resetClaudeLaunchState();
    this.claudeLaunchState = {
      startedAt: Date.now(),
      expectTrustPrompt: !!expectTrustPrompt,
      trustPromptAccepted: false,
      ready: false,
      queuedInputs: [],
      recentOutput: '',
      forceFlushTimer: setTimeout(() => {
        this.flushQueuedLaunchInputs();
      }, TRUST_PROMPT_MAX_WAIT_MS)
    };
  }

  resetClaudeLaunchState() {
    if (!this.claudeLaunchState) return;
    if (this.claudeLaunchState.forceFlushTimer) {
      clearTimeout(this.claudeLaunchState.forceFlushTimer);
    }
    if (this.claudeLaunchState.readyFlushTimer) {
      clearTimeout(this.claudeLaunchState.readyFlushTimer);
    }
    this.claudeLaunchState = null;
  }

  shouldQueueLaunchInput(options = {}) {
    if (options.bypassLaunchQueue) return false;
    const launch = this.claudeLaunchState;
    if (!launch) return false;
    if (launch.ready) return false;
    if (!this.claudeStarted) return false;
    return true;
  }

  handleClaudeLaunchOutput(data) {
    const launch = this.claudeLaunchState;
    if (!launch || launch.ready) return;

    const normalized = this.stripControlSequences(data).toLowerCase();
    if (normalized) {
      launch.recentOutput = `${launch.recentOutput}${normalized}`.slice(-TRUST_PROMPT_BUFFER_CHARS);
    }

    if (launch.expectTrustPrompt
      && !launch.trustPromptAccepted
      && this.matchesClaudeTrustPrompt(launch.recentOutput)
    ) {
      launch.trustPromptAccepted = true;
      this.writeRawInput('1\r');
      launch.readyFlushTimer = setTimeout(() => {
        this.flushQueuedLaunchInputs();
      }, 1200);
      return;
    }

    if ((!launch.expectTrustPrompt || launch.trustPromptAccepted) && this.matchesClaudeReadyPrompt(launch.recentOutput)) {
      this.flushQueuedLaunchInputs();
    }
  }

  matchesClaudeTrustPrompt(text) {
    const normalized = String(text || '');
    return normalized.includes('quick safety check')
      && normalized.includes('trust this folder')
      && normalized.includes('yes, i trust this folder');
  }

  matchesClaudeReadyPrompt(text) {
    const normalized = String(text || '');
    return normalized.includes('welcome to claude code')
      && normalized.includes('? for shortcuts');
  }

  flushQueuedLaunchInputs() {
    const launch = this.claudeLaunchState;
    if (!launch || launch.ready) return;

    launch.ready = true;
    const queued = Array.isArray(launch.queuedInputs) ? launch.queuedInputs.splice(0) : [];
    this.resetClaudeLaunchState();

    for (const chunk of queued) {
      this.sendInput(chunk, { bypassLaunchQueue: true });
    }
  }

  writeRawInput(input) {
    if (!this.session?.pty) return false;
    const payload = process.platform === 'win32'
      ? String(input || '').replace(/\n/g, '\r\n')
      : String(input || '');
    this.session.pty.write(payload);
    return true;
  }
}

module.exports = { CommanderService };
