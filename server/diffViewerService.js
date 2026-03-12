const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/diff-viewer-autostart.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

// Helper function to get the appropriate shell for the platform
function getDefaultShell() {
  return process.platform === 'win32' ? 'powershell.exe' : 'bash';
}

class DiffViewerService {
  constructor() {
    this.diffViewerRoot = path.join(__dirname, '..', 'diff-viewer');
    this.port = parseInt(process.env.DIFF_VIEWER_PORT || '7655', 10);
    this.baseUrl = `http://localhost:${this.port}`;

    this.processInfo = null; // { pid, startedAt, logPath }
    this.startingPromise = null;
    this.buildingPromise = null;
  }

  static getInstance() {
    if (!DiffViewerService.instance) {
      DiffViewerService.instance = new DiffViewerService();
    }
    return DiffViewerService.instance;
  }

  async getStatus() {
    const running = await this.checkHealth();
    return {
      running,
      baseUrl: this.baseUrl,
      port: this.port,
      process: this.processInfo
    };
  }

  async ensureRunning() {
    if (await this.checkHealth()) {
      const clientBuild = await this.ensureClientBuiltIfStale().catch((error) => {
        logger.warn('Diff viewer client rebuild failed', { error: error.message });
        return { attempted: true, built: false, error: error.message };
      });
      return {
        running: true,
        started: false,
        baseUrl: this.baseUrl,
        port: this.port,
        process: this.processInfo,
        clientBuild
      };
    }

    if (!this.startingPromise) {
      this.startingPromise = this.start().finally(() => {
        this.startingPromise = null;
      });
    }

    await this.startingPromise;

    const running = await this.checkHealth();
    return {
      running,
      started: true,
      baseUrl: this.baseUrl,
      port: this.port,
      process: this.processInfo
    };
  }

  ensureClientBuiltIfStale() {
    if (!this.needsClientBuild()) {
      return Promise.resolve({ attempted: false, built: false });
    }

    if (!this.buildingPromise) {
      this.buildingPromise = this.buildClient().finally(() => {
        this.buildingPromise = null;
      });
    }

    return this.buildingPromise;
  }

  needsClientBuild() {
    const clientDir = path.join(this.diffViewerRoot, 'client');
    const distIndex = path.join(clientDir, 'dist', 'index.html');

    if (!fs.existsSync(distIndex)) return true;

    let distMtimeMs = 0;
    try {
      distMtimeMs = fs.statSync(distIndex).mtimeMs;
    } catch {
      return true;
    }

    const candidates = [
      path.join(clientDir, 'src'),
      path.join(clientDir, 'index.html'),
      path.join(clientDir, 'package.json'),
      path.join(clientDir, 'vite.config.js'),
      path.join(clientDir, 'vite.config.ts')
    ];

    return candidates.some((p) => this.anyFileNewerThan(p, distMtimeMs));
  }

  anyFileNewerThan(targetPath, mtimeMs) {
    try {
      if (!fs.existsSync(targetPath)) return false;
      const stat = fs.statSync(targetPath);
      if (stat.isFile()) {
        return stat.mtimeMs > mtimeMs;
      }
      if (!stat.isDirectory()) return false;

      const entries = fs.readdirSync(targetPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(targetPath, entry.name);
        if (entry.isDirectory()) {
          if (this.anyFileNewerThan(fullPath, mtimeMs)) return true;
        } else if (entry.isFile()) {
          const s = fs.statSync(fullPath);
          if (s.mtimeMs > mtimeMs) return true;
        }
      }
    } catch {
      return false;
    }

    return false;
  }

  getNpmCommand() {
    return process.platform === 'win32' ? 'npm.cmd' : 'npm';
  }

  async buildClient() {
    const clientDir = path.join(this.diffViewerRoot, 'client');
    if (!fs.existsSync(clientDir)) {
      throw new Error(`diff-viewer client folder not found at ${clientDir}`);
    }

    const logPath = this.createClientBuildLogFile();
    const npmCmd = this.getNpmCommand();

    logger.info('Rebuilding diff viewer client (stale dist detected)', { clientDir, logPath });

    // Install deps only if needed.
    const nodeModulesPath = path.join(clientDir, 'node_modules');
    if (!fs.existsSync(nodeModulesPath)) {
      await this.runCommandToLog(npmCmd, ['install'], { cwd: clientDir, logPath });
    }

    await this.runCommandToLog(npmCmd, ['run', 'build'], { cwd: clientDir, logPath });

    logger.info('Diff viewer client rebuild complete', { logPath });
    return { attempted: true, built: true, logPath };
  }

