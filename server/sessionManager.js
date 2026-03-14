let pty = null;
let ptyLoadError = null;
try {
  pty = require('node-pty');
} catch (error) {
  ptyLoadError = error;
}
const { EventEmitter } = require('events');
const winston = require('winston');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ClaudeVersionChecker } = require('./claudeVersionChecker');
const { UserSettingsService } = require('./userSettingsService');
const { WorktreeHelper } = require('./worktreeHelper');
const sessionRecoveryService = require('./sessionRecoveryService');
const { parseWorktreeKey } = require('./lifecyclePolicyService');
const {
  getShellKind,
  quoteForShell,
  buildEcho,
  buildShellCommand,
  resolveCwd
} = require('./utils/shellCommand');
const { augmentProcessEnv, buildPowerShellArgs } = require('./utils/processUtils');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/sessions.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});
if (ptyLoadError) {
  logger.error('node-pty failed to load', {
    error: ptyLoadError.message,
    stack: ptyLoadError.stack
  });
}

// Helper function to get the appropriate shell for the platform
function getDefaultShell() {
  return process.platform === 'win32' ? 'powershell.exe' : 'bash';
}

// Helper function to build shell args for executing commands
function buildShellArgs(commands) {
  if (process.platform === 'win32') {
    // PowerShell: keep the shell open inside the PTY, but hide any external window.
    const joined = Array.isArray(commands) ? commands.join('; ') : commands.replace(/&&/g, ';');
    return buildPowerShellArgs(joined, { keepOpen: true });
  } else {
    // Bash: join commands with && and keep the terminal open by exec'ing into an interactive shell.
    const joined = Array.isArray(commands) ? commands.join(' && ') : commands;
    const keepOpen = joined && joined.trim() ? `${joined} && exec bash` : 'exec bash';
    return ['-c', keepOpen];
  }
}

const HOME_DIR = process.env.HOME || os.homedir();

class SessionManager extends EventEmitter {
  constructor(io, agentManager) {
    super();
    this.io = io;
    this.agentManager = agentManager;
    this.sessions = new Map();
    // Keep inactive workspaces' sessions alive (PTYs keep running), keyed by workspace id.
    // The active workspace is always `this.workspace`, and its sessions live in `this.sessions`.
    this.workspaceSessionMaps = new Map(); // workspaceId -> Map(sessionId -> session)
    this.statusDetector = null; // Will be set later
    this.gitHelper = null; // Will be set later
    this.fileWatchers = new Map(); // Store file watchers for .git/HEAD files
    this.userSettings = UserSettingsService.getInstance();
    this.workspace = null; // Will be set by WorkspaceManager
    this.worktreeHelper = new WorktreeHelper();
    this.isWorkspaceSwitching = false; // Flag to prevent auto-restart during workspace switch

    // Load configuration
    this.config = this.loadConfig();

    // Session timeouts
    this.sessionTimeout = parseInt(process.env.SESSION_TIMEOUT || this.config.sessions.timeoutMs.toString());
    this.claudeSessionTimeout = parseInt(process.env.CLAUDE_SESSION_TIMEOUT || this.config.sessions.claudeTimeoutMs?.toString() || '0');
    this.serverSessionTimeout = parseInt(process.env.SERVER_SESSION_TIMEOUT || this.config.sessions.serverTimeoutMs?.toString() || '43200000');
    this.branchRefreshInterval = null;
    this.maxProcessesPerSession = parseInt(process.env.MAX_PROCESSES_PER_SESSION || this.config.sessions.maxProcessesPerSession.toString());
    this.maxBufferSize = parseInt(process.env.MAX_BUFFER_SIZE || this.config.sessions.maxBufferSize.toString());
    this.statusMinHoldMs = parseInt(process.env.STATUS_MIN_HOLD_MS || '1500');
    // Extra hysteresis for transitioning to idle (prevents flicker when output pauses briefly).
    this.statusIdleHoldMs = parseInt(process.env.STATUS_IDLE_HOLD_MS || '6000');
    // Default to 30s to keep branch labels reasonably fresh without relying on user git commands.
    this.branchRefreshMs = parseInt(process.env.BRANCH_REFRESH_MS || '30000');
    this.processTreeKillGraceMs = parseInt(process.env.PROCESS_TREE_KILL_GRACE_MS || '1200');
    this.conversationSnapshotTtlMs = parseInt(process.env.CONVERSATION_SNAPSHOT_TTL_MS || '5000');
    this.conversationSnapshotCache = { timestamp: 0, files: null };

    // Worktrees will be built when workspace is set
    this.worktrees = [];
  }

  // Determine effective inactivity timeout per session (ms)
  getSessionTimeout(session) {
    if (!session) return this.sessionTimeout;
    const override = session.config?.timeoutMs;
    if (Number.isFinite(override)) return override;
    if (session.type === 'claude') return this.claudeSessionTimeout;
    if (session.type === 'server') return this.serverSessionTimeout;
    return this.sessionTimeout;
  }
  
  loadConfig() {
    const configPath = path.join(__dirname, '..', 'config.json');
    try {
      const configData = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(configData);
    } catch (error) {
      logger.warn('Could not load config.json, using defaults', { error: error.message, stack: error.stack });
      return {
        server: { port: 3000, host: "127.0.0.1" },
        worktrees: { basePath: "auto", count: 8 },
        sessions: { timeoutMs: 1800000, maxBufferSize: 100000, maxProcessesPerSession: 50 },
        logging: { level: "info" },
        tokens: { maxContextTokens: 200000 }
      };
    }
  }

  buildPtyOptions(config, env) {
    const options = {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: config.cwd,
      env
    };

    if (process.platform === 'win32') {
      options.useConpty = true;
    }

    return options;
  }
  
  setStatusDetector(detector) {
    this.statusDetector = detector;
  }
  
  setGitHelper(helper) {
    this.gitHelper = helper;
  }

  setWorkspace(workspace) {
    if (!workspace) {
      logger.info('Clearing workspace from SessionManager');
      this.workspace = null;
      this.worktrees = [];
      return;
    }

    logger.info('Setting workspace for SessionManager', { workspace: workspace.name });
    this.workspace = workspace;
    this.buildWorktreesFromWorkspace();

    // Ensure we have a session map reserved for this workspace.
    if (this.workspace?.id && !this.workspaceSessionMaps.has(this.workspace.id)) {
      this.workspaceSessionMaps.set(this.workspace.id, new Map());
    }
  }

  /**
   * Switch active workspace while preserving existing PTY sessions.
   * - Stashes the current `this.sessions` map under the previous workspace id
   * - Restores (or creates) the session map for the new workspace id as `this.sessions`
   * - Ensures sessions exist for the new workspace without killing old PTYs
   */
  async switchWorkspacePreservingSessions(workspace) {
    if (!workspace?.id) {
      throw new Error('Workspace missing id');
    }

    const previousWorkspaceId = this.workspace?.id || null;
    if (previousWorkspaceId && previousWorkspaceId !== workspace.id) {
      this.workspaceSessionMaps.set(previousWorkspaceId, this.sessions);
    }

    // Activate new workspace and restore its session map
    this.setWorkspace(workspace);
    const restored = this.workspaceSessionMaps.get(workspace.id);
    this.sessions = restored || new Map();
    this.workspaceSessionMaps.set(workspace.id, this.sessions);

    // Ensure sessions exist for the active workspace without clearing existing ones.
    await this.initializeSessions({ preserveExisting: true });

    // Return any buffered output that occurred while this workspace was inactive.
    return {
      sessions: this.getSessionStates(),
      backlog: this.getUndeliveredOutputAndMarkDelivered()
    };
  }

  buildWorktreesFromWorkspace() {
    if (!this.workspace) {
      logger.warn('No workspace set, cannot build worktrees');
      return;
    }

    this.worktrees = [];
    const { repository, worktrees: worktreeConfig, terminals } = this.workspace;

    // Check if workspace has mixed-repo terminals array
    if (Array.isArray(terminals)) {
      // Mixed-repo workspace: Extract unique worktrees from terminals array
      const worktreeSet = new Set();

      terminals.forEach(terminal => {
        const repoPath = terminal.repository.path;
        const worktreeId = terminal.worktree;
        const worktreePath = terminal.worktreePath || path.join(repoPath, worktreeId);

        // Use a unique key to avoid duplicate worktrees (same repo + worktree)
        const worktreeKey = `${terminal.repository.name}-${worktreeId}`;
        if (!worktreeSet.has(worktreeKey)) {
          worktreeSet.add(worktreeKey);
          this.worktrees.push({
            id: worktreeKey, // Use consistent worktree identifier
            worktreeId: worktreeId,
            repositoryName: terminal.repository.name,
            repositoryPath: repoPath,
            path: worktreePath
          });
        }
      });
    } else {
      // Traditional single-repo workspace: Use terminals.pairs pattern
      const terminalPairs = terminals.pairs || 1; // Default to 1 pair, not 8

      for (let i = 1; i <= terminalPairs; i++) {
        const worktreeId = worktreeConfig.namingPattern.replace('{n}', i);
        // ALL workspace types use worktree pattern - no special cases
        const worktreePath = path.join(repository.path, worktreeId);

        this.worktrees.push({
          id: worktreeId,
          path: worktreePath
        });
      }
    }

    logger.info('Built worktrees from workspace', {
      workspace: this.workspace.name,
      count: this.worktrees.length
    });
  }
  
