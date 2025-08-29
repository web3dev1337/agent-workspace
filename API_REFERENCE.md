# Claude Orchestrator API Reference

Complete API reference for backend/frontend communication in the Claude Orchestrator project.

*Note: This serves as the compressed API reference similar to HyFire2's HYTOPIA_API_COMPRESSED.ts - never guess API methods, always reference this document.*

## Quick Reference Types

```typescript
// Core Types
type SessionId = string;
type SessionType = 'claude' | 'server' | 'general';
type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'verbose';
type GitStatus = 'clean' | 'dirty' | 'ahead' | 'behind' | 'diverged';
type NotificationType = 'info' | 'warning' | 'error' | 'success';

// Session Configuration
interface SessionConfig {
  type: SessionType;
  cwd?: string;
  shell?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
}

// Session Info
interface SessionInfo {
  id: SessionId;
  type: SessionType;
  config: SessionConfig;
  created: number;
  lastActivity: number;
  pid?: number;
}

// Git Information
interface GitInfo {
  branch: string;
  status: GitStatus;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
  stash: number;
  remote?: string;
  lastCommit?: string;
}

// Status Information
interface StatusInfo {
  server: {
    uptime: number;
    sessions: number;
    memory: NodeJS.MemoryUsage;
  };
  git: GitInfo;
  claude: {
    detected: boolean;
    version?: string;
    sessions: number;
  };
}
```

## REST API Endpoints

### Server Status
```typescript
// GET /api/status
Response: StatusInfo

// GET /api/health
Response: { status: 'ok' | 'error', timestamp: number }
```

### Session Management
```typescript
// GET /api/sessions
Response: SessionInfo[]

// POST /api/sessions
Body: SessionConfig
Response: { id: SessionId, ...SessionInfo }

// DELETE /api/sessions/:id
Response: { success: boolean, message?: string }

// GET /api/sessions/:id/status
Response: { 
  active: boolean, 
  pid?: number, 
  lastActivity: number 
}
```

### Git Operations
```typescript
// GET /api/git/status
Response: GitInfo

// GET /api/git/branches
Response: {
  current: string;
  local: string[];
  remote: string[];
}

// POST /api/git/command
Body: { command: string, args: string[] }
Response: { 
  success: boolean, 
  stdout: string, 
  stderr: string, 
  exitCode: number 
}

// GET /api/git/log
Query: { limit?: number, skip?: number }
Response: {
  commits: Array<{
    hash: string;
    message: string;
    author: string;
    date: string;
  }>;
}
```

### Configuration
```typescript
// GET /api/config
Response: AppConfig

// PUT /api/config
Body: Partial<AppConfig>
Response: { success: boolean, config: AppConfig }
```

## Socket.IO Events

### Server → Client Events

#### Session Events
```typescript
// session-created
Payload: SessionInfo

// session-destroyed  
Payload: { id: SessionId, reason?: string }

// terminal-output
Payload: { 
  sessionId: SessionId, 
  data: string | Buffer,
  timestamp: number 
}

// session-exit
Payload: { 
  sessionId: SessionId, 
  exitCode: number,
  signal?: string 
}

// sessions-list
Payload: SessionInfo[]
```

#### Status & Monitoring Events
```typescript
// status-change
Payload: StatusInfo

// git-change
Payload: GitInfo

// claude-detected
Payload: {
  version: string;
  sessionCount: number;
  timestamp: number;
}

// file-change
Payload: {
  path: string;
  event: 'add' | 'change' | 'unlink';
  timestamp: number;
}
```

#### System Events
```typescript
// notification
Payload: {
  type: NotificationType;
  message: string;
  title?: string;
  timeout?: number;
}

// error
Payload: {
  code: string;
  message: string;
  details?: any;
  timestamp: number;
}

// server-shutdown
Payload: { 
  reason: string,
  graceful: boolean,
  timestamp: number 
}
```

