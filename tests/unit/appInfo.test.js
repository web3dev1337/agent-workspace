const { DEFAULT_APP_NAME, readAppInfo } = require('../../server/appInfo');

describe('appInfo', () => {
  test('reads app name and version from package metadata', () => {
    const appInfo = readAppInfo({
      readFileSync: () => JSON.stringify({
        name: 'agent-workspace',
        productName: 'Agent Workspace',
        version: '0.1.13'
      })
    });

    expect(appInfo).toEqual({
      name: 'Agent Workspace',
      version: '0.1.13',
      displayVersion: 'v0.1.13'
    });
  });

  test('falls back cleanly when package metadata is unavailable', () => {
    const appInfo = readAppInfo({
      readFileSync: () => {
        throw new Error('missing');
      }
    });

    expect(appInfo).toEqual({
      name: DEFAULT_APP_NAME,
      version: null,
      displayVersion: null
    });
  });
});