  async initializeSessions(options = {}) {
    const preserveExisting = !!options.preserveExisting;
    // Set flag to prevent auto-restart during initialization
    this.isWorkspaceSwitching = true;

    if (!preserveExisting) {
      // Clear ALL existing sessions first
      logger.info('Clearing existing sessions before workspace initialization');
      this.cleanupAllSessions();
    } else {
      // When preserving sessions (workspace tab switching), keep PTYs alive and only
      // reset branch refresh/watchers for the active workspace.
      logger.info('Preserving existing sessions during workspace initialization');
      this.stopBranchRefresh();
      this.cleanupGitWatchers();
    }

    logger.info('Initializing sessions', { count: this.worktrees.length });

    // Log configuration for debugging
    logger.info('SessionManager configuration:', {
      workspace: this.workspace?.name || 'none',
      worktreeCount: this.worktrees.length,
      worktreesEnabled: this.workspace?.worktrees.enabled || false
    });

    // Auto-create worktrees if enabled (only if workspace is set)
    if (this.workspace && this.workspace.worktrees && this.workspace.worktrees.enabled && this.workspace.worktrees.autoCreate) {
      logger.info('Auto-creating worktrees for workspace');
      try {
        await this.worktreeHelper.ensureWorktreesExist(this.workspace);
      } catch (error) {
        logger.error('Failed to auto-create worktrees', { error: error.message, stack: error.stack });
      }
    }

    // Filter worktrees to only existing ones
    const fs = require('fs').promises;
    const existingWorktrees = [];
    const missingWorktrees = [];

    for (const worktree of this.worktrees) {
      try {
        await fs.access(worktree.path);
        existingWorktrees.push(worktree);
      } catch (error) {
        missingWorktrees.push(worktree.path);
      }
    }

    // Only use existing worktrees for session creation
    this.worktrees = existingWorktrees;

    if (missingWorktrees.length > 0) {
      logger.info('Skipping missing worktrees (will be created on-demand):', {
        missing: missingWorktrees,
        existing: existingWorktrees.length,
        workspace: this.workspace?.name || 'none'
      });
    }

    // If no workspace is set, skip session creation
    if (!this.workspace) {
      logger.warn('No workspace set, skipping session initialization');
      this.isWorkspaceSwitching = false;
      return;
    }

    // Check Claude CLI version before starting sessions
    const versionInfo = await ClaudeVersionChecker.checkVersion();
    if (!versionInfo.isCompatible) {
      const updateInfo = ClaudeVersionChecker.generateUpdateInstructions(versionInfo);
      logger.error('Claude CLI version incompatible', updateInfo);

      // Emit update requirement to clients
      this.io.emit('claude-update-required', updateInfo);
    }

    // Create all sessions in parallel for faster startup
    const sessionPromises = [];

    // Create sessions based on workspace type
    if (Array.isArray(this.workspace.terminals)) {
      // Mixed-repo workspace: Create sessions from terminals array
      const terminalsToCreate = this.workspace.terminals.filter(terminal => {
        // Check if worktree exists for this terminal's repo + worktree combination
        const worktreeKey = `${terminal.repository.name}-${terminal.worktree}`;
        return this.worktrees.some(w => w.id === worktreeKey);
      });

      for (const terminal of terminalsToCreate) {
        const worktreeKey = `${terminal.repository.name}-${terminal.worktree}`;
        const worktree = this.worktrees.find(w => w.id === worktreeKey);
        if (!worktree) continue;

        sessionPromises.push(
          Promise.resolve().then(() => {
            const sessionId = terminal.id;
            if (this.sessions.has(sessionId)) {
              return;
            }
            let command, args;
            const startCommand = String(terminal.startCommand || '').trim();
            const timeoutMs = Number.isFinite(terminal.timeoutMs) ? terminal.timeoutMs : undefined;

            if (terminal.terminalType === 'claude') {
              command = getDefaultShell();
              args = startCommand
                ? buildShellArgs([`cd "${worktree.path}"`, startCommand])
                : buildShellArgs(`cd "${worktree.path}"`);
            } else {
              // Server terminal
              command = getDefaultShell();
              const header = `=== ${terminal.repository.name}/${terminal.worktree} (${terminal.id}) ===`;
              if (startCommand) {
                args = buildShellArgs([
                  `cd "${worktree.path}"`,
                  `echo "${header}"`,
                  `echo "Directory: ${worktree.path}"`,
                  `echo ""`,
                  startCommand
                ]);
              } else {
                args = buildShellArgs([
                  `cd "${worktree.path}"`,
                  `echo "=== Server Terminal for ${terminal.repository.name}/${terminal.worktree} ==="`,
                  `echo "Directory: ${worktree.path}"`,
                  getShellKind() === 'powershell'
                    ? `$b = git branch --show-current 2>$null; if (-not $b) { $b = 'unknown' }; Write-Output "Branch: $b"`
                    : `echo "Branch: $(git branch --show-current 2>/dev/null || echo 'unknown')"`,
                  `echo ""`,
                  `echo "Ready to run: bun index.ts"`,
                  `echo "Available commands: bun, npm, node"`,
                  `echo ""`
                ]);
              }
            }

            this.createSession(sessionId, {
              command,
              args,
              cwd: worktree.path,
              type: terminal.terminalType,
              worktreeId: terminal.worktree,
              repositoryName: terminal.repository.name,
              repositoryType: terminal.repository.type,  // Add repository type for dynamic launch options
              timeoutMs
            });
          }).catch(error => {
            logger.error(`Failed to initialize ${terminal.terminalType} session`, {
              terminal: terminal.id,
              error: error.message
            });
          })
        );
      }
    } else {
      // Traditional single-repo workspace: Use old logic
      for (const worktree of this.worktrees) {
        // Add Claude session creation to promises array
        sessionPromises.push(
          Promise.resolve().then(() => {
            const sessionId = `${worktree.id}-claude`;
            if (this.sessions.has(sessionId)) {
              return;
            }
            this.createSession(sessionId, {
              command: getDefaultShell(),
              args: buildShellArgs(`cd "${worktree.path}"`),
              cwd: worktree.path,
              type: 'claude',
              worktreeId: worktree.id
            });
          }).catch(error => {
            logger.error('Failed to initialize Claude session', {
              worktree: worktree.id,
              error: error.message
            });
          })
        );

        // Add server session creation to promises array
        sessionPromises.push(
          Promise.resolve().then(() => {
            const sessionId = `${worktree.id}-server`;
            if (this.sessions.has(sessionId)) {
              return;
            }
            this.createSession(sessionId, {
              command: getDefaultShell(),
              args: buildShellArgs([
                `cd "${worktree.path}"`,
                `echo "=== Server Terminal for ${worktree.id} ==="`,
                `echo "Directory: ${worktree.path}"`,
                getShellKind() === 'powershell'
                  ? `$b = git branch --show-current 2>$null; if (-not $b) { $b = 'unknown' }; Write-Output "Branch: $b"`
                  : `echo "Branch: $(git branch --show-current 2>/dev/null || echo 'unknown')"`,
                `echo ""`,
                `echo "Ready to run: bun index.ts"`,
                `echo "Available commands: bun, npm, node"`,
                `echo ""`
              ]),
              cwd: worktree.path,
              type: 'server',
              worktreeId: worktree.id
            });
          }).catch(error => {
            logger.error('Failed to initialize server session', {
              worktree: worktree.id,
              error: error.message
            });
          })
        );

        // Add git branch update to promises array
        if (this.gitHelper) {
          sessionPromises.push(
            Promise.resolve().then(() => {
              return this.updateGitBranch(worktree.id, worktree.path);
            }).catch(error => {
              logger.error('Failed to update git branch', {
                worktree: worktree.id,
                error: error.message
              });
            })
          );
        }
      }
    }

    // Git branch updates for all worktrees (both traditional and mixed-repo)
    if (this.gitHelper) {
      for (const worktree of this.worktrees) {
        sessionPromises.push(
          Promise.resolve().then(() => {
            const worktreeIdForGit = worktree.worktreeId || worktree.id;
            return this.updateGitBranch(worktreeIdForGit, worktree.path);
          }).catch(error => {
            logger.error('Failed to update git branch', {
              worktree: worktree.id,
              error: error.message
            });
          })
        );
      }
    }
    
    // Wait for all sessions to be created in parallel
    await Promise.all(sessionPromises);
    logger.info('All sessions initialized', { count: sessionPromises.length });

    // Keep an authoritative reference from workspace id -> session map for tab switching.
    if (this.workspace?.id) {
      this.workspaceSessionMaps.set(this.workspace.id, this.sessions);
    }

    // Clear workspace switching flag
    this.isWorkspaceSwitching = false;
    
    // Start periodic branch refresh (every 30 seconds)
    this.startBranchRefresh();
    
    // Setup file watchers for instant branch detection
    this.setupGitWatchers();
  }
  
  startBranchRefresh() {
    if (this.branchRefreshInterval) {
      clearInterval(this.branchRefreshInterval);
    }

    const refreshWorktrees = () => {
      const refreshedPaths = new Set();
      const refreshPath = (worktreeId, cwd) => {
        const normalized = this.normalizeCwdPath(cwd);
        if (!normalized) return;
        if (refreshedPaths.has(normalized)) return;
        refreshedPaths.add(normalized);
        this.updateGitBranch(worktreeId, normalized, true);
      };

      this.worktrees.forEach(worktree => {
        if (!worktree?.id || !worktree?.path) return;

        // Ensure watchers eventually come online even if the worktree didn't exist at initial setup.
        if (!this.fileWatchers.has(worktree.id)) {
          this.setupGitWatcherForWorktree(worktree);
        }

        const worktreeIdForGit = worktree.worktreeId || worktree.id;
        refreshPath(worktreeIdForGit, worktree.path);
      });

      // Also refresh any "loose" sessions (not represented in this.worktrees).
      // This prevents branch labels from getting stuck on "unknown" when checkout happens
      // outside the Orchestrator terminal (e.g., in an external editor/terminal).
      for (const [sessionId, session] of this.sessions) {
        if (!session) continue;
        if (session.type !== 'claude' && session.type !== 'codex' && session.type !== 'server') continue;

        const branch = String(session.branch || '').trim();
        if (branch && branch !== 'unknown' && branch !== 'no-git') continue;

        const cwd = this.getSessionCwd(session) || session?.config?.cwd || null;
        if (!cwd) continue;

        refreshPath(session.worktreeId || sessionId, cwd);
      }
    };

    // Do an initial refresh immediately (don't wait for the first interval tick).
    refreshWorktrees();
    this.branchRefreshInterval = setInterval(refreshWorktrees, this.branchRefreshMs);
  }
  
  stopBranchRefresh() {
    if (this.branchRefreshInterval) {
      clearInterval(this.branchRefreshInterval);
      this.branchRefreshInterval = null;
    }
  }
  
	  setupGitWatchers() {
	    // Setup file watchers for each worktree's .git/HEAD file
	    this.worktrees.forEach(worktree => {
	      this.setupGitWatcherForWorktree(worktree);
	    });
	  }

	  setupGitWatcherForWorktree(worktree) {
	    try {
	      if (!worktree?.id || !worktree?.path) return;
	      if (this.fileWatchers.has(worktree.id)) return;

	      // Find the actual HEAD file location (handles both regular repos and worktrees)
	      const headPath = this.findHeadFile(worktree.path);
	      if (!headPath) {
	        logger.warn('No .git/HEAD file found for worktree', {
	          worktree: worktree.id,
	          searchedPaths: 'multiple locations'
	        });
	        return;
	      }

	      // Create a watcher for this HEAD file
	      const watcher = fs.watch(headPath, (eventType) => {
	        if (eventType === 'change' || eventType === 'rename') {
	          logger.info('👀 Detected .git/HEAD change', {
	            worktree: worktree.id,
	            eventType,
	            headPath,
	            timestamp: new Date().toISOString()
	          });

	          // On some platforms, a HEAD update may present as a rename (atomic replace).
	          // Re-arm the watcher so future updates keep firing.
	          if (eventType === 'rename') {
	            const existing = this.fileWatchers.get(worktree.id);
	            if (existing) {
	              try {
	                existing.close();
	              } catch {
	                // ignore
	              }
	            }
	            this.fileWatchers.delete(worktree.id);
	            setTimeout(() => {
	              this.setupGitWatcherForWorktree(worktree);
	            }, 200);
	          }

	          // Clear cache and update branch immediately
	          if (this.gitHelper) {
	            this.gitHelper.clearCacheForPath(worktree.path);
	          }

	          // Small delay to ensure the file write is complete
	          setTimeout(() => {
	            logger.debug('File watcher triggered branch update', { worktree: worktree.id });
	            const worktreeIdForGit = worktree.worktreeId || worktree.id;
	            this.updateGitBranch(worktreeIdForGit, worktree.path, true);
	          }, 50);
	        }
	      });

	      this.fileWatchers.set(worktree.id, watcher);
	      logger.info('Setup git watcher for worktree', {
	        worktree: worktree.id,
	        headPath
	      });
	    } catch (error) {
	      logger.error('Failed to setup git watcher', {
	        worktree: worktree?.id || null,
	        error: error.message
	      });
	    }
	  }
  
	  findHeadFile(repoPath) {
    // 1. Check for regular .git/HEAD (normal repository)
    const regularHeadPath = path.join(repoPath, '.git', 'HEAD');
    if (fs.existsSync(regularHeadPath)) {
      logger.debug('Found regular .git/HEAD', { path: regularHeadPath });
      return regularHeadPath;
    }
    
    // 2. Check if .git is a file (worktree)
    const gitPath = path.join(repoPath, '.git');
    if (fs.existsSync(gitPath) && fs.statSync(gitPath).isFile()) {
      try {
        // Read the .git file to get the actual git directory
        const gitFileContent = fs.readFileSync(gitPath, 'utf8').trim();
        const match = gitFileContent.match(/^gitdir:\s*(.+)$/);
        
        if (match) {
          let gitDir = match[1];
          
          // Handle relative paths
          if (!path.isAbsolute(gitDir)) {
            gitDir = path.resolve(repoPath, gitDir);
          }
          
          const worktreeHeadPath = path.join(gitDir, 'HEAD');
          if (fs.existsSync(worktreeHeadPath)) {
            logger.debug('Found worktree HEAD', { 
              repoPath,
              gitDir,
              headPath: worktreeHeadPath 
            });
            return worktreeHeadPath;
          }
        }
      } catch (error) {
        logger.warn('Failed to parse .git file', { 
          path: gitPath,
          error: error.message 
        });
      }
    }
    
    // 3. Try to find git directory using git command as fallback
    try {
      const { execFileSync } = require('child_process');
      let gitDir = String(execFileSync('git', ['rev-parse', '--git-dir'], {
        cwd: repoPath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        timeout: 3000,
        maxBuffer: 1024 * 1024
      }) || '').trim();

      if (gitDir && !path.isAbsolute(gitDir)) {
        gitDir = path.resolve(repoPath, gitDir);
      }

      const headPath = path.join(gitDir, 'HEAD');
      if (fs.existsSync(headPath)) {
        logger.debug('Found HEAD via git command', { 
          repoPath,
          gitDir,
          headPath 
        });
        return headPath;
      }
    } catch (error) {
      // Git command failed, not a git repository
      logger.debug('Git command failed', { 
        repoPath,
        error: error.message 
      });
    }
    
    return null;
  }
  
