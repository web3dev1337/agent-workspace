#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return {
    installProd: args.has('--install-prod') || args.has('--install') || args.has('--installProd'),
    clean: args.has('--clean')
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) throw new Error(`Missing source: ${src}`);
  fs.cpSync(src, dest, { recursive: true, force: true });
}

function copyFile(src, dest) {
  if (!fs.existsSync(src)) throw new Error(`Missing file: ${src}`);
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function run(cmd, args, opts) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (res.error) {
    throw new Error(`${cmd} ${args.join(' ')} failed: ${res.error.message}`);
  }
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed (exit ${res.status})`);
  }
}

function getNodeExecutable(rawPath) {
  const candidate = String(rawPath || '').trim();
  if (!candidate) {
    return '';
  }
  return path.resolve(candidate);
}

function getBundledNpmPath(nodeExecutable) {
  const nodePath = getNodeExecutable(nodeExecutable);
  if (!nodePath) {
    return '';
  }

  const npmCli = path.join(path.dirname(nodePath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (fs.existsSync(npmCli)) {
    return npmCli;
  }

  return '';
}

function runNpmWithNode(nodeExecutable, args, opts) {
  const npmCli = getBundledNpmPath(nodeExecutable);
  if (npmCli) {
    run(nodeExecutable, [npmCli, ...args], opts);
    return;
  }

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  run(npmCmd, args, {
    env: {
      ...process.env,
      // Keep the node source of truth explicit for nested helpers like ensure-pty.
      ORCHESTRATOR_NODE_PATH: getNodeExecutable(nodeExecutable),
      TAURI_NODE_PATH: getNodeExecutable(nodeExecutable)
    },
    ...opts
  });
}

function main() {
  const { installProd, clean } = parseArgs(process.argv);

  const repoRoot = path.resolve(__dirname, '..', '..');
  const outDir = path.join(repoRoot, 'src-tauri', 'resources', 'backend');

  const srcServer = path.join(repoRoot, 'server');
  const srcClient = path.join(repoRoot, 'client');
  const srcPkg = path.join(repoRoot, 'package.json');
  const srcLock = path.join(repoRoot, 'package-lock.json');
  const srcConfig = path.join(repoRoot, 'config.json');
  const srcUserDefaults = path.join(repoRoot, 'user-settings.default.json');
  const srcLicensePublicKey =
    process.env.ORCHESTRATOR_LICENSE_PUBLIC_KEY_PATH
    || process.env.TAURI_LICENSE_PUBLIC_KEY_PATH
    || path.join(repoRoot, 'license-public-key.pem');
  const srcUpdaterPublicKey =
    process.env.ORCHESTRATOR_UPDATER_PUBKEY_PATH
    || process.env.TAURI_UPDATER_PUBKEY_PATH
    || path.join(repoRoot, 'updater.pubkey');
  const skipBundleNodeRaw = String(
    process.env.ORCHESTRATOR_SKIP_BUNDLE_NODE
    || process.env.TAURI_SKIP_BUNDLE_NODE
    || ''
  ).trim().toLowerCase();
  const shouldBundleNode = !['1', 'true', 'yes', 'on'].includes(skipBundleNodeRaw);

  const bundledNodePathRawFromEnv =
    process.env.ORCHESTRATOR_BUNDLED_NODE_PATH
    || process.env.TAURI_BUNDLED_NODE_PATH
    || '';

  // Default: bundle the Node runtime we’re currently running on.
  // This makes `npm run tauri:build` much more “it just works” on Windows.
  const bundledNodePathRaw = getNodeExecutable(
    bundledNodePathRawFromEnv || (shouldBundleNode ? process.execPath : '')
  );

  const nodeEnv = bundledNodePathRaw
    ? {
        ...process.env,
        ORCHESTRATOR_NODE_PATH: bundledNodePathRaw,
        TAURI_NODE_PATH: bundledNodePathRaw
      }
    : process.env;

  if (clean && fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }

  ensureDir(outDir);
  copyDir(srcServer, path.join(outDir, 'server'));
  copyDir(srcClient, path.join(outDir, 'client'));
  copyFile(srcPkg, path.join(outDir, 'package.json'));
  if (fs.existsSync(srcLock)) copyFile(srcLock, path.join(outDir, 'package-lock.json'));
  if (fs.existsSync(srcConfig)) copyFile(srcConfig, path.join(outDir, 'config.json'));
  if (fs.existsSync(srcUserDefaults)) copyFile(srcUserDefaults, path.join(outDir, 'user-settings.default.json'));
  if (srcLicensePublicKey && fs.existsSync(srcLicensePublicKey)) {
    copyFile(srcLicensePublicKey, path.join(outDir, 'license-public-key.pem'));
  }
  if (srcUpdaterPublicKey && fs.existsSync(srcUpdaterPublicKey)) {
    copyFile(srcUpdaterPublicKey, path.join(outDir, 'updater.pubkey'));
  }
  if (bundledNodePathRaw) {
    const bundledNodePath = path.resolve(String(bundledNodePathRaw));
    if (fs.existsSync(bundledNodePath)) {
      const isExe = bundledNodePath.toLowerCase().endsWith('.exe');
      const nodeFilename = isExe ? 'node.exe' : 'node';
      copyFile(bundledNodePath, path.join(outDir, 'node', nodeFilename));
      console.log('[tauri] Bundled Node runtime:', bundledNodePath);
    } else {
      console.warn('[tauri] NOTE: ORCHESTRATOR_BUNDLED_NODE_PATH not found:', bundledNodePath);
    }
  }

  if (installProd) {
    try {
      runNpmWithNode(
        bundledNodePathRaw || process.execPath,
        ['ci', '--omit=dev', '--no-audit', '--no-fund'],
        { cwd: outDir, env: nodeEnv }
      );
    } catch (error) {
      // Some Windows setups have issues with `npm ci` for native modules.
      // Fall back to `npm install` so contributors can still build installers.
      console.warn('[tauri] NOTE: npm ci failed, falling back to npm install --omit=dev');
      runNpmWithNode(
        bundledNodePathRaw || process.execPath,
        ['install', '--omit=dev', '--no-audit', '--no-fund'],
        { cwd: outDir, env: nodeEnv }
      );
    }

    try {
      const nodePath = bundledNodePathRaw || process.execPath;
      const ensureScriptPath = path.join(repoRoot, 'scripts', 'ensure-pty.js');
      run(nodePath, [ensureScriptPath], {
        cwd: outDir,
        env: nodeEnv
      });
    } catch (error) {
      console.error('[tauri] NOTE: node-pty compatibility check failed after install:', error.message);
      throw error;
    }
  }

  const marker = path.join(outDir, 'server', 'index.js');
  if (!fs.existsSync(marker)) {
    throw new Error(`Expected backend entry not found: ${marker}`);
  }

  const nodeModulesPath = path.join(outDir, 'node_modules');
  if (!fs.existsSync(nodeModulesPath)) {
    console.warn(`[tauri] NOTE: ${nodeModulesPath} missing. Packaged builds will require --install-prod.`);
  }

  console.log('[tauri] Backend resources prepared:', outDir);
}

main();
