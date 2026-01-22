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

class DiffViewerService {
  constructor() {
    this.diffViewerRoot = path.join(__dirname, '..', 'diff-viewer');
    this.port = parseInt(process.env.DIFF_VIEWER_PORT || '7655', 10);
    this.baseUrl = `http://localhost:${this.port}`;

    this.processInfo = null; // { pid, startedAt, logPath }
    this.startingPromise = null;
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
      return {
        running: true,
        started: false,
        baseUrl: this.baseUrl,
        port: this.port,
        process: this.processInfo
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
      child = spawn('bash', [scriptPath], {
        cwd: this.diffViewerRoot,
        env,
        detached: true,
        stdio: ['ignore', fd, fd]
      });
    } else {
      const entry = path.join(this.diffViewerRoot, 'server', 'index.js');
      logger.info('Starting diff viewer via node server/index.js', { port: this.port, entry });
      child = spawn(process.execPath, [entry], {
        cwd: this.diffViewerRoot,
        env,
        detached: true,
        stdio: ['ignore', fd, fd]
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
