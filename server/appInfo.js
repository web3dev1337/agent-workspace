const fs = require('fs');
const path = require('path');

const APP_PACKAGE_PATH = path.join(__dirname, '..', 'package.json');
const DEFAULT_APP_NAME = 'Agent Workspace';

function readAppInfo({
  packagePath = APP_PACKAGE_PATH,
  readFileSync = fs.readFileSync
} = {}) {
  try {
    const raw = readFileSync(packagePath, 'utf8');
    const parsed = JSON.parse(raw);
    const version = String(parsed?.version || '').trim() || null;
    const name = String(parsed?.productName || parsed?.name || '').trim() || DEFAULT_APP_NAME;
    return {
      name,
      version,
      displayVersion: version ? `v${version}` : null
    };
  } catch {
    return {
      name: DEFAULT_APP_NAME,
      version: null,
      displayVersion: null
    };
  }
}

module.exports = {
  APP_PACKAGE_PATH,
  DEFAULT_APP_NAME,
  readAppInfo
};
