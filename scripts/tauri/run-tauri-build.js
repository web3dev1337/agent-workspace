#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const args = argv.slice(2);
  let profile = 'release';
  let dryRun = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--profile' && args[i + 1]) {
      profile = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  return { profile, dryRun };
}

function resolveRepoRoot() {
  return path.resolve(__dirname, '..', '..');
}

function resolveWindowsCacheRoot(env) {
  if (env.LOCALAPPDATA) {
    return env.LOCALAPPDATA;
  }
  if (env.USERPROFILE) {
    return path.win32.join(env.USERPROFILE, 'AppData', 'Local');
  }
  return path.win32.join(os.homedir(), 'AppData', 'Local');
}

function defaultLocalWindowsFastTargetDir(env) {
  return path.win32.join(resolveWindowsCacheRoot(env), 'AgentWorkspaceBuildCache', 'tauri-target');
}

function resolveCargoTargetDir({ profile, env = process.env, platform = process.platform }) {
  if (env.CARGO_TARGET_DIR) {
    return { targetDir: env.CARGO_TARGET_DIR, reason: 'env:CARGO_TARGET_DIR' };
  }

  const orchestratorTargetDir = env.ORCHESTRATOR_TAURI_TARGET_DIR || env.ORCHESTRATOR_CARGO_TARGET_DIR;
  if (orchestratorTargetDir) {
    return { targetDir: orchestratorTargetDir, reason: 'env:ORCHESTRATOR_TAURI_TARGET_DIR' };
  }

  if (platform === 'win32' && profile === 'fast' && !env.CI) {
    return {
      targetDir: defaultLocalWindowsFastTargetDir(env),
      reason: 'local-windows-fast-cache'
    };
  }

  return { targetDir: null, reason: 'repo-default' };
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (result.error) {
    throw new Error(`${cmd} ${args.join(' ')} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed (exit ${result.status})`);
  }
}

function main() {
  const { profile, dryRun } = parseArgs(process.argv);
  const repoRoot = resolveRepoRoot();
  const tauriCliPath = require.resolve('@tauri-apps/cli/tauri.js');
  const { targetDir, reason } = resolveCargoTargetDir({ profile });

  const env = { ...process.env };
  if (targetDir) {
    fs.mkdirSync(targetDir, { recursive: true });
    env.CARGO_TARGET_DIR = targetDir;
    console.log(`[tauri] Using cargo target dir (${reason}): ${targetDir}`);
  } else {
    console.log(`[tauri] Using repo-local cargo target dir (${reason})`);
  }

  if (dryRun) {
    return;
  }

  run(process.execPath, [path.join(repoRoot, 'scripts', 'tauri', 'prepare-backend-resources.js'), '--install-prod'], {
    cwd: repoRoot,
    env
  });

  run(process.execPath, [tauriCliPath, 'build', '--', '--profile', profile], {
    cwd: repoRoot,
    env
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  defaultLocalWindowsFastTargetDir,
  parseArgs,
  resolveCargoTargetDir
};
