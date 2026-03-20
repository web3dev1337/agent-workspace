#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const args = argv.slice(2);
  let profile = 'release';
  let bundles = null;
  let dryRun = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--profile' && args[i + 1]) {
      profile = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--bundles' && args[i + 1]) {
      bundles = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  return { profile, bundles, dryRun };
}

function resolveRepoRoot() {
  return path.resolve(__dirname, '..', '..');
}

function resolveTargetRoot({ repoRoot, targetDir }) {
  return path.resolve(targetDir || path.join(repoRoot, 'src-tauri', 'target'));
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

function readOsRelease({ fsImpl = fs } = {}) {
  const osReleasePath = '/etc/os-release';
  if (!fsImpl.existsSync(osReleasePath)) {
    return {};
  }

  const content = fsImpl.readFileSync(osReleasePath, 'utf8');
  const result = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1).replace(/^"+|"+$/g, '');
    result[key] = value;
  }
  return result;
}

function isArchBasedLinux({ env = process.env, platform = process.platform } = {}) {
  if (platform !== 'linux') {
    return false;
  }

  const distroHint = String(env.ORCHESTRATOR_LINUX_DISTRO || '').trim().toLowerCase();
  const osRelease = readOsRelease();
  const id = distroHint || String(osRelease.ID || '').trim().toLowerCase();
  const idLike = String(osRelease.ID_LIKE || '').trim().toLowerCase();
  return id === 'arch' || idLike.split(/\s+/).includes('arch');
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

function parseBundleList(value) {
  return String(value || '')
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function splitBundleTargets(bundleTargets) {
  const normalized = Array.isArray(bundleTargets) ? bundleTargets : [];
  const postprocessTargets = [];
  const tauriTargets = [];

  for (const bundleTarget of normalized) {
    if (bundleTarget === 'pacman') {
      postprocessTargets.push(bundleTarget);
      continue;
    }
    tauriTargets.push(bundleTarget);
  }

  if (postprocessTargets.includes('pacman') && !tauriTargets.includes('deb')) {
    tauriTargets.unshift('deb');
  }

  return { postprocessTargets, tauriTargets };
}

function resolveBundleTargets({
  profile,
  explicitBundles,
  env = process.env,
  platform = process.platform
}) {
  if (explicitBundles) {
    return {
      bundleTargets: parseBundleList(explicitBundles),
      reason: 'arg:--bundles'
    };
  }

  const envBundles = env.ORCHESTRATOR_TAURI_BUNDLES || env.TAURI_BUNDLES;
  if (envBundles) {
    return {
      bundleTargets: parseBundleList(envBundles),
      reason: 'env:ORCHESTRATOR_TAURI_BUNDLES'
    };
  }

  if (platform === 'win32' && profile === 'fast' && !env.CI) {
    return {
      bundleTargets: ['nsis'],
      reason: 'local-windows-fast-installer'
    };
  }

  if (platform === 'linux' && profile === 'fast' && !env.CI && isArchBasedLinux({ env, platform })) {
    return {
      bundleTargets: ['pacman'],
      reason: 'local-arch-fast-native-package'
    };
  }

  return {
    bundleTargets: null,
    reason: 'repo-default'
  };
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

function clearBundleOutputDir({ repoRoot, targetDir, profile }) {
  const bundleOutputDir = path.join(resolveTargetRoot({ repoRoot, targetDir }), profile, 'bundle');
  fs.rmSync(bundleOutputDir, { recursive: true, force: true });
  return bundleOutputDir;
}

function main() {
  const { profile, bundles, dryRun } = parseArgs(process.argv);
  const repoRoot = resolveRepoRoot();
  const tauriCliPath = require.resolve('@tauri-apps/cli/tauri.js');
  const { targetDir, reason } = resolveCargoTargetDir({ profile });
  const { bundleTargets, reason: bundleReason } = resolveBundleTargets({
    profile,
    explicitBundles: bundles
  });
  const { tauriTargets, postprocessTargets } = splitBundleTargets(bundleTargets);

  const env = { ...process.env };
  if (targetDir) {
    fs.mkdirSync(targetDir, { recursive: true });
    env.CARGO_TARGET_DIR = targetDir;
    console.log(`[tauri] Using cargo target dir (${reason}): ${targetDir}`);
  } else {
    console.log(`[tauri] Using repo-local cargo target dir (${reason})`);
  }

  if (bundleTargets && bundleTargets.length > 0) {
    console.log(`[tauri] Limiting bundle targets (${bundleReason}): ${bundleTargets.join(', ')}`);
  } else {
    console.log(`[tauri] Using bundle targets from tauri.conf.json (${bundleReason})`);
  }

  if (dryRun) {
    return;
  }

  run(process.execPath, [path.join(repoRoot, 'scripts', 'tauri', 'sync-tauri-version.js')], {
    cwd: repoRoot,
    env
  });

  run(process.execPath, [path.join(repoRoot, 'scripts', 'release', 'check-version-consistency.js')], {
    cwd: repoRoot,
    env
  });

  const clearedBundleOutputDir = clearBundleOutputDir({ repoRoot, targetDir, profile });
  console.log(`[tauri] Cleared bundle output dir: ${clearedBundleOutputDir}`);

  run(process.execPath, [path.join(repoRoot, 'scripts', 'tauri', 'prepare-backend-resources.js'), '--install-prod'], {
    cwd: repoRoot,
    env
  });

  // Clean stale AppImage bundle dir so previously generated artifacts cannot leak into this build.
  const appimageBundleDir = path.join(resolveTargetRoot({ repoRoot, targetDir }), profile, 'bundle', 'appimage');
  if (fs.existsSync(appimageBundleDir)) {
    fs.rmSync(appimageBundleDir, { recursive: true, force: true });
    console.log('[tauri] Cleaned stale AppImage bundle cache');
  }

  const tauriArgs = [tauriCliPath, 'build'];
  if (tauriTargets && tauriTargets.length > 0) {
    tauriArgs.push('--bundles', tauriTargets.join(','));
  }
  tauriArgs.push('--', '--profile', profile);

  run(process.execPath, tauriArgs, {
    cwd: repoRoot,
    env
  });

  if (postprocessTargets.includes('pacman')) {
    run(process.execPath, [
      path.join(repoRoot, 'scripts', 'release', 'build-arch-package.js'),
      '--profile',
      profile,
      '--target-dir',
      resolveTargetRoot({ repoRoot, targetDir })
    ], {
      cwd: repoRoot,
      env
    });
  }

  const verifyArgs = [
    path.join(repoRoot, 'scripts', 'release', 'verify-bundle-version.js'),
    '--profile',
    profile,
    '--target-dir',
    resolveTargetRoot({ repoRoot, targetDir })
  ];
  if (bundleTargets && bundleTargets.length > 0) {
    verifyArgs.push('--bundles', bundleTargets.join(','));
  }

  run(process.execPath, verifyArgs, {
    cwd: repoRoot,
    env
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  clearBundleOutputDir,
  defaultLocalWindowsFastTargetDir,
  parseArgs,
  parseBundleList,
  isArchBasedLinux,
  readOsRelease,
  splitBundleTargets,
  resolveBundleTargets,
  resolveCargoTargetDir,
  resolveTargetRoot
};
