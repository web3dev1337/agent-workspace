require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const winston = require('winston');

// Initialize logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 5
    }),
    new winston.transports.File({ 
      filename: 'logs/combined.log',
      maxsize: 10485760,
      maxFiles: 5
    }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Import services
const { SessionManager } = require('./sessionManager');
const { StatusDetector } = require('./statusDetector');
const { GitHelper } = require('./gitHelper');
const { NotificationService } = require('./notificationService');
const { UserSettingsService } = require('./userSettingsService');
const { GitUpdateService } = require('./gitUpdateService');
const { WorkspaceManager } = require('./workspaceManager');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ["http://localhost:2080", "http://localhost:3000", "tauri://localhost"],
    credentials: true
  }
});

// Log all requests for debugging
app.use((req, res, next) => {
  logger.info(`Request: ${req.method} ${req.path}`);
  next();
});

// Define specific routes BEFORE static file serving
// Serve the UI as default
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Serve static files from client directory (but exclude index files)
const clientPath = path.join(__dirname, '../client');
logger.info(`Serving static files from: ${clientPath}`);
app.use(express.static(clientPath, {
  index: false // Don't automatically serve index.html
}));

// Basic auth middleware (optional)
const AUTH_TOKEN = process.env.AUTH_TOKEN;
if (AUTH_TOKEN) {
  app.use((req, res, next) => {
    // Skip auth for socket.io requests
    if (req.path.startsWith('/socket.io/')) {
      return next();
    }
    
    const token = req.headers['x-auth-token'] || req.query.token;
    if (token !== AUTH_TOKEN) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  });
  
  // Socket.IO auth
  io.use((socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.query.token;
    if (token !== AUTH_TOKEN) {
      return next(new Error('Authentication failed'));
    }
    next();
  });
}

// Initialize services
const workspaceManager = WorkspaceManager.getInstance();
const sessionManager = new SessionManager(io);
const statusDetector = new StatusDetector();
const gitHelper = new GitHelper();
const notificationService = new NotificationService(io);

// Connect services
sessionManager.setStatusDetector(statusDetector);
sessionManager.setGitHelper(gitHelper);

// Initialize workspace system
let workspaceInitialized = false;
async function initializeWorkspaceSystem() {
  try {
    logger.info('Initializing workspace system...');
    await workspaceManager.initialize();

    const activeWorkspace = workspaceManager.getActiveWorkspace();
    if (activeWorkspace) {
      logger.info(`Active workspace: ${activeWorkspace.name}`);
      sessionManager.setWorkspace(activeWorkspace);
      workspaceInitialized = true;
    } else {
      logger.warn('No active workspace found');
    }
  } catch (error) {
    logger.error('Failed to initialize workspace system', { error: error.message });
  }
}

// Initialize workspace system before starting server
initializeWorkspaceSystem().then(() => {
  logger.info('Workspace system initialized');
}).catch(error => {
  logger.error('Workspace system initialization failed', { error: error.message });
});

