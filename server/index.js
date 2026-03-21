require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const winston = require('winston');
const { augmentProcessEnv, getHiddenProcessOptions } = require('./utils/processUtils');
const { readAppInfo } = require('./appInfo');
const {
  migrateFromOrchestratorDir,
  mergeLegacyDataDir,
  bootstrapProjectsRoot,
  getAgentWorkspaceDir,
  getLegacyCompatibilityState
} = require('./utils/pathUtils');

const migratedDataDir = migrateFromOrchestratorDir();
const mergedLegacyDataDir = mergeLegacyDataDir();
const legacyCompatibilityState = getLegacyCompatibilityState();
const resolvedDataDir = getAgentWorkspaceDir();
const projectsRootBootstrap = bootstrapProjectsRoot();

// Ensure log directory exists early (some services create file transports at require-time).
try {
  const logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
} catch {
  // ignore
}

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

if (migratedDataDir) {
  logger.info('Migrated data directory from ~/.orchestrator to ~/.agent-workspace');
}
if (mergedLegacyDataDir.merged) {
  logger.info('Merged legacy ~/.orchestrator data into ~/.agent-workspace', {
    reason: mergedLegacyDataDir.reason,
    sourceDir: mergedLegacyDataDir.sourceDir,
    targetDir: mergedLegacyDataDir.targetDir,
    backupDir: mergedLegacyDataDir.backupDir,
    copiedCount: mergedLegacyDataDir.copied.length,
    overwrittenCount: mergedLegacyDataDir.overwritten.length
  });
}
if (legacyCompatibilityState.shouldUseLegacyDir) {
  logger.warn('Using legacy ~/.orchestrator data directory for backward compatibility', {
    reason: legacyCompatibilityState.reason,
    resolvedDataDir,
    oldWorkspaceCount: legacyCompatibilityState.oldWorkspaceCount,
    newWorkspaceCount: legacyCompatibilityState.newWorkspaceCount
  });
}
if (projectsRootBootstrap.usingLegacyProjectsRoot) {
  logger.info('Using legacy ~/GitHub as the projects root until ~/.agent-workspace/projects is populated', {
    projectsDir: projectsRootBootstrap.projectsDir
  });
}

// Import services
const { SessionManager } = require('./sessionManager');
const { StatusDetector } = require('./statusDetector');
const { GitHelper } = require('./gitHelper');
const { NotificationService } = require('./notificationService');
const { UserSettingsService } = require('./userSettingsService');
const { LicenseService } = require('./licenseService');
const { requirePro } = require('./licenseMiddleware');
const { GitUpdateService } = require('./gitUpdateService');
const { WorkspaceManager } = require('./workspaceManager');
const { WorktreeHelper } = require('./worktreeHelper');
const AgentManager = require('./agentManager');
const { PortRegistry } = require('./portRegistry');
const { GreenfieldService } = require('./greenfieldService');
const { ProjectTypeService } = require('./projectTypeService');
const { ContinuityService } = require('./continuityService');
const { QuickLinksService } = require('./quickLinksService');
const { RecommendationsService } = require('./recommendationsService');
const { ProductLauncherService } = require('./productLauncherService');
const { CommanderService } = require('./commanderService');
const { ConversationService } = require('./conversationService');
const { AgentProviderService } = require('./agentProviderService');
const { WorktreeMetadataService } = require('./worktreeMetadataService');
const { WorktreeGitService } = require('./worktreeGitService');
const { ProjectMetadataService } = require('./projectMetadataService');
const { ProjectBoardService } = require('./projectBoardService');
const { WorktreeConflictService } = require('./worktreeConflictService');
const { WorktreeTagService } = require('./worktreeTagService');
const { DiffViewerService } = require('./diffViewerService');
const { PullRequestService } = require('./pullRequestService');
const { ProcessTaskService } = require('./processTaskService');
const { ProcessStatusService } = require('./processStatusService');
const { ProcessTelemetryService } = require('./processTelemetryService');
const { ProcessTelemetryBenchmarkService } = require('./processTelemetryBenchmarkService');
const { ProcessProjectDashboardService } = require('./processProjectDashboardService');
const { ProcessProjectHealthService } = require('./processProjectHealthService');
const { ProcessAdvisorService } = require('./processAdvisorService');
const { ProcessReadinessService } = require('./processReadinessService');
const { TelemetrySnapshotService } = require('./telemetrySnapshotService');
const { TaskRecordService } = require('./taskRecordService');
const { PromptArtifactService, safeId, sha256, formatPointerComment } = require('./promptArtifactService');
const { TaskDependencyService } = require('./taskDependencyService');
const { BatchLaunchService } = require('./batchLaunchService');
const { TaskTicketingService } = require('./taskTicketingService');
const { TaskTicketMoveService } = require('./taskTicketMoveService');
const { PrMergeAutomationService } = require('./prMergeAutomationService');
const { PrReviewAutomationService } = require('./prReviewAutomationService');
const { GitHubRepoService } = require('./githubRepoService');
const { GitHubCloneWorktreeService } = require('./githubCloneWorktreeService');
const { TestOrchestrationService } = require('./testOrchestrationService');
const { sanitizeFilename, formatConversationAsMarkdown } = require('./conversationExportService');
const { ActivityFeedService } = require('./activityFeedService');
const discordIntegrationService = require('./discordIntegrationService');
const commandRegistry = require('./commandRegistry');
const voiceCommandService = require('./voiceCommandService');
const whisperService = require('./whisperService');
const sessionRecoveryService = require('./sessionRecoveryService');
const { collectDiagnostics, collectFirstRunDiagnostics, collectInstallWizard, runFirstRunRepair, runFirstRunSafeRepairs } = require('./diagnosticsService');
const {
  getSetupActions,
  runSetupAction,
  getSetupActionRun,
  getLatestSetupActionRun,
  configureGitIdentity
} = require('./setupActionService');
const { OnboardingStateService } = require('./onboardingStateService');
const { PluginLoaderService } = require('./pluginLoaderService');
const { SchedulerService } = require('./schedulerService');
const { PagerService } = require('./pagerService');
const { ThreadService } = require('./threadService');
const { PolicyBundleService } = require('./policyBundleService');
const { ConfigPromoterService } = require('./configPromoterService');
const { normalizeServiceManifest, getWorkspaceServiceManifest } = require('./workspaceServiceStackService');
const { ServiceStackRuntimeService } = require('./serviceStackRuntimeService');
const { IntentHaikuService } = require('./intentHaikuService');
const {
  getLifecyclePolicy,
  parseWorktreeKey,
  terminalMatchesWorktree,
  sessionRecordMatchesWorktree,
  shouldCloseSessionsForThreadAction
} = require('./lifecyclePolicyService');
const { PolicyService } = require('./policyService');
const { AuditExportService } = require('./auditExportService');
const { getInstance: getCommandHistoryService } = require('./commandHistoryService');
const { evaluateBindSecurity, isLoopbackHost } = require('./networkSecurityPolicy');
const {
  normalizeRepositoryPath,
  normalizeRepositoryRootForWorktrees,
  normalizeThreadWorktreeId,
  pickReusableWorktreeId
} = require('./threadWorktreeSelection');
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

