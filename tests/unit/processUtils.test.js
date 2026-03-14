const path = require('path');

const {
  CREATE_NO_WINDOW,
  augmentProcessEnv,
  buildPowerShellArgs,
  getHiddenProcessOptions
} = require('../../server/utils/processUtils');

describe('processUtils', () => {
  test('getHiddenProcessOptions only adds hidden flags on Windows', () => {
    expect(getHiddenProcessOptions({ stdio: 'pipe' }, 'linux')).toEqual({ stdio: 'pipe' });
    expect(getHiddenProcessOptions({ stdio: 'pipe' }, 'win32')).toEqual({
      stdio: 'pipe',
      windowsHide: true,
      creationFlags: CREATE_NO_WINDOW
    });
  });

  test('augmentProcessEnv is a no-op off Windows', () => {
    const env = { PATH: '/usr/bin:/bin', HOME: '/tmp/home' };
    expect(augmentProcessEnv(env, 'linux')).toEqual(env);
  });

  test('augmentProcessEnv adds common Windows CLI locations and syncs Path/PATH', () => {
    const env = {
      USERPROFILE: 'C:\\Users\\Tester',
      APPDATA: 'C:\\Users\\Tester\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\Tester\\AppData\\Local',
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      PATH: 'C:\\Windows\\System32'
    };

    const next = augmentProcessEnv(env, 'win32');

    expect(next.Path).toBe(next.PATH);
    expect(next.HOME).toBe('C:\\Users\\Tester');
    expect(next.Path).toContain('C:\\Windows\\System32');
    expect(next.Path).toContain(path.join(env.APPDATA, 'npm'));
    expect(next.Path).toContain(path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'));
    expect(next.Path).toContain(path.join(env.ProgramFiles, 'Git', 'cmd'));
    expect(next.Path).toContain(path.join(env.ProgramFiles, 'nodejs'));
  });

  test('buildPowerShellArgs adds hidden non-profile windows flags but stays cross-platform safe', () => {
    expect(buildPowerShellArgs('Write-Host hi', { keepOpen: true, platform: 'win32' })).toEqual([
      '-NoLogo',
      '-NoProfile',
      '-WindowStyle',
      'Hidden',
      '-NoExit',
      '-Command',
      'Write-Host hi'
    ]);

    expect(buildPowerShellArgs('echo ok', { platform: 'linux' })).toEqual([
      '-NoLogo',
      '-NoProfile',
      '-Command',
      'echo ok'
    ]);
  });
});
