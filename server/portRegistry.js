const winston = require('winston');
const { exec } = require('child_process');
const util = require('util');
const os = require('os');
const net = require('net');
const fs = require('fs').promises;
const path = require('path');
const execAsync = util.promisify(exec);

// Custom port labels file
const PORT_LABELS_FILE = path.join(process.env.HOME || os.homedir(), '.orchestrator', 'port-labels.json');

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
  3000,  // Agent Workspace server
  4000,  // Agent Workspace dev server
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
    // Cross-platform: try to bind briefly.
    return await new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => {
        try { server.close(); } catch {}
        resolve(false);
      });
      server.once('listening', () => {
        server.close(() => resolve(true));
      });
      // Use 0.0.0.0 because our launched servers often bind to all interfaces.
      server.listen({ port, host: '0.0.0.0' });
    });
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
   * Load custom port labels from config file
   */
  async loadPortLabels() {
    try {
      const data = await fs.readFile(PORT_LABELS_FILE, 'utf8');
      return JSON.parse(data);
    } catch (e) {
      return {};
    }
  }

  /**
   * Save custom port label
   */
  async savePortLabel(port, label) {
    const labels = await this.loadPortLabels();
    labels[port] = label;
    await fs.mkdir(path.dirname(PORT_LABELS_FILE), { recursive: true });
    await fs.writeFile(PORT_LABELS_FILE, JSON.stringify(labels, null, 2));
    return labels;
  }

  /**
   * Get the working directory of a process
   */
  async getProcessCwd(pid) {
    try {
      const cwd = await fs.readlink(`/proc/${pid}/cwd`);
      return cwd;
    } catch (e) {
      return null;
    }
  }

  /**
   * Walk up directory tree to find worktree context (work1, work2, master, etc.)
   * Returns { worktree: 'work1', project: 'zoo-game', projectPath: '/home/...' }
   */
  async detectWorktreeContext(cwd) {
    if (!cwd) return null;

    const worktreePattern = /^(work\d+|master)$/;
    let currentPath = cwd;
    const root = path.parse(cwd).root;

    // Walk up looking for worktree folder
    while (currentPath !== root) {
      const folderName = path.basename(currentPath);

      if (worktreePattern.test(folderName)) {
        // Found a worktree! Parent is the project
        const projectPath = path.dirname(currentPath);
        const projectName = path.basename(projectPath);

        // Try to get a better project name from package.json or similar
        let displayName = projectName;
        try {
          // Check master folder for package.json if we're in a worktree
          const masterPath = path.join(projectPath, 'master');
          const pkgPath = path.join(masterPath, 'package.json');
          const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
          if (pkg.name) displayName = pkg.name;
        } catch (e) {
          // Try the project folder itself
          try {
            const pkgPath = path.join(projectPath, 'package.json');
            const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
            if (pkg.name) displayName = pkg.name;
          } catch (e2) {}
        }

        return {
          worktree: folderName,
          project: displayName,
          projectPath: projectPath,
          subPath: path.relative(currentPath, cwd) || null
        };
      }

      currentPath = path.dirname(currentPath);
    }

    return null;
  }

  /**
   * Try to detect project name from a directory
   */
  async detectProjectName(cwd) {
    if (!cwd) return null;

    try {
      // First, detect worktree context
      const worktreeContext = await this.detectWorktreeContext(cwd);

      let name = null;
      let type = 'unknown';
      let source = 'directory';

      // Try package.json first
      const packageJsonPath = path.join(cwd, 'package.json');
      try {
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
        if (packageJson.name) {
          name = packageJson.name;
          type = 'node';
          source = 'package.json';
        }
      } catch (e) {}

      // Try Gemfile (Ruby)
      if (!name) {
        const gemfilePath = path.join(cwd, 'Gemfile');
        try {
          await fs.access(gemfilePath);
          const gemfile = await fs.readFile(gemfilePath, 'utf8');
          if (gemfile.includes('rails')) {
            try {
              const appRb = await fs.readFile(path.join(cwd, 'config', 'application.rb'), 'utf8');
              const match = appRb.match(/module\s+(\w+)/);
              if (match) {
                name = match[1];
                type = 'rails';
                source = 'config/application.rb';
              }
            } catch (e) {}
            if (!name) {
              name = path.basename(cwd);
              type = 'rails';
              source = 'Gemfile';
            }
          } else {
            name = path.basename(cwd);
            type = 'ruby';
            source = 'Gemfile';
          }
        } catch (e) {}
      }

      // Try pyproject.toml (Python)
      if (!name) {
        try {
          const pyproject = await fs.readFile(path.join(cwd, 'pyproject.toml'), 'utf8');
          const match = pyproject.match(/name\s*=\s*["']([^"']+)["']/);
          if (match) {
            name = match[1];
            type = 'python';
            source = 'pyproject.toml';
          }
        } catch (e) {}
      }

      // Fall back to directory name
      if (!name) {
        name = path.basename(cwd);
      }

      return {
        name,
        type,
        source,
        worktree: worktreeContext?.worktree || null,
        project: worktreeContext?.project || null,
        subPath: worktreeContext?.subPath || null
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * Scan all listening ports on the system
   * @returns {Promise<Array>} Array of port info objects
   */
  async scanAllPorts() {
    try {
      // Load custom labels
      const customLabels = await this.loadPortLabels();

      if (process.platform === 'win32') {
        return await this.scanAllPortsWindows(customLabels);
      }

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

        // Get working directory and detect project
        const cwd = pid ? await this.getProcessCwd(pid) : null;
        const projectInfo = cwd ? await this.detectProjectName(cwd) : null;

        // Identify the service
        const serviceInfo = this.identifyService(port, processName, projectInfo);

        // Apply custom label if exists
        const customLabel = customLabels[port];

        ports.push({
          port,
          pid,
          processName,
          cwd,
          project: projectInfo,
          customLabel,
          ...serviceInfo,
          // Override name if custom label exists
          name: customLabel || serviceInfo.name,
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

  async scanAllPortsWindows(customLabels = {}) {
    try {
      const { stdout } = await execAsync('netstat -ano -p tcp', { timeout: 8000, maxBuffer: 10 * 1024 * 1024 });
      const lines = String(stdout || '').split('\n');

      const portToPid = new Map();
      for (const line of lines) {
        // Example:
        // TCP    0.0.0.0:3000     0.0.0.0:0     LISTENING       12345
        const m = line.match(/^\s*TCP\s+(\S+)\s+(\S+)\s+LISTENING\s+(\d+)\s*$/i);
        if (!m) continue;

        const local = m[1];
        const pid = Number(m[3]);
        if (!Number.isFinite(pid) || pid <= 0) continue;

        const portMatch = local.match(/:(\d+)\s*$/);
        if (!portMatch) continue;
        const port = Number(portMatch[1]);
        if (!Number.isFinite(port) || port < 1000) continue;

        if (!portToPid.has(port)) portToPid.set(port, pid);
      }

      const pidToName = await this.getWindowsProcessNameMap();

      const ports = [];
      for (const [port, pid] of portToPid.entries()) {
        const processName = pidToName.get(pid) || 'unknown';
        const projectInfo = null;
        const serviceInfo = this.identifyService(port, processName, projectInfo);
        const customLabel = customLabels[port];

        ports.push({
          port,
          pid,
          processName,
          cwd: null,
          project: projectInfo,
          customLabel,
          ...serviceInfo,
          name: customLabel || serviceInfo.name,
          url: `http://localhost:${port}`
        });
      }

      ports.sort((a, b) => a.port - b.port);
      return ports;
    } catch (error) {
      logger.error('Failed to scan ports (windows)', { error: error.message });
      return [];
    }
  }

  async getWindowsProcessNameMap() {
    const map = new Map();
    try {
      const { stdout } = await execAsync('tasklist /FO CSV /NH', { timeout: 8000, maxBuffer: 10 * 1024 * 1024 });
      const lines = String(stdout || '').split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const m = line.match(/^"([^"]*)","([^"]*)",/);
        if (!m) continue;
        const name = String(m[1] || '').trim();
        const pid = Number(String(m[2] || '').trim());
        if (!name || !Number.isFinite(pid) || pid <= 0) continue;
        map.set(pid, name);
      }
    } catch (error) {
      logger.debug('tasklist failed (windows)', { error: error.message });
    }
    return map;
  }

  /**
   * Identify a service based on port and process name
   * @param {number} port - Port number
   * @param {string} processName - Process name
   * @param {Object} projectInfo - Detected project info
   * @returns {Object} Service identification info
   */
  identifyService(port, processName, projectInfo = null) {
    // Known ports mapping
    const knownPorts = {
      3000: { name: 'Agent Workspace', type: 'orchestrator', icon: '🎛️' },
      4000: { name: 'Agent Workspace (Dev)', type: 'orchestrator-dev', icon: '🔧' },
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

    // If we have project info, use it
    if (projectInfo && projectInfo.name) {
      const typeIcons = {
        'node': '📦',
        'rails': '🛤️',
        'ruby': '💎',
        'python': '🐍',
        'unknown': '📁'
      };
      return {
        name: projectInfo.name,
        type: projectInfo.type || 'unknown',
        icon: typeIcons[projectInfo.type] || '📁',
        detectedFrom: projectInfo.source
      };
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
