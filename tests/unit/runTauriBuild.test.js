const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  clearBundleOutputDir,
  defaultLocalWindowsFastTargetDir,
  parseArgs,
  parseBundleList,
  resolveBundleTargets,
  resolveCargoTargetDir,
  resolveTargetRoot
} = require('../../scripts/tauri/run-tauri-build');

describe('run-tauri-build', () => {
  test('parses explicit profile and dry-run flag', () => {
    expect(parseArgs(['node', 'run-tauri-build.js', '--profile', 'fast', '--bundles', 'nsis,msi', '--dry-run'])).toEqual({
      profile: 'fast',
      bundles: 'nsis,msi',
      dryRun: true
    });
  });

  test('pins local Windows fast builds to a stable cache dir', () => {
    const env = { LOCALAPPDATA: 'C:\\Users\\Administrator\\AppData\\Local' };

    expect(resolveCargoTargetDir({ profile: 'fast', env, platform: 'win32' })).toEqual({
      targetDir: path.win32.join(env.LOCALAPPDATA, 'AgentWorkspaceBuildCache', 'tauri-target'),
      reason: 'local-windows-fast-cache'
    });
  });

  test('keeps CI builds on the repo-local target dir', () => {
    expect(resolveCargoTargetDir({
      profile: 'fast',
      env: { LOCALAPPDATA: 'C:\\Users\\Administrator\\AppData\\Local', CI: 'true' },
      platform: 'win32'
    })).toEqual({
      targetDir: null,
      reason: 'repo-default'
    });
  });

  test('respects explicit cargo target dir overrides', () => {
    expect(resolveCargoTargetDir({
      profile: 'fast',
      env: { CARGO_TARGET_DIR: 'D:\\CargoTarget' },
      platform: 'win32'
    })).toEqual({
      targetDir: 'D:\\CargoTarget',
      reason: 'env:CARGO_TARGET_DIR'
    });
  });

  test('builds the default Windows cache dir from local app data', () => {
    expect(defaultLocalWindowsFastTargetDir({
      LOCALAPPDATA: 'C:\\Users\\Administrator\\AppData\\Local'
    })).toBe('C:\\Users\\Administrator\\AppData\\Local\\AgentWorkspaceBuildCache\\tauri-target');
  });

  test('splits bundle lists on commas and whitespace', () => {
    expect(parseBundleList('nsis, msi updater')).toEqual(['nsis', 'msi', 'updater']);
  });

  test('uses nsis-only bundles for local Windows fast builds', () => {
    expect(resolveBundleTargets({
      profile: 'fast',
      env: { LOCALAPPDATA: 'C:\\Users\\Administrator\\AppData\\Local' },
      platform: 'win32'
    })).toEqual({
      bundleTargets: ['nsis'],
      reason: 'local-windows-fast-installer'
    });
  });

  test('respects explicit bundle overrides', () => {
    expect(resolveBundleTargets({
      profile: 'fast',
      explicitBundles: 'msi',
      env: {},
      platform: 'win32'
    })).toEqual({
      bundleTargets: ['msi'],
      reason: 'arg:--bundles'
    });
  });

  test('uses repo-local target dir when no override is present', () => {
    expect(resolveTargetRoot({
      repoRoot: '/repo/root',
      targetDir: null
    })).toBe(path.resolve('/repo/root', 'src-tauri', 'target'));
  });

  test('clears the profile bundle output directory before build', () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'run-tauri-build-'));
    const bundleDir = path.join(repoRoot, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
    fs.mkdirSync(bundleDir, { recursive: true });
    fs.writeFileSync(path.join(bundleDir, 'stale.exe'), 'old');

    const clearedPath = clearBundleOutputDir({ repoRoot, targetDir: null, profile: 'release' });

    expect(clearedPath).toBe(path.join(repoRoot, 'src-tauri', 'target', 'release', 'bundle'));
    expect(fs.existsSync(clearedPath)).toBe(false);

    fs.rmSync(repoRoot, { recursive: true, force: true });
  });
});
