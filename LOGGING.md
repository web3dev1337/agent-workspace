# Claude Orchestrator Logging System

This document describes the structured logging system used throughout the Claude Orchestrator project.

## Overview

The logging system uses Winston for comprehensive, structured logging across all components. The system provides:

- Multiple log levels with configurable output
- File-based logging with rotation
- Structured JSON logs for machine processing
- Console output for development
- Service-specific log contexts

## Log Levels

The system uses Winston's standard log levels, in order of increasing verbosity:

1. `error` (0) - System errors, exceptions, critical failures
2. `warn` (1) - Warnings, deprecated usage, potential issues  
3. `info` (2) - General application flow, important events
4. `debug` (3) - Detailed information useful for debugging
5. `verbose` (4) - Very detailed information, typically too verbose for production
6. `silly` (5) - Everything, including sensitive information

## Log Categories & Context

Logs are organized by service/component context:

- **Server**: Main server operations, startup, shutdown
- **Sessions**: Terminal session lifecycle, PTY operations
- **Git**: Git operations, repository monitoring
- **Status**: Claude detection, status monitoring
- **Socket**: WebSocket connections, events
- **Notifications**: System notifications, alerts
- **Tauri**: Native app operations (when applicable)
- **DiffViewer**: Diff analysis operations

## Configuration

### Winston Configuration (server/index.js)
```javascript
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    // Error log - errors only
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 5
    }),
    
    // Combined log - all levels
    new winston.transports.File({ 
      filename: 'logs/combined.log',
      level: 'debug',
      maxsize: 10485760,
      maxFiles: 5
    }),
    
    // Console output for development
    new winston.transports.Console({
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});
```

### Environment Configuration
```bash
# .env
LOG_LEVEL=info              # Global log level
NODE_ENV=development        # Affects console output level
```

### Application Configuration (config.json)
```json
{
  "logging": {
    "level": "info",
    "maxFiles": 5,
    "maxSize": "10m",
    "enableConsole": true,
    "rotateDaily": true
  }
}
```

## Using the Logger

### Basic Logging
```javascript
// Import logger
const logger = require('./logger'); // or winston logger instance

// Basic log levels
logger.error('Critical error occurred', { 
  error: error.message,
  stack: error.stack,
  context: 'session-creation'
});

logger.warn('Deprecated API usage detected', {
  endpoint: '/api/old-endpoint',
  client: clientId
});

logger.info('Session created successfully', {
  sessionId: 'sess-123',
  type: 'claude',
  userId: 'user-456'
});

logger.debug('Processing terminal input', {
  sessionId: 'sess-123',
  inputLength: buffer.length,
  timestamp: Date.now()
});
```

### Service-Specific Logging
```javascript
// SessionManager
class SessionManager {
  constructor() {
    this.logger = logger.child({ service: 'SessionManager' });
  }
  
  createSession(config) {
    this.logger.info('Creating new session', { 
      type: config.type,
      cwd: config.cwd 
    });
    
    try {
      // ... session creation logic
      this.logger.info('Session created', { sessionId });
    } catch (error) {
      this.logger.error('Session creation failed', { 
        error: error.message,
        config 
      });
      throw error;
    }
  }
}

// GitHelper
class GitHelper {
  constructor() {
    this.logger = logger.child({ service: 'GitHelper' });
  }
  
  async getCurrentBranch() {
    this.logger.debug('Fetching current branch');
    
    try {
      const branch = await this.execGit(['branch', '--show-current']);
      this.logger.debug('Current branch retrieved', { branch });
      return branch.trim();
    } catch (error) {
      this.logger.error('Failed to get current branch', { 
        error: error.message 
      });
      throw error;
    }
  }
}
```

### Event-Based Logging
```javascript
// Socket.IO events
io.on('connection', (socket) => {
  logger.info('Client connected', { 
    socketId: socket.id,
    remoteAddress: socket.handshake.address
  });
  
  socket.on('create-session', (config) => {
    logger.info('Session creation requested', {
      socketId: socket.id,
      sessionType: config.type,
      timestamp: Date.now()
    });
  });
  
  socket.on('disconnect', (reason) => {
    logger.info('Client disconnected', {
      socketId: socket.id,
      reason,
      duration: Date.now() - socket.connectedAt
    });
  });
});
```

### Error Logging with Context
```javascript
// Comprehensive error logging
function handleError(error, context = {}) {
  logger.error('Unhandled error', {
    message: error.message,
    stack: error.stack,
    code: error.code,
    ...context,
    timestamp: Date.now()
  });
  
  // Additional context for specific error types
  if (error.code === 'ENOENT') {
    logger.error('File not found', {
      path: error.path,
      operation: context.operation
    });
  }
}

// Usage
try {
  await sessionManager.createSession(config);
} catch (error) {
  handleError(error, {
    operation: 'session-creation',
    sessionType: config.type,
    userId: req.user?.id
  });
  res.status(500).json({ error: 'Session creation failed' });
}
```

