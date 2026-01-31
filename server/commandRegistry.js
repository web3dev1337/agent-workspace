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

    // ============ HISTORY / CONVERSATIONS ============

    this.register('open-history', {
      category: 'history',
      description: 'Open conversation history (Claude + Codex) with optional filters',
      params: [
        { name: 'source', required: false, description: 'Filter by source: "all", "claude", or "codex"' },
        { name: 'query', required: false, description: 'Search query text' },
        { name: 'repo', required: false, description: 'Repo/project filter (as shown in the history UI)' },
        { name: 'branch', required: false, description: 'Branch filter (e.g. "main", "work2", "feature/foo")' },
        { name: 'dateFilter', required: false, description: 'Date filter: "1h", "24h", "3d", "7d", "30d", "90d"' }
      ],
      examples: [
        { params: { source: 'codex' }, description: 'Show Codex session history' },
        { params: { query: '409 conflict add-mixed-worktree', source: 'all' }, description: 'Search all history for an error message' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'open-history', ...params });
        return { message: 'Opening history' };
      }
    });

    this.register('resume-history', {
      category: 'history',
      description: 'Resume a specific conversation/session by id (Claude or Codex)',
      params: [
        { name: 'id', required: true, description: 'Conversation/session id to resume' },
        { name: 'source', required: false, description: 'Optional source hint: "claude" or "codex"' },
        { name: 'project', required: false, description: 'Optional project/repo hint (helps disambiguate)' }
      ],
      examples: [
        { params: { id: 'e0b1c2d3-....', source: 'claude' }, description: 'Resume a Claude conversation by id' },
        { params: { id: 'codex-session-id', source: 'codex' }, description: 'Resume a Codex session by id' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'resume-history', ...params });
        return { message: `Resuming ${params.id}` };
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

    this.register('open-dashboard', {
      category: 'ui',
      description: 'Open the Dashboard (home)',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'open-dashboard' });
        return { message: 'Opening Dashboard' };
      }
    });

    this.register('open-prs', {
      category: 'ui',
      description: 'Open the PRs panel',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'open-prs' });
        return { message: 'Opening PRs' };
      }
    });

    this.register('open-telemetry', {
      category: 'process',
      description: 'Open Telemetry details (Dashboard overlay)',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'open-telemetry' });
        return { message: 'Opening Telemetry details' };
      }
    });

    this.register('open-activity', {
      category: 'process',
      description: 'Open the Activity feed panel',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'open-activity' });
        return { message: 'Opening Activity feed' };
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

    this.register('queue-conveyor-t2', {
      category: 'process',
      description: 'Open Queue and start Conveyor T2 (one-at-a-time Tier 2 reviews)',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-conveyor-t2' });
        return { message: 'Queue: conveyor t2' };
      }
    });

    this.register('queue-select', {
      category: 'process',
      description: 'Select a specific Queue item by id (e.g. pr:owner/repo#123)',
      params: [
        { name: 'id', required: true, description: 'Queue item id (task record id)' }
      ],
      examples: [
        { params: { id: 'pr:web3dev1337/repo#123' }, description: 'Select PR #123 in Queue' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-select', id: params.id });
        return { message: `Queue: select ${params.id}` };
      }
    });

    this.register('queue-open-console', {
      category: 'process',
      description: 'Open the Review Console for the currently selected Queue item (PR-only supported)',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-open-console' });
        return { message: 'Queue: open console' };
      }
    });

    this.register('queue-open-diff', {
      category: 'process',
      description: 'Open the diff viewer for the currently selected Queue item (when it has a PR)',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-open-diff' });
        return { message: 'Queue: open diff' };
      }
    });

    this.register('queue-spawn-reviewer', {
      category: 'process',
      description: 'Spawn a reviewer agent for the selected Queue PR (Tier 3 reviewer)',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-spawn-reviewer' });
        return { message: 'Queue: spawn reviewer' };
      }
    });

    this.register('queue-spawn-fixer', {
      category: 'process',
      description: 'Spawn a fixer agent for the selected Queue PR (Tier 2 fixer; uses Notes as fix request)',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-spawn-fixer' });
        return { message: 'Queue: spawn fixer' };
      }
    });

    this.register('queue-spawn-recheck', {
      category: 'process',
      description: 'Spawn a recheck/reviewer agent for the selected Queue PR (Tier 3 recheck)',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-spawn-recheck' });
        return { message: 'Queue: spawn recheck' };
      }
    });

    this.register('queue-spawn-overnight', {
      category: 'process',
      description: 'Spawn an overnight runner for the selected Queue PR (Tier 4; long-running)',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-spawn-overnight' });
        return { message: 'Queue: spawn overnight' };
      }
    });

    this.register('queue-set-pfail', {
      category: 'process',
      description: 'Set pFailFirstPass for the selected Queue item',
      params: [
        { name: 'pFailFirstPass', required: true, description: 'Number (0..1) or "none" to clear' }
      ],
      examples: [
        { params: { pFailFirstPass: 0.3 }, description: 'Set pFailFirstPass to 0.3' },
        { params: { pFailFirstPass: 'none' }, description: 'Clear pFailFirstPass' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-set-pfail', ...params });
        return { message: 'Queue: set pFailFirstPass' };
      }
    });

    this.register('queue-set-verify', {
      category: 'process',
      description: 'Set verifyMinutes for the selected Queue item',
      params: [
        { name: 'verifyMinutes', required: true, description: 'Minutes (number) or "none" to clear' }
      ],
      examples: [
        { params: { verifyMinutes: 10 }, description: 'Set verifyMinutes to 10' },
        { params: { verifyMinutes: 'none' }, description: 'Clear verifyMinutes' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-set-verify', ...params });
        return { message: 'Queue: set verifyMinutes' };
      }
    });

    this.register('queue-set-prompt-ref', {
      category: 'process',
      description: 'Set promptRef (prompt artifact id) for the selected Queue item',
      params: [
        { name: 'promptRef', required: true, description: 'Prompt artifact reference (e.g. pr:owner/repo#123) or empty/none to clear' }
      ],
      examples: [
        { params: { promptRef: 'pr:web3dev1337/repo#123' }, description: 'Set promptRef' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-set-prompt-ref', ...params });
        return { message: 'Queue: set promptRef' };
      }
    });

    this.register('queue-set-ticket', {
      category: 'process',
      description: 'Set Trello ticket for the selected Queue item (URL or trello:<shortLink>)',
      params: [
        { name: 'ticket', required: true, description: 'Ticket reference (Trello URL / trello:<shortLink> / empty/none to clear)' }
      ],
      examples: [
        { params: { ticket: 'trello:abc123' }, description: 'Set ticket from shortLink' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-set-ticket', ...params });
        return { message: 'Queue: set ticket' };
      }
    });

    this.register('queue-open-ticket', {
      category: 'process',
      description: 'Open the selected Queue item ticket in a new tab (if present)',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-open-ticket' });
        return { message: 'Queue: open ticket' };
      }
    });

    this.register('queue-prev', {
      category: 'process',
      description: 'Select the previous Queue item',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-prev' });
        return { message: 'Queue: prev item' };
      }
    });

    this.register('queue-open-inspector', {
      category: 'process',
      description: 'Open Worktree Inspector for the selected Queue item (when it has a session/worktree path)',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-open-inspector' });
        return { message: 'Queue: open inspector' };
      }
    });

    this.register('queue-review-timer-start', {
      category: 'process',
      description: 'Start the review timer for the selected Queue item',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-review-timer-start' });
        return { message: 'Queue: start review timer' };
      }
    });

    this.register('queue-review-timer-stop', {
      category: 'process',
      description: 'Stop the review timer for the selected Queue item (if running)',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-review-timer-stop' });
        return { message: 'Queue: stop review timer' };
      }
    });

    this.register('queue-set-tier', {
      category: 'process',
      description: 'Set tier for the selected Queue item',
      params: [
        { name: 'tier', required: true, description: '1|2|3|4|none' }
      ],
      examples: [
        { params: { tier: 3 }, description: 'Set selected item to Tier 3' },
        { params: { tier: 'none' }, description: 'Clear tier' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-set-tier', ...params });
        return { message: 'Queue: set tier' };
      }
    });

    this.register('queue-set-risk', {
      category: 'process',
      description: 'Set change risk for the selected Queue item',
      params: [
        { name: 'risk', required: true, description: 'low|medium|high|none' }
      ],
      examples: [
        { params: { risk: 'high' }, description: 'Set risk to high' },
        { params: { risk: 'none' }, description: 'Clear risk' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-set-risk', ...params });
        return { message: 'Queue: set risk' };
      }
    });

    this.register('queue-set-outcome', {
      category: 'process',
      description: 'Set review outcome for the selected Queue item',
      params: [
        { name: 'outcome', required: true, description: 'approved|needs_fix|done|skipped|none' }
      ],
      examples: [
        { params: { outcome: 'needs_fix' }, description: 'Mark outcome as needs_fix' },
        { params: { outcome: 'none' }, description: 'Clear outcome' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-set-outcome', ...params });
        return { message: 'Queue: set outcome' };
      }
    });

    this.register('queue-set-notes', {
      category: 'process',
      description: 'Set Notes/Fix Request for the selected Queue item',
      params: [
        { name: 'notes', required: true, description: 'Notes text (empty clears)' }
      ],
      examples: [
        { params: { notes: 'Please add a test for X.' }, description: 'Set Notes' },
        { params: { notes: '' }, description: 'Clear Notes' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-set-notes', ...params });
        return { message: 'Queue: set notes' };
      }
    });

    this.register('queue-claim', {
      category: 'process',
      description: 'Claim the selected Queue item for review',
      params: [
        { name: 'who', required: false, description: 'Claim name/identity (defaults to Settings → Identity)' }
      ],
      examples: [
        { params: {}, description: 'Claim selected item using saved identity' },
        { params: { who: 'alex' }, description: 'Claim selected item as alex' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-claim', ...params });
        return { message: 'Queue: claim' };
      }
    });

    this.register('queue-release', {
      category: 'process',
      description: 'Release claim for the selected Queue item',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-release' });
        return { message: 'Queue: release claim' };
      }
    });

    this.register('queue-assign', {
      category: 'process',
      description: 'Assign the selected Queue item',
      params: [
        { name: 'who', required: true, description: 'Assignee name/identity' }
      ],
      examples: [
        { params: { who: 'alex' }, description: 'Assign selected item to alex' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-assign', ...params });
        return { message: 'Queue: assign' };
      }
    });

    this.register('queue-unassign', {
      category: 'process',
      description: 'Clear assignment for the selected Queue item',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-unassign' });
        return { message: 'Queue: unassign' };
      }
    });

    this.register('queue-refresh', {
      category: 'process',
      description: 'Refresh Queue data (re-fetch tasks)',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-refresh' });
        return { message: 'Queue: refresh' };
      }
    });

    this.register('queue-select-by-pr-url', {
      category: 'process',
      description: 'Select a Queue item by PR URL',
      params: [
        { name: 'url', required: true, description: 'GitHub PR URL' }
      ],
      examples: [
        { params: { url: 'https://github.com/owner/repo/pull/123' }, description: 'Select PR in Queue by URL' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-select-by-pr-url', ...params });
        return { message: 'Queue: select by PR URL' };
      }
    });

    this.register('queue-select-by-ticket', {
      category: 'process',
      description: 'Select a Queue item by ticket reference (trello URL / trello:<shortLink> / <shortLink>)',
      params: [
        { name: 'ticket', required: true, description: 'Ticket reference' }
      ],
      examples: [
        { params: { ticket: 'trello:abc123' }, description: 'Select by Trello shortLink' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-select-by-ticket', ...params });
        return { message: 'Queue: select by ticket' };
      }
    });

    this.register('queue-open-prompt', {
      category: 'process',
      description: 'Open the Prompt Artifact editor for the selected Queue item',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-open-prompt' });
        return { message: 'Queue: open prompt artifact' };
      }
    });

    this.register('queue-deps-add', {
      category: 'process',
      description: 'Add dependency id(s) to the selected Queue item',
      params: [
        { name: 'dependencyIds', required: true, description: 'Array (or comma/newline string) of dependency IDs (e.g. pr:owner/repo#123, trello:abc123)' }
      ],
      examples: [
        { params: { dependencyIds: ['pr:web3dev1337/repo#123', 'trello:abc123'] }, description: 'Add two dependencies' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-deps-add', ...params });
        return { message: 'Queue: add dependencies' };
      }
    });

    this.register('queue-deps-remove', {
      category: 'process',
      description: 'Remove dependency id(s) from the selected Queue item',
      params: [
        { name: 'dependencyIds', required: true, description: 'Array (or comma/newline string) of dependency IDs' }
      ],
      examples: [
        { params: { dependencyIds: ['pr:web3dev1337/repo#123'] }, description: 'Remove one dependency' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-deps-remove', ...params });
        return { message: 'Queue: remove dependencies' };
      }
    });

    this.register('queue-deps-graph', {
      category: 'process',
      description: 'Open the dependency graph for the selected Queue item',
      params: [
        { name: 'depth', required: false, description: 'Depth (1-6)' },
        { name: 'view', required: false, description: 'tree|graph' }
      ],
      examples: [
        { params: { depth: 3, view: 'graph' }, description: 'Open dep graph (depth 3) in graph view' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-deps-graph', ...params });
        return { message: 'Queue: open dependency graph' };
      }
    });

    this.register('queue-pairing', {
      category: 'process',
      description: 'Open the Queue pairing recommendations modal',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-pairing' });
        return { message: 'Queue: pairing' };
      }
    });

    this.register('queue-conflicts-refresh', {
      category: 'process',
      description: 'Refresh worktree conflicts analysis in Queue (best-effort)',
      params: [],
      examples: [],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-conflicts-refresh' });
        return { message: 'Queue: refresh conflicts' };
      }
    });

    this.register('queue-approve', {
      category: 'process',
      description: 'Approve the selected Queue PR on GitHub (optional body)',
      params: [
        { name: 'body', required: false, description: 'Optional review body/comment text' }
      ],
      examples: [
        { params: {}, description: 'Approve selected PR' },
        { params: { body: 'LGTM ✅' }, description: 'Approve selected PR with a short comment' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-approve', ...params });
        return { message: 'Queue: approve PR' };
      }
    });

    this.register('queue-request-changes', {
      category: 'process',
      description: 'Request changes for the selected Queue PR on GitHub (uses Notes/body)',
      params: [
        { name: 'body', required: false, description: 'Review body (if omitted, UI Notes will be used as-is)' }
      ],
      examples: [
        { params: { body: 'Please fix X and add a test.' }, description: 'Request changes with review body' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-request-changes', ...params });
        return { message: 'Queue: request changes' };
      }
    });

    this.register('queue-merge', {
      category: 'process',
      description: 'Merge the selected Queue PR (merge|squash|rebase)',
      params: [
        { name: 'method', required: false, description: 'merge | squash | rebase (default: merge)' }
      ],
      examples: [
        { params: {}, description: 'Merge selected PR (merge)' },
        { params: { method: 'squash' }, description: 'Squash-merge selected PR' }
      ],
      handler: (params, { io }) => {
        io.emit('commander-action', { action: 'queue-merge', ...params });
        return { message: 'Queue: merge PR' };
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
