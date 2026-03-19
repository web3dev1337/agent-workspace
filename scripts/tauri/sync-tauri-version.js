#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function getProjectRoot() {
  return path.resolve(__dirname, '..', '..');
}

function parseVersionArgument(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--version' || arg === '-v') {
      if (argv[i + 1]) {
        return argv[i + 1];
      }
    }
  }
  return null;
}

function getDefaultVersion(root) {
  const pkgPath = path.join(root, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
  } catch (error) {
    return null;
  }
}

function updateTauriConfig(tauriConfigPath, version) {
  const raw = fs.readFileSync(tauriConfigPath, 'utf8');
  const config = JSON.parse(raw);
  if (config.version === version) return false;
  config.version = version;
  fs.writeFileSync(tauriConfigPath, `${JSON.stringify(config, null, 2)}\n`);
  return true;
}

function updateCargoVersion(cargoPath, version) {
  const raw = fs.readFileSync(cargoPath, 'utf8');
  const lines = raw.split(/\r?\n/);
  let inPackageSection = false;
  let replaced = false;
  const updated = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed === '[package]') {
      inPackageSection = true;
      return line;
    }
    if (inPackageSection && trimmed.startsWith('[') && trimmed !== '[package]') {
      inPackageSection = false;
    }
    if (inPackageSection && !replaced && trimmed.startsWith('version')) {
      replaced = true;
      const indent = line.slice(0, line.indexOf('version'));
      return `${indent}version = "${version}"`;
    }
    return line;
  });
  if (!replaced) {
    throw new Error('Unable to update the Cargo.toml package version');
  }
  const updatedContent = updated.join('\n');
  if (updatedContent === raw) return false;
  fs.writeFileSync(cargoPath, updatedContent + (updatedContent.endsWith('\n') ? '' : '\n'));
  return true;
}

function main() {
  const root = getProjectRoot();
  const versionFromArg = parseVersionArgument(process.argv.slice(2));
  const envVersion = process.env.RELEASE_VERSION || process.env.BUILD_VERSION || process.env.VERSION;
  const defaultVersion = getDefaultVersion(root);
  const version = versionFromArg || envVersion || defaultVersion;

  if (!version) {
    console.error('No release version could be determined (argument, RELEASE_VERSION, or package.json)');
    process.exit(1);
  }

  console.log(`Syncing Tauri/Cargo version to ${version}`);

  const tauriConfigPath = path.join(root, 'src-tauri', 'tauri.conf.json');
  const cargoPath = path.join(root, 'src-tauri', 'Cargo.toml');

  updateTauriConfig(tauriConfigPath, version);
  updateCargoVersion(cargoPath, version);
}

if (require.main === module) {
  main();
}