// WebSocket connection handling
io.on('connection', (socket) => {
  logger.info('Client connected', { socketId: socket.id });

  // Send workspace info
  const activeWorkspace = workspaceManager.getActiveWorkspace();
  const workspaces = workspaceManager.listWorkspaces();
  socket.emit('workspace-info', {
    active: activeWorkspace,
    available: workspaces,
    config: workspaceManager.getConfig()
  });

  // Send initial session states
  socket.emit('sessions', sessionManager.getSessionStates());
  
  // Handle terminal input
  socket.on('terminal-input', ({ sessionId, data }) => {
    logger.debug('Terminal input received', { sessionId, dataLength: data.length });
    sessionManager.writeToSession(sessionId, data);
  });
  
  // Handle terminal resize
  socket.on('terminal-resize', ({ sessionId, cols, rows }) => {
    logger.debug('Terminal resize', { sessionId, cols, rows });
    sessionManager.resizeSession(sessionId, cols, rows);
  });
  
  // Handle session restart
  socket.on('restart-session', ({ sessionId }) => {
    logger.info('Session restart requested', { sessionId });
    sessionManager.restartSession(sessionId);
  });
  
  // Handle Claude start with specific options
  socket.on('start-claude', ({ sessionId, options }) => {
    logger.info('Claude start requested', { sessionId, options });
    sessionManager.startClaudeWithOptions(sessionId, options);
  });
  
  // Handle session heartbeat to keep sessions alive while UI is open
  socket.on('session-heartbeat', ({ sessionId }) => {
    sessionManager.heartbeat(sessionId);
  });
  
  // Handle server control
  socket.on('server-control', ({ sessionId, action, environment, launchSettings }) => {
    logger.info('Server control request', { sessionId, action, environment, launchSettings });

    if (action === 'start') {
      // Extract worktree number and assign port accordingly
      const worktreeMatch = sessionId.match(/work(\d+)/);
      const worktreeNum = worktreeMatch ? parseInt(worktreeMatch[1]) : 1;
      const port = 8080 + worktreeNum - 1; // work1=8080, work2=8081, etc.

      // Clear any existing input first with Ctrl+C, then send command
      sessionManager.writeToSession(sessionId, '\x03'); // Ctrl+C to clear

      setTimeout(() => {
        // Build command with NODE_ENV and custom settings
        const nodeEnv = environment === 'production' ? 'production' : 'development';

        // Start with base environment variables
        let envVars = `NODE_ENV=${nodeEnv} PORT=${port}`;

        // Add custom environment variables if provided
        if (launchSettings && launchSettings.envVars) {
          envVars += ` ${launchSettings.envVars}`;
        }

        // Build the command
        let command = envVars;

        // Add node options if provided
        if (launchSettings && launchSettings.nodeOptions) {
          command += ` node ${launchSettings.nodeOptions} $(which hytopia) start`;
        } else {
          command += ` hytopia start`;
        }

        // Add game arguments if provided
        if (launchSettings && launchSettings.gameArgs) {
          command += ` ${launchSettings.gameArgs}`;
        }

        command += '\n';

        logger.info('Starting server with command', { sessionId, command, port, nodeEnv });

        const written = sessionManager.writeToSession(sessionId, command);
        if (!written) {
          logger.error('Failed to write command to session', { sessionId });
          return;
        }

        // Emit port info back to client
        socket.emit('server-started', { sessionId, port, environment: nodeEnv });
      }, 100); // Small delay after Ctrl+C
    } else if (action === 'stop') {
      sessionManager.writeToSession(sessionId, '\x03'); // Ctrl+C
    } else if (action === 'kill') {
      sessionManager.writeToSession(sessionId, '\x03\x03'); // Double Ctrl+C
    }
  });
  
  // Handle build production request
  socket.on('build-production', ({ sessionId, worktreeNum }) => {
    logger.info('Build production requested', { sessionId, worktreeNum });
    
    const { spawn } = require('child_process');
    const fs = require('fs');
    const path = require('path');
    
    // Construct the path to the build script
    const scriptPath = `/home/anrokx/HyFire2-work${worktreeNum}/build-production-with-console.sh`;
    
    // Check if script exists
    if (!fs.existsSync(scriptPath)) {
      logger.error('Build script not found', { scriptPath });
      socket.emit('build-failed', { 
        sessionId, 
        worktreeNum, 
        error: 'Build script not found' 
      });
      return;
    }
    
    // Emit build started
    socket.emit('build-started', { sessionId, worktreeNum });
    
    // Run the build script
    const buildProcess = spawn('bash', [scriptPath], {
      cwd: `/home/anrokx/HyFire2-work${worktreeNum}`
    });
    
    let buildOutput = '';
    let errorOutput = '';
    
    buildProcess.stdout.on('data', (data) => {
      buildOutput += data.toString();
      logger.debug('Build output', { worktreeNum, data: data.toString() });
    });
    
    buildProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
      logger.warn('Build error output', { worktreeNum, data: data.toString() });
    });
    
    buildProcess.on('error', (error) => {
      logger.error('Build process error', { worktreeNum, error: error.message });
      socket.emit('build-failed', { 
        sessionId, 
        worktreeNum, 
        error: error.message 
      });
    });
    
    buildProcess.on('close', (code) => {
      if (code === 0) {
        // Build succeeded - find the created zip file in the worktree root
        const worktreePath = `/home/anrokx/HyFire2-work${worktreeNum}`;
        
        // Look for the most recently created .zip file with console pattern
        try {
          const files = fs.readdirSync(worktreePath);
          // Look for zips with the console pattern (e.g., hyfire2-with-console-*.zip)
          const zipFiles = files.filter(f => f.endsWith('.zip') && f.includes('console'));
          
          if (zipFiles.length > 0) {
            // Get the most recent zip file
            const zipStats = zipFiles.map(f => ({
              name: f,
              path: path.join(worktreePath, f),
              mtime: fs.statSync(path.join(worktreePath, f)).mtime
            }));
            
            zipStats.sort((a, b) => b.mtime - a.mtime);
            const latestZip = zipStats[0];
            
            logger.info('Build completed successfully', { 
              worktreeNum, 
              zipPath: latestZip.path 
            });
            
            socket.emit('build-completed', { 
              sessionId, 
              worktreeNum, 
              zipPath: latestZip.path 
            });
          } else {
            logger.warn('Build completed but no zip file found', { worktreeNum });
            socket.emit('build-failed', { 
              sessionId, 
              worktreeNum, 
              error: 'Build completed but no zip file was created' 
            });
          }
        } catch (error) {
          logger.error('Error finding build output', { 
            worktreeNum, 
            error: error.message 
          });
          socket.emit('build-failed', { 
            sessionId, 
            worktreeNum, 
            error: 'Failed to locate build output' 
          });
        }
      } else {
        logger.error('Build failed with non-zero exit code', { 
          worktreeNum, 
          code, 
          errorOutput 
        });
        socket.emit('build-failed', { 
          sessionId, 
          worktreeNum, 
          error: `Build failed with exit code ${code}` 
        });
      }
    });
  });
  
  // Handle reveal in explorer request
  socket.on('reveal-in-explorer', ({ path: filePath }) => {
    logger.info('Reveal in explorer requested', { filePath });
    
    const { exec } = require('child_process');
    
    // Use xdg-open on Linux/WSL to open the file manager
    // The file manager will open to the directory containing the file
    const dirPath = path.dirname(filePath);
    const command = `explorer.exe "$(wslpath -w '${dirPath}')"`;
    
    exec(command, (error, stdout, stderr) => {
      if (error) {
        logger.error('Failed to open file explorer', { 
          error: error.message, 
          stderr 
        });
      } else {
        logger.info('File explorer opened successfully', { dirPath });
      }
    });
  });
  
  socket.on('disconnect', () => {
    logger.info('Client disconnected', { socketId: socket.id });
  });
  
  socket.on('error', (error) => {
    logger.error('Socket error', { error: error.message, socketId: socket.id });
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Claude hook endpoints
app.post('/api/claude-ready', express.json(), (req, res) => {
  const { worktree, sessionId } = req.body;
  logger.info('Claude ready notification from hook', { worktree, sessionId });
  
  // Update session status to waiting
  const session = sessionManager.sessions.get(sessionId);
  if (session) {
    session.status = 'waiting';
    sessionManager.emitStatusUpdate(sessionId, 'waiting');
    
    // Trigger notification
    io.emit('notification-trigger', {
      sessionId,
      type: 'waiting',
      message: `Claude ${worktree} finished responding`,
      branch: session.branch
    });
  }
  
  res.json({ success: true });
});

app.post('/api/claude-notification', express.json(), (req, res) => {
  const { worktree, sessionId, message } = req.body;
  logger.info('Claude notification from hook', { worktree, sessionId, message });
  
  // Forward notification to clients
  io.emit('notification-trigger', {
    sessionId,
    type: 'notification',
    message: message,
    worktree: worktree
  });
  
  res.json({ success: true });
});

// Service instances
const userSettingsService = UserSettingsService.getInstance();
const gitUpdateService = GitUpdateService.getInstance();

// Get all user settings
app.get('/api/user-settings', (req, res) => {
  try {
    const settings = userSettingsService.getAllSettings();
    res.json(settings);
  } catch (error) {
    logger.error('Failed to get user settings', { error: error.message });
    res.status(500).json({ error: 'Failed to get user settings' });
  }
});

// Update global settings
app.put('/api/user-settings/global', express.json(), (req, res) => {
  try {
    const { global } = req.body;
    const success = userSettingsService.updateGlobalSettings(global);
    
    if (success) {
      const updatedSettings = userSettingsService.getAllSettings();
      res.json(updatedSettings);
      
      // Notify all clients about settings change
      io.emit('user-settings-updated', updatedSettings);
    } else {
      res.status(500).json({ error: 'Failed to save settings' });
    }
  } catch (error) {
    logger.error('Failed to update global settings', { error: error.message });
    res.status(500).json({ error: 'Failed to update global settings' });
  }
});

// Update per-terminal settings
app.put('/api/user-settings/terminal/:sessionId', express.json(), (req, res) => {
  try {
    const { sessionId } = req.params;
    const settings = req.body;
    const success = userSettingsService.updatePerTerminalSettings(sessionId, settings);
    
    if (success) {
      const updatedSettings = userSettingsService.getAllSettings();
      res.json(updatedSettings);
      
      // Notify all clients about settings change
      io.emit('user-settings-updated', updatedSettings);
    } else {
      res.status(500).json({ error: 'Failed to save settings' });
    }
  } catch (error) {
    logger.error('Failed to update per-terminal settings', { 
      sessionId: req.params.sessionId, 
      error: error.message 
    });
    res.status(500).json({ error: 'Failed to update per-terminal settings' });
  }
});

// Clear per-terminal settings
app.delete('/api/user-settings/terminal/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    const success = userSettingsService.clearPerTerminalSettings(sessionId);
    
    if (success) {
      const updatedSettings = userSettingsService.getAllSettings();
      res.json(updatedSettings);
      
      // Notify all clients about settings change
      io.emit('user-settings-updated', updatedSettings);
    } else {
      res.status(500).json({ error: 'Failed to clear settings' });
    }
  } catch (error) {
    logger.error('Failed to clear per-terminal settings', { 
      sessionId: req.params.sessionId, 
      error: error.message 
    });
    res.status(500).json({ error: 'Failed to clear per-terminal settings' });
  }
});

