describe('trelloCredentials', () => {
  test('loads from env when present', async () => {
    jest.resetModules();
    const { loadTrelloCredentialsFromEnv } = require('../../server/taskProviders/trelloCredentials');

    const creds = loadTrelloCredentialsFromEnv({
      TRELLO_API_KEY: 'key',
      TRELLO_TOKEN: 'token'
    });

    expect(creds).toEqual({ apiKey: 'key', token: 'token', source: 'env' });
  });

  test('parses key/value file format', async () => {
    jest.resetModules();
    const { parseKeyValueFile } = require('../../server/taskProviders/trelloCredentials');

    const parsed = parseKeyValueFile(`# comment\nAPI_KEY=abc\nTOKEN=def\n`);
    expect(parsed.API_KEY).toBe('abc');
    expect(parsed.TOKEN).toBe('def');
  });

  test('loads from file when env missing', async () => {
    jest.resetModules();

    jest.doMock('fs', () => ({
      existsSync: jest.fn(() => true),
      readFileSync: jest.fn(() => `API_KEY=abc\nTOKEN=def\n`)
    }));

    const { loadTrelloCredentialsFromFile } = require('../../server/taskProviders/trelloCredentials');
    const creds = loadTrelloCredentialsFromFile('/tmp/.trello-credentials');

    expect(creds).toEqual({ apiKey: 'abc', token: 'def', source: '/tmp/.trello-credentials' });
  });
});