  runCommandToLog(command, args, { cwd, logPath }) {
    return new Promise((resolve, reject) => {
      if (!cwd || !fs.existsSync(cwd)) {
        reject(new Error(`Command cwd does not exist: ${cwd || '(empty)'}`));
        return;
      }
      const fd = fs.openSync(logPath, 'a');
      const child = spawn(command, args, {
        cwd,
        env: process.env,
        stdio: ['ignore', fd, fd],
        windowsHide: true
      });

      child.on('error', (error) => {
        try {
          fs.closeSync(fd);
        } catch {}
        reject(error);
      });

      child.on('close', (code) => {
        try {
          fs.closeSync(fd);
        } catch {}
        if (code === 0) resolve();
        else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      });
    });
  }

  checkHealth(timeoutMs = 800) {
    return new Promise((resolve) => {
      const req = http.get(`${this.baseUrl}/api/health`, (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 300);
      });

      req.on('error', () => resolve(false));
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  async waitForHealthy({ timeoutMs = 20000, intervalMs = 500 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ok = await this.checkHealth(800);
      if (ok) return true;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
  }

  async start() {
    if (!fs.existsSync(this.diffViewerRoot)) {
      throw new Error(`diff-viewer folder not found at ${this.diffViewerRoot}`);
    }

    // If we started it before and the PID is still alive, just wait for health.
    if (this.processInfo?.pid && this.isPidRunning(this.processInfo.pid)) {
      logger.info('Diff viewer process already running (pid alive), waiting for health', {
        pid: this.processInfo.pid,
        port: this.port
      });
      await this.waitForHealthy({ timeoutMs: 10000 });
      return;
    }

    const logPath = this.createLogFile();
    const fd = fs.openSync(logPath, 'a');

    const env = {
      ...process.env,
      DIFF_VIEWER_PORT: String(this.port)
    };

    const scriptPath = path.join(this.diffViewerRoot, 'start-diff-viewer.sh');

    let child = null;
    if (process.platform !== 'win32' && fs.existsSync(scriptPath)) {
      logger.info('Starting diff viewer via start-diff-viewer.sh', { port: this.port, scriptPath });
      const shell = getDefaultShell();
      child = spawn(shell, [scriptPath], {
        cwd: this.diffViewerRoot,
        env,
        detached: true,
        stdio: ['ignore', fd, fd],
        windowsHide: true
      });
    } else {
      const entry = path.join(this.diffViewerRoot, 'server', 'index.js');
      logger.info('Starting diff viewer via node server/index.js', { port: this.port, entry });
      child = spawn(process.execPath, [entry], {
        cwd: this.diffViewerRoot,
        env,
        detached: true,
        stdio: ['ignore', fd, fd],
        windowsHide: true
      });
    }

    fs.closeSync(fd);
    child.unref();

    this.processInfo = {
      pid: child.pid,
      startedAt: new Date().toISOString(),
      logPath
    };

    child.on('close', (code, signal) => {
      logger.warn('Diff viewer process exited', { pid: child.pid, code, signal });
      if (this.processInfo?.pid === child.pid) {
        this.processInfo = null;
      }
    });

    child.on('error', (error) => {
      logger.error('Failed to start diff viewer', { error: error.message, stack: error.stack });
      if (this.processInfo?.pid === child.pid) {
        this.processInfo = null;
      }
    });

    const ok = await this.waitForHealthy();
    if (!ok) {
      logger.warn('Diff viewer did not become healthy within timeout', { port: this.port, logPath });
    }
  }

  createLogFile() {
    const logDir = path.join('logs');
    fs.mkdirSync(logDir, { recursive: true });
    return path.join(logDir, 'diff-viewer.log');
  }

  createClientBuildLogFile() {
    const logDir = path.join('logs');
    fs.mkdirSync(logDir, { recursive: true });
    return path.join(logDir, 'diff-viewer-client-build.log');
  }

  isPidRunning(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = { DiffViewerService };
