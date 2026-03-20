#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { getProjectRoot, readPackageVersion } = require('./version-utils');

const PACKAGE_NAME = 'agent-workspace';
const PACKAGE_ARCH = 'x86_64';
const PACKAGE_RELEASE = '1';
const PACKAGE_URL = 'https://github.com/web3dev1337/agent-workspace';
const PACKAGE_DESCRIPTION = 'Multi-terminal orchestrator for Claude Code sessions';
const PACKAGE_LICENSE = 'MIT';
const PACKAGE_DEPENDS = [
  'gtk3',
  'webkit2gtk-4.1',
  'libayatana-appindicator',
  'hicolor-icon-theme'
];

function parseArgs(argv) {
  const args = argv.slice(2);
  let profile = 'release';
  let targetDir = null;
  let version = null;

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
    }
  }

  return { profile, targetDir, version };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function removeIfExists(targetPath) {
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
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

function resolveTargetDir(repoRoot, targetDir) {
  return path.resolve(targetDir || path.join(repoRoot, 'src-tauri', 'target'));
}

function resolveBundleRoot(targetDir, profile) {
  return path.join(targetDir, profile, 'bundle');
}

function findDebDataDir(bundleRoot, expectedVersion) {
  const debRoot = path.join(bundleRoot, 'deb');
  if (!fs.existsSync(debRoot)) {
    return null;
  }

  for (const entry of fs.readdirSync(debRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.includes(expectedVersion) || !entry.name.endsWith('_amd64')) continue;
    const dataDir = path.join(debRoot, entry.name, 'data');
    const launcherPath = path.join(dataDir, 'usr', 'bin', 'agent-workspace');
    if (fs.existsSync(launcherPath)) {
      return dataDir;
    }
  }

  return null;
}

function sumFileSizes(rootDir) {
  let total = 0;
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile()) {
        total += fs.statSync(fullPath).size;
      }
    }
  }
  return total;
}

function writePkgInfo(pkgRoot, version) {
  const installedSize = sumFileSizes(path.join(pkgRoot, 'usr'));
  const pkgInfoLines = [
    `pkgname = ${PACKAGE_NAME}`,
    `pkgbase = ${PACKAGE_NAME}`,
    `pkgver = ${version}-${PACKAGE_RELEASE}`,
    `pkgdesc = ${PACKAGE_DESCRIPTION}`,
    `url = ${PACKAGE_URL}`,
    `builddate = ${Math.floor(Date.now() / 1000)}`,
    'packager = Agent Workspace Release Automation',
    `size = ${installedSize}`,
    `arch = ${PACKAGE_ARCH}`,
    `license = ${PACKAGE_LICENSE}`,
    ...PACKAGE_DEPENDS.map((dependency) => `depend = ${dependency}`)
  ];
  fs.writeFileSync(path.join(pkgRoot, '.PKGINFO'), `${pkgInfoLines.join('\n')}\n`);
}

function createPackageArchive({ pkgRoot, outFile }) {
  ensureDir(path.dirname(outFile));
  removeIfExists(outFile);
  run('bsdtar', [
    '--uid', '0',
    '--gid', '0',
    '--numeric-owner',
    '--format', 'gnutar',
    '--zstd',
    '-cf', outFile,
    '.PKGINFO',
    'usr'
  ], { cwd: pkgRoot });
}

function main() {
  const repoRoot = getProjectRoot();
  const { profile, targetDir, version } = parseArgs(process.argv);
  const expectedVersion = version || process.env.RELEASE_VERSION || readPackageVersion(repoRoot);
  if (!expectedVersion) {
    throw new Error('Unable to determine package version for Arch package build');
  }

  const resolvedTargetDir = resolveTargetDir(repoRoot, targetDir);
  const bundleRoot = resolveBundleRoot(resolvedTargetDir, profile);
  const debDataDir = findDebDataDir(bundleRoot, expectedVersion);
  if (!debDataDir) {
    throw new Error(`Unable to locate extracted deb bundle for version ${expectedVersion} under ${bundleRoot}`);
  }

  const pacmanRoot = path.join(bundleRoot, 'pacman');
  const pkgStem = `${PACKAGE_NAME}-${expectedVersion}-${PACKAGE_RELEASE}-${PACKAGE_ARCH}`;
  const pkgRoot = path.join(pacmanRoot, pkgStem);
  const outFile = path.join(pacmanRoot, `${pkgStem}.pkg.tar.zst`);

  removeIfExists(pkgRoot);
  ensureDir(pkgRoot);
  fs.cpSync(debDataDir, pkgRoot, { recursive: true });
  writePkgInfo(pkgRoot, expectedVersion);
  createPackageArchive({ pkgRoot, outFile });

  console.log(`[arch] Built package: ${outFile}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  PACKAGE_ARCH,
  PACKAGE_DEPENDS,
  PACKAGE_NAME,
  PACKAGE_RELEASE,
  createPackageArchive,
  findDebDataDir,
  parseArgs,
  resolveBundleRoot,
  resolveTargetDir,
  sumFileSizes,
  writePkgInfo
};
