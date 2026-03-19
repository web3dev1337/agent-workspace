const fs = require('fs');
const path = require('path');

function getProjectRoot(fromDir = __dirname) {
  return path.resolve(fromDir, '..', '..');
}

function readJsonVersion(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch (error) {
    return null;
  }
}

function readPackageVersion(root = getProjectRoot()) {
  return readJsonVersion(path.join(root, 'package.json'));
}

function readTauriVersion(root = getProjectRoot()) {
  return readJsonVersion(path.join(root, 'src-tauri', 'tauri.conf.json'));
}

function readCargoPackageVersionFromContent(raw) {
  const lines = String(raw).split(/\r?\n/);
  let inPackageSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '[package]') {
      inPackageSection = true;
      continue;
    }
    if (inPackageSection && trimmed.startsWith('[') && trimmed !== '[package]') {
      break;
    }
    if (!inPackageSection) {
      continue;
    }
    const match = trimmed.match(/^version\s*=\s*"([^"]+)"$/);
    if (match) {
      return match[1];
    }
  }

  return null;
}

function readCargoVersion(root = getProjectRoot()) {
  try {
    const cargoPath = path.join(root, 'src-tauri', 'Cargo.toml');
    return readCargoPackageVersionFromContent(fs.readFileSync(cargoPath, 'utf8'));
  } catch (error) {
    return null;
  }
}

function normalizeTagVersion(value) {
  if (!value) {
    return null;
  }

  let normalized = String(value).trim();
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith('refs/tags/')) {
    normalized = normalized.slice('refs/tags/'.length);
  }
  if (normalized.startsWith('v')) {
    normalized = normalized.slice(1);
  }
  return normalized || null;
}

function readTagVersionFromEnv(env = process.env) {
  if (env.RELEASE_TAG) {
    return normalizeTagVersion(env.RELEASE_TAG);
  }
  if (env.GITHUB_REF_TYPE === 'tag' && env.GITHUB_REF_NAME) {
    return normalizeTagVersion(env.GITHUB_REF_NAME);
  }
  if (env.GITHUB_REF && String(env.GITHUB_REF).startsWith('refs/tags/')) {
    return normalizeTagVersion(env.GITHUB_REF);
  }
  return null;
}

function collectVersionState(root = getProjectRoot(), env = process.env) {
  return {
    packageVersion: readPackageVersion(root),
    tauriVersion: readTauriVersion(root),
    cargoVersion: readCargoVersion(root),
    tagVersion: readTagVersionFromEnv(env)
  };
}

module.exports = {
  collectVersionState,
  getProjectRoot,
  normalizeTagVersion,
  readCargoPackageVersionFromContent,
  readCargoVersion,
  readPackageVersion,
  readTagVersionFromEnv,
  readTauriVersion
};