// Get effective settings for a specific session
app.get('/api/user-settings/effective/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    const effectiveSettings = userSettingsService.getEffectiveSettings(sessionId);
    res.json(effectiveSettings);
  } catch (error) {
    logger.error('Failed to get effective settings', { 
      sessionId: req.params.sessionId, 
      error: error.message 
    });
    res.status(500).json({ error: 'Failed to get effective settings' });
  }
});

// Get default template
app.get('/api/user-settings/default', (req, res) => {
  try {
    const defaultTemplate = userSettingsService.getDefaultTemplate();
    res.json(defaultTemplate);
  } catch (error) {
    logger.error('Failed to get default template', { error: error.message });
    res.status(500).json({ error: 'Failed to get default template' });
  }
});

// Reset user settings to defaults
app.post('/api/user-settings/reset', (req, res) => {
  try {
    const success = userSettingsService.resetToDefaults();
    
    if (success) {
      const updatedSettings = userSettingsService.getAllSettings();
      res.json(updatedSettings);
      
      // Notify all clients about settings change
      io.emit('user-settings-updated', updatedSettings);
    } else {
      res.status(500).json({ error: 'Failed to reset settings' });
    }
  } catch (error) {
    logger.error('Failed to reset settings', { error: error.message });
    res.status(500).json({ error: 'Failed to reset settings' });
  }
});

