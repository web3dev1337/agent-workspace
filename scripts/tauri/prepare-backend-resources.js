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
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed (exit ${res.status})`);
  }
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
  const bundledNodePathRaw =
    process.env.ORCHESTRATOR_BUNDLED_NODE_PATH
    || process.env.TAURI_BUNDLED_NODE_PATH
    || '';

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
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    run(npmCmd, ['ci', '--omit=dev'], { cwd: outDir });
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