### Client → Server Events

#### Session Management
```typescript
// create-session
Payload: SessionConfig
Response: SessionInfo | { error: string }

// destroy-session
Payload: { sessionId: SessionId }
Response: { success: boolean }

// terminal-input
Payload: { 
  sessionId: SessionId, 
  input: string | Buffer 
}

// resize-terminal
Payload: { 
  sessionId: SessionId, 
  cols: number, 
  rows: number 
}

// list-sessions
Response: SessionInfo[]
```

#### Control Events
```typescript
// request-status
Response: StatusInfo

// request-git-status
Response: GitInfo

// subscribe-to-changes
Payload: { 
  types: Array<'git' | 'sessions' | 'files' | 'claude'> 
}

// unsubscribe-from-changes
Payload: { 
  types: Array<'git' | 'sessions' | 'files' | 'claude'> 
}
```

#### Configuration Events
```typescript
// update-config
Payload: Partial<AppConfig>
Response: { success: boolean, config: AppConfig }

// get-config
Response: AppConfig
```

## Service APIs

### SessionManager
```typescript
class SessionManager {
  static getInstance(): SessionManager;
  
  createSession(config: SessionConfig): Promise<SessionInfo>;
  destroySession(id: SessionId): Promise<boolean>;
  getSession(id: SessionId): SessionInfo | null;
  getActiveSessions(): SessionInfo[];
  
  writeToSession(id: SessionId, data: string | Buffer): boolean;
  resizeSession(id: SessionId, cols: number, rows: number): boolean;
  
  cleanup(): Promise<void>;
  
  // Event handlers
  onSessionOutput(callback: (id: SessionId, data: string | Buffer) => void): void;
  onSessionExit(callback: (id: SessionId, exitCode: number, signal?: string) => void): void;
}
```

### StatusDetector  
```typescript
class StatusDetector {
  static getInstance(): StatusDetector;
  
  startMonitoring(): void;
  stopMonitoring(): void;
  
  getCurrentStatus(): StatusInfo;
  getGitInfo(): GitInfo;
  getClaudeInfo(): { detected: boolean, version?: string, sessions: number };
  
  // Event handlers
  onStatusChange(callback: (status: StatusInfo) => void): void;
  onGitChange(callback: (git: GitInfo) => void): void;
  onClaudeDetected(callback: (info: any) => void): void;
}
```

### GitHelper
```typescript
class GitHelper {
  static getInstance(): GitHelper;
  
  getCurrentBranch(): Promise<string>;
  getStatus(): Promise<GitStatus>;
  getBranchInfo(): Promise<{ ahead: number, behind: number }>;
  getStageInfo(): Promise<{ staged: number, unstaged: number, untracked: number }>;
  
  getAllBranches(): Promise<{ local: string[], remote: string[] }>;
  getCommitHistory(limit?: number, skip?: number): Promise<Commit[]>;
  
  executeCommand(command: string, args: string[]): Promise<{
    stdout: string;
    stderr: string; 
    exitCode: number;
  }>;
  
  // Event handlers
  onBranchChange(callback: (branch: string) => void): void;
  onStatusChange(callback: (status: GitStatus) => void): void;
}
```

### NotificationService
```typescript  
class NotificationService {
  static getInstance(): NotificationService;
  
  send(type: NotificationType, message: string, options?: {
    title?: string;
    timeout?: number;
  }): void;
  
  info(message: string, options?: NotificationOptions): void;
  warning(message: string, options?: NotificationOptions): void;
  error(message: string, options?: NotificationOptions): void;
  success(message: string, options?: NotificationOptions): void;
}
```

## Configuration Schema

### Application Configuration (config.json)
```typescript
interface AppConfig {
  server: {
    port: number;
    host?: string;
    cors: {
      origins: string[];
      credentials: boolean;
    };
  };
  
  sessions: {
    maxConcurrent: number;
    timeout: number;
    cleanupInterval: number;
    defaultShell?: string;
  };
  
  monitoring: {
    statusInterval: number;
    gitInterval: number;
    claudeDetection: boolean;
    fileWatching: boolean;
  };
  
  logging: {
    level: LogLevel;
    maxFiles: number;
    maxSize: string;
    enableConsole: boolean;
  };
  
  ui: {
    theme?: 'dark' | 'light' | 'auto';
    gridLayout: {
      rows: number;
      cols: number;
    };
    terminal: {
      fontSize: number;
      fontFamily: string;
      cursorBlink: boolean;
    };
  };
  
  notifications: {
    enabled: boolean;
    types: NotificationType[];
    timeout: number;
  };
}
```

## Error Codes & Messages

### Session Errors
```typescript
const SESSION_ERRORS = {
  SESSION_NOT_FOUND: 'Session with ID {id} not found',
  SESSION_LIMIT_REACHED: 'Maximum number of sessions ({max}) reached',
  INVALID_SESSION_CONFIG: 'Invalid session configuration: {details}',
  PTY_SPAWN_ERROR: 'Failed to spawn PTY process: {error}',
  SESSION_ALREADY_DESTROYED: 'Session {id} has already been destroyed'
} as const;
```

### Git Errors
```typescript
const GIT_ERRORS = {
  NOT_A_GIT_REPO: 'Current directory is not a git repository',
  GIT_COMMAND_FAILED: 'Git command failed: {command}',
  BRANCH_NOT_FOUND: 'Branch {branch} not found',
  UNCOMMITTED_CHANGES: 'Cannot perform operation with uncommitted changes',
  NETWORK_ERROR: 'Git network operation failed: {details}'
} as const;
```

### Server Errors
```typescript
const SERVER_ERRORS = {
  SERVICE_UNAVAILABLE: 'Service temporarily unavailable',
  CONFIGURATION_ERROR: 'Configuration error: {details}',
  RESOURCE_LIMIT: 'Resource limit exceeded: {resource}',
  PERMISSION_DENIED: 'Permission denied for operation: {operation}',
  INVALID_REQUEST: 'Invalid request format or parameters'
} as const;
```

## Usage Examples

### Creating a Claude Session
```typescript
// Client-side
socket.emit('create-session', {
  type: 'claude',
  cwd: '/path/to/project',
  env: { CLAUDE_API_KEY: 'key' }
}, (response) => {
  if (response.error) {
    console.error('Failed to create session:', response.error);
  } else {
    console.log('Session created:', response.id);
  }
});
```

### Monitoring Git Changes
```typescript
// Server-side
gitHelper.onBranchChange((branch) => {
  io.emit('git-change', gitHelper.getCurrentStatus());
});

// Client-side
socket.on('git-change', (gitInfo) => {
  updateBranchDisplay(gitInfo.branch);
  updateStatusIndicators(gitInfo.status);
});
```

### Handling Terminal Output
```typescript
// Server-side
sessionManager.onSessionOutput((sessionId, data) => {
  io.emit('terminal-output', { sessionId, data, timestamp: Date.now() });
});

// Client-side
socket.on('terminal-output', ({ sessionId, data }) => {
  const terminal = getTerminalById(sessionId);
  terminal.write(data);
});
```

## Rate Limits & Performance

### API Rate Limits
- Session creation: 10 per minute per client
- Git commands: 30 per minute per client  
- Configuration updates: 5 per minute per client

### Performance Considerations
- Terminal output is buffered and throttled
- Git status polling has configurable intervals
- Session cleanup runs every 60 seconds by default
- WebSocket events are batched when possible

## Authentication & Security

### Session Security
- Sessions are isolated per client connection
- PTY processes run with current user permissions
- File system access restricted to project directory

### API Security  
- CORS configuration restricts origins
- Input validation on all endpoints
- Rate limiting prevents abuse
- Git commands are validated and sanitized