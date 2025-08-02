// Use mock pty for Windows development if node-pty fails to load
let pty;
try {
  pty = require('node-pty');
} catch (err) {
  console.warn('node-pty failed to load, using mock implementation');
  pty = require('./mockPty');
}
const { EventEmitter } = require('events');
const winston = require('winston');
const { ClaudeVersionChecker } = require('./claudeVersionChecker');

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
  constructor(io) {
    super();
    this.io = io;
    this.sessions = new Map();
    this.statusDetector = null; // Will be set later
    this.gitHelper = null; // Will be set later
    
    // Configuration
    this.worktreeBasePath = process.env.WORKTREE_BASE_PATH || process.env.HOME || '/home/ab';
    this.worktreeCount = parseInt(process.env.WORKTREE_COUNT || '8');
    this.sessionTimeout = parseInt(process.env.SESSION_TIMEOUT || '1800000'); // 30 minutes
    this.branchRefreshInterval = null;
    this.maxProcessesPerSession = parseInt(process.env.MAX_PROCESSES_PER_SESSION || '50');
    
    // Build worktree configuration
    this.worktrees = [];
    for (let i = 1; i <= this.worktreeCount; i++) {
      this.worktrees.push({
        id: `work${i}`,
        path: require('path').join(this.worktreeBasePath, `HyFire2-work${i}`)
      });
    }
  }
  
  setStatusDetector(detector) {
    this.statusDetector = detector;
  }
  
  setGitHelper(helper) {
    this.gitHelper = helper;
  }
  
  async initializeSessions() {
    logger.info('Initializing sessions', { count: this.worktrees.length });
    
    // Log configuration for debugging
    logger.info('SessionManager configuration:', {
      worktreeBasePath: this.worktreeBasePath,
      worktreeCount: this.worktreeCount,
      usingDefault: !process.env.WORKTREE_BASE_PATH
    });
    
    // Check if worktrees exist
    const fs = require('fs').promises;
    const path = require('path');
    let missingWorktrees = [];
    for (let i = 1; i <= this.worktreeCount; i++) {
      const worktreePath = path.join(this.worktreeBasePath, `HyFire2-work${i}`);
      try {
        await fs.access(worktreePath);
      } catch (error) {
        missingWorktrees.push(worktreePath);
      }
    }
    
    if (missingWorktrees.length > 0) {
      logger.warn('Missing worktrees detected. Please ensure all worktrees are created:', {
        missing: missingWorktrees,
        hint: 'Set WORKTREE_BASE_PATH in .env file or create worktrees in your home directory'
      });
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
    
    for (const worktree of this.worktrees) {
      // Add Claude session creation to promises array
      sessionPromises.push(
        Promise.resolve().then(() => {
          this.createSession(`${worktree.id}-claude`, {
            command: process.platform === 'win32' ? 'cmd.exe' : 'bash',
            args: process.platform === 'win32' 
              ? ['/c', `cd /d "${worktree.path}" && claude`]
              : ['-c', `cd "${worktree.path}" && exec ${process.env.HOME}/.nvm/versions/node/v22.16.0/bin/claude`],
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
            command: process.platform === 'win32' ? 'cmd.exe' : 'bash',
            args: process.platform === 'win32'
              ? ['/c', `cd /d "${worktree.path}" && echo === Server Terminal for ${worktree.id} === && echo Directory: %CD% && echo. && echo Ready to run: bun index.ts && echo Available commands: bun, npm, node && echo. && cmd`]
              : ['-c', `cd "${worktree.path}" && echo "=== Server Terminal for ${worktree.id} ===" && echo "Directory: $(pwd)" && echo "Branch: $(git branch --show-current 2>/dev/null || echo 'unknown')" && echo "" && echo "Ready to run: bun index.ts" && echo "Available commands: bun, npm, node" && echo "" && exec bash`],
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
            this.updateGitBranch(worktree.id, worktree.path);
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
    
    // Start periodic branch refresh (every 30 seconds)
    this.startBranchRefresh();
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
          PATH: process.platform === 'win32'
            ? process.env.PATH // On Windows, use the system PATH as-is
            : `${process.env.HOME}/.nvm/versions/node/v22.16.0/bin:/snap/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}`,
          HOME: process.platform === 'win32' ? process.env.USERPROFILE : process.env.HOME,
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
        status: 'idle',
        branch: 'unknown',
        buffer: '',
        lastActivity: Date.now(),
        tokenUsage: 0,
        config: config
      };
      
      // Set up inactivity timer
      session.inactivityTimer = this.resetInactivityTimer(session);
      
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
            }
            
            logger.info('Session status changed', { 
              sessionId, 
              oldStatus, 
              newStatus 
            });
          }
        }
        
        // Keep buffer size manageable (last 100KB)
        if (session.buffer.length > 100000) {
          session.buffer = session.buffer.slice(-50000);
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
        
        // Don't auto-restart for now - causing loops
        // TODO: Fix Claude CLI startup issues first
        this.sessions.delete(sessionId);
      });
      
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
  
  writeToSession(sessionId, data) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.pty) {
      logger.warn('Attempted to write to invalid session', { sessionId });
      return false;
    }
    
    try {
      session.pty.write(data);
      session.lastActivity = Date.now();
      
      // If was waiting and user provided input, mark as busy
      if (session.status === 'waiting' && session.type === 'claude') {
        session.status = 'busy';
        this.emitStatusUpdate(sessionId, 'busy');
      }
      
      // Check if this is a git command that might change branches
      if (data.includes('git checkout') || data.includes('git switch') || data.includes('git branch')) {
        // Schedule branch refresh after a short delay
        setTimeout(() => {
          this.updateGitBranch(session.worktreeId, session.cwd);
        }, 1000);
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
      session.pty.resize(cols, rows);
      return true;
    } catch (error) {
      logger.error('Failed to resize session', { 
        sessionId, 
        error: error.message 
      });
      return false;
    }
  }
  
  async updateGitBranch(worktreeId, path) {
    if (!this.gitHelper) return;
    
    try {
      const branch = await this.gitHelper.getCurrentBranch(path);
      
      // Update both claude and server sessions for this worktree
      [`${worktreeId}-claude`, `${worktreeId}-server`].forEach(sessionId => {
        const session = this.sessions.get(sessionId);
        if (session) {
          session.branch = branch;
          this.io.emit('branch-update', { sessionId, branch });
        }
      });
    } catch (error) {
      logger.error('Failed to update git branch', { 
        worktreeId, 
        error: error.message 
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
        type: session.type,
        worktreeId: session.worktreeId,
        lastActivity: session.lastActivity
      };
    }
    return states;
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
    
    // Don't set new timer if session is being terminated
    if (!this.sessions.has(session.id)) {
      return null;
    }
    
    session.inactivityTimer = setTimeout(() => {
      // Double-check session still exists before terminating
      if (!this.sessions.has(session.id)) {
        return;
      }
      
      logger.warn('Session inactive, terminating', { 
        sessionId: session.id,
        lastActivity: new Date(session.lastActivity).toISOString()
      });
      
      this.terminateSession(session.id);
    }, this.sessionTimeout);
    
    return session.inactivityTimer;
  }
  
  checkProcessLimit(session) {
    if (!session.pty || !session.pty.pid) return;
    
    // Skip process limit check on Windows for now
    if (process.platform === 'win32') {
      return;
    }
    
    // Use pgrep to count child processes (Linux/Mac only)
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
    
    // For Claude sessions, use proper bash wrapper
    if (config.type === 'claude') {
      config.command = process.platform === 'win32' ? 'cmd.exe' : 'bash';
      config.args = process.platform === 'win32'
        ? ['/c', `cd /d "${config.cwd}" && claude`]
        : ['-c', `cd "${config.cwd}" && exec ${process.env.HOME}/.nvm/versions/node/v22.16.0/bin/claude`];
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
  }
}

module.exports = { SessionManager };