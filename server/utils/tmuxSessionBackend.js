'use strict';

const { execFileSync } = require('child_process');

// tmux-backed session persistence (issue #1025).
//
// Terminals run inside per-session tmux sessions on a dedicated socket, so the
// PTY the orchestrator owns is only a tmux CLIENT. When the app server restarts
// (nodemon reload, version update, crash) the panes keep running under the tmux
// server, and the next createSession() for the same id re-attaches via
// `new-session -A` — live agents survive the restart.
//
// Boundaries, on purpose:
// - Survives app-server restarts only; a reboot/`wsl --shutdown` still ends the
//   tmux server (transcript resume is the recovery path for that).
// - Windows and tmux-less installs fail closed via isAvailable(); the session
//   manager falls back to direct node-pty spawning (previous behavior).
// - Each orchestrator instance uses its own socket (name includes the server
//   port) so dev/prod instances can never collide on session names.

const SESSION_NAME_UNSAFE = /[^A-Za-z0-9_-]/g;

// Quote a value for the shell-command string tmux hands to `$SHELL -c`.
const shellQuote = (value) => {
  const s = String(value ?? '');
  if (s === '') return "''";
  if (/^[A-Za-z0-9_\/.:=,+@%-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
};

class TmuxSessionBackend {
  constructor({ socketName, logger = console, execImpl = execFileSync, platform = process.platform, baseEnv = process.env } = {}) {
    if (!socketName) throw new Error('TmuxSessionBackend requires a socketName');
    this.socketName = socketName;
    this.logger = logger;
    this.exec = execImpl;
    this.platform = platform;
    this.baseEnv = baseEnv;
    this._available = null;
    this._configured = false;
  }

  // Environment for every tmux invocation. The tmux SERVER inherits the env of
  // the command that first starts it, and every pane inherits from the server —
  // this is the one choke point where nested-session markers must be scrubbed.
  // Without it, an orchestrator launched from inside a Claude session would
  // leak CLAUDECODE into every terminal and trip the CLI's nesting guard; a
  // leaked TMUX var would make the client refuse to start at all.
  buildTmuxEnv() {
    const env = { ...this.baseEnv };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    delete env.TMUX;
    delete env.TMUX_PANE;
    return env;
  }

  run(args, opts = {}) {
    return this.exec('tmux', ['-L', this.socketName, ...args], {
      env: this.buildTmuxEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
      ...opts
    });
  }

  isAvailable() {
    if (this.platform === 'win32') return false;
    if (this._available !== null) return this._available;
    try {
      this.exec('tmux', ['-V'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 3000 });
      this._available = true;
    } catch (error) {
      this._available = false;
      this.logger.info?.('tmux not available — session persistence disabled', { error: error.message });
    }
    return this._available;
  }

  // One-time per-socket server config. The options make embedded panes behave
  // like plain terminals: no status bar, no prefix key, no tmux-level mouse
  // handling (a pane's own mouse-mode requests still pass through), modest
  // scrollback (xterm.js keeps its own client-side), and windows sized to the
  // most recently attached client.
  ensureConfigured() {
    if (this._configured) return true;
    try {
      this.run(['start-server']);
    } catch (error) {
      this.logger.error?.('Failed to start tmux server for session persistence', { socket: this.socketName, error: error.message });
      return false;
    }
    const options = [
      ['set', '-g', 'status', 'off'],
      ['set', '-g', 'prefix', 'None'],
      ['set', '-g', 'mouse', 'off'],
      ['set', '-g', 'history-limit', '20000'],
      ['set', '-g', 'default-terminal', 'xterm-256color'],
      ['set', '-g', 'escape-time', '25'],
      ['set', '-g', 'window-size', 'latest'],
      ['set', '-g', 'allow-rename', 'off'],
      ['set', '-g', 'set-titles', 'off'],
      // Belt-and-braces on top of buildTmuxEnv: never hand these to panes.
      ['set-environment', '-g', '-r', 'CLAUDECODE'],
      ['set-environment', '-g', '-r', 'CLAUDE_CODE_ENTRYPOINT']
    ];
    for (const args of options) {
      try {
        this.run(args);
      } catch {
        // e.g. set-environment -r on a variable that was never set — harmless
      }
    }
    this._configured = true;
    return true;
  }

  sessionName(sessionId) {
    return String(sessionId || '').replace(SESSION_NAME_UNSAFE, '_') || 'session';
  }

  // "=" forces an exact-name match; without it tmux prefix-matches targets,
  // which would make "work1" resolve to "work1-claude".
  target(sessionId) {
    return `=${this.sessionName(sessionId)}`;
  }

  hasSession(sessionId) {
    try {
      this.run(['has-session', '-t', this.target(sessionId)]);
      return true;
    } catch {
      return false;
    }
  }

  listSessionNames() {
    try {
      const out = this.run(['list-sessions', '-F', '#{session_name}']);
      return String(out || '').split('\n').map((s) => s.trim()).filter(Boolean);
    } catch {
      return []; // no server running / no sessions
    }
  }

  // Argv for node-pty. `new-session -A` attaches when the session already
  // exists (server restart) and creates it otherwise; on attach the trailing
  // shell-command is ignored — exactly the adoption semantic we want.
  buildSpawnCommand({ sessionId, command, args = [], cwd }) {
    const name = this.sessionName(sessionId);
    const shellCommand = [command, ...args].map(shellQuote).join(' ');
    const tmuxArgs = ['-L', this.socketName, 'new-session', '-A', '-s', name];
    if (cwd) tmuxArgs.push('-c', cwd);
    tmuxArgs.push(shellCommand);
    return { command: 'tmux', args: tmuxArgs, name };
  }

  killSession(sessionId) {
    try {
      this.run(['kill-session', '-t', this.target(sessionId)]);
      return true;
    } catch {
      return false;
    }
  }

  // Pid of the process actually running inside the session's pane (a child of
  // the tmux server, NOT of the client pty the orchestrator holds).
  panePid(sessionId) {
    try {
      const out = this.run(['list-panes', '-t', this.target(sessionId), '-F', '#{pane_pid}']);
      const pid = parseInt(String(out || '').trim().split('\n')[0], 10);
      return Number.isFinite(pid) && pid > 0 ? pid : null;
    } catch {
      return null;
    }
  }

  // Scrollback (with escape sequences, joined wrapped lines) for buffer
  // backfill when adopting a surviving session after a server restart.
  capturePane(sessionId, lines = 2000) {
    try {
      return String(this.run([
        'capture-pane', '-p', '-e', '-J',
        '-t', this.target(sessionId),
        '-S', `-${Math.max(1, Math.floor(lines))}`
      ]) || '');
    } catch {
      return '';
    }
  }
}

module.exports = { TmuxSessionBackend, shellQuote };
