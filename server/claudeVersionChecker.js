const { spawn } = require('child_process');
const winston = require('winston');

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

const IS_WIN = process.platform === 'win32';
const CREATE_NO_WINDOW = 0x08000000;

class ClaudeVersionChecker {
  static async checkVersion() {
    return new Promise((resolve) => {
      const child = spawn('claude', ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
        windowsHide: true,
        ...(IS_WIN ? { creationFlags: CREATE_NO_WINDOW } : {})
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
            const requiredVersion = 1 * 10000 + 0 * 100 + 24; // 1.0.24
            
            const result = {
              version,
              isCompatible: versionNumber >= requiredVersion,
              versionNumber,
              requiredVersion: '1.0.24'
            };
            
            logger.info('Claude version check', result);
            resolve(result);
          } else {
            logger.warn('Could not parse Claude version', { stdout, stderr });
            resolve({
              version: null,
              isCompatible: false,
              error: 'Could not parse version'
            });
          }
        } else {
          logger.error('Claude version check failed', { code, stderr });
          resolve({
            version: null,
            isCompatible: false,
            error: `Exit code ${code}: ${stderr}`
          });
        }
      });

      child.on('error', (error) => {
        logger.error('Claude version check error', { error: error.message, stack: error.stack });
        resolve({
          version: null,
          isCompatible: false,
          error: error.message
        });
      });
    });
  }

  static generateUpdateInstructions(versionInfo) {
    if (versionInfo.isCompatible) {
      return null;
    }

    return {
      title: 'Claude CLI Update Required',
      message: `Your Claude CLI version (${versionInfo.version || 'unknown'}) is outdated. Version ${versionInfo.requiredVersion} or higher is required.`,
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
