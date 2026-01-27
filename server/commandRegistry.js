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

    // ============ PROCESS / WORKFLOW COMMANDS ============

    this.register('open-queue', {
      category: 'process',
      description: 'Open the Queue (review inbox) panel',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'open-queue' });
        return { message: 'Opening Queue' };
      }
    });

    this.register('queue-next', {
      category: 'process',
      description: 'Open Queue and jump to the next review item',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-next' });
        return { message: 'Queue: next item' };
      }
    });

    this.register('queue-blockers', {
      category: 'process',
      description: 'Open Queue filtered to dependency-blocked items',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-blockers' });
        return { message: 'Queue: blockers' };
      }
    });

    this.register('queue-triage', {
      category: 'process',
      description: 'Open Queue in triage mode (ordering + snooze)',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-triage' });
        return { message: 'Queue: triage' };
      }
    });

    this.register('open-tasks', {
      category: 'process',
      description: 'Open the Tasks panel (Trello provider UI)',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'open-tasks' });
        return { message: 'Opening Tasks' };
      }
    });

    this.register('open-advice', {
      category: 'process',
      description: 'Open the Advisor overlay (Commander → Advice)',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'open-advice' });
        return { message: 'Opening Advisor' };
      }
    });

    this.register('set-workflow-mode', {
      category: 'process',
      description: 'Set workflow mode: focus | review | background',
      params: [
        { name: 'mode', required: true, description: 'One of: focus, review, background' }
      ],
      examples: [
        { params: { mode: 'focus' }, description: 'Enter focus mode' },
        { params: { mode: 'review' }, description: 'Enter review mode (Queue)' },
        { params: { mode: 'background' }, description: 'Enter background mode' }
      ],
      handler: (params, { io }) => {
        const mode = String(params.mode || '').trim().toLowerCase();
        if (!['focus', 'review', 'background'].includes(mode)) {
          throw new Error(`Invalid mode: ${params.mode}`);
        }
        io.emit('commander-action', { action: 'set-workflow-mode', mode });
        return { message: `Workflow mode: ${mode}` };
      }
    });

    this.register('set-focus-tier2', {
      category: 'process',
      description: 'Set Focus Tier-2 behavior: auto | always',
      params: [
        { name: 'behavior', required: true, description: 'One of: auto, always' }
      ],
      examples: [
        { params: { behavior: 'auto' }, description: 'Auto-hide Tier 2 while Tier 1 is busy' },
        { params: { behavior: 'always' }, description: 'Always show Tier 2 in Focus' }
      ],
      handler: (params, { io }) => {
        const behavior = String(params.behavior || '').trim().toLowerCase();
        if (!['auto', 'always'].includes(behavior)) {
          throw new Error(`Invalid behavior: ${params.behavior}`);
        }
        io.emit('commander-action', { action: 'set-focus-tier2', behavior });
        return { message: `Focus Tier2: ${behavior}` };
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

    // ============ SESSION LIFECYCLE ============

    this.register('restart-session', {
      category: 'terminals',
      description: 'Restart a terminal session',
      params: [
        { name: 'sessionId', required: true, description: 'Session to restart' }
      ],
      examples: [
        { params: { sessionId: 'work1-claude' }, description: 'Restart Claude in work1' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'restart-session', ...params });
        return { message: `Restarting ${params.sessionId}` };
      }
    });

    this.register('kill-session', {
      category: 'terminals',
      description: 'Kill/terminate a terminal session completely',
      params: [
        { name: 'sessionId', required: true, description: 'Session to kill' }
      ],
      examples: [
        { params: { sessionId: 'work1-server' }, description: 'Kill the server terminal in work1' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'kill-session', ...params });
        return { message: `Killing ${params.sessionId}` };
      }
    });

    this.register('destroy-session', {
      category: 'terminals',
      description: 'Destroy a session and remove it from the UI',
      params: [
        { name: 'sessionId', required: true, description: 'Session to destroy' }
      ],
      examples: [
        { params: { sessionId: 'work1-claude' }, description: 'Destroy work1 claude session' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'destroy-session', ...params });
        return { message: `Destroying ${params.sessionId}` };
      }
    });

    // ============ SERVER CONTROL ============

    this.register('stop-server', {
      category: 'servers',
      description: 'Stop the dev server in a worktree',
      params: [
        { name: 'sessionId', required: true, description: 'Server session to stop (e.g., work1-server)' }
      ],
      examples: [
        { params: { sessionId: 'work1-server' }, description: 'Stop server in work1' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'server-control', sessionId: params.sessionId, controlAction: 'stop' });
        return { message: `Stopping server ${params.sessionId}` };
      }
    });

    this.register('restart-server', {
      category: 'servers',
      description: 'Restart the dev server in a worktree',
      params: [
        { name: 'sessionId', required: true, description: 'Server session to restart' }
      ],
      examples: [
        { params: { sessionId: 'work1-server' }, description: 'Restart server in work1' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'server-control', sessionId: params.sessionId, controlAction: 'restart' });
        return { message: `Restarting server ${params.sessionId}` };
      }
    });

    this.register('kill-server', {
      category: 'servers',
      description: 'Force kill the dev server',
      params: [
        { name: 'sessionId', required: true, description: 'Server session to kill' }
      ],
      examples: [
        { params: { sessionId: 'work1-server' }, description: 'Force kill server in work1' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'server-control', sessionId: params.sessionId, controlAction: 'kill' });
        return { message: `Killing server ${params.sessionId}` };
      }
    });

    this.register('build-production', {
      category: 'servers',
      description: 'Build production version of a project',
      params: [
        { name: 'sessionId', required: true, description: 'Session/worktree to build' }
      ],
      examples: [
        { params: { sessionId: 'work1-server' }, description: 'Build production in work1' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'build-production', ...params });
        return { message: `Building production for ${params.sessionId}` };
      }
    });

    // ============ AGENT CONTROL ============

    this.register('start-agent', {
      category: 'agents',
      description: 'Start an AI agent (Aider, etc.) in a session',
      params: [
        { name: 'sessionId', required: true, description: 'Session to start agent in' },
        { name: 'agentType', required: false, description: 'Agent type (aider, cursor, etc.)' }
      ],
      examples: [
        { params: { sessionId: 'work1-claude', agentType: 'aider' }, description: 'Start Aider in work1' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'start-agent', ...params });
        return { message: `Starting agent in ${params.sessionId}` };
      }
    });

    // ============ WORKTREE MANAGEMENT ============

    this.register('add-worktree', {
      category: 'worktrees',
      description: 'Add a new worktree to the current workspace',
      params: [
        { name: 'worktreeId', required: false, description: 'New worktree ID (auto-generated if not provided)' }
      ],
      examples: [
        { params: {}, description: 'Add a new worktree' },
        { params: { worktreeId: 'work5' }, description: 'Add worktree with specific ID' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'add-worktree', ...params });
        return { message: 'Adding new worktree' };
      }
    });

    this.register('remove-worktree', {
      category: 'worktrees',
      description: 'Remove a worktree from the workspace',
      params: [
        { name: 'worktreeId', required: true, description: 'Worktree to remove' }
      ],
      examples: [
        { params: { worktreeId: 'work3' }, description: 'Remove work3' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'remove-worktree', ...params });
        return { message: `Removing worktree ${params.worktreeId}` };
      }
    });

    // ============ TAB MANAGEMENT ============

    this.register('close-tab', {
      category: 'tabs',
      description: 'Close the current workspace tab',
      params: [
        { name: 'tabId', required: false, description: 'Tab ID to close (current if not specified)' }
      ],
      examples: [
        { params: {}, description: 'Close current tab' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'close-tab', ...params });
        return { message: 'Closing tab' };
      }
    });

    this.register('new-tab', {
      category: 'tabs',
      description: 'Open a new workspace tab',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'new-tab' });
        return { message: 'Opening new tab' };
      }
    });

    // ============ FILE OPERATIONS ============

    this.register('open-folder', {
      category: 'files',
      description: 'Open a folder in the file explorer',
      params: [
        { name: 'path', required: false, description: 'Path to open (current worktree if not specified)' },
        { name: 'sessionId', required: false, description: 'Session to get path from' }
      ],
      examples: [
        { params: { sessionId: 'work1-claude' }, description: 'Open work1 folder in explorer' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'open-folder', ...params });
        return { message: 'Opening folder in explorer' };
      }
    });

    this.register('open-diff-viewer', {
      category: 'files',
      description: 'Open the diff viewer for code review',
      params: [
        { name: 'sessionId', required: false, description: 'Session to view diff for' }
      ],
      examples: [
        { params: { sessionId: 'work1-claude' }, description: 'Open diff viewer for work1' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'open-diff-viewer', ...params });
        return { message: 'Opening diff viewer' };
      }
    });

    // ============ NAVIGATION ============

    this.register('scroll-to-top', {
      category: 'navigation',
      description: 'Scroll terminal to top',
      params: [
        { name: 'sessionId', required: true, description: 'Session to scroll' }
      ],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'scroll-to-top', ...params });
        return { message: `Scrolling ${params.sessionId} to top` };
      }
    });

    this.register('scroll-to-bottom', {
      category: 'navigation',
      description: 'Scroll terminal to bottom',
      params: [
        { name: 'sessionId', required: true, description: 'Session to scroll' }
      ],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'scroll-to-bottom', ...params });
        return { message: `Scrolling ${params.sessionId} to bottom` };
      }
    });

    this.register('clear-terminal', {
      category: 'navigation',
      description: 'Clear terminal output',
      params: [
        { name: 'sessionId', required: true, description: 'Session to clear' }
      ],
      examples: [
        { params: { sessionId: 'work1-claude' }, description: 'Clear work1 claude terminal' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'clear-terminal', ...params });
        return { message: `Clearing ${params.sessionId}` };
      }
    });

    // ============ QUICK ACTIONS ============

    this.register('git-pull-all', {
      category: 'git',
      description: 'Pull latest changes in all worktrees',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'git-pull-all' });
        return { message: 'Pulling in all worktrees' };
      }
    });

    this.register('git-status-all', {
      category: 'git',
      description: 'Show git status for all worktrees',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'git-status-all' });
        return { message: 'Getting status for all worktrees' };
      }
    });

    this.register('stop-all-claudes', {
      category: 'coordination',
      description: 'Stop Claude in all sessions',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'stop-all-claudes' });
        return { message: 'Stopping all Claude sessions' };
      }
    });

    this.register('start-all-claudes', {
      category: 'coordination',
      description: 'Start Claude in all sessions',
      params: [
        { name: 'yolo', required: false, description: 'Use YOLO mode (default: true)' }
      ],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'start-all-claudes', ...params });
        return { message: 'Starting Claude in all sessions' };
      }
    });

    this.register('refresh-all', {
      category: 'coordination',
      description: 'Refresh all terminal connections',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'refresh-all' });
        return { message: 'Refreshing all terminals' };
      }
    });
  }
}

// Singleton
const commandRegistry = new CommandRegistry();
module.exports = commandRegistry;