// Save current settings as default template
app.post('/api/user-settings/save-as-default', (req, res) => {
  try {
    const success = userSettingsService.saveAsDefault();
    
    if (success) {
      res.json({ success: true, message: 'Settings saved as default template' });
    } else {
      res.status(500).json({ error: 'Failed to save as default template' });
    }
  } catch (error) {
    logger.error('Failed to save as default template', { error: error.message });
    res.status(500).json({ error: 'Failed to save as default template' });
  }
});

// Check for default settings updates
app.get('/api/user-settings/check-updates', (req, res) => {
  try {
    const updateCheck = userSettingsService.checkForDefaultUpdates();
    res.json(updateCheck);
  } catch (error) {
    logger.error('Failed to check for settings updates', { error: error.message });
    res.status(500).json({ error: 'Failed to check for settings updates' });
  }
});

// Git update API endpoints
app.get('/api/git/status', (req, res) => {
  gitUpdateService.getStatus()
    .then(status => res.json(status))
    .catch(error => {
      logger.error('Failed to get git status', { error: error.message });
      res.status(500).json({ error: 'Failed to get git status' });
    });
});

app.get('/api/git/check-updates', (req, res) => {
  gitUpdateService.checkForUpdates()
    .then(result => res.json(result))
    .catch(error => {
      logger.error('Failed to check for git updates', { error: error.message });
      res.status(500).json({ error: 'Failed to check for git updates' });
    });
});

