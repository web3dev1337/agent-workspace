require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
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
const { WorktreeHelper } = require('./worktreeHelper');
const AgentManager = require('./agentManager');
const { PortRegistry } = require('./portRegistry');
const { GreenfieldService } = require('./greenfieldService');
const { ContinuityService } = require('./continuityService');
const { QuickLinksService } = require('./quickLinksService');
const { ProductLauncherService } = require('./productLauncherService');
const { CommanderService } = require('./commanderService');
const { ConversationService } = require('./conversationService');
const { WorktreeMetadataService } = require('./worktreeMetadataService');
const { WorktreeGitService } = require('./worktreeGitService');
const { ProjectMetadataService } = require('./projectMetadataService');
const { WorktreeConflictService } = require('./worktreeConflictService');
const { WorktreeTagService } = require('./worktreeTagService');
const { DiffViewerService } = require('./diffViewerService');
const { PullRequestService } = require('./pullRequestService');
const { ProcessTaskService } = require('./processTaskService');
const { ProcessStatusService } = require('./processStatusService');
const { ProcessTelemetryService } = require('./processTelemetryService');
const { ProcessProjectDashboardService } = require('./processProjectDashboardService');
const { ProcessAdvisorService } = require('./processAdvisorService');
const { TelemetrySnapshotService } = require('./telemetrySnapshotService');
const { TaskRecordService } = require('./taskRecordService');
const { PromptArtifactService, safeId, sha256, formatPointerComment } = require('./promptArtifactService');
const { TaskDependencyService } = require('./taskDependencyService');
const { TaskTicketingService } = require('./taskTicketingService');
const { PrMergeAutomationService } = require('./prMergeAutomationService');
const commandRegistry = require('./commandRegistry');
const voiceCommandService = require('./voiceCommandService');
const whisperService = require('./whisperService');
const sessionRecoveryService = require('./sessionRecoveryService');
const multer = require('multer');

// Configure multer for audio file uploads
const audioUpload = multer({
  dest: path.join(os.tmpdir(), 'orchestrator-audio'),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['audio/webm', 'audio/wav', 'audio/mp3', 'audio/mpeg', 'audio/ogg', 'audio/x-wav'];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(wav|webm|mp3|ogg)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid audio format'));
    }
  }
});

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || origin === 'tauri://localhost' || origin.startsWith('http://localhost:')) {
        callback(null, true);
        return;
      }
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true
  }
});

