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
}

module.exports = { PortRegistry };