app.post('/api/git/pull', (req, res) => {
  gitUpdateService.pullLatest()
    .then(result => {
      if (result.success) {
        // Notify clients about successful update
        io.emit('git-updated', result);
      }
      res.json(result);
    })
    .catch(error => {
      logger.error('Failed to pull latest changes', { error: error.message });
      res.status(500).json({ error: 'Failed to pull latest changes' });
    });
});

// Get worktree configuration for frontend
app.get('/api/worktrees/config', (req, res) => {
  try {
    const config = {
      basePath: sessionManager.worktreeBasePath,
      count: sessionManager.worktreeCount,
      worktrees: sessionManager.worktrees
    };
    res.json(config);
  } catch (error) {
    logger.error('Failed to get worktree config', { error: error.message });
    res.status(500).json({ error: 'Failed to get worktree config' });
  }
});

// Serve replay viewer for each worktree
app.get('/replay-viewer/:worktreeId/*?', (req, res) => {
  try {
    const { worktreeId } = req.params;
    const worktreeNum = worktreeId.replace('work', '');
    const requestedFile = req.params[0] || 'index.html';
    const replayViewerPath = path.join(sessionManager.worktreeBasePath, `HyFire2-work${worktreeNum}`, 'tools', 'replay-viewer', requestedFile);
    
    logger.info('Serving replay viewer file', { worktreeId, requestedFile, path: replayViewerPath });
    
    if (require('fs').existsSync(replayViewerPath)) {
      res.sendFile(replayViewerPath);
    } else {
      logger.warn('Replay viewer file not found', { path: replayViewerPath });
      res.status(404).send(`Replay viewer file not found: ${requestedFile}`);
    }
  } catch (error) {
    logger.error('Error serving replay viewer', { error: error.message });
    res.status(500).send('Error loading replay viewer');
  }
});

// Start server
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

httpServer.listen(PORT, HOST, () => {
  logger.info(`Server running on http://${HOST}:${PORT}`);
  if (HOST === '0.0.0.0') {
    logger.info(`LAN access available on port ${PORT}`);
  }
  if (AUTH_TOKEN) {
    logger.info('Authentication enabled');
  }
  
  // Initialize sessions
  sessionManager.initializeSessions().catch(error => {
    logger.error('Failed to initialize sessions', { error: error.message });
  });
});

// Graceful shutdown
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

function shutdown() {
  logger.info('Shutting down server...');
  
  // Clean up sessions first
  sessionManager.cleanup();
  
  // Close socket connections
  io.close(() => {
    logger.info('Socket.IO connections closed');
  });
  
  // Close HTTP server
  httpServer.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
  
  // Force shutdown after 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  shutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', { reason, promise });
});