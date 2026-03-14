const { spawn } = require('child_process');
const winston = require('winston');
const { augmentProcessEnv, getHiddenProcessOptions } = require('./utils/processUtils');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

const REQUIRED_VERSION = '1.0.24';
const REQUIRED_VERSION_NUMBER = 1 * 10000 + 0 * 100 + 24;

class ClaudeVersionChecker {
  static async checkVersion() {
    return new Promise((resolve) => {
      const child = spawn('claude', ['--version'], {
        ...getHiddenProcessOptions({
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 5000,
          env: augmentProcessEnv(process.env)
        })
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
          const version = versionMatch ? versionMatch[1] : null;
          
          if (version) {
            const [major, minor, patch] = version.split('.').map(Number);
            const versionNumber = major * 10000 + minor * 100 + patch;
            
            const result = {
              version,
              isCompatible: versionNumber >= REQUIRED_VERSION_NUMBER,
              versionNumber,
              requiredVersion: REQUIRED_VERSION
            };
            
            logger.info('Claude version check', result);
            resolve(result);
          } else {
            logger.warn('Could not parse Claude version', { stdout, stderr });
            resolve({
              version: null,
              isCompatible: false,
              requiredVersion: REQUIRED_VERSION,
              error: 'Could not parse version'
            });
          }
        } else {
          logger.error('Claude version check failed', { code, stderr });
          resolve({
            version: null,
            isCompatible: false,
            requiredVersion: REQUIRED_VERSION,
            error: `Exit code ${code}: ${stderr}`
          });
        }
      });

      child.on('error', (error) => {
        logger.error('Claude version check error', { error: error.message, stack: error.stack });
        resolve({
          version: null,
          isCompatible: false,
          requiredVersion: REQUIRED_VERSION,
          error: error.message
        });
      });
    });
  }

  static generateUpdateInstructions(versionInfo) {
    if (versionInfo.isCompatible) {
      return null;
    }

    const requiredVersion = versionInfo.requiredVersion || REQUIRED_VERSION;
    const detectedVersion = versionInfo.version || 'unknown';
    const message = versionInfo.version
      ? `Your Claude CLI version (${detectedVersion}) is outdated. Version ${requiredVersion} or higher is required.`
      : `Your Claude CLI version could not be detected (${detectedVersion}). Version ${requiredVersion} or higher is required.`;

    return {
      title: 'Claude CLI Update Required',
      message,
      instructions: [
        'Run the following command to update:',
        '  claude update',
        '',
        'If that fails, try:',
        '  npm install -g @anthropic-ai/claude-cli@latest',
        '',
        'After updating, restart the orchestrator.'
      ]
    };
  }
}

module.exports = { ClaudeVersionChecker };
