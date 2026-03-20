#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { getProjectRoot, readPackageVersion } = require('./version-utils');

const BUNDLE_FILE_RULES = {
  appimage: { directory: 'appimage', extensions: ['.AppImage'] },
  deb: { directory: 'deb', extensions: ['.deb'] },
  pacman: { directory: 'pacman', extensions: ['.pkg.tar.zst'] },
  rpm: { directory: 'rpm', extensions: ['.rpm'] },
  nsis: { directory: 'nsis', extensions: ['.exe'] },
  msi: { directory: 'msi', extensions: ['.msi'] },
  app: { directory: 'macos', extensions: ['.app'] },
  dmg: { directory: 'dmg', extensions: ['.dmg'] }
};

function parseBundleList(value) {
  return String(value || '')
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let profile = 'release';
  let targetDir = null;
  let version = null;
  let platform = process.platform;
  let bundles = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if ((arg === '--profile' || arg === '-p') && args[i + 1]) {
      profile = args[i + 1];
      i += 1;
      continue;
    }
    if ((arg === '--target-dir' || arg === '-t') && args[i + 1]) {
      targetDir = args[i + 1];
      i += 1;
      continue;
    }
    if ((arg === '--version' || arg === '-v') && args[i + 1]) {
      version = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--platform' && args[i + 1]) {
      platform = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--bundles' && args[i + 1]) {
      bundles = args[i + 1];
      i += 1;
    }
  }

  return { bundles, platform, profile, targetDir, version };
}

function normalizePlatform(platform) {
  if (platform === 'win32' || platform === 'windows') {
    return 'windows';
  }
  if (platform === 'darwin' || platform === 'macos' || platform === 'mac') {
    return 'macos';
  }
  return 'linux';
}

function resolveDefaultTargetDir(repoRoot) {
  return path.join(repoRoot, 'src-tauri', 'target');
}

function resolveBundleTypes({ bundles, platform }) {
  if (bundles && parseBundleList(bundles).length > 0) {
    return parseBundleList(bundles);
  }

  if (platform === 'windows') {
    return ['nsis', 'msi'];
  }
  if (platform === 'macos') {
    return ['dmg'];
  }
  return [];
}

function listBundleFiles(bundleTypeDir, extensions) {
  if (!fs.existsSync(bundleTypeDir)) {
    return [];
  }

  return fs.readdirSync(bundleTypeDir)
    .filter((entry) => extensions.some((extension) => entry.toLowerCase().endsWith(extension.toLowerCase())))
    .map((entry) => path.join(bundleTypeDir, entry));
}

function verifyBundleVersion({ targetDir, profile, expectedVersion, platform, bundles }) {
  const normalizedPlatform = normalizePlatform(platform);
  const bundleTypes = resolveBundleTypes({ bundles, platform: normalizedPlatform });

  if (bundleTypes.length === 0) {
    return {
      bundleRoot: path.join(targetDir, profile, 'bundle'),
      bundleTypes,
      ok: true,
      skipped: true,
      errors: []
    };
  }

  const bundleRoot = path.join(targetDir, profile, 'bundle');
  const errors = [];

  if (!fs.existsSync(bundleRoot)) {
    errors.push(`Bundle output directory does not exist: ${bundleRoot}`);
    return { bundleRoot, bundleTypes, ok: false, skipped: false, errors };
  }

  for (const bundleType of bundleTypes) {
    const rule = BUNDLE_FILE_RULES[bundleType];
    if (!rule) {
      errors.push(`Unsupported bundle type: ${bundleType}`);
      continue;
    }

    const bundleTypeDir = path.join(bundleRoot, rule.directory);
    const files = listBundleFiles(bundleTypeDir, rule.extensions);
    if (files.length === 0) {
      errors.push(`No ${bundleType} artifacts found in ${bundleTypeDir}`);
      continue;
    }

    const matchedFiles = files.filter((filePath) => path.basename(filePath).includes(expectedVersion));
    const staleFiles = files.filter((filePath) => !path.basename(filePath).includes(expectedVersion));

    if (matchedFiles.length === 0) {
      errors.push(`No ${bundleType} artifacts include version ${expectedVersion} in ${bundleTypeDir}`);
    }
    if (staleFiles.length > 0) {
      errors.push(`Found stale ${bundleType} artifacts without version ${expectedVersion}: ${staleFiles.map((filePath) => path.basename(filePath)).join(', ')}`);
    }
  }

  return {
    bundleRoot,
    bundleTypes,
    ok: errors.length === 0,
    skipped: false,
    errors
  };
}

function main() {
  const repoRoot = getProjectRoot();
  const { bundles, platform, profile, targetDir, version } = parseArgs(process.argv);
  const expectedVersion = version || process.env.RELEASE_VERSION || readPackageVersion(repoRoot);
  const resolvedTargetDir = path.resolve(targetDir || resolveDefaultTargetDir(repoRoot));

  if (!expectedVersion) {
    console.error('[release] Unable to determine expected bundle version');
    process.exit(1);
  }

  const result = verifyBundleVersion({
    targetDir: resolvedTargetDir,
    profile,
    expectedVersion,
    platform,
    bundles
  });

  if (result.skipped) {
    console.log(`[release] Skipping bundle verification for platform ${normalizePlatform(platform)}`);
    return;
  }

  console.log(`[release] Verified bundle root: ${result.bundleRoot}`);
  console.log(`[release] Expected version: ${expectedVersion}`);
  console.log(`[release] Bundle types: ${result.bundleTypes.join(', ')}`);

  if (!result.ok) {
    for (const error of result.errors) {
      console.error(`[release] ${error}`);
    }
    process.exit(1);
  }

  console.log('[release] Bundle filename verification passed');
}

if (require.main === module) {
  main();
}

module.exports = {
  normalizePlatform,
  parseArgs,
  parseBundleList,
  resolveBundleTypes,
  verifyBundleVersion
};
