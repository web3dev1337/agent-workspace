#!/usr/bin/env node

const { collectVersionState, getProjectRoot } = require('./version-utils');

function buildConsistencyErrors(state) {
  const errors = [];
  const { packageVersion, tauriVersion, cargoVersion, tagVersion } = state;

  if (!packageVersion) {
    errors.push('package.json is missing a readable version');
  }
  if (!tauriVersion) {
    errors.push('src-tauri/tauri.conf.json is missing a readable version');
  }
  if (!cargoVersion) {
    errors.push('src-tauri/Cargo.toml is missing a readable [package] version');
  }

  if (packageVersion && tauriVersion && packageVersion !== tauriVersion) {
    errors.push(`src-tauri/tauri.conf.json version ${tauriVersion} does not match package.json version ${packageVersion}`);
  }
  if (packageVersion && cargoVersion && packageVersion !== cargoVersion) {
    errors.push(`src-tauri/Cargo.toml version ${cargoVersion} does not match package.json version ${packageVersion}`);
  }
  if (tagVersion && packageVersion && tagVersion !== packageVersion) {
    errors.push(`Git tag version ${tagVersion} does not match package.json version ${packageVersion}`);
  }

  return errors;
}

function main() {
  const root = getProjectRoot();
  const state = collectVersionState(root, process.env);
  const errors = buildConsistencyErrors(state);

  console.log(`[release] package.json: ${state.packageVersion || 'missing'}`);
  console.log(`[release] tauri.conf.json: ${state.tauriVersion || 'missing'}`);
  console.log(`[release] Cargo.toml: ${state.cargoVersion || 'missing'}`);
  if (state.tagVersion) {
    console.log(`[release] tag: ${state.tagVersion}`);
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`[release] ${error}`);
    }
    process.exit(1);
  }

  console.log('[release] Version consistency check passed');
}

if (require.main === module) {
  main();
}

module.exports = {
  buildConsistencyErrors
};
