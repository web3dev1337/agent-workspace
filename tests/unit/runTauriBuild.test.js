const path = require('path');

const {
  defaultLocalWindowsFastTargetDir,
  parseArgs,
  resolveCargoTargetDir
} = require('../../scripts/tauri/run-tauri-build');

describe('run-tauri-build', () => {
  test('parses explicit profile and dry-run flag', () => {
    expect(parseArgs(['node', 'run-tauri-build.js', '--profile', 'fast', '--dry-run'])).toEqual({
      profile: 'fast',
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
});