  cleanupGitWatchers() {
    // Clean up all file watchers
    this.fileWatchers.forEach((watcher, worktreeId) => {
      try {
        watcher.close();
        logger.debug('Closed git watcher', { worktree: worktreeId });
      } catch (error) {
        logger.error('Failed to close git watcher', { 
          worktree: worktreeId, 
          error: error.message 
        });
      }
    });
    this.fileWatchers.clear();
  }
  
  createSession(sessionId, config) {
    logger.info('Creating session', { sessionId, type: config.type });
    
    try {
      if (!pty) {
        logger.error('Cannot create session - node-pty unavailable', { sessionId, type: config.type });
        throw new Error('node-pty unavailable');
      }
      const homeDir = process.env.HOME || os.homedir();
      const env = {
        ...process.env,
        HOME: homeDir, // Use a stable home directory for Claude/Codex config resolution
        TERM: 'xterm-color'
      };
      // Remove CLAUDECODE so spawned terminals can launch Claude Code independently
      delete env.CLAUDECODE;

      // Preserve the existing Linux dev PATH hack, but never apply it on Windows (path separator differs).
      if (process.platform !== 'win32') {
        env.PATH = `${homeDir}/.nvm/versions/node/v22.16.0/bin:/snap/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}`;
        if (process.env.NODE_PATH) {
          env.NODE_PATH = process.env.NODE_PATH;
        }
      }

      const effectiveEnv = augmentProcessEnv(env);

      const ptyProcess = pty.spawn(
        config.command,
        config.args,
        this.buildPtyOptions(config, effectiveEnv)
      );

      const initialCwd = config.cwd || process.cwd();
      
      const session = {
        id: sessionId,
        pty: ptyProcess,
        type: config.type,
        worktreeId: config.worktreeId,
        repositoryName: config.repositoryName,  // For mixed-repo workspaces
        repositoryType: config.repositoryType,  // For dynamic launch options
        status: 'idle',
        branch: 'unknown',
        buffer: '',
        deliveredBufferLength: 0, // how much of `buffer` has been emitted to clients while active
        lastActivity: Date.now(),
        tokenUsage: 0,
        config: config,
        statusChangedAt: Date.now(),
        pendingStatus: null,
        pendingStatusTimer: null,
        cwdState: {
          current: initialCwd,
          previous: null,
          stack: []
        },
        autoStarted: false  // Track if auto-start has been triggered
      };
      
      // Set up inactivity timer (respect per-type timeout; 0 disables)
      const effectiveTimeout = this.getSessionTimeout(session);
      if (effectiveTimeout > 0) {
        session.inactivityTimer = this.resetInactivityTimer(session);
      } else {
        session.inactivityTimer = null;
      }
      
      // Handle output
      ptyProcess.onData((data) => {
        session.buffer += data;
        session.lastActivity = Date.now();
        this.handleTerminalOutputForSession(session, data);

        // Reset inactivity timer
        this.resetInactivityTimer(session);

        // Clamp delivered cursor if the buffer was truncated previously.
        if (session.deliveredBufferLength > session.buffer.length) {
          session.deliveredBufferLength = session.buffer.length;
        }

        // Emit to clients ONLY if this session is part of the active workspace map.
        // When a workspace is inactive, we keep its PTYs alive, but don't stream output
        // to the UI (avoids cross-workspace/tab contamination).
        const isActive = this.sessions.get(sessionId) === session;
        if (isActive) {
          this.io.emit('terminal-output', {
            sessionId,
            data,
            workspaceId: session.workspace || this.workspace?.id || null
          });
          session.deliveredBufferLength = session.buffer.length;
        }

        // Update status based on output.
        this.refreshSessionStatus(sessionId, session);
        
        // Keep buffer size manageable
        if (session.buffer.length > this.maxBufferSize) {
          session.buffer = session.buffer.slice(-Math.floor(this.maxBufferSize / 2));
          if (session.deliveredBufferLength > session.buffer.length) {
            session.deliveredBufferLength = session.buffer.length;
          }
        }
      });
      
      // Handle exit
      ptyProcess.onExit(({ exitCode, signal }) => {
        logger.info('Session exited', { sessionId, exitCode, signal });
        const workspaceId = session.workspace || this.workspace?.id || null;
        
        clearTimeout(session.inactivityTimer);
        if (session.pendingStatusTimer) {
          clearTimeout(session.pendingStatusTimer);
          session.pendingStatusTimer = null;
        }
        session.status = 'exited';
        this.emitStatusUpdate(sessionId, 'exited');
        
        const isActive = this.sessions.get(sessionId) === session;
        if (isActive) {
          // Notify clients
          this.io.emit('session-exited', {
            sessionId,
            exitCode,
            signal,
            workspaceId: session.workspace || this.workspace?.id || null
          });
        }
        
        // Auto-restart Claude sessions that exit from CTRL+C or other interrupts
        // This ensures the terminal remains usable after CTRL+C
        if (isActive && config.type === 'claude' && !this.isWorkspaceSwitching) {
          logger.info('Claude session exited, auto-restarting for usability', {
            sessionId,
            signal,
            exitCode
          });

          // This terminal is now plain shell; stale recovery agent markers
          // make the UI think an AI is still attached/running.
          if (workspaceId) {
            try {
              sessionRecoveryService.markAgentInactive(workspaceId, sessionId);
            } catch {
              // best-effort
            }
          }
          
          // Remove the old session
          this.sessions.delete(sessionId);
          
          // Restart after a short delay to allow cleanup
          setTimeout(() => {
            try {
              // Create a fresh bash session that user can interact with
              // User can then run 'claude' command again if desired
              const restartConfig = {
                ...config,
                command: getDefaultShell(),
                args: buildShellArgs(`cd "${config.cwd}" && echo "Claude session ended. Terminal ready for commands." && echo "Type 'claude' to start a new Claude session." && echo ""`)
              };
              
              this.createSession(sessionId, restartConfig);
              
              // After creating the bash session, emit restart event
              this.io.emit('session-restarted', {
                sessionId,
                workspaceId: session.workspace || this.workspace?.id || null
              });
              
              logger.info('Claude session restarted as interactive bash', { sessionId });
            } catch (error) {
              logger.error('Failed to restart Claude session', { 
                sessionId, 
                error: error.message 
              });
            }
          }, 500);
        } else {
          // For non-Claude sessions, just remove as before
          // Also clear recovery state: if the PTY exited normally, it should not keep showing up as "recoverable".
          if (workspaceId) {
            try {
              sessionRecoveryService.clearSession(workspaceId, sessionId);
            } catch {
              // best-effort
            }
          }
          this.sessions.delete(sessionId);
        }
      });
      
      // Add workspace ID to session
      session.workspace = this.workspace?.id || null;
      this.sessions.set(sessionId, session);

      if (session.workspace) {
        sessionRecoveryService.updateSession(session.workspace, sessionId, {
          sessionId,
          type: session.type,
          worktreeId: session.worktreeId,
          repositoryName: session.repositoryName,
          repositoryType: session.repositoryType,
          worktreePath: initialCwd,
          lastCwd: initialCwd
        });
      }
      
      // Monitor for fork bombs (every 5 seconds)
      session.processMonitor = setInterval(() => {
        this.checkProcessLimit(session);
        // Re-evaluate status even when there is no new output, so sessions can
        // transition out of "busy" after quiet periods.
        this.refreshSessionStatus(session.id, session);
      }, 5000);
      
    } catch (error) {
      logger.error('Failed to create session', {
        sessionId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Track session state for crash recovery based on executed commands.
   * Detects agent starts, conversation IDs, and server commands.
   */
  trackSessionState(sessionId, command, config, effectiveCwd = null, commandName = null, commandArgs = []) {
    const workspaceId = this.workspace?.id;
    if (!workspaceId || !command) return;

    const session = this.sessions.get(sessionId);
    if (!session) return;

    const cwd = effectiveCwd || this.getSessionCwd(session) || config?.cwd;
    const agent = this.detectAgentFromCommand(commandName, commandArgs, command);

    if (agent) {
      const mode = this.detectAgentMode(agent, commandName, commandArgs, command);
      logger.info('Detected agent command', { sessionId, agent, cwd, mode });

      sessionRecoveryService.updateAgent(workspaceId, sessionId, agent, mode);

      if (cwd) {
        sessionRecoveryService.updateSession(workspaceId, sessionId, {
          lastAgentCommand: this.truncateCommandForLog(command),
          lastAgentCwd: cwd,
          lastCwd: cwd
        });
      }

      if (agent === 'claude' && cwd) {
        const existingFiles = this.snapshotConversationFiles();
        logger.info('Snapshotted conversation files', { sessionId, count: existingFiles.size });

        const captureWorkspaceId = workspaceId;
        const captureSessionId = sessionId;
        const captureCwd = cwd;

        setTimeout(() => {
          try {
            this.captureConversationId(captureWorkspaceId, captureSessionId, captureCwd, existingFiles);
          } catch (error) {
            logger.error('captureConversationId threw error', { sessionId: captureSessionId, error: error.message, stack: error.stack });
          }
        }, 2000);
      }
    }

    // Detect /clear and /compact commands which affect conversation state
    // /clear creates a NEW conversation (fast) - use snapshot to find new file
    // /compact modifies existing conversation file (can take a while)
    if (/^\/clear\b/.test(command)) {
      const recovery = sessionRecoveryService.getSession(workspaceId, sessionId);
      if (recovery?.lastAgent === 'claude') {
        logger.info('Detected /clear command, re-capturing conversation', { sessionId });
        const existingFiles = this.snapshotConversationFiles();
        setTimeout(() => {
          this.captureConversationId(
            workspaceId,
            sessionId,
            recovery.lastAgentCwd || recovery.lastCwd || cwd,
            existingFiles
          );
        }, 2000);
      }
    } else if (/^\/compact\b/.test(command)) {
      const recovery = sessionRecoveryService.getSession(workspaceId, sessionId);
      if (recovery?.lastAgent === 'claude') {
        logger.info('Detected /compact command, re-capturing conversation after 2min', { sessionId });
        setTimeout(() => {
          this.captureConversationId(workspaceId, sessionId, recovery.lastAgentCwd || recovery.lastCwd || cwd);
        }, 120000);  // 2 minutes
      }
    }

    // Detect server commands
    const serverPatterns = [
      { pattern: /npm\s+(?:run\s+)?(?:start|dev|serve)/, cmd: 'npm start' },
      { pattern: /yarn\s+(?:run\s+)?(?:start|dev|serve)/, cmd: 'yarn start' },
      { pattern: /node\s+[\w\/\.]+/, cmd: 'node' },
      { pattern: /python\s+[\w\/\.]+/, cmd: 'python' },
      { pattern: /rails\s+s(?:erver)?/, cmd: 'rails server' },
      { pattern: /cargo\s+run/, cmd: 'cargo run' }
    ];

    if (config?.type === 'server' || session.type === 'server') {
      for (const { pattern, cmd } of serverPatterns) {
        if (pattern.test(command)) {
          sessionRecoveryService.updateServer(workspaceId, sessionId, cmd);
          if (cwd) {
            sessionRecoveryService.updateSession(workspaceId, sessionId, { lastCwd: cwd });
          }
          break;
        }
      }
    }
  }

  handleTerminalOutput(sessionId, data) {
    const session = this.sessions.get(sessionId);
    if (!session || !data) return;

    const oscCwd = this.extractOsc7Cwd(data);
    if (oscCwd) {
      this.updateSessionCwd(session, oscCwd, 'osc7');
    }
  }

  handleTerminalOutputForSession(session, data) {
    if (!session || !data) return;
    const oscCwd = this.extractOsc7Cwd(data);
    if (oscCwd) {
      this.updateSessionCwd(session, oscCwd, 'osc7');
    }
  }

  handleCommandExecution(sessionId, command) {
    const session = this.sessions.get(sessionId);
    if (!session || !command) return;

    const trimmed = command.trim();
    if (!trimmed) return;

    const parts = this.splitCommandChain(trimmed);
    for (const part of parts) {
      const tokens = this.tokenizeCommand(part);
      if (!tokens.length) continue;

      const details = this.extractCommandDetails(tokens);
      if (!details?.commandName) continue;

      const baseCommand = path.basename(details.commandName).toLowerCase();

      if (baseCommand === 'cd') {
        this.applyCdCommand(session, details.args);
        continue;
      }

      if (baseCommand === 'pushd') {
        this.applyPushdCommand(session, details.args);
        continue;
      }

      if (baseCommand === 'popd') {
        this.applyPopdCommand(session);
        continue;
      }

      this.handleGitCommand(session, baseCommand, details.args, part);

      const effectiveCwd = this.getSessionCwd(session);
      this.trackSessionState(sessionId, part, session.config || {}, effectiveCwd, baseCommand, details.args);
    }
  }

  handleGitCommand(session, baseCommand, args, command) {
    if (!session || baseCommand !== 'git') return;

    const subCommand = (args[0] || '').toLowerCase();
    const normalizedSub = subCommand === 'co' ? 'checkout' : subCommand === 'sw' ? 'switch' : subCommand;
    const gitCommands = [
      'checkout',
      'switch',
      'branch',
      'merge',
      'pull',
      'fetch',
      'rebase',
      'reset',
      'cherry-pick'
    ];

    if (!gitCommands.includes(normalizedSub)) {
      return;
    }

    logger.info('🎉 Detected git command execution', {
      sessionId: session.id,
      command: command.substring(0, 50),
      worktreeId: session.worktreeId,
      timestamp: new Date().toISOString()
    });

    if (this.gitHelper) {
      this.gitHelper.clearCacheForPath(this.getSessionCwd(session));
    }

    const delay = /pull|fetch|merge/.test(command) ? 500 : 200;
    setTimeout(() => {
      logger.info('⏰ Triggering branch update after git command', {
        sessionId: session.id,
        worktreeId: session.worktreeId,
        delay: `${delay}ms`
      });
      this.updateGitBranch(session.worktreeId, this.getSessionCwd(session), true);
    }, delay);
  }

  splitCommandChain(command) {
    const parts = [];
    let current = '';
    let quote = null;
    let escape = false;

    for (let i = 0; i < command.length; i++) {
      const ch = command[i];

      if (escape) {
        current += ch;
        escape = false;
        continue;
      }

      if (ch === '\\') {
        escape = true;
        current += ch;
        continue;
      }

      if (quote) {
        if (ch === quote) {
          quote = null;
        }
        current += ch;
        continue;
      }

      if (ch === '"' || ch === "'") {
        quote = ch;
        current += ch;
        continue;
      }

      if (ch === ';') {
        if (current.trim()) {
          parts.push(current.trim());
        }
        current = '';
        continue;
      }

      if (ch === '&' && command[i + 1] === '&') {
        if (current.trim()) {
          parts.push(current.trim());
        }
        current = '';
        i += 1;
        continue;
      }

      current += ch;
    }

    if (current.trim()) {
      parts.push(current.trim());
    }

    return parts;
  }

  tokenizeCommand(command) {
    const tokens = [];
    let current = '';
    let quote = null;
    let escape = false;

    for (let i = 0; i < command.length; i++) {
      const ch = command[i];

      if (escape) {
        current += ch;
        escape = false;
        continue;
      }

      if (ch === '\\') {
        escape = true;
        continue;
      }

      if (quote) {
        if (ch === quote) {
          quote = null;
        } else {
          current += ch;
        }
        continue;
      }

      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }

      if (/\s/.test(ch)) {
        if (current) {
          tokens.push(current);
          current = '';
        }
        continue;
      }

      current += ch;
    }

    if (current) {
      tokens.push(current);
    }

    return tokens;
  }

  extractCommandDetails(tokens) {
    let index = 0;

    while (index < tokens.length && this.isEnvAssignment(tokens[index])) {
      index += 1;
    }

    if (tokens[index] === 'env') {
      index += 1;
      while (index < tokens.length && this.isEnvAssignment(tokens[index])) {
        index += 1;
      }
    }

    if (['command', 'builtin', 'exec'].includes(tokens[index])) {
      index += 1;
    }

    if (['sudo', 'doas'].includes(tokens[index])) {
      index += 1;
      while (index < tokens.length && tokens[index].startsWith('-')) {
        index += 1;
      }
    }

    const commandName = tokens[index];
    const args = tokens.slice(index + 1);

    return { commandName, args };
  }

  isEnvAssignment(token) {
    return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
  }

  applyCdCommand(session, args) {
    const target = this.resolveCdTarget(session, args);
    if (!target) return;

    if (!fs.existsSync(target)) return;

    this.updateSessionCwd(session, target, 'cd');
  }

  applyPushdCommand(session, args) {
    const target = this.resolveCdTarget(session, args);
    if (!target) return;

    if (!fs.existsSync(target)) return;

    const state = session.cwdState || { current: session.config?.cwd || process.cwd(), previous: null, stack: [] };
    state.stack = state.stack || [];
    state.stack.push(state.current);
    this.updateSessionCwd(session, target, 'pushd');
  }

  applyPopdCommand(session) {
    const state = session.cwdState;
    if (!state?.stack || state.stack.length === 0) return;

    const target = state.stack.pop();
    if (!target) return;

    this.updateSessionCwd(session, target, 'popd');
  }

  resolveCdTarget(session, args = []) {
    const state = session.cwdState || { current: session.config?.cwd || process.cwd(), previous: null, stack: [] };
    session.cwdState = state;

    const home = HOME_DIR;
    const targetArg = args.find(arg => arg === '-' || !arg.startsWith('-'));
    const rawTarget = targetArg || home;

    if (!rawTarget) return null;

    if (rawTarget === '-') {
      return state.previous || state.current;
    }

    if (rawTarget === '~' || rawTarget.startsWith('~/')) {
      return path.join(home, rawTarget.replace(/^~\/?/, ''));
    }

    if (rawTarget.startsWith('$HOME')) {
      return path.join(home, rawTarget.replace(/^\$HOME\/?/, ''));
    }

    if (rawTarget.startsWith('${HOME}')) {
      return path.join(home, rawTarget.replace(/^\$\{HOME\}\/?/, ''));
    }

    if (path.isAbsolute(rawTarget)) {
      return rawTarget;
    }

    return path.resolve(state.current || home, rawTarget);
  }

  getSessionCwd(session) {
    return session?.cwdState?.current || session?.config?.cwd || process.cwd();
  }

  updateSessionCwd(session, cwd, source = 'unknown') {
    if (!session || !cwd) return;

    const normalized = path.resolve(cwd);
    const state = session.cwdState || { current: session.config?.cwd || process.cwd(), previous: null, stack: [] };

    if (state.current === normalized) {
      session.cwdState = state;
      return;
    }

    state.previous = state.current;
    state.current = normalized;
    session.cwdState = state;

    if (session.workspace) {
      sessionRecoveryService.updateSession(session.workspace, session.id, {
        lastCwd: normalized,
        lastCwdSource: source
      });
    }
  }

  detectAgentFromCommand(commandName, commandArgs = [], fullCommand = '') {
    if (!commandName && fullCommand) {
      const tokens = this.tokenizeCommand(fullCommand);
      const details = this.extractCommandDetails(tokens);
      if (details?.commandName) {
        return this.detectAgentFromCommand(details.commandName, details.args, fullCommand);
      }
      return null;
    }

    if (!commandName) return null;

    const base = path.basename(commandName).toLowerCase();
    const knownAgents = new Map();

    if (this.agentManager) {
      for (const agent of this.agentManager.getAllAgents()) {
        if (!agent?.baseCommand) continue;
        const agentBase = path.basename(agent.baseCommand).toLowerCase();
        knownAgents.set(agentBase, agent.id);
      }
    }

    knownAgents.set('opencode', 'opencode');
    knownAgents.set('aider', 'aider');

    if (knownAgents.has(base)) {
      return knownAgents.get(base);
    }

    const wrapperCommands = ['npx', 'bunx', 'pnpm', 'yarn', 'npm'];
    if (wrapperCommands.includes(base) && commandArgs.length > 0) {
      let candidate = commandArgs[0];

      if ((base === 'npm' || base === 'pnpm') && candidate === 'exec') {
        candidate = commandArgs[1];
      } else if (base === 'pnpm' && candidate === 'dlx') {
        candidate = commandArgs[1];
      }

      if (candidate) {
        const candidateBase = path.basename(candidate).toLowerCase();
        if (knownAgents.has(candidateBase)) {
          return knownAgents.get(candidateBase);
        }
      }
    }

    return null;
  }

  detectAgentMode(agent, commandName, commandArgs = [], fullCommand = '') {
    if (!agent) return null;

    const lower = fullCommand.toLowerCase();
    if (lower.includes('--continue')) return 'continue';
    if (lower.includes('--resume')) return 'resume';

    const base = (commandName || '').toLowerCase();
    if ((base === 'codex' || base === 'claude') && commandArgs.length > 0) {
      const firstArg = commandArgs[0].toLowerCase();
      if (firstArg === 'resume') return 'resume';
      if (firstArg === 'continue') return 'continue';
    }

    return 'fresh';
  }

  truncateCommandForLog(command) {
    if (!command) return '';
    return command.length > 120 ? `${command.slice(0, 117)}...` : command;
  }

  sanitizeInputData(data) {
    if (!data) return '';
    let sanitized = data.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
    sanitized = sanitized.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '');
    sanitized = sanitized.replace(/\x1b[()][A-Za-z0-9]/g, '');
    return sanitized;
  }

  extractOsc7Cwd(data) {
    const regex = /\x1b]7;file:\/\/([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
    let match;
    let latest = null;

    while ((match = regex.exec(data)) !== null) {
      const uri = match[1];
      if (!uri) continue;

      let pathStart = uri.indexOf('/');
      if (pathStart === -1) continue;

      let cwd = uri.slice(pathStart);
      const homeIndex = cwd.indexOf('/home/');
      if (homeIndex >= 0) {
        cwd = cwd.slice(homeIndex);
      }

      try {
        cwd = decodeURIComponent(cwd);
      } catch (error) {
        // Ignore decode errors, use raw path
      }

      latest = cwd;
    }

    return latest;
  }

  /**
   * Snapshot all existing conversation files
   * Used to detect NEW files created after Claude starts
   * Returns a Set of full paths
   */
  snapshotConversationFiles() {
    const fsSync = require('fs');
    const projectsBase = path.join(HOME_DIR, '.claude', 'projects');
    const existing = new Set();
    const now = Date.now();

    if (this.conversationSnapshotCache.files && (now - this.conversationSnapshotCache.timestamp) < this.conversationSnapshotTtlMs) {
      return this.conversationSnapshotCache.files;
    }

    try {
      if (!fsSync.existsSync(projectsBase)) {
        return existing;
      }

      const folders = fsSync.readdirSync(projectsBase, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

      for (const folder of folders) {
        const projectsDir = path.join(projectsBase, folder);
        try {
          const files = fsSync.readdirSync(projectsDir)
            .filter(f => f.endsWith('.jsonl'));
          for (const file of files) {
            existing.add(path.join(projectsDir, file));
          }
        } catch (error) {
          // Skip folders we can't read
        }
      }
    } catch (error) {
      logger.debug('Error snapshotting conversation files', { error: error.message });
    }

    this.conversationSnapshotCache = { timestamp: now, files: existing };
    return existing;
  }

  /**
   * Convert a path to Claude's folder name format
	   * $HOME/foo → -home-user-foo
   */
  pathToFolderName(p) {
    if (!p) return '';
    return String(p).replace(/[\\/]/g, '-');
  }

  /**
   * Capture the conversation ID for a terminal at the moment Claude starts
   * Scans folders in ~/.claude/projects/ for NEW or recently modified .jsonl files
   * Uses existingFiles snapshot to identify truly NEW files (avoids race conditions)
   *
   * IMPORTANT: We can convert path → folder name, but NOT the reverse (lossy)
   * So we check against known paths (worktree, parent, home) and match folder names
   */
  captureConversationId(workspaceId, sessionId, worktreePath, existingFiles = null) {
    if (!workspaceId || !sessionId || !worktreePath) {
      logger.debug('captureConversationId skipped (missing info)', { workspaceId, sessionId, worktreePath });
      return;
    }

    logger.info('captureConversationId called', { workspaceId, sessionId, worktreePath });
    const fsSync = require('fs');
    const now = Date.now();
    const projectsBase = path.join(HOME_DIR, '.claude', 'projects');

    // Build a map of folder names to actual paths
    // Include ALL paths from worktree up to home (entire hierarchy)
    const folderToPath = new Map();
    const home = HOME_DIR;

    // Add all parent paths from worktreePath up to home
    let current = worktreePath;
    while (current && current.length >= home.length) {
      folderToPath.set(this.pathToFolderName(current), current);
      const parent = path.dirname(current);
      if (parent === current) break;  // Reached root
      current = parent;
    }

    // Also add ~/.claude in case user starts from there
    const claudeDir = path.join(home, '.claude');
    folderToPath.set(this.pathToFolderName(claudeDir), claudeDir);

    let bestMatch = null;
    const newFiles = [];

    try {
      if (!fsSync.existsSync(projectsBase)) {
        logger.debug('Claude projects folder not found', { projectsBase });
        return;
      }

      // Scan folders in ~/.claude/projects/
      const folders = fsSync.readdirSync(projectsBase, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

      for (const folder of folders) {
        const projectsDir = path.join(projectsBase, folder);

        // Determine the actual CWD for this folder
        // If we know the path, use it; otherwise use worktreePath as fallback
        const actualCwd = folderToPath.get(folder) || worktreePath;

        try {
          // Find .jsonl files WITH CONTENT (size > 0)
          const files = fsSync.readdirSync(projectsDir)
            .filter(f => f.endsWith('.jsonl'))
            .map(f => {
              const fullPath = path.join(projectsDir, f);
              const stats = fsSync.statSync(fullPath);
              const isNew = existingFiles ? !existingFiles.has(fullPath) : false;
              return {
                name: f,
                fullPath: fullPath,
                size: stats.size,
                mtime: stats.mtime.getTime(),
                age: now - stats.mtime.getTime(),
                cwd: actualCwd,
                folder: folder,
                isNew: isNew,
                isKnownPath: folderToPath.has(folder)
              };
            })
            .filter(f => f.size > 0);  // ONLY files with actual content

          // Prefer NEW files (didn't exist before), otherwise use recently modified
          for (const file of files) {
            if (file.isNew) {
              newFiles.push(file);
            } else if (file.age < 30000) {  // Modified in last 30 seconds
              if (!bestMatch || file.age < bestMatch.age) {
                bestMatch = file;
              }
            }
          }
        } catch (error) {
          // Skip folders we can't read
        }
      }
    } catch (error) {
      logger.error('Error scanning projects folders', { error: error.message });
      return;
    }

    // Prefer NEW files over modified files
    if (newFiles.length > 0) {
      // If multiple new files, prefer ones from known paths, then by age
      newFiles.sort((a, b) => {
        if (a.isKnownPath !== b.isKnownPath) {
          return b.isKnownPath ? 1 : -1;  // Known paths first
        }
        return a.age - b.age;  // Then by age
      });
      bestMatch = newFiles[0];
      logger.debug('Found NEW conversation file', {
        sessionId,
        newFilesCount: newFiles.length,
        picked: bestMatch.name,
        isKnownPath: bestMatch.isKnownPath
      });
    }

    if (!bestMatch) {
      logger.debug('No recent conversation file found', { sessionId, worktreePath });
      return;
    }

    const conversationId = bestMatch.name.replace('.jsonl', '');
    logger.info('Captured conversation ID for session', {
      sessionId,
      conversationId,
      actualCwd: bestMatch.cwd,
      folder: bestMatch.folder,
      worktreePath,
      age: bestMatch.age,
      isNew: bestMatch.isNew,
      isKnownPath: bestMatch.isKnownPath
    });

    sessionRecoveryService.updateSession(workspaceId, sessionId, {
      lastConversationId: conversationId,
      lastCwd: bestMatch.cwd
    });
  }

  writeToSession(sessionId, data) {
    const session = this.getSessionById(sessionId);
    if (!session || !session.pty) {
      logger.warn('Attempted to write to invalid session', { sessionId });
      return false;
    }
    
    try {
      let payload = data;
      // PowerShell terminals need CRLF to reliably execute commands written programmatically.
      if (typeof payload === 'string') {
        const shellKind = this.getShellKindForSession(sessionId);
        if (shellKind === 'powershell') {
          payload = payload.replace(/\r?\n/g, '\r\n');
        }
      }
      session.pty.write(payload);
      session.lastActivity = Date.now();
      
      // Reset inactivity timer on any user input to keep the session alive
      this.resetInactivityTimer(session);
      
      // If was waiting and user provided input, mark as busy
      if (session.status === 'waiting' && session.type === 'claude') {
        // Cancel any pending status flip (prevents "busy→waiting" flicker after input)
        if (session.pendingStatusTimer) {
          clearTimeout(session.pendingStatusTimer);
          session.pendingStatusTimer = null;
        }
        session.pendingStatus = null;

        // Use centralized status update so statusChangedAt stays accurate
        this.applyStatusUpdate(sessionId, session, 'busy');
      }
      
      if (!session.currentCommand) {
        session.currentCommand = '';
      }

      const sanitizedInput = this.sanitizeInputData(data);
      for (const char of sanitizedInput) {
        if (char === '\r' || char === '\n') {
          const command = session.currentCommand.trim();
          if (command) {
            this.handleCommandExecution(sessionId, command);
          }
          session.currentCommand = '';
          continue;
        }

        if (char === '\x7f' || char === '\b') {
          if (session.currentCommand.length > 0) {
            session.currentCommand = session.currentCommand.slice(0, -1);
          }
          continue;
        }

        if (char === '\x03') {
          session.currentCommand = '';
          continue;
        }

        if (char.length === 1 && char.charCodeAt(0) >= 32) {
          session.currentCommand += char;
        }
      }
      
      return true;
    } catch (error) {
      logger.error('Failed to write to session', { 
        sessionId, 
        error: error.message 
      });
      return false;
    }
  }

  /**
   * Ensure sessions exist for a workspace without switching the active UI tab.
   * Used for background/service workspaces (e.g., Discord bot + processors).
   */
  async ensureWorkspaceSessions(workspace) {
    if (!workspace?.id) {
      throw new Error('Workspace missing id');
    }

    const workspaceId = workspace.id;
    if (!this.workspaceSessionMaps.has(workspaceId)) {
      this.workspaceSessionMaps.set(workspaceId, new Map());
    }

    const targetMap = this.workspaceSessionMaps.get(workspaceId);
    const previous = {
      workspace: this.workspace,
      worktrees: this.worktrees,
      sessions: this.sessions,
      isWorkspaceSwitching: this.isWorkspaceSwitching
    };

    try {
      this.sessions = targetMap;
      this.workspace = workspace;
      this.buildWorktreesFromWorkspace();
      await this.initializeSessions({ preserveExisting: true });
    } finally {
      this.workspace = previous.workspace;
      this.worktrees = previous.worktrees;
      this.sessions = previous.sessions;
      this.isWorkspaceSwitching = previous.isWorkspaceSwitching;
    }

    return {
      workspaceId,
      sessionIds: Array.from(targetMap.keys())
    };
  }
  
  resizeSession(sessionId, cols, rows) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.pty) {
      return false;
    }

    try {
      // Check if PTY is still valid before resizing
      if (session.pty.killed) {
        if (!session.resizeDeadLogged) {
          logger.warn('PTY session is dead, skipping resize', { sessionId });
          session.resizeDeadLogged = true;
        }
        if (session.status !== 'dead') {
          session.status = 'dead';
          this.emitStatusUpdate(sessionId, 'dead');
        }
        session.pty = null;
        return false;
      }

      session.pty.resize(cols, rows);
      return true;
    } catch (error) {
      // Handle ENOTTY/EBADF errors gracefully - these mean the PTY is dead
      if (error.code === 'ENOTTY' || error.code === 'EBADF') {
        if (!session.resizeDeadLogged) {
          logger.warn('PTY session has invalid file descriptor, cleaning up', {
            sessionId,
            error: error.code
          });
          session.resizeDeadLogged = true;
        }

        // Mark session as dead and clean up
        session.status = 'dead';
        this.emitStatusUpdate(sessionId, 'dead');
        session.pty = null;

        return false;
      }

      logger.error('Failed to resize session', {
        sessionId,
        error: error.message
      });
      return false;
    }
  }
  
  normalizeCwdPath(cwdPath) {
    if (typeof cwdPath !== 'string' || cwdPath.length === 0) {
      return cwdPath;
    }
    try {
      return path.resolve(cwdPath);
    } catch (error) {
      return cwdPath;
    }
  }

  isSameOrSubpath(parentPath, childPath) {
    const parent = this.normalizeCwdPath(parentPath);
    const child = this.normalizeCwdPath(childPath);
    if (!parent || !child) return false;
    if (parent === child) return true;

    const rel = path.relative(parent, child);
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  }

  pathsOverlap(a, b) {
    return this.isSameOrSubpath(a, b) || this.isSameOrSubpath(b, a);
  }

  async updateGitBranch(worktreeId, worktreePath, skipCache = false) {
    logger.info('🔄 updateGitBranch called', { 
      worktreeId, 
      path: worktreePath, 
      skipCache,
      timestamp: new Date().toISOString()
    });
    
    if (!this.gitHelper) {
      logger.warn('⚠️ No gitHelper available');
      return;
    }
    
    try {
      const branch = await this.gitHelper.getCurrentBranch(worktreePath, skipCache);
      const remoteUrl = await this.gitHelper.getRemoteUrl(worktreePath);
      const defaultBranch = await this.gitHelper.getDefaultBranch(worktreePath);
      
      // Check for existing PR for this branch
      const existingPR = await this.gitHelper.checkForExistingPR(remoteUrl, branch);
      
      // Update claude/codex/server sessions for this worktree
      // For mixed-repo workspaces, session IDs have workspace prefix (e.g., "mixed-terminals-work1-claude")
      // For traditional workspaces, session IDs are just worktreeId-type (e.g., "work1-claude")
      // So we need to search through sessions to find matching ones
      const sessionsToUpdate = new Set();

      // First try direct match (traditional workspaces)
      const claudeId = `${worktreeId}-claude`;
      const codexId = `${worktreeId}-codex`;
      const serverId = `${worktreeId}-server`;
      if (this.sessions.has(claudeId)) sessionsToUpdate.add(claudeId);
      if (this.sessions.has(codexId)) sessionsToUpdate.add(codexId);
      if (this.sessions.has(serverId)) sessionsToUpdate.add(serverId);

      // If no direct match, search by worktreeId AND path (mixed-repo workspaces)
      // Important: Must match both worktreeId AND path to avoid cross-contamination
      const normalizedWorktreePath = this.normalizeCwdPath(worktreePath);
      if (sessionsToUpdate.size === 0) {
        for (const [sessionId, session] of this.sessions) {
          // Check if this session belongs to the same worktree by comparing paths
          if (session.worktreeId === worktreeId && session.config &&
            this.pathsOverlap(session.config.cwd, normalizedWorktreePath)) {
            sessionsToUpdate.add(sessionId);
          }
        }
      }

      // Final fallback: match by path only.
      // This handles cases where the worktreeId used for watchers/refresh differs from the
      // session's stored worktreeId, but the cwd is authoritative.
      if (sessionsToUpdate.size === 0) {
        for (const [sessionId, session] of this.sessions) {
          if (!session?.config?.cwd) continue;
          if (!this.pathsOverlap(session.config.cwd, normalizedWorktreePath)) continue;
          if (session.type !== 'claude' && session.type !== 'codex' && session.type !== 'server') continue;
          sessionsToUpdate.add(sessionId);
        }
      }

      sessionsToUpdate.forEach(sessionId => {
        const session = this.sessions.get(sessionId);
        if (session) {
          const hasChanges = session.branch !== branch ||
            session.remoteUrl !== remoteUrl ||
            session.defaultBranch !== defaultBranch ||
            session.existingPR !== existingPR;

          if (!hasChanges) {
            return;
          }

          const oldBranch = session.branch;
          session.branch = branch;
          session.remoteUrl = remoteUrl;
          session.defaultBranch = defaultBranch;
          session.existingPR = existingPR;

          logger.debug('Branch update', { sessionId, oldBranch, newBranch: branch });

          this.io.emit('branch-update', {
            sessionId,
            branch,
            remoteUrl,
            defaultBranch,
            existingPR,
            workspaceId: session.workspace || this.workspace?.id || null
          });
        }
      });
    } catch (error) {
      logger.error('❌ Failed to update git branch', { 
        worktreeId, 
        path: worktreePath,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  refreshSessionStatus(sessionId, session) {
    if (!this.statusDetector || !session) return;

    const type = String(session.type || '').trim().toLowerCase();
    if (type !== 'claude' && type !== 'codex') return;

    const workspaceId = String(session.workspace || '').trim();
    const recovery = workspaceId
      ? sessionRecoveryService.getSession(workspaceId, sessionId)
      : null;
    const agentActive = recovery?.lastAgentActive !== false;
    const agent = agentActive
      ? (recovery?.lastAgent || (type === 'codex' ? 'codex' : null))
      : null;

    const newStatus = this.statusDetector.detectStatus(sessionId, session.buffer || '', { agent });
    if (newStatus === 'idle' && workspaceId && recovery?.lastAgent) {
      const recentOutput = this.statusDetector.stripControlSequences((session.buffer || '').slice(-2000));
      const recentLines = recentOutput.split('\n');
      const lastNonEmptyLine = this.statusDetector.getLastNonEmptyLine(recentLines).trim();
      const recentAll = this.statusDetector.getLastNonEmptyLines(recentLines, 6).join('\n');
      if (this.statusDetector.hasExplicitShellIndicator(recentAll, lastNonEmptyLine)) {
        try {
          sessionRecoveryService.markAgentInactive(workspaceId, sessionId);
        } catch {
          // best-effort cleanup; status update still proceeds
        }
      }
    }

    if (newStatus !== session.status) {
      this.maybeApplyStatusUpdate(sessionId, session, newStatus);
    } else if (session.pendingStatus && session.pendingStatus !== newStatus) {
      // Detector re-affirmed the current status; cancel any stale pending transition.
      if (session.pendingStatusTimer) {
        clearTimeout(session.pendingStatusTimer);
        session.pendingStatusTimer = null;
      }
      session.pendingStatus = null;
      session.pendingStatusDueAt = null;
    }
  }
  
  maybeApplyStatusUpdate(sessionId, session, newStatus) {
    const now = Date.now();
    const lastChange = session.statusChangedAt || 0;
    const elapsed = now - lastChange;
    const effectiveHoldMs = (newStatus === 'idle')
      ? Math.max(this.statusMinHoldMs, this.statusIdleHoldMs)
      : this.statusMinHoldMs;

    if (elapsed < effectiveHoldMs) {
      const dueAt = lastChange + effectiveHoldMs;
      session.pendingStatus = newStatus;
      session.pendingStatusDueAt = dueAt;
      const delay = Math.max(0, dueAt - now);
      if (session.pendingStatusTimer) {
        // If the desired due time changed (e.g., longer idle hysteresis), reschedule.
        const existingDue = Number(session.pendingStatusDueAt || 0);
        if (existingDue !== dueAt) {
          clearTimeout(session.pendingStatusTimer);
          session.pendingStatusTimer = null;
        }
      }
      if (!session.pendingStatusTimer) {
        session.pendingStatusTimer = setTimeout(() => {
          const currentSession = this.sessions.get(sessionId);
          if (!currentSession) return;
          const pending = currentSession.pendingStatus;
          currentSession.pendingStatus = null;
          currentSession.pendingStatusDueAt = null;
          currentSession.pendingStatusTimer = null;
          if (pending && pending !== currentSession.status) {
            this.applyStatusUpdate(sessionId, currentSession, pending);
          }
        }, delay);
      }
      return;
    }

    this.applyStatusUpdate(sessionId, session, newStatus);
  }

  applyStatusUpdate(sessionId, session, newStatus) {
    // Clear any pending transition; this update is authoritative.
    if (session.pendingStatusTimer) {
      clearTimeout(session.pendingStatusTimer);
      session.pendingStatusTimer = null;
    }
    session.pendingStatus = null;
    session.pendingStatusDueAt = null;

    const oldStatus = session.status;
    session.status = newStatus;
    session.statusChangedAt = Date.now();
    this.emitStatusUpdate(sessionId, newStatus);

    if (newStatus === 'waiting') {
      this.io.emit('notification-trigger', {
        sessionId,
        type: 'waiting',
        message: `Claude ${session.worktreeId} needs your input`,
        branch: session.branch
      });

      const effectiveSettings = this.userSettings.getEffectiveSettings(sessionId);
      if (effectiveSettings.autoStart && effectiveSettings.autoStart.enabled && !session.autoStarted) {
        session.autoStarted = true;

        const delay = effectiveSettings.autoStart.delay || 500;
        const mode = effectiveSettings.autoStart.mode || 'fresh';
        const skipPermissions = effectiveSettings.claudeFlags.skipPermissions || false;

        logger.info('Auto-starting Claude session', {
          sessionId,
          mode,
          delay,
          skipPermissions
        });

        session.autoStartTimer = setTimeout(() => {
          const currentSession = this.sessions.get(sessionId);
          if (!currentSession || currentSession !== session) {
            return;
          }
          if (currentSession.status === 'exited' || currentSession.status === 'dead') {
            return;
          }
          this.startClaudeWithOptions(sessionId, {
            mode: mode,
            skipPermissions: skipPermissions
          });
        }, delay);
      }
    }

    logger.info('Session status changed', {
      sessionId,
      oldStatus,
      newStatus
    });
  }

  emitStatusUpdate(sessionId, status) {
    // Only emit status updates for sessions in the active workspace map.
    if (!this.sessions.has(sessionId)) return;
    const session = this.sessions.get(sessionId);
    this.io.emit('status-update', {
      sessionId,
      status,
      workspaceId: session?.workspace || this.workspace?.id || null
    });
  }

  getUndeliveredOutputAndMarkDelivered(maxBytesPerSession = 100000) {
    const output = {};
    for (const [id, session] of this.sessions) {
      const delivered = Math.max(0, Math.min(session.deliveredBufferLength || 0, session.buffer.length));
      const delta = session.buffer.slice(delivered);
      if (!delta) {
        session.deliveredBufferLength = session.buffer.length;
        continue;
      }
      output[id] = delta.length > maxBytesPerSession ? delta.slice(-maxBytesPerSession) : delta;
      session.deliveredBufferLength = session.buffer.length;
    }
    return output;
  }
  
  getSessionStates() {
    const states = {};
    for (const [id, session] of this.sessions) {
      const recovery = session.workspace ? sessionRecoveryService.getSession(session.workspace, id) : null;
      states[id] = {
        status: session.status,
        branch: session.branch,
        remoteUrl: session.remoteUrl,
        defaultBranch: session.defaultBranch,
        existingPR: session.existingPR,
        type: session.type,
        worktreeId: session.worktreeId,
        repositoryName: session.repositoryName,  // For mixed-repo workspaces
        repositoryType: session.repositoryType,  // For dynamic launch options
        workspace: session.workspace || this.workspace?.id || null,
        agent: recovery?.lastAgentActive === false ? null : (recovery?.lastAgent || null),
        agentMode: recovery?.lastMode || null,
        lastActivity: session.lastActivity
      };
    }
    return states;
  }

  /**
   * Create sessions for a single worktree without destroying existing sessions.
   * Used when adding a new worktree to an existing workspace.
   * @param {Object} worktreeInfo - Info about the worktree to add
   * @param {string} worktreeInfo.worktreeId - e.g., 'work5'
   * @param {string} worktreeInfo.worktreePath - Full path to worktree
   * @param {string} [worktreeInfo.repositoryName] - For mixed-repo workspaces
   * @param {string} [worktreeInfo.repositoryType] - For dynamic launch options
   * @param {boolean} [worktreeInfo.includeExistingSessions] - Include existing session states in response
   * @returns {Object} Map of sessionId -> sessionState for created (and optionally existing) sessions
   */
	  async createSessionsForWorktree(worktreeInfo) {
	    const {
	      worktreeId,
	      worktreePath,
	      repositoryName,
	      repositoryType,
	      includeExistingSessions = false
	    } = worktreeInfo;
	    const newSessions = {};

	    const includeSessionState = (sessionId) => {
	      const currentSession = this.sessions.get(sessionId);
	      if (!currentSession) return;
	      newSessions[sessionId] = {
	        status: currentSession.status,
	        branch: currentSession.branch,
	        type: currentSession.type,
	        worktreeId: currentSession.worktreeId,
	        repositoryName: currentSession.repositoryName,
	        repositoryType: currentSession.repositoryType,
	        workspace: currentSession.workspace || this.workspace?.id || null
	      };
	    };

	    logger.info('Creating sessions for new worktree', { worktreeId, worktreePath, repositoryName });

	    // Ensure this worktree is tracked for branch refresh + HEAD watchers.
	    // Otherwise, branch labels/colors may only update after a git command is run inside the Orchestrator terminal.
	    const worktreeKey = repositoryName ? `${repositoryName}-${worktreeId}` : worktreeId;
	    const existingWorktree = this.worktrees.find(w => w.id === worktreeKey) || null;
	    if (!existingWorktree) {
	      this.worktrees.push({
	        id: worktreeKey,
	        worktreeId,
	        repositoryName,
	        repositoryType,
	        path: worktreePath
	      });
	    } else if (existingWorktree.path !== worktreePath) {
	      existingWorktree.path = worktreePath;
	    }

	    const trackedWorktree = this.worktrees.find(w => w.id === worktreeKey) || existingWorktree;
	    if (trackedWorktree) {
	      this.setupGitWatcherForWorktree(trackedWorktree);
	    }

	    // Determine session IDs based on workspace type
	    let claudeSessionId, serverSessionId;
	    if (repositoryName) {
	      // Mixed-repo workspace
      claudeSessionId = `${repositoryName}-${worktreeId}-claude`;
      serverSessionId = `${repositoryName}-${worktreeId}-server`;
    } else {
      // Traditional workspace
      claudeSessionId = `${worktreeId}-claude`;
      serverSessionId = `${worktreeId}-server`;
    }

	    // Create Claude session
	    try {
	      if (this.sessions.has(claudeSessionId)) {
	        if (includeExistingSessions) includeSessionState(claudeSessionId);
	      } else {
	        this.createSession(claudeSessionId, {
	          command: getDefaultShell(),
	          args: buildShellArgs(`cd "${worktreePath}"`),
	          cwd: worktreePath,
	          type: 'claude',
	          worktreeId: worktreeId,
	          repositoryName: repositoryName,
	          repositoryType: repositoryType
	        });
	        includeSessionState(claudeSessionId);
	      }
	    } catch (error) {
	      logger.error('Failed to create Claude session for worktree', { worktreeId, error: error.message });
	    }

    // Create Server session
    try {
      const serverWelcome = repositoryName
        ? `=== Server Terminal for ${repositoryName}/${worktreeId} ===`
        : `=== Server Terminal for ${worktreeId} ===`;

	      if (this.sessions.has(serverSessionId)) {
	        if (includeExistingSessions) includeSessionState(serverSessionId);
	      } else {
	        this.createSession(serverSessionId, {
	          command: getDefaultShell(),
	          args: buildShellArgs([
	            `cd "${worktreePath}"`,
	            `echo "${serverWelcome}"`,
	            `echo "Directory: ${worktreePath}"`,
	            process.platform === 'win32'
	              ? `Write-Host "Branch: $(git branch --show-current 2>$null; if(-not $?) { Write-Output 'unknown' })"`
	              : `echo "Branch: $(git branch --show-current 2>/dev/null || echo 'unknown')"`,
	            `echo ""`
	          ]),
	          cwd: worktreePath,
	          type: 'server',
	          worktreeId: worktreeId,
	          repositoryName: repositoryName,
	          repositoryType: repositoryType
	        });
	        includeSessionState(serverSessionId);
	      }
	    } catch (error) {
	      logger.error('Failed to create server session for worktree', { worktreeId, error: error.message });
	    }

	    // Update git branch info for the new sessions
	    if (this.gitHelper) {
	      try {
	        await this.updateGitBranch(worktreeId, worktreePath, true);
          includeSessionState(claudeSessionId);
          includeSessionState(serverSessionId);
	      } catch (error) {
	        logger.error('Failed to update git branch for new worktree', { worktreeId, error: error.message });
	      }
	    }

	    logger.info('Created sessions for worktree', { worktreeId, sessionCount: Object.keys(newSessions).length });
	    return newSessions;
	  }
  
  getIdleClaudeSessions() {
    const idle = [];
    for (const [id, session] of this.sessions) {
      if (session.type === 'claude' && session.status === 'idle') {
        idle.push(id);
      }
    }
    return idle;
  }
  
  resetInactivityTimer(session) {
    // Clear existing timer
    if (session.inactivityTimer) {
      clearTimeout(session.inactivityTimer);
      session.inactivityTimer = null;
    }
    
    // Don't set new timer if session is being terminated or timeout is disabled  
    const timeout = this.getSessionTimeout(session);
    if (!this.getSessionById(session.id) || timeout <= 0) {
      return null;
    }

    session.inactivityTimer = setTimeout(() => {
      // Double-check session still exists before terminating
      if (!this.getSessionById(session.id)) {
        return;
      }
      
      // Only terminate if we've truly been inactive for the full timeout window
      const now = Date.now();
      if (now - session.lastActivity < timeout) {
        // Activity occurred since this timer was set; reschedule
        this.resetInactivityTimer(session);
        return;
      }
      
      logger.warn('Session inactive, terminating', { 
        sessionId: session.id,
        lastActivity: new Date(session.lastActivity).toISOString()
      });
      
      this.terminateSession(session.id);
    }, timeout);
    
    return session.inactivityTimer;
  }

  // Heartbeat from clients to keep sessions alive while the UI is open
  heartbeat(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.lastActivity = Date.now();
    this.resetInactivityTimer(session);
    return true;
  }
  
  checkProcessLimit(session) {
    if (!session.pty || !session.pty.pid) return;

    const pid = Number(session.pty.pid);
    if (!Number.isFinite(pid) || pid <= 0) return;

    const { spawn } = require('child_process');

    if (process.platform === 'win32') {
      const psCmd = `(Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}").Count`;
      const child = spawn('powershell.exe', ['-NoProfile', '-Command', psCmd], {
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
        creationFlags: 0x08000000 // CREATE_NO_WINDOW
      });
      let stdout = '';
      child.stdout.on('data', (d) => { stdout += d; });
      const timer = setTimeout(() => child.kill(), 2000);
      child.on('error', () => {
        clearTimeout(timer);
      });
      child.on('close', () => {
        clearTimeout(timer);
        const processCount = parseInt(String(stdout || '').trim(), 10);
        if (!Number.isFinite(processCount)) return;
        if (processCount > this.maxProcessesPerSession) {
          logger.error('Process limit exceeded', {
            sessionId: session.id,
            processCount,
            limit: this.maxProcessesPerSession
          });
          this.terminateSession(session.id);
        }
      });
      return;
    }

    // POSIX: use pgrep to count child processes without shell interpolation.
    const child = spawn('pgrep', ['-P', String(pid)], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true
    });
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d; });
    const timer = setTimeout(() => child.kill(), 2000);
    child.on('error', () => {
      clearTimeout(timer);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      // pgrep exits with code 1 when no child process matches; treat as zero children.
      if (code !== 0 && code !== 1) return;
      const lines = String(stdout || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const processCount = lines.length;
      if (!Number.isFinite(processCount)) return;
      if (processCount > this.maxProcessesPerSession) {
        logger.error('Process limit exceeded', {
          sessionId: session.id,
          processCount,
          limit: this.maxProcessesPerSession
        });
        this.terminateSession(session.id);
      }
    });
  }
  
  terminateSession(sessionId, { workspaceId = null } = {}) {
    // Terminate across both active and stashed workspaces.
    const sid = String(sessionId || '').trim();
    const ws = String(workspaceId || '').trim();
    let session = null;
    let sessionMap = null;
    if (ws) {
      const active = this.sessions.get(sid);
      const activeWorkspaceId = String(active?.workspace || this.workspace?.id || '').trim();
      if (active && (!activeWorkspaceId || activeWorkspaceId === ws)) {
        session = active;
        sessionMap = this.sessions;
      } else {
        const scopedMap = this.workspaceSessionMaps.get(ws);
        if (scopedMap?.has?.(sid)) {
          session = scopedMap.get(sid);
          sessionMap = scopedMap;
        }
      }
    } else {
      session = this.sessions.get(sid);
      sessionMap = this.sessions;
      if (!session) {
        for (const map of this.workspaceSessionMaps.values()) {
          if (map.has(sid)) {
            session = map.get(sid);
            sessionMap = map;
            break;
          }
        }
      }
    }
    if (!session) return;

    logger.info('Terminating session', { sessionId: sid, workspaceId: session.workspace || ws || null });

    // Clear the inactivity timer to prevent infinite loops
    if (session.inactivityTimer) {
      clearTimeout(session.inactivityTimer);
      session.inactivityTimer = null;
    }

    // Clear the process monitor interval to prevent memory leaks
    if (session.processMonitor) {
      clearInterval(session.processMonitor);
      session.processMonitor = null;
    }

    // Clear any pending auto-start timers
    if (session.autoStartTimer) {
      clearTimeout(session.autoStartTimer);
      session.autoStartTimer = null;
    }
    if (session.pendingStatusTimer) {
      clearTimeout(session.pendingStatusTimer);
      session.pendingStatusTimer = null;
    }

    const ptyPid = Number(session?.pty?.pid);

    // Kill the PTY process if it exists
    if (session.pty) {
      try {
        session.pty.kill();
      } catch (error) {
        logger.error('Failed to kill PTY', {
          sessionId: sid,
          error: error.message
        });
      }
    }

    // Best-effort process tree cleanup to avoid orphaned agent subprocesses
    // after terminals are closed/removed.
    this.bestEffortKillProcessTree(ptyPid, { sessionId: sid });

    // Remove from sessions map
    sessionMap.delete(sid);
  }

  bestEffortKillProcessTree(pid, { sessionId = null } = {}) {
    const numericPid = Number(pid);
    if (!Number.isFinite(numericPid) || numericPid <= 0) return;

    if (process.platform === 'win32') {
      const { spawn: spawnProc } = require('child_process');
      const child = spawnProc('taskkill', ['/PID', String(numericPid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
        creationFlags: 0x08000000
      });
      child.on('error', () => {});
      return;
    }

    let killTarget = null;
    try {
      process.kill(-numericPid, 'SIGTERM');
      killTarget = -numericPid;
    } catch (groupError) {
      try {
        process.kill(numericPid, 'SIGTERM');
        killTarget = numericPid;
      } catch (singleError) {
        logger.debug('Failed to send SIGTERM during process tree cleanup', {
          sessionId,
          pid: numericPid,
          groupError: groupError.message,
          singleError: singleError.message
        });
      }
    }
    if (!killTarget || this.processTreeKillGraceMs <= 0) return;

    const escalationTimer = setTimeout(() => {
      if (!this.isProcessTargetAlive(killTarget)) return;
      try {
        process.kill(killTarget, 'SIGKILL');
      } catch {
        // best-effort
      }
    }, this.processTreeKillGraceMs);
    if (typeof escalationTimer.unref === 'function') escalationTimer.unref();
  }

  isProcessTargetAlive(targetPid) {
    const target = Number(targetPid);
    if (!Number.isFinite(target) || target === 0) return false;
    try {
      process.kill(target, 0);
      return true;
    } catch (error) {
      if (error?.code === 'EPERM') return true;
      return false;
    }
  }

  getSessionById(sessionId, { workspaceId = null } = {}) {
    const sid = String(sessionId || '').trim();
    if (!sid) return null;

    const ws = String(workspaceId || '').trim();
    if (ws) {
      const active = this.sessions.get(sid);
      if (active) {
        const activeWorkspaceId = String(active.workspace || this.workspace?.id || '').trim();
        if (!activeWorkspaceId || activeWorkspaceId === ws) return active;
      }
      const scopedMap = this.workspaceSessionMaps.get(ws);
      if (scopedMap?.has?.(sid)) return scopedMap.get(sid);
      return null;
    }

    const direct = this.sessions.get(sid);
    if (direct) return direct;
    for (const map of this.workspaceSessionMaps.values()) {
      const s = map.get(sid);
      if (s) return s;
    }
    return null;
  }

  getAllSessionEntries({ workspaceId = null } = {}) {
    const wsFilter = String(workspaceId || '').trim();
    const entries = [];
    const seen = new Set();

    const pushEntry = (sessionId, session, fallbackWorkspaceId = null) => {
      const sid = String(sessionId || '').trim();
      const sessionWorkspaceId = String(session.workspace || fallbackWorkspaceId || '').trim() || null;
      const seenKey = wsFilter ? sid : `${sessionWorkspaceId || 'unknown'}::${sid}`;
      if (!sid || seen.has(seenKey) || !session) return;
      if (wsFilter && sessionWorkspaceId !== wsFilter) return;
      seen.add(seenKey);
      entries.push([sid, session, sessionWorkspaceId]);
    };

    for (const [sessionId, session] of this.sessions.entries()) {
      pushEntry(sessionId, session, this.workspace?.id || null);
    }

    for (const [workspaceIdKey, map] of this.workspaceSessionMaps.entries()) {
      if (!map || typeof map.entries !== 'function') continue;
      for (const [sessionId, session] of map.entries()) {
        pushEntry(sessionId, session, workspaceIdKey);
      }
    }

    return entries;
  }

  getSessionIdsForWorktree({ workspaceId = null, worktreeKey = null, sessionTypes = null } = {}) {
    const keyRaw = String(worktreeKey || '').trim().toLowerCase();
    if (!keyRaw) return [];
    const typeSet = Array.isArray(sessionTypes)
      ? new Set(sessionTypes.map((type) => String(type || '').trim().toLowerCase()).filter(Boolean))
      : null;

    const parsedKey = parseWorktreeKey(keyRaw);
    const repoScoped = Boolean(parsedKey?.repositoryName);
    const keyCandidates = new Set([keyRaw].filter(Boolean));
    if (parsedKey?.repositoryName && parsedKey?.worktreeId) {
      keyCandidates.add(`${parsedKey.repositoryName}-${parsedKey.worktreeId}`);
    }
    if (!repoScoped && parsedKey?.worktreeId) {
      keyCandidates.add(String(parsedKey.worktreeId).trim().toLowerCase());
    }
    const out = [];

    for (const [sessionId, session] of this.getAllSessionEntries({ workspaceId })) {
      const sid = String(sessionId || '').trim();
      if (!sid || !session) continue;
      if (typeSet) {
        const type = String(session.type || '').trim().toLowerCase();
        if (!typeSet.has(type)) continue;
      }

      const sidLower = sid.toLowerCase();
      const sessionWorktreeId = String(session.worktreeId || '').trim().toLowerCase();
      const sessionRepoName = String(session.repositoryName || '').trim().toLowerCase();
      const composedKey = sessionRepoName && sessionWorktreeId
        ? `${sessionRepoName}-${sessionWorktreeId}`
        : '';

      let matches = false;
      for (const candidate of keyCandidates) {
        if (!candidate) continue;
        if (sidLower === candidate || sidLower.includes(`${candidate}-`)) {
          matches = true;
          break;
        }
      }
      if (!matches && composedKey && keyCandidates.has(composedKey)) matches = true;
      if (!matches && !repoScoped && sessionWorktreeId && keyCandidates.has(sessionWorktreeId)) matches = true;

      if (!matches) continue;
      out.push(sid);
    }

    return Array.from(new Set(out)).sort((a, b) => a.localeCompare(b));
  }

  getSessionGroupIds(sessionId, { workspaceId = null, sessionTypes = ['claude', 'codex', 'server'] } = {}) {
    const sid = String(sessionId || '').trim();
    if (!sid) return [];

    const session = this.getSessionById(sid, { workspaceId });
    if (!session) return [sid];

    const ws = String(workspaceId || session?.workspace || '').trim() || null;
    const worktreeId = String(session?.worktreeId || '').trim().toLowerCase();
    const repositoryName = String(session?.repositoryName || '').trim().toLowerCase();
    const parsedWorktreeId = worktreeId || String(sid).replace(/-(claude|codex|server)$/i, '').split('-').pop()?.toLowerCase() || '';
    const composedKey = repositoryName && parsedWorktreeId ? `${repositoryName}-${parsedWorktreeId}` : '';

    const group = new Set([sid]);
    const keys = [composedKey, parsedWorktreeId].filter(Boolean);
    for (const key of keys) {
      const ids = this.getSessionIdsForWorktree({
        workspaceId: ws,
        worktreeKey: key,
        sessionTypes
      });
      ids.forEach((id) => group.add(id));
    }

    return Array.from(group).sort((a, b) => a.localeCompare(b));
  }

  closeSession(sessionId, { clearRecovery = false, workspaceId = null } = {}) {
    const session = this.getSessionById(sessionId, { workspaceId });
    if (!session) return false;

    const targetWorkspaceId = session.workspace || null;
    this.terminateSession(sessionId, { workspaceId: targetWorkspaceId || workspaceId || null });

    if (clearRecovery && targetWorkspaceId) {
      try {
        sessionRecoveryService.clearSession(targetWorkspaceId, sessionId);
      } catch {
        // best-effort
      }
    }

    return true;
  }

  cleanupWorkspaceSessions(workspaceId, { clearRecovery = false } = {}) {
    const ws = String(workspaceId || '').trim();
    if (!ws) return 0;

    const sessionIds = this.getAllSessionEntries({ workspaceId: ws })
      .map(([sessionId]) => sessionId);

    sessionIds.forEach((sessionId) => {
      this.closeSession(sessionId, {
        clearRecovery,
        workspaceId: ws
      });
    });

    if (String(this.workspace?.id || '').trim() === ws) {
      this.sessions.clear();
      this.stopBranchRefresh();
      this.cleanupGitWatchers();
    }

    this.workspaceSessionMaps.delete(ws);
    logger.info('Cleaned workspace sessions', {
      workspaceId: ws,
      closed: sessionIds.length
    });

    return sessionIds.length;
  }
  
  restartSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.warn('Cannot restart session - not found', { sessionId });
      return false;
    }

    logger.info('Manually restarting session', { sessionId });

    // Save config before terminating
    const config = { ...session.config };

    // For Claude sessions, restart as a clean shell
    // This allows user to use the agent selection UI to choose how to start
    if (config.type === 'claude') {
      const workspaceId = session.workspace || null;
      if (workspaceId) {
        try {
          sessionRecoveryService.markAgentInactive(workspaceId, sessionId);
        } catch {
          // best-effort
        }
      }
      config.command = getDefaultShell();
      config.args = buildShellArgs(`cd "${config.cwd}"`);
    }

    // For server sessions, restart with welcome message
    if (config.type === 'server') {
      const worktreeLabel = config.repositoryName
        ? `${config.repositoryName}/${config.worktreeId}`
        : config.worktreeId;
      config.command = getDefaultShell();
      config.args = buildShellArgs([
        `cd "${config.cwd}"`,
        `echo "=== Server Terminal for ${worktreeLabel} ==="`,
        `echo "Directory: ${config.cwd}"`,
        getShellKind() === 'powershell'
          ? `$b = git branch --show-current 2>$null; if (-not $b) { $b = 'unknown' }; Write-Output "Branch: $b"`
          : `echo "Branch: $(git branch --show-current 2>/dev/null || echo 'unknown')"`,
        `echo ""`
      ]);
    }

    // Terminate existing session
    this.terminateSession(sessionId);

    // Wait a moment then recreate
    setTimeout(() => {
      try {
        this.createSession(sessionId, config);
        this.io.emit('session-restarted', {
          sessionId,
          workspaceId: session.workspace || null
        });
        logger.info('Session restarted successfully', { sessionId });
        return true;
      } catch (error) {
        logger.error('Failed to restart session', {
          sessionId,
          error: error.message
        });
        return false;
      }
    }, 1000);

    return true;
  }
  
  normalizeClaudeProvider(provider) {
    if (!provider) return 'anthropic';
    const normalized = String(provider).toLowerCase();
    return normalized === 'zai' ? 'zai' : 'anthropic';
  }

  getShellKindForSession(sessionId) {
    const session = this.getSessionById(sessionId);
    const raw = String(session?.config?.command || '').toLowerCase();
    if (raw.includes('powershell')) return 'powershell';
    return getShellKind();
  }

  buildClaudeCommand({ shellKind, mode, resumeId, skipPermissions }) {
    let cmd = 'claude';

    if (mode === 'continue') {
      cmd = 'claude --continue';
    } else if (mode === 'resume') {
      cmd = resumeId
        ? `claude --resume ${quoteForShell(resumeId, shellKind)}`
        : 'claude --resume';
    }

    if (skipPermissions) {
      cmd += ' --dangerously-skip-permissions';
    }

    return cmd;
  }

  getZaiEnvOverrides() {
    const baseUrl = process.env.ZAI_ANTHROPIC_BASE_URL
      || process.env.ZAI_BASE_URL
      || 'https://api.z.ai/api/anthropic';
    const authToken = process.env.ZAI_ANTHROPIC_AUTH_TOKEN
      || process.env.ZAI_API_KEY
      || process.env.ZAI_AUTH_TOKEN;

    if (!authToken) {
      return null;
    }

    return { baseUrl, authToken };
  }

  resolveClaudeCommand(claudeCommand, provider) {
    const normalizedProvider = this.normalizeClaudeProvider(provider);
    if (normalizedProvider !== 'zai') {
      return { command: claudeCommand, env: null, provider: 'anthropic' };
    }

    const zaiEnv = this.getZaiEnvOverrides();
    if (!zaiEnv) {
      return {
        command: claudeCommand,
        env: null,
        provider: 'anthropic',
        warning: 'Z.ai provider selected but no ZAI_API_KEY or ZAI_ANTHROPIC_AUTH_TOKEN set.'
      };
    }

    return {
      command: claudeCommand,
      env: {
        ANTHROPIC_BASE_URL: zaiEnv.baseUrl,
        ANTHROPIC_AUTH_TOKEN: zaiEnv.authToken
      },
      provider: 'zai'
    };
  }

  startClaudeWithOptions(sessionId, options) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.warn('Cannot start Claude - session not found', { sessionId });
      return false;
    }
    
    if (session.type !== 'claude') {
      logger.warn('Cannot start Claude on non-Claude session', { sessionId, type: session.type });
      return false;
    }
    
    const safeOptions = options || {};

    // Get effective settings for this session (global + per-terminal overrides)
    const effectiveSettings = this.userSettings.getEffectiveSettings(sessionId);
    
    // Merge UI options with user settings (UI options take precedence)
    const finalOptions = {
      ...safeOptions,
      skipPermissions: safeOptions.skipPermissions !== undefined 
        ? safeOptions.skipPermissions 
        : effectiveSettings.claudeFlags.skipPermissions,
      provider: safeOptions.provider || effectiveSettings.claudeFlags.provider || 'anthropic'
    };
    
    logger.info('Starting Claude with options', { 
      sessionId, 
      uiOptions: options, 
      effectiveSettings: effectiveSettings.claudeFlags,
      finalOptions 
    });
    
    const shellKind = this.getShellKindForSession(sessionId);
    const claudeCommand = this.buildClaudeCommand({
      shellKind,
      mode: finalOptions.mode,
      resumeId: finalOptions.resumeId,
      skipPermissions: !!finalOptions.skipPermissions
    });

    const resolvedCommand = this.resolveClaudeCommand(claudeCommand, finalOptions.provider);
    if (resolvedCommand.warning) {
      this.writeToSession(sessionId, `${buildEcho(shellKind, resolvedCommand.warning)}\n`);
    }
    
    // Write the command to the terminal
    const commandToRun = buildShellCommand({
      shellKind,
      cwd: finalOptions.cwd || null,
      env: resolvedCommand.env || null,
      command: resolvedCommand.command
    });
    logger.info('Executing Claude command', { sessionId, command: resolvedCommand.command, provider: resolvedCommand.provider });
    
    // Mark terminal busy immediately when launching an agent command.
    if (session.status !== 'busy') {
      this.applyStatusUpdate(sessionId, session, 'busy');
    }

    // Send the command to the terminal
    this.writeToSession(sessionId, `${commandToRun}\n`);
    
    // Emit event to notify UI that Claude is starting
    this.io.emit('claude-started', { sessionId, options: finalOptions });

    return true;
  }

  /**
   * Start AI agent with configuration (agent-agnostic)
   */
  startAgentWithConfig(sessionId, config) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.warn('Cannot start agent - session not found', { sessionId });
      return false;
    }

    if (!this.agentManager) {
      logger.error('AgentManager not available', { sessionId });
      return false;
    }

    // Validate configuration
    const validation = this.agentManager.validateConfig(config);
    if (!validation.valid) {
      logger.error('Invalid agent configuration', { sessionId, config, error: validation.error });
      return false;
    }

    // Handle mutually exclusive flags
    const adjustedFlags = this.agentManager.validateAndAdjustFlags(config.agentId, config.flags);
    const finalConfig = { ...config, flags: adjustedFlags };

    logger.info('Starting agent with configuration', {
      sessionId,
      originalConfig: config,
      finalConfig
    });

    try {
      const shellKind = this.getShellKindForSession(sessionId);

      // Build command using AgentManager (agent-agnostic config object),
      // but special-case Claude so resume ids + env overrides work cross-platform.
      let command = '';
      let commandEnv = null;

      if (finalConfig.agentId === 'claude') {
        const effectiveSettings = this.userSettings.getEffectiveSettings(sessionId);
        const provider = finalConfig.provider || effectiveSettings.claudeFlags.provider || 'anthropic';
        const skipPermissions = Array.isArray(finalConfig.flags) && finalConfig.flags.includes('skipPermissions');
        const claudeCmd = this.buildClaudeCommand({
          shellKind,
          mode: finalConfig.mode,
          resumeId: finalConfig.resumeId,
          skipPermissions
        });
        const resolvedCommand = this.resolveClaudeCommand(claudeCmd, provider);
        if (resolvedCommand.warning) {
          this.writeToSession(sessionId, `${buildEcho(shellKind, resolvedCommand.warning)}\n`);
        }
        command = resolvedCommand.command;
        commandEnv = resolvedCommand.env || null;
        logger.info('Executing agent command', { sessionId, command, provider: resolvedCommand.provider });
      } else {
        command = this.agentManager.buildCommand(finalConfig.agentId, finalConfig.mode, finalConfig);
        logger.info('Executing agent command', { sessionId, command });
      }

      // Mark terminal busy immediately when launching an agent command.
      if (session.status !== 'busy') {
        this.applyStatusUpdate(sessionId, session, 'busy');
      }

      // Send the command to the terminal
      const commandToRun = buildShellCommand({
        shellKind,
        cwd: finalConfig.cwd || null,
        env: commandEnv,
        command
      });
      this.writeToSession(sessionId, `${commandToRun}\n`);

      // Emit event to notify UI that agent is starting
      this.io.emit('agent-started', { sessionId, config: finalConfig });

      return true;
    } catch (error) {
      logger.error('Failed to start agent', { sessionId, config, error: error.message, stack: error.stack });
      return false;
    }
  }

