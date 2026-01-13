const pty = require('node-pty');
const { EventEmitter } = require('events');
const winston = require('winston');
const fs = require('fs');
const path = require('path');
const { ClaudeVersionChecker } = require('./claudeVersionChecker');
const { UserSettingsService } = require('./userSettingsService');
const { WorktreeHelper } = require('./worktreeHelper');
const sessionRecoveryService = require('./sessionRecoveryService');

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

class SessionManager extends EventEmitter {
  constructor(io, agentManager) {
    super();
    this.io = io;
    this.agentManager = agentManager;
    this.sessions = new Map();
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

    // Worktrees will be built when workspace is set
    this.worktrees = [];
  }

  // Determine effective inactivity timeout per session (ms)
  getSessionTimeout(session) {
    if (!session) return this.sessionTimeout;
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
        server: { port: 3000, host: "0.0.0.0" },
        worktrees: { basePath: "auto", count: 8 },
        sessions: { timeoutMs: 1800000, maxBufferSize: 100000, maxProcessesPerSession: 50 },
        logging: { level: "info" },
        tokens: { maxContextTokens: 200000 }
      };
    }
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
        const worktreePath = path.join(repoPath, worktreeId);

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
  
  async initializeSessions() {
    // Set flag to prevent auto-restart during initialization
    this.isWorkspaceSwitching = true;

    // Clear ALL existing sessions first
    logger.info('Clearing existing sessions before workspace initialization');
    this.cleanupAllSessions();

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
            let command, args;

            if (terminal.terminalType === 'claude') {
              command = 'bash';
              args = ['-c', `cd "${worktree.path}" && exec bash`];
            } else {
              // Server terminal
              command = 'bash';
              args = ['-c', `cd "${worktree.path}" && echo "=== Server Terminal for ${terminal.repository.name}/${terminal.worktree} ===" && echo "Directory: $(pwd)" && echo "Branch: $(git branch --show-current 2>/dev/null || echo 'unknown')" && echo "" && echo "Ready to run: bun index.ts" && echo "Available commands: bun, npm, node" && echo "" && exec bash`];
            }

            this.createSession(sessionId, {
              command,
              args,
              cwd: worktree.path,
              type: terminal.terminalType,
              worktreeId: terminal.worktree,
              repositoryName: terminal.repository.name,
              repositoryType: terminal.repository.type  // Add repository type for dynamic launch options
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
            this.createSession(`${worktree.id}-claude`, {
              command: 'bash',
              args: ['-c', `cd "${worktree.path}" && exec bash`],
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
            this.createSession(`${worktree.id}-server`, {
              command: 'bash',
              args: ['-c', `cd "${worktree.path}" && echo "=== Server Terminal for ${worktree.id} ===" && echo "Directory: $(pwd)" && echo "Branch: $(git branch --show-current 2>/dev/null || echo 'unknown')" && echo "" && echo "Ready to run: bun index.ts" && echo "Available commands: bun, npm, node" && echo "" && exec bash`],
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
    
    this.branchRefreshInterval = setInterval(() => {
      this.worktrees.forEach(worktree => {
        this.updateGitBranch(worktree.id, worktree.path);
      });
    }, 30000); // Refresh every 30 seconds
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
      try {
        // Find the actual HEAD file location (handles both regular repos and worktrees)
        const headPath = this.findHeadFile(worktree.path);
        
        if (headPath) {
          // Create a watcher for this HEAD file
          const watcher = fs.watch(headPath, (eventType) => {
            if (eventType === 'change') {
              logger.info('👀 Detected .git/HEAD change', { 
                worktree: worktree.id,
                eventType,
                headPath,
                timestamp: new Date().toISOString()
              });
              
              // Clear cache and update branch immediately
              if (this.gitHelper) {
                this.gitHelper.clearCacheForPath(worktree.path);
              }
              
              // Small delay to ensure the file write is complete
              setTimeout(() => {
                logger.debug('File watcher triggered branch update', { worktree: worktree.id });
                this.updateGitBranch(worktree.id, worktree.path, true);
              }, 50);
            }
          });
          
          this.fileWatchers.set(worktree.id, watcher);
          logger.info('Setup git watcher for worktree', { 
            worktree: worktree.id,
            headPath 
          });
        } else {
          logger.warn('No .git/HEAD file found for worktree', { 
            worktree: worktree.id,
            searchedPaths: 'multiple locations' 
          });
        }
      } catch (error) {
        logger.error('Failed to setup git watcher', { 
          worktree: worktree.id, 
          error: error.message 
        });
      }
    });
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
      const { execSync } = require('child_process');
      const gitDir = execSync('git rev-parse --git-dir', { 
        cwd: repoPath,
        encoding: 'utf8' 
      }).trim();
      
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
      const ptyProcess = pty.spawn(config.command, config.args, {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
        cwd: config.cwd,
        env: {
          ...process.env,
          // Include snap binaries, node paths, and common paths
          PATH: `${process.env.HOME}/.nvm/versions/node/v22.16.0/bin:/snap/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}`,
          HOME: process.env.HOME, // Use actual home directory for Claude CLI access
          TERM: 'xterm-color',
          // Ensure Claude CLI can find its config
          NODE_PATH: process.env.NODE_PATH
        }
      });
      
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
        lastActivity: Date.now(),
        tokenUsage: 0,
        config: config,
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

        // Reset inactivity timer
        this.resetInactivityTimer(session);

        // Emit to clients
        this.io.emit('terminal-output', {
          sessionId,
          data
        });

        // Track session state for recovery
        if (this.workspace?.id) {
          this.trackSessionState(sessionId, data, config);
        }

        // Update status based on output (for Claude sessions)
        if (config.type === 'claude' && this.statusDetector) {
          const newStatus = this.statusDetector.detectStatus(session.buffer);
          if (newStatus !== session.status) {
            const oldStatus = session.status;
            session.status = newStatus;
            this.emitStatusUpdate(sessionId, newStatus);
            
            // Trigger notification if waiting
            if (newStatus === 'waiting') {
              this.io.emit('notification-trigger', {
                sessionId,
                type: 'waiting',
                message: `Claude ${config.worktreeId} needs your input`,
                branch: session.branch
              });

              // Check for auto-start settings
              const effectiveSettings = this.userSettings.getEffectiveSettings(sessionId);
              if (effectiveSettings.autoStart && effectiveSettings.autoStart.enabled && !session.autoStarted) {
                // Mark as auto-started to prevent multiple triggers
                session.autoStarted = true;

                // Apply auto-start with configured delay
                const delay = effectiveSettings.autoStart.delay || 500;
                const mode = effectiveSettings.autoStart.mode || 'fresh';
                const skipPermissions = effectiveSettings.claudeFlags.skipPermissions || false;

                logger.info('Auto-starting Claude session', {
                  sessionId,
                  mode,
                  delay,
                  skipPermissions
                });

                // Start Claude after delay
                setTimeout(() => {
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
        }
        
        // Keep buffer size manageable
        if (session.buffer.length > this.maxBufferSize) {
          session.buffer = session.buffer.slice(-Math.floor(this.maxBufferSize / 2));
        }
      });
      
      // Handle exit
      ptyProcess.onExit(({ exitCode, signal }) => {
        logger.info('Session exited', { sessionId, exitCode, signal });
        
        clearTimeout(session.inactivityTimer);
        session.status = 'exited';
        this.emitStatusUpdate(sessionId, 'exited');
        
        // Notify clients
        this.io.emit('session-exited', {
          sessionId,
          exitCode,
          signal
        });
        
        // Auto-restart Claude sessions that exit from CTRL+C or other interrupts
        // This ensures the terminal remains usable after CTRL+C
        if (config.type === 'claude' && !this.isWorkspaceSwitching) {
          logger.info('Claude session exited, auto-restarting for usability', {
            sessionId,
            signal,
            exitCode
          });
          
          // Remove the old session
          this.sessions.delete(sessionId);
          
          // Restart after a short delay to allow cleanup
          setTimeout(() => {
            try {
              // Create a fresh bash session that user can interact with
              // User can then run 'claude' command again if desired
              const restartConfig = {
                ...config,
                command: 'bash',
                args: ['-c', `cd "${config.cwd}" && echo "Claude session ended. Terminal ready for commands." && echo "Type 'claude' to start a new Claude session." && echo "" && exec bash`]
              };
              
              this.createSession(sessionId, restartConfig);
              
              // After creating the bash session, emit restart event
              this.io.emit('session-restarted', { sessionId });
              
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
          this.sessions.delete(sessionId);
        }
      });
      
      // Add workspace ID to session
      session.workspace = this.workspace?.id || null;
      this.sessions.set(sessionId, session);
      
      // Monitor for fork bombs (every 5 seconds)
      session.processMonitor = setInterval(() => {
        this.checkProcessLimit(session);
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
   * Track session state for crash recovery
   * Detects CWD changes, conversation IDs, and running processes
   */
  trackSessionState(sessionId, data, config) {
    const workspaceId = this.workspace?.id;
    if (!workspaceId) return;

    // Detect agent type from command and look up conversation
    const agentPatterns = [
      { pattern: /(?:^|\n)\s*claude\s/, agent: 'claude' },
      { pattern: /(?:^|\n)\s*codex\s/, agent: 'codex' },
      { pattern: /(?:^|\n)\s*opencode\s/, agent: 'opencode' },
      { pattern: /(?:^|\n)\s*aider\s/, agent: 'aider' }
    ];

    for (const { pattern, agent } of agentPatterns) {
      if (pattern.test(data)) {
        // Only track the agent type - conversation lookup happens at recovery time
        sessionRecoveryService.updateAgent(workspaceId, sessionId, agent);

        // Store worktree path from config for recovery
        if (config.cwd) {
          sessionRecoveryService.updateSession(workspaceId, sessionId, {
            worktreePath: config.cwd
          });
        }
        break;
      }
    }

    // Also detect CWD from bash prompt for when user cd's around
    // Matches: user@host:path$ or HOST:path$ format
    const cwdMatch = data.match(/(?:\w+@)?[\w-]+:([~\/][^\$\#\n\r]*?)[\$\#]\s*$/);
    if (cwdMatch && cwdMatch[1]) {
      let cwd = cwdMatch[1].trim();
      if (cwd.startsWith('~')) {
        cwd = cwd.replace('~', process.env.HOME || '/home/user');
      }
      if (cwd.startsWith('/') && !cwd.includes('\x1b')) {
        sessionRecoveryService.updateCwd(workspaceId, sessionId, cwd);
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

    if (config.type === 'server') {
      for (const { pattern, cmd } of serverPatterns) {
        if (pattern.test(data)) {
          sessionRecoveryService.updateServer(workspaceId, sessionId, cmd);
          break;
        }
      }
    }
  }

  writeToSession(sessionId, data) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.pty) {
      logger.warn('Attempted to write to invalid session', { sessionId });
      return false;
    }
    
    try {
      session.pty.write(data);
      session.lastActivity = Date.now();
      
      // Reset inactivity timer on any user input to keep the session alive
      this.resetInactivityTimer(session);
      
      // If was waiting and user provided input, mark as busy
      if (session.status === 'waiting' && session.type === 'claude') {
        session.status = 'busy';
        this.emitStatusUpdate(sessionId, 'busy');
      }
      
      // Track the current command being typed
      if (!session.currentCommand) {
        session.currentCommand = '';
      }
      
      // Build command string or reset on Enter
      if (data === '\r' || data === '\n') {
        // Command was executed, check if it was a git command
        const command = session.currentCommand.trim();
        
        // Match various git commands that could change branches
        const gitCommandPatterns = [
          /^git\s+(checkout|switch|branch|merge|pull|fetch|rebase|reset|cherry-pick)/i,
          /^git\s+co\s+/i,  // Common alias for checkout
          /^git\s+sw\s+/i,  // Common alias for switch
        ];
        
        const isGitCommand = gitCommandPatterns.some(pattern => pattern.test(command));
        
        if (isGitCommand) {
          logger.info('🎉 Detected git command execution', { 
            sessionId,
            command: command.substring(0, 50),
            worktreeId: session.worktreeId,
            timestamp: new Date().toISOString()
          });
          
          // Clear cache and schedule immediate branch refresh
          if (this.gitHelper) {
            this.gitHelper.clearCacheForPath(session.config.cwd);
          }
          
          // Use a slightly longer delay for commands that might take time
          const delay = command.includes('pull') || command.includes('fetch') || command.includes('merge') ? 500 : 200;
          
          setTimeout(() => {
            logger.info('⏰ Triggering branch update after git command', { 
              sessionId,
              worktreeId: session.worktreeId,
              delay: `${delay}ms`
            });
            this.updateGitBranch(session.worktreeId, session.config.cwd, true);
          }, delay);
        }
        
        // Reset command buffer after Enter
        session.currentCommand = '';
      } else if (data === '\x7f' || data === '\b') {
        // Backspace - remove last character
        if (session.currentCommand.length > 0) {
          session.currentCommand = session.currentCommand.slice(0, -1);
        }
      } else if (data === '\x03') {
        // Ctrl+C - clear command
        session.currentCommand = '';
      } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
        // Regular character - add to command
        session.currentCommand += data;
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
  
  resizeSession(sessionId, cols, rows) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.pty) {
      return false;
    }

    try {
      // Check if PTY is still valid before resizing
      if (session.pty.killed || !session.pty.writable) {
        logger.warn('PTY session is dead, skipping resize', { sessionId });
        return false;
      }

      session.pty.resize(cols, rows);
      return true;
    } catch (error) {
      // Handle ENOTTY/EBADF errors gracefully - these mean the PTY is dead
      if (error.code === 'ENOTTY' || error.code === 'EBADF') {
        logger.warn('PTY session has invalid file descriptor, cleaning up', {
          sessionId,
          error: error.code
        });

        // Mark session as dead and clean up
        session.status = 'dead';
        this.io.emit('session-status', { sessionId, status: 'dead' });

        return false;
      }

      logger.error('Failed to resize session', {
        sessionId,
        error: error.message
      });
      return false;
    }
  }
  
  async updateGitBranch(worktreeId, path, skipCache = false) {
    logger.info('🔄 updateGitBranch called', { 
      worktreeId, 
      path, 
      skipCache,
      timestamp: new Date().toISOString()
    });
    
    if (!this.gitHelper) {
      logger.warn('⚠️ No gitHelper available');
      return;
    }
    
    try {
      const branch = await this.gitHelper.getCurrentBranch(path, skipCache);
      const remoteUrl = await this.gitHelper.getRemoteUrl(path);
      const defaultBranch = await this.gitHelper.getDefaultBranch(path);
      
      // Check for existing PR for this branch
      const existingPR = await this.gitHelper.checkForExistingPR(remoteUrl, branch);
      
      // Update both claude and server sessions for this worktree
      // For mixed-repo workspaces, session IDs have workspace prefix (e.g., "mixed-terminals-work1-claude")
      // For traditional workspaces, session IDs are just worktreeId-type (e.g., "work1-claude")
      // So we need to search through sessions to find matching ones
      const sessionsToUpdate = [];

      // First try direct match (traditional workspaces)
      const claudeId = `${worktreeId}-claude`;
      const serverId = `${worktreeId}-server`;
      if (this.sessions.has(claudeId)) sessionsToUpdate.push(claudeId);
      if (this.sessions.has(serverId)) sessionsToUpdate.push(serverId);

      // If no direct match, search by worktreeId AND path (mixed-repo workspaces)
      // Important: Must match both worktreeId AND path to avoid cross-contamination
      if (sessionsToUpdate.length === 0) {
        for (const [sessionId, session] of this.sessions) {
          // Check if this session belongs to the same worktree by comparing paths
          if (session.worktreeId === worktreeId && session.config && session.config.cwd === path) {
            sessionsToUpdate.push(sessionId);
          }
        }
      }

      sessionsToUpdate.forEach(sessionId => {
        const session = this.sessions.get(sessionId);
        if (session) {
          const oldBranch = session.branch;
          session.branch = branch;
          session.remoteUrl = remoteUrl;
          session.defaultBranch = defaultBranch;
          session.existingPR = existingPR;

          // Only log at debug level to reduce spam (fires frequently)
          logger.debug('Branch update', { sessionId, oldBranch, newBranch: branch });

          this.io.emit('branch-update', { sessionId, branch, remoteUrl, defaultBranch, existingPR });
        }
      });
    } catch (error) {
      logger.error('❌ Failed to update git branch', { 
        worktreeId, 
        path,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
  
  emitStatusUpdate(sessionId, status) {
    this.io.emit('status-update', { sessionId, status });
  }
  
  getSessionStates() {
    const states = {};
    for (const [id, session] of this.sessions) {
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
   * @returns {Object} Map of sessionId -> sessionState for the new sessions
   */
  async createSessionsForWorktree(worktreeInfo) {
    const { worktreeId, worktreePath, repositoryName, repositoryType } = worktreeInfo;
    const newSessions = {};

    logger.info('Creating sessions for new worktree', { worktreeId, worktreePath, repositoryName });

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
      this.createSession(claudeSessionId, {
        command: 'bash',
        args: ['-c', `cd "${worktreePath}" && exec bash`],
        cwd: worktreePath,
        type: 'claude',
        worktreeId: worktreeId,
        repositoryName: repositoryName,
        repositoryType: repositoryType
      });

      const claudeSession = this.sessions.get(claudeSessionId);
      if (claudeSession) {
        newSessions[claudeSessionId] = {
          status: claudeSession.status,
          branch: claudeSession.branch,
          type: claudeSession.type,
          worktreeId: claudeSession.worktreeId,
          repositoryName: claudeSession.repositoryName,
          repositoryType: claudeSession.repositoryType
        };
      }
    } catch (error) {
      logger.error('Failed to create Claude session for worktree', { worktreeId, error: error.message });
    }

    // Create Server session
    try {
      const serverWelcome = repositoryName
        ? `=== Server Terminal for ${repositoryName}/${worktreeId} ===`
        : `=== Server Terminal for ${worktreeId} ===`;

      this.createSession(serverSessionId, {
        command: 'bash',
        args: ['-c', `cd "${worktreePath}" && echo "${serverWelcome}" && echo "Directory: $(pwd)" && echo "Branch: $(git branch --show-current 2>/dev/null || echo 'unknown')" && echo "" && exec bash`],
        cwd: worktreePath,
        type: 'server',
        worktreeId: worktreeId,
        repositoryName: repositoryName,
        repositoryType: repositoryType
      });

      const serverSession = this.sessions.get(serverSessionId);
      if (serverSession) {
        newSessions[serverSessionId] = {
          status: serverSession.status,
          branch: serverSession.branch,
          type: serverSession.type,
          worktreeId: serverSession.worktreeId,
          repositoryName: serverSession.repositoryName,
          repositoryType: serverSession.repositoryType
        };
      }
    } catch (error) {
      logger.error('Failed to create server session for worktree', { worktreeId, error: error.message });
    }

    // Update git branch info for the new sessions
    if (this.gitHelper) {
      try {
        await this.updateGitBranch(worktreeId, worktreePath, repositoryName);
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
    if (!this.sessions.has(session.id) || timeout <= 0) {
      return null;
    }

    session.inactivityTimer = setTimeout(() => {
      // Double-check session still exists before terminating
      if (!this.sessions.has(session.id)) {
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
    
    // Use pgrep to count child processes
    const { exec } = require('child_process');
    exec(`pgrep -P ${session.pty.pid} | wc -l`, (err, stdout) => {
      if (!err) {
        const processCount = parseInt(stdout.trim());
        if (processCount > this.maxProcessesPerSession) {
          logger.error('Process limit exceeded', { 
            sessionId: session.id,
            processCount,
            limit: this.maxProcessesPerSession
          });
          
          this.terminateSession(session.id);
        }
      }
    });
  }
  
  terminateSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    logger.info('Terminating session', { sessionId });

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

    // Kill the PTY process if it exists
    if (session.pty) {
      try {
        session.pty.kill();
      } catch (error) {
        logger.error('Failed to kill PTY', {
          sessionId,
          error: error.message
        });
      }
    }

    // Remove from sessions map
    this.sessions.delete(sessionId);
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

    // For Claude sessions, restart as a clean bash shell
    // This allows user to use the agent selection UI to choose how to start
    if (config.type === 'claude') {
      config.command = 'bash';
      config.args = ['-c', `cd "${config.cwd}" && exec bash`];
    }

    // For server sessions, restart with welcome message
    if (config.type === 'server') {
      const worktreeLabel = config.repositoryName
        ? `${config.repositoryName}/${config.worktreeId}`
        : config.worktreeId;
      config.command = 'bash';
      config.args = ['-c', `cd "${config.cwd}" && echo "=== Server Terminal for ${worktreeLabel} ===" && echo "Directory: $(pwd)" && echo "Branch: $(git branch --show-current 2>/dev/null || echo 'unknown')" && echo "" && exec bash`];
    }

    // Terminate existing session
    this.terminateSession(sessionId);

    // Wait a moment then recreate
    setTimeout(() => {
      try {
        this.createSession(sessionId, config);
        this.io.emit('session-restarted', { sessionId });
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
    
    // Get effective settings for this session (global + per-terminal overrides)
    const effectiveSettings = this.userSettings.getEffectiveSettings(sessionId);
    
    // Merge UI options with user settings (UI options take precedence)
    const finalOptions = {
      ...options,
      skipPermissions: options.skipPermissions !== undefined 
        ? options.skipPermissions 
        : effectiveSettings.claudeFlags.skipPermissions
    };
    
    logger.info('Starting Claude with options', { 
      sessionId, 
      uiOptions: options, 
      effectiveSettings: effectiveSettings.claudeFlags,
      finalOptions 
    });
    
    // Build Claude command based on final options
    let claudeCommand = 'claude';
    
    if (finalOptions.mode === 'continue') {
      claudeCommand = 'claude --continue';
    } else if (finalOptions.mode === 'resume') {
      claudeCommand = 'claude --resume';
    }
    
    if (finalOptions.skipPermissions) {
      claudeCommand += ' --dangerously-skip-permissions';
    }
    
    // Write the command to the terminal
    const commandToRun = `${claudeCommand}\n`;
    logger.info('Executing Claude command', { sessionId, command: claudeCommand });
    
    // Send the command to the terminal
    this.writeToSession(sessionId, commandToRun);
    
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
      // Build command using AgentManager
      // Pass full config for Codex (with model/reasoning/verbosity), or just flags for Claude
      const commandInput = finalConfig.model || finalConfig.reasoning || finalConfig.verbosity
        ? finalConfig  // Pass full config object for Codex
        : finalConfig.flags;  // Pass just flags for Claude (backwards compat)

      const command = this.agentManager.buildCommand(finalConfig.agentId, finalConfig.mode, commandInput);

      logger.info('Executing agent command', { sessionId, command });

      // Send the command to the terminal
      this.writeToSession(sessionId, `${command}\n`);

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