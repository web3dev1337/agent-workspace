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
const sessionManager = new SessionManager(io);
const statusDetector = new StatusDetector();
const gitHelper = new GitHelper();
const notificationService = new NotificationService(io);

// Connect services
sessionManager.setStatusDetector(statusDetector);
sessionManager.setGitHelper(gitHelper);

// WebSocket connection handling
io.on('connection', (socket) => {
  logger.info('Client connected', { socketId: socket.id });
  
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
  socket.on('server-control', ({ sessionId, action }) => {
    logger.info('Server control request', { sessionId, action });
    
    if (action === 'start') {
      // Extract worktree number and assign port accordingly
      const worktreeMatch = sessionId.match(/work(\d+)/);
      const worktreeNum = worktreeMatch ? parseInt(worktreeMatch[1]) : 1;
      const port = 8080 + worktreeNum - 1; // work1=8080, work2=8081, etc.
      
      // Clear any existing input first with Ctrl+C, then send command
      sessionManager.writeToSession(sessionId, '\x03'); // Ctrl+C to clear
      
      setTimeout(() => {
        const command = `PORT=${port} hytopia start\n`;
        logger.info('Starting server with command', { sessionId, command, port });
        
        const written = sessionManager.writeToSession(sessionId, command);
        if (!written) {
          logger.error('Failed to write command to session', { sessionId });
          return;
        }
        
        // Emit port info back to client
        socket.emit('server-started', { sessionId, port });
      }, 100); // Small delay after Ctrl+C
    } else if (action === 'stop') {
      sessionManager.writeToSession(sessionId, '\x03'); // Ctrl+C
    } else if (action === 'kill') {
      sessionManager.writeToSession(sessionId, '\x03\x03'); // Double Ctrl+C
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