/**
 * CommandRegistry - Central registry for all Commander-executable commands
 *
 * Design principles:
 * 1. Commands are SEMANTIC (describe intent, not UI implementation)
 * 2. Single source of truth for capabilities
 * 3. Self-documenting with examples
 * 4. Graceful error handling
 */

class CommandRegistry {
  constructor() {
    this.commands = new Map();
    this.io = null;
    this.sessionManager = null;
    this.workspaceManager = null;
  }

  /**
   * Initialize with dependencies
   */
  init({ io, sessionManager, workspaceManager }) {
    this.io = io;
    this.sessionManager = sessionManager;
    this.workspaceManager = workspaceManager;
    this.registerBuiltinCommands();
  }

  /**
   * Register a command
   * @param {string} name - Unique command name (kebab-case)
   * @param {object} config - Command configuration
   */
  register(name, config) {
    this.commands.set(name, {
      name,
      category: config.category || 'general',
      description: config.description,
      params: config.params || [],
      examples: config.examples || [],
      handler: config.handler
    });
  }

  /**
   * Get all available commands (for discovery)
   */
  getCapabilities() {
    const capabilities = {};
    for (const [name, cmd] of this.commands) {
      if (!capabilities[cmd.category]) {
        capabilities[cmd.category] = [];
      }
      capabilities[cmd.category].push({
        name,
        description: cmd.description,
        params: cmd.params,
        examples: cmd.examples
      });
    }
    return capabilities;
  }