// Log requests only in debug mode (reduces console spam)
app.use((req, res, next) => {
  // Skip noisy static file requests
  if (!req.path.startsWith('/api') && !req.path.startsWith('/socket.io')) {
    logger.debug(`Request: ${req.method} ${req.path}`);
  } else if (req.path.startsWith('/api')) {
    logger.info(`API: ${req.method} ${req.path}`);
  }
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

// Middleware for JSON parsing (capture rawBody for webhook signature verification)
app.use(express.json({
  verify: (req, res, buf) => {
    try {
      req.rawBody = buf;
    } catch {
      // ignore
    }
  }
}));

// Basic auth middleware (optional)
const AUTH_TOKEN = process.env.AUTH_TOKEN;
if (AUTH_TOKEN) {
  app.use((req, res, next) => {
    // Skip auth for socket.io requests
    if (req.path.startsWith('/socket.io/')) {
      return next();
    }
    // GitHub webhooks use signature auth instead of the UI auth token.
    if (req.path === '/api/webhooks/github') {
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
const agentManager = new AgentManager();
const sessionManager = new SessionManager(io, agentManager);
const statusDetector = new StatusDetector();
const gitHelper = new GitHelper();
const notificationService = new NotificationService(io);
const worktreeHelper = new WorktreeHelper();
const portRegistry = PortRegistry.getInstance();
const greenfieldService = GreenfieldService.getInstance();
greenfieldService.setSessionManager(sessionManager);
greenfieldService.setIO(io);
const continuityService = ContinuityService.getInstance();
const quickLinksService = QuickLinksService.getInstance();
const productLauncherService = ProductLauncherService.getInstance();
const conversationService = ConversationService.getInstance();
const worktreeMetadataService = WorktreeMetadataService.getInstance();
const worktreeGitService = WorktreeGitService.getInstance();
const projectMetadataService = ProjectMetadataService.getInstance();
const worktreeConflictService = new WorktreeConflictService({ projectMetadataService, worktreeMetadataService });
const worktreeTagService = WorktreeTagService.getInstance();
const diffViewerService = DiffViewerService.getInstance();
const pullRequestService = PullRequestService.getInstance();
const processTaskService = ProcessTaskService.getInstance({ sessionManager, worktreeTagService, pullRequestService });
const taskRecordService = TaskRecordService.getInstance();
const processStatusService = ProcessStatusService.getInstance({ processTaskService, taskRecordService, sessionManager, workspaceManager });
const processTelemetryService = ProcessTelemetryService.getInstance({ taskRecordService });
const telemetrySnapshotService = TelemetrySnapshotService.getInstance();
const processProjectDashboardService = ProcessProjectDashboardService.getInstance({ pullRequestService, taskRecordService });
const promptArtifactService = PromptArtifactService.getInstance();
const taskTicketingService = TaskTicketingService.getInstance();
const taskDependencyService = TaskDependencyService.getInstance({ taskRecordService, pullRequestService, taskTicketingService });
const processAdvisorService = ProcessAdvisorService.getInstance({ processStatusService, processTelemetryService, processTaskService, taskRecordService, taskDependencyService });

// Initialize Commander service (Top-Level AI as Claude Code terminal)
const commanderService = CommanderService.getInstance({
  sessionManager,
  io
});

// Initialize Command Registry for Commander UI control
commandRegistry.init({
  io,
  sessionManager,
  workspaceManager
});

// Connect services
sessionManager.setStatusDetector(statusDetector);
sessionManager.setGitHelper(gitHelper);

// Initialize workspace system
let workspaceInitialized = false;
async function initializeWorkspaceSystem() {
  try {
    logger.info('Initializing workspace system...');
    await workspaceManager.initialize();

    // Initialize session recovery service
    await sessionRecoveryService.init();

    const activeWorkspace = workspaceManager.getActiveWorkspace();
    if (activeWorkspace) {
      logger.info(`Active workspace: ${activeWorkspace.name}`);
      sessionManager.setWorkspace(activeWorkspace);
      workspaceInitialized = true;

      // Load recovery state for active workspace
      await sessionRecoveryService.loadWorkspaceState(activeWorkspace.id);
    } else {
      logger.warn('No active workspace found');
    }
  } catch (error) {
    logger.error('Failed to initialize workspace system', { error: error.message, stack: error.stack });
  }
}

// Initialize workspace system before starting server
initializeWorkspaceSystem().then(() => {
  logger.info('Workspace system initialized');
}).catch(error => {
  logger.error('Workspace system initialization failed', { error: error.message, stack: error.stack });
});

// WebSocket connection handling
io.on('connection', (socket) => {
  logger.info('Client connected', { socketId: socket.id });

  // Send workspace info
  const activeWorkspace = workspaceManager.getActiveWorkspace();
  const workspaces = workspaceManager.listWorkspaces();

  // Build cascaded configs for all workspace types
  const allTypes = workspaceManager.getAllWorkspaceTypes();
  const cascadedConfigs = {};
  for (const typeId in allTypes) {
    const cascaded = workspaceManager.getCascadedConfig(typeId);
    if (cascaded) {
      cascadedConfigs[typeId] = cascaded;
    }
  }

  socket.emit('workspace-info', {
    active: activeWorkspace,
    available: workspaces,
    config: workspaceManager.getConfig(),
    workspaceTypes: allTypes,
    frameworks: workspaceManager.discoveredWorkspaceTypes?.frameworks || {},
    cascadedConfigs: cascadedConfigs  // Pre-computed cascaded configs
  });

  // Send initial session states
  socket.emit('sessions', sessionManager.getSessionStates());
  
  // Handle terminal input (accepts both 'data' and 'input' for compatibility)
  socket.on('terminal-input', ({ sessionId, data, input }) => {
    const inputData = data || input;
    if (!inputData) {
      logger.warn('Terminal input received with no data', { sessionId });
      return;
    }
    logger.debug('Terminal input received', { sessionId, dataLength: inputData.length });
    sessionManager.writeToSession(sessionId, inputData);
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
  
  // Handle Claude start with specific options (legacy)
  socket.on('start-claude', ({ sessionId, options }) => {
    logger.info('Claude start requested (legacy)', { sessionId, options });
    sessionManager.startClaudeWithOptions(sessionId, options);
  });

  // Handle agent start with configuration
  socket.on('start-agent', ({ sessionId, config }) => {
    logger.info('Agent start requested', { sessionId, config });
    sessionManager.startAgentWithConfig(sessionId, config);
  });
  
  // Handle session heartbeat to keep sessions alive while UI is open
  socket.on('session-heartbeat', ({ sessionId }) => {
    sessionManager.heartbeat(sessionId);
  });
  
  // Handle server control
  socket.on('server-control', async ({ sessionId, action, environment, launchSettings }) => {
    logger.info('Server control request', { sessionId, action, environment, launchSettings });

    if (action === 'start') {
      // Get session info to find repository path and worktree ID
      const session = sessionManager.sessions.get(sessionId);
      const worktreeMatch = sessionId.match(/work(\d+)/);
      const worktreeNum = worktreeMatch ? parseInt(worktreeMatch[1]) : 1;

      // Use port registry to get a port (avoids conflicts)
      const repoPath = session?.config?.cwd || 'default';
      const worktreeId = session?.worktreeId || `work${worktreeNum}`;
      const port = await portRegistry.suggestPort(worktreeNum, repoPath, worktreeId);

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

        logger.info('Starting server with command', { sessionId, command, port, nodeEnv, repoPath, worktreeId });

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

      // Release the port when stopping
      const session = sessionManager.sessions.get(sessionId);
      if (session?.config?.cwd && session?.worktreeId) {
        portRegistry.releasePort(session.config.cwd, session.worktreeId);
      }
    } else if (action === 'kill') {
      sessionManager.writeToSession(sessionId, '\x03\x03'); // Double Ctrl+C

      // Release the port when killing
      const session = sessionManager.sessions.get(sessionId);
      if (session?.config?.cwd && session?.worktreeId) {
        portRegistry.releasePort(session.config.cwd, session.worktreeId);
      }
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
      logger.error('Build process error', { worktreeNum, error: error.message, stack: error.stack });
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

  // Workspace management handlers
  socket.on('switch-workspace', async ({ workspaceId }) => {
    try {
      logger.info('Workspace switch requested', { workspaceId });

      const newWorkspace = await workspaceManager.switchWorkspace(workspaceId);

      // Ensure worktrees exist for the new workspace
      logger.info('Ensuring worktrees exist for new workspace');
      await worktreeHelper.ensureWorktreesExist(newWorkspace);

      // Switch active workspace while preserving existing PTYs for other workspace tabs.
      const { sessions: newSessions, backlog } =
        await sessionManager.switchWorkspacePreservingSessions(newWorkspace);

      // Emit success with ONLY the new workspace sessions (active workspace map)
      logger.info('Sending workspace-changed event', {
        workspace: newWorkspace.name,
        sessionCount: Object.keys(newSessions).length
      });

      // IMPORTANT: Only emit to the requesting client, not all clients
      // Using io.emit would cause all connected clients to create duplicate tabs
      socket.emit('workspace-changed', {
        workspace: newWorkspace,
        sessions: newSessions
      });

      // Send any buffered output that occurred while this workspace was inactive,
      // so terminals pick up where they left off after tab switching.
      if (backlog && typeof backlog === 'object') {
        for (const [sessionId, data] of Object.entries(backlog)) {
          if (!data) continue;
          socket.emit('terminal-output', { sessionId, data });
        }
      }

      logger.info('Workspace switched successfully', { workspace: newWorkspace.name });
    } catch (error) {
      logger.error('Failed to switch workspace', { error: error.message, stack: error.stack });
      socket.emit('error', { message: 'Failed to switch workspace', error: error.message, stack: error.stack });
    }
  });

  socket.on('list-workspaces', async ({ refresh = false } = {}) => {
    try {
      // Reload from disk if refresh requested (picks up new/modified workspaces)
      if (refresh) {
        await workspaceManager.reloadWorkspaces();
      }
      const workspaces = await workspaceManager.listWorkspacesEnriched();
      socket.emit('workspaces-list', workspaces);
    } catch (error) {
      logger.warn('Failed to list workspaces (enriched)', { error: error.message });
      socket.emit('workspaces-list', workspaceManager.listWorkspaces());
    }
  });

  // Add sessions for a new worktree without destroying existing sessions
  socket.on('add-worktree-sessions', async ({ worktreeId, worktreePath, repositoryName, repositoryType, repositoryRoot, startTier }) => {
    try {
      logger.info('Adding sessions for new worktree', { worktreeId, worktreePath, repositoryName });

      // Create sessions for just this worktree
      const newSessions = await sessionManager.createSessionsForWorktree({
        worktreeId,
        worktreePath,
        repositoryName,
        repositoryType
      });

      // IMPORTANT: Update workspace config to persist this worktree
      // This ensures the worktree survives page reloads
      const activeWorkspace = workspaceManager.getActiveWorkspace();
      if (activeWorkspace) {
        try {
          const updatedConfig = { ...activeWorkspace };

          // Handle mixed-repo workspaces (terminals is an array)
          if (Array.isArray(updatedConfig.terminals)) {
            // Add new terminal entries for claude and server
            const baseRepo = {
              name: repositoryName || worktreeId.split('-')[0],
              path: repositoryRoot || worktreePath.replace(/\/work\d+$/, ''),
              type: repositoryType,
              masterBranch: 'master'
            };

            const terminalIdBase = repositoryName
              ? `${repositoryName}-${worktreeId}`
              : worktreeId;

            updatedConfig.terminals.push({
              id: `${terminalIdBase}-claude`,
              repository: baseRepo,
              worktree: worktreeId,
              worktreePath: worktreePath,
              terminalType: 'claude',
              visible: true
            });
            updatedConfig.terminals.push({
              id: `${terminalIdBase}-server`,
              repository: baseRepo,
              worktree: worktreeId,
              worktreePath: worktreePath,
              terminalType: 'server',
              visible: true
            });
          }
          // Handle single-repo workspaces (terminals.pairs is a number)
          else if (updatedConfig.terminals && typeof updatedConfig.terminals.pairs === 'number') {
            // Extract worktree number from ID (e.g., "work5" -> 5)
            const worktreeNum = parseInt(worktreeId.replace(/\D/g, '')) || updatedConfig.terminals.pairs + 1;
            if (worktreeNum > updatedConfig.terminals.pairs) {
              updatedConfig.terminals.pairs = worktreeNum;
            }
            // Also update worktrees.count if it exists
            if (updatedConfig.worktrees && typeof updatedConfig.worktrees.count === 'number') {
              if (worktreeNum > updatedConfig.worktrees.count) {
                updatedConfig.worktrees.count = worktreeNum;
              }
            }
          }

          await workspaceManager.updateWorkspace(activeWorkspace.id, updatedConfig);
          logger.info('Workspace config updated with new worktree', { worktreeId, workspaceId: activeWorkspace.id });
        } catch (configError) {
          logger.warn('Failed to update workspace config (sessions still created)', { error: configError.message });
        }
      }

      // Emit the new sessions to the requesting client only
      const tier = Number(startTier);
      socket.emit('worktree-sessions-added', {
        worktreeId,
        sessions: newSessions,
        startTier: (tier >= 1 && tier <= 4) ? tier : undefined
      });

      logger.info('Worktree sessions added successfully', {
        worktreeId,
        sessionCount: Object.keys(newSessions).length
      });
    } catch (error) {
      logger.error('Failed to add worktree sessions', { worktreeId, error: error.message });
      socket.emit('error', { message: 'Failed to add worktree sessions', error: error.message });
    }
  });

  // Handle tab closure - cleanup all sessions for the tab
  socket.on('close-tab', ({ tabId }) => {
    try {
      logger.info('Tab close requested', { tabId });

      // Get all sessions and close those belonging to this tab
      // Note: In the current implementation, we don't track tabId on the backend
      // This would require backend changes to associate sessions with tabs
      // For now, this event is acknowledged but sessions are managed by client
      logger.info('Tab closed', { tabId });
    } catch (error) {
      logger.error('Failed to close tab', { tabId, error: error.message });
    }
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

// Workspace API endpoints
app.get('/api/workspaces', (req, res) => {
  try {
    const workspaces = workspaceManager.listWorkspaces();
    res.json(workspaces);
  } catch (error) {
    logger.error('Failed to list workspaces', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to list workspaces' });
  }
});

// Get dynamic workspace types for frontend
app.get('/api/workspace-types', (req, res) => {
  try {
    const allTypes = workspaceManager.getAllWorkspaceTypes();
    const frameworks = workspaceManager.discoveredWorkspaceTypes?.frameworks || {};

    // Build cascaded configs for all workspace types
    const cascadedConfigs = {};
    for (const typeId in allTypes) {
      const cascaded = workspaceManager.getCascadedConfig(typeId);
      if (cascaded) {
        cascadedConfigs[typeId] = cascaded;
      }
    }

    res.json({
      workspaceTypes: allTypes,
      frameworks: frameworks,
      hierarchy: workspaceManager.discoveredWorkspaceTypes?.categories || {},
      cascadedConfigs: cascadedConfigs  // Pre-computed cascaded configs
    });
  } catch (error) {
    logger.error('Failed to get workspace types', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to get workspace types' });
  }
});

// Get cascaded config for a specific worktree
app.get('/api/cascaded-config/:repositoryType', async (req, res) => {
  try {
    const { repositoryType } = req.params;
    const { worktreePath } = req.query;

    if (worktreePath) {
      // Get worktree-specific config
      const config = await workspaceManager.getCascadedConfigForWorktree(repositoryType, worktreePath);
      res.json(config || {});
    } else {
      // Get generic config (for backward compatibility)
      const config = workspaceManager.getCascadedConfig(repositoryType);
      res.json(config || {});
    }
  } catch (error) {
    logger.error('Failed to get cascaded config', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to get cascaded config' });
  }
});

app.post('/api/workspaces', async (req, res) => {
  try {
    const workspaceData = req.body;
    logger.info('Creating workspace via API', { name: workspaceData.name });

    const workspace = await workspaceManager.createWorkspace(workspaceData);
    res.json(workspace);
  } catch (error) {
    logger.error('Failed to create workspace', { error: error.message, stack: error.stack });
    res.status(400).json({ error: error.message, stack: error.stack });
  }
});

app.get('/api/workspaces/scan-repos', async (req, res) => {
  try {
    logger.info('Starting repository scan...');
    const fs = require('fs').promises;
    const path = require('path');

    const projects = [];
    const projectIndexByKey = new Map();
    const worktreeGroups = new Map();
    const gitHubPath = path.join(require('os').homedir(), 'GitHub');

    // Deep scan function
    async function scanDirectory(dirPath, depth = 0, maxDepth = 4) {
      if (depth > maxDepth) return;

      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (entry.name.startsWith('.')) continue; // Skip hidden dirs
          if (entry.name === 'node_modules') continue;

          const fullPath = path.join(dirPath, entry.name);

          // Detect sibling worktree directories like "repo-work7"
          const worktreeMatch = entry.name.match(/^(.*)-work(\d+)$/i);
          if (worktreeMatch) {
            const baseName = worktreeMatch[1];
            const worktreeNumber = parseInt(worktreeMatch[2], 10);
            const key = path.join(dirPath, baseName);
            let lastModifiedMs = 0;
            let createdMs = 0;
            try {
              const wtStat = await fs.stat(fullPath);
              lastModifiedMs = wtStat.mtimeMs;
              createdMs = wtStat.birthtimeMs || wtStat.ctimeMs || 0;
            } catch (statError) {
              lastModifiedMs = 0;
              createdMs = 0;
            }

            if (!worktreeGroups.has(key)) {
              worktreeGroups.set(key, {
                baseName,
                parentDir: dirPath,
                entries: []
              });
            }

            worktreeGroups.get(key).entries.push({
              id: `work${worktreeNumber}`,
              name: entry.name,
              path: fullPath,
              number: worktreeNumber,
              lastModifiedMs,
              createdMs
            });
            continue;
          }

          // Check if this looks like a project (has package.json, .git, or other indicators)
          const isProject = await isProjectDirectory(fullPath);

          if (isProject) {
            // Skip if this is a worktree directory (work1, work2, etc.)
            if (entry.name.match(/^work\d+$/)) {
              continue;
            }

            // Determine type from folder path
            const type = getTypeFromPath(fullPath);

            // Get the actual project name
            let projectName;
            let projectPath;

            if (entry.name === 'master') {
              // This is a master directory, use parent as project
              projectName = path.basename(path.dirname(fullPath));
              projectPath = path.dirname(fullPath);
            } else {
              // This is the project directory itself
              projectName = entry.name;
              projectPath = fullPath;
            }

            let lastModifiedMs = 0;
            let createdMs = 0;
            try {
              const repoStat = await fs.stat(projectPath);
              lastModifiedMs = repoStat.mtimeMs;
              createdMs = repoStat.birthtimeMs || repoStat.ctimeMs || 0;
            } catch (statError) {
              lastModifiedMs = 0;
              createdMs = 0;
            }

            const repoEntry = {
              name: projectName,
              path: projectPath,
              masterPath: entry.name === 'master' ? fullPath : path.join(fullPath, 'master'),
              relativePath: path.relative(gitHubPath, projectPath),
              type: type,
              category: getCategoryFromPath(fullPath),
              lastModifiedMs,
              createdMs,
              worktreeDirs: [],
              worktreeLayout: 'nested'
            };

            // Detect nested worktrees inside repo directory (work1..work8)
            try {
              const nestedEntries = [];
              for (let i = 1; i <= 8; i++) {
                const worktreeName = `work${i}`;
                const worktreePath = path.join(projectPath, worktreeName);
                try {
                  const wtStat = await fs.stat(worktreePath);
                  nestedEntries.push({
                    id: worktreeName,
                    name: worktreeName,
                    path: worktreePath,
                    number: i,
                    lastModifiedMs: wtStat.mtimeMs,
                    createdMs: wtStat.birthtimeMs || wtStat.ctimeMs || 0
                  });
                } catch (wtError) {
                  // Worktree does not exist
                }
              }
              if (nestedEntries.length) {
                repoEntry.worktreeDirs = nestedEntries;
                const maxNested = nestedEntries.reduce((max, entry) => Math.max(max, entry.lastModifiedMs || 0), 0);
                if (maxNested) {
                  repoEntry.lastModifiedMs = Math.max(repoEntry.lastModifiedMs || 0, maxNested);
                }
              }
            } catch (wtScanError) {
              // Ignore nested worktree scan errors
            }

            projects.push(repoEntry);
            projectIndexByKey.set(projectPath, projects.length - 1);
          } else {
            // Continue scanning subdirectories
            await scanDirectory(fullPath, depth + 1, maxDepth);
          }
        }
      } catch (error) {
        // Skip directories we can't read
      }
    }

    // Helper: Check if directory is a project
    async function isProjectDirectory(dirPath) {
      try {
        const files = await fs.readdir(dirPath);

        // Project indicators
        const hasPackageJson = files.includes('package.json');
        const hasCsproj = files.some(f => f.endsWith('.csproj'));
        const hasCargoToml = files.includes('Cargo.toml');
        const hasGit = files.includes('.git');
        const hasMakefile = files.includes('Makefile');
        const hasReadme = files.some(f => f.toLowerCase().includes('readme'));

        // Must have at least one project indicator
        return hasPackageJson || hasCsproj || hasCargoToml || hasGit || hasMakefile || hasReadme;
      } catch (error) {
        return false;
      }
    }

    // Helper: Determine type from folder path
    function getTypeFromPath(fullPath) {
      const pathLower = fullPath.toLowerCase();

      // Path-based type detection
      if (pathLower.includes('/games/hytopia/')) return 'hytopia-game';
      if (pathLower.includes('/games/monogame/')) return 'monogame-game';
      if (pathLower.includes('/games/minecraft/')) return 'minecraft-mod';
      if (pathLower.includes('/games/rust/')) return 'rust-game';
      if (pathLower.includes('/games/web/')) return 'web-game';
      if (pathLower.includes('/website/') || pathLower.includes('/websites/')) return 'website';
      if (pathLower.includes('/writing/')) return 'writing';
      if (pathLower.includes('/tools/')) return 'tool-project';

      // Fallback detection
      if (pathLower.includes('/games/')) return 'hytopia-game'; // Default game type
      return 'tool-project';
    }

    // Helper: Get category for grouping
    function getCategoryFromPath(fullPath) {
      const pathLower = fullPath.toLowerCase();

      if (pathLower.includes('/games/hytopia/')) return 'Hytopia Games';
      if (pathLower.includes('/games/monogame/')) return 'MonoGame Games';
      if (pathLower.includes('/games/')) return 'Other Games';
      if (pathLower.includes('/website/') || pathLower.includes('/websites/')) return 'Websites';
      if (pathLower.includes('/writing/')) return 'Writing';
      if (pathLower.includes('/tools/')) return 'Tools';

      return 'Other';
    }

    function mergeWorktreeEntries(existing, entries) {
      const byId = new Map();
      (existing || []).forEach(entry => {
        if (entry && entry.id) byId.set(entry.id, entry);
      });
      entries.forEach(entry => {
        if (entry && entry.id && !byId.has(entry.id)) {
          byId.set(entry.id, entry);
        }
      });
      return Array.from(byId.values()).sort((a, b) => (a.number || 0) - (b.number || 0));
    }

    function findSiblingRepoIndex(group) {
      const baseLower = (group.baseName || '').toLowerCase();
      let matchIndex = null;
      let matchCount = 0;

      projects.forEach((repo, idx) => {
        if (!repo?.path) return;
        if (path.dirname(repo.path) !== group.parentDir) return;
        const nameLower = (repo.name || '').toLowerCase();
        if (nameLower === baseLower || nameLower.startsWith(`${baseLower}-`) || nameLower.startsWith(`${baseLower}_`)) {
          matchIndex = idx;
          matchCount += 1;
        }
      });

      return matchCount === 1 ? matchIndex : null;
    }

    // Start deep scan
    await scanDirectory(gitHubPath);

    // Attach sibling worktree groups to base repos or create synthetic repos
    for (const [key, group] of worktreeGroups.entries()) {
      const entries = group.entries.sort((a, b) => a.number - b.number);
      const maxModified = entries.reduce((max, e) => Math.max(max, e.lastModifiedMs || 0), 0);

      const directIndex = projectIndexByKey.has(key) ? projectIndexByKey.get(key) : null;
      const siblingIndex = directIndex !== null ? null : findSiblingRepoIndex(group);
      const targetIndex = directIndex !== null ? directIndex : siblingIndex;

      if (targetIndex !== null && targetIndex !== undefined) {
        const repo = projects[targetIndex];
        const mergedEntries = mergeWorktreeEntries(repo.worktreeDirs, entries);
        repo.worktreeDirs = mergedEntries;
        repo.worktreeLayout = repo.worktreeLayout === 'nested' ? 'mixed' : 'sibling';
        const mergedMax = mergedEntries.reduce((max, e) => Math.max(max, e.lastModifiedMs || 0), 0);
        repo.lastModifiedMs = Math.max(repo.lastModifiedMs || 0, mergedMax);
      } else {
        // No base repo found; create synthetic entry using the lowest-numbered worktree
        const fallback = entries[0];
        const projectPath = fallback.path;
        const projectName = group.baseName;
        const type = getTypeFromPath(projectPath);
        const category = getCategoryFromPath(projectPath);

        projects.push({
          name: projectName,
          path: projectPath,
          masterPath: path.join(projectPath, 'master'),
          relativePath: path.relative(gitHubPath, projectPath),
          type,
          category,
          lastModifiedMs: maxModified,
          worktreeDirs: entries,
          worktreeLayout: 'sibling'
        });
      }
    }

    // Sort by category then name
    projects.sort((a, b) => {
      if (a.category !== b.category) {
        return a.category.localeCompare(b.category);
      }
      return a.name.localeCompare(b.name);
    });

    logger.info(`Found ${projects.length} projects across ${new Set(projects.map(p => p.category)).size} categories`);
    res.json(projects);
  } catch (error) {
    logger.error('Failed to scan repositories', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to scan repositories' });
  }
});

app.post('/api/workspaces/create-worktree', async (req, res) => {
  try {
    const { workspaceId, repositoryPath, worktreeNumber } = req.body;
    logger.info('Creating individual worktree', { workspaceId, worktreeNumber, repositoryPath });

    const workspace = workspaceManager.getWorkspace(workspaceId);
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    // Use provided repository path or workspace default
    const repoPath = repositoryPath || workspace.repository?.path;
    if (!repoPath) {
      return res.status(400).json({ error: 'Repository path not found' });
    }

    // Create temporary workspace config for worktree creation
    const tempWorkspace = {
      repository: {
        path: repoPath,
        masterBranch: 'master' // Always use master for consistency
      },
      worktrees: {
        enabled: true,
        namingPattern: 'work{n}',
        autoCreate: true
      }
    };

    // Create the specific worktree
    const worktreeId = `work${worktreeNumber}`;
    await worktreeHelper.createWorktree(tempWorkspace, worktreeId);

    // Update workspace config to include new terminal pair
    const updatedWorkspace = {
      ...workspace,
      terminals: {
        ...workspace.terminals,
        pairs: Math.max(workspace.terminals.pairs, worktreeNumber)
      }
    };

    await workspaceManager.updateWorkspace(workspaceId, updatedWorkspace);

    res.json({ success: true, worktreeId, path: `${workspace.repository.path}/work${worktreeNumber}` });
  } catch (error) {
    logger.error('Failed to create worktree', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

app.post('/api/workspaces/add-mixed-worktree', async (req, res) => {
  try {
    const { workspaceId, repositoryPath, repositoryType, repositoryName, worktreeId, socketId, startTier } = req.body;
    logger.info('Adding mixed worktree to workspace', {
      workspaceId,
      repositoryName,
      worktreeId
    });

    const workspace = workspaceManager.getWorkspace(workspaceId);
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    // Convert to mixed-repo workspace if it's single-repo
    let updatedWorkspace = workspace;
    if (workspace.workspaceType !== 'mixed-repo') {
      logger.info('Converting single-repo workspace to mixed-repo');
      const { convertSingleToMixed } = require('./workspaceSchemas');
      updatedWorkspace = convertSingleToMixed(workspace);
    }

    // Add new terminal pair to the workspace
    const worktreePath = path.join(repositoryPath, worktreeId);
    const terminalIdBase = `${repositoryName}-${worktreeId}`;
    const newTerminals = [
      {
        id: `${terminalIdBase}-claude`,
        repository: {
          name: repositoryName,
          path: repositoryPath,
          type: repositoryType,
          masterBranch: 'master'
        },
        worktree: worktreeId,
        worktreePath: worktreePath,
        terminalType: 'claude',
        visible: true
      },
      {
        id: `${terminalIdBase}-server`,
        repository: {
          name: repositoryName,
          path: repositoryPath,
          type: repositoryType,
          masterBranch: 'master'
        },
        worktree: worktreeId,
        worktreePath: worktreePath,
        terminalType: 'server',
        visible: true
      }
    ];

    // Guard: don't double-add the same worktree terminals
    if (Array.isArray(updatedWorkspace.terminals)) {
      const existingIds = new Set(updatedWorkspace.terminals.map(t => t.id));
      if (existingIds.has(newTerminals[0].id) || existingIds.has(newTerminals[1].id)) {
        return res.status(409).json({ error: 'Worktree already exists in workspace' });
      }
    }

    updatedWorkspace.terminals = updatedWorkspace.terminals.concat(newTerminals);

    // Ensure the worktree exists
    const tempWorkspace = {
      repository: { path: repositoryPath, masterBranch: 'master' },
      worktrees: { enabled: true, namingPattern: 'work{n}', autoCreate: true }
    };
    await worktreeHelper.createWorktree(tempWorkspace, worktreeId);

    // Save updated workspace
    await workspaceManager.updateWorkspace(workspaceId, updatedWorkspace);

    // Update the SessionManager workspace reference and rebuild worktrees list
    const refreshedWorkspace = workspaceManager.getWorkspace(workspaceId);
    sessionManager.setWorkspace(refreshedWorkspace);

    // Create sessions for ONLY the new worktree (do not reset existing terminals)
    const isActiveWorkspace = workspaceManager.getActiveWorkspace()?.id === workspaceId;
    const newSessions = isActiveWorkspace
      ? await sessionManager.createSessionsForWorktree({
        worktreeId,
        worktreePath,
        repositoryName,
        repositoryType
      })
      : {};

    if (isActiveWorkspace) {
      // Prefer targeting the requesting socket (avoid disrupting other connected clients / dashboards)
      if (socketId && io.sockets.sockets.get(socketId)) {
        const tier = Number(startTier);
        io.to(socketId).emit('worktree-sessions-added', {
          worktreeId,
          sessions: newSessions,
          startTier: (tier >= 1 && tier <= 4) ? tier : undefined
        });
      } else {
        const tier = Number(startTier);
        io.emit('worktree-sessions-added', {
          worktreeId,
          sessions: newSessions,
          startTier: (tier >= 1 && tier <= 4) ? tier : undefined
        });
      }
    }

    logger.info('New worktree sessions initialized (additive)', {
      totalNewSessions: Object.keys(newSessions).length
    });

    const tier = Number(startTier);
    res.json({
      success: true,
      terminalIds: newTerminals.map(t => t.id),
      sessions: newSessions,
      startTier: (tier >= 1 && tier <= 4) ? tier : undefined
    });
  } catch (error) {
    logger.error('Failed to add mixed worktree', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

// Remove worktree from workspace (config only - does NOT delete git worktree folder)
app.post('/api/workspaces/remove-worktree', async (req, res) => {
  try {
    const { workspaceId, worktreeId } = req.body;
    logger.info('Removing worktree from workspace configuration (keeping folder intact)', { workspaceId, worktreeId });

    const workspace = workspaceManager.getWorkspace(workspaceId);
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    // IMPORTANT: This only removes the worktree from the workspace configuration.
    // The actual git worktree folder and all its files remain untouched on disk.
    // This allows users to safely remove a worktree from the UI without losing work.

    // Remove terminals associated with this worktree from configuration
    const updatedWorkspace = { ...workspace };
    const originalTerminalCount = updatedWorkspace.terminals.length;

    updatedWorkspace.terminals = updatedWorkspace.terminals.filter(terminal => {
      // Remove terminals that match this worktree ID (case-insensitive comparison)
      return !terminal.id.toLowerCase().includes(worktreeId.toLowerCase());
    });

    const removedCount = originalTerminalCount - updatedWorkspace.terminals.length;

    if (removedCount === 0) {
      return res.status(404).json({ error: 'Worktree not found in workspace' });
    }

    // For single-repo workspaces, also update the pairs count
    if (workspace.workspaceType !== 'mixed-repo' && workspace.terminals?.pairs) {
      const worktreeNum = parseInt(worktreeId.replace(/.*work/, ''));
      if (workspace.terminals.pairs >= worktreeNum) {
        updatedWorkspace.terminals.pairs = workspace.terminals.pairs - 1;
      }
    }

    // Save updated workspace configuration
    await workspaceManager.updateWorkspace(workspaceId, updatedWorkspace);

    // If this is the active workspace, close sessions but DON'T reinitialize all
    if (workspaceManager.getActiveWorkspace()?.id === workspaceId) {
      // Set flag to prevent auto-restart of Claude sessions during deletion
      const previousFlag = sessionManager.isWorkspaceSwitching;
      sessionManager.isWorkspaceSwitching = true;

      try {
        // Close sessions for removed worktree
        const sessionsToClose = sessionManager.getSessionsForWorktree(worktreeId);
        sessionsToClose.forEach(sessionId => {
          sessionManager.terminateSession(sessionId);
          // Emit session-closed event to remove from client UI
          io.emit('session-closed', { sessionId });
        });

        // Update the SessionManager workspace reference without reinitializing all sessions
        const refreshedWorkspace = workspaceManager.getWorkspace(workspaceId);
        sessionManager.setWorkspace(refreshedWorkspace);
      } finally {
        // Restore the previous flag state after deletion completes
        sessionManager.isWorkspaceSwitching = previousFlag;
      }
    }

    logger.info('Worktree removed from workspace configuration (folder preserved)', {
      workspaceId,
      worktreeId,
      removedTerminals: removedCount
    });

    res.json({
      success: true,
      removedTerminals: removedCount,
      updatedWorkspace: updatedWorkspace
    });

  } catch (error) {
    logger.error('Failed to remove worktree from workspace', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

// Delete workspace
app.delete('/api/workspaces/:id', async (req, res) => {
  try {
    const workspaceId = req.params.id;
    logger.info('Deleting workspace', { workspaceId });

    // Stop all sessions for this workspace first
    const workspace = workspaceManager.getWorkspace(workspaceId);
    if (workspace && workspaceManager.activeWorkspace?.id === workspaceId) {
      // Clean up sessions if this is the active workspace
      sessionManager.cleanupAllSessions();
      sessionManager.setWorkspace(null);
      workspaceManager.activeWorkspace = null;
    }

    // Delete the workspace
    await workspaceManager.deleteWorkspace(workspaceId);

    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to delete workspace', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

// Claude hook endpoints
app.post('/api/claude-ready', express.json(), (req, res) => {
  const { worktree, sessionId } = req.body;
  logger.info('Claude ready notification from hook', { worktree, sessionId });
  
  // Update session status to waiting
  const session = sessionManager.sessions.get(sessionId);
  if (session) {
    session.status = 'waiting';
    session.statusChangedAt = Date.now();
    if (session.pendingStatusTimer) {
      clearTimeout(session.pendingStatusTimer);
      session.pendingStatusTimer = null;
    }
    session.pendingStatus = null;
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
const prMergeAutomationService = PrMergeAutomationService.getInstance({
  taskRecordService,
  pullRequestService,
  taskTicketingService,
  userSettingsService
});

// Start background automations (best-effort; gated by user settings)
prMergeAutomationService.start();

const verifyGitHubWebhookSignature = (req) => {
  const secret = String(process.env.GITHUB_WEBHOOK_SECRET || '').trim();
  if (!secret) {
    return { ok: true, verified: false, reason: 'no_secret_configured' };
  }

  const sigHeader = String(req.headers['x-hub-signature-256'] || '').trim();
  if (!sigHeader.startsWith('sha256=')) {
    return { ok: false, verified: false, reason: 'missing_signature' };
  }

  const expected = sigHeader.slice('sha256='.length);
  const raw = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(JSON.stringify(req.body || {}));
  const actual = crypto.createHmac('sha256', secret).update(raw).digest('hex');

  try {
    const a = Buffer.from(actual, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return { ok: false, verified: false, reason: 'bad_signature' };
    const ok = crypto.timingSafeEqual(a, b);
    return ok ? { ok: true, verified: true } : { ok: false, verified: false, reason: 'bad_signature' };
  } catch {
    return { ok: false, verified: false, reason: 'bad_signature' };
  }
};

app.post('/api/webhooks/github', async (req, res) => {
  try {
    const secret = String(process.env.GITHUB_WEBHOOK_SECRET || '').trim();
    if (AUTH_TOKEN && !secret) {
      return res.status(401).json({ error: 'GITHUB_WEBHOOK_SECRET is required when AUTH_TOKEN is enabled' });
    }

    const sig = verifyGitHubWebhookSignature(req);
    if (!sig.ok) {
      return res.status(401).json({ error: 'Invalid webhook signature', reason: sig.reason });
    }

    const event = String(req.headers['x-github-event'] || '').trim().toLowerCase();
    if (!event) return res.status(400).json({ error: 'Missing x-github-event header' });

    if (event === 'ping') {
      return res.json({ ok: true, event, verified: sig.verified });
    }

    if (event !== 'pull_request') {
      return res.json({ ok: true, event, ignored: true, verified: sig.verified });
    }

    const action = String(req.body?.action || '').trim().toLowerCase();
    const pr = req.body?.pull_request || null;
    if (!pr) return res.status(400).json({ error: 'Missing pull_request payload' });

    const merged = !!pr.merged;
    const mergedAt = pr.merged_at || null;
    if (action !== 'closed' || !merged) {
      return res.json({ ok: true, event, ignored: true, verified: sig.verified, action, merged });
    }

    const repoOwner = req.body?.repository?.owner?.login || req.body?.repository?.owner?.name || '';
    const repoName = req.body?.repository?.name || '';
    const result = await prMergeAutomationService.processMergedPullRequest({
      owner: repoOwner,
      repo: repoName,
      number: pr.number,
      body: pr.body || '',
      mergedAt,
      url: pr.html_url || pr.url || ''
    });

    res.json({ ok: true, event, verified: sig.verified, result });
  } catch (error) {
    logger.error('Failed to handle GitHub webhook', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message || 'Failed to handle webhook' });
  }
});

app.get('/api/process/automations', (req, res) => {
  try {
    res.json({
      prMerge: prMergeAutomationService.getConfig(),
      lastRunAt: prMergeAutomationService.lastRunAt || null
    });
  } catch (error) {
    logger.error('Failed to get automations status', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to get automations status' });
  }
});

app.post('/api/process/automations/pr-merge/run', express.json(), async (req, res) => {
  try {
    const limit = Number(req.body?.limit || 60);
    const result = await prMergeAutomationService.runOnce({ limit });
    res.json(result);
  } catch (error) {
    logger.error('Failed to run PR merge automations', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message || 'Failed to run PR merge automations' });
  }
});

// Get all user settings
app.get('/api/user-settings', (req, res) => {
  try {
    const settings = userSettingsService.getAllSettings();
    res.json(settings);
  } catch (error) {
    logger.error('Failed to get user settings', { error: error.message, stack: error.stack });
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
    logger.error('Failed to update global settings', { error: error.message, stack: error.stack });
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
    logger.error('Failed to get default template', { error: error.message, stack: error.stack });
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
    logger.error('Failed to reset settings', { error: error.message, stack: error.stack });
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
    logger.error('Failed to save as default template', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to save as default template' });
  }
});

// Check for default settings updates
app.get('/api/user-settings/check-updates', (req, res) => {
  try {
    const updateCheck = userSettingsService.checkForDefaultUpdates();
    res.json(updateCheck);
  } catch (error) {
    logger.error('Failed to check for settings updates', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to check for settings updates' });
  }
});

// Git update API endpoints
app.get('/api/git/status', (req, res) => {
  gitUpdateService.getStatus()
    .then(status => res.json(status))
    .catch(error => {
      logger.error('Failed to get git status', { error: error.message, stack: error.stack });
      res.status(500).json({ error: 'Failed to get git status' });
    });
});

app.get('/api/git/check-updates', (req, res) => {
  gitUpdateService.checkForUpdates()
    .then(result => res.json(result))
    .catch(error => {
      logger.error('Failed to check for git updates', { error: error.message, stack: error.stack });
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
      logger.error('Failed to pull latest changes', { error: error.message, stack: error.stack });
      res.status(500).json({ error: 'Failed to pull latest changes' });
    });
});

// Get available AI agents configuration
app.get('/api/agents', (req, res) => {
  try {
    const agents = agentManager.getAllAgents().map(agent => agentManager.getUIConfig(agent.id));
    res.json(agents);
  } catch (error) {
    logger.error('Failed to get agent configurations', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to get agent configurations' });
  }
});

// Port registry API endpoints
app.get('/api/ports', (req, res) => {
  try {
    const assignments = portRegistry.getAllAssignments();
    res.json(assignments);
  } catch (error) {
    logger.error('Failed to get port assignments', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to get port assignments' });
  }
});

// Scan all listening ports on the system
app.get('/api/ports/scan', async (req, res) => {
  try {
    const ports = await portRegistry.scanAllPorts();
    res.json({
      ports,
      scannedAt: new Date().toISOString(),
      count: ports.length
    });
  } catch (error) {
    logger.error('Failed to scan ports', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to scan ports' });
  }
});

// Save custom label for a port
app.post('/api/ports/label', async (req, res) => {
  try {
    const { port, label } = req.body;
    if (!port) {
      return res.status(400).json({ error: 'Port is required' });
    }
    const labels = await portRegistry.savePortLabel(port, label || null);
    res.json({ success: true, labels });
  } catch (error) {
    logger.error('Failed to save port label', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to save port label' });
  }
});

// Startup scripts setup
app.get('/api/startup/info', async (req, res) => {
  const os = require('os');
  const fs = require('fs').promises;
  const path = require('path');

  const platform = os.platform();
  const isWSL = platform === 'linux' && (process.env.WSL_DISTRO_NAME || process.env.WSLENV);

  const scriptsDir = path.join(__dirname, '..', 'scripts');
  const windowsScript = path.join(scriptsDir, 'windows', 'start-orchestrator.bat');
  const linuxScript = path.join(scriptsDir, 'linux', 'start-orchestrator.sh');

  let windowsExists = false;
  let linuxExists = false;

  try { await fs.access(windowsScript); windowsExists = true; } catch (e) {}
  try { await fs.access(linuxScript); linuxExists = true; } catch (e) {}

  res.json({
    platform,
    isWSL,
    scriptsAvailable: {
      windows: windowsExists,
      linux: linuxExists
    },
    paths: {
      windows: windowsExists ? windowsScript : null,
      linux: linuxExists ? linuxScript : null,
      scriptsDir
    }
  });
});

app.post('/api/startup/install-windows', async (req, res) => {
  const { spawn } = require('child_process');
  const path = require('path');

  const installerPath = path.join(__dirname, '..', 'scripts', 'windows', 'install-startup.ps1');

  // Convert to Windows path for PowerShell
  const winPath = installerPath.replace(/^\/mnt\/([a-z])/, (_, drive) => `${drive.toUpperCase()}:`).replace(/\//g, '\\');

  try {
    const result = await new Promise((resolve, reject) => {
      const ps = spawn('powershell.exe', [
        '-ExecutionPolicy', 'Bypass',
        '-File', winPath,
        '-DesktopShortcut'
      ], { timeout: 30000 });

      let stdout = '';
      let stderr = '';

      ps.stdout.on('data', (data) => { stdout += data.toString(); });
      ps.stderr.on('data', (data) => { stderr += data.toString(); });

      ps.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, output: stdout });
        } else {
          reject(new Error(stderr || `Exit code: ${code}`));
        }
      });

      ps.on('error', reject);
    });

    res.json(result);
  } catch (error) {
    logger.error('Failed to install Windows startup', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Session Recovery API
app.get('/api/recovery/:workspaceId', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const recoveryInfo = await sessionRecoveryService.getRecoveryInfo(workspaceId);
    res.json(recoveryInfo);
  } catch (error) {
    logger.error('Failed to get recovery info', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/recovery/:workspaceId/:sessionId', async (req, res) => {
  try {
    const { workspaceId, sessionId } = req.params;
    await sessionRecoveryService.loadWorkspaceState(workspaceId);
    const session = sessionRecoveryService.getSession(workspaceId, sessionId);
    res.json(session || { error: 'Session not found' });
  } catch (error) {
    logger.error('Failed to get session recovery info', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/recovery/:workspaceId', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    await sessionRecoveryService.clearWorkspace(workspaceId);
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to clear recovery state', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/ports/:repoPath/:worktreeId', async (req, res) => {
  try {
    const { repoPath, worktreeId } = req.params;
    const decodedRepoPath = decodeURIComponent(repoPath);
    const portInfo = portRegistry.getPortInfo(decodedRepoPath, worktreeId);

    if (portInfo) {
      res.json(portInfo);
    } else {
      // Get or assign a new port
      const worktreeNum = parseInt(worktreeId.replace(/\D/g, '')) || 1;
      const port = await portRegistry.suggestPort(worktreeNum, decodedRepoPath, worktreeId);
      res.json({
        port,
        assignedAt: Date.now(),
        url: `http://localhost:${port}`,
        newAssignment: true
      });
    }
  } catch (error) {
    logger.error('Failed to get port info', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to get port info' });
  }
});

// Greenfield project API endpoints
app.get('/api/greenfield/templates', (req, res) => {
  try {
    const templates = greenfieldService.getTemplates();
    res.json(templates);
  } catch (error) {
    logger.error('Failed to get greenfield templates', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to get templates' });
  }
});

app.post('/api/greenfield/validate-path', async (req, res) => {
  try {
    const { path: projectPath } = req.body;
    const result = await greenfieldService.validatePath(projectPath);
    res.json(result);
  } catch (error) {
    logger.error('Failed to validate path', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to validate path' });
  }
});

app.post('/api/greenfield/create', async (req, res) => {
  try {
    const { name, template, path, initGit, worktreeCount } = req.body;
    logger.info('Creating greenfield project', { name, template, path, initGit, worktreeCount });

    const result = await greenfieldService.createProject({
      name,
      template,
      path,
      initGit,
      worktreeCount
    });

    // Optionally create a workspace for the new project
    if (req.body.createWorkspace) {
      const templateToWorkspaceType = {
        'hytopia-game': 'hytopia-game',
        'node-typescript': 'tool-project',
        'empty': 'tool-project'
      };
      const resolvedTemplate = String(template || '').trim();
      const workspaceType = templateToWorkspaceType[resolvedTemplate] || 'tool-project';
      const desiredPairs = Number.isFinite(worktreeCount) ? worktreeCount : 1;
      const pairs = Math.max(1, desiredPairs);

      const workspaceData = {
        id: name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        name: name,
        type: workspaceType,
        repository: {
          path: result.projectPath,
          masterBranch: 'master'
        },
        worktrees: {
          enabled: true,
          count: pairs,
          namingPattern: 'work{n}',
          autoCreate: false
        },
        terminals: {
          pairs
        }
      };

      try {
        await workspaceManager.createWorkspace(workspaceData);
        result.workspace = workspaceData;
        logger.info('Created workspace for greenfield project', { workspaceId: workspaceData.id });
      } catch (wsError) {
        logger.warn('Failed to create workspace', { error: wsError.message });
        result.workspaceError = wsError.message;
      }
    }

    res.json(result);
  } catch (error) {
    logger.error('Failed to create greenfield project', { error: error.message, stack: error.stack });
    res.status(400).json({ error: error.message });
  }
});

// Full greenfield project creation with GitHub repo and Claude spawning
app.post('/api/greenfield/create-full', async (req, res) => {
  try {
    const {
      name,
      description,
      category,
      isPrivate = true,
      worktreeCount = 8,
      spawnClaude = true,
      yolo = true
    } = req.body;

    logger.info('Creating full greenfield project', { name, description, category });

    const result = await greenfieldService.createFullProject({
      name,
      description,
      category,
      isPrivate,
      worktreeCount,
      spawnClaude,
      yolo
    });

    // Also create a workspace configuration
    if (result.success) {
      const categoryToWorkspaceType = {
        website: 'website',
        game: 'hytopia-game',
        tool: 'tool-project',
        api: 'tool-project',
        library: 'tool-project',
        other: 'tool-project'
      };

      const resolvedCategory = String(category || result.category || 'other').trim().toLowerCase();
      const workspaceType = categoryToWorkspaceType[resolvedCategory] || 'tool-project';
      const derivedPairs = Number.isFinite(worktreeCount)
        ? worktreeCount
        : (Array.isArray(result.worktrees) ? Math.max(result.worktrees.length - 1, 1) : 1);
      const pairs = Math.max(1, derivedPairs);

      const workspaceData = {
        id: name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        name: name,
        type: workspaceType,
        repository: {
          path: result.projectPath,
          masterBranch: 'master'
        },
        worktrees: {
          enabled: true,
          count: pairs,
          namingPattern: 'work{n}',
          autoCreate: false
        },
        terminals: {
          pairs
        }
      };

      try {
        await workspaceManager.createWorkspace(workspaceData);
        result.workspace = workspaceData;
        logger.info('Created workspace for greenfield project', { workspaceId: workspaceData.id });
      } catch (wsError) {
        logger.warn('Failed to create workspace', { error: wsError.message });
        result.workspaceError = wsError.message;
      }
    }

    res.json(result);
  } catch (error) {
    logger.error('Failed to create full greenfield project', { error: error.message, stack: error.stack });
    res.status(400).json({ error: error.message });
  }
});

// Get greenfield categories
app.get('/api/greenfield/categories', (req, res) => {
  const categories = greenfieldService.getCategories();
  res.json(categories);
});

// Detect category from description
app.post('/api/greenfield/detect-category', (req, res) => {
  const { description } = req.body;
  if (!description) {
    return res.status(400).json({ error: 'description is required' });
  }
  const category = greenfieldService.detectCategory(description);
  const categoryConfig = greenfieldService.categories[category];
  res.json({
    category,
    path: categoryConfig.path
  });
});

// ============================================
// Conversation History API
// ============================================

// Search conversations
app.get('/api/conversations/search', async (req, res) => {
  try {
    const { q, project, branch, folder, startDate, endDate, limit, offset } = req.query;

    const results = await conversationService.search(q, {
      project,
      branch,
      folder,
      startDate,
      endDate,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined
    });

    res.json(results);
  } catch (error) {
    logger.error('Failed to search conversations', { error: error.message });
    res.status(500).json({ error: 'Failed to search conversations' });
  }
});

// Autocomplete for conversation search
app.get('/api/conversations/autocomplete', async (req, res) => {
  try {
    const { q, limit } = req.query;
    const suggestions = await conversationService.autocomplete(q, limit ? parseInt(limit) : undefined);
    res.json(suggestions);
  } catch (error) {
    logger.error('Failed to get autocomplete', { error: error.message });
    res.status(500).json({ error: 'Failed to get autocomplete suggestions' });
  }
});

// Get recent conversations
app.get('/api/conversations/recent', async (req, res) => {
  try {
    const { limit } = req.query;
    const recent = await conversationService.getRecent(limit ? parseInt(limit) : undefined);
    res.json(recent);
  } catch (error) {
    logger.error('Failed to get recent conversations', { error: error.message });
    res.status(500).json({ error: 'Failed to get recent conversations' });
  }
});

// Get conversations by folder
app.get('/api/conversations/by-folder', async (req, res) => {
  try {
    const { path: folderPath } = req.query;
    if (!folderPath) {
      return res.status(400).json({ error: 'path query parameter is required' });
    }

    const conversations = await conversationService.getByFolder(folderPath);
    res.json(conversations);
  } catch (error) {
    logger.error('Failed to get conversations by folder', { error: error.message });
    res.status(500).json({ error: 'Failed to get conversations' });
  }
});

// Get list of projects
app.get('/api/conversations/projects', async (req, res) => {
  try {
    const projects = await conversationService.getProjects();
    res.json(projects);
  } catch (error) {
    logger.error('Failed to get projects', { error: error.message });
    res.status(500).json({ error: 'Failed to get projects' });
  }
});

// Get conversation stats
app.get('/api/conversations/stats', async (req, res) => {
  try {
    const stats = await conversationService.getStats();
    res.json(stats);
  } catch (error) {
    logger.error('Failed to get stats', { error: error.message });
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// Refresh conversation index
app.post('/api/conversations/refresh', async (req, res) => {
  try {
    const index = await conversationService.refresh();
    res.json({
      success: true,
      stats: index.stats
    });
  } catch (error) {
    logger.error('Failed to refresh index', { error: error.message });
    res.status(500).json({ error: 'Failed to refresh index' });
  }
});

// Get conversation details (MUST be last to not catch other routes)
app.get('/api/conversations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { project } = req.query;
    const conversation = await conversationService.getConversation(id, project);

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.json(conversation);
  } catch (error) {
    logger.error('Failed to get conversation', { error: error.message });
    res.status(500).json({ error: 'Failed to get conversation' });
  }
});

// ============================================
// Worktree Metadata API
// ============================================

// Get metadata for a worktree
app.get('/api/worktree-metadata', async (req, res) => {
  try {
    const { path: worktreePath } = req.query;
    if (!worktreePath) {
      return res.status(400).json({ error: 'path query parameter is required' });
    }

    const metadata = await worktreeMetadataService.getMetadata(worktreePath);
    const project = await projectMetadataService.getForWorktree(worktreePath);
    metadata.project = project;
    res.json(metadata);
  } catch (error) {
    logger.error('Failed to get worktree metadata', { error: error.message });
    res.status(500).json({ error: 'Failed to get metadata' });
  }
});

// Get metadata for multiple worktrees
app.post('/api/worktree-metadata/batch', async (req, res) => {
  try {
    const { paths } = req.body;
    if (!paths || !Array.isArray(paths)) {
      return res.status(400).json({ error: 'paths array is required' });
    }

    const metadata = await worktreeMetadataService.getMultipleMetadata(paths);
    await Promise.all(paths.map(async (p) => {
      try {
        const project = await projectMetadataService.getForWorktree(p);
        if (metadata[p]) metadata[p].project = project;
      } catch {
        // ignore
      }
    }));
    res.json(metadata);
  } catch (error) {
    logger.error('Failed to get batch worktree metadata', { error: error.message });
    res.status(500).json({ error: 'Failed to get metadata' });
  }
});

// Refresh worktree metadata
app.post('/api/worktree-metadata/refresh', async (req, res) => {
  try {
    const { path: worktreePath } = req.body;
    if (!worktreePath) {
      return res.status(400).json({ error: 'path is required' });
    }

    const metadata = await worktreeMetadataService.refresh(worktreePath);
    const project = await projectMetadataService.getForWorktree(worktreePath, { refresh: true });
    metadata.project = project;
    res.json(metadata);
  } catch (error) {
    logger.error('Failed to refresh worktree metadata', { error: error.message });
    res.status(500).json({ error: 'Failed to refresh metadata' });
  }
});

// ============================================
// Worktree Git Summary API
// ============================================

app.get('/api/worktree-git-summary', async (req, res) => {
  try {
    const { path: worktreePath } = req.query;
    if (!worktreePath) {
      return res.status(400).json({ error: 'path query parameter is required' });
    }

    const maxFiles = req.query.maxFiles ? Number(req.query.maxFiles) : undefined;
    const maxCommits = req.query.maxCommits ? Number(req.query.maxCommits) : undefined;

    const summary = await worktreeGitService.getSummary(worktreePath, { maxFiles, maxCommits });
    let pr = null;
    try {
      pr = await worktreeMetadataService.getPRStatus(worktreePath);
    } catch {
      pr = null;
    }
    res.json({ ...summary, pr });
  } catch (error) {
    logger.error('Failed to get worktree git summary', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to get git summary' });
  }
});

// ============================================
// Project Metadata API
// ============================================

app.get('/api/project-metadata', async (req, res) => {
  try {
    const { path: worktreePath } = req.query;
    if (!worktreePath) {
      return res.status(400).json({ error: 'path query parameter is required' });
    }
    const refresh = String(req.query.refresh || '').toLowerCase() === 'true';
    const project = await projectMetadataService.getForWorktree(worktreePath, { refresh });
    res.json({ project });
  } catch (error) {
    logger.error('Failed to get project metadata', { error: error.message });
    res.status(500).json({ error: 'Failed to get project metadata' });
  }
});

app.post('/api/project-metadata/batch', async (req, res) => {
  try {
    const { paths } = req.body;
    if (!paths || !Array.isArray(paths)) {
      return res.status(400).json({ error: 'paths array is required' });
    }
    const results = {};
    await Promise.all(paths.map(async (p) => {
      results[p] = await projectMetadataService.getForWorktree(p);
    }));
    res.json({ projects: results });
  } catch (error) {
    logger.error('Failed to batch project metadata', { error: error.message });
    res.status(500).json({ error: 'Failed to batch project metadata' });
  }
});

// ============================================
// Worktree Conflicts API
// ============================================

app.post('/api/worktree-conflicts', async (req, res) => {
  try {
    const { paths } = req.body;
    if (!paths || !Array.isArray(paths)) {
      return res.status(400).json({ error: 'paths array is required' });
    }
    const refresh = String(req.query.refresh || '').toLowerCase() === 'true';
    const result = await worktreeConflictService.analyze({ paths, refresh });
    res.json(result);
  } catch (error) {
    logger.error('Failed to analyze worktree conflicts', { error: error.message });
    res.status(500).json({ error: 'Failed to analyze worktree conflicts' });
  }
});

// ============================================
// Pull Requests API
// ============================================

app.get('/api/prs', async (req, res) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const repoRaw = typeof req.query.repo === 'string' ? req.query.repo.trim() : '';
    const ownerRaw = typeof req.query.owner === 'string' ? req.query.owner.trim() : '';

    const repos = repoRaw ? repoRaw.split(',').map(r => r.trim()).filter(Boolean).slice(0, 20) : [];
    const owners = ownerRaw ? ownerRaw.split(',').map(o => o.trim()).filter(Boolean).slice(0, 20) : [];

    const result = await pullRequestService.searchPullRequests({
      mode: req.query.mode || 'mine',
      state: req.query.state || 'all',
      sort: req.query.sort || 'updated',
      limit: req.query.limit || '50',
      query,
      repos,
      owners
    });

    res.json(result);
  } catch (error) {
    logger.error('Failed to list PRs', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to list PRs' });
  }
});

app.post('/api/prs/merge', express.json(), async (req, res) => {
  try {
    const url = String(req.body?.url || '').trim();
    const method = String(req.body?.method || 'merge').trim().toLowerCase();
    const auto = !!req.body?.auto;

    if (!url) return res.status(400).json({ error: 'url is required' });
    if (!['merge', 'squash', 'rebase'].includes(method)) {
      return res.status(400).json({ error: 'method must be merge|squash|rebase' });
    }

    const result = await pullRequestService.mergePullRequestByUrl(url, { method, auto });
    res.json(result);
  } catch (error) {
    logger.error('Failed to merge PR', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message || 'Failed to merge PR' });
  }
});

// ============================================
// Process tasks API (PR/worktree/session unified list)
// ============================================

app.get('/api/process/tasks', async (req, res) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const repoRaw = typeof req.query.repo === 'string' ? req.query.repo.trim() : '';
    const ownerRaw = typeof req.query.owner === 'string' ? req.query.owner.trim() : '';

    const repos = repoRaw ? repoRaw.split(',').map(r => r.trim()).filter(Boolean).slice(0, 20) : [];
    const owners = ownerRaw ? ownerRaw.split(',').map(o => o.trim()).filter(Boolean).slice(0, 20) : [];

    const tasks = await processTaskService.listTasks({
      prs: {
        mode: req.query.mode || 'mine',
        state: req.query.state || 'open',
        sort: req.query.sort || 'updated',
        limit: req.query.limit || '50',
        query,
        repos,
        owners
      }
    });

    const enriched = tasks.map((t) => {
      const record = taskRecordService.get(t.id);
      return record ? { ...t, record } : t;
    });

    const deriveLabelsFromWorktreePath = (worktreePath) => {
      const raw = String(worktreePath || '').trim();
      if (!raw) return { project: null, worktree: null };

      const base = path.basename(raw);
      const parent = path.basename(path.dirname(raw));

      if (/^work\d+$/.test(base)) {
        return { project: parent || null, worktree: base };
      }

      return { project: base || null, worktree: 'root' };
    };

    const deriveProjectFromRepository = (repoSlug) => {
      const raw = String(repoSlug || '').trim();
      if (!raw) return null;
      const parts = raw.split('/').filter(Boolean);
      return parts[parts.length - 1] || null;
    };

    const worktreePaths = Array.from(new Set(enriched.map(t => t?.worktreePath).filter(Boolean)));
    const metadataByPath = worktreePaths.length
      ? await worktreeMetadataService.getMultipleMetadata(worktreePaths)
      : {};

    const withLabels = enriched.map((t) => {
      const fromPath = deriveLabelsFromWorktreePath(t?.worktreePath);
      const project = t?.project || fromPath.project || deriveProjectFromRepository(t?.repository) || t?.repositoryName || null;
      const worktree = t?.worktree || fromPath.worktree || t?.worktreeId || null;
      const branch = t?.branch || (t?.worktreePath ? metadataByPath?.[t.worktreePath]?.git?.branch : null) || null;
      return { ...t, project, worktree, branch };
    });

    const include = String(req.query.include || '').toLowerCase();
    if (include.includes('dependencysummary')) {
      const summaries = await Promise.all(withLabels.map(async (t) => {
        try {
          const summary = await taskDependencyService.getDependencySummary(t.id);
          return [t.id, summary];
        } catch {
          return [t.id, { total: 0, blocked: 0 }];
        }
      }));
      const map = Object.fromEntries(summaries);
      const withDeps = withLabels.map((t) => ({ ...t, dependencySummary: map[t.id] || { total: 0, blocked: 0 } }));
      res.json({ count: withDeps.length, tasks: withDeps });
      return;
    }

    res.json({ count: withLabels.length, tasks: withLabels });
  } catch (error) {
    logger.error('Failed to list process tasks', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to list process tasks' });
  }
});

app.get('/api/process/status', async (req, res) => {
  try {
    const mode = req.query.mode || 'mine';
    const lookbackHours = req.query.lookbackHours ? Number(req.query.lookbackHours) : undefined;
    const force = String(req.query.force || '').toLowerCase() === 'true';

    const status = await processStatusService.getStatus({ mode, lookbackHours, force });
    res.json(status);
  } catch (error) {
    logger.error('Failed to fetch process status', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to fetch process status' });
  }
});

app.get('/api/process/telemetry', async (req, res) => {
  try {
    const lookbackHours = req.query.lookbackHours ? Number(req.query.lookbackHours) : undefined;
    const force = String(req.query.force || '').toLowerCase() === 'true';
    const summary = await processTelemetryService.getSummary({ lookbackHours, force });
    res.json(summary);
  } catch (error) {
    logger.error('Failed to fetch process telemetry', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to fetch process telemetry' });
  }
});

app.get('/api/process/telemetry/details', async (req, res) => {
  try {
    const lookbackHours = req.query.lookbackHours ? Number(req.query.lookbackHours) : undefined;
    const bucketMinutes = req.query.bucketMinutes ? Number(req.query.bucketMinutes) : undefined;
    const force = String(req.query.force || '').toLowerCase() === 'true';
    const data = await processTelemetryService.getDetails({ lookbackHours, bucketMinutes, force });
    res.json(data);
  } catch (error) {
    logger.error('Failed to fetch process telemetry details', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to fetch process telemetry details' });
  }
});

app.get('/api/process/telemetry/snapshots', async (req, res) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const items = telemetrySnapshotService.list({ limit });
    res.json({ count: items.length, snapshots: items });
  } catch (error) {
    logger.error('Failed to list telemetry snapshots', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to list telemetry snapshots' });
  }
});

app.post('/api/process/telemetry/snapshots', express.json({ limit: '2mb' }), async (req, res) => {
  try {
    const lookbackHours = req.body?.lookbackHours ? Number(req.body.lookbackHours) : undefined;
    const bucketMinutes = req.body?.bucketMinutes ? Number(req.body.bucketMinutes) : undefined;

    const details = await processTelemetryService.getDetails({ lookbackHours, bucketMinutes, force: true });
    const created = await telemetrySnapshotService.create({
      kind: 'telemetry_details',
      params: { lookbackHours: details.lookbackHours, bucketMinutes: details.bucketMinutes },
      data: details
    });

    res.json({
      ...created,
      url: `/api/process/telemetry/snapshots/${created.id}`
    });
  } catch (error) {
    logger.error('Failed to create telemetry snapshot', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to create telemetry snapshot' });
  }
});

app.get('/api/process/telemetry/snapshots/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const download = String(req.query.download || '').toLowerCase() === 'true';
    const payload = await telemetrySnapshotService.get(id);
    if (download) {
      res.setHeader('Content-Disposition', `attachment; filename="telemetry-snapshot-${id}.json"`);
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(JSON.stringify(payload, null, 2) + '\n');
  } catch (error) {
    logger.error('Failed to fetch telemetry snapshot', { error: error.message, stack: error.stack });
    const isNotFound = String(error?.code || '') === 'ENOENT';
    res.status(isNotFound ? 404 : 500).json({ error: isNotFound ? 'Snapshot not found' : 'Failed to fetch telemetry snapshot' });
  }
});

app.get('/api/process/telemetry/export', async (req, res) => {
  try {
    const lookbackHours = req.query.lookbackHours ? Number(req.query.lookbackHours) : undefined;
    const format = String(req.query.format || 'csv').trim().toLowerCase();
    if (format !== 'csv' && format !== 'json') {
      res.status(400).json({ error: 'Unsupported export format' });
      return;
    }

    const hoursLabel = Number.isFinite(Number(lookbackHours)) ? Number(lookbackHours) : 24;

    if (format === 'json') {
      const data = await processTelemetryService.exportJson({ lookbackHours });
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="telemetry-${hoursLabel}h.json"`);
      res.send(JSON.stringify(data, null, 2) + '\n');
      return;
    }

    const csv = await processTelemetryService.exportCsv({ lookbackHours });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="telemetry-${hoursLabel}h.csv"`);
    res.send(csv);
  } catch (error) {
    logger.error('Failed to export process telemetry', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to export process telemetry' });
  }
});

app.get('/api/process/projects', async (req, res) => {
  try {
    const mode = req.query.mode || 'mine';
    const lookbackHours = req.query.lookbackHours ? Number(req.query.lookbackHours) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const force = String(req.query.force || '').toLowerCase() === 'true';
    const data = await processProjectDashboardService.getSummary({ mode, lookbackHours, limit, force });
    res.json(data);
  } catch (error) {
    logger.error('Failed to fetch process projects dashboard', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to fetch process projects dashboard' });
  }
});

app.get('/api/process/advice', async (req, res) => {
  try {
    const mode = req.query.mode || 'mine';
    const lookbackHours = req.query.lookbackHours ? Number(req.query.lookbackHours) : undefined;
    const force = String(req.query.force || '').toLowerCase() === 'true';
    const data = await processAdvisorService.getAdvice({ mode, lookbackHours, force });
    res.json(data);
  } catch (error) {
    logger.error('Failed to fetch process advice', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to fetch process advice' });
  }
});

// ============================================
// Task records API (tier/risk/prompt metadata)
// ============================================

app.get('/api/process/task-records', (req, res) => {
  try {
    const records = taskRecordService.list();
    const wrapped = (Array.isArray(records) ? records : []).map((r) => {
      const id = r?.id;
      if (!id) return null;
      const { id: _, ...rest } = r || {};
      return { id, record: rest };
    }).filter(Boolean);

    res.json({ count: wrapped.length, records: wrapped });
  } catch (error) {
    logger.error('Failed to list task records', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to list task records' });
  }
});

app.get('/api/process/task-records/:id', (req, res) => {
  try {
    const id = req.params.id;
    const record = taskRecordService.get(id);
    if (!record) return res.status(404).json({ error: 'Not found' });
    res.json({ id, record });
  } catch (error) {
    logger.error('Failed to get task record', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to get task record' });
  }
});

app.put('/api/process/task-records/:id', express.json(), async (req, res) => {
  try {
    const id = req.params.id;
    const record = await taskRecordService.upsert(id, req.body || {});
    res.json({ id, record });
  } catch (error) {
    logger.error('Failed to upsert task record', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message || 'Failed to upsert task record' });
  }
});

app.delete('/api/process/task-records/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const removed = await taskRecordService.remove(id);
    res.json({ id, removed });
  } catch (error) {
    logger.error('Failed to delete task record', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message || 'Failed to delete task record' });
  }
});

// ============================================
// Task record dependencies (orchestrator-native)
// ============================================

app.get('/api/process/task-records/:id/dependencies', async (req, res) => {
  try {
    const id = req.params.id;
    const dependencies = await taskDependencyService.resolveDependencies(id);
    res.json({ id, dependencies });
  } catch (error) {
    logger.error('Failed to resolve task dependencies', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message || 'Failed to resolve task dependencies' });
  }
});

app.post('/api/process/task-records/:id/dependencies', express.json(), async (req, res) => {
  try {
    const id = req.params.id;
    const depId = String(req.body?.dependencyId || '').trim();
    if (!depId) return res.status(400).json({ error: 'dependencyId is required' });
    const record = await taskDependencyService.addDependency(id, depId);
    res.json({ id, record });
  } catch (error) {
    logger.error('Failed to add task dependency', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message || 'Failed to add task dependency' });
  }
});

app.delete('/api/process/task-records/:id/dependencies/:depId', async (req, res) => {
  try {
    const id = req.params.id;
    const depId = decodeURIComponent(req.params.depId || '');
    const record = await taskDependencyService.removeDependency(id, depId);
    res.json({ id, record });
  } catch (error) {
    logger.error('Failed to remove task dependency', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message || 'Failed to remove task dependency' });
  }
});

// ============================================
// Dependency graph (bounded; for Queue viewer)
// ============================================

app.get('/api/process/dependency-graph/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const depth = req.query.depth ? Number(req.query.depth) : undefined;
    const graph = await taskDependencyService.buildGraph({ rootId: id, depth });
    res.json(graph);
  } catch (error) {
    logger.error('Failed to build dependency graph', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message || 'Failed to build dependency graph' });
  }
});

// ============================================
// Prompt artifacts API (large prompts; local/private by default)
// ============================================

app.get('/api/prompts', async (req, res) => {
  try {
    const limit = Number(req.query.limit || 200);
    const list = await promptArtifactService.list({ limit });
    res.json({ count: list.length, prompts: list });
  } catch (error) {
    logger.error('Failed to list prompts', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to list prompts' });
  }
});

app.get('/api/prompts/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const visibility = String(req.query.visibility || 'private').trim().toLowerCase();

    if (visibility === 'shared' || visibility === 'encrypted') {
      const repoRoot = String(req.query.repoRoot || '').trim();
      if (!repoRoot) return res.status(400).json({ error: 'repoRoot is required for shared/encrypted prompts' });
      const defaults = promptArtifactService.defaultRepoPromptPaths(id);
      const relPath = String(req.query.relPath || defaults[visibility] || '').trim();
      if (!relPath) return res.status(400).json({ error: 'relPath is required for shared/encrypted prompts' });
      const passphrase = process.env.ORCHESTRATOR_PROMPT_ENCRYPTION_KEY || process.env.ORCHESTRATOR_PROMPT_PASSPHRASE || '';
      if (visibility === 'encrypted' && !passphrase) {
        return res.status(400).json({
          error: 'Encrypted prompts require ORCHESTRATOR_PROMPT_ENCRYPTION_KEY (or ORCHESTRATOR_PROMPT_PASSPHRASE) to be set'
        });
      }
      const prompt = await promptArtifactService.readFromRepo({ repoRoot, relPath, visibility, passphrase });
      if (!prompt) return res.status(404).json({ error: 'Not found' });
      res.json({ id: safeId(id), ...prompt, visibility, repoRoot, relPath });
      return;
    }

    const prompt = await promptArtifactService.read(id);
    if (!prompt) return res.status(404).json({ error: 'Not found' });
    res.json({ ...prompt, visibility: 'private' });
  } catch (error) {
    logger.error('Failed to read prompt', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message || 'Failed to read prompt' });
  }
});

app.put('/api/prompts/:id', express.json({ limit: '25mb' }), async (req, res) => {
  try {
    const id = req.params.id;
    const text = req.body?.text;
    if (typeof text !== 'string') {
      return res.status(400).json({ error: 'Body must be JSON with { "text": "..." }' });
    }

    const visibility = String(req.query.visibility || 'private').trim().toLowerCase();
    if (visibility === 'shared' || visibility === 'encrypted') {
      const repoRoot = String(req.query.repoRoot || '').trim();
      if (!repoRoot) return res.status(400).json({ error: 'repoRoot is required for shared/encrypted prompts' });
      const defaults = promptArtifactService.defaultRepoPromptPaths(id);
      const relPath = String(req.query.relPath || defaults[visibility] || '').trim();
      if (!relPath) return res.status(400).json({ error: 'relPath is required for shared/encrypted prompts' });
      const passphrase = process.env.ORCHESTRATOR_PROMPT_ENCRYPTION_KEY || process.env.ORCHESTRATOR_PROMPT_PASSPHRASE || '';
      if (visibility === 'encrypted' && !passphrase) {
        return res.status(400).json({
          error: 'Encrypted prompts require ORCHESTRATOR_PROMPT_ENCRYPTION_KEY (or ORCHESTRATOR_PROMPT_PASSPHRASE) to be set'
        });
      }
      await promptArtifactService.writeToRepo({ repoRoot, relPath, visibility, text, passphrase });
      res.json({ id: safeId(id), sha256: sha256(text), visibility, repoRoot, relPath });
      return;
    }

    const result = await promptArtifactService.write(id, text);
    res.json({ ...result, visibility: 'private' });
  } catch (error) {
    logger.error('Failed to write prompt', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message || 'Failed to write prompt' });
  }
});

app.delete('/api/prompts/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const removed = await promptArtifactService.remove(id);
    res.json({ id, removed });
  } catch (error) {
    logger.error('Failed to delete prompt', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message || 'Failed to delete prompt' });
  }
});

// Promote a private prompt artifact into a repo (shared or encrypted).
app.post('/api/prompts/:id/promote', express.json({ limit: '2mb' }), async (req, res) => {
  try {
    const id = req.params.id;
    const visibility = String(req.body?.visibility || '').trim().toLowerCase();
    if (visibility !== 'shared' && visibility !== 'encrypted') {
      return res.status(400).json({ error: 'visibility must be "shared" or "encrypted"' });
    }
    const repoRoot = String(req.body?.repoRoot || '').trim();
    if (!repoRoot) return res.status(400).json({ error: 'repoRoot is required' });

    const defaults = promptArtifactService.defaultRepoPromptPaths(id);
    const relPath = String(req.body?.relPath || defaults[visibility] || '').trim();
    if (!relPath) return res.status(400).json({ error: 'relPath is required' });

    const passphrase = process.env.ORCHESTRATOR_PROMPT_ENCRYPTION_KEY || process.env.ORCHESTRATOR_PROMPT_PASSPHRASE || '';
    if (visibility === 'encrypted' && !passphrase) {
      return res.status(400).json({
        error: 'Encrypted prompts require ORCHESTRATOR_PROMPT_ENCRYPTION_KEY (or ORCHESTRATOR_PROMPT_PASSPHRASE) to be set'
      });
    }

    const result = await promptArtifactService.promoteToRepo({ id, repoRoot, relPath, visibility, passphrase });
    if (!result) return res.status(404).json({ error: 'Prompt not found' });

    let pointerCommented = false;
    const commentPointer = req.body?.commentPointer && typeof req.body.commentPointer === 'object' ? req.body.commentPointer : null;
    if (commentPointer) {
      const providerId = String(commentPointer.provider || 'trello').trim();
      const cardId = String(commentPointer.cardId || '').trim();
      if (!cardId) return res.status(400).json({ error: 'commentPointer.cardId is required when commentPointer is provided' });

      const provider = taskTicketingService.getProvider(providerId);
      if (typeof provider?.addComment !== 'function') {
        return res.status(400).json({ error: 'Provider does not support comments', code: 'UNSUPPORTED_OPERATION' });
      }

      const repoLabel = String(commentPointer.repoLabel || '').trim() || path.basename(repoRoot || '');
      const text = formatPointerComment({ id, sha256: result.sha256, visibility, repoLabel, relPath });
      await provider.addComment({ cardId, text });
      pointerCommented = true;
    }

    res.json({ ...result, visibility, repoRoot, relPath, pointerCommented });
  } catch (error) {
    logger.error('Failed to promote prompt', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message || 'Failed to promote prompt' });
  }
});

// Optional: embed prompt into a task card comment (Trello or future providers).
// Supports chunking for very large prompts.
app.post('/api/prompts/:id/embed', express.json({ limit: '2mb' }), async (req, res) => {
  try {
    const id = req.params.id;
    const providerId = req.body?.provider || 'trello';
    const cardId = req.body?.cardId;
    const mode = String(req.body?.mode || 'chunks').toLowerCase(); // snippet|full|chunks
    const maxChars = Number(req.body?.maxCharsPerComment || 8000);

    if (!cardId) return res.status(400).json({ error: 'cardId is required' });
    const provider = taskTicketingService.getProvider(providerId);
    if (typeof provider.addComment !== 'function') {
      return res.status(400).json({ error: 'Provider does not support comments', code: 'UNSUPPORTED_OPERATION' });
    }

    const prompt = await promptArtifactService.read(id);
    if (!prompt) return res.status(404).json({ error: 'Prompt not found' });

    const header = `Prompt artifact: ${prompt.id}\nsha256: ${prompt.sha256}\n`;
    const body = String(prompt.text || '');
    const safeMax = Number.isFinite(maxChars) ? Math.max(1000, Math.min(15000, maxChars)) : 8000;

    const makeChunks = (text) => {
      const chunks = [];
      let i = 0;
      while (i < text.length) {
        chunks.push(text.slice(i, i + safeMax));
        i += safeMax;
      }
      return chunks;
    };

    let comments = [];
    if (mode === 'snippet') {
      const snippet = body.slice(0, safeMax);
      comments = [`${header}\n${snippet}\n\n(embedded snippet)`];
    } else if (mode === 'full') {
      if (header.length + body.length <= safeMax) {
        comments = [`${header}\n${body}`];
      } else {
        return res.status(400).json({ error: 'Prompt too large for single comment; use mode="chunks"' });
      }
    } else {
      const chunks = makeChunks(body);
      comments = chunks.map((c, idx) => `${header}\n(part ${idx + 1}/${chunks.length})\n\n${c}`);
    }

    const created = [];
    for (const text of comments) {
      // eslint-disable-next-line no-await-in-loop
      const action = await provider.addComment({ cardId, text });
      created.push(action?.id || null);
    }

    res.json({ provider: providerId, cardId, promptId: prompt.id, comments: created, count: created.length });
  } catch (error) {
    const status = error.code === 'UNKNOWN_PROVIDER' || error.code === 'PROVIDER_NOT_CONFIGURED' ? 400 : 500;
    logger.error('Failed to embed prompt into task card', { error: error.message, code: error.code, stack: error.stack });
    res.status(status).json({ error: error.message, code: error.code, statusCode: error.statusCode, details: error.body });
  }
});

// ============================================
// Tasks API (Ticketing Providers)
// ============================================

app.get('/api/tasks/providers', (req, res) => {
  try {
    res.json({ providers: taskTicketingService.listProviders() });
  } catch (error) {
    logger.error('Failed to list task providers', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to list task providers' });
  }
});

app.get('/api/tasks/me', async (req, res) => {
  try {
    const providerId = req.query.provider || 'trello';
    const refresh = String(req.query.refresh || '').toLowerCase() === 'true';
    const provider = taskTicketingService.getProvider(providerId);
    if (typeof provider.getMe !== 'function') {
      return res.status(400).json({ error: 'Provider does not support me lookup', code: 'UNSUPPORTED_OPERATION' });
    }
    const member = await provider.getMe({ refresh });
    res.json({ provider: providerId, member });
  } catch (error) {
    const status = error.code === 'UNKNOWN_PROVIDER' || error.code === 'PROVIDER_NOT_CONFIGURED' ? 400 : 500;
    logger.error('Failed to fetch task provider me', { error: error.message, code: error.code, stack: error.stack });
    res.status(status).json({ error: error.message, code: error.code });
  }
});

app.get('/api/tasks/boards', async (req, res) => {
  try {
    const providerId = req.query.provider || 'trello';
    const refresh = String(req.query.refresh || '').toLowerCase() === 'true';
    const provider = taskTicketingService.getProvider(providerId);
    const boards = await provider.listBoards({ refresh });
    res.json({ provider: providerId, boards });
  } catch (error) {
    const status = error.code === 'UNKNOWN_PROVIDER' || error.code === 'PROVIDER_NOT_CONFIGURED' ? 400 : 500;
    logger.error('Failed to list task boards', { error: error.message, code: error.code, stack: error.stack });
    res.status(status).json({ error: error.message, code: error.code });
  }
});

app.get('/api/tasks/boards/:boardId/lists', async (req, res) => {
  try {
    const providerId = req.query.provider || 'trello';
    const refresh = String(req.query.refresh || '').toLowerCase() === 'true';
    const provider = taskTicketingService.getProvider(providerId);
    const lists = await provider.listLists({ boardId: req.params.boardId, refresh });
    res.json({ provider: providerId, boardId: req.params.boardId, lists });
  } catch (error) {
    const status = error.code === 'UNKNOWN_PROVIDER' || error.code === 'PROVIDER_NOT_CONFIGURED' ? 400 : 500;
    logger.error('Failed to list task lists', { error: error.message, code: error.code, stack: error.stack });
    res.status(status).json({ error: error.message, code: error.code });
  }
});

app.get('/api/tasks/boards/:boardId/members', async (req, res) => {
  try {
    const providerId = req.query.provider || 'trello';
    const refresh = String(req.query.refresh || '').toLowerCase() === 'true';
    const provider = taskTicketingService.getProvider(providerId);
    if (typeof provider.listBoardMembers !== 'function') {
      return res.status(400).json({ error: 'Provider does not support board members', code: 'UNSUPPORTED_OPERATION' });
    }
    const members = await provider.listBoardMembers({ boardId: req.params.boardId, refresh });
    res.json({ provider: providerId, boardId: req.params.boardId, members });
  } catch (error) {
    const status = error.code === 'UNKNOWN_PROVIDER' || error.code === 'PROVIDER_NOT_CONFIGURED' ? 400 : 500;
    logger.error('Failed to list task board members', { error: error.message, code: error.code, stack: error.stack });
    res.status(status).json({ error: error.message, code: error.code });
  }
});

app.get('/api/tasks/boards/:boardId/custom-fields', async (req, res) => {
  try {
    const providerId = req.query.provider || 'trello';
    const refresh = String(req.query.refresh || '').toLowerCase() === 'true';
    const provider = taskTicketingService.getProvider(providerId);
    if (typeof provider.listBoardCustomFields !== 'function') {
      return res.status(400).json({ error: 'Provider does not support custom fields', code: 'UNSUPPORTED_OPERATION' });
    }
    const customFields = await provider.listBoardCustomFields({ boardId: req.params.boardId, refresh });
    res.json({ provider: providerId, boardId: req.params.boardId, customFields });
  } catch (error) {
    const status = error.code === 'UNKNOWN_PROVIDER' || error.code === 'PROVIDER_NOT_CONFIGURED' ? 400 : 500;
    logger.error('Failed to list task board custom fields', { error: error.message, code: error.code, stack: error.stack });
    res.status(status).json({ error: error.message, code: error.code });
  }
});

app.get('/api/tasks/boards/:boardId/labels', async (req, res) => {
  try {
    const providerId = req.query.provider || 'trello';
    const refresh = String(req.query.refresh || '').toLowerCase() === 'true';
    const provider = taskTicketingService.getProvider(providerId);
    if (typeof provider.listBoardLabels !== 'function') {
      return res.status(400).json({ error: 'Provider does not support labels', code: 'UNSUPPORTED_OPERATION' });
    }
    const labels = await provider.listBoardLabels({ boardId: req.params.boardId, refresh });
    res.json({ provider: providerId, boardId: req.params.boardId, labels });
  } catch (error) {
    const status = error.code === 'UNKNOWN_PROVIDER' || error.code === 'PROVIDER_NOT_CONFIGURED' ? 400 : 500;
    logger.error('Failed to list task board labels', { error: error.message, code: error.code, stack: error.stack });
    res.status(status).json({ error: error.message, code: error.code });
  }
});

app.get('/api/tasks/boards/:boardId/cards', async (req, res) => {
  try {
    const providerId = req.query.provider || 'trello';
    const refresh = String(req.query.refresh || '').toLowerCase() === 'true';
    const q = req.query.q || '';
    const updatedSince = req.query.updatedSince || null;
    const provider = taskTicketingService.getProvider(providerId);
    if (typeof provider.listBoardCards !== 'function') {
      return res.status(400).json({ error: 'Provider does not support board cards', code: 'UNSUPPORTED_OPERATION' });
    }
    const cards = await provider.listBoardCards({ boardId: req.params.boardId, refresh, q, updatedSince });
    res.json({ provider: providerId, boardId: req.params.boardId, cards });
  } catch (error) {
    const status = error.code === 'UNKNOWN_PROVIDER' || error.code === 'PROVIDER_NOT_CONFIGURED' ? 400 : 500;
    logger.error('Failed to list task board cards', { error: error.message, code: error.code, stack: error.stack });
    res.status(status).json({ error: error.message, code: error.code });
  }
});

app.get('/api/tasks/boards/:boardId/snapshot', async (req, res) => {
  try {
    const providerId = req.query.provider || 'trello';
    const refresh = String(req.query.refresh || '').toLowerCase() === 'true';
    const q = req.query.q || '';
    const updatedSince = req.query.updatedSince || null;
    const provider = taskTicketingService.getProvider(providerId);
    if (typeof provider.getBoardSnapshot !== 'function') {
      return res.status(400).json({ error: 'Provider does not support board snapshot', code: 'UNSUPPORTED_OPERATION' });
    }
    const snapshot = await provider.getBoardSnapshot({ boardId: req.params.boardId, refresh, q, updatedSince });
    res.json({ provider: providerId, boardId: req.params.boardId, ...snapshot });
  } catch (error) {
    const status = error.code === 'UNKNOWN_PROVIDER' || error.code === 'PROVIDER_NOT_CONFIGURED' ? 400 : 500;
    logger.error('Failed to fetch task board snapshot', { error: error.message, code: error.code, stack: error.stack });
    res.status(status).json({ error: error.message, code: error.code });
  }
});

app.get('/api/tasks/lists/:listId/cards', async (req, res) => {
  try {
    const providerId = req.query.provider || 'trello';
    const refresh = String(req.query.refresh || '').toLowerCase() === 'true';
    const q = req.query.q || '';
    const updatedSince = req.query.updatedSince || null;
    const provider = taskTicketingService.getProvider(providerId);
    const cards = await provider.listCards({ listId: req.params.listId, refresh, q, updatedSince });
    res.json({ provider: providerId, listId: req.params.listId, cards });
  } catch (error) {
    const status = error.code === 'UNKNOWN_PROVIDER' || error.code === 'PROVIDER_NOT_CONFIGURED' ? 400 : 500;
    logger.error('Failed to list task cards', { error: error.message, code: error.code, stack: error.stack });
    res.status(status).json({ error: error.message, code: error.code });
  }
});

app.post('/api/tasks/lists/:listId/cards', express.json(), async (req, res) => {
  try {
    const providerId = req.query.provider || 'trello';
    const provider = taskTicketingService.getProvider(providerId);
    if (typeof provider.createCard !== 'function') {
      return res.status(400).json({ error: 'Provider does not support card creation', code: 'UNSUPPORTED_OPERATION' });
    }

    const body = req.body || {};
    const name = String(body.name || '').trim();
    const desc = String(body.desc || '');

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const created = await provider.createCard({
      listId: req.params.listId,
      name,
      desc,
      idMembers: Array.isArray(body.idMembers) ? body.idMembers : null,
      idLabels: Array.isArray(body.idLabels) ? body.idLabels : null,
      pos: body.pos ?? null,
      due: body.due ?? null
    });

    const card = typeof provider.getCard === 'function'
      ? await provider.getCard({ cardId: created?.id || created?.cardId, refresh: true })
      : created;

    res.json({ provider: providerId, listId: req.params.listId, card });
  } catch (error) {
    const status = error.code === 'UNKNOWN_PROVIDER' || error.code === 'PROVIDER_NOT_CONFIGURED' ? 400 : 500;
    logger.error('Failed to create task card', { error: error.message, code: error.code, stack: error.stack });
    res.status(status).json({
      error: error.message,
      code: error.code,
      statusCode: error.statusCode,
      details: error.body
    });
  }
});

app.get('/api/tasks/cards/:cardId', async (req, res) => {
  try {
    const providerId = req.query.provider || 'trello';
    const refresh = String(req.query.refresh || '').toLowerCase() === 'true';
    const provider = taskTicketingService.getProvider(providerId);
    const card = await provider.getCard({ cardId: req.params.cardId, refresh });
    res.json({ provider: providerId, cardId: req.params.cardId, card });
  } catch (error) {
    const status = error.code === 'UNKNOWN_PROVIDER' || error.code === 'PROVIDER_NOT_CONFIGURED' ? 400 : 500;
    logger.error('Failed to get task card', { error: error.message, code: error.code, stack: error.stack });
    res.status(status).json({ error: error.message, code: error.code });
  }
});

app.get('/api/tasks/cards/:cardId/dependencies', async (req, res) => {
  try {
    const providerId = req.query.provider || 'trello';
    const refresh = String(req.query.refresh || '').toLowerCase() === 'true';
    const checklistName = String(req.query.checklistName || '').trim() || null;
    const provider = taskTicketingService.getProvider(providerId);
    if (typeof provider.getDependencies !== 'function') {
      return res.status(400).json({ error: 'Provider does not support dependencies', code: 'UNSUPPORTED_OPERATION' });
    }
    const dependencies = await provider.getDependencies({ cardId: req.params.cardId, refresh, checklistName });
    res.json({ provider: providerId, cardId: req.params.cardId, dependencies });
  } catch (error) {
    const status = error.code === 'UNKNOWN_PROVIDER' || error.code === 'PROVIDER_NOT_CONFIGURED' ? 400 : 500;
    logger.error('Failed to get task dependencies', { error: error.message, code: error.code, stack: error.stack });
    res.status(status).json({ error: error.message, code: error.code });
  }
});

app.post('/api/tasks/cards/:cardId/dependencies', express.json(), async (req, res) => {
  try {
    const providerId = req.query.provider || 'trello';
    const checklistName = String(req.query.checklistName || '').trim() || null;
    const provider = taskTicketingService.getProvider(providerId);
    if (typeof provider.addDependency !== 'function') {
      return res.status(400).json({ error: 'Provider does not support dependencies', code: 'UNSUPPORTED_OPERATION' });
    }

    const { url, shortLink, name } = req.body || {};
    await provider.addDependency({ cardId: req.params.cardId, url, shortLink, name, checklistName });
    const card = typeof provider.getCard === 'function'
      ? await provider.getCard({ cardId: req.params.cardId, refresh: true })
      : null;

    res.json({ provider: providerId, cardId: req.params.cardId, card });
  } catch (error) {
    const status = error.code === 'UNKNOWN_PROVIDER' || error.code === 'PROVIDER_NOT_CONFIGURED' ? 400 : 500;
    logger.error('Failed to add task dependency', { error: error.message, code: error.code, stack: error.stack });
    res.status(status).json({
      error: error.message,
      code: error.code,
      statusCode: error.statusCode,
      details: error.body
    });
  }
});

app.delete('/api/tasks/cards/:cardId/dependencies/:itemId', async (req, res) => {
  try {
    const providerId = req.query.provider || 'trello';
    const checklistName = String(req.query.checklistName || '').trim() || null;
    const provider = taskTicketingService.getProvider(providerId);
    if (typeof provider.removeDependency !== 'function') {
      return res.status(400).json({ error: 'Provider does not support dependencies', code: 'UNSUPPORTED_OPERATION' });
    }

    await provider.removeDependency({ cardId: req.params.cardId, itemId: req.params.itemId, checklistName });
    const card = typeof provider.getCard === 'function'
      ? await provider.getCard({ cardId: req.params.cardId, refresh: true })
      : null;

    res.json({ provider: providerId, cardId: req.params.cardId, card });
  } catch (error) {
    const status = error.code === 'UNKNOWN_PROVIDER' || error.code === 'PROVIDER_NOT_CONFIGURED' ? 400 : 500;
    logger.error('Failed to remove task dependency', { error: error.message, code: error.code, stack: error.stack });
    res.status(status).json({
      error: error.message,
      code: error.code,
      statusCode: error.statusCode,
      details: error.body
    });
  }
});

app.put('/api/tasks/cards/:cardId/dependencies/:itemId', express.json(), async (req, res) => {
  try {
    const providerId = req.query.provider || 'trello';
    const provider = taskTicketingService.getProvider(providerId);
    if (typeof provider.setDependencyState !== 'function') {
      return res.status(400).json({ error: 'Provider does not support dependency updates', code: 'UNSUPPORTED_OPERATION' });
    }

    const state = req.body?.state;
    await provider.setDependencyState({ cardId: req.params.cardId, itemId: req.params.itemId, state });
    const card = typeof provider.getCard === 'function'
      ? await provider.getCard({ cardId: req.params.cardId, refresh: true })
      : null;

    res.json({ provider: providerId, cardId: req.params.cardId, card });
  } catch (error) {
    const status = error.code === 'UNKNOWN_PROVIDER' || error.code === 'PROVIDER_NOT_CONFIGURED' ? 400 : 500;
    logger.error('Failed to update task dependency', { error: error.message, code: error.code, stack: error.stack });
    res.status(status).json({
      error: error.message,
      code: error.code,
      statusCode: error.statusCode,
      details: error.body
    });
  }
});

app.post('/api/tasks/cards/:cardId/comments', express.json(), async (req, res) => {
  try {
    const providerId = req.query.provider || 'trello';
    const provider = taskTicketingService.getProvider(providerId);
    if (typeof provider.addComment !== 'function') {
      return res.status(400).json({ error: 'Provider does not support comments', code: 'UNSUPPORTED_OPERATION' });
    }

    const text = req.body?.text;
    if (!text || !String(text).trim()) {
      return res.status(400).json({ error: 'text is required' });
    }

    const action = await provider.addComment({ cardId: req.params.cardId, text });
    const card = typeof provider.getCard === 'function'
      ? await provider.getCard({ cardId: req.params.cardId, refresh: true })
      : null;

    res.json({ provider: providerId, cardId: req.params.cardId, action, card });
  } catch (error) {
    const status = error.code === 'UNKNOWN_PROVIDER' || error.code === 'PROVIDER_NOT_CONFIGURED' ? 400 : 500;
    logger.error('Failed to add task comment', { error: error.message, code: error.code, stack: error.stack });
    res.status(status).json({
      error: error.message,
      code: error.code,
      statusCode: error.statusCode,
      details: error.body
    });
  }
});

app.put('/api/tasks/cards/:cardId', express.json(), async (req, res) => {
  try {
    const providerId = req.query.provider || 'trello';
    const provider = taskTicketingService.getProvider(providerId);
    if (typeof provider.updateCard !== 'function') {
      return res.status(400).json({ error: 'Provider does not support updates', code: 'UNSUPPORTED_OPERATION' });
    }

    const fields = req.body || {};
    const updated = await provider.updateCard({ cardId: req.params.cardId, fields });
    const card = typeof provider.getCard === 'function'
      ? await provider.getCard({ cardId: req.params.cardId, refresh: true })
      : updated;

    res.json({ provider: providerId, cardId: req.params.cardId, card });
  } catch (error) {
    const status = error.code === 'UNKNOWN_PROVIDER' || error.code === 'PROVIDER_NOT_CONFIGURED' ? 400 : 500;
    logger.error('Failed to update task card', { error: error.message, code: error.code, stack: error.stack });
    res.status(status).json({
      error: error.message,
      code: error.code,
      statusCode: error.statusCode,
      details: error.body
    });
  }
});

app.put('/api/tasks/cards/:cardId/custom-fields/:customFieldId', express.json(), async (req, res) => {
  try {
    const providerId = req.query.provider || 'trello';
    const provider = taskTicketingService.getProvider(providerId);
    if (typeof provider.setCustomFieldItem !== 'function') {
      return res.status(400).json({ error: 'Provider does not support custom field updates', code: 'UNSUPPORTED_OPERATION' });
    }

    const payload = req.body || {};
    await provider.setCustomFieldItem({ cardId: req.params.cardId, customFieldId: req.params.customFieldId, payload });
    const card = typeof provider.getCard === 'function'
      ? await provider.getCard({ cardId: req.params.cardId, refresh: true })
      : null;

    res.json({ provider: providerId, cardId: req.params.cardId, card });
  } catch (error) {
    const status = error.code === 'UNKNOWN_PROVIDER' || error.code === 'PROVIDER_NOT_CONFIGURED' ? 400 : 500;
    logger.error('Failed to update task custom field', { error: error.message, code: error.code, stack: error.stack });
    res.status(status).json({
      error: error.message,
      code: error.code,
      statusCode: error.statusCode,
      details: error.body
    });
  }
});

// ============================================
// Worktree Tags API
// ============================================

app.get('/api/worktree-tags', (req, res) => {
  try {
    res.json(worktreeTagService.getAll());
  } catch (error) {
    logger.error('Failed to get worktree tags', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to get worktree tags' });
  }
});

app.post('/api/worktree-tags/ready', express.json(), async (req, res) => {
  try {
    const { worktreePath, ready } = req.body || {};
    if (!worktreePath) {
      return res.status(400).json({ error: 'worktreePath is required' });
    }

    const tag = await worktreeTagService.setReadyForReview(worktreePath, ready);
    io.emit('worktree-tag-updated', { worktreePath, tag });
    res.json({ worktreePath, tag });
  } catch (error) {
    logger.error('Failed to update ready-for-review tag', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to update ready-for-review tag' });
  }
});

// Continuity ledger API endpoints
app.get('/api/continuity/ledger', async (req, res) => {
  try {
    const { worktreePath } = req.query;
    if (!worktreePath) {
      return res.status(400).json({ error: 'worktreePath is required' });
    }

    const ledger = await continuityService.getLedger(worktreePath);
    if (ledger) {
      const summary = continuityService.getSummary(ledger);
      res.json({ ledger, summary });
    } else {
      res.json({ ledger: null, summary: null });
    }
  } catch (error) {
    logger.error('Failed to get continuity ledger', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to get ledger' });
  }
});

app.get('/api/continuity/workspace', async (req, res) => {
  try {
    const activeWorkspace = workspaceManager.getActiveWorkspace();
    if (!activeWorkspace) {
      return res.json({ ledgers: [] });
    }

    const ledgers = await continuityService.getWorkspaceLedgers(activeWorkspace);
    const summaries = ledgers.map(l => ({
      ...l,
      summary: continuityService.getSummary(l.ledger)
    }));

    res.json({ ledgers: summaries });
  } catch (error) {
    logger.error('Failed to get workspace ledgers', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to get workspace ledgers' });
  }
});

// Quick Links API endpoints
app.get('/api/quick-links', async (req, res) => {
  try {
    const data = await quickLinksService.getAll();
    res.json(data);
  } catch (error) {
    logger.error('Failed to get quick links', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to get quick links' });
  }
});

app.post('/api/quick-links/favorites', async (req, res) => {
  try {
    const { name, url, icon } = req.body;
    const favorites = await quickLinksService.addFavorite({ name, url, icon });
    res.json({ favorites });
  } catch (error) {
    logger.error('Failed to add favorite', { error: error.message, stack: error.stack });
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/quick-links/favorites', async (req, res) => {
  try {
    const { url } = req.body;
    const favorites = await quickLinksService.removeFavorite(url);
    res.json({ favorites });
  } catch (error) {
    logger.error('Failed to remove favorite', { error: error.message, stack: error.stack });
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/quick-links/favorites/reorder', async (req, res) => {
  try {
    const { urls } = req.body;
    const favorites = await quickLinksService.reorderFavorites(urls);
    res.json({ favorites });
  } catch (error) {
    logger.error('Failed to reorder favorites', { error: error.message, stack: error.stack });
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/quick-links/products', async (req, res) => {
  try {
    const { name, masterPath, startCommand, url, icon } = req.body;
    const products = await quickLinksService.addProduct({ name, masterPath, startCommand, url, icon });
    res.json({ products });
  } catch (error) {
    logger.error('Failed to add product', { error: error.message, stack: error.stack });
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/quick-links/products', async (req, res) => {
  try {
    const { id } = req.body;
    const products = await quickLinksService.removeProduct(id);
    res.json({ products });
  } catch (error) {
    logger.error('Failed to remove product', { error: error.message, stack: error.stack });
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/products/launch', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }

    const product = quickLinksService.getProductById(id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const result = await productLauncherService.launch(product);
    res.json(result);
  } catch (error) {
    logger.error('Failed to launch product', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Advanced Diff Viewer (on-demand auto-start)
// ============================================

app.get('/api/diff-viewer/status', async (req, res) => {
  try {
    const status = await diffViewerService.getStatus();
    res.json(status);
  } catch (error) {
    logger.error('Failed to get diff viewer status', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to get diff viewer status' });
  }
});

app.post('/api/diff-viewer/ensure', async (req, res) => {
  try {
    const result = await diffViewerService.ensureRunning();
    res.json(result);
  } catch (error) {
    logger.error('Failed to start diff viewer', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to start diff viewer', message: error.message });
  }
});

app.post('/api/quick-links/track-session', async (req, res) => {
  try {
    const recentSessions = await quickLinksService.trackSession(req.body);
    res.json({ recentSessions });
  } catch (error) {
    logger.error('Failed to track session', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to track session' });
  }
});

app.get('/api/quick-links/recent-sessions', (req, res) => {
  try {
    const { workspaceId, limit } = req.query;
    const sessions = quickLinksService.getRecentSessions({
      workspaceId,
      limit: limit ? parseInt(limit) : undefined
    });
    res.json({ sessions });
  } catch (error) {
    logger.error('Failed to get recent sessions', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to get recent sessions' });
  }
});

app.delete('/api/quick-links/recent-sessions', async (req, res) => {
  try {
    await quickLinksService.clearRecentSessions();
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to clear recent sessions', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to clear recent sessions' });
  }
});

// ============================================
// Commander Service API (Claude Code Terminal)
// ============================================

// Get Commander status
app.get('/api/commander/status', (req, res) => {
  try {
    const status = commanderService.getStatus();
    res.json(status);
  } catch (error) {
    logger.error('Failed to get commander status', { error: error.message });
    res.status(500).json({ error: 'Failed to get commander status' });
  }
});

// Start Commander terminal
app.post('/api/commander/start', async (req, res) => {
  try {
    const result = await commanderService.start();
    res.json(result);
  } catch (error) {
    logger.error('Failed to start commander', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Start Claude Code in Commander terminal
app.post('/api/commander/start-claude', async (req, res) => {
  try {
    const { mode, yolo } = req.body;
    // yolo defaults to true for Commander (YOLO mode enabled by default)
    const result = await commanderService.startClaude(mode || 'fresh', yolo !== false);
    res.json(result);
  } catch (error) {
    logger.error('Failed to start Claude in commander', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Send input to Commander terminal
app.post('/api/commander/input', (req, res) => {
  try {
    const { input } = req.body;
    if (!input) {
      return res.status(400).json({ error: 'Input is required' });
    }

    const success = commanderService.sendInput(input);
    res.json({ success });
  } catch (error) {
    logger.error('Commander input failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Stop Commander terminal
app.post('/api/commander/stop', (req, res) => {
  try {
    const result = commanderService.stop();
    res.json(result);
  } catch (error) {
    logger.error('Failed to stop commander', { error: error.message });
    res.status(500).json({ error: 'Failed to stop commander' });
  }
});

// Restart Commander terminal
app.post('/api/commander/restart', async (req, res) => {
  try {
    const result = await commanderService.restart();
    res.json(result);
  } catch (error) {
    logger.error('Failed to restart commander', { error: error.message });
    res.status(500).json({ error: 'Failed to restart commander' });
  }
});

// Get recent output from Commander
app.get('/api/commander/output', (req, res) => {
  try {
    const { lines } = req.query;
    const output = commanderService.getRecentOutput(lines ? parseInt(lines) : 50);
    res.json({ output });
  } catch (error) {
    logger.error('Failed to get commander output', { error: error.message });
    res.status(500).json({ error: 'Failed to get output' });
  }
});

// Clear Commander buffer
app.post('/api/commander/clear', (req, res) => {
  try {
    commanderService.clearBuffer();
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to clear commander buffer', { error: error.message });
    res.status(500).json({ error: 'Failed to clear buffer' });
  }
});

// List all sessions (for Commander visibility)
app.get('/api/commander/sessions', (req, res) => {
  try {
    const sessions = commanderService.listSessions();
    res.json({ sessions });
  } catch (error) {
    logger.error('Failed to list sessions', { error: error.message });
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// Send to another session from Commander
app.post('/api/commander/send-to-session', (req, res) => {
  try {
    const { sessionId, input } = req.body;
    if (!sessionId || !input) {
      return res.status(400).json({ error: 'sessionId and input are required' });
    }

    const success = commanderService.sendToSession(sessionId, input);
    res.json({ success });
  } catch (error) {
    logger.error('Failed to send to session', { error: error.message });
    res.status(500).json({ error: 'Failed to send to session' });
  }
});

// ============ COMMANDER COMMAND REGISTRY ============
// Semantic command system for Commander Claude UI control

// Get all available commands (discovery endpoint)
app.get('/api/commander/capabilities', (req, res) => {
  try {
    const capabilities = commandRegistry.getCapabilities();
    res.json(capabilities);
  } catch (error) {
    logger.error('Failed to get capabilities', { error: error.message });
    res.status(500).json({ error: 'Failed to get capabilities' });
  }
});

// Execute a command by name
app.post('/api/commander/execute', async (req, res) => {
  try {
    const { command, params } = req.body;
    if (!command) {
      return res.status(400).json({ error: 'command is required' });
    }
    const result = await commandRegistry.execute(command, params || {});
    res.json(result);
  } catch (error) {
    logger.error('Failed to execute command', { error: error.message });
    res.status(500).json({ error: 'Failed to execute command' });
  }
});

// ============ VOICE COMMAND ENDPOINTS ============

// Process voice command (parse + execute)
app.post('/api/voice/command', async (req, res) => {
  try {
    const { transcript } = req.body;
    if (!transcript) {
      return res.status(400).json({ error: 'transcript is required' });
    }
    const result = await voiceCommandService.processVoiceCommand(transcript);
    res.json(result);
  } catch (error) {
    logger.error('Failed to process voice command', { error: error.message });
    res.status(500).json({ error: 'Failed to process voice command' });
  }
});

// Parse voice command without executing
app.post('/api/voice/parse', async (req, res) => {
  try {
    const { transcript } = req.body;
    if (!transcript) {
      return res.status(400).json({ error: 'transcript is required' });
    }
    const result = await voiceCommandService.parseCommand(transcript);
    res.json(result);
  } catch (error) {
    logger.error('Failed to parse voice command', { error: error.message });
    res.status(500).json({ error: 'Failed to parse voice command' });
  }
});

// Get available voice commands
app.get('/api/voice/commands', (req, res) => {
  try {
    const commands = voiceCommandService.getVoiceCommands();
    res.json(commands);
  } catch (error) {
    logger.error('Failed to get voice commands', { error: error.message });
    res.status(500).json({ error: 'Failed to get voice commands' });
  }
});

// Get LLM backend status for voice commands
app.get('/api/voice/status', (req, res) => {
  try {
    const status = voiceCommandService.getLLMStatus();
    res.json(status);
  } catch (error) {
    logger.error('Failed to get voice LLM status', { error: error.message });
    res.status(500).json({ error: 'Failed to get voice LLM status' });
  }
});

// Refresh LLM availability check
app.post('/api/voice/refresh-llm', async (req, res) => {
  try {
    const status = await voiceCommandService.refreshLLMStatus();
    res.json(status);
  } catch (error) {
    logger.error('Failed to refresh LLM status', { error: error.message });
    res.status(500).json({ error: 'Failed to refresh LLM status' });
  }
});

// Update voice command context
app.post('/api/voice/context', (req, res) => {
  try {
    const { context } = req.body;
    voiceCommandService.setContext(context);
    res.json({ success: true, context: voiceCommandService.context });
  } catch (error) {
    logger.error('Failed to update voice context', { error: error.message });
    res.status(500).json({ error: 'Failed to update voice context' });
  }
});

// ============ WHISPER TRANSCRIPTION ENDPOINTS ============

// Get Whisper status
app.get('/api/whisper/status', (req, res) => {
  try {
    const status = whisperService.getStatus();
    res.json(status);
  } catch (error) {
    logger.error('Failed to get Whisper status', { error: error.message });
    res.status(500).json({ error: 'Failed to get Whisper status' });
  }
});

// Transcribe audio file with Whisper
app.post('/api/whisper/transcribe', audioUpload.single('audio'), async (req, res) => {
  const fs = require('fs');
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    if (!whisperService.isAvailable()) {
      // Clean up uploaded file
      fs.unlinkSync(req.file.path);
      return res.status(503).json({
        error: 'Whisper not available',
        hint: 'Install whisper.cpp or openai-whisper'
      });
    }

    const result = await whisperService.transcribe(req.file.path);

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      text: result.text,
      duration: result.duration,
      backend: whisperService.backend
    });
  } catch (error) {
    // Clean up uploaded file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    logger.error('Whisper transcription failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Full voice command with Whisper (transcribe + parse + execute)
app.post('/api/whisper/command', audioUpload.single('audio'), async (req, res) => {
  const fs = require('fs');
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    if (!whisperService.isAvailable()) {
      fs.unlinkSync(req.file.path);
      return res.status(503).json({
        error: 'Whisper not available',
        hint: 'Install whisper.cpp or openai-whisper'
      });
    }

    // Step 1: Transcribe
    const transcription = await whisperService.transcribe(req.file.path);
    fs.unlinkSync(req.file.path);

    // Step 2: Parse and execute
    const result = await voiceCommandService.processVoiceCommand(transcription.text);

    res.json({
      ...result,
      transcript: transcription.text,
      transcriptionTime: transcription.duration,
      transcriptionBackend: whisperService.backend
    });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    logger.error('Whisper command failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
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
    logger.error('Failed to get worktree config', { error: error.message, stack: error.stack });
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
    logger.error('Error serving replay viewer', { error: error.message, stack: error.stack });
    res.status(500).send('Error loading replay viewer');
  }
});

// Start server
const PORT = process.env.ORCHESTRATOR_PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

httpServer.listen(PORT, HOST, () => {
  logger.info(`Server running on http://${HOST}:${PORT}`);
  if (HOST === '0.0.0.0') {
    logger.info(`LAN access available on port ${PORT}`);
  }
  if (AUTH_TOKEN) {
    logger.info('Authentication enabled');
  }

  // Start the Advanced Diff Viewer in the background.
  // Default: enabled, since users expect the 🔍 diff viewer to be ready without manual terminal steps.
  const autoStartRaw = String(process.env.AUTO_START_DIFF_VIEWER ?? 'true').toLowerCase();
  const shouldAutoStartDiffViewer = !['0', 'false', 'no'].includes(autoStartRaw);
  if (shouldAutoStartDiffViewer) {
    diffViewerService.ensureRunning().catch((error) => {
      logger.warn('Diff viewer auto-start failed', { error: error.message });
    });
  }
  
  // Initialize sessions
  sessionManager.initializeSessions().catch(error => {
    logger.error('Failed to initialize sessions', { error: error.message, stack: error.stack });
  });
});

// Graceful shutdown
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

let isShuttingDown = false;
let forcedExitTimer = null;

function shutdown(signal = 'unknown') {
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress', { signal });
    return;
  }

  isShuttingDown = true;
  logger.info('Shutting down server...', { signal });
  
  // Clean up sessions first
  sessionManager.cleanup();
  
  // Close socket connections
  io.close(() => {
    logger.info('Socket.IO connections closed');
  });
  
  // Close HTTP server
  httpServer.close(() => {
    logger.info('HTTP server closed');
    if (forcedExitTimer) {
      clearTimeout(forcedExitTimer);
      forcedExitTimer = null;
    }
    process.exit(0);
  });
  
  // Force shutdown after 10 seconds
  forcedExitTimer = setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  if (error && error.code === 'EPIPE') {
    return;
  }
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  shutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', { reason, promise });
});

process.stdout.on('error', (error) => {
  if (error && error.code === 'EPIPE') {
    return;
  }
  throw error;
});

process.stderr.on('error', (error) => {
  if (error && error.code === 'EPIPE') {
    return;
  }
  throw error;
});
