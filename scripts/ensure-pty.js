#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const NODE_BINARY = path.resolve(process.env.ORCHESTRATOR_NODE_PATH || process.env.TAURI_NODE_PATH || process.execPath || process.argv[0]);
const NPM_CLI = path.join(path.dirname(NODE_BINARY), 'node_modules', 'npm', 'bin', 'npm-cli.js');

function runCommand(command, args) {
  const logParts = [command, ...args].join(' ');
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: process.cwd() });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Command "${logParts}" failed with exit code ${result.status}`);
  }
}

function runNpm(command, args) {
  if (fs.existsSync(NPM_CLI)) {
    console.log('[node-pty] running:', NODE_BINARY, path.basename(NPM_CLI), command, ...args);
    const result = spawnSync(NODE_BINARY, [NPM_CLI, command, ...args], { stdio: 'inherit', cwd: process.cwd() });
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(`npm rebuild failed with exit code ${result.status}`);
    }
    return;
  }

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  console.log('[node-pty] running:', npmCommand, command, ...args);
  runCommand(npmCommand, [command, ...args]);
}

function tryRequirePty() {
  try {
    require('node-pty');
    return true;
  } catch (error) {
    return error;
  }
}

const firstTry = tryRequirePty();
if (firstTry === true) {
  console.log('node-pty ok');
  process.exit(0);
}

const message = firstTry && firstTry.message ? firstTry.message : String(firstTry);
console.warn('node-pty load failed, attempting rebuild...', message);

const attemptRebuild = (command, args) => {
  runNpm(command, args);
};

try {
  attemptRebuild('rebuild', ['node-pty']);
} catch (error) {
  console.warn('[node-pty] ABI mismatch rebuild failed, retrying from source:', error.message);
  try {
    attemptRebuild('rebuild', ['node-pty', '--build-from-source']);
  } catch (sourceError) {
    console.error('[node-pty] rebuild failed:', sourceError.message);
    process.exit(1);
  }
}

const secondTry = tryRequirePty();
if (secondTry === true) {
  console.log('node-pty rebuilt successfully');
  process.exit(0);
}

const secondMessage = secondTry && secondTry.message ? secondTry.message : String(secondTry);
console.error('node-pty still failing after rebuild:', secondMessage);
process.exit(1);