// Configure multer for image uploads (for terminal image paste)
const imageUploadDir = path.join(os.tmpdir(), 'orchestrator-images');
if (!fs.existsSync(imageUploadDir)) {
  fs.mkdirSync(imageUploadDir, { recursive: true });
}

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: imageUploadDir,
    filename: (req, file, cb) => {
      // Generate unique filename with timestamp and extension
      const ext = file.mimetype.split('/')[1] || 'png';
      const filename = `clipboard_${Date.now()}.${ext}`;
      cb(null, filename);
    }
  }),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max for images
  fileFilter: (req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/bmp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid image format. Allowed: PNG, JPEG, GIF, WebP, BMP'));
    }
  }
});

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      const allowed =
        !origin ||
        origin === 'tauri://localhost' ||
        origin.startsWith('http://localhost:') ||
        origin.startsWith('http://127.0.0.1:') ||
        origin.startsWith('http://[::1]:') ||
        origin.startsWith('http://100.');

      if (allowed) {
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
app.get('/bootstrap/setup-state.js', (req, res) => {
  try {
    const state = onboardingStateService.getDependencySetupState();
    res.type('application/javascript');
    res.set('Cache-Control', 'no-store');
    res.send(`window.__ORCHESTRATOR_SETUP_STATE__ = ${JSON.stringify(state)};`);
  } catch (error) {
    logger.error('Failed to serve setup bootstrap state', { error: error.message, stack: error.stack });
    res.type('application/javascript');
    res.set('Cache-Control', 'no-store');
    res.send('window.__ORCHESTRATOR_SETUP_STATE__ = null;');
  }
});

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
const { WorkspaceSuggestionService } = require('./workspaceSuggestionService');
const { FileSyncService } = require('./fileSyncService');
const agentManager = new AgentManager();
const sessionManager = new SessionManager(io, agentManager);
const statusDetector = new StatusDetector();
const gitHelper = new GitHelper();
const notificationService = new NotificationService(io);
const worktreeHelper = new WorktreeHelper();
const portRegistry = PortRegistry.getInstance();
const greenfieldService = GreenfieldService.getInstance();
const projectTypeService = ProjectTypeService.getInstance({ logger });
greenfieldService.setSessionManager(sessionManager);
greenfieldService.setIO(io);
greenfieldService.setProjectTypeService(projectTypeService);
const continuityService = ContinuityService.getInstance();
const quickLinksService = QuickLinksService.getInstance();
const recommendationsService = RecommendationsService.getInstance();
const activityFeed = ActivityFeedService.getInstance();
activityFeed.setIO(io);
activityFeed.track('server.started', { port: Number(process.env.ORCHESTRATOR_PORT || 9460) });
const productLauncherService = ProductLauncherService.getInstance();
const conversationService = ConversationService.getInstance();
const agentProviderService = AgentProviderService.getInstance({ agentManager, logger });
const worktreeMetadataService = WorktreeMetadataService.getInstance();
const worktreeGitService = WorktreeGitService.getInstance();
const projectMetadataService = ProjectMetadataService.getInstance();
const projectBoardService = ProjectBoardService.getInstance({ logger });
const worktreeConflictService = new WorktreeConflictService({ projectMetadataService, worktreeMetadataService });
const { CommanderContextService } = require('./commanderContextService');
const commanderContextService = CommanderContextService.getInstance();
const worktreeTagService = WorktreeTagService.getInstance();
const diffViewerService = DiffViewerService.getInstance();
const pullRequestService = PullRequestService.getInstance();
const processTaskService = ProcessTaskService.getInstance({ sessionManager, worktreeTagService, pullRequestService });
const taskRecordService = TaskRecordService.getInstance();
const userSettingsService = UserSettingsService.getInstance();
const licenseService = LicenseService.getInstance();
const onboardingStateService = OnboardingStateService.getInstance({ logger });
const proOnly = requirePro(licenseService);
const processStatusService = ProcessStatusService.getInstance({ processTaskService, taskRecordService, sessionManager, workspaceManager, userSettingsService });
const processTelemetryService = ProcessTelemetryService.getInstance({ taskRecordService });
const telemetrySnapshotService = TelemetrySnapshotService.getInstance();
const processTelemetryBenchmarkService = ProcessTelemetryBenchmarkService.getInstance({
  processTelemetryService,
  processStatusService,
  telemetrySnapshotService
});
const processProjectDashboardService = ProcessProjectDashboardService.getInstance({ pullRequestService, taskRecordService });
const processProjectHealthService = ProcessProjectHealthService.getInstance({ taskRecordService });
const promptArtifactService = PromptArtifactService.getInstance();
const taskTicketingService = TaskTicketingService.getInstance();
const taskDependencyService = TaskDependencyService.getInstance({ taskRecordService, pullRequestService, taskTicketingService, sessionManager, worktreeMetadataService });
const processAdvisorService = ProcessAdvisorService.getInstance({ processStatusService, processTelemetryService, processTaskService, taskRecordService, taskDependencyService });
const processReadinessService = ProcessReadinessService.getInstance();
const githubRepoService = GitHubRepoService.getInstance();
const githubCloneWorktreeService = GitHubCloneWorktreeService.getInstance({ logger, projectTypeService });
const { ProcessPairingService } = require('./processPairingService');
const processPairingService = ProcessPairingService.getInstance({ processTaskService, taskRecordService, worktreeConflictService, projectMetadataService });
const testOrchestrationService = TestOrchestrationService.getInstance({ sessionManager, workspaceManager });
const pluginLoaderService = PluginLoaderService.getInstance({ logger });
const schedulerService = SchedulerService.getInstance({ logger });
const pagerService = PagerService.getInstance({ logger });
const threadService = ThreadService.getInstance({ logger });
const intentHaikuService = IntentHaikuService.getInstance({ logger });
const serviceStackRuntimeService = ServiceStackRuntimeService.getInstance({ logger });
const policyService = PolicyService.getInstance({ logger });
const auditExportService = AuditExportService.getInstance({ logger });
const policyBundleService = PolicyBundleService.getInstance({ policyService, userSettingsService });
const configPromoterService = ConfigPromoterService.getInstance({ logger });

// Initialize Commander service (Top-Level AI as Claude Code terminal)
const commanderService = CommanderService.getInstance({
  sessionManager,
  io
});

// Initialize Command Registry for Commander UI control
commandRegistry.init({
  io,
  sessionManager,
  workspaceManager,
  pagerService
});
policyService.init({ userSettingsService, commandRegistry });
schedulerService.init({ userSettingsService, commandRegistry });
pagerService.init({ sessionManager, userSettingsService, taskRecordService });
threadService.init({ workspaceManager, sessionManager });
intentHaikuService.setSessionManager(sessionManager);
serviceStackRuntimeService.init({ workspaceManager, sessionManager, configPromoterService, io });
auditExportService.init({ activityFeed, schedulerService, userSettingsService });

const loadPlugins = async () => {
  const status = await pluginLoaderService.loadAll({
    app,
    commandRegistry,
    services: {
      io,
      logger,
      workspaceManager,
      sessionManager,
      userSettingsService,
      conversationService,
      agentProviderService,
      agentManager
    }
  });
  return status;
};

function buildPolicyDeniedPayload(decision, fallbackError = 'Forbidden by policy') {
  return {
    ok: false,
    error: fallbackError,
    reason: decision?.reason || fallbackError,
    requiredRole: decision?.requiredRole || null,
    role: decision?.role || null,
    action: decision?.action || null,
    policyEnabled: decision?.policyEnabled === true
  };
}

function requirePolicyAction(action) {
  return (req, res, next) => {
    try {
      const decision = policyService.canAccessAction({ req, action });
      if (!decision.ok) {
        return res.status(403).json(buildPolicyDeniedPayload(decision));
      }
      req.policyRole = decision.role;
      req.policyAction = decision.action;
      return next();
    } catch (error) {
      logger.error('Policy action check failed', { action, error: error.message, stack: error.stack });
      return res.status(500).json({ ok: false, error: 'Failed to evaluate policy action' });
    }
  };
}

// Connect services
sessionManager.setStatusDetector(statusDetector);
sessionManager.setGitHelper(gitHelper);

// Initialize workspace system
let workspaceInitialized = false;
let workspaceSystemReady = null;
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
workspaceSystemReady = initializeWorkspaceSystem()
  .then(() => {
    logger.info('Workspace system initialized');
    return true;
  })
  .catch(error => {
    logger.error('Workspace system initialization failed', { error: error.message, stack: error.stack });
    return false;
  });

workspaceSystemReady
  .then((workspaceReady) => {
    if (!workspaceReady) return null;
    return loadPlugins()
      .then((status) => {
        logger.info('Plugin loader finished', {
          loaded: Array.isArray(status?.loaded) ? status.loaded.length : 0,
          failed: Array.isArray(status?.failed) ? status.failed.length : 0
        });
        return status;
      })
      .catch((error) => {
        logger.error('Plugin loader failed', { error: error.message, stack: error.stack });
        return null;
      });
  })
  .catch(() => null);

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

  // Autosuggestion: client requests a suggestion for the current input prefix
  socket.on('autosuggest-request', ({ sessionId, prefix }) => {
    const commandHistory = getCommandHistoryService();
    const match = commandHistory.findMatch(sessionId, prefix);
    socket.emit('autosuggest-response', { sessionId, suggestion: match, prefix });
  });

  // Autosuggestion: client reports a command was executed (Enter pressed)
  socket.on('command-executed', ({ sessionId, command }) => {
    if (command && command.trim()) {
      const commandHistory = getCommandHistoryService();
      commandHistory.addCommand(sessionId, command);
      intentHaikuService.noteCommand(sessionId, command);
    }
  });

  // Client hint: terminal output suggests the branch changed (e.g. "Switched to branch ...").
  // This is a best-effort fast path to keep branch labels from staying stuck on "unknown".
  socket.on('refresh-branch', ({ sessionId }) => {
    const sid = String(sessionId || '').trim();
    if (!sid) return;

    const session = sessionManager.sessions.get(sid);
    if (!session) return;
    if (session.type !== 'claude' && session.type !== 'codex' && session.type !== 'server') return;

    const cwd = (typeof sessionManager.getSessionCwd === 'function')
      ? (sessionManager.getSessionCwd(session) || session?.config?.cwd || null)
      : (session?.config?.cwd || null);
    if (!cwd) return;

    const worktreeId = session.worktreeId || sid;
    sessionManager.updateGitBranch(worktreeId, cwd, true);
  });
  
  // Handle terminal resize
  socket.on('terminal-resize', ({ sessionId, cols, rows }) => {
    logger.debug('Terminal resize', { sessionId, cols, rows });
    sessionManager.resizeSession(sessionId, cols, rows);
  });
  
  // Handle session restart
  socket.on('restart-session', ({ sessionId }) => {
    logger.info('Session restart requested', { sessionId });
    activityFeed.track('session.restart', { sessionId });
    sessionManager.restartSession(sessionId);
  });
  
  // Handle Claude start with specific options (legacy)
  socket.on('start-claude', ({ sessionId, options }) => {
    logger.info('Claude start requested (legacy)', { sessionId, options });
    activityFeed.track('agent.start_legacy', { sessionId, agent: 'claude', mode: options?.mode || null });
    sessionManager.startClaudeWithOptions(sessionId, options);
  });

  // Handle agent start with configuration
  socket.on('start-agent', ({ sessionId, config }) => {
    logger.info('Agent start requested', { sessionId, config });
    activityFeed.track('agent.start', { sessionId, agent: config?.agent || null, mode: config?.mode || null });
    sessionManager.startAgentWithConfig(sessionId, config);
  });
  
  // Handle session heartbeat to keep sessions alive while UI is open
  socket.on('session-heartbeat', ({ sessionId }) => {
    sessionManager.heartbeat(sessionId);
  });
  
  // Handle server control
  socket.on('server-control', async ({ sessionId, action, environment, launchSettings }) => {
    logger.info('Server control request', { sessionId, action, environment, launchSettings });
    activityFeed.track('server.control', { sessionId, action, environment: environment || null });

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

        const { getShellKind, buildShellCommand, parseEnvAssignments } = require('./utils/shellCommand');
        const shellKind = getShellKind();

        const env = {
          NODE_ENV: nodeEnv,
          PORT: String(port)
        };

        if (launchSettings?.envVars) {
          Object.assign(env, parseEnvAssignments(launchSettings.envVars));
        }

        // Build command (cross-shell).
        // Use NODE_OPTIONS for node flags so this works on both bash and PowerShell.
        // (Avoids bash-only `$(which hytopia)` and Windows `.cmd` wrapper issues.)
        let runCommand = 'hytopia start';
        const nodeOptions = String(launchSettings?.nodeOptions || '').trim();
        if (nodeOptions) {
          env.NODE_OPTIONS = nodeOptions;
        }

        const gameArgs = String(launchSettings?.gameArgs || '').trim();
        if (gameArgs) {
          runCommand += ` ${gameArgs}`;
        }

        const cwd = session?.config?.cwd || null;
        const command = buildShellCommand({ shellKind, cwd, env, command: runCommand }) + '\n';

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
    activityFeed.track('build.production.requested', { sessionId, worktreeNum });

    const { spawn } = require('child_process');
    const fs = require('fs');
    const path = require('path');
    const { resolveBuildProductionContext } = require('./buildProductionService');
    
    let worktreePath;
    let scriptPath;
    try {
      const ctx = resolveBuildProductionContext({ sessionManager, sessionId, worktreeNum });
      worktreePath = ctx.worktreePath;
      scriptPath = ctx.scriptPath;
    } catch (error) {
      logger.error('Failed to resolve build production context', { sessionId, worktreeNum, error: error.message });
      socket.emit('build-failed', {
        sessionId,
        worktreeNum,
        error: error.message
      });
      return;
    }
    
    // Check if script exists
    if (!fs.existsSync(scriptPath)) {
      logger.error('Build script not found', { scriptPath });
      activityFeed.track('build.production.failed', { sessionId, worktreeNum, error: 'Build script not found' });
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
    if (process.platform === 'win32') {
      const error = 'build-production-with-console.sh requires bash. Run the orchestrator from WSL/Linux, or add a Windows build-production script.';
      logger.error('Build production not supported on Windows', { worktreeNum, scriptPath });
      activityFeed.track('build.production.failed', { sessionId, worktreeNum, error });
      socket.emit('build-failed', { sessionId, worktreeNum, error });
      return;
    }

    const buildProcess = spawn('bash', [scriptPath], {
      cwd: worktreePath
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
      activityFeed.track('build.production.failed', { sessionId, worktreeNum, error: error.message });
      socket.emit('build-failed', { 
        sessionId, 
        worktreeNum, 
        error: error.message 
      });
    });
    
    buildProcess.on('close', (code) => {
      if (code === 0) {
        // Build succeeded - find the created zip file in the worktree root
        
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
            activityFeed.track('build.production.completed', { sessionId, worktreeNum, zipPath: latestZip.path });
            
            socket.emit('build-completed', { 
              sessionId, 
              worktreeNum, 
              zipPath: latestZip.path 
            });
          } else {
            logger.warn('Build completed but no zip file found', { worktreeNum });
            activityFeed.track('build.production.failed', { sessionId, worktreeNum, error: 'Build completed but no zip file was created' });
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
          activityFeed.track('build.production.failed', { sessionId, worktreeNum, error: 'Failed to locate build output' });
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
        activityFeed.track('build.production.failed', { sessionId, worktreeNum, error: `Build failed with exit code ${code}` });
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
    
    const { execFile } = require('child_process');
    const fs = require('fs');

    const raw = String(filePath || '').trim();
    if (!raw) return;

    const resolvedPath = path.resolve(raw);
    if (!fs.existsSync(resolvedPath)) {
      logger.warn('Reveal path does not exist', { filePath, resolvedPath });
      return;
    }

    let dirPath = resolvedPath;
    try {
      const stat = fs.statSync(resolvedPath);
      if (!stat.isDirectory()) {
        dirPath = path.dirname(resolvedPath);
      }
    } catch (error) {
      logger.warn('Failed to stat reveal path', { filePath, resolvedPath, error: error.message });
      return;
    }

    if (!fs.existsSync(dirPath)) {
      logger.warn('Reveal directory does not exist', { filePath, resolvedPath, dirPath });
      return;
    }

    const isWSL = process.platform === 'linux' && (process.env.WSL_DISTRO_NAME || process.env.WSLENV);

    // Windows native: explorer.exe can open the folder directly.
    if (process.platform === 'win32') {
      execFile('explorer.exe', [dirPath], { windowsHide: true }, (error, stdout, stderr) => {
        if (error) {
          logger.error('Failed to open explorer.exe', { error: error.message, stderr });
        } else {
          logger.info('Explorer opened successfully', { dirPath });
        }
      });
      return;
    }

    // WSL: convert Linux path -> Windows path before calling explorer.exe.
    if (isWSL) {
      execFile('wslpath', ['-w', dirPath], { windowsHide: true, timeout: 3000 }, (err, stdout, stderr) => {
        if (err) {
          logger.error('Failed to convert path via wslpath', { error: err.message, stderr, dirPath });
          return;
        }
        const winPath = String(stdout || '').trim();
        if (!winPath) return;
        execFile('explorer.exe', [winPath], { windowsHide: true }, (error, _stdout2, _stderr2) => {
          if (error) {
            logger.error('Failed to open explorer.exe (WSL)', { error: error.message, winPath });
          } else {
            logger.info('Explorer opened successfully (WSL)', { dirPath, winPath });
          }
        });
      });
      return;
    }

    // Linux native fallback.
    execFile('xdg-open', [dirPath], { windowsHide: true, timeout: 3000 }, (error, stdout, stderr) => {
      if (error) {
        logger.error('Failed to open file manager', { error: error.message, stderr, dirPath });
      } else {
        logger.info('File manager opened successfully', { dirPath });
      }
    });
  });

  // Workspace management handlers
  socket.on('switch-workspace', async ({ workspaceId }) => {
    try {
      const previous = workspaceManager.getActiveWorkspace?.() || null;
      const requestedWorkspaceId = String(workspaceId || '').trim();
      activityFeed.track('workspace.switch.requested', {
        fromWorkspaceId: previous?.id || null,
        toWorkspaceId: requestedWorkspaceId || null,
        socketId: socket.id
      });

      logger.info('Workspace switch requested', { workspaceId });

      if (requestedWorkspaceId && previous?.id === requestedWorkspaceId && sessionManager.workspace?.id === requestedWorkspaceId) {
        const backlog = sessionManager.getUndeliveredOutputAndMarkDelivered();
        socket.emit('workspace-changed', {
          workspace: previous,
          sessions: sessionManager.getSessionStates()
        });
        if (backlog && typeof backlog === 'object') {
          for (const [sessionId, data] of Object.entries(backlog)) {
            if (!data) continue;
            socket.emit('terminal-output', {
              sessionId,
              data,
              workspaceId: previous?.id || null
            });
          }
        }
        return;
      }

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
          socket.emit('terminal-output', {
            sessionId,
            data,
            workspaceId: newWorkspace?.id || null
          });
        }
      }

      logger.info('Workspace switched successfully', { workspace: newWorkspace.name });
      activityFeed.track('workspace.switch.completed', {
        fromWorkspaceId: previous?.id || null,
        toWorkspaceId: newWorkspace?.id || null,
        toWorkspaceName: newWorkspace?.name || null,
        socketId: socket.id
      });
    } catch (error) {
      activityFeed.track('workspace.switch.failed', {
        toWorkspaceId: String(workspaceId || '').trim() || null,
        socketId: socket.id,
        error: error.message
      });
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

  socket.on('create-new-project', async (payload = {}, callback) => {
    const requestMeta = {
      name: String(payload?.name || payload?.projectName || '').trim() || null,
      category: String(payload?.category || payload?.categoryId || '').trim() || null,
      framework: String(payload?.framework || payload?.frameworkId || '').trim() || null,
      template: String(payload?.template || payload?.templateId || '').trim() || null,
      worktreeCount: Number(payload?.worktreeCount || payload?.worktrees || 0) || null,
      spawnClaude: payload?.spawnClaude === true,
      socketId: socket.id
    };
    try {
      logger.info('Socket project creation requested', requestMeta);
      const result = await workspaceManager.createProjectWorkspace(payload || {});
      let claudeSession = null;
      if (payload?.spawnClaude) {
        const work1Path = path.join(result?.project?.projectPath || '', 'work1');
        claudeSession = await greenfieldService.spawnClaudeInProject(
          work1Path,
          result?.project?.name,
          String(payload?.description || ''),
          payload?.yolo !== false
        );
      }

      const workspaces = await workspaceManager.listWorkspacesEnriched();

      io.emit('workspaces-list', workspaces);
      socket.emit('project-created', {
        project: { ...(result.project || {}), claudeSession },
        workspace: result.workspace
      });

      if (typeof callback === 'function') {
        callback({
          ok: true,
          project: { ...(result.project || {}), claudeSession },
          workspace: result.workspace
        });
      }
      logger.info('Socket project creation succeeded', {
        ...requestMeta,
        workspaceId: result?.workspace?.id || null,
        projectPath: result?.project?.projectPath || null,
        claudeSessionId: claudeSession?.sessionId || null
      });
    } catch (error) {
      logger.error('Failed to create new project via socket', { ...requestMeta, error: error.message, stack: error.stack });
      if (typeof callback === 'function') {
        callback({ ok: false, error: error.message });
      }
      socket.emit('error', { message: 'Failed to create new project', error: error.message });
    }
  });

  // Add sessions for a new worktree without destroying existing sessions
  socket.on('add-worktree-sessions', async ({ worktreeId, worktreePath, repositoryName, repositoryType, repositoryRoot, startTier }) => {
    try {
      logger.info('Adding sessions for new worktree', { worktreeId, worktreePath, repositoryName });
      activityFeed.track('worktree.sessions.add.requested', {
        worktreeId: String(worktreeId || '').trim() || null,
        worktreePath: String(worktreePath || '').trim() || null,
        repositoryName: String(repositoryName || '').trim() || null,
        repositoryType: String(repositoryType || '').trim() || null,
        startTier: startTier === undefined ? null : Number(startTier),
        socketId: socket.id
      });

      // Create sessions for just this worktree
      const newSessions = await sessionManager.createSessionsForWorktree({
        worktreeId,
        worktreePath,
        repositoryName,
        repositoryType,
        includeExistingSessions: true
      });

      // IMPORTANT: Update workspace config to persist this worktree
      // This ensures the worktree survives page reloads
      const activeWorkspace = workspaceManager.getActiveWorkspace();
      if (activeWorkspace) {
        try {
          const updatedConfig = { ...activeWorkspace };

          // Handle mixed-repo workspaces (terminals is an array)
          if (Array.isArray(updatedConfig.terminals)) {
            // Add new terminal entries for claude and server, but never duplicate
            // persisted workspace terminals when a user reopens an existing worktree.
            const baseRepo = {
              name: repositoryName || worktreeId.split('-')[0],
              path: repositoryRoot || worktreePath.replace(/[\\/]+work\d+$/i, ''),
              type: repositoryType,
              masterBranch: 'master'
            };

            const terminalIdBase = repositoryName
              ? `${repositoryName}-${worktreeId}`
              : worktreeId;

            const nextTerminals = [
              {
                id: `${terminalIdBase}-claude`,
                repository: baseRepo,
                worktree: worktreeId,
                worktreePath: worktreePath,
                terminalType: 'claude',
                visible: true
              },
              {
                id: `${terminalIdBase}-server`,
                repository: baseRepo,
                worktree: worktreeId,
                worktreePath: worktreePath,
                terminalType: 'server',
                visible: true
              }
            ];
            const existingTerminalIds = new Set(
              updatedConfig.terminals
                .map((terminal) => String(terminal?.id || '').trim())
                .filter(Boolean)
            );

            nextTerminals.forEach((terminal) => {
              if (existingTerminalIds.has(terminal.id)) return;
              updatedConfig.terminals.push(terminal);
              existingTerminalIds.add(terminal.id);
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
        workspaceId: activeWorkspace?.id || null,
        startTier: (tier >= 1 && tier <= 4) ? tier : undefined
      });

      logger.info('Worktree sessions added successfully', {
        worktreeId,
        sessionCount: Object.keys(newSessions).length
      });
      activityFeed.track('worktree.sessions.add.completed', {
        worktreeId: String(worktreeId || '').trim() || null,
        sessionCount: Object.keys(newSessions).length,
        socketId: socket.id
      });
    } catch (error) {
      activityFeed.track('worktree.sessions.add.failed', {
        worktreeId: String(worktreeId || '').trim() || null,
        worktreePath: String(worktreePath || '').trim() || null,
        repositoryName: String(repositoryName || '').trim() || null,
        socketId: socket.id,
        error: error.message
      });
      logger.error('Failed to add worktree sessions', { worktreeId, error: error.message });
      socket.emit('error', { message: 'Failed to add worktree sessions', error: error.message });
    }
  });

  // Handle tab closure - cleanup all sessions for the tab
  socket.on('close-tab', ({ tabId, sessionIds, workspaceId }) => {
    try {
      const wsId = String(workspaceId || '').trim() || null;
      logger.info('Tab close requested', { tabId, workspaceId: wsId });

      // We don't track tabId on the backend; the client passes the sessions for that tab.
      const ids = Array.isArray(sessionIds) ? sessionIds.map(String).filter(Boolean) : [];
      let closed = 0;
      const toClose = new Set();
      for (const sessionId of ids) {
        const groupIds = sessionManager.getSessionGroupIds(sessionId, {
          workspaceId: wsId,
          sessionTypes: ['claude', 'codex', 'server']
        });
        groupIds.forEach((id) => {
          const sid = String(id || '').trim();
          if (sid) toClose.add(sid);
        });
      }

      for (const sessionId of toClose) {
        const ok = sessionManager.closeSession(sessionId, {
          clearRecovery: true,
          workspaceId: wsId
        });
        if (!ok) continue;
        closed += 1;
        io.emit('session-closed', { sessionId, workspaceId: wsId });
      }

      logger.info('Tab closed', { tabId, closed });
      activityFeed.track('tab.closed', {
        tabId: String(tabId || '').trim() || null,
        closed,
        sessionCount: ids.length,
        socketId: socket.id
      });
    } catch (error) {
      activityFeed.track('tab.close.failed', {
        tabId: String(tabId || '').trim() || null,
        socketId: socket.id,
        error: error.message
      });
      logger.error('Failed to close tab', { tabId, error: error.message });
    }
  });

  // Close a specific session (PTY) from the UI (keeps workspace config intact).
  socket.on('destroy-session', ({ sessionId }) => {
    try {
      const id = String(sessionId || '').trim();
      if (!id) return;
      const target = sessionManager.getSessionById(id);
      if (!target) {
        activityFeed.track('session.closed', { sessionId: id, ok: false, socketId: socket.id });
        return;
      }

      // If the user closes either the agent or server terminal, close the whole worktree group.
      // This avoids "server orphaned" / "agent orphaned" drift and matches the UI expectation
      // that agent+server live/die together.
      const closeIds = new Set(
        sessionManager.getSessionGroupIds(id, {
          workspaceId: String(target.workspace || '').trim() || null,
          sessionTypes: ['claude', 'codex', 'server']
        })
      );
      if (!closeIds.size) closeIds.add(id);

      let closed = 0;
      closeIds.forEach((sid) => {
        const closingSession = sessionManager.getSessionById(sid);
        const closingWorkspaceId = closingSession?.workspace || null;
        const ok = sessionManager.closeSession(sid, {
          clearRecovery: true,
          workspaceId: closingWorkspaceId
        });
        if (!ok) return;
        closed += 1;
        io.emit('session-closed', { sessionId: sid, workspaceId: closingWorkspaceId });
      });

      activityFeed.track('session.closed', { sessionId: id, ok: closed > 0, closed, socketId: socket.id });
    } catch (error) {
      activityFeed.track('session.close.failed', {
        sessionId: String(sessionId || '').trim() || null,
        socketId: socket.id,
        error: error.message
      });
      logger.error('Failed to destroy session', { sessionId, error: error.message });
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

app.get('/api/app-info', (req, res) => {
  res.json(readAppInfo());
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

app.get('/api/workspaces/active', (req, res) => {
  try {
    const active = workspaceManager.getActiveWorkspace();
    if (active) return res.json({ id: active.id, name: active.name });
    // Fallback: read from persisted config (survives hot-reload)
    const configActive = workspaceManager.getConfig()?.activeWorkspace;
    if (configActive) {
      const ws = workspaceManager.getWorkspace(configActive);
      if (ws) return res.json({ id: ws.id, name: ws.name });
    }
    res.json({ id: null, name: null });
  } catch (error) {
    logger.error('Failed to get active workspace', { error: error.message });
    res.status(500).json({ error: 'Failed to get active workspace' });
  }
});

app.post('/api/workspaces/:id/cleanup-terminals', async (req, res) => {
  try {
    const workspaceId = String(req.params?.id || '').trim();
    if (!workspaceId) return res.status(400).json({ ok: false, error: 'workspaceId is required' });

    const ws = workspaceManager.getWorkspace(workspaceId);
    if (!ws) return res.status(404).json({ ok: false, error: 'Workspace not found' });

    const filePath = require('path').join(require('./utils/pathUtils').getAgentWorkspaceDir(), 'workspaces', `${workspaceId}.json`);
    const sanitize = workspaceManager.sanitizeWorkspaceTerminals(ws);
    if (sanitize.changed) {
      try {
        await require('fs').promises.writeFile(filePath, JSON.stringify(sanitize.workspace, null, 2));
      } catch (e) {
        logger.warn('Failed to persist terminal cleanup', { workspaceId, error: e.message });
      }
      workspaceManager.workspaces.set(workspaceId, sanitize.workspace);
      if (sanitize.health) workspaceManager.workspaceHealth.set(workspaceId, sanitize.health);
    }

    res.json({
      ok: true,
      changed: sanitize.changed,
      changes: sanitize.changes,
      health: sanitize.health || null,
      workspace: workspaceManager.getWorkspace(workspaceId)
    });
  } catch (error) {
    logger.error('Failed to cleanup terminals', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to cleanup terminals', message: error.message });
  }
});

app.put('/api/workspaces/:id', express.json(), async (req, res) => {
  try {
    const workspaceId = String(req.params?.id || '').trim();
    if (!workspaceId) {
      return res.status(400).json({ ok: false, error: 'workspaceId is required' });
    }

    const workspace = workspaceManager.getWorkspace(workspaceId);
    if (!workspace) {
      return res.status(404).json({ ok: false, error: 'Workspace not found' });
    }

    const name = String(req.body?.name || '').trim();
    if (!name) {
      return res.status(400).json({ ok: false, error: 'name is required' });
    }

    const updatedWorkspace = await workspaceManager.updateWorkspace(workspaceId, {
      name
    });

    res.json({ ok: true, workspace: updatedWorkspace });
  } catch (error) {
    logger.error('Failed to rename workspace', { error: error.message, stack: error.stack, workspaceId: req.params?.id });
    const status = String(error?.message || '').toLowerCase().includes('invalid workspace config')
      ? 400
      : 500;
    res.status(status).json({ ok: false, error: error.message });
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

app.get('/api/project-types', (req, res) => {
  try {
    res.json(projectTypeService.getTaxonomy());
  } catch (error) {
    logger.error('Failed to get project-types taxonomy', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to get project-types taxonomy' });
  }
});

app.get('/api/project-types/categories', (req, res) => {
  try {
    res.json(projectTypeService.getCategories());
  } catch (error) {
    logger.error('Failed to get project-type categories', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to get project-type categories' });
  }
});

app.get('/api/project-types/frameworks', (req, res) => {
  try {
    const categoryId = String(req.query.categoryId || '').trim();
    res.json(projectTypeService.getFrameworks({ categoryId }));
  } catch (error) {
    logger.error('Failed to get project-type frameworks', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to get project-type frameworks' });
  }
});

app.post('/api/project-types/frameworks', express.json(), async (req, res) => {
  try {
    const result = await projectTypeService.addFramework(req.body || {});
    res.json({ ok: true, ...result });
  } catch (error) {
    logger.error('Failed to add project-type framework', { error: error.message, stack: error.stack });
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get('/api/project-types/templates', (req, res) => {
  try {
    const categoryId = String(req.query.categoryId || '').trim();
    const frameworkId = String(req.query.frameworkId || '').trim();
    res.json(projectTypeService.getTemplates({ categoryId, frameworkId }));
  } catch (error) {
    logger.error('Failed to get project-type templates', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to get project-type templates' });
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
    const workspaces = await workspaceManager.listWorkspacesEnriched();
    io.emit('workspaces-list', workspaces);
    res.json(workspace);
  } catch (error) {
    logger.error('Failed to create workspace', { error: error.message, stack: error.stack });
    res.status(400).json({ error: error.message, stack: error.stack });
  }
});

app.post('/api/projects/create-workspace', express.json(), async (req, res) => {
  const requestMeta = {
    name: String(req.body?.name || req.body?.projectName || '').trim() || null,
    category: String(req.body?.category || req.body?.categoryId || '').trim() || null,
    framework: String(req.body?.framework || req.body?.frameworkId || '').trim() || null,
    template: String(req.body?.template || req.body?.templateId || '').trim() || null,
    worktreeCount: Number(req.body?.worktreeCount || req.body?.worktrees || 0) || null,
    spawnClaude: req.body?.spawnClaude === true
  };
  try {
    logger.info('API project creation requested', requestMeta);
    const result = await workspaceManager.createProjectWorkspace(req.body || {});
    let claudeSession = null;
    if (req.body?.spawnClaude) {
      const work1Path = path.join(result?.project?.projectPath || '', 'work1');
      claudeSession = await greenfieldService.spawnClaudeInProject(
        work1Path,
        result?.project?.name,
        String(req.body?.description || ''),
        req.body?.yolo !== false
      );
    }
    const project = {
      ...(result.project || {}),
      claudeSession,
      repoUrl: result?.project?.remoteUrl || null
    };
    res.json({
      ok: true,
      ...project,
      project,
      workspace: result.workspace
    });
    logger.info('API project creation succeeded', {
      ...requestMeta,
      workspaceId: result?.workspace?.id || null,
      projectPath: result?.project?.projectPath || null,
      claudeSessionId: claudeSession?.sessionId || null
    });
  } catch (error) {
    logger.error('Failed to create project workspace', { ...requestMeta, error: error.message, stack: error.stack });
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get('/api/projects/board', async (req, res) => {
  try {
    const refresh = String(req.query?.refresh || '').toLowerCase() === 'true';
    const board = await projectBoardService.load({ refresh });
    res.json({
      ok: true,
      storePath: projectBoardService.storePath,
      columns: projectBoardService.getColumns(),
      board
    });
  } catch (error) {
    logger.error('Failed to load project board', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to load project board' });
  }
});

app.post('/api/projects/board/move', express.json(), async (req, res) => {
  try {
    const projectKey = String(req.body?.projectKey || '').trim();
    const columnId = String(req.body?.columnId || '').trim();
    const orderByColumn = req.body?.orderByColumn && typeof req.body.orderByColumn === 'object' ? req.body.orderByColumn : null;
    if (!projectKey) return res.status(400).json({ ok: false, error: 'projectKey is required' });
    if (!columnId) return res.status(400).json({ ok: false, error: 'columnId is required' });

    const board = await projectBoardService.moveProject({ projectKey, columnId, orderByColumn });
    res.json({ ok: true, projectKey, columnId: String(columnId || '').trim().toLowerCase(), board });
  } catch (error) {
    logger.error('Failed to move project on board', { error: error.message, stack: error.stack });
    res.status(400).json({ ok: false, error: error.message || 'Failed to move project' });
  }
});

app.post('/api/projects/board/patch', express.json(), async (req, res) => {
  try {
    const collapsedColumnIds = Array.isArray(req.body?.collapsedColumnIds) ? req.body.collapsedColumnIds : undefined;
    const projectKey = req.body?.projectKey !== undefined ? String(req.body.projectKey || '').trim() : undefined;
    const live = req.body?.live;

    const hasLiveUpdate = live === true || live === false;
    if (projectKey !== undefined && !projectKey) return res.status(400).json({ ok: false, error: 'projectKey is required' });

    const board = await projectBoardService.patchBoard({
      collapsedColumnIds,
      projectKey: hasLiveUpdate ? projectKey : undefined,
      live: hasLiveUpdate ? live : undefined
    });

    res.json({ ok: true, board });
  } catch (error) {
    logger.error('Failed to patch project board', { error: error.message, stack: error.stack });
    res.status(400).json({ ok: false, error: error.message || 'Failed to patch project board' });
  }
});

app.get('/api/workspaces/:id/export', async (req, res) => {
  try {
    const workspaceId = String(req.params?.id || '').trim();
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
    const workspace = workspaceManager.getWorkspace(workspaceId);
    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });

    const filename = `${workspaceId}.workspace.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(workspace, null, 2));
  } catch (error) {
    logger.error('Failed to export workspace', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to export workspace' });
  }
});

app.post('/api/workspaces/import', async (req, res) => {
  try {
    const incoming = req.body && typeof req.body === 'object' ? req.body : null;
    if (!incoming) return res.status(400).json({ error: 'Workspace JSON body required' });

    const baseId = String(incoming.id || incoming.name || 'imported-workspace')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'imported-workspace';

    let id = baseId;
    let i = 2;
    while (workspaceManager.getWorkspace(id)) {
      id = `${baseId}-${i}`;
      i += 1;
      if (i > 50) throw new Error('Unable to find available workspace id');
    }

    const workspaceData = { ...incoming, id };
    if (!workspaceData.name) workspaceData.name = incoming.name || `Imported ${id}`;
    if (workspaceData.id !== incoming.id) {
      workspaceData.name = workspaceData.name || incoming.name || `Imported ${id}`;
    }

    const created = await workspaceManager.createWorkspace(workspaceData);
    res.json({ ok: true, workspace: created });
  } catch (error) {
    logger.error('Failed to import workspace', { error: error.message, stack: error.stack });
    res.status(400).json({ ok: false, error: error.message });
  }
});

const resolveWorkspaceServiceStackManifest = (workspace, options = {}) => {
  if (configPromoterService && typeof configPromoterService.resolveWorkspaceManifest === 'function') {
    return configPromoterService.resolveWorkspaceManifest(workspace, options);
  }
  return getWorkspaceServiceManifest(workspace);
};

const getLocalServiceStackField = (workspace) => {
  const hasShared = !!(workspace && workspace.serviceStackShared && typeof workspace.serviceStackShared === 'object');
  return hasShared ? 'serviceStackLocal' : 'serviceStack';
};

app.get('/api/workspaces/:id/service-stack', (req, res) => {
  try {
    const workspaceId = String(req.params?.id || '').trim();
    if (!workspaceId) return res.status(400).json({ ok: false, error: 'workspaceId is required' });
    const workspace = workspaceManager.getWorkspace(workspaceId);
    if (!workspace) return res.status(404).json({ ok: false, error: 'Workspace not found' });
    const manifest = resolveWorkspaceServiceStackManifest(workspace, {
      passphrase: req.query?.passphrase,
      signingSecret: req.query?.signingSecret
    });
    res.json({ ok: true, workspaceId, manifest });
  } catch (error) {
    logger.error('Failed to get workspace service stack', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to get workspace service stack', message: error.message });
  }
});

app.get('/api/workspaces/:id/service-stack/export', (req, res) => {
  try {
    const workspaceId = String(req.params?.id || '').trim();
    if (!workspaceId) return res.status(400).json({ ok: false, error: 'workspaceId is required' });
    const workspace = workspaceManager.getWorkspace(workspaceId);
    if (!workspace) return res.status(404).json({ ok: false, error: 'Workspace not found' });

    const manifest = resolveWorkspaceServiceStackManifest(workspace, {
      passphrase: req.query?.passphrase,
      signingSecret: req.query?.signingSecret
    });
    const payload = {
      workspaceId,
      workspaceName: String(workspace.name || workspaceId),
      exportedAt: new Date().toISOString(),
      ...manifest
    };

    const filename = `${workspaceId}.service-stack.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(payload, null, 2));
  } catch (error) {
    logger.error('Failed to export workspace service stack', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to export workspace service stack', message: error.message });
  }
});

app.put('/api/workspaces/:id/service-stack', express.json(), async (req, res) => {
  try {
    const workspaceId = String(req.params?.id || '').trim();
    if (!workspaceId) return res.status(400).json({ ok: false, error: 'workspaceId is required' });
    const workspace = workspaceManager.getWorkspace(workspaceId);
    if (!workspace) return res.status(404).json({ ok: false, error: 'Workspace not found' });

    const incoming = req.body?.manifest ?? req.body ?? {};
    const manifest = normalizeServiceManifest(incoming, { strict: true });

    const localField = getLocalServiceStackField(workspace);
    const updated = await workspaceManager.updateWorkspace(workspaceId, {
      [localField]: {
        ...manifest,
        updatedAt: new Date().toISOString()
      }
    });

    res.json({
      ok: true,
      workspaceId,
      localField,
      count: Array.isArray(updated?.[localField]?.services) ? updated[localField].services.length : 0,
      manifest: resolveWorkspaceServiceStackManifest(updated)
    });
  } catch (error) {
    logger.error('Failed to update workspace service stack', { error: error.message, stack: error.stack });
    res.status(400).json({ ok: false, error: 'Failed to update workspace service stack', message: error.message });
  }
});

app.post('/api/workspaces/:id/service-stack/import', express.json(), async (req, res) => {
  try {
    const workspaceId = String(req.params?.id || '').trim();
    if (!workspaceId) return res.status(400).json({ ok: false, error: 'workspaceId is required' });
    const workspace = workspaceManager.getWorkspace(workspaceId);
    if (!workspace) return res.status(404).json({ ok: false, error: 'Workspace not found' });

    const incoming = req.body?.manifest ?? req.body ?? {};
    const manifest = normalizeServiceManifest(incoming, { strict: true });
    const localField = getLocalServiceStackField(workspace);
    const updated = await workspaceManager.updateWorkspace(workspaceId, {
      [localField]: {
        ...manifest,
        updatedAt: new Date().toISOString()
      }
    });

    res.json({
      ok: true,
      workspaceId,
      localField,
      imported: Array.isArray(manifest.services) ? manifest.services.length : 0,
      manifest: resolveWorkspaceServiceStackManifest(updated)
    });
  } catch (error) {
    logger.error('Failed to import workspace service stack', { error: error.message, stack: error.stack });
    res.status(400).json({ ok: false, error: 'Failed to import workspace service stack', message: error.message });
  }
});

app.get('/api/workspaces/:id/service-stack/team', async (req, res) => {
  try {
    const workspaceId = String(req.params?.id || '').trim();
    if (!workspaceId) return res.status(400).json({ ok: false, error: 'workspaceId is required' });
    const workspace = workspaceManager.getWorkspace(workspaceId);
    if (!workspace) return res.status(404).json({ ok: false, error: 'Workspace not found' });

    const pointer = workspace?.serviceStackShared && typeof workspace.serviceStackShared === 'object'
      ? workspace.serviceStackShared
      : null;

    let baseline = null;
    let signatureVerified = null;
    if (pointer) {
      try {
        const readResult = await configPromoterService.readTeamManifest({
          workspace,
          pointer,
          passphrase: req.query?.passphrase,
          signingSecret: req.query?.signingSecret
        });
        baseline = readResult.manifest;
        signatureVerified = readResult.signatureVerified;
      } catch (error) {
        return res.status(400).json({ ok: false, error: 'Failed to read team baseline', message: error.message });
      }
    }

    const localManifest = getWorkspaceServiceManifest({ serviceStack: workspace?.serviceStackLocal || workspace?.serviceStack || { services: [] } });
    const resolved = resolveWorkspaceServiceStackManifest(workspace, {
      passphrase: req.query?.passphrase,
      signingSecret: req.query?.signingSecret
    });

    res.json({
      ok: true,
      workspaceId,
      pointer,
      baseline,
      localManifest,
      resolvedManifest: resolved,
      signatureVerified
    });
  } catch (error) {
    logger.error('Failed to get workspace team service stack baseline', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to get workspace team service stack baseline', message: error.message });
  }
});

app.post('/api/workspaces/:id/service-stack/team/promote', express.json(), async (req, res) => {
  try {
    const workspaceId = String(req.params?.id || '').trim();
    if (!workspaceId) return res.status(400).json({ ok: false, error: 'workspaceId is required' });
    const workspace = workspaceManager.getWorkspace(workspaceId);
    if (!workspace) return res.status(404).json({ ok: false, error: 'Workspace not found' });

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const visibility = String(body.visibility || 'shared').trim().toLowerCase();
    const promote = await configPromoterService.writeTeamManifest({
      workspace,
      manifest: resolveWorkspaceServiceStackManifest(workspace, {
        passphrase: body.passphrase,
        signingSecret: body.signingSecret
      }),
      visibility,
      repoRoot: body.repoRoot,
      relPath: body.relPath,
      passphrase: body.passphrase,
      signed: body.signed === true,
      signingSecret: body.signingSecret
    });

    const updates = {
      serviceStackShared: {
        ...promote.pointer,
        requireSignature: body.requireSignature === true
      }
    };
    if (!workspace.serviceStackLocal && workspace.serviceStack) {
      updates.serviceStackLocal = workspace.serviceStack;
    }

    const updated = await workspaceManager.updateWorkspace(workspaceId, updates);
    res.json({
      ok: true,
      workspaceId,
      pointer: updated.serviceStackShared,
      resolvedManifest: resolveWorkspaceServiceStackManifest(updated, {
        passphrase: body.passphrase,
        signingSecret: body.signingSecret
      })
    });
  } catch (error) {
    logger.error('Failed to promote workspace team service stack baseline', { error: error.message, stack: error.stack });
    res.status(400).json({ ok: false, error: 'Failed to promote workspace team service stack baseline', message: error.message });
  }
});

app.post('/api/workspaces/:id/service-stack/team/attach', express.json(), async (req, res) => {
  try {
    const workspaceId = String(req.params?.id || '').trim();
    if (!workspaceId) return res.status(400).json({ ok: false, error: 'workspaceId is required' });
    const workspace = workspaceManager.getWorkspace(workspaceId);
    if (!workspace) return res.status(404).json({ ok: false, error: 'Workspace not found' });

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const readResult = await configPromoterService.readTeamManifest({
      workspace,
      pointer: {
        repoRoot: body.repoRoot,
        relPath: body.relPath,
        visibility: body.visibility,
        signed: body.signed === true,
        requireSignature: body.requireSignature === true
      },
      repoRoot: body.repoRoot,
      relPath: body.relPath,
      visibility: body.visibility,
      passphrase: body.passphrase,
      signingSecret: body.signingSecret
    });

    const updates = {
      serviceStackShared: {
        ...readResult.pointer,
        requireSignature: body.requireSignature === true
      }
    };
    if (!workspace.serviceStackLocal && workspace.serviceStack) {
      updates.serviceStackLocal = workspace.serviceStack;
    }
    const updated = await workspaceManager.updateWorkspace(workspaceId, updates);

    res.json({
      ok: true,
      workspaceId,
      pointer: updated.serviceStackShared,
      baseline: readResult.manifest,
      signatureVerified: readResult.signatureVerified,
      resolvedManifest: resolveWorkspaceServiceStackManifest(updated, {
        passphrase: body.passphrase,
        signingSecret: body.signingSecret
      })
    });
  } catch (error) {
    logger.error('Failed to attach workspace team service stack baseline', { error: error.message, stack: error.stack });
    res.status(400).json({ ok: false, error: 'Failed to attach workspace team service stack baseline', message: error.message });
  }
});

app.put('/api/workspaces/:id/service-stack/local-override', express.json(), async (req, res) => {
  try {
    const workspaceId = String(req.params?.id || '').trim();
    if (!workspaceId) return res.status(400).json({ ok: false, error: 'workspaceId is required' });
    const workspace = workspaceManager.getWorkspace(workspaceId);
    if (!workspace) return res.status(404).json({ ok: false, error: 'Workspace not found' });

    const incoming = req.body?.manifest ?? req.body ?? {};
    const manifest = normalizeServiceManifest(incoming, { strict: true });
    const updated = await workspaceManager.updateWorkspace(workspaceId, {
      serviceStackLocal: {
        ...manifest,
        updatedAt: new Date().toISOString()
      }
    });

    res.json({
      ok: true,
      workspaceId,
      localCount: Array.isArray(updated?.serviceStackLocal?.services) ? updated.serviceStackLocal.services.length : 0,
      resolvedManifest: resolveWorkspaceServiceStackManifest(updated, {
        passphrase: req.body?.passphrase,
        signingSecret: req.body?.signingSecret
      })
    });
  } catch (error) {
    logger.error('Failed to update local service stack override', { error: error.message, stack: error.stack });
    res.status(400).json({ ok: false, error: 'Failed to update local service stack override', message: error.message });
  }
});

app.delete('/api/workspaces/:id/service-stack/team', express.json(), async (req, res) => {
  try {
    const workspaceId = String(req.params?.id || '').trim();
    if (!workspaceId) return res.status(400).json({ ok: false, error: 'workspaceId is required' });
    const workspace = workspaceManager.getWorkspace(workspaceId);
    if (!workspace) return res.status(404).json({ ok: false, error: 'Workspace not found' });

    const updated = await workspaceManager.updateWorkspace(workspaceId, {
      serviceStackShared: null
    });

    res.json({
      ok: true,
      workspaceId,
      manifest: resolveWorkspaceServiceStackManifest(updated)
    });
  } catch (error) {
    logger.error('Failed to detach workspace team service stack baseline', { error: error.message, stack: error.stack });
    res.status(400).json({ ok: false, error: 'Failed to detach workspace team service stack baseline', message: error.message });
  }
});

app.get('/api/workspaces/:id/service-stack/runtime', async (req, res) => {
  try {
    const workspaceId = String(req.params?.id || '').trim();
    if (!workspaceId) return res.status(400).json({ ok: false, error: 'workspaceId is required' });
    const runtime = await serviceStackRuntimeService.getRuntimeStatus(workspaceId);
    res.json({ ok: true, ...runtime });
  } catch (error) {
    logger.error('Failed to get workspace service stack runtime', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to get workspace service stack runtime', message: error.message });
  }
});

app.post('/api/workspaces/:id/service-stack/start', express.json(), async (req, res) => {
  try {
    const workspaceId = String(req.params?.id || '').trim();
    if (!workspaceId) return res.status(400).json({ ok: false, error: 'workspaceId is required' });
    const serviceIds = Array.isArray(req.body?.serviceIds) ? req.body.serviceIds : [];
    const result = await serviceStackRuntimeService.start(workspaceId, { serviceIds });
    const runtime = await serviceStackRuntimeService.getRuntimeStatus(workspaceId);
    res.json({ ok: true, ...result, runtime });
  } catch (error) {
    logger.error('Failed to start workspace service stack', { error: error.message, stack: error.stack });
    res.status(400).json({ ok: false, error: 'Failed to start workspace service stack', message: error.message });
  }
});

app.post('/api/workspaces/:id/service-stack/stop', express.json(), async (req, res) => {
  try {
    const workspaceId = String(req.params?.id || '').trim();
    if (!workspaceId) return res.status(400).json({ ok: false, error: 'workspaceId is required' });
    const serviceIds = Array.isArray(req.body?.serviceIds) ? req.body.serviceIds : [];
    const result = await serviceStackRuntimeService.stop(workspaceId, { serviceIds });
    const runtime = await serviceStackRuntimeService.getRuntimeStatus(workspaceId);
    res.json({ ok: true, ...result, runtime });
  } catch (error) {
    logger.error('Failed to stop workspace service stack', { error: error.message, stack: error.stack });
    res.status(400).json({ ok: false, error: 'Failed to stop workspace service stack', message: error.message });
  }
});

app.post('/api/workspaces/:id/service-stack/restart', express.json(), async (req, res) => {
  try {
    const workspaceId = String(req.params?.id || '').trim();
    if (!workspaceId) return res.status(400).json({ ok: false, error: 'workspaceId is required' });
    const serviceIds = Array.isArray(req.body?.serviceIds) ? req.body.serviceIds : [];
    const result = await serviceStackRuntimeService.restart(workspaceId, { serviceIds });
    const runtime = await serviceStackRuntimeService.getRuntimeStatus(workspaceId);
    res.json({ ok: true, ...result, runtime });
  } catch (error) {
    logger.error('Failed to restart workspace service stack', { error: error.message, stack: error.stack });
    res.status(400).json({ ok: false, error: 'Failed to restart workspace service stack', message: error.message });
  }
});

app.get('/api/workspaces/scan-repos', async (req, res) => {
  try {
    logger.info('Starting repository scan...');
    const fs = require('fs').promises;
    const path = require('path');
    const scanDepthRaw = Number.parseInt(String(process.env.WORKSPACE_SCAN_MAX_DEPTH || '').trim(), 10);
    const scanMaxDepth = Number.isFinite(scanDepthRaw)
      ? Math.min(Math.max(scanDepthRaw, 1), 12)
      : 6;

    const projects = [];
    const projectIndexByKey = new Map();
    const worktreeGroups = new Map();
    const { getProjectsRoot } = require('./utils/pathUtils');
    const gitHubPath = getProjectsRoot();

    // Deep scan function
    async function scanDirectory(dirPath, depth = 0, maxDepth = scanMaxDepth) {
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
              const projectEntries = await fs.readdir(projectPath, { withFileTypes: true });
              for (const projectEntry of projectEntries) {
                if (!projectEntry.isDirectory()) continue;
                const nestedMatch = projectEntry.name.match(/^work(\d+)$/i);
                if (!nestedMatch) continue;

                const worktreeNumber = Number(nestedMatch[1]);
                if (!Number.isFinite(worktreeNumber)) continue;

                const worktreeName = `work${worktreeNumber}`;
                const worktreePath = path.join(projectPath, projectEntry.name);
                const wtStat = await fs.stat(worktreePath);
                nestedEntries.push({
                  id: worktreeName,
                  name: projectEntry.name,
                  path: worktreePath,
                  number: worktreeNumber,
                  lastModifiedMs: wtStat.mtimeMs,
                  createdMs: wtStat.birthtimeMs || wtStat.ctimeMs || 0
                });
              }
              if (nestedEntries.length) {
                nestedEntries.sort((a, b) => (a.number || 0) - (b.number || 0));
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

    // Start deep scan of primary projects directory
    await scanDirectory(gitHubPath);

    // Legacy: also scan ~/GitHub if LEGACY_GITHUB_SCAN=1 is set
    const legacyScan = String(process.env.LEGACY_GITHUB_SCAN || '').trim();
    if (legacyScan === '1' || legacyScan === 'true') {
      const legacyGitHubPath = path.join(require('os').homedir(), 'GitHub');
      if (legacyGitHubPath !== gitHubPath) {
        try {
          await require('fs').promises.access(legacyGitHubPath);
          const beforeCount = projects.length;
          await scanDirectory(legacyGitHubPath);
          // Mark legacy-scanned projects so the UI can distinguish them
          for (let i = beforeCount; i < projects.length; i++) {
            projects[i].source = 'legacy-github';
          }
          logger.info(`Legacy scan found ${projects.length - beforeCount} additional projects in ~/GitHub`);
        } catch {
          // ~/GitHub doesn't exist, skip
        }
      }
    }

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

    logger.info(`Found ${projects.length} projects across ${new Set(projects.map(p => p.category)).size} categories`, { scanMaxDepth });
    res.json(projects);
  } catch (error) {
    logger.error('Failed to scan repositories', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to scan repositories' });
  }
});

app.get('/api/workspaces/suggestions', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(25, Number(req.query?.limit) || 8));
    const service = new WorkspaceSuggestionService({ workspaceManager });
    const data = await service.getSuggestions({ limit });
    res.json(data);
  } catch (error) {
    logger.error('Failed to get workspace suggestions', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to get workspace suggestions' });
  }
});

app.post('/api/workspaces/create-recent', async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');

    const count = Math.max(1, Math.min(12, Number(req.body?.count) || 4));
    const service = new WorkspaceSuggestionService({ workspaceManager });
    const suggestions = await service.getSuggestions({ limit: Math.max(8, count) });
    const recent = Array.isArray(suggestions?.suggestions?.recentRepos) ? suggestions.suggestions.recentRepos : [];
    const repos = recent.slice(0, count).flatMap((s) => Array.isArray(s?.repositories) ? s.repositories : []).filter(Boolean);

    if (!repos.length) {
      return res.status(400).json({ ok: false, error: 'No recent repos available to build a workspace' });
    }

    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const baseId = `recent-${stamp}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
    let id = baseId;
    let i = 2;
    while (workspaceManager.getWorkspace(id)) {
      id = `${baseId}-${i}`;
      i += 1;
      if (i > 50) throw new Error('Unable to find available workspace id');
    }

    const workspaceName = `Recent (auto) ${stamp.replace(/-/g, ':').replace(':', ' ')}`;

    const terminals = [];
    const slugify = (s) => String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 28) || 'repo';

    repos.forEach((r, idx) => {
      const repoPath = String(r?.path || '').trim();
      if (!repoPath) return;

      const repoName = String(r?.name || '').trim() || path.basename(repoPath) || `repo${idx + 1}`;
      const repoSlug = slugify(repoName);

      const masterPath = path.join(repoPath, 'master');
      const worktreePath = fs.existsSync(masterPath) ? masterPath : repoPath;
      const worktree = fs.existsSync(masterPath) ? 'master' : path.basename(worktreePath);

      const visible = idx === 0;

      const baseRepo = {
        name: repoName,
        path: repoPath,
        type: 'custom',
        masterBranch: 'master'
      };

      terminals.push({
        id: `${id}-${repoSlug}-${worktree}-claude`,
        repository: baseRepo,
        worktree,
        worktreePath,
        terminalType: 'claude',
        visible
      });
      terminals.push({
        id: `${id}-${repoSlug}-${worktree}-server`,
        repository: baseRepo,
        worktree,
        worktreePath,
        terminalType: 'server',
        visible
      });
    });

    const workspaceData = {
      id,
      name: workspaceName,
      type: 'custom',
      icon: '✨',
      description: 'Auto-created from recent git activity',
      access: 'private',
      empty: true,
      repository: { path: '', masterBranch: 'master', remote: '' },
      worktrees: { enabled: false, count: 0, namingPattern: 'work{n}', autoCreate: false },
      terminals,
      workspaceType: 'mixed-repo',
      layout: { type: 'dynamic', arrangement: 'auto' }
    };

    const created = await workspaceManager.createWorkspace(workspaceData);
    res.json({ ok: true, workspace: created });
  } catch (error) {
    logger.error('Failed to create recent workspace', { error: error.message, stack: error.stack });
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post('/api/files/sync', async (req, res) => {
  try {
    const sourceRoot = String(req.body?.sourceRoot || '').trim();
    const relativePath = String(req.body?.relativePath || '').trim();
    const overwrite = !!req.body?.overwrite;
    const targetsRaw = Array.isArray(req.body?.targets) ? req.body.targets : [];
    const targets = targetsRaw.map(String).map(s => s.trim()).filter(Boolean).slice(0, 25);

    const svc = new FileSyncService();
    const data = await svc.syncFile({ sourceRoot, relativePath, targets, overwrite });
    res.json({ ok: true, ...data });
  } catch (error) {
    logger.error('Failed to sync file', { error: error.message, stack: error.stack });
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get('/api/process/performance', async (req, res) => {
  const { spawn: spawnProc } = require('child_process');
  const isWin = process.platform === 'win32';

  const parseIntSafe = (s) => {
    const n = Number(String(s || '').trim());
    return Number.isFinite(n) ? Math.round(n) : null;
  };

  const spawnQuiet = (cmd, args, timeout = 1500) => new Promise((resolve) => {
    const child = spawnProc(cmd, args, {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      ...(isWin ? { creationFlags: 0x08000000 } : {})
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { child.kill(); resolve(''); }, timeout);
    child.on('close', () => { clearTimeout(timer); resolve(out); });
    child.on('error', () => { clearTimeout(timer); resolve(''); });
  });

  const getChildPids = async (pid) => {
    const p = Number(pid);
    if (!Number.isFinite(p) || p <= 0) return [];
    try {
      if (isWin) {
        const stdout = await spawnQuiet(
          'powershell.exe',
          ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ParentProcessId=${p}").ProcessId`]
        );
        return String(stdout || '')
          .split(/\s+/)
          .map(l => parseIntSafe(l))
          .filter(n => Number.isFinite(n) && n > 0);
      }

      const stdout = await spawnQuiet('pgrep', ['-P', String(p)]);
      return String(stdout || '')
        .split('\n')
        .map(l => parseIntSafe(l))
        .filter(n => Number.isFinite(n) && n > 0);
    } catch {
      return [];
    }
  };

  const getRssKb = async (pid) => {
    const p = Number(pid);
    if (!Number.isFinite(p) || p <= 0) return null;
    try {
      if (isWin) {
        const stdout = await spawnQuiet(
          'powershell.exe',
          ['-NoProfile', '-Command', `(Get-Process -Id ${p} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty WorkingSet64)`]
        );
        const bytes = Number(String(stdout || '').trim());
        if (!Number.isFinite(bytes) || bytes <= 0) return null;
        return Math.round(bytes / 1024);
      }

      const stdout = await spawnQuiet('ps', ['-o', 'rss=', '-p', String(p)]);
      return parseIntSafe(stdout);
    } catch {
      return null;
    }
  };

  try {
    const sessions = [];
    for (const [sessionId, session] of sessionManager.sessions) {
      sessions.push({ sessionId, session });
    }

    const metrics = await Promise.all(sessions.map(async ({ sessionId, session }) => {
      const pid = session?.pty?.pid || null;
      const childPids = pid ? await getChildPids(pid) : [];
      const pids = pid ? [pid, ...childPids] : [];
      const rssList = await Promise.all(pids.map(getRssKb));
      const totalRssKb = rssList.reduce((acc, v) => acc + (Number(v) || 0), 0) || null;

      return {
        sessionId,
        type: session?.type || null,
        worktreeId: session?.worktreeId || null,
        repositoryName: session?.repositoryName || null,
        pid,
        childCount: childPids.length,
        totalRssKb,
        updatedAt: new Date().toISOString()
      };
    }));

    res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      node: {
        pid: process.pid,
        uptimeSeconds: Math.round(process.uptime()),
        rssBytes: process.memoryUsage().rss
      },
      sessions: metrics
        .sort((a, b) => String(a.sessionId).localeCompare(String(b.sessionId)))
    });
  } catch (error) {
    logger.error('Failed to get performance metrics', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to get performance metrics' });
  }
});

app.get('/api/activity', (req, res) => {
  try {
    const since = req.query?.since;
    const limit = req.query?.limit;
    const events = activityFeed.list({ since, limit });
    res.json({ ok: true, events });
  } catch (error) {
    logger.error('Failed to list activity events', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to list activity events' });
  }
});

app.get('/api/policy/status', (req, res) => {
  try {
    const status = policyService.getStatus({ req });
    res.json(status);
  } catch (error) {
    logger.error('Failed to get policy status', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to get policy status' });
  }
});

app.get('/api/policy/templates', requirePolicyAction('read'), (req, res) => {
  try {
    const templates = policyBundleService.listTemplates();
    res.json({
      ok: true,
      count: templates.length,
      templates,
      policyRole: req.policyRole || policyService.resolveRole(req).role
    });
  } catch (error) {
    logger.error('Failed to list policy templates', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to list policy templates' });
  }
});

app.post('/api/policy/bundles/export', requirePolicyAction('read'), express.json({ limit: '2mb' }), (req, res) => {
  try {
    const bundle = policyBundleService.exportBundle({
      templateId: req.body?.templateId,
      policy: req.body?.policy,
      orgName: req.body?.orgName,
      notes: req.body?.notes,
      createdBy: req.body?.createdBy || req.policyRole || null
    });
    res.json({
      ok: true,
      bundle
    });
  } catch (error) {
    logger.error('Failed to export policy bundle', { error: error.message, stack: error.stack });
    res.status(400).json({ ok: false, error: error.message || 'Failed to export policy bundle' });
  }
});

app.post('/api/policy/bundles/import', requirePolicyAction('write'), express.json({ limit: '2mb' }), (req, res) => {
  try {
    const bundle = req.body?.bundle || req.body;
    const mode = req.body?.mode || 'replace';
    const result = policyBundleService.importBundle(bundle, { mode });
    io.emit('user-settings-updated', userSettingsService.getAllSettings());
    res.json({
      ok: true,
      ...result
    });
  } catch (error) {
    logger.error('Failed to import policy bundle', { error: error.message, stack: error.stack });
    res.status(400).json({ ok: false, error: error.message || 'Failed to import policy bundle' });
  }
});

app.get('/api/audit/status', requirePolicyAction('read'), async (req, res) => {
  try {
    const status = await auditExportService.getStatus();
    res.json({
      ...status,
      policyRole: req.policyRole || policyService.resolveRole(req).role
    });
  } catch (error) {
    logger.error('Failed to get audit status', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to get audit status' });
  }
});

app.get('/api/audit/export', requirePolicyAction('audit_export'), proOnly, async (req, res) => {
  try {
    const format = String(req.query?.format || 'json').trim().toLowerCase();
    if (format !== 'json' && format !== 'csv') {
      return res.status(400).json({ ok: false, error: 'Unsupported export format (json|csv)' });
    }

    const limit = req.query?.limit ? Number(req.query.limit) : undefined;
    const sinceHours = req.query?.sinceHours ? Number(req.query.sinceHours) : 24 * 7;
    const sinceMs = Number.isFinite(sinceHours) ? Date.now() - (Math.max(1, sinceHours) * 60 * 60 * 1000) : 0;
    const sources = typeof req.query?.sources === 'string' ? req.query.sources : '';
    const redactRaw = String(req.query?.redact ?? '').trim().toLowerCase();
    const redact = redactRaw ? !['0', 'false', 'no', 'off'].includes(redactRaw) : undefined;
    const signedRaw = String(req.query?.signed ?? '').trim().toLowerCase();
    const signed = ['1', 'true', 'yes', 'on'].includes(signedRaw);
    if (signed) {
      const signing = auditExportService.getSigningConfig();
      if (!signing.enabled) {
        return res.status(400).json({ ok: false, error: 'Audit signing is disabled (global.audit.signing.enabled=false)' });
      }
      if (!signing.hasSecret) {
        return res.status(400).json({ ok: false, error: 'Missing ORCHESTRATOR_AUDIT_SIGNING_SECRET for signed export' });
      }
    }

    if (format === 'csv') {
      const payload = await auditExportService.exportCsv({ sources, sinceMs, limit, redact });
      if (signed) {
        const signature = auditExportService.signPayload({
          generatedAt: payload.generatedAt,
          count: payload.count,
          sources: payload.sources,
          redacted: payload.redacted,
          csv: payload.csv
        });
        res.setHeader('X-Audit-Signature', signature.value);
        res.setHeader('X-Audit-Signature-Alg', signature.algorithm);
        res.setHeader('X-Audit-Signature-KeyId', signature.keyId);
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="audit-export-${Date.now()}.csv"`);
      return res.send(payload.csv);
    }

    const payload = await auditExportService.exportJson({ sources, sinceMs, limit, redact });
    const jsonBody = signed
      ? {
        ok: true,
        signed: true,
        signature: auditExportService.signPayload(payload),
        payload
      }
      : payload;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-export-${Date.now()}.json"`);
    return res.send(`${JSON.stringify(jsonBody, null, 2)}\n`);
  } catch (error) {
    logger.error('Failed to export audit logs', { error: error.message, stack: error.stack });
    return res.status(500).json({ ok: false, error: 'Failed to export audit logs' });
  }
});

app.get('/api/sessions/:sessionId/log', (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || '').trim();
    if (!sessionId) return res.status(400).json({ ok: false, error: 'sessionId is required' });

    const session = sessionManager.sessions.get(sessionId);
    if (!session) return res.status(404).json({ ok: false, error: 'Session not found' });

    const requested = Number(req.query?.tailChars ?? 20000);
    const tailChars = Math.max(1000, Math.min(200000, Number.isFinite(requested) ? requested : 20000));

    const buffer = String(session.buffer || '');
    const log = buffer.length > tailChars ? buffer.slice(-tailChars) : buffer;

    res.json({
      ok: true,
      sessionId,
      tailChars,
      status: session.status || null,
      branch: session.branch || null,
      worktreeId: session.worktreeId || null,
      repositoryName: session.repositoryName || null,
      cwd: session?.cwdState?.current || session?.config?.cwd || null,
      log
    });
  } catch (error) {
    logger.error('Failed to get session log', { sessionId: req.params.sessionId, error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to get session log' });
  }
});

app.post('/api/sessions/intent-haiku', async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || '').trim();
    if (!sessionId) {
      return res.status(400).json({ ok: false, error: 'sessionId is required' });
    }

    const force = req.body?.force === true;
    const payload = await intentHaikuService.summarizeSession(sessionId, { force });
    return res.json({
      ok: true,
      sessionId,
      summary: payload.summary,
      source: payload.source,
      generatedAt: payload.generatedAt
    });
  } catch (error) {
    const code = String(error?.code || '').trim();
    if (code === 'SESSION_NOT_FOUND') {
      return res.status(404).json({ ok: false, error: error.message });
    }
    if (code === 'UNSUPPORTED_SESSION_TYPE') {
      return res.status(400).json({ ok: false, error: error.message });
    }
    logger.error('Failed to generate intent haiku', { error: error.message, stack: error.stack });
    return res.status(500).json({ ok: false, error: 'Failed to generate intent haiku' });
  }
});

function pickNextWorktreeIdForWorkspace(workspace, { repositoryPath } = {}) {
  const repoPathNorm = normalizeRepositoryPath(repositoryPath);
  const primarySlotLimit = 8;

  if (workspace?.workspaceType === 'mixed-repo') {
    const terminals = Array.isArray(workspace?.terminals) ? workspace.terminals : [];
    let max = 0;
    const used = new Set();
    for (const terminal of terminals) {
      const terminalRepoPath = normalizeRepositoryPath(terminal?.repository?.path);
      if (repoPathNorm && terminalRepoPath && terminalRepoPath !== repoPathNorm) continue;
      const id = normalizeThreadWorktreeId(terminal?.worktree || terminal?.worktreeId || '');
      const match = String(id || '').match(/^work(\d+)$/);
      if (!match) continue;
      const n = Number(match[1]);
      if (!Number.isFinite(n)) continue;
      used.add(`work${n}`);
      max = Math.max(max, n);
    }
    for (let i = 1; i <= primarySlotLimit; i += 1) {
      const candidate = `work${i}`;
      if (!used.has(candidate)) return candidate;
    }
    return `work${Math.max(primarySlotLimit + 1, max + 1)}`;
  }

  const pairs = Number(workspace?.terminals?.pairs || 0);
  if (pairs < primarySlotLimit) return `work${Math.max(1, pairs + 1)}`;
  return `work${Math.max(primarySlotLimit + 1, pairs + 1)}`;
}

function resolveThreadRepositoryContext(workspace, { repositoryPath, repositoryName, repositoryType } = {}) {
  const repoPathExplicit = normalizeRepositoryRootForWorktrees(repositoryPath);
  const repoNameExplicit = String(repositoryName || '').trim().toLowerCase();
  const mixedTerminals = Array.isArray(workspace?.terminals) ? workspace.terminals : [];
  const repoFromMixed = mixedTerminals.find((terminal) => {
    const p = normalizeRepositoryRootForWorktrees(terminal?.repository?.path);
    return !!repoPathExplicit && !!p && p === repoPathExplicit;
  }) || mixedTerminals.find((terminal) => {
    const n = String(terminal?.repository?.name || '').trim().toLowerCase();
    return !!repoNameExplicit && !!n && n === repoNameExplicit;
  }) || mixedTerminals[0];

  const resolvedPath = repoPathExplicit
    || normalizeRepositoryRootForWorktrees(repoFromMixed?.repository?.path)
    || normalizeRepositoryRootForWorktrees(workspace?.repository?.path);

  const fallbackRepoName = (() => {
    if (!resolvedPath) return '';
    return path.basename(resolvedPath);
  })();

  return {
    repositoryPath: resolvedPath,
    repositoryName: String(repositoryName || repoFromMixed?.repository?.name || workspace?.repository?.name || fallbackRepoName || '').trim(),
    repositoryType: String(repositoryType || repoFromMixed?.repository?.type || workspace?.repository?.type || workspace?.type || 'generic').trim()
  };
}

function inferThreadSessionIds({ repositoryName, worktreeId } = {}) {
  const repo = String(repositoryName || '').trim();
  const worktree = String(worktreeId || '').trim();
  if (!worktree) return [];
  if (repo) return [`${repo}-${worktree}-claude`, `${repo}-${worktree}-server`];
  return [`${worktree}-claude`, `${worktree}-server`];
}

function pickExistingThreadWorktreeForRepository({ workspace, workspaceId, repositoryPath, repositoryName } = {}) {
  const resolvedWorkspaceId = String(workspaceId || workspace?.id || '').trim();
  if (!resolvedWorkspaceId || !workspace) return '';

  const activeThreads = threadService.list({
    workspaceId: resolvedWorkspaceId,
    status: 'active',
    includeArchived: true
  });
  const sessionEntries = sessionManager.getAllSessionEntries({ workspaceId: resolvedWorkspaceId });

  return pickReusableWorktreeId({
    workspace,
    repositoryPath,
    repositoryName,
    threadRows: activeThreads,
    sessionRows: sessionEntries
  });
}

async function ensureWorkspaceMixedWorktree({
  workspaceId,
  repositoryPath,
  repositoryType,
  repositoryName,
  worktreeId,
  socketId,
  startTier
} = {}) {
  const workspace = workspaceManager.getWorkspace(workspaceId);
  if (!workspace) {
    const error = new Error('Workspace not found');
    error.statusCode = 404;
    throw error;
  }

  const repoPath = normalizeRepositoryRootForWorktrees(repositoryPath);
  if (!repoPath) {
    const error = new Error('repositoryPath is required');
    error.statusCode = 400;
    throw error;
  }
  if (!fs.existsSync(repoPath)) {
    const error = new Error(`Repository path not found: ${repoPath}`);
    error.statusCode = 400;
    throw error;
  }
  // Support both master/ and main/ directory conventions
  let masterPath = path.join(repoPath, 'master');
  if (!fs.existsSync(masterPath)) {
    masterPath = path.join(repoPath, 'main');
  }
  if (!fs.existsSync(masterPath)) {
    const error = new Error(`Repository root is missing master/main directory: ${repoPath}. Clone your repo into a master/ or main/ subdirectory first.`);
    error.statusCode = 400;
    throw error;
  }

  const requestedWorktree = normalizeThreadWorktreeId(worktreeId);
  const reusableWorktree = requestedWorktree
    ? ''
    : pickExistingThreadWorktreeForRepository({
      workspace,
      workspaceId,
      repositoryPath: repoPath,
      repositoryName
    });
  const worktree = requestedWorktree
    || reusableWorktree
    || pickNextWorktreeIdForWorkspace(workspace, { repositoryPath: repoPath });
  const repoName = String(repositoryName || path.basename(repoPath)).trim();
  const repoType = String(repositoryType || workspace?.repository?.type || workspace?.type || 'generic').trim();
  const worktreePath = path.join(repoPath, worktree);
  const terminalIdBase = `${repoName}-${worktree}`;

  let updatedWorkspace = workspace;
  if (workspace.workspaceType !== 'mixed-repo') {
    const { convertSingleToMixed } = require('./workspaceSchemas');
    updatedWorkspace = convertSingleToMixed(workspace);
  }

  const newTerminals = [
    {
      id: `${terminalIdBase}-claude`,
      repository: {
        name: repoName,
        path: repoPath,
        type: repoType,
        masterBranch: 'master'
      },
      worktree: worktree,
      worktreePath,
      terminalType: 'claude',
      visible: true
    },
    {
      id: `${terminalIdBase}-server`,
      repository: {
        name: repoName,
        path: repoPath,
        type: repoType,
        masterBranch: 'master'
      },
      worktree: worktree,
      worktreePath,
      terminalType: 'server',
      visible: true
    }
  ];

  let alreadyExists = false;
  const terminalList = Array.isArray(updatedWorkspace.terminals) ? updatedWorkspace.terminals : [];
  const existingIds = new Set(terminalList.map((terminal) => terminal?.id));
  const missingTerminals = newTerminals.filter((terminal) => !existingIds.has(terminal.id));
  if (missingTerminals.length === 0) {
    alreadyExists = true;
  } else {
    updatedWorkspace.terminals = terminalList.concat(missingTerminals);
  }

  const tempWorkspace = {
    name: workspace.name || workspace.id || workspaceId,
    repository: { path: repoPath, masterBranch: 'master' },
    worktrees: { enabled: true, namingPattern: 'work{n}', autoCreate: true }
  };
  try {
    await worktreeHelper.createWorktree(tempWorkspace, worktree);
  } catch (error) {
    const message = String(error?.message || '').trim();
    const normalized = message.toLowerCase();
    const wrapped = new Error(message || 'Failed to prepare worktree');
    wrapped.statusCode = Number(error?.statusCode)
      || (
        normalized.includes('repository path')
        || normalized.includes('master directory not found')
        || normalized.includes('neither master nor main branch found')
        || normalized.includes('repository root is missing master directory')
        || normalized.includes('repository root is missing master/main directory')
        || normalized.includes('already exists')
        || normalized.includes('already checked out')
        || normalized.includes('invalid workspace config')
        || normalized.includes('workspace not found')
        || normalized.includes('failed to execute git command')
        || normalized.includes('git command failed')
        ? 400
        : 500
      );
    throw wrapped;
  }

  if (updatedWorkspace !== workspace || !alreadyExists) {
    try {
      await workspaceManager.updateWorkspace(workspaceId, updatedWorkspace);
    } catch (error) {
      const message = String(error?.message || '').trim();
      const normalized = message.toLowerCase();
      const wrapped = new Error(message || 'Failed to update workspace');
      wrapped.statusCode = Number(error?.statusCode)
        || (
          normalized.includes('invalid workspace config')
          || normalized.includes('workspace not found')
          ? 400
          : 500
        );
      throw wrapped;
    }
  }

  const refreshedWorkspace = workspaceManager.getWorkspace(workspaceId);
  const isActiveWorkspace = workspaceManager.getActiveWorkspace()?.id === workspaceId;

  let sessions = {};
  if (isActiveWorkspace) {
    sessionManager.setWorkspace(refreshedWorkspace);
    sessions = await sessionManager.createSessionsForWorktree({
      worktreeId: worktree,
      worktreePath,
      repositoryName: repoName,
      repositoryType: repoType,
      includeExistingSessions: true
    });
  }

  if (isActiveWorkspace) {
    const tier = Number(startTier);
    const payload = {
      worktreeId: worktree,
      sessions,
      workspaceId,
      startTier: (tier >= 1 && tier <= 4) ? tier : undefined
    };
    if (socketId && io.sockets.sockets.get(socketId)) io.to(socketId).emit('worktree-sessions-added', payload);
    else io.emit('worktree-sessions-added', payload);
  }

  return {
    workspace: refreshedWorkspace,
    alreadyExists,
    terminalIds: alreadyExists ? [] : missingTerminals.map((terminal) => terminal.id),
    sessions,
    worktreeId: worktree,
    worktreePath,
    repositoryName: repoName,
    repositoryType: repoType
  };
}

const batchLaunchService = BatchLaunchService.getInstance({
  taskTicketingService,
  workspaceManager,
  sessionManager,
  taskRecordService,
  userSettingsService,
  ensureWorkspaceMixedWorktree,
  io
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
    const { workspaceId, repositoryPath, repositoryType, repositoryName, worktreeId, socketId, startTier } = req.body || {};
    logger.info('Adding mixed worktree to workspace', { workspaceId, repositoryName, worktreeId });
    const result = await ensureWorkspaceMixedWorktree({
      workspaceId,
      repositoryPath,
      repositoryType,
      repositoryName,
      worktreeId,
      socketId,
      startTier
    });
    const tier = Number(startTier);
    res.json({
      success: true,
      alreadyExists: result.alreadyExists,
      terminalIds: result.terminalIds,
      sessions: result.sessions,
      worktreeId: result.worktreeId,
      worktreePath: result.worktreePath,
      startTier: (tier >= 1 && tier <= 4) ? tier : undefined
    });
  } catch (error) {
    const status = Number(error?.statusCode) || 500;
    logger.error('Failed to add mixed worktree', { error: error.message, stack: error.stack, status });
    res.status(status).json({ error: error.message, stack: error.stack });
  }
});

function parseClearSessionsInput(req) {
  const requested = req.body?.clearSessions;
  if (requested !== undefined) return requested;
  const fromQuery = req.query?.clearSessions;
  if (fromQuery === undefined || fromQuery === null) return undefined;
  const normalized = String(fromQuery).trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
  return undefined;
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function closeThreadSessions(sessionIds = []) {
  const ids = Array.isArray(sessionIds) ? sessionIds : [];
  const toClose = new Set();
  for (const sessionId of ids) {
    const groupIds = sessionManager.getSessionGroupIds(sessionId, {
      sessionTypes: ['claude', 'codex', 'server']
    });
    groupIds.forEach((id) => {
      const sid = String(id || '').trim();
      if (sid) toClose.add(sid);
    });
  }
  for (const sessionId of toClose) {
    const closingSession = sessionManager.getSessionById(sessionId);
    const closingWorkspaceId = closingSession?.workspace || null;
    const ok = sessionManager.closeSession(sessionId, {
      clearRecovery: true,
      workspaceId: closingWorkspaceId
    });
    if (ok) io.emit('session-closed', { sessionId, workspaceId: closingWorkspaceId });
  }
}

async function handleCreateThread(req, res) {
  try {
    const {
      workspaceId,
      repositoryPath,
      repositoryType,
      repositoryName,
      worktreeId,
      socketId,
      startTier,
      title,
      provider
    } = req.body || {};

    const workspaceIdValue = String(workspaceId || '').trim();
    if (!workspaceIdValue) {
      return res.status(400).json({ ok: false, error: 'workspaceId is required' });
    }

    const workspace = workspaceManager.getWorkspace(workspaceIdValue);
    if (!workspace) {
      return res.status(404).json({ ok: false, error: 'Workspace not found' });
    }

    const repoContext = resolveThreadRepositoryContext(workspace, { repositoryPath, repositoryName, repositoryType });
    if (!repoContext.repositoryPath) {
      return res.status(400).json({ ok: false, error: 'repositoryPath is required (or derivable from workspace)' });
    }

    const result = await ensureWorkspaceMixedWorktree({
      workspaceId: workspaceIdValue,
      repositoryPath: repoContext.repositoryPath,
      repositoryType: repoContext.repositoryType,
      repositoryName: repoContext.repositoryName,
      worktreeId,
      socketId,
      startTier
    });

    const activeSessionIds = Object.keys(result.sessions || {});
    const knownSessionIds = activeSessionIds.length
      ? activeSessionIds
      : inferThreadSessionIds({
        repositoryName: result.repositoryName,
        worktreeId: result.worktreeId
      }).filter((sessionId) => !!sessionManager.getSessionById(sessionId));

    const created = threadService.createThread({
      workspaceId: workspaceIdValue,
      title: String(title || `${result.repositoryName}/${result.worktreeId}`).trim(),
      worktreeId: result.worktreeId,
      worktreePath: result.worktreePath,
      sessionIds: knownSessionIds,
      provider: String(provider || 'claude').trim().toLowerCase() || 'claude',
      repositoryName: result.repositoryName,
      repositoryPath: repoContext.repositoryPath,
      repositoryType: result.repositoryType
    });

    const thread = knownSessionIds.length ? threadService.setSessionIds(created.id, knownSessionIds) : created;
    const tier = Number(startTier);

    res.json({
      ok: true,
      thread,
      sessions: result.sessions,
      alreadyExists: result.alreadyExists,
      worktreeId: result.worktreeId,
      worktreePath: result.worktreePath,
      startTier: (tier >= 1 && tier <= 4) ? tier : undefined
    });
  } catch (error) {
    const status = Number(error?.statusCode) || 500;
    logger.error('Failed to create thread', { error: error.message, stack: error.stack, status });
    res.status(status).json({ ok: false, error: 'Failed to create thread', message: error.message });
  }
}

app.get('/api/threads', (req, res) => {
  try {
    const workspaceId = String(req.query.workspaceId || '').trim();
    const status = String(req.query.status || '').trim().toLowerCase();
    const includeArchived = String(req.query.includeArchived || '').trim().toLowerCase() === 'true';
    const threads = threadService.list({ workspaceId, status, includeArchived });
    res.json({ ok: true, count: threads.length, threads });
  } catch (error) {
    logger.error('Failed to list threads', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to list threads', message: error.message });
  }
});

app.get('/api/thread-projects', (req, res) => {
  try {
    const workspaceId = String(req.query.workspaceId || '').trim();
    const includeArchived = String(req.query.includeArchived || '').trim().toLowerCase() === 'true';
    const projects = threadService.listProjects({ workspaceId, includeArchived });
    res.json({ ok: true, count: projects.length, projects });
  } catch (error) {
    logger.error('Failed to list thread projects', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to list thread projects', message: error.message });
  }
});

app.post('/api/threads', express.json(), handleCreateThread);
app.post('/api/threads/create', express.json(), handleCreateThread);

app.patch('/api/threads/:id', express.json(), (req, res) => {
  try {
    const threadId = String(req.params.id || '').trim();
    if (!threadId) {
      return res.status(400).json({ ok: false, error: 'thread id is required' });
    }
    const before = threadService.getById(threadId);
    if (!before) {
      return res.status(404).json({ ok: false, error: 'Failed to update thread', message: `Thread not found: ${threadId}` });
    }

    const patch = {};
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'title')) {
      patch.title = String(req.body?.title || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'sessionIds')) {
      patch.sessionIds = Array.isArray(req.body?.sessionIds) ? req.body.sessionIds : [];
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'metadata') && req.body?.metadata && typeof req.body.metadata === 'object') {
      patch.metadata = req.body.metadata;
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'provider')) {
      patch.provider = String(req.body?.provider || '').trim().toLowerCase() || before.provider || 'claude';
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'status')) {
      const nextStatus = String(req.body?.status || '').trim().toLowerCase();
      if (!['active', 'closed', 'archived'].includes(nextStatus)) {
        return res.status(400).json({ ok: false, error: 'Invalid status. Use active|closed|archived' });
      }
      patch.status = nextStatus;
    }

    let thread = threadService.updateThread(threadId, patch);
    const requested = parseClearSessionsInput(req);
    const transition = String(patch.status || '').trim().toLowerCase();
    const shouldClose = requested === true
      || (transition === 'closed' && shouldCloseSessionsForThreadAction('close', requested))
      || (transition === 'archived' && shouldCloseSessionsForThreadAction('archive', requested));
    if (shouldClose) {
      closeThreadSessions(before.sessionIds);
      thread = threadService.setSessionIds(threadId, []);
    }

    res.json({
      ok: true,
      thread,
      lifecycle: {
        action: 'update-thread',
        closedSessions: !!shouldClose
      }
    });
  } catch (error) {
    const message = String(error?.message || error);
    const status = message.toLowerCase().includes('not found') ? 404 : 500;
    logger.error('Failed to update thread', { error: message, stack: error.stack, status });
    res.status(status).json({ ok: false, error: 'Failed to update thread', message });
  }
});

app.post('/api/threads/:id/close', express.json(), (req, res) => {
  try {
    const threadId = String(req.params.id || '').trim();
    if (!threadId) {
      return res.status(400).json({ ok: false, error: 'thread id is required' });
    }
    const closeSessions = shouldCloseSessionsForThreadAction('close', parseClearSessionsInput(req));
    let thread = threadService.closeThread(threadId);
    if (closeSessions) {
      closeThreadSessions(thread.sessionIds);
      thread = threadService.setSessionIds(threadId, []);
    }
    res.json({
      ok: true,
      thread,
      lifecycle: {
        action: 'close-thread',
        closedSessions: !!closeSessions
      }
    });
  } catch (error) {
    const message = String(error?.message || error);
    const status = message.toLowerCase().includes('not found') ? 404 : 500;
    logger.error('Failed to close thread', { error: message, stack: error.stack, status });
    res.status(status).json({ ok: false, error: 'Failed to close thread', message });
  }
});

function handleArchiveThread(req, res, { sourceAction = 'archive-thread' } = {}) {
  try {
    const threadId = String(req.params.id || '').trim();
    if (!threadId) {
      return res.status(400).json({ ok: false, error: 'thread id is required' });
    }
    const closeSessions = shouldCloseSessionsForThreadAction('archive', parseClearSessionsInput(req));
    const before = threadService.getById(threadId);
    if (!before) {
      return res.status(404).json({ ok: false, error: 'Failed to archive thread', message: `Thread not found: ${threadId}` });
    }

    let thread = threadService.archiveThread(threadId);
    if (closeSessions) {
      closeThreadSessions(before.sessionIds);
      thread = threadService.setSessionIds(threadId, []);
    }
    res.json({
      ok: true,
      thread,
      lifecycle: {
        action: sourceAction,
        closedSessions: !!closeSessions
      }
    });
  } catch (error) {
    const message = String(error?.message || error);
    const status = message.toLowerCase().includes('not found') ? 404 : 500;
    logger.error('Failed to archive thread', { error: message, stack: error.stack, status });
    res.status(status).json({ ok: false, error: 'Failed to archive thread', message });
  }
}

app.post('/api/threads/:id/archive', express.json(), (req, res) => handleArchiveThread(req, res, { sourceAction: 'archive-thread' }));
app.delete('/api/threads/:id', express.json(), (req, res) => handleArchiveThread(req, res, { sourceAction: 'delete-thread' }));

// Remove worktree from workspace (config only - does NOT delete git worktree folder)
app.post('/api/workspaces/remove-worktree', requirePolicyAction('destructive'), async (req, res) => {
  try {
    const { workspaceId, worktreeId, repositoryName } = req.body;
    logger.info('Removing worktree from workspace configuration (keeping folder intact)', { workspaceId, worktreeId, repositoryName });

    const workspace = workspaceManager.getWorkspace(workspaceId);
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    // IMPORTANT: This only removes the worktree from the workspace configuration.
    // The actual git worktree folder and all its files remain untouched on disk.
    // This allows users to safely remove a worktree from the UI without losing work.

    const parsedWorktree = parseWorktreeKey(worktreeId);

    // Remove terminals associated with this worktree from configuration
    const updatedWorkspace = { ...workspace };
    const terminalsListMode = Array.isArray(updatedWorkspace.terminals);
    const terminalsPairsArrayMode = Array.isArray(updatedWorkspace?.terminals?.pairs);
    const originalTerminals = terminalsListMode
      ? updatedWorkspace.terminals
      : (terminalsPairsArrayMode ? updatedWorkspace.terminals.pairs : []);
    const originalTerminalCount = originalTerminals.length;
    const removedTerminalIds = [];

    const repoNameNorm = repositoryName ? String(repositoryName).trim().toLowerCase() : null;

    const terminalMatchesScope = (terminal) => {
      // If repositoryName was provided, only match terminals belonging to that repo
      if (repoNameNorm) {
        const termRepo = String(terminal?.repository?.name || '').trim().toLowerCase();
        if (termRepo) return termRepo === repoNameNorm;
        // Fall back to checking terminal ID prefix (e.g. "fps-level-design-work1-claude")
        const sid = String(terminal?.id || '').trim().toLowerCase();
        return sid.startsWith(`${repoNameNorm}-`);
      }
      return true;
    };

    let nextTerminals = originalTerminals.filter((terminal) => {
      const matched = terminalMatchesWorktree(terminal, parsedWorktree) && terminalMatchesScope(terminal);
      if (matched && terminal?.id) removedTerminalIds.push(String(terminal.id));
      return !matched;
    });

    // Defensive fallback for older terminal configs where id/worktree metadata is inconsistent.
    if (nextTerminals.length === originalTerminalCount) {
      const keyExpr = parsedWorktree.key ? new RegExp(`(^|[-_/])${escapeRegex(parsedWorktree.key)}($|[-_/])`, 'i') : null;
      const worktreeExpr = parsedWorktree.worktreeId ? new RegExp(`(^|[-_/])${escapeRegex(parsedWorktree.worktreeId)}($|[-_/])`, 'i') : null;
      nextTerminals = originalTerminals.filter((terminal) => {
        const sid = String(terminal?.id || '').trim().toLowerCase();
        const fallbackMatch = (
          sid === parsedWorktree.key
          || (parsedWorktree.key && sid.includes(`${parsedWorktree.key}-`))
          || (parsedWorktree.worktreeId && sid.includes(`-${parsedWorktree.worktreeId}-`))
          || (!!keyExpr && keyExpr.test(sid))
          || (!!worktreeExpr && worktreeExpr.test(sid))
        );
        if (!fallbackMatch) return true;
        if (!terminalMatchesScope(terminal)) return true;
        if (terminal?.id) removedTerminalIds.push(String(terminal.id));
        return false;
      });
    }

    if (terminalsListMode) {
      updatedWorkspace.terminals = nextTerminals;
    } else if (terminalsPairsArrayMode) {
      updatedWorkspace.terminals = {
        ...updatedWorkspace.terminals,
        pairs: nextTerminals
      };
    }

    const dedupedRemovedTerminalIds = Array.from(new Set(removedTerminalIds));

    let removedCount = originalTerminalCount - nextTerminals.length;

    // Single-repo workspaces typically store a numeric terminals.pairs count instead of terminal entries.
    // Support removing by worktree number in that mode.
    const numericPairs = Number(updatedWorkspace?.terminals?.pairs);
    if (removedCount === 0 && !terminalsListMode && !terminalsPairsArrayMode && Number.isFinite(numericPairs) && numericPairs > 0) {
      const worktreeToken = String(parsedWorktree.worktreeId || parsedWorktree.key || '').trim();
      const match = worktreeToken.match(/work(\d+)/i);
      const worktreeNum = match ? Number(match[1]) : NaN;
      if (Number.isFinite(worktreeNum) && worktreeNum >= 1 && worktreeNum <= numericPairs) {
        updatedWorkspace.terminals = {
          ...(updatedWorkspace.terminals || {}),
          pairs: Math.max(0, numericPairs - 1)
        };
        removedCount = 1;
      }
    }

    // Close associated sessions even when this workspace isn't currently active.
    // This prevents orphan PTYs/recovery entries when users manage worktrees from other tabs/views.
    const relatedSessionIds = new Set(
      sessionManager.getSessionIdsForWorktree({
        workspaceId,
        worktreeKey: parsedWorktree.key || parsedWorktree.worktreeId
      })
    );
    let recoveryMatchedSessionIds = [];
    try {
      await sessionRecoveryService.loadWorkspaceState(workspaceId);
      const recoverySessions = sessionRecoveryService.getAllSessions(workspaceId);
      recoveryMatchedSessionIds = Object.entries(recoverySessions || {})
        .filter(([sid, record]) => sessionRecordMatchesWorktree(sid, record, parsedWorktree))
        .map(([sid]) => String(sid || '').trim())
        .filter(Boolean);
    } catch {
      recoveryMatchedSessionIds = [];
    }

    const shouldCleanupOrphans = relatedSessionIds.size > 0 || recoveryMatchedSessionIds.length > 0;
    if (removedCount === 0 && !shouldCleanupOrphans) {
      return res.status(404).json({ error: 'Worktree not found in workspace' });
    }

    // Save updated workspace configuration only when terminals were removed from config.
    if (removedCount > 0) {
      await workspaceManager.updateWorkspace(workspaceId, updatedWorkspace);
    }

    const uniqueSessionIds = Array.from(new Set([
      ...(dedupedRemovedTerminalIds || []),
      ...Array.from(relatedSessionIds),
      ...(recoveryMatchedSessionIds || [])
    ]));

    // Always clear recovery entries for all matched sessions (even if the workspace isn't active).
    for (const sid of uniqueSessionIds) {
      if (!sid) continue;
      try {
        sessionRecoveryService.clearSession(workspaceId, sid);
      } catch {
        // best-effort
      }
    }

    uniqueSessionIds.forEach((sessionId) => {
      const closingSession = sessionManager.getSessionById(sessionId);
      const closingWorkspaceId = closingSession?.workspace || null;
      const ok = sessionManager.closeSession(sessionId, {
        clearRecovery: true,
        workspaceId: closingWorkspaceId
      });
      if (ok) io.emit('session-closed', { sessionId, workspaceId: closingWorkspaceId });
    });

    const removedSessionIdSet = new Set(
      uniqueSessionIds
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    );

    // Sync thread records tied to this worktree so they don't keep stale session references.
    let updatedThreadCount = 0;
    try {
      const candidateThreads = threadService.list({ workspaceId, includeArchived: true });
      for (const thread of candidateThreads) {
        const threadSessionIds = Array.isArray(thread?.sessionIds)
          ? thread.sessionIds.map((sid) => String(sid || '').trim()).filter(Boolean)
          : [];
        const sessionMatched = threadSessionIds.some((sid) => removedSessionIdSet.has(sid));

        const threadWorktree = String(thread?.worktreeId || '').trim().toLowerCase();
        const threadRepo = String(thread?.repositoryName || '').trim().toLowerCase();
        const worktreeMatched = !!threadWorktree && (
          threadWorktree === parsedWorktree.worktreeId
          || threadWorktree === parsedWorktree.key
        );
        const repoMatched = !parsedWorktree.repositoryName || !threadRepo || threadRepo === parsedWorktree.repositoryName;
        if (!sessionMatched && (!worktreeMatched || !repoMatched)) continue;
        const nextPatch = (String(thread?.status || '').trim().toLowerCase() === 'archived')
          ? { sessionIds: [] }
          : { status: 'closed', sessionIds: [] };
        threadService.updateThread(thread.id, nextPatch);
        updatedThreadCount += 1;
      }
    } catch {
      // best-effort
    }

    // If this is the active workspace, refresh SessionManager's workspace reference.
    if (workspaceManager.getActiveWorkspace()?.id === workspaceId) {
      const previousFlag = sessionManager.isWorkspaceSwitching;
      sessionManager.isWorkspaceSwitching = true;
      try {
        const refreshedWorkspace = workspaceManager.getWorkspace(workspaceId);
        sessionManager.setWorkspace(refreshedWorkspace);
      } finally {
        sessionManager.isWorkspaceSwitching = previousFlag;
      }
    }

    logger.info('Worktree removed from workspace configuration (folder preserved)', {
      workspaceId,
      worktreeId,
      removedTerminals: removedCount,
      orphanCleanupOnly: removedCount === 0,
      closedSessions: uniqueSessionIds.length,
      updatedThreads: updatedThreadCount
    });

    res.json({
      success: true,
      removedTerminals: removedCount,
      closedSessions: uniqueSessionIds.length,
      removedSessionIds: uniqueSessionIds,
      updatedThreads: updatedThreadCount,
      lifecycle: {
        action: 'remove-worktree',
        policy: getLifecyclePolicy().actions.removeWorktreeFromWorkspace
      },
      updatedWorkspace: updatedWorkspace
    });

  } catch (error) {
    logger.error('Failed to remove worktree from workspace', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

app.get('/api/workspaces/deleted', async (req, res) => {
  try {
    const deletedWorkspaces = await workspaceManager.listDeletedWorkspaces();
    res.json(deletedWorkspaces);
  } catch (error) {
    logger.error('Failed to list deleted workspaces', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

app.post('/api/workspaces/deleted/:deletedId/restore', async (req, res) => {
  try {
    const deletedId = req.params.deletedId;
    const workspace = await workspaceManager.restoreWorkspace(deletedId);
    const workspaces = await workspaceManager.listWorkspacesEnriched();
    io.emit('workspaces-list', workspaces);
    res.json({ ok: true, workspace });
  } catch (error) {
    logger.error('Failed to restore workspace', { error: error.message, stack: error.stack });
    res.status(400).json({ error: error.message, stack: error.stack });
  }
});

app.delete('/api/workspaces/deleted/:deletedId', async (req, res) => {
  try {
    const deletedId = req.params.deletedId;
    const deletedWorkspace = await workspaceManager.permanentlyDeleteDeletedWorkspace(deletedId);
    res.json({
      ok: true,
      deletedWorkspace: {
        ...(deletedWorkspace?.workspace || {}),
        deletedId: deletedWorkspace?.deletedId || null,
        deletedAt: deletedWorkspace?.deletedAt || null
      }
    });
  } catch (error) {
    const status = Number(error?.statusCode) || 400;
    logger.error('Failed to permanently delete archived workspace', {
      error: error.message,
      stack: error.stack,
      deletedId: req.params.deletedId
    });
    res.status(status).json({ ok: false, error: error.message, stack: error.stack });
  }
});

app.delete('/api/workspaces/deleted', async (req, res) => {
  try {
    const result = await workspaceManager.permanentlyDeleteAllDeletedWorkspaces();
    res.json({
      ok: true,
      deletedCount: Number(result?.deletedCount || 0),
      deletedWorkspaces: Array.isArray(result?.deletedWorkspaces)
        ? result.deletedWorkspaces.map((entry) => ({
          ...(entry?.workspace || {}),
          deletedId: entry?.deletedId || null,
          deletedAt: entry?.deletedAt || null
        }))
        : []
    });
  } catch (error) {
    logger.error('Failed to permanently delete all archived workspaces', {
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ ok: false, error: error.message, stack: error.stack });
  }
});

// Delete workspace
app.delete('/api/workspaces/:id', async (req, res) => {
  try {
    const workspaceId = req.params.id;
    logger.info('Deleting workspace', { workspaceId });

    const closedSessions = sessionManager.cleanupWorkspaceSessions(workspaceId, { clearRecovery: true });
    if (workspaceManager.activeWorkspace?.id === workspaceId) {
      sessionManager.setWorkspace(null);
      workspaceManager.activeWorkspace = null;
    }

    // Delete the workspace
    const deletedWorkspaceEntry = await workspaceManager.deleteWorkspace(workspaceId);
    const workspaces = await workspaceManager.listWorkspacesEnriched();
    io.emit('workspaces-list', workspaces);

    res.json({
      success: true,
      closedSessions,
      deletedWorkspace: {
        ...(deletedWorkspaceEntry?.workspace || {}),
        deletedId: deletedWorkspaceEntry?.deletedId || null,
        deletedAt: deletedWorkspaceEntry?.deletedAt || null,
        restoreAvailable: true
      }
    });
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
const gitUpdateService = GitUpdateService.getInstance();
const taskTicketMoveService = TaskTicketMoveService.getInstance({
  taskRecordService,
  taskTicketingService,
  userSettingsService
});
const prMergeAutomationService = PrMergeAutomationService.getInstance({
  taskRecordService,
  pullRequestService,
  taskTicketingService,
  userSettingsService
});

const prReviewAutomationService = PrReviewAutomationService.getInstance({
  taskRecordService,
  pullRequestService,
  userSettingsService,
  sessionManager,
  workspaceManager,
  ensureWorkspaceMixedWorktree,
  io
});

// Register pr-review-poll command so the scheduler can invoke it
commandRegistry.register('pr-review-poll', {
  category: 'process',
  description: 'Scan for new PRs and completed reviews, auto-spawn reviewer agents',
  params: [],
  examples: [],
  handler: async () => {
    const result = await prReviewAutomationService.poll();
    return { message: `PR review poll: ${result.newPrs || 0} new PRs, ${result.reviewsProcessed || 0} reviews, ${result.agentsSpawned || 0} agents spawned` };
  }
});

// Start background automations (best-effort; gated by user settings)
prMergeAutomationService.start();
prReviewAutomationService.start();

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

    const action = String(req.body?.action || '').trim().toLowerCase();
    const repoOwner = req.body?.repository?.owner?.login || req.body?.repository?.owner?.name || '';
    const repoName = req.body?.repository?.name || '';

    // Handle pull_request_review events (review submitted)
    if (event === 'pull_request_review') {
      const review = req.body?.review || null;
      const pr = req.body?.pull_request || null;
      if (!review || !pr) return res.status(400).json({ error: 'Missing review or pull_request payload' });

      if (action === 'submitted') {
        const result = await prReviewAutomationService.onReviewSubmitted({
          owner: repoOwner,
          repo: repoName,
          number: pr.number,
          reviewState: review.state || '',
          reviewBody: review.body || '',
          reviewUser: review.user?.login || '',
          url: pr.html_url || pr.url || ''
        });
        return res.json({ ok: true, event, verified: sig.verified, action, result });
      }
      return res.json({ ok: true, event, ignored: true, verified: sig.verified, action });
    }

    if (event !== 'pull_request') {
      return res.json({ ok: true, event, ignored: true, verified: sig.verified });
    }

    const pr = req.body?.pull_request || null;
    if (!pr) return res.status(400).json({ error: 'Missing pull_request payload' });

    // Handle PR opened / ready_for_review → auto-review pipeline
    if (action === 'opened' || action === 'ready_for_review') {
      const result = await prReviewAutomationService.onPrCreated({
        owner: repoOwner,
        repo: repoName,
        number: pr.number,
        title: pr.title || '',
        author: pr.user?.login || '',
        url: pr.html_url || pr.url || '',
        action
      });
      return res.json({ ok: true, event, verified: sig.verified, action, result });
    }

    // Handle PR closed + merged → existing merge automation
    const merged = !!pr.merged;
    const mergedAt = pr.merged_at || null;
    if (action !== 'closed' || !merged) {
      return res.json({ ok: true, event, ignored: true, verified: sig.verified, action, merged });
    }

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
      lastRunAt: prMergeAutomationService.lastRunAt || null,
      prReview: prReviewAutomationService.getStatus()
    });
  } catch (error) {
    logger.error('Failed to get automations status', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to get automations status' });
  }
});

app.post('/api/process/automations/pr-merge/run', requirePolicyAction('destructive'), proOnly, express.json(), async (req, res) => {
  try {
    const limit = Number(req.body?.limit || 60);
    const result = await prMergeAutomationService.runOnce({ limit });
    res.json(result);
  } catch (error) {
    logger.error('Failed to run PR merge automations', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message || 'Failed to run PR merge automations' });
  }
});

// PR review automation endpoints
app.post('/api/process/automations/pr-review/run', express.json(), async (req, res) => {
  try {
    const result = await prReviewAutomationService.runManual();
    res.json(result);
  } catch (error) {
    logger.error('Failed to run PR review automation', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message || 'Failed to run PR review automation' });
  }
});

app.get('/api/process/automations/pr-review/status', (req, res) => {
  try {
    res.json(prReviewAutomationService.getStatus());
  } catch (error) {
    logger.error('Failed to get PR review status', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message || 'Failed to get PR review status' });
  }
});

app.put('/api/process/automations/pr-review/config', express.json(), async (req, res) => {
  try {
    const config = prReviewAutomationService.updateConfig(req.body || {});
    // Restart polling if config changed
    prReviewAutomationService.stop();
    prReviewAutomationService.start();
    res.json({ ok: true, config });
  } catch (error) {
    logger.error('Failed to update PR review config', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message || 'Failed to update PR review config' });
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

// License (local/offline)
app.get('/api/license/status', (req, res) => {
  try {
    const requiredRaw = String(process.env.ORCHESTRATOR_LICENSE_REQUIRED || '').trim().toLowerCase();
    const required = requiredRaw ? !['0', 'false', 'no', 'off'].includes(requiredRaw) : false;

    const status = licenseService.getStatus();
    const entitlements = licenseService.getEntitlements();
    res.json({
      required,
      status,
      entitlements,
      licensePath: licenseService.getLicensePath(),
      publicKeyConfigured: !!licenseService.readPublicKeyPem()
    });
  } catch (error) {
    logger.error('Failed to get license status', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to get license status' });
  }
});

app.post('/api/license/reload', (req, res) => {
  try {
    const status = licenseService.getStatus({ forceReload: true });
    res.json({ ok: true, status });
  } catch (error) {
    logger.error('Failed to reload license', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to reload license' });
  }
});

// Save license.json (paste into UI); stored in ORCHESTRATOR_DATA_DIR by default.
app.post('/api/license/set', requirePolicyAction('billing'), express.json({ limit: '2mb' }), (req, res) => {
  try {
    let payload = req.body;
    if (payload && typeof payload.text === 'string') {
      payload = JSON.parse(payload.text);
    }

    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'Missing license payload' });
    }
    if (!payload.license) {
      return res.status(400).json({ error: 'Missing license object (expected { license, signature })' });
    }

    const result = licenseService.saveLicenseFile(payload);
    if (!result.ok) {
      return res.status(500).json({ error: result.error || 'Failed to save license' });
    }

    const status = licenseService.getStatus({ forceReload: true });
    res.json({ ok: true, status, path: result.path });
  } catch (error) {
    logger.error('Failed to set license', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message || 'Failed to set license' });
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

app.post('/api/git/pull', requirePolicyAction('destructive'), (req, res) => {
  activityFeed.track('git.pull', { source: 'api' });
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

// Diagnostics (cross-platform dependency + environment checks)
app.get('/api/diagnostics', async (req, res) => {
  try {
    const data = await collectDiagnostics();
    res.json({ ok: true, ...data });
  } catch (error) {
    logger.error('Failed to collect diagnostics', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to collect diagnostics' });
  }
});

app.get('/api/diagnostics/first-run', async (req, res) => {
  try {
    const data = await collectFirstRunDiagnostics();
    res.json({ ok: true, ...data });
  } catch (error) {
    logger.error('Failed to collect first-run diagnostics', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to collect first-run diagnostics' });
  }
});

app.get('/api/diagnostics/install-wizard', async (req, res) => {
  try {
    const data = await collectInstallWizard();
    res.json({ ok: true, ...data });
  } catch (error) {
    logger.error('Failed to collect install wizard diagnostics', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to collect install wizard diagnostics' });
  }
});

app.get('/api/diagnostics/post-install', async (req, res) => {
  try {
    const data = await collectInstallWizard();
    res.json({ ok: true, ...data });
  } catch (error) {
    logger.error('Failed to collect post-install diagnostics', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to collect post-install diagnostics' });
  }
});

app.post('/api/diagnostics/first-run/repair', requirePolicyAction('write'), express.json(), async (req, res) => {
  try {
    const action = String(req.body?.action || '').trim();
    if (!action) {
      return res.status(400).json({ ok: false, error: 'action is required' });
    }

    const repair = await runFirstRunRepair({ action });
    const diagnostics = await collectFirstRunDiagnostics();
    res.json({ ok: true, repair, diagnostics });
  } catch (error) {
    logger.error('Failed to run first-run repair', {
      error: error.message,
      stack: error.stack,
      action: String(req.body?.action || '').trim() || null
    });
    res.status(400).json({ ok: false, error: String(error?.message || 'Failed to run repair') });
  }
});

app.post('/api/diagnostics/first-run/repair-safe', requirePolicyAction('write'), async (req, res) => {
  try {
    const result = await runFirstRunSafeRepairs();
    res.json({ ok: true, ...result });
  } catch (error) {
    logger.error('Failed to run first-run safe repairs', {
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ ok: false, error: String(error?.message || 'Failed to run safe repairs') });
  }
});

app.get('/api/lifecycle/policy', (req, res) => {
  try {
    res.json({ ok: true, policy: getLifecyclePolicy() });
  } catch (error) {
    logger.error('Failed to load lifecycle policy', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to load lifecycle policy' });
  }
});

// Setup helper actions for first-run dependency wizard.
app.get('/api/setup-actions', (req, res) => {
  try {
    const platform = process.platform;
    const actions = getSetupActions(platform);
    res.json({ ok: true, platform, actions });
  } catch (error) {
    logger.error('Failed to get setup actions', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to get setup actions' });
  }
});

app.get('/api/setup-actions/state', (req, res) => {
  try {
    const state = onboardingStateService.getDependencySetupState();
    res.json({ ok: true, state });
  } catch (error) {
    logger.error('Failed to get setup action state', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to get setup action state' });
  }
});

app.put('/api/setup-actions/state', express.json(), (req, res) => {
  try {
    const patch = (req.body && typeof req.body === 'object') ? req.body : {};
    const state = onboardingStateService.updateDependencySetupState(patch);
    res.json({ ok: true, state });
  } catch (error) {
    logger.error('Failed to update setup action state', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to update setup action state' });
  }
});

app.post('/api/setup-actions/run', requirePolicyAction('write'), express.json(), (req, res) => {
  try {
    const actionId = String(req.body?.actionId || '').trim();
    if (!actionId) {
      return res.status(400).json({ ok: false, error: 'actionId is required' });
    }

    const result = runSetupAction(actionId, process.platform);
    res.json({ ok: true, ...result });
  } catch (error) {
    const code = String(error?.code || '');
    const status = (code === 'unsupported_platform' || code === 'unknown_action' || code === 'not_runnable') ? 400 : 500;
    logger.error('Failed to run setup action', { actionId: req.body?.actionId, error: error.message, stack: error.stack });
    res.status(status).json({ ok: false, error: String(error?.message || 'Failed to run setup action') });
  }
});

app.post('/api/setup-actions/configure-git-identity', requirePolicyAction('write'), express.json(), async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim();
    const result = await configureGitIdentity({ name, email }, process.platform);
    res.json({ ok: true, ...result });
  } catch (error) {
    const code = String(error?.code || '');
    const status = (
      code === 'unsupported_platform'
      || code === 'invalid_input'
      || code === 'missing_git'
      || code === 'verify_failed'
    ) ? 400 : 500;
    logger.error('Failed to configure git identity', {
      error: error.message,
      stack: error.stack
    });
    res.status(status).json({ ok: false, error: String(error?.message || 'Failed to configure git identity') });
  }
});

app.get('/api/setup-actions/run-status', (req, res) => {
  try {
    const runId = String(req.query?.runId || '').trim();
    const actionId = String(req.query?.actionId || '').trim();
    const run = runId ? getSetupActionRun(runId) : getLatestSetupActionRun(actionId);
    if (!run) {
      return res.status(404).json({ ok: false, error: 'Setup action run not found' });
    }
    res.json({ ok: true, run });
  } catch (error) {
    logger.error('Failed to get setup action run status', {
      runId: req.query?.runId,
      actionId: req.query?.actionId,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ ok: false, error: 'Failed to get setup action run status' });
  }
});

app.post('/api/setup-actions/open-url', requirePolicyAction('write'), express.json(), (req, res) => {
  try {
    const rawUrl = String(req.body?.url || '').trim();
    if (!rawUrl) {
      return res.status(400).json({ ok: false, error: 'url is required' });
    }

    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return res.status(400).json({ ok: false, error: 'Invalid URL' });
    }

    if (!['http:', 'https:'].includes(String(parsed.protocol || '').toLowerCase())) {
      return res.status(400).json({ ok: false, error: 'Only http/https URLs are supported' });
    }

    const targetUrl = parsed.toString();
    const { execFile } = require('child_process');

    const finish = (error) => {
      if (error) {
        logger.error('Failed to open setup URL', { url: targetUrl, error: error.message, stack: error.stack });
        return res.status(500).json({ ok: false, error: 'Failed to open URL' });
      }
      res.json({ ok: true, opened: targetUrl });
    };

    if (process.platform === 'win32') {
      const path = require('path');
      const systemRoot = String(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows').trim() || 'C:\\Windows';
      const explorerPath = path.join(systemRoot, 'explorer.exe');
      const cmdPath = path.join(systemRoot, 'System32', 'cmd.exe');

      const attempts = [
        { file: explorerPath, args: [targetUrl] },
        { file: cmdPath, args: ['/c', 'start', '', targetUrl] }
      ];

      const tryOpen = (index, lastError) => {
        const attempt = attempts[index];
        if (!attempt) return finish(lastError || new Error('Failed to open URL'));
        execFile(attempt.file, attempt.args, { windowsHide: true }, (error) => {
          if (!error) return finish(null);
          tryOpen(index + 1, error);
        });
      };

      tryOpen(0, null);
      return;
    }

    if (process.platform === 'darwin') {
      execFile('open', [targetUrl], { windowsHide: true }, finish);
      return;
    }

    execFile('xdg-open', [targetUrl], { windowsHide: true }, finish);
  } catch (error) {
    logger.error('Failed to open setup URL', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to open URL' });
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
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', winPath,
        '-DesktopShortcut'
      ], getHiddenProcessOptions({
        timeout: 30000,
        env: augmentProcessEnv(process.env)
      }));

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
    const workspace = workspaceManager.getWorkspace(workspaceId);
    const allowSessionIds = (() => {
      if (!workspace) return [];
      // Mixed-repo and newer configs: explicit terminal array.
      if (Array.isArray(workspace.terminals)) {
        return workspace.terminals
          .filter((t) => t && typeof t === 'object' && t.visible !== false)
          .map((t) => String(t.id || '').trim())
          .filter(Boolean);
      }
      // Legacy single-repo config: `terminals: { pairs: N }`
      const pairs = Number(workspace?.terminals?.pairs || 0);
      if (Number.isFinite(pairs) && pairs > 0 && pairs < 200) {
        const ids = [];
        for (let i = 1; i <= pairs; i += 1) {
          ids.push(`work${i}-claude`, `work${i}-server`, `work${i}-codex`);
        }
        return ids;
      }
      return [];
    })();

    const recoveryInfo = await sessionRecoveryService.getRecoveryInfo(workspaceId, {
      allowSessionIds: allowSessionIds.length ? allowSessionIds : null,
      pruneMissing: true
    });
    const pendingRecoverySessions = Array.isArray(recoveryInfo?.sessions)
      ? recoveryInfo.sessions.filter((entry) => {
          const sessionId = String(entry?.sessionId || '').trim();
          if (!sessionId) return false;
          return !sessionManager.hasSessionHydrated(sessionId, { workspaceId });
        })
      : [];

    let configuredWorktreeCount = 0;
    if (workspace) {
      if (Array.isArray(workspace.terminals)) {
        const keys = new Set();
        workspace.terminals
          .filter((t) => t && typeof t === 'object' && t.visible !== false)
          .forEach((t) => {
            const repo = String(t?.repository?.name || '').trim().toLowerCase();
            const wt = String(t?.worktree || '').trim().toLowerCase();
            const key = repo && wt ? `${repo}-${wt}` : wt || String(t?.id || '').trim().toLowerCase();
            if (key) keys.add(key);
          });
        configuredWorktreeCount = keys.size;
      } else {
        const pairs = Number(workspace?.terminals?.pairs || 0);
        if (Number.isFinite(pairs) && pairs > 0) configuredWorktreeCount = pairs;
      }
    }

    res.json({
      ...recoveryInfo,
      recoverableSessions: pendingRecoverySessions.length,
      sessions: pendingRecoverySessions,
      configuredTerminalCount: allowSessionIds.length,
      configuredWorktreeCount,
      recoveryAlreadyAppliedCount: Math.max(
        0,
        Number(recoveryInfo?.recoverableSessions || 0) - pendingRecoverySessions.length
      )
    });
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

app.delete('/api/recovery/:workspaceId/:sessionId', async (req, res) => {
  try {
    const { workspaceId, sessionId } = req.params;
    await sessionRecoveryService.loadWorkspaceState(workspaceId);
    sessionRecoveryService.clearSession(workspaceId, String(sessionId || '').trim());
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to clear session recovery state', { error: error.message });
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

// Prune old recovery sessions (hygiene): removes entries older than N days.
app.post('/api/recovery/:workspaceId/prune', express.json(), async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const rawDays =
      (req.body && (req.body.olderThanDays ?? req.body.days))
      ?? req.query.olderThanDays
      ?? req.query.days;
    const days = Math.max(1, Math.min(365, Number(rawDays)));
    if (!Number.isFinite(days)) {
      return res.status(400).json({ success: false, error: 'olderThanDays must be a number (1..365)' });
    }

    await sessionRecoveryService.loadWorkspaceState(workspaceId);
    const prunedCount = sessionRecoveryService.pruneOlderThan(workspaceId, {
      olderThanMs: Math.round(days * 24 * 60 * 60 * 1000)
    });

    res.json({ success: true, prunedCount, olderThanDays: days });
  } catch (error) {
    logger.error('Failed to prune recovery state', { error: error.message });
    res.status(500).json({ success: false, error: error.message || 'Failed to prune recovery state' });
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
  const categories = projectTypeService.getCategories().map((cat) => ({
    id: cat.id,
    path: cat.basePathResolved || cat.basePath || '',
    keywords: Array.isArray(cat.keywords) ? cat.keywords : []
  }));
  res.json(categories);
});

// Detect category from description
app.post('/api/greenfield/detect-category', (req, res) => {
  const { description } = req.body;
  if (!description) {
    return res.status(400).json({ error: 'description is required' });
  }
  const category = projectTypeService.detectCategory(description);
  const categoryConfig = projectTypeService.getCategoryById(category);
  res.json({
    category,
    path: categoryConfig?.basePathResolved || categoryConfig?.basePath || ''
  });
});

// ============================================
// Agent Provider API
// ============================================

function mapAgentProviderError(error, fallbackStatus = 500) {
  const code = String(error?.code || '').trim().toUpperCase();
  if (code === 'UNKNOWN_PROVIDER') return 404;
  if (code === 'INVALID_INPUT') return 400;
  if (code === 'UNSUPPORTED_OPERATION') return 422;
  return fallbackStatus;
}

app.get('/api/agent-providers', (req, res) => {
  try {
    const providers = agentProviderService.listProviders();
    res.json({ ok: true, count: providers.length, providers });
  } catch (error) {
    logger.error('Failed to list agent providers', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to list agent providers' });
  }
});

app.get('/api/agent-providers/:providerId/sessions', (req, res) => {
  try {
    const sessions = agentProviderService.listSessions(req.params.providerId, { sessionManager });
    res.json({ ok: true, provider: String(req.params.providerId || '').trim().toLowerCase(), count: sessions.length, sessions });
  } catch (error) {
    const status = mapAgentProviderError(error, 500);
    logger.error('Failed to list provider sessions', { provider: req.params.providerId, error: error.message, stack: error.stack, status });
    res.status(status).json({ ok: false, error: error.message || 'Failed to list provider sessions' });
  }
});

app.post('/api/agent-providers/:providerId/resume-plan', express.json(), (req, res) => {
  try {
    const plan = agentProviderService.buildResumePlan(req.params.providerId, req.body || {}, {
      agentManager
    });
    res.json({ ok: true, provider: String(req.params.providerId || '').trim().toLowerCase(), plan });
  } catch (error) {
    const status = mapAgentProviderError(error, 500);
    logger.error('Failed to build provider resume plan', { provider: req.params.providerId, error: error.message, stack: error.stack, status });
    res.status(status).json({ ok: false, error: error.message || 'Failed to build provider resume plan' });
  }
});

app.post('/api/agent-providers/:providerId/resume', express.json(), (req, res) => {
  try {
    const plan = agentProviderService.buildResumePlan(req.params.providerId, req.body || {}, {
      agentManager
    });
    res.json({ ok: true, provider: String(req.params.providerId || '').trim().toLowerCase(), plan });
  } catch (error) {
    const status = mapAgentProviderError(error, 500);
    logger.error('Failed to build provider resume payload', { provider: req.params.providerId, error: error.message, stack: error.stack, status });
    res.status(status).json({ ok: false, error: error.message || 'Failed to build provider resume payload' });
  }
});

app.get('/api/agent-providers/:providerId/history/search', async (req, res) => {
  try {
    const results = await agentProviderService.searchHistory(req.params.providerId, req.query || {}, {
      conversationService
    });
    res.json({ ok: true, provider: String(req.params.providerId || '').trim().toLowerCase(), ...results });
  } catch (error) {
    const status = mapAgentProviderError(error, 500);
    logger.error('Failed to search provider history', {
      provider: req.params.providerId,
      query: req.query?.q || req.query?.query || '',
      error: error.message,
      stack: error.stack,
      status
    });
    res.status(status).json({ ok: false, error: error.message || 'Failed to search provider history' });
  }
});

app.get('/api/agent-providers/:providerId/history/:id', async (req, res) => {
  try {
    const params = { ...(req.query || {}), id: req.params.id };
    const conversation = await agentProviderService.getTranscript(req.params.providerId, params, {
      conversationService
    });
    if (!conversation) {
      return res.status(404).json({ ok: false, error: 'Conversation not found' });
    }
    res.json({ ok: true, provider: String(req.params.providerId || '').trim().toLowerCase(), conversation });
  } catch (error) {
    const status = mapAgentProviderError(error, 500);
    logger.error('Failed to get provider transcript', {
      provider: req.params.providerId,
      id: req.params.id,
      error: error.message,
      stack: error.stack,
      status
    });
    res.status(status).json({ ok: false, error: error.message || 'Failed to get provider transcript' });
  }
});

// ============================================
// Conversation History API
// ============================================

// Search conversations
app.get('/api/conversations/search', async (req, res) => {
  try {
    const { q, source, project, branch, folder, startDate, endDate, limit, offset } = req.query;

    const results = await conversationService.search(q, {
      source,
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

// Export conversation as a downloadable file (JSON/Markdown).
// Must be above /api/conversations/:id.
app.get('/api/conversations/:id/export', async (req, res) => {
  try {
    const { id } = req.params;
    const { project, source } = req.query;
    const format = String(req.query.format || 'json').toLowerCase();

    const conversation = await conversationService.getConversation(id, { project, source });
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    const safeProject = sanitizeFilename(conversation.project || project || 'conversation') || 'conversation';
    const safeSource = sanitizeFilename(conversation.source || source || 'claude') || 'claude';
    const safeId = sanitizeFilename(conversation.id || id) || 'conversation';
    const baseName = `${safeProject}_${safeSource}_${safeId}`;

    if (format === 'md' || format === 'markdown') {
      const md = formatConversationAsMarkdown(conversation);
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.md"`);
      res.send(md);
      return;
    }

    if (format !== 'json') {
      res.status(400).json({ error: 'Unsupported export format' });
      return;
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.json"`);
    res.send(JSON.stringify(conversation, null, 2));
  } catch (error) {
    logger.error('Failed to export conversation', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to export conversation' });
  }
});

// Get conversation details (MUST be last to not catch other routes)
app.get('/api/conversations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { project, source } = req.query;
    const conversation = await conversationService.getConversation(id, { project, source });

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
// GitHub API
// ============================================

app.get('/api/github/status', async (req, res) => {
  try {
    const status = await GitHubRepoService.getInstance().getAuthStatus();
    res.json(status);
  } catch (error) {
    logger.error('Failed to read GitHub auth status', { error: error.message, stack: error.stack });
    res.json({ authenticated: false, user: null, ghInstalled: true, error: 'GitHub status unavailable' });
  }
});

app.get('/api/github/repos', async (req, res) => {
  try {
    const owner = typeof req.query.owner === 'string' ? req.query.owner.trim() : '';
    const scope = typeof req.query.scope === 'string' ? req.query.scope.trim().toLowerCase() : '';
    const affiliation = typeof req.query.affiliation === 'string' ? req.query.affiliation.trim() : '';
    const limitRaw = parseInt(String(req.query.limit || '200'), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 2000) : 200;
    const force = String(req.query.force || '').toLowerCase() === 'true';

    const useAccessible = !owner && (scope === 'all' || scope === 'accessible' || scope === 'full' || !!affiliation);
    const repos = useAccessible
      ? await githubRepoService.listAccessibleRepos({ limit, force, affiliation: affiliation || null })
      : await githubRepoService.listRepos({ owner: owner || null, limit, force });
    res.json(repos);
  } catch (error) {
    logger.error('Failed to list GitHub repos', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message || 'Failed to list GitHub repos' });
  }
});

app.post('/api/github/clone-and-add-worktree', express.json(), async (req, res) => {
  try {
    const {
      workspaceId,
      repo,
      categoryId,
      frameworkId,
      parentPath,
      repositoryType,
      worktreeId,
      socketId,
      startTier,
      createFolders
    } = req.body || {};

    const result = await githubCloneWorktreeService.cloneAndAddWorktree({
      workspaceId: String(workspaceId || '').trim(),
      repo: String(repo || '').trim(),
      categoryId: String(categoryId || '').trim(),
      frameworkId: String(frameworkId || '').trim(),
      parentPath: String(parentPath || '').trim(),
      repositoryType: String(repositoryType || '').trim(),
      worktreeId: String(worktreeId || 'work1').trim(),
      socketId: String(socketId || '').trim(),
      startTier,
      createFolders: createFolders !== false,
      ensureWorkspaceMixedWorktree
    });

    res.json({ ok: true, ...result });
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    logger.error('Failed to clone GitHub repo and add worktree', {
      error: error.message,
      stack: error.stack,
      statusCode
    });
    res.status(statusCode).json({
      ok: false,
      error: String(error?.message || 'Failed to clone GitHub repo and add worktree')
    });
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

app.post('/api/prs/merge', requirePolicyAction('destructive'), express.json(), async (req, res) => {
  try {
    const url = String(req.body?.url || '').trim();
    const method = String(req.body?.method || 'merge').trim().toLowerCase();
    const auto = !!req.body?.auto;

    if (!url) return res.status(400).json({ error: 'url is required' });
    if (!['merge', 'squash', 'rebase'].includes(method)) {
      return res.status(400).json({ error: 'method must be merge|squash|rebase' });
    }

    const result = await pullRequestService.mergePullRequestByUrl(url, { method, auto });
    activityFeed.track('pr.merge', { url, method, auto, ok: true });
    res.json(result);
  } catch (error) {
    activityFeed.track('pr.merge', { url: String(req.body?.url || '').trim() || null, ok: false, error: error.message });
    logger.error('Failed to merge PR', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message || 'Failed to merge PR' });
  }
});

app.post('/api/prs/review', requirePolicyAction('write'), express.json(), async (req, res) => {
  try {
    const url = String(req.body?.url || '').trim();
    const action = String(req.body?.action || 'comment').trim().toLowerCase();
    const body = req.body?.body ?? '';

    if (!url) return res.status(400).json({ error: 'url is required' });
    if (!['approve', 'request_changes', 'request-changes', 'comment'].includes(action)) {
      return res.status(400).json({ error: 'action must be approve|request_changes|comment' });
    }

    const result = await pullRequestService.reviewPullRequestByUrl(url, { action, body });
    activityFeed.track('pr.review', { url, action, ok: true });
    res.json(result);
  } catch (error) {
    activityFeed.track('pr.review', { url: String(req.body?.url || '').trim() || null, action: String(req.body?.action || '').trim() || null, ok: false, error: error.message });
    logger.error('Failed to review PR', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message || 'Failed to review PR' });
  }
});

app.get('/api/prs/details', async (req, res) => {
  try {
    const url = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    if (!url) return res.status(400).json({ error: 'url is required' });

    const maxFiles = req.query.maxFiles ? Number(req.query.maxFiles) : undefined;
    const maxCommits = req.query.maxCommits ? Number(req.query.maxCommits) : undefined;
    const maxComments = req.query.maxComments ? Number(req.query.maxComments) : undefined;
    const maxReviews = req.query.maxReviews ? Number(req.query.maxReviews) : undefined;

    const details = await pullRequestService.getPullRequestDetailsByUrl(url, {
      maxFiles,
      maxCommits,
      maxComments,
      maxReviews
    });
    // Prevent browsers from caching incomplete/empty results when GitHub is briefly flaky.
    res.setHeader('Cache-Control', 'no-store');
    res.json(details);
  } catch (error) {
    logger.error('Failed to get PR details', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message || 'Failed to get PR details' });
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
    if (worktreePaths.length) {
      await Promise.all(worktreePaths.map(async (p) => {
        try {
          const project = await projectMetadataService.getForWorktree(p);
          if (metadataByPath[p]) metadataByPath[p].project = project;
        } catch {
          // ignore
        }
      }));
    }

    const withLabels = enriched.map((t) => {
      const fromPath = deriveLabelsFromWorktreePath(t?.worktreePath);
      const project = t?.project || fromPath.project || deriveProjectFromRepository(t?.repository) || t?.repositoryName || null;
      const worktree = t?.worktree || fromPath.worktree || t?.worktreeId || null;
      const branch = t?.branch || (t?.worktreePath ? metadataByPath?.[t.worktreePath]?.git?.branch : null) || null;
      const baseImpactRisk = (t?.worktreePath ? metadataByPath?.[t.worktreePath]?.project?.baseImpactRisk : null) || null;
      return { ...t, project, worktree, branch, baseImpactRisk };
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

app.get('/api/process/distribution', async (req, res) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const repoRaw = typeof req.query.repo === 'string' ? req.query.repo.trim() : '';
    const ownerRaw = typeof req.query.owner === 'string' ? req.query.owner.trim() : '';
    const agentsRaw = typeof req.query.agents === 'string' ? req.query.agents.trim() : '';

    const repos = repoRaw ? repoRaw.split(',').map(r => r.trim()).filter(Boolean).slice(0, 20) : [];
    const owners = ownerRaw ? ownerRaw.split(',').map(o => o.trim()).filter(Boolean).slice(0, 20) : [];
    const defaultAgents = ['claude', 'codex'];
    const agents = (agentsRaw ? agentsRaw.split(',') : defaultAgents)
      .map(a => String(a || '').trim().toLowerCase())
      .filter(a => a && /^[a-z0-9_-]+$/.test(a))
      .slice(0, 10);
    const agentSet = new Set(agents.length ? agents : defaultAgents);

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

    const prs = tasks.filter(t => t?.kind === 'pr');

    const normalizeRepoSlugFromUrl = (url) => {
      const u = String(url || '').trim();
      if (!u) return null;
      const m = u.match(/github\.com\/([^/]+)\/([^/]+)(?:$|\b|\/)/i);
      if (!m) return null;
      return `${m[1]}/${m[2]}`.replace(/\.git$/i, '');
    };

    const sessions = [];
    for (const session of sessionManager.sessions.values()) {
      const agent = String(session?.type || '').trim().toLowerCase();
      if (!agentSet.has(agent)) continue;
      const repoSlug = normalizeRepoSlugFromUrl(session?.remoteUrl);
      sessions.push({
        id: session.id,
        agent,
        status: session.status,
        repoSlug,
        worktreeId: session.worktreeId || null,
        worktreePath: session.config?.cwd || null,
        repositoryName: session.repositoryName || null
      });
    }

    const scoreStatus = (status) => {
      if (status === 'idle') return 3;
      if (status === 'waiting') return 2;
      if (status === 'busy') return 1;
      return 0;
    };

    const pickBest = (list) => {
      const arr = Array.isArray(list) ? list.slice() : [];
      arr.sort((a, b) => {
        const ds = scoreStatus(b.status) - scoreStatus(a.status);
        if (ds) return ds;
        return String(a.id).localeCompare(String(b.id));
      });
      return arr[0] || null;
    };

    const suggestions = prs.map((t) => {
      const repoSlug = String(t?.repository || '').trim();
      const matches = repoSlug ? sessions.filter(s => s.repoSlug && s.repoSlug.toLowerCase() === repoSlug.toLowerCase()) : [];
      const bestMatch = pickBest(matches);
      const bestAny = pickBest(sessions);

      const chosen = bestMatch || bestAny;
      const reason = bestMatch
        ? `repo_match_${String(bestMatch.agent || 'agent')}_${String(bestMatch.status || 'unknown')}`
        : (bestAny ? `idle_fallback_${String(bestAny.agent || 'agent')}_${String(bestAny.status || 'unknown')}` : 'no_sessions');

      return {
        taskId: t.id,
        task: t,
        recommendedSessionId: chosen?.id || null,
        recommendedAgent: chosen?.agent || null,
        recommendedWorktreePath: chosen?.worktreePath || null,
        reason
      };
    });

    res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      totalTasks: prs.length,
      suggestions
    });
  } catch (error) {
    logger.error('Failed to compute task distribution', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to compute task distribution' });
  }
});

app.post('/api/process/tests/run', async (req, res) => {
  try {
    const script = typeof req.body?.script === 'string' ? req.body.script.trim() : 'auto';
    const concurrency = req.body?.concurrency;
    const existingOnly = String(req.body?.existingOnly ?? 'true').toLowerCase() !== 'false';

    const run = await testOrchestrationService.startRun({ script, concurrency, existingOnly });
    activityFeed.track('tests.run', { script, concurrency: concurrency ?? null, existingOnly, runId: run?.runId || run?.id || null });
    res.json(run);
  } catch (error) {
    activityFeed.track('tests.run', { ok: false, error: error.message });
    logger.error('Failed to start test orchestration run', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to start test run' });
  }
});

app.get('/api/process/tests/runs', (req, res) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 25;
    res.json(testOrchestrationService.listRuns({ limit }));
  } catch (error) {
    logger.error('Failed to list test orchestration runs', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to list test runs' });
  }
});

app.get('/api/process/tests/runs/:runId', (req, res) => {
  try {
    const runId = String(req.params.runId || '').trim();
    const run = testOrchestrationService.getRun(runId);
    if (!run) {
      res.status(404).json({ ok: false, error: 'Run not found' });
      return;
    }
    res.json(run);
  } catch (error) {
    logger.error('Failed to fetch test orchestration run', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to fetch test run' });
  }
});

app.post('/api/process/tests/runs/:runId/cancel', (req, res) => {
  try {
    const runId = String(req.params.runId || '').trim();
    activityFeed.track('tests.cancel', { runId });
    const result = testOrchestrationService.cancelRun(runId);
    if (!result?.ok) {
      res.status(400).json(result);
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    activityFeed.track('tests.cancel', { runId: String(req.params.runId || '').trim() || null, ok: false, error: error.message });
    logger.error('Failed to cancel test orchestration run', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to cancel test run' });
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

app.get('/api/process/pairing', async (req, res) => {
  try {
    const mode = req.query.mode || 'mine';
    const tiersRaw = String(req.query.tiers || '2,3');
    const tiers = tiersRaw.split(',').map(s => Number.parseInt(String(s).trim(), 10)).filter(n => n >= 1 && n <= 4);
    const limit = req.query.limit ? Number(req.query.limit) : 10;
    const refresh = String(req.query.refresh || '').toLowerCase() === 'true';

    const result = await processPairingService.getPairings({ mode, tiers: tiers.length ? tiers : [2, 3], limit, refresh });
    res.json(result);
  } catch (error) {
    logger.error('Failed to compute process pairing', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message || 'Failed to compute pairing' });
  }
});

app.get('/api/process/settings', (req, res) => {
  try {
    const defaults = userSettingsService.getDefaultSettings();
    const current = userSettingsService.settings || {};

    const defaultStatus = defaults?.global?.process?.status || {};
    const currentStatus = current?.global?.process?.status || {};
    const capsDefaults = (defaultStatus.caps && typeof defaultStatus.caps === 'object') ? defaultStatus.caps : {};
    const capsCurrent = (currentStatus.caps && typeof currentStatus.caps === 'object') ? currentStatus.caps : {};

    res.json({
      lookbackHours: Number(currentStatus.lookbackHours ?? defaultStatus.lookbackHours ?? 24),
      caps: {
        wipMax: Number(capsCurrent.wipMax ?? capsDefaults.wipMax ?? 3),
        q12: Number(capsCurrent.q12 ?? capsDefaults.q12 ?? 3),
        q3: Number(capsCurrent.q3 ?? capsDefaults.q3 ?? 6),
        q4: Number(capsCurrent.q4 ?? capsDefaults.q4 ?? 10)
      }
    });
  } catch (error) {
    logger.error('Failed to get process settings', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to get process settings' });
  }
});

app.post('/api/process/settings', express.json(), (req, res) => {
  try {
    const defaults = userSettingsService.getDefaultSettings();
    const current = userSettingsService.settings || {};

    const defaultStatus = defaults?.global?.process?.status || {};
    const existingStatus = current?.global?.process?.status || {};
    const capsDefaults = (defaultStatus.caps && typeof defaultStatus.caps === 'object') ? defaultStatus.caps : {};
    const capsExisting = (existingStatus.caps && typeof existingStatus.caps === 'object') ? existingStatus.caps : {};

    const parseIntOrNull = (v) => {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      if (!Number.isFinite(n)) return null;
      return Math.round(n);
    };

    const next = {
      lookbackHours: Number(existingStatus.lookbackHours ?? defaultStatus.lookbackHours ?? 24),
      caps: {
        wipMax: Number(capsExisting.wipMax ?? capsDefaults.wipMax ?? 3),
        q12: Number(capsExisting.q12 ?? capsDefaults.q12 ?? 3),
        q3: Number(capsExisting.q3 ?? capsDefaults.q3 ?? 6),
        q4: Number(capsExisting.q4 ?? capsDefaults.q4 ?? 10)
      }
    };

    const lh = parseIntOrNull(req.body?.lookbackHours);
    if (lh !== null) {
      if (lh < 1 || lh > 24 * 14) return res.status(400).json({ error: 'lookbackHours must be between 1 and 336' });
      next.lookbackHours = lh;
    }

    const capsPatch = req.body?.caps && typeof req.body.caps === 'object' ? req.body.caps : null;
    if (capsPatch) {
      for (const key of ['wipMax', 'q12', 'q3', 'q4']) {
        if (capsPatch[key] === undefined) continue;
        const v = parseIntOrNull(capsPatch[key]);
        if (v === null) continue;
        if (v < 0 || v > 200) return res.status(400).json({ error: `${key} must be between 0 and 200` });
        next.caps[key] = v;
      }
    }

    if (!current.global) current.global = {};
    if (!current.global.process) current.global.process = {};
    current.global.process.status = next;
    userSettingsService.settings = userSettingsService.mergeSettings(defaults, current);
    const saved = userSettingsService.saveSettings();
    if (!saved) return res.status(500).json({ error: 'Failed to save process settings' });

    io.emit('user-settings-updated', userSettingsService.getAllSettings());
    processStatusService.cache?.clear?.();

    res.json(next);
  } catch (error) {
    logger.error('Failed to update process settings', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to update process settings' });
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

app.get('/api/process/telemetry/benchmarks', async (req, res) => {
  try {
    const lookbackHours = req.query.lookbackHours ? Number(req.query.lookbackHours) : undefined;
    const bucketMinutes = req.query.bucketMinutes ? Number(req.query.bucketMinutes) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const force = String(req.query.force || '').toLowerCase() === 'true';
    const data = await processTelemetryBenchmarkService.getBenchmarkDashboard({
      lookbackHours,
      bucketMinutes,
      limit,
      force
    });
    res.json(data);
  } catch (error) {
    logger.error('Failed to fetch telemetry benchmark dashboard', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to fetch telemetry benchmark dashboard' });
  }
});

app.post('/api/process/telemetry/benchmarks/snapshots', express.json({ limit: '2mb' }), async (req, res) => {
  try {
    const lookbackHours = req.body?.lookbackHours ? Number(req.body.lookbackHours) : undefined;
    const bucketMinutes = req.body?.bucketMinutes ? Number(req.body.bucketMinutes) : undefined;
    const label = typeof req.body?.label === 'string' ? req.body.label : '';
    const notes = typeof req.body?.notes === 'string' ? req.body.notes : '';

    const created = await processTelemetryBenchmarkService.captureSnapshot({
      lookbackHours,
      bucketMinutes,
      label,
      notes
    });
    res.json({
      ...created,
      url: `/api/process/telemetry/snapshots/${created.id}`
    });
  } catch (error) {
    logger.error('Failed to create telemetry benchmark snapshot', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to create telemetry benchmark snapshot' });
  }
});

app.get('/api/process/telemetry/benchmarks/release-notes', async (req, res) => {
  try {
    const currentId = req.query.currentId ? String(req.query.currentId) : 'live';
    const baselineId = req.query.baselineId ? String(req.query.baselineId) : '';
    const lookbackHours = req.query.lookbackHours ? Number(req.query.lookbackHours) : undefined;
    const bucketMinutes = req.query.bucketMinutes ? Number(req.query.bucketMinutes) : undefined;
    const download = String(req.query.download || '').toLowerCase() === 'true';

    const payload = await processTelemetryBenchmarkService.buildReleaseNotes({
      currentId,
      baselineId,
      lookbackHours,
      bucketMinutes
    });

    if (download) {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="telemetry-release-notes-${Date.now()}.md"`);
      res.send(payload.markdown + '\n');
      return;
    }

    res.json(payload);
  } catch (error) {
    logger.error('Failed to build telemetry release notes', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message || 'Failed to build telemetry release notes' });
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

app.get('/api/process/telemetry/export', proOnly, async (req, res) => {
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

app.get('/api/process/projects/health', async (req, res) => {
  try {
    const lookbackHours = req.query.lookbackHours ? Number(req.query.lookbackHours) : undefined;
    const bucketMinutes = req.query.bucketMinutes ? Number(req.query.bucketMinutes) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const force = String(req.query.force || '').toLowerCase() === 'true';
    const data = await processProjectHealthService.getHealth({ lookbackHours, bucketMinutes, limit, force });
    res.json(data);
  } catch (error) {
    logger.error('Failed to fetch project health dashboard', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to fetch project health dashboard' });
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

app.get('/api/process/readiness/templates', (req, res) => {
  try {
    const data = processReadinessService.getTemplates();
    res.json(data);
  } catch (error) {
    logger.error('Failed to fetch readiness templates', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to fetch readiness templates' });
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
    const before = taskRecordService.get(id) || null;
    const record = await taskRecordService.upsert(id, req.body || {});
    try {
      const keys = ['tier', 'risk', 'pFail', 'doneAt', 'reviewedAt', 'reviewOutcome', 'claimedAt', 'claimedBy', 'assignedAt', 'assignedTo'];
      const changes = {};
      for (const k of keys) {
        const from = before?.[k] ?? null;
        const to = record?.[k] ?? null;
        if (from !== to) {
          changes[k] = { from, to };
        }
      }
      if (Object.keys(changes).length > 0) {
        activityFeed.track('task-record.updated', { id, changes });
      }
    } catch {
      // ignore
    }
    res.json({ id, record });
  } catch (error) {
    logger.error('Failed to upsert task record', { error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message || 'Failed to upsert task record' });
  }
});

app.post('/api/process/task-records/:id/promote', express.json(), async (req, res) => {
  try {
    const id = req.params.id;
    const visibility = String(req.body?.visibility || 'shared').trim().toLowerCase();
    const repoRoot = String(req.body?.repoRoot || '').trim();
    const relPath = req.body?.relPath ? String(req.body.relPath).trim() : '';
    if (!repoRoot) return res.status(400).json({ error: 'repoRoot is required' });
    if (!['shared', 'encrypted'].includes(visibility)) return res.status(400).json({ error: 'visibility must be shared|encrypted' });

    const record = await taskRecordService.promoteToRepo({ id, repoRoot, relPath: relPath || undefined, visibility });
    if (!record) return res.status(404).json({ error: 'Not found' });
    res.json({
      id,
      record,
      visibility,
      repoRoot,
      relPath: record?.recordPath || relPath || ''
    });
  } catch (error) {
    const msg = error.message || 'Failed to promote task record';
    const status = msg.includes('require') || msg.includes('must') || msg.includes('repoRoot') ? 400 : 500;
    logger.error('Failed to promote task record', { error: error.message, stack: error.stack });
    res.status(status).json({ error: msg });
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

app.post('/api/process/task-records/:id/ticket-move', express.json(), async (req, res) => {
  try {
    const id = req.params.id;
    const listId = String(req.body?.listId || '').trim();
    const result = await taskTicketMoveService.moveTicketForTaskRecord(id, { listId });
    res.json(result);
  } catch (error) {
    const status = error.code === 'UNKNOWN_PROVIDER' || error.code === 'PROVIDER_NOT_CONFIGURED' ? 400 : 500;
    logger.error('Failed to move ticket', { error: error.message, code: error.code, stack: error.stack });
    res.status(status).json({
      error: error.message || 'Failed to move ticket',
      code: error.code
    });
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

app.get('/api/tasks/trello/status', (req, res) => {
  try {
    const { loadTrelloCredentials } = require('./taskProviders/trelloCredentials');
    const creds = loadTrelloCredentials();
    res.json({ configured: !!creds, source: creds?.source || null });
  } catch (error) {
    res.json({ configured: false, source: null });
  }
});

app.post('/api/tasks/trello/credentials', async (req, res) => {
  try {
    const { apiKey, token } = req.body || {};
    if (!apiKey || !token) {
      return res.status(400).json({ error: 'Both apiKey and token are required' });
    }

    // Test the credentials against Trello API first
    const https = require('https');
    const testUrl = `https://api.trello.com/1/members/me?key=${encodeURIComponent(apiKey)}&token=${encodeURIComponent(token)}`;
    const testResult = await new Promise((resolve) => {
      https.get(testUrl, (resp) => {
        let data = '';
        resp.on('data', (chunk) => { data += chunk; });
        resp.on('end', () => {
          if (resp.statusCode === 200) {
            try { resolve({ ok: true, user: JSON.parse(data) }); } catch { resolve({ ok: true }); }
          } else {
            resolve({ ok: false, status: resp.statusCode });
          }
        });
      }).on('error', (err) => resolve({ ok: false, error: err.message }));
    });

    if (!testResult.ok) {
      return res.status(400).json({ error: 'Invalid credentials — Trello API rejected them', details: testResult });
    }

    // Write to ~/.trello-credentials
    const os = require('os');
    const path = require('path');
    const fs = require('fs');
    const credPath = path.join(os.homedir(), '.trello-credentials');
    const content = `TRELLO_API_KEY=${apiKey}\nTRELLO_TOKEN=${token}\n`;
    fs.writeFileSync(credPath, content, { mode: 0o600 });

    const username = testResult.user?.username || testResult.user?.fullName || '';
    logger.info('Trello credentials saved', { credPath, username });
    res.json({ ok: true, username, source: credPath });
  } catch (error) {
    logger.error('Failed to save Trello credentials', { error: error.message });
    res.status(500).json({ error: 'Failed to save credentials' });
  }
});

app.post('/api/tasks/trello/credentials/save-only', (req, res) => {
  try {
    const { apiKey, token } = req.body || {};
    if (!apiKey || !token) {
      return res.status(400).json({ error: 'Both apiKey and token are required' });
    }
    const os = require('os');
    const path = require('path');
    const fs = require('fs');
    const credPath = path.join(os.homedir(), '.trello-credentials');
    const content = `TRELLO_API_KEY=${apiKey}\nTRELLO_TOKEN=${token}\n`;
    fs.writeFileSync(credPath, content, { mode: 0o600 });
    logger.info('Trello credentials saved (no test)', { credPath });
    res.json({ ok: true, source: credPath });
  } catch (error) {
    logger.error('Failed to save Trello credentials', { error: error.message });
    res.status(500).json({ error: 'Failed to save credentials' });
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

app.post('/api/tasks/boards/:boardId/lists', express.json(), async (req, res) => {
  try {
    const providerId = req.query.provider || 'trello';
    const provider = taskTicketingService.getProvider(providerId);
    if (typeof provider.createList !== 'function') {
      return res.status(400).json({ error: 'Provider does not support list creation', code: 'UNSUPPORTED_OPERATION' });
    }
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    const pos = req.body?.pos ?? null;
    const created = await provider.createList({ boardId: req.params.boardId, name, pos });
    const lists = typeof provider.listLists === 'function'
      ? await provider.listLists({ boardId: req.params.boardId, refresh: true })
      : [];
    res.json({ provider: providerId, boardId: req.params.boardId, list: created, lists });
  } catch (error) {
    const status = error.code === 'UNKNOWN_PROVIDER' || error.code === 'PROVIDER_NOT_CONFIGURED' ? 400 : 500;
    logger.error('Failed to create task list', { error: error.message, code: error.code, stack: error.stack });
    res.status(status).json({ error: error.message, code: error.code });
  }
});

app.put('/api/tasks/lists/:listId', express.json(), async (req, res) => {
  try {
    const providerId = req.query.provider || 'trello';
    const provider = taskTicketingService.getProvider(providerId);
    if (typeof provider.updateList !== 'function') {
      return res.status(400).json({ error: 'Provider does not support list updates', code: 'UNSUPPORTED_OPERATION' });
    }
    const boardId = String(req.body?.boardId || '').trim();
    const name = req.body?.name ?? null;
    const pos = req.body?.pos ?? null;
    const updated = await provider.updateList({ listId: req.params.listId, boardId: boardId || null, name, pos });
    const lists = boardId && typeof provider.listLists === 'function'
      ? await provider.listLists({ boardId, refresh: true })
      : [];
    res.json({ provider: providerId, listId: req.params.listId, list: updated, lists });
  } catch (error) {
    const status = error.code === 'UNKNOWN_PROVIDER' || error.code === 'PROVIDER_NOT_CONFIGURED' ? 400 : 500;
    logger.error('Failed to update task list', { error: error.message, code: error.code, stack: error.stack });
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

// ============================================
// Checklists (generic CRUD beyond Dependencies)
// ============================================

app.post('/api/tasks/cards/:cardId/checklists', express.json(), async (req, res) => {
  try {
    const providerId = req.query.provider || 'trello';
    const provider = taskTicketingService.getProvider(providerId);
    if (typeof provider.createChecklist !== 'function') {
      return res.status(400).json({ error: 'Provider does not support checklists', code: 'UNSUPPORTED_OPERATION' });
    }
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });

    const checklist = await provider.createChecklist({ cardId: req.params.cardId, name });
    const card = typeof provider.getCard === 'function'
      ? await provider.getCard({ cardId: req.params.cardId, refresh: true })
      : null;
    res.json({ provider: providerId, cardId: req.params.cardId, checklist, card });
  } catch (error) {
    const status = error.code === 'UNKNOWN_PROVIDER' || error.code === 'PROVIDER_NOT_CONFIGURED' ? 400 : 500;
    logger.error('Failed to create checklist', { error: error.message, code: error.code, stack: error.stack });
    res.status(status).json({ error: error.message, code: error.code });
  }
});

app.put('/api/tasks/checklists/:checklistId', express.json(), async (req, res) => {
  try {
    const providerId = req.query.provider || 'trello';
    const cardId = String(req.body?.cardId || '').trim();
    const provider = taskTicketingService.getProvider(providerId);
    if (typeof provider.updateChecklist !== 'function') {
      return res.status(400).json({ error: 'Provider does not support checklists', code: 'UNSUPPORTED_OPERATION' });
    }
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });

    const checklist = await provider.updateChecklist({ checklistId: req.params.checklistId, name });
    const card = (cardId && typeof provider.getCard === 'function')
      ? await provider.getCard({ cardId, refresh: true })
      : null;
    res.json({ provider: providerId, checklistId: req.params.checklistId, checklist, card });
  } catch (error) {
    const status = error.code === 'UNKNOWN_PROVIDER' || error.code === 'PROVIDER_NOT_CONFIGURED' ? 400 : 500;
    logger.error('Failed to rename checklist', { error: error.message, code: error.code, stack: error.stack });
    res.status(status).json({ error: error.message, code: error.code });
  }
});

app.delete('/api/tasks/checklists/:checklistId', async (req, res) => {
  try {
    const providerId = req.query.provider || 'trello';
    const cardId = String(req.query.cardId || '').trim();
    const provider = taskTicketingService.getProvider(providerId);
    if (typeof provider.removeChecklist !== 'function') {
      return res.status(400).json({ error: 'Provider does not support checklists', code: 'UNSUPPORTED_OPERATION' });
    }
    await provider.removeChecklist({ checklistId: req.params.checklistId });
    const card = (cardId && typeof provider.getCard === 'function')
      ? await provider.getCard({ cardId, refresh: true })
      : null;
    res.json({ provider: providerId, checklistId: req.params.checklistId, removed: true, card });
  } catch (error) {
    const status = error.code === 'UNKNOWN_PROVIDER' || error.code === 'PROVIDER_NOT_CONFIGURED' ? 400 : 500;
    logger.error('Failed to delete checklist', { error: error.message, code: error.code, stack: error.stack });
    res.status(status).json({ error: error.message, code: error.code });
  }
});

app.post('/api/tasks/checklists/:checklistId/check-items', express.json(), async (req, res) => {
  try {
    const providerId = req.query.provider || 'trello';
    const cardId = String(req.body?.cardId || '').trim();
    const provider = taskTicketingService.getProvider(providerId);
    if (typeof provider.addCheckItem !== 'function') {
      return res.status(400).json({ error: 'Provider does not support checklist items', code: 'UNSUPPORTED_OPERATION' });
    }
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });

    await provider.addCheckItem({ checklistId: req.params.checklistId, name });
    const card = (cardId && typeof provider.getCard === 'function')
      ? await provider.getCard({ cardId, refresh: true })
      : null;
    res.json({ provider: providerId, checklistId: req.params.checklistId, card });
  } catch (error) {
    const status = error.code === 'UNKNOWN_PROVIDER' || error.code === 'PROVIDER_NOT_CONFIGURED' ? 400 : 500;
    logger.error('Failed to add checklist item', { error: error.message, code: error.code, stack: error.stack });
    res.status(status).json({ error: error.message, code: error.code });
  }
});

app.put('/api/tasks/checklists/:checklistId/check-items/:itemId', express.json(), async (req, res) => {
  try {
    const providerId = req.query.provider || 'trello';
    const cardId = String(req.body?.cardId || '').trim();
    const provider = taskTicketingService.getProvider(providerId);
    if (typeof provider.updateCheckItem !== 'function') {
      return res.status(400).json({ error: 'Provider does not support checklist items', code: 'UNSUPPORTED_OPERATION' });
    }
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });

    await provider.updateCheckItem({ checklistId: req.params.checklistId, itemId: req.params.itemId, name });
    const card = (cardId && typeof provider.getCard === 'function')
      ? await provider.getCard({ cardId, refresh: true })
      : null;
    res.json({ provider: providerId, checklistId: req.params.checklistId, itemId: req.params.itemId, card });
  } catch (error) {
    const status = error.code === 'UNKNOWN_PROVIDER' || error.code === 'PROVIDER_NOT_CONFIGURED' ? 400 : 500;
    logger.error('Failed to rename checklist item', { error: error.message, code: error.code, stack: error.stack });
    res.status(status).json({ error: error.message, code: error.code });
  }
});

app.delete('/api/tasks/checklists/:checklistId/check-items/:itemId', async (req, res) => {
  try {
    const providerId = req.query.provider || 'trello';
    const cardId = String(req.query.cardId || '').trim();
    const provider = taskTicketingService.getProvider(providerId);
    if (typeof provider.removeCheckItem !== 'function') {
      return res.status(400).json({ error: 'Provider does not support checklist items', code: 'UNSUPPORTED_OPERATION' });
    }
    await provider.removeCheckItem({ checklistId: req.params.checklistId, itemId: req.params.itemId });
    const card = (cardId && typeof provider.getCard === 'function')
      ? await provider.getCard({ cardId, refresh: true })
      : null;
    res.json({ provider: providerId, checklistId: req.params.checklistId, itemId: req.params.itemId, removed: true, card });
  } catch (error) {
    const status = error.code === 'UNKNOWN_PROVIDER' || error.code === 'PROVIDER_NOT_CONFIGURED' ? 400 : 500;
    logger.error('Failed to delete checklist item', { error: error.message, code: error.code, stack: error.stack });
    res.status(status).json({ error: error.message, code: error.code });
  }
});

app.put('/api/tasks/cards/:cardId/check-items/:itemId', express.json(), async (req, res) => {
  try {
    const providerId = req.query.provider || 'trello';
    const provider = taskTicketingService.getProvider(providerId);
    if (typeof provider.setCheckItemState !== 'function') {
      return res.status(400).json({ error: 'Provider does not support checklist item state updates', code: 'UNSUPPORTED_OPERATION' });
    }
    const state = req.body?.state;
    await provider.setCheckItemState({ cardId: req.params.cardId, itemId: req.params.itemId, state });
    const card = typeof provider.getCard === 'function'
      ? await provider.getCard({ cardId: req.params.cardId, refresh: true })
      : null;
    res.json({ provider: providerId, cardId: req.params.cardId, itemId: req.params.itemId, card });
  } catch (error) {
    const status = error.code === 'UNKNOWN_PROVIDER' || error.code === 'PROVIDER_NOT_CONFIGURED' ? 400 : 500;
    logger.error('Failed to update checklist item state', { error: error.message, code: error.code, stack: error.stack });
    res.status(status).json({ error: error.message, code: error.code });
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
// Batch Launch API
// ============================================

app.post('/api/tasks/batch-launch', express.json(), async (req, res) => {
  try {
    const result = await batchLaunchService.batchLaunch(req.body || {});
    res.json(result);
  } catch (error) {
    logger.error('Batch launch failed', { error: error.message, stack: error.stack });
    res.status(error.message.includes('required') ? 400 : 500).json({ error: error.message });
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

// =====================================
// System Recommendations API
// =====================================

app.get('/api/recommendations', (req, res) => {
  try {
    const { status } = req.query;
    const items = status === 'pending'
      ? recommendationsService.getPending()
      : recommendationsService.getAll();
    res.json({ items });
  } catch (error) {
    logger.error('Failed to get recommendations', { error: error.message });
    res.status(500).json({ error: 'Failed to get recommendations' });
  }
});

app.post('/api/recommendations', async (req, res) => {
  try {
    const item = await recommendationsService.add(req.body);
    res.json({ item });
  } catch (error) {
    logger.error('Failed to add recommendation', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/recommendations/:id', async (req, res) => {
  try {
    const { status } = req.body;
    const item = await recommendationsService.updateStatus(req.params.id, status);
    res.json({ item });
  } catch (error) {
    logger.error('Failed to update recommendation', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/recommendations/:id', async (req, res) => {
  try {
    await recommendationsService.remove(req.params.id);
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to delete recommendation', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// =====================================
// Plugin loader API
// =====================================

app.get('/api/plugins', (req, res) => {
  try {
    res.json(pluginLoaderService.getStatus());
  } catch (error) {
    logger.error('Failed to get plugin status', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to get plugin status' });
  }
});

app.get('/api/plugins/client-surface', (req, res) => {
  try {
    const slotFilter = String(req.query?.slot || '').trim().toLowerCase();
    const status = pluginLoaderService.getStatus();
    const loaded = Array.isArray(status?.loaded) ? status.loaded : [];

    const slots = [];
    for (const plugin of loaded) {
      const pluginId = String(plugin?.id || '').trim();
      const pluginName = String(plugin?.name || pluginId).trim();
      const list = Array.isArray(plugin?.client?.slots) ? plugin.client.slots : [];
      for (const slot of list) {
        const slotName = String(slot?.slot || '').trim().toLowerCase();
        if (!slotName) continue;
        if (slotFilter && slotName !== slotFilter) continue;
        slots.push({
          pluginId,
          pluginName,
          id: slot.id,
          slot: slotName,
          label: slot.label,
          description: slot.description || '',
          order: Number.isFinite(Number(slot.order)) ? Number(slot.order) : 0,
          action: slot.action || null
        });
      }
    }

    slots.sort((a, b) => {
      if (a.slot !== b.slot) return a.slot.localeCompare(b.slot);
      if (a.order !== b.order) return a.order - b.order;
      if (a.pluginId !== b.pluginId) return a.pluginId.localeCompare(b.pluginId);
      return String(a.id || '').localeCompare(String(b.id || ''));
    });

    res.json({ ok: true, count: slots.length, slots });
  } catch (error) {
    logger.error('Failed to get plugin client surface', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to get plugin client surface' });
  }
});

app.post('/api/plugins/reload', async (req, res) => {
  try {
    const status = await loadPlugins();
    res.json({ ok: true, ...status });
  } catch (error) {
    logger.error('Failed to reload plugins', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to reload plugins', message: error.message });
  }
});

// =====================================
// Scheduler API
// =====================================

app.get('/api/scheduler/status', (req, res) => {
  try {
    res.json(schedulerService.getStatus());
  } catch (error) {
    logger.error('Failed to get scheduler status', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to get scheduler status' });
  }
});

app.get('/api/scheduler/templates', (req, res) => {
  try {
    const templates = schedulerService.getTemplates();
    res.json({ ok: true, count: templates.length, templates });
  } catch (error) {
    logger.error('Failed to get scheduler templates', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to get scheduler templates' });
  }
});

app.put('/api/scheduler/config', express.json(), async (req, res) => {
  try {
    const patch = req.body && typeof req.body === 'object' ? req.body : {};
    const config = await schedulerService.updateConfig({
      enabled: patch.enabled,
      tickSeconds: patch.tickSeconds,
      schedules: patch.schedules,
      safety: patch.safety
    });
    res.json({ ok: true, config });
  } catch (error) {
    logger.error('Failed to update scheduler config', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to update scheduler config', message: error.message });
  }
});

app.post('/api/scheduler/run-now', express.json(), async (req, res) => {
  try {
    const scheduleId = String(req.body?.scheduleId || '').trim();
    if (!scheduleId) {
      return res.status(400).json({ ok: false, error: 'scheduleId is required' });
    }
    const result = await schedulerService.runNow(scheduleId);
    res.json({ ok: true, result });
  } catch (error) {
    logger.error('Failed to run schedule now', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to run schedule now', message: error.message });
  }
});

app.post('/api/scheduler/jobs/from-template', express.json(), async (req, res) => {
  try {
    const templateId = String(req.body?.templateId || '').trim();
    if (!templateId) {
      return res.status(400).json({ ok: false, error: 'templateId is required' });
    }
    const options = (req.body?.options && typeof req.body.options === 'object') ? req.body.options : {};
    const result = await schedulerService.createScheduleFromTemplate(templateId, options);
    res.json({ ok: true, ...result });
  } catch (error) {
    const message = String(error?.message || error);
    const status = message.toLowerCase().includes('unknown scheduler template') ? 404 : 500;
    logger.error('Failed to create scheduler job from template', { error: message, stack: error.stack, status });
    res.status(status).json({ ok: false, error: 'Failed to create scheduler job from template', message });
  }
});

app.post('/api/scheduler/jobs/from-template/preview', express.json(), async (req, res) => {
  try {
    const templateId = String(req.body?.templateId || '').trim();
    if (!templateId) {
      return res.status(400).json({ ok: false, error: 'templateId is required' });
    }
    const options = (req.body?.options && typeof req.body.options === 'object') ? req.body.options : {};
    const result = await schedulerService.previewScheduleFromTemplate(templateId, options);
    res.json({ ok: true, ...result });
  } catch (error) {
    const message = String(error?.message || error);
    const status = message.toLowerCase().includes('unknown scheduler template') ? 404 : 500;
    logger.error('Failed to preview scheduler template job', { error: message, stack: error.stack, status });
    res.status(status).json({ ok: false, error: 'Failed to preview scheduler template job', message });
  }
});

app.get('/api/pager/jobs', (req, res) => {
  try {
    const id = String(req.query.id || '').trim();
    const status = pagerService.getStatus({ id: id || undefined });
    res.json(status);
  } catch (error) {
    logger.error('Failed to get pager jobs', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to get pager jobs', message: error.message });
  }
});

app.post('/api/pager/jobs', express.json(), async (req, res) => {
  try {
    const options = (req.body && typeof req.body === 'object') ? req.body : {};
    const job = await pagerService.startJob(options);
    res.status(201).json({ ok: true, job });
  } catch (error) {
    const message = String(error?.message || error);
    const status = message.toLowerCase().includes('no target sessions') || message.toLowerCase().includes('no live sessions')
      ? 400
      : 500;
    logger.error('Failed to start pager job', { error: message, stack: error.stack, status });
    res.status(status).json({ ok: false, error: 'Failed to start pager job', message });
  }
});

app.post('/api/pager/jobs/:id/stop', express.json(), (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) {
      return res.status(400).json({ ok: false, error: 'id is required' });
    }
    const reason = String(req.body?.reason || 'manual').trim() || 'manual';
    const result = pagerService.stopJob(id, { reason });
    if (!result?.ok) {
      return res.status(404).json({ ok: false, error: result?.error || `Job not found: ${id}` });
    }
    res.json({ ok: true, ...result });
  } catch (error) {
    logger.error('Failed to stop pager job', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to stop pager job', message: error.message });
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

// Unified command catalog (shared discovery for UI/voice/commander)
app.get('/api/commands/catalog', (req, res) => {
  try {
    const includeHidden = String(req.query.includeHidden || '').toLowerCase() === 'true';
    const commands = commandRegistry
      .getCatalog({ includeHidden })
      .map((cmd) => ({
        ...cmd,
        requiredRole: policyService.inferRequiredRoleForCommand(cmd.name, cmd)
      }));
    res.json({
      ok: true,
      count: commands.length,
      commands
    });
  } catch (error) {
    logger.error('Failed to get command catalog', { error: error.message });
    res.status(500).json({ ok: false, error: 'Failed to get command catalog' });
  }
});

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
    const policyDecision = policyService.authorizeCommand({ req, commandName: command });
    if (!policyDecision.ok) {
      return res.status(403).json(buildPolicyDeniedPayload(policyDecision, 'Forbidden command by policy'));
    }
    const result = await commandRegistry.execute(command, params || {});
    res.json(result);
  } catch (error) {
    logger.error('Failed to execute command', { error: error.message });
    res.status(500).json({ error: 'Failed to execute command' });
  }
});

// Execute a command from free text (shared parsing pipeline with Voice: rules -> LLM fallback)
app.post('/api/commander/execute-text', async (req, res) => {
  try {
    const { text, dryRun } = req.body || {};
    const input = String(text || '').trim();
    if (!input) {
      return res.status(400).json({ ok: false, error: 'text is required' });
    }
    if (input.length > 2000) {
      return res.status(400).json({ ok: false, error: 'text too long' });
    }

    // Keep the parser context in sync with Commander's current UI state.
    try {
      const snapshot = commanderContextService.getSnapshot({ workspaceManager, commanderService, commandRegistry });
      voiceCommandService.setContext(snapshot?.context || {});
    } catch {
      // ignore
    }

    const parsed = await voiceCommandService.parseCommand(input);
    if (!parsed || parsed.success !== true) {
      return res.status(200).json({ ok: false, parsed });
    }

    if (dryRun === true || String(dryRun).toLowerCase() === 'true') {
      return res.status(200).json({ ok: true, parsed, result: null, dryRun: true });
    }

    const policyDecision = policyService.authorizeCommand({ req, commandName: parsed.command });
    if (!policyDecision.ok) {
      return res.status(403).json(buildPolicyDeniedPayload(policyDecision, 'Forbidden command by policy'));
    }

    const result = await commandRegistry.execute(parsed.command, parsed.params || {});
    res.json({ ok: true, parsed, result });
  } catch (error) {
    logger.error('Failed to execute text command', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to execute text command', message: error.message });
  }
});

// Commander context (UI state + sessions + workspace info)
app.get('/api/commander/context', (req, res) => {
  try {
    const snapshot = commanderContextService.getSnapshot({ workspaceManager, commanderService, commandRegistry });
    res.json(snapshot);
  } catch (error) {
    logger.error('Failed to get commander context', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to get commander context' });
  }
});

// Lightweight bootstrap/help prompt for Commander Claude (generated from command registry + context)
app.get('/api/commander/prompt', (req, res) => {
  try {
    const snapshot = commanderContextService.getSnapshot({ workspaceManager, commanderService, commandRegistry });
    const capabilities = commandRegistry.getCapabilities();

    const flatten = [];
    for (const [category, cmds] of Object.entries(capabilities || {})) {
      (cmds || []).forEach((c) => {
        const params = Array.isArray(c.params) ? c.params : [];
        const required = params.filter(p => p && p.required).map(p => p.name).filter(Boolean);
        flatten.push({
          category,
          name: c.name,
          description: c.description,
          required
        });
      });
    }
    flatten.sort((a, b) => (a.category + a.name).localeCompare(b.category + b.name));

    const selected = snapshot?.context?.selectedQueue || null;
    const selectedLine = selected?.id
      ? `Selected queue item: ${selected.id}${selected.title ? ` (${selected.title})` : ''}${selected.url ? ` • ${selected.url}` : ''}`
      : 'Selected queue item: (none)';

    const queueSummary = Array.isArray(snapshot?.context?.queueSummary) ? snapshot.context.queueSummary : [];
    const queueLines = queueSummary.length
      ? ['Queue (top):', ...queueSummary.slice(0, 10).map((t) => {
        const id = String(t?.id || '').trim();
        const title = String(t?.title || '').trim();
        const tier = String(t?.tier ?? '').trim();
        const claim = String(t?.claimedBy || '').trim();
        const bits = [];
        if (tier) bits.push(`T${tier}`);
        if (claim) bits.push(`claimed:${claim}`);
        const meta = bits.length ? ` (${bits.join(', ')})` : '';
        return `- ${id}${meta}${title ? ` — ${title}` : ''}`;
      })]
      : [];

    const lines = [
      'You are Commander Claude. You can control the Orchestrator by calling its HTTP APIs.',
      '',
      'Preferred control surface: POST /api/commander/execute with { "command": "...", "params": {...} }.',
      'Discovery: GET /api/commander/capabilities.',
      'Context: GET /api/commander/context.',
      '',
      selectedLine,
      ...(queueLines.length ? ['', ...queueLines] : []),
      '',
      'Available commands (summary):',
      ...flatten.map((c) => `- [${c.category}] ${c.name}${c.required?.length ? ` (required: ${c.required.join(', ')})` : ''}: ${c.description}`)
    ];

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(lines.join('\n'));
  } catch (error) {
    logger.error('Failed to build commander prompt', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to build commander prompt' });
  }
});

// =====================================
// Discord Bot (Claudesworth) Integration
// =====================================

const DISCORD_API_TOKEN = String(process.env.DISCORD_API_TOKEN || '').trim();
const discordQueueRateLimitWindowMs = (() => {
  const parsed = Number(process.env.DISCORD_PROCESS_QUEUE_RATE_LIMIT_WINDOW_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) return 60_000;
  return Math.round(parsed);
})();
const discordQueueRateLimitMax = (() => {
  const parsed = Number(process.env.DISCORD_PROCESS_QUEUE_RATE_LIMIT_MAX);
  if (!Number.isFinite(parsed) || parsed <= 0) return 8;
  return Math.max(1, Math.round(parsed));
})();
const discordQueueRateLimitStore = new Map();

function normalizeIpAddress(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('::ffff:')) return raw.slice(7);
  return raw;
}

function isLoopbackRequest(req) {
  const remoteAddress = normalizeIpAddress(req?.socket?.remoteAddress || req?.connection?.remoteAddress || '');
  const requestIp = normalizeIpAddress(req?.ip || '');
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  const forwardedIp = normalizeIpAddress(forwarded);

  const candidates = [remoteAddress, requestIp, forwardedIp].filter(Boolean);
  if (!candidates.length) return false;
  return candidates.every((candidate) => isLoopbackHost(candidate) || candidate === '::1');
}

function timingSafeTokenMatch(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function extractDiscordRequestToken(req) {
  const explicit = String(req?.headers?.['x-discord-token'] || '').trim();
  if (explicit) return explicit;
  const authHeader = String(req?.headers?.authorization || '').trim();
  if (/^bearer\s+/i.test(authHeader)) {
    return authHeader.replace(/^bearer\s+/i, '').trim();
  }
  return '';
}

function requireDiscordAccess(req, res, next) {
  if (AUTH_TOKEN) return next();

  if (DISCORD_API_TOKEN) {
    const provided = extractDiscordRequestToken(req);
    if (!provided || !timingSafeTokenMatch(provided, DISCORD_API_TOKEN)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized Discord request' });
    }
    return next();
  }

  if (!isLoopbackRequest(req)) {
    return res.status(403).json({
      ok: false,
      error: 'Discord endpoints require loopback access or DISCORD_API_TOKEN'
    });
  }
  return next();
}

function checkDiscordProcessQueueRateLimit(req) {
  const actorHint = String(req?.headers?.['x-user-id'] || '').trim();
  const keyBase = actorHint || normalizeIpAddress(req?.ip || req?.socket?.remoteAddress || '') || 'unknown';
  const key = `discord-process:${keyBase}`;
  const nowMs = Date.now();

  const current = discordQueueRateLimitStore.get(key) || { startedAtMs: nowMs, count: 0 };
  if ((nowMs - current.startedAtMs) >= discordQueueRateLimitWindowMs) {
    current.startedAtMs = nowMs;
    current.count = 0;
  }
  current.count += 1;
  discordQueueRateLimitStore.set(key, current);

  if (current.count > discordQueueRateLimitMax) {
    const retryAfterMs = Math.max(0, discordQueueRateLimitWindowMs - (nowMs - current.startedAtMs));
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      limit: discordQueueRateLimitMax,
      windowMs: discordQueueRateLimitWindowMs
    };
  }
  return { allowed: true };
}

app.use('/api/discord', requireDiscordAccess);

app.get('/api/discord/status', async (req, res) => {
  try {
    const status = await discordIntegrationService.getDiscordStatus({ sessionManager, workspaceManager });
    res.json(status);
  } catch (error) {
    logger.error('Failed to get Discord status', { error: error.message, stack: error.stack });
    res.status(500).json({ ok: false, error: 'Failed to get Discord status' });
  }
});

function parseDiscordBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return null;
}

app.post('/api/discord/ensure-services', async (req, res) => {
  try {
    const dangerousModeOverride = parseDiscordBoolean(req.body?.dangerousModeOverride);
    const status = await discordIntegrationService.ensureDiscordServices({
      sessionManager,
      workspaceManager,
      dangerousModeOverride
    });
    res.json(status);
  } catch (error) {
    logger.error('Failed to ensure Discord services', { error: error.message, stack: error.stack });
    const statusCode = Number(error?.statusCode || 0) || 500;
    res.status(statusCode).json({ ok: false, error: 'Failed to ensure Discord services', message: error.message, details: error?.details || undefined });
  }
});

app.post('/api/discord/process-queue', async (req, res) => {
  try {
    const rateLimit = checkDiscordProcessQueueRateLimit(req);
    if (!rateLimit.allowed) {
      res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
      return res.status(429).json({
        ok: false,
        error: 'Rate limit exceeded for discord queue processing',
        retryAfterSeconds: rateLimit.retryAfterSeconds,
        limit: rateLimit.limit,
        windowMs: rateLimit.windowMs
      });
    }

    const bodyIdempotencyKey = String(req.body?.idempotencyKey || '').trim();
    const headerIdempotencyKey = String(req.headers['idempotency-key'] || '').trim();
    const idempotencyKey = bodyIdempotencyKey || headerIdempotencyKey || null;
    const dangerousModeOverride = parseDiscordBoolean(req.body?.dangerousModeOverride);
    const requestId = String(req.body?.requestId || req.headers['x-request-id'] || '').trim() || null;
    const actor = String(req.body?.actor || req.headers['x-user-id'] || req.ip || '').trim() || null;

    const result = await discordIntegrationService.processDiscordQueue({
      sessionManager,
      workspaceManager,
      logger,
      idempotencyKey,
      requestId,
      actor,
      dangerousModeOverride
    });
    res.json(result);
  } catch (error) {
    logger.error('Failed to process Discord queue', { error: error.message, stack: error.stack });
    const statusCode = Number(error?.statusCode || 0) || 500;
    res.status(statusCode).json({ ok: false, error: 'Failed to process Discord queue', message: error.message, details: error?.details || undefined });
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
    try {
      commanderContextService.setContext(context, { source: 'voice.context' });
    } catch {
      // ignore
    }
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

// Upload image from clipboard paste (for terminal image paste feature)
app.post('/api/terminal/upload-image', imageUpload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const filePath = req.file.path;
    logger.info('Image uploaded for terminal paste', {
      filename: req.file.filename,
      path: filePath,
      size: req.file.size,
      mimetype: req.file.mimetype
    });

    // Return the absolute file path that can be used in Claude Code
    res.json({
      success: true,
      filePath: filePath,
      filename: req.file.filename,
      size: req.file.size
    });
  } catch (error) {
    logger.error('Image upload failed', { error: error.message });
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
const DESIRED_PORT = Number(process.env.ORCHESTRATOR_PORT || 9460);
const MAX_PORT_ATTEMPTS = 10;
const hostPolicy = evaluateBindSecurity({
  host: process.env.ORCHESTRATOR_HOST || process.env.HOST,
  authToken: AUTH_TOKEN,
  allowInsecureLanNoAuth: process.env.ORCHESTRATOR_ALLOW_INSECURE_LAN_NO_AUTH
});
const HOST = hostPolicy.host;

if (!hostPolicy.allowStart) {
  logger.error('Refusing to bind to a non-loopback host without AUTH_TOKEN. Set AUTH_TOKEN or set ORCHESTRATOR_ALLOW_INSECURE_LAN_NO_AUTH=1 to override.', { host: HOST, port: DESIRED_PORT });
  process.exit(1);
}

function tryListen(port, attempt) {
  httpServer.listen(port, HOST, () => {
    if (port !== DESIRED_PORT) {
      logger.info(`Port ${DESIRED_PORT} in use, bound to port ${port} instead`);
    }
    logger.info(`Server running on http://${HOST}:${port}`);
    // Expose actual port for other services to discover
    process.env.ORCHESTRATOR_PORT = String(port);

    if (!hostPolicy.isLoopback) {
      const bindType = hostPolicy.isBindAll ? 'bind-all' : 'explicit-host';
      logger.info(`LAN access enabled (${bindType}) on port ${port}`);
      if (!hostPolicy.hasAuthToken) {
        logger.warn('LAN access is enabled without AUTH_TOKEN. This is insecure; anyone on the network can control this orchestrator.', { host: HOST, port });
      }
    }
    if (hostPolicy.hasAuthToken) {
      logger.info('Authentication enabled');
    }

    // Start the Advanced Diff Viewer in the background.
    // Default: enabled, since users expect the diff viewer to be ready without manual terminal steps.
    const autoStartRaw = String(process.env.AUTO_START_DIFF_VIEWER ?? 'true').toLowerCase();
    const shouldAutoStartDiffViewer = !['0', 'false', 'no'].includes(autoStartRaw);
    if (shouldAutoStartDiffViewer) {
      diffViewerService.ensureRunning().catch((error) => {
        logger.warn('Diff viewer auto-start failed', { error: error.message });
      });
    }

    // Initialize sessions
    const shouldAutoEnsureDiscordServices = (() => {
      const envRaw = String(process.env.DISCORD_AUTO_ENSURE_SERVICES ?? '').trim().toLowerCase();
      if (envRaw) return !['0', 'false', 'no'].includes(envRaw);

      try {
        const cfg = userSettingsService?.settings?.global?.ui?.discord || {};
        return cfg.autoEnsureServicesAtStartup === true;
      } catch {
        return false;
      }
    })();

    workspaceSystemReady
      .then((workspaceReady) => {
        if (!workspaceReady) {
          return;
        }
        return sessionManager.initializeSessions();
      })
      .then(() => {
        if (!shouldAutoEnsureDiscordServices) return;
        // Don't block server startup; just best-effort keep Services running after restarts.
        return discordIntegrationService.ensureDiscordServices({ sessionManager, workspaceManager })
          .then(() => logger.info('Discord services ensured on startup'))
          .catch((error) => logger.warn('Failed to ensure Discord services on startup', { error: error.message }));
      })
      .catch((error) => {
        logger.error('Failed to initialize sessions', { error: error.message, stack: error.stack });
      });
  });

  httpServer.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < MAX_PORT_ATTEMPTS) {
      logger.warn(`Port ${port} in use, trying ${port + 1}...`);
      httpServer.close();
      tryListen(port + 1, attempt + 1);
    } else {
      logger.error('Failed to start server', { error: err.message, port, attempts: attempt });
      process.exit(1);
    }
  });
}

tryListen(DESIRED_PORT, 1);

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