  /**
   * Execute a command
   * @param {string} name - Command name
   * @param {object} params - Command parameters
   */
  async execute(name, params = {}) {
    const cmd = this.commands.get(name);
    if (!cmd) {
      return {
        success: false,
        error: `Unknown command: ${name}`,
        hint: `Use GET /api/commander/capabilities to see available commands`
      };
    }

    // Validate required params
    for (const param of cmd.params) {
      if (param.required && !(param.name in params)) {
        return {
          success: false,
          error: `Missing required parameter: ${param.name}`,
          hint: `${param.name}: ${param.description}`
        };
      }
    }

    try {
      const result = await cmd.handler(params, {
        io: this.io,
        sessionManager: this.sessionManager,
        workspaceManager: this.workspaceManager
      });
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Register all built-in commands
   */
  registerBuiltinCommands() {
    // ============ SESSION COMMANDS ============

    this.register('focus-session', {
      category: 'sessions',
      description: 'Focus on a specific terminal/session',
      params: [
        { name: 'sessionId', required: true, description: 'Session ID (e.g., "work1-claude", "zoo-work2-server")' }
      ],
      examples: [
        { params: { sessionId: 'work1-claude' }, description: 'Focus the Claude terminal in work1' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'focus-session', ...params });
        return { message: `Focusing ${params.sessionId}` };
      }
    });

    this.register('send-to-session', {
      category: 'sessions',
      description: 'Send input text to a session',
      params: [
        { name: 'sessionId', required: true, description: 'Target session ID' },
        { name: 'input', required: true, description: 'Text to send (include \\n for enter)' }
      ],
      examples: [
        { params: { sessionId: 'work1-claude', input: 'git status\n' }, description: 'Run git status in work1 claude' }
      ],
      handler: async (params, { sessionManager }) => {
        const session = sessionManager.getSession(params.sessionId);
        if (!session) {
          throw new Error(`Session not found: ${params.sessionId}`);
        }
        session.write(params.input);
        return { message: `Sent to ${params.sessionId}` };
      }
    });

    this.register('list-sessions', {
      category: 'sessions',
      description: 'List all active sessions with their status',
      params: [],
      examples: [],
      handler: (params, { sessionManager }) => {
        const sessions = [];
        for (const [id, session] of sessionManager.sessions) {
          sessions.push({
            id,
            cwd: session.cwd,
            running: !!session.pty
          });
        }
        return { sessions };
      }
    });

    // ============ WORKSPACE COMMANDS ============

    this.register('switch-workspace', {
      category: 'workspaces',
      description: 'Switch to a different workspace tab',
      params: [
        { name: 'name', required: true, description: 'Workspace name to switch to' }
      ],
      examples: [
        { params: { name: 'Epic Survivors' }, description: 'Switch to Epic Survivors workspace' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'switch-workspace', workspaceName: params.name });
        return { message: `Switching to ${params.name}` };
      }
    });

    this.register('list-workspaces', {
      category: 'workspaces',
      description: 'List all available workspaces',
      params: [],
      examples: [],
      handler: async (params, { workspaceManager }) => {
        const workspaces = await workspaceManager.listWorkspaces();
        return { workspaces: workspaces.map(w => ({ name: w.name, type: w.type })) };
      }
    });

    // ============ UI COMMANDS ============

    this.register('open-commander', {
      category: 'ui',
      description: 'Open the Commander panel',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'open-commander' });
        return { message: 'Opening Commander panel' };
      }
    });

    this.register('open-new-project', {
      category: 'ui',
      description: 'Open the New Project / Greenfield wizard',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'open-greenfield' });
        return { message: 'Opening New Project wizard' };
      }
    });

    this.register('open-settings', {
      category: 'ui',
      description: 'Open the settings panel',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'open-settings' });
        return { message: 'Opening settings' };
      }
    });

    this.register('highlight-worktree', {
      category: 'ui',
      description: 'Scroll to and highlight a worktree in the sidebar',
      params: [
        { name: 'worktreeId', required: true, description: 'Worktree ID to highlight' }
      ],
      examples: [
        { params: { worktreeId: 'work1' }, description: 'Highlight work1 in sidebar' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'highlight-worktree', ...params });
        return { message: `Highlighting ${params.worktreeId}` };
      }
    });

    this.register('focus-worktree', {
      category: 'ui',
      description: 'Show only this worktree\'s terminals (hide all others)',
      params: [
        { name: 'worktreeId', required: true, description: 'Worktree ID to focus (e.g., "work1")' }
      ],
      examples: [
        { params: { worktreeId: 'work1' }, description: 'Show only work1 terminals' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'focus-worktree', ...params });
        return { message: `Focusing ${params.worktreeId}` };
      }
    });

    this.register('show-all-worktrees', {
      category: 'ui',
      description: 'Show all worktrees (unfocus/reset view)',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'show-all-worktrees' });
        return { message: 'Showing all worktrees' };
      }
    });

    // ============ TERMINAL ACTIONS ============

    this.register('start-claude', {
      category: 'terminals',
      description: 'Start Claude in a specific session',
      params: [
        { name: 'sessionId', required: true, description: 'Session to start Claude in' },
        { name: 'yolo', required: false, description: 'Use YOLO mode (default: true)' }
      ],
      examples: [
        { params: { sessionId: 'work1-claude' }, description: 'Start Claude in work1' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'start-claude', ...params });
        return { message: `Starting Claude in ${params.sessionId}` };
      }
    });

    this.register('stop-session', {
      category: 'terminals',
      description: 'Stop/kill a running session',
      params: [
        { name: 'sessionId', required: true, description: 'Session to stop' }
      ],
      examples: [
        { params: { sessionId: 'work1-server' }, description: 'Stop the server in work1' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'stop-session', ...params });
        return { message: `Stopping ${params.sessionId}` };
      }
    });

    this.register('run-command', {
      category: 'terminals',
      description: 'Run a shell command in a session',
      params: [
        { name: 'sessionId', required: true, description: 'Session to run command in' },
        { name: 'command', required: true, description: 'Shell command to run' }
      ],
      examples: [
        { params: { sessionId: 'work1-server', command: 'npm test' }, description: 'Run tests in work1 server' }
      ],
      handler: async (params, { sessionManager }) => {
        const session = sessionManager.getSession(params.sessionId);
        if (!session) {
          throw new Error(`Session not found: ${params.sessionId}`);
        }
        session.write(params.command + '\n');
        return { message: `Running: ${params.command}` };
      }
    });

    // ============ GIT COMMANDS ============

    this.register('get-git-status', {
      category: 'git',
      description: 'Get git status for a session/worktree',
      params: [
        { name: 'sessionId', required: true, description: 'Session to check' }
      ],
      examples: [],
      handler: async (params, { sessionManager }) => {
        const session = sessionManager.getSession(params.sessionId);
        if (!session) {
          throw new Error(`Session not found: ${params.sessionId}`);
        }
        // Git status is tracked by StatusDetector
        return {
          cwd: session.cwd,
          branch: session.branch || 'unknown',
          hint: 'Full git info available in session status'
        };
      }
    });

    // ============ BROADCAST COMMANDS ============

    this.register('broadcast', {
      category: 'coordination',
      description: 'Send the same input to multiple sessions',
      params: [
        { name: 'sessionIds', required: true, description: 'Array of session IDs' },
        { name: 'input', required: true, description: 'Text to send to all sessions' }
      ],
      examples: [
        { params: { sessionIds: ['work1-claude', 'work2-claude'], input: 'git pull\n' }, description: 'Pull in all worktrees' }
      ],
      handler: async (params, { sessionManager }) => {
        const results = [];
        for (const sessionId of params.sessionIds) {
          const session = sessionManager.getSession(sessionId);
          if (session) {
            session.write(params.input);
            results.push({ sessionId, sent: true });
          } else {
            results.push({ sessionId, sent: false, error: 'Not found' });
          }
        }
        return { results };
      }
    });
  }
}

// Singleton
const commandRegistry = new CommandRegistry();
module.exports = commandRegistry;
