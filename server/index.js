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
const { WorktreeHelper } = require('./worktreeHelper');
const AgentManager = require('./agentManager');
const { PortRegistry } = require('./portRegistry');
const { GreenfieldService } = require('./greenfieldService');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ["http://localhost:2080", "http://localhost:3000", "tauri://localhost"],
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

// Middleware for JSON parsing
app.use(express.json());

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
const agentManager = new AgentManager();
const sessionManager = new SessionManager(io, agentManager);
const statusDetector = new StatusDetector();
const gitHelper = new GitHelper();
const notificationService = new NotificationService(io);
const worktreeHelper = new WorktreeHelper();
const portRegistry = PortRegistry.getInstance();
const greenfieldService = GreenfieldService.getInstance();

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
    const scriptPath = `/home/<user>/HyFire2-work${worktreeNum}/build-production-with-console.sh`;
    
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
      cwd: `/home/<user>/HyFire2-work${worktreeNum}`
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
        const worktreePath = `/home/<user>/HyFire2-work${worktreeNum}`;
        
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

      // IMPORTANT: Stop all current sessions first
      logger.info('Stopping all current sessions before workspace switch');
      sessionManager.isWorkspaceSwitching = true; // Set flag BEFORE cleanup
      sessionManager.cleanup();

      const newWorkspace = await workspaceManager.switchWorkspace(workspaceId);

      // Ensure worktrees exist for the new workspace
      logger.info('Ensuring worktrees exist for new workspace');
      await worktreeHelper.ensureWorktreesExist(newWorkspace);

      // Set workspace and initialize fresh sessions
      sessionManager.setWorkspace(newWorkspace);
      await sessionManager.initializeSessions();

      // Emit success with ONLY new workspace sessions
      const newSessions = sessionManager.getSessionStates();
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

      logger.info('Workspace switched successfully', { workspace: newWorkspace.name });
    } catch (error) {
      logger.error('Failed to switch workspace', { error: error.message, stack: error.stack });
      socket.emit('error', { message: 'Failed to switch workspace', error: error.message, stack: error.stack });
    }
  });

  socket.on('list-workspaces', () => {
    const workspaces = workspaceManager.listWorkspaces();
    socket.emit('workspaces-list', workspaces);
  });

  // Add sessions for a new worktree without destroying existing sessions
  socket.on('add-worktree-sessions', async ({ worktreeId, worktreePath, repositoryName, repositoryType }) => {
    try {
      logger.info('Adding sessions for new worktree', { worktreeId, worktreePath, repositoryName });

      // Create sessions for just this worktree
      const newSessions = await sessionManager.createSessionsForWorktree({
        worktreeId,
        worktreePath,
        repositoryName,
        repositoryType
      });

      // Emit the new sessions to the requesting client only
      socket.emit('worktree-sessions-added', {
        worktreeId,
        sessions: newSessions
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

            projects.push({
              name: projectName,
              path: projectPath,
              masterPath: entry.name === 'master' ? fullPath : path.join(fullPath, 'master'),
              relativePath: path.relative(gitHubPath, projectPath),
              type: type,
              category: getCategoryFromPath(fullPath)
            });
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
      if (pathLower.includes('/website/')) return 'website';
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
      if (pathLower.includes('/website/')) return 'Websites';
      if (pathLower.includes('/writing/')) return 'Writing';
      if (pathLower.includes('/tools/')) return 'Tools';

      return 'Other';
    }

    // Start deep scan
    await scanDirectory(gitHubPath);

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
    const { workspaceId, repositoryPath, repositoryType, repositoryName, worktreeId } = req.body;
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
    const terminalIdBase = `${repositoryName.toLowerCase()}-${worktreeId}`;
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
        terminalType: 'server',
        visible: true
      }
    ];

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
    sessionManager.buildWorktreesFromWorkspace();

    // Re-initialize sessions to create the new terminals
    // NOTE: This currently clears all existing sessions.
    // TODO: Future improvement - only initialize NEW sessions without clearing existing ones
    await sessionManager.initializeSessions();

    // Emit updated session states to all clients
    const updatedSessions = sessionManager.getSessionStates();
    io.emit('sessions', updatedSessions);

    logger.info('New worktree sessions initialized (all terminals refreshed)', {
      totalSessions: Object.keys(updatedSessions).length
    });

    res.json({ success: true, terminalIds: newTerminals.map(t => t.id) });
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
      const workspaceData = {
        id: name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        name: name,
        repository: {
          path: result.projectPath,
          masterBranch: 'master'
        },
        worktrees: {
          enabled: true,
          namingPattern: 'work{n}',
          autoCreate: false
        },
        terminals: {
          pairs: worktreeCount || 1
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
    logger.error('Failed to initialize sessions', { error: error.message, stack: error.stack });
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