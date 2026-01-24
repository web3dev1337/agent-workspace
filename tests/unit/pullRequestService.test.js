jest.mock('child_process', () => ({
  execFile: jest.fn()
}));

const { execFile } = require('child_process');
const { PullRequestService } = require('../../server/pullRequestService');

describe('PullRequestService', () => {
  beforeEach(() => {
    execFile.mockReset();
  });

  test('searchPullRequests builds gh args and parses results', async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      cb(
        null,
        JSON.stringify([
          {
            number: 123,
            title: 'Test PR',
            state: 'OPEN',
            url: 'https://example.com/pr/123',
            repository: { name: 'repo', owner: { login: 'me' } },
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-02T00:00:00Z',
            author: { login: 'me' }
          }
        ]),
        ''
      );
    });

    const service = PullRequestService.getInstance();
    const result = await service.searchPullRequests({
      mode: 'mine',
      state: 'open',
      sort: 'updated',
      limit: 10,
      query: 'something',
      repos: ['web3dev1337/claude-orchestrator'],
      owners: ['web3dev1337']
    });

    expect(execFile).toHaveBeenCalledTimes(1);
    const [cmd, args] = execFile.mock.calls[0];
    expect(cmd).toBe('gh');
    expect(args).toEqual(expect.arrayContaining(['search', 'prs']));
    expect(args).toEqual(expect.arrayContaining(['--author', '@me']));
    expect(args).toEqual(expect.arrayContaining(['--state', 'open']));
    expect(result.count).toBe(1);
    expect(result.prs[0].number).toBe(123);
  });

  test('closed state adds -is:merged query part', async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => cb(null, '[]', ''));

    const service = PullRequestService.getInstance();
    await service.searchPullRequests({
      mode: 'all',
      state: 'closed',
      sort: 'updated',
      limit: 1
    });

    const [, args] = execFile.mock.calls[0];
    expect(args).toEqual(expect.arrayContaining(['--state', 'closed']));
    expect(args).toEqual(expect.arrayContaining(['--', '-is:merged']));
  });
});

