const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, exec } = require('child_process');
const util = require('util');
const winston = require('winston');
const { augmentProcessEnv, buildPowerShellArgs, getHiddenProcessOptions } = require('./utils/processUtils');

const execAsyncBase = util.promisify(exec);
async function execAsync(command, options = {}) {
  return execAsyncBase(command, {
    ...getHiddenProcessOptions(options),
    env: augmentProcessEnv(options.env || process.env)
  });
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/products.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

const { getProjectsRoot } = require('./utils/pathUtils');
const ORCHESTRATOR_MASTER_PATHS = ['agent-workspace', 'claude-orchestrator'].map((repoDir) => path.resolve(
  os.homedir(),
  `GitHub/tools/automation/${repoDir}/master`
));
const DEFAULT_ALLOWED_ROOT = path.resolve(getProjectsRoot());

// Helper function to get the appropriate shell for the platform
function getDefaultShell() {
  return process.platform === 'win32' ? 'powershell.exe' : 'bash';
}

class ProductLauncherService {
  constructor() {
    this.running = new Map(); // productId -> { pid, startedAt, logPath }
    this.allowedRoot = DEFAULT_ALLOWED_ROOT;
    this.disallowedMasterPaths = new Set(ORCHESTRATOR_MASTER_PATHS);
  }

  static getInstance() {
    if (!ProductLauncherService.instance) {
      ProductLauncherService.instance = new ProductLauncherService();
    }
    return ProductLauncherService.instance;
  }

  async launch(product) {
    this.validateProduct(product);
    const masterPath = this.validateMasterPath(product.masterPath);

    const existing = this.running.get(product.id);
    if (existing && this.isPidRunning(existing.pid)) {
      return {
        success: true,
        alreadyRunning: true,
        pid: existing.pid,
        url: product.url,
        logPath: existing.logPath
      };
    }

    // Ensure the repo is up-to-date before starting
    await this.pullLatest(masterPath);

    const logPath = this.createLogFile(product.id);
    const fd = fs.openSync(logPath, 'a');

    const shell = getDefaultShell();
    const shellArgs = process.platform === 'win32'
      ? buildPowerShellArgs(product.startCommand)
      : ['-lc', product.startCommand];

    const child = spawn(shell, shellArgs, {
      ...getHiddenProcessOptions({
        cwd: masterPath,
        env: augmentProcessEnv({
          ...process.env,
          GIT_TERMINAL_PROMPT: '0'
        }),
        stdio: ['ignore', fd, fd]
      })
    });

    // Parent can close its reference; child keeps it
    fs.closeSync(fd);

    this.running.set(product.id, {
      pid: child.pid,
      startedAt: new Date().toISOString(),
      logPath,
      masterPath
    });

    child.on('close', (code, signal) => {
      logger.info('Product process exited', { productId: product.id, code, signal });
      this.running.delete(product.id);
    });

    child.on('error', (error) => {
      logger.error('Failed to start product', { productId: product.id, error: error.message, stack: error.stack });
      this.running.delete(product.id);
    });

    return {
      success: true,
      pid: child.pid,
      url: product.url,
      logPath
    };
  }

  validateProduct(product) {
    if (!product || typeof product !== 'object') {
      throw new Error('Product is required');
    }
    if (!product.id) throw new Error('Product id is required');
    if (!product.masterPath) throw new Error('Product masterPath is required');
    if (!product.startCommand) throw new Error('Product startCommand is required');
    if (!product.url) throw new Error('Product url is required');
  }

  validateMasterPath(masterPath) {
    const resolved = path.resolve(masterPath);

    for (const disallowed of this.disallowedMasterPaths) {
      if (resolved === disallowed || resolved.startsWith(disallowed + path.sep)) {
        throw new Error('Refusing to run commands in orchestrator production master/');
      }
    }

    if (!resolved.startsWith(this.allowedRoot + path.sep)) {
      throw new Error(`masterPath must be under ${this.allowedRoot}`);
    }

    if (!fs.existsSync(resolved)) {
      throw new Error('masterPath does not exist');
    }

    return resolved;
  }

  async pullLatest(masterPath) {
    logger.info('Pulling latest for product', { masterPath });

    await execAsync('git pull --ff-only', {
      cwd: masterPath,
      timeout: 60000,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0'
      }
    });
  }

  createLogFile(productId) {
    const logDir = path.join('logs', 'products');
    fs.mkdirSync(logDir, { recursive: true });
    return path.join(logDir, `${productId}.log`);
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

module.exports = { ProductLauncherService };
