/**
 * Commander Service - Top-Level AI as a Claude Code Terminal
 *
 * Instead of calling the Anthropic API, Commander IS a Claude Code terminal
 * running from a central location. This is consistent with how all other
 * worktree terminals work - they're all Claude Code instances.
 */

const pty = require('node-pty');
const path = require('path');
const os = require('os');
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

class CommanderService {
  constructor(options = {}) {
    this.io = options.io;
    this.sessionManager = options.sessionManager;
    this.session = null;
    this.outputBuffer = [];
    this.maxBufferLines = 500;
    this.isReady = false;
    this.claudeStarted = false; // Track if Claude has been auto-started
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

    logger.info('Starting Commander terminal', { cwd: COMMANDER_CWD });

    try {
      // Detect shell based on platform
      const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
      const shellArgs = process.platform === 'win32' ? ['-NoExit'] : [];

      const env = process.platform === 'win32'
        ? {
            ...process.env,
            HOME: HOME_DIR,
            TERM: 'xterm-color'
          }
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
    const success = this.sendInput(cmd + '\n');
    logger.info('Sent claude command', { success, cmd });

    // Always provide a stable, self-updating control surface pointer so Commander
    // never needs manual prompt edits when new commands are added.
    setTimeout(() => {
      try {
        const port = process.env.ORCHESTRATOR_PORT || 3000;
        const baseUrl = `http://localhost:${port}`;
        this.sendInput(
          `\n# Orchestrator control (self-updating)\n` +
          `# - Commands: curl -s ${baseUrl}/api/commander/capabilities | jq\n` +
          `# - Execute:  curl -s ${baseUrl}/api/commander/execute -H 'Content-Type: application/json' -d '{\"command\":\"...\",\"params\":{...}}'\n` +
          `# - Context:  curl -s ${baseUrl}/api/commander/context | jq\n` +
          `# - Help:     curl -s ${baseUrl}/api/commander/prompt\n\n`
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

  /**
   * Send input to the Commander terminal
   */
  sendInput(input) {
    if (!this.session || !this.session.pty) {
      logger.warn('Cannot send input - Commander not running');
      return false;
    }

    // On Windows, convert \n to \r\n for proper line endings
    const processedInput = process.platform === 'win32'
      ? input.replace(/\n/g, '\r\n')
      : input;

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
    // Split into lines and add
    const lines = data.split('\n');
    this.outputBuffer.push(...lines);

    // Trim buffer if too large
    if (this.outputBuffer.length > this.maxBufferLines) {
      this.outputBuffer = this.outputBuffer.slice(-this.maxBufferLines);
    }
  }

  /**
   * Get recent output from the Commander
   */
  getRecentOutput(lines = 50) {
    return this.outputBuffer.slice(-lines).join('\n');
  }

  /**
   * Clear the output buffer
   */
  clearBuffer() {
    this.outputBuffer = [];
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
      bufferLines: this.outputBuffer.length,
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
}

module.exports = { CommanderService };