## Log File Structure

### Directory Structure
```
logs/
├── combined.log      # All log levels
├── error.log         # Errors only
├── git.log          # Git operations (optional)
├── sessions.log     # Session events (optional)  
└── notifications.log # Notification events (optional)
```

### Log Entry Format (JSON)
```json
{
  "level": "info",
  "message": "Session created successfully",
  "timestamp": "2024-08-29T10:30:45.123Z",
  "service": "SessionManager",
  "sessionId": "sess-abc123",
  "type": "claude",
  "userId": "user-456",
  "metadata": {
    "duration": 150,
    "pid": 12345
  }
}
```

### Console Output Format (Development)
```
2024-08-29 10:30:45 [INFO] SessionManager: Session created successfully 
  sessionId=sess-abc123 type=claude userId=user-456
```

## Log Analysis & Monitoring

### Common Log Queries
```bash
# View recent errors
tail -f logs/error.log | jq '.'

# Filter by service
grep '"service":"SessionManager"' logs/combined.log | jq '.'

# Filter by log level
grep '"level":"warn"' logs/combined.log | jq '.message, .timestamp'

# Session-specific logs
grep '"sessionId":"sess-abc123"' logs/combined.log | jq '.'

# Git operations
grep '"service":"GitHelper"' logs/combined.log | jq '.message, .timestamp'
```

### Log Rotation
- Files rotate when they exceed 10MB
- Keep 5 historical files per log type
- Automatic cleanup of old log files
- Compressed archives for long-term storage

## Performance Considerations

### Async Logging
```javascript
// Winston automatically handles async logging
logger.info('High-frequency event', largeObject);
// Non-blocking - returns immediately
```

### Log Level Performance
- Production: Use 'info' or 'warn' levels
- Development: Use 'debug' for detailed information
- Avoid 'silly' level in production (performance impact)

### Structured Data
```javascript
// Good - structured data
logger.info('Request processed', {
  method: req.method,
  url: req.url,
  duration: Date.now() - startTime,
  statusCode: res.statusCode
});

// Avoid - string concatenation
logger.info(`Request ${req.method} ${req.url} took ${duration}ms`);
```

## Security Considerations

### Sensitive Information
```javascript
// Never log sensitive data
const config = {
  apiKey: 'secret-key',
  username: 'user',
  password: 'secret'
};

// Bad
logger.info('Config loaded', config);

// Good - filter sensitive fields
logger.info('Config loaded', {
  username: config.username,
  hasApiKey: !!config.apiKey,
  configKeys: Object.keys(config).filter(k => !['password', 'apiKey'].includes(k))
});
```

### Log Sanitization
```javascript
function sanitizeLogData(data) {
  const sensitive = ['password', 'token', 'apiKey', 'secret', 'key'];
  const sanitized = { ...data };
  
  for (const key of Object.keys(sanitized)) {
    if (sensitive.some(s => key.toLowerCase().includes(s))) {
      sanitized[key] = '[REDACTED]';
    }
  }
  
  return sanitized;
}

logger.info('User authentication', sanitizeLogData(authData));
```

## Troubleshooting

### Common Issues

#### Log Files Not Created
- Check directory permissions for `logs/` folder
- Ensure Winston has write permissions
- Verify disk space availability

#### Console Output Not Showing
- Check `LOG_LEVEL` environment variable
- Verify console transport is enabled
- Check if output is being redirected

#### Performance Issues
- Reduce log level in production
- Disable unnecessary transports
- Use log sampling for high-frequency events

#### Log Rotation Not Working
- Check file size limits in configuration
- Verify maxFiles setting
- Ensure adequate disk space

## Best Practices

### Development
1. **Use appropriate log levels** - debug for detailed info, info for flow
2. **Include context** - always provide relevant metadata
3. **Avoid logging in loops** - can impact performance
4. **Use child loggers** - create service-specific contexts
5. **Test logging** - ensure logs provide useful debugging information

### Production
1. **Set appropriate levels** - info or warn for production
2. **Monitor log files** - set up log monitoring/alerting
3. **Secure log files** - proper file permissions and access
4. **Log rotation** - prevent disk space issues
5. **Regular cleanup** - archive or delete old logs

### Security
1. **Never log secrets** - API keys, passwords, tokens
2. **Sanitize user input** - prevent log injection
3. **Limit log access** - restrict who can read logs
4. **Encrypt sensitive logs** - if they contain PII
5. **Audit log access** - track who reads log files