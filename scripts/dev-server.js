#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

function loadServerOnlyFileWatching() {
  const settingsPath = process.env.ORCHESTRATOR_USER_SETTINGS_PATH
    || path.join(projectRoot, 'user-settings.json');

  try {
    if (fs.existsSync(settingsPath)) {
      const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      return data?.global?.serverOnlyFileWatching === true;
    }
  } catch {
    // Fall through to default
  }
  return false;
}

const serverOnly = loadServerOnlyFileWatching();

const nodemonBin = path.join(projectRoot, 'node_modules', '.bin', 'nodemon');
const args = [];

if (serverOnly) {
  // Explicit watch list overrides nodemon.json watch config
  args.push('--watch', 'server/', '--watch', '.env');
}

args.push('server/index.js');

if (process.argv.includes('--dry-run')) {
  console.log('serverOnlyFileWatching:', serverOnly);
  console.log('command:', nodemonBin, args.join(' '));
  process.exit(0);
}

const child = spawn(nodemonBin, args, {
  cwd: projectRoot,
  stdio: 'inherit',
  env: process.env
});

child.on('exit', (code) => process.exit(code ?? 1));
