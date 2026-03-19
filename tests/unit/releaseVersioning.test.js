const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildConsistencyErrors } = require('../../scripts/release/check-version-consistency');
const {
  normalizeTagVersion,
  readCargoPackageVersionFromContent,
  readTagVersionFromEnv
} = require('../../scripts/release/version-utils');
const { verifyBundleVersion } = require('../../scripts/release/verify-bundle-version');

describe('release versioning', () => {
  test('normalizes tag refs from GitHub inputs', () => {
    expect(normalizeTagVersion('refs/tags/v0.1.7')).toBe('0.1.7');
    expect(readTagVersionFromEnv({ GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v0.1.8' })).toBe('0.1.8');
    expect(readTagVersionFromEnv({ GITHUB_REF: 'refs/heads/main' })).toBe(null);
  });

  test('parses the Cargo package version from the package section', () => {
    const content = [
      '[package]',
      'name = "agent-workspace"',
      'version = "0.1.7"',
      '',
      '[dependencies]',
      'tauri = "2"'
    ].join('\n');

    expect(readCargoPackageVersionFromContent(content)).toBe('0.1.7');
  });

  test('reports drift between package, tauri, cargo, and tag versions', () => {
    const errors = buildConsistencyErrors({
      packageVersion: '0.1.7',
      tauriVersion: '0.1.6',
      cargoVersion: '0.1.5',
      tagVersion: '0.1.8'
    });

    expect(errors).toEqual(expect.arrayContaining([
      'src-tauri/tauri.conf.json version 0.1.6 does not match package.json version 0.1.7',
      'src-tauri/Cargo.toml version 0.1.5 does not match package.json version 0.1.7',
      'Git tag version 0.1.8 does not match package.json version 0.1.7'
    ]));
  });

  test('accepts bundle artifacts only when every filename carries the expected version', () => {
    const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-bundle-pass-'));
    const nsisDir = path.join(targetDir, 'release', 'bundle', 'nsis');
    const msiDir = path.join(targetDir, 'release', 'bundle', 'msi');
    fs.mkdirSync(nsisDir, { recursive: true });
    fs.mkdirSync(msiDir, { recursive: true });
    fs.writeFileSync(path.join(nsisDir, 'Agent.Workspace_0.1.7_x64-setup.exe'), 'ok');
    fs.writeFileSync(path.join(msiDir, 'Agent.Workspace_0.1.7_x64_en-US.msi'), 'ok');

    const result = verifyBundleVersion({
      targetDir,
      profile: 'release',
      expectedVersion: '0.1.7',
      platform: 'windows',
      bundles: null
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);

    fs.rmSync(targetDir, { recursive: true, force: true });
  });

  test('rejects stale bundle artifacts that would match wildcard uploads', () => {
    const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-bundle-fail-'));
    const nsisDir = path.join(targetDir, 'release', 'bundle', 'nsis');
    fs.mkdirSync(nsisDir, { recursive: true });
    fs.writeFileSync(path.join(nsisDir, 'Agent.Workspace_0.1.5-2_x64-setup.exe'), 'stale');

    const result = verifyBundleVersion({
      targetDir,
      profile: 'release',
      expectedVersion: '0.1.7',
      platform: 'windows',
      bundles: 'nsis'
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('No nsis artifacts include version 0.1.7'),
      expect.stringContaining('Found stale nsis artifacts without version 0.1.7')
    ]));

    fs.rmSync(targetDir, { recursive: true, force: true });
  });
});