  /**
   * Get sessions associated with a specific worktree
   */
  getSessionsForWorktree(worktreeId) {
    const sessions = [];
    for (const [sessionId, session] of this.sessions) {
      if (sessionId.includes(worktreeId)) {
        sessions.push(sessionId);
      }
    }
    return sessions;
  }

  cleanup() {
    logger.info('Cleaning up all sessions');

    for (const [sessionId, session] of this.sessions) {
      clearTimeout(session.inactivityTimer);
      clearInterval(session.processMonitor);
      if (session.autoStartTimer) {
        clearTimeout(session.autoStartTimer);
      }
      
      try {
        if (session.pty) {
          session.pty.kill();
        }
      } catch (error) {
        logger.error('Error cleaning up session', { 
          sessionId, 
          error: error.message 
        });
      }
    }
    
    this.sessions.clear();
    this.stopBranchRefresh();
    this.cleanupGitWatchers();
  }

  cleanupAllSessions() {
    logger.info('Cleaning up all sessions for workspace switch');

    // Kill all PTY processes
    for (const [sessionId, session] of this.sessions) {
      try {
        if (session.pty) {
          session.pty.kill();
          logger.debug(`Killed session: ${sessionId}`);
        }

        // Clear process monitor
        if (session.processMonitor) {
          clearInterval(session.processMonitor);
        }

        if (session.autoStartTimer) {
          clearTimeout(session.autoStartTimer);
        }
      } catch (error) {
        logger.error('Error cleaning up session', {
          sessionId,
          error: error.message
        });
      }
    }

    // Clear all session data
    this.sessions.clear();

    // Clear git watchers
    this.cleanupGitWatchers();

    logger.info('All sessions cleaned up');
  }
}

module.exports = { SessionManager };
