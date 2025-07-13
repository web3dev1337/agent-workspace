const pty = require('node-pty');
const { EventEmitter } = require('events');
const winston = require('winston');

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
    this.worktreeBasePath = process.env.WORKTREE_BASE_PATH || '/home/ab';
    this.worktreeCount = parseInt(process.env.WORKTREE_COUNT || '8');
    this.sessionTimeout = parseInt(process.env.SESSION_TIMEOUT || '1800000'); // 30 minutes
    this.maxProcessesPerSession = parseInt(process.env.MAX_PROCESSES_PER_SESSION || '50');
    
    // Build worktree configuration
    this.worktrees = [];
    for (let i = 1; i <= this.worktreeCount; i++) {
      this.worktrees.push({
        id: `work${i}`,
        path: `${this.worktreeBasePath}/HyFire2-work${i}`
      });
    }
  }
  
  setStatusDetector(detector) {
    this.statusDetector = detector;
  }
  
  setGitHelper(helper) {
    this.gitHelper = helper;
  }
  
  initializeSessions() {
    logger.info('Initializing sessions', { count: this.worktrees.length });
    
    for (const worktree of this.worktrees) {
      try {
        // Create Claude session
        this.createSession(`${worktree.id}-claude`, {
          command: 'claude',
          args: [],
          cwd: worktree.path,
          type: 'claude',
          worktreeId: worktree.id
        });
        
        // Create server session
        this.createSession(`${worktree.id}-server`, {
          command: 'bash',
          args: ['-c', `cd "${worktree.path}" && echo "=== Server Terminal for ${worktree.id} ===" && echo "Directory: $(pwd)" && echo "Branch: $(git branch --show-current 2>/dev/null || echo 'unknown')" && echo "" && echo "Ready to run: bun index.ts" && echo "Available commands: bun, npm, node" && echo "" && exec bash`],
          cwd: worktree.path,
          type: 'server',
          worktreeId: worktree.id
        });
        
        // Get initial git branch
        if (this.gitHelper) {
          this.updateGitBranch(worktree.id, worktree.path);
        }
      } catch (error) {
        logger.error('Failed to initialize worktree sessions', { 
          worktree: worktree.id, 
          error: error.message 
        });
      }
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
          // Include snap binaries and common paths
          PATH: `/snap/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}`,
          HOME: config.cwd,
          TERM: 'xterm-color'
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
        
        // Auto-restart Claude sessions that exit unexpectedly
        if (config.type === 'claude' && exitCode !== 0) {
          logger.info('Auto-restarting crashed Claude session', { sessionId });
          setTimeout(() => {
            this.restartSession(sessionId);
          }, 2000);
        } else {
          // Clean up only if not restarting
          this.sessions.delete(sessionId);
        }
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
    clearTimeout(session.inactivityTimer);
    
    return setTimeout(() => {
      logger.warn('Session inactive, terminating', { 
        sessionId: session.id,
        lastActivity: new Date(session.lastActivity).toISOString()
      });
      
      this.terminateSession(session.id);
    }, this.sessionTimeout);
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
    if (!session || !session.pty) return;
    
    logger.info('Terminating session', { sessionId });
    
    try {
      session.pty.kill();
    } catch (error) {
      logger.error('Failed to terminate session', { 
        sessionId, 
        error: error.message 
      });
    }
  }
  
  restartSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    
    logger.info('Restarting session', { sessionId });
    
    // Save config before terminating
    const config = { ...session.config };
    
    // Terminate existing session
    this.terminateSession(sessionId);
    
    // Wait a moment then recreate
    setTimeout(() => {
      try {
        this.createSession(sessionId, config);
        this.io.emit('session-restarted', { sessionId });
        return true;
      } catch (error) {
        logger.error('Failed to restart session', { 
          sessionId, 
          error: error.message 
        });
        return false;
      }
    }, 2000);
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