const winston = require('winston');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/ports.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

// Configuration
const PORT_RANGE_START = 8080;
const PORT_RANGE_END = 8199;
const RESERVED_PORTS = [
  3000,  // Claude Orchestrator server
  4000,  // Claude Orchestrator dev server
  2080,  // Client dev server
  2081,  // Client dev server (dev instance)
  7655,  // Diff viewer
  7656,  // Diff viewer (dev instance)
];

class PortRegistry {
  constructor() {
    // Map of "repoPath:worktreeId" -> port
    this.assignments = new Map();
    // Set of all ports currently in use (by us)
    this.usedPorts = new Set();
    // Track when ports were assigned (for cleanup)
    this.assignmentTimestamps = new Map();
  }

  static getInstance() {
    if (!PortRegistry.instance) {
      PortRegistry.instance = new PortRegistry();
    }
    return PortRegistry.instance;
  }

  /**
   * Get or assign a port for a repository/worktree combination
   * @param {string} repoPath - Repository path
   * @param {string} worktreeId - Worktree ID (e.g., 'work1')
   * @returns {Promise<number>} Assigned port number
   */
  async getPort(repoPath, worktreeId) {
    const key = this.makeKey(repoPath, worktreeId);

    // Check if already assigned
    if (this.assignments.has(key)) {
      const port = this.assignments.get(key);
      logger.debug('Returning cached port', { repoPath, worktreeId, port });
      return port;
    }

    // Find an available port
    const port = await this.findAvailablePort();
    if (port === null) {
      throw new Error('No available ports in range');
    }

    // Assign it
    this.assignments.set(key, port);
    this.usedPorts.add(port);
    this.assignmentTimestamps.set(key, Date.now());

    logger.info('Assigned new port', { repoPath, worktreeId, port });
    return port;
  }

  /**
   * Release a port assignment
   * @param {string} repoPath - Repository path
   * @param {string} worktreeId - Worktree ID
   */
  releasePort(repoPath, worktreeId) {
    const key = this.makeKey(repoPath, worktreeId);

    if (this.assignments.has(key)) {
      const port = this.assignments.get(key);
      this.assignments.delete(key);
      this.usedPorts.delete(port);
      this.assignmentTimestamps.delete(key);

      logger.info('Released port', { repoPath, worktreeId, port });
    }
  }

  /**
   * Get all current port assignments
   * @returns {Object} Map of assignments with port info
   */
  getAllAssignments() {
    const result = {};
    for (const [key, port] of this.assignments) {
      const [repoPath, worktreeId] = this.parseKey(key);
      result[key] = {
        repoPath,
        worktreeId,
        port,
        assignedAt: this.assignmentTimestamps.get(key)
      };
    }
    return result;
  }

  /**
   * Find an available port in the range
   * @returns {Promise<number|null>} Available port or null if none
   */
  async findAvailablePort() {
    for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
      // Skip reserved ports
      if (RESERVED_PORTS.includes(port)) continue;

      // Skip ports we've already assigned
      if (this.usedPorts.has(port)) continue;

      // Check if port is actually free on the system
      const isFree = await this.isPortFree(port);
      if (isFree) {
        return port;
      }
    }

    return null;
  }

  /**
   * Check if a port is free on the system
   * @param {number} port - Port to check
   * @returns {Promise<boolean>} True if port is free
   */
  async isPortFree(port) {
    try {
      // Use lsof to check if port is in use
      await execAsync(`lsof -i :${port}`, { timeout: 2000 });
      // If lsof succeeds, port is in use
      return false;
    } catch (error) {
      // If lsof fails with exit code 1, port is free
      // (lsof returns 1 when no processes are found)
      return true;
    }
  }

  /**
   * Suggest a port based on worktree number (for backward compatibility)
   * Falls back to sequential if suggested port is taken
   * @param {number} worktreeNum - Worktree number (1, 2, 3, etc.)
   * @param {string} repoPath - Repository path
   * @param {string} worktreeId - Worktree ID
   * @returns {Promise<number>} Suggested port
   */
  async suggestPort(worktreeNum, repoPath, worktreeId) {
    const key = this.makeKey(repoPath, worktreeId);

    // Check if already assigned
    if (this.assignments.has(key)) {
      return this.assignments.get(key);
    }

    // Calculate preferred port based on worktree number
    const preferredPort = PORT_RANGE_START + worktreeNum - 1;

    // Check if preferred port is available
    if (!this.usedPorts.has(preferredPort) && !RESERVED_PORTS.includes(preferredPort)) {
      const isFree = await this.isPortFree(preferredPort);
      if (isFree) {
        // Assign the preferred port
        this.assignments.set(key, preferredPort);
        this.usedPorts.add(preferredPort);
        this.assignmentTimestamps.set(key, Date.now());

        logger.info('Assigned preferred port', { repoPath, worktreeId, port: preferredPort });
        return preferredPort;
      }
    }

    // Fall back to any available port
    return this.getPort(repoPath, worktreeId);
  }

  /**
   * Clean up stale assignments (older than timeout)
   * @param {number} timeoutMs - Timeout in milliseconds (default 24 hours)
   */
  cleanupStale(timeoutMs = 24 * 60 * 60 * 1000) {
    const now = Date.now();
    const toRemove = [];

    for (const [key, timestamp] of this.assignmentTimestamps) {
      if (now - timestamp > timeoutMs) {
        toRemove.push(key);
      }
    }

    for (const key of toRemove) {
      const port = this.assignments.get(key);
      this.assignments.delete(key);
      this.usedPorts.delete(port);
      this.assignmentTimestamps.delete(key);

      logger.info('Cleaned up stale port assignment', { key, port });
    }

    return toRemove.length;
  }

  makeKey(repoPath, worktreeId) {
    return `${repoPath}:${worktreeId}`;
  }

  parseKey(key) {
    const lastColon = key.lastIndexOf(':');
    return [key.slice(0, lastColon), key.slice(lastColon + 1)];
  }

  /**
   * Get port info for display in UI
   * @param {string} repoPath - Repository path
   * @param {string} worktreeId - Worktree ID
   * @returns {Object|null} Port info or null if not assigned
   */
  getPortInfo(repoPath, worktreeId) {
    const key = this.makeKey(repoPath, worktreeId);
    if (!this.assignments.has(key)) {
      return null;
    }

    return {
      port: this.assignments.get(key),
      assignedAt: this.assignmentTimestamps.get(key),
      url: `http://localhost:${this.assignments.get(key)}`
    };
  }

  /**
   * Scan all listening ports on the system
   * @returns {Promise<Array>} Array of port info objects
   */
  async scanAllPorts() {
    try {
      // Use ss (socket statistics) to get listening ports
      const { stdout } = await execAsync('ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null', { timeout: 5000 });
      const ports = [];
      const lines = stdout.split('\n');

      for (const line of lines) {
        // Parse ss output: LISTEN  0  511  *:3000  *:*  users:(("node",pid=12345,fd=20))
        // Or netstat: tcp  0  0  0.0.0.0:3000  0.0.0.0:*  LISTEN  12345/node
        const portMatch = line.match(/:(\d+)\s/);
        if (!portMatch) continue;

        const port = parseInt(portMatch[1], 10);
        if (port < 1000) continue; // Skip low ports

        // Extract process info
        let processName = 'unknown';
        let pid = null;

        // ss format: users:(("node",pid=12345,fd=20))
        const ssMatch = line.match(/users:\(\("([^"]+)",pid=(\d+)/);
        if (ssMatch) {
          processName = ssMatch[1];
          pid = parseInt(ssMatch[2], 10);
        }

        // netstat format: 12345/node
        const netstatMatch = line.match(/(\d+)\/(\S+)/);
        if (netstatMatch) {
          pid = parseInt(netstatMatch[1], 10);
          processName = netstatMatch[2];
        }

        // Skip duplicates
        if (ports.find(p => p.port === port)) continue;

        // Identify the service
        const serviceInfo = this.identifyService(port, processName);

        ports.push({
          port,
          pid,
          processName,
          ...serviceInfo,
          url: `http://localhost:${port}`
        });
      }

      // Sort by port number
      ports.sort((a, b) => a.port - b.port);

      return ports;
    } catch (error) {
      logger.error('Failed to scan ports', { error: error.message });
      return [];
    }
  }

  /**
   * Identify a service based on port and process name
   * @param {number} port - Port number
   * @param {string} processName - Process name
   * @returns {Object} Service identification info
   */
  identifyService(port, processName) {
    // Known ports mapping
    const knownPorts = {
      3000: { name: 'Claude Orchestrator', type: 'orchestrator', icon: '🎛️' },
      4000: { name: 'Claude Orchestrator (Dev)', type: 'orchestrator-dev', icon: '🔧' },
      2080: { name: 'Orchestrator Client', type: 'client', icon: '🖥️' },
      2081: { name: 'Orchestrator Client (Dev)', type: 'client-dev', icon: '🖥️' },
      7655: { name: 'Diff Viewer', type: 'diff-viewer', icon: '📝' },
      7656: { name: 'Diff Viewer (Dev)', type: 'diff-viewer-dev', icon: '📝' },
      5173: { name: 'Vite Dev Server', type: 'vite', icon: '⚡' },
      5174: { name: 'Vite Dev Server', type: 'vite', icon: '⚡' },
      3001: { name: 'React Dev Server', type: 'react', icon: '⚛️' },
      8080: { name: 'Web Server', type: 'web', icon: '🌐' },
      8000: { name: 'Python Server', type: 'python', icon: '🐍' },
      5000: { name: 'Flask/Dev Server', type: 'flask', icon: '🌶️' },
      4321: { name: 'Astro Dev', type: 'astro', icon: '🚀' },
      1420: { name: 'Tauri Dev', type: 'tauri', icon: '🦀' },
      1421: { name: 'Tauri Dev', type: 'tauri', icon: '🦀' },
    };

    // Check known ports first
    if (knownPorts[port]) {
      return knownPorts[port];
    }

    // Check port range for orchestrator-assigned ports
    if (port >= 8080 && port <= 8199) {
      // Check if we assigned this port
      for (const [key, assignedPort] of this.assignments) {
        if (assignedPort === port) {
          const [repoPath, worktreeId] = this.parseKey(key);
          const repoName = repoPath.split('/').pop() || repoPath;
          return {
            name: `${repoName} (${worktreeId})`,
            type: 'game-server',
            icon: '🎮',
            repoPath,
            worktreeId
          };
        }
      }
    }

    // Guess based on process name
    const processGuesses = {
      'node': { name: 'Node.js App', type: 'node', icon: '📦' },
      'python': { name: 'Python App', type: 'python', icon: '🐍' },
      'python3': { name: 'Python App', type: 'python', icon: '🐍' },
      'ruby': { name: 'Ruby App', type: 'ruby', icon: '💎' },
      'java': { name: 'Java App', type: 'java', icon: '☕' },
      'nginx': { name: 'Nginx', type: 'nginx', icon: '🌐' },
      'apache': { name: 'Apache', type: 'apache', icon: '🌐' },
      'php': { name: 'PHP App', type: 'php', icon: '🐘' },
      'dotnet': { name: '.NET App', type: 'dotnet', icon: '🔷' },
      'go': { name: 'Go App', type: 'go', icon: '🐹' },
    };

    if (processGuesses[processName]) {
      return { ...processGuesses[processName], name: `${processGuesses[processName].name} (:${port})` };
    }

    return {
      name: `${processName || 'Unknown'} (:${port})`,
      type: 'unknown',
      icon: '❓'
    };
  }
}

module.exports = { PortRegistry };
