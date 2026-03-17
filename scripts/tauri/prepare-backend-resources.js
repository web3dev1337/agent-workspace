#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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

function removeIfExists(targetPath) {
  if (!targetPath || !fs.existsSync(targetPath)) return;
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function replaceDir(src, dest) {
  if (!fs.existsSync(src)) throw new Error(`Missing source: ${src}`);
  removeIfExists(dest);
  fs.cpSync(src, dest, { recursive: true, force: true });
}

function copyFile(src, dest) {
  if (!fs.existsSync(src)) throw new Error(`Missing file: ${src}`);
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function hashFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function statSignature(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  return {
    size: stat.size,
    mtimeMs: Math.trunc(stat.mtimeMs)
  };
}

function collectDirSnapshot(rootDir) {
  if (!rootDir || !fs.existsSync(rootDir)) return null;

  const entries = [];
  const stack = [''];

  while (stack.length > 0) {
    const relativeDir = stack.pop();
    const absoluteDir = relativeDir ? path.join(rootDir, relativeDir) : rootDir;
    const children = fs.readdirSync(absoluteDir, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const child of children) {
      const childRelative = relativeDir ? path.posix.join(relativeDir, child.name) : child.name;
      const childAbsolute = path.join(rootDir, childRelative);

      if (child.isDirectory()) {
        stack.push(childRelative);
        continue;
      }

      if (!child.isFile()) {
        continue;
      }

      entries.push({
        path: childRelative,
        ...statSignature(childAbsolute)
      });
    }
  }

  entries.sort((left, right) => left.path.localeCompare(right.path));
  return entries;
}

function buildResourceSyncStamp({
  srcServer,
  srcClient,
  srcScripts,
  srcLinuxScripts,
  srcTemplates,
  srcConfigDir,
  srcWindowsScripts,
  srcPkg,
  srcLock,
  srcConfig,
  srcUserDefaults,
  srcLicensePublicKey,
  srcUpdaterPublicKey,
  bundledNodePath
}) {
  return {
    schemaVersion: 1,
    platform: process.platform,
    arch: process.arch,
    files: {
      packageJson: statSignature(srcPkg),
      packageLock: statSignature(srcLock),
      configJson: statSignature(srcConfig),
      userSettingsDefaultJson: statSignature(srcUserDefaults),
      createProjectScript: statSignature(path.join(srcScripts, 'create-project.js')),
      licensePublicKey: statSignature(srcLicensePublicKey),
      updaterPublicKey: statSignature(srcUpdaterPublicKey),
      bundledNode: bundledNodePath ? {
        path: bundledNodePath,
        hash: hashFile(bundledNodePath)
      } : null
    },
    directories: {
      server: collectDirSnapshot(srcServer),
      client: collectDirSnapshot(srcClient),
      scriptsLinux: collectDirSnapshot(srcLinuxScripts),
      scriptsWindows: collectDirSnapshot(srcWindowsScripts),
      templates: collectDirSnapshot(srcTemplates),
      config: collectDirSnapshot(srcConfigDir)
    }
  };
}

function canReuseResourceSync({ stampPath, expectedStamp, requiredPaths }) {
  if (!fs.existsSync(stampPath)) {
    return false;
  }

  const actualStamp = readJson(stampPath);
  if (!actualStamp || typeof actualStamp !== 'object') {
    return false;
  }

  if (JSON.stringify(actualStamp) !== JSON.stringify(expectedStamp)) {
    return false;
  }

  return requiredPaths.every((entryPath) => fs.existsSync(entryPath));
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

function runNpm(args, opts) {
  // When invoked via `npm run ...`, npm provides the JS entry path, which is
  // the most reliable cross-platform invocation target.
  const npmExecPath = String(process.env.npm_execpath || '').trim();
  if (npmExecPath) {
    run(process.execPath, [npmExecPath, ...args], opts);
    return;
  }
  // On Windows, .cmd files require shell:true for spawnSync (EINVAL otherwise).
  const isWin = process.platform === 'win32';
  const npmCmd = isWin ? 'npm.cmd' : 'npm';
  run(npmCmd, args, { ...(isWin ? { shell: true } : {}), ...opts });
}

function readJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function normalizeBundledNodePath(value) {
  const raw = String(value || '').trim();
  return raw ? path.resolve(raw) : null;
}

function buildProdInstallStamp({ packageJsonPath, packageLockPath, bundledNodePath }) {
  return {
    schemaVersion: 1,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    packageJsonHash: hashFile(packageJsonPath),
    packageLockHash: hashFile(packageLockPath),
    bundledNodePath: bundledNodePath || null,
    bundledNodeHash: bundledNodePath ? hashFile(bundledNodePath) : null
  };
}

function canReuseProdInstall({ stampPath, nodeModulesPath, expectedStamp }) {
  if (!fs.existsSync(nodeModulesPath) || !fs.existsSync(stampPath)) {
    return false;
  }

  const actualStamp = readJson(stampPath);
  if (!actualStamp || typeof actualStamp !== 'object') {
    return false;
  }

  return JSON.stringify(actualStamp) === JSON.stringify(expectedStamp);
}

function main() {
  const { installProd, clean } = parseArgs(process.argv);

  const repoRoot = path.resolve(__dirname, '..', '..');
  const outDir = path.join(repoRoot, 'src-tauri', 'resources', 'backend');

  const srcServer = path.join(repoRoot, 'server');
  const srcClient = path.join(repoRoot, 'client');
  const srcScripts = path.join(repoRoot, 'scripts');
  const srcLinuxScripts = path.join(srcScripts, 'linux');
  const srcTemplates = path.join(repoRoot, 'templates');
  const srcConfigDir = path.join(repoRoot, 'config');
  const srcWindowsScripts = path.join(srcScripts, 'windows');
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
  const bundledNodePathRaw = bundledNodePathRawFromEnv || (shouldBundleNode ? process.execPath : '');
  const bundledNodePath = normalizeBundledNodePath(bundledNodePathRaw);
  const nodeModulesPath = path.join(outDir, 'node_modules');
  const prodInstallStampPath = path.join(outDir, '.prod-install-stamp.json');
  const resourceSyncStampPath = path.join(outDir, '.resource-sync-stamp.json');

  if (clean && fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }

  const expectedResourceSyncStamp = buildResourceSyncStamp({
    srcServer,
    srcClient,
    srcScripts,
    srcLinuxScripts,
    srcTemplates,
    srcConfigDir,
    srcWindowsScripts,
    srcPkg,
    srcLock,
    srcConfig,
    srcUserDefaults,
    srcLicensePublicKey,
    srcUpdaterPublicKey,
    bundledNodePath
  });

  const requiredResourcePaths = [
    path.join(outDir, 'server', 'index.js'),
    path.join(outDir, 'client'),
    path.join(outDir, 'scripts', 'create-project.js'),
    path.join(outDir, 'package.json')
  ];

  if (canReuseResourceSync({
    stampPath: resourceSyncStampPath,
    expectedStamp: expectedResourceSyncStamp,
    requiredPaths: requiredResourcePaths
  })) {
    console.log('[tauri] Reusing cached backend resource sync');
  } else {
    ensureDir(outDir);
    replaceDir(srcServer, path.join(outDir, 'server'));
    replaceDir(srcClient, path.join(outDir, 'client'));
    removeIfExists(path.join(outDir, 'scripts'));
    copyFile(
      path.join(srcScripts, 'create-project.js'),
      path.join(outDir, 'scripts', 'create-project.js')
    );
    if (fs.existsSync(srcLinuxScripts)) {
      replaceDir(srcLinuxScripts, path.join(outDir, 'scripts', 'linux'));
    }
    if (fs.existsSync(srcTemplates)) {
      replaceDir(srcTemplates, path.join(outDir, 'templates'));
    } else {
      removeIfExists(path.join(outDir, 'templates'));
    }
    if (fs.existsSync(srcConfigDir)) {
      replaceDir(srcConfigDir, path.join(outDir, 'config'));
    } else {
      removeIfExists(path.join(outDir, 'config'));
    }
    if (fs.existsSync(srcWindowsScripts)) {
      replaceDir(srcWindowsScripts, path.join(outDir, 'scripts', 'windows'));
    }
    copyFile(srcPkg, path.join(outDir, 'package.json'));
    if (fs.existsSync(srcLock)) {
      copyFile(srcLock, path.join(outDir, 'package-lock.json'));
    } else {
      removeIfExists(path.join(outDir, 'package-lock.json'));
    }
    if (fs.existsSync(srcConfig)) {
      copyFile(srcConfig, path.join(outDir, 'config.json'));
    } else {
      removeIfExists(path.join(outDir, 'config.json'));
    }
    if (fs.existsSync(srcUserDefaults)) {
      copyFile(srcUserDefaults, path.join(outDir, 'user-settings.default.json'));
    } else {
      removeIfExists(path.join(outDir, 'user-settings.default.json'));
    }
    if (srcLicensePublicKey && fs.existsSync(srcLicensePublicKey)) {
      copyFile(srcLicensePublicKey, path.join(outDir, 'license-public-key.pem'));
    } else {
      removeIfExists(path.join(outDir, 'license-public-key.pem'));
    }
    if (srcUpdaterPublicKey && fs.existsSync(srcUpdaterPublicKey)) {
      copyFile(srcUpdaterPublicKey, path.join(outDir, 'updater.pubkey'));
    } else {
      removeIfExists(path.join(outDir, 'updater.pubkey'));
    }
    if (bundledNodePath && fs.existsSync(bundledNodePath)) {
      const isExe = bundledNodePath.toLowerCase().endsWith('.exe');
      const nodeFilename = isExe ? 'node.exe' : 'node';
      copyFile(bundledNodePath, path.join(outDir, 'node', nodeFilename));
      console.log('[tauri] Bundled Node runtime:', bundledNodePath);
    } else {
      removeIfExists(path.join(outDir, 'node'));
      if (bundledNodePath) {
        console.warn('[tauri] NOTE: ORCHESTRATOR_BUNDLED_NODE_PATH not found:', bundledNodePath);
      }
    }
    writeJson(resourceSyncStampPath, expectedResourceSyncStamp);
  }

  if (installProd) {
    const expectedProdInstallStamp = buildProdInstallStamp({
      packageJsonPath: path.join(outDir, 'package.json'),
      packageLockPath: path.join(outDir, 'package-lock.json'),
      bundledNodePath
    });

    if (canReuseProdInstall({
      stampPath: prodInstallStampPath,
      nodeModulesPath,
      expectedStamp: expectedProdInstallStamp
    })) {
      console.log('[tauri] Reusing cached backend production install');
    } else {
      try {
        runNpm(['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: outDir });
      } catch (error) {
        // Some Windows setups have issues with `npm ci` for native modules.
        // Fall back to `npm install` so contributors can still build installers.
        console.warn('[tauri] NOTE: npm ci failed, falling back to npm install --omit=dev');
        runNpm(['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: outDir });
      }
      writeJson(prodInstallStampPath, expectedProdInstallStamp);
    }
  }

  const marker = path.join(outDir, 'server', 'index.js');
  if (!fs.existsSync(marker)) {
    throw new Error(`Expected backend entry not found: ${marker}`);
  }

  if (!fs.existsSync(nodeModulesPath)) {
    console.warn(`[tauri] NOTE: ${nodeModulesPath} missing. Packaged builds will require --install-prod.`);
  }

  console.log('[tauri] Backend resources prepared:', outDir);
}

main();
