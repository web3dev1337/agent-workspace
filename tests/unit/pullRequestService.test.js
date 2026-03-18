jest.mock('child_process', () => ({
  execFile: jest.fn()
}));

const { execFile } = require('child_process');
const { PullRequestService } = require('../../server/pullRequestService');

describe('PullRequestService', () => {
  beforeEach(() => {
    execFile.mockReset();
  });

  test('mergePullRequestByUrl builds gh args and supports --auto', async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => cb(null, 'merged', ''));

    const service = PullRequestService.getInstance();
    const result = await service.mergePullRequestByUrl('https://github.com/web3dev1337/agent-workspace/pull/123', {
      method: 'merge',
      auto: true
    });

    expect(result.ok).toBe(true);
    expect(execFile).toHaveBeenCalledTimes(1);
    const [cmd, args] = execFile.mock.calls[0];
    expect(cmd).toBe('gh');
    expect(args).toEqual(expect.arrayContaining(['pr', 'merge']));
    expect(args).toEqual(expect.arrayContaining(['--merge']));
    expect(args).toEqual(expect.arrayContaining(['--auto']));
  });

  test('mergePullRequestByUrl rejects invalid URLs', async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => cb(null, 'merged', ''));

    const service = PullRequestService.getInstance();
    await expect(service.mergePullRequestByUrl('not-a-url')).rejects.toThrow('Invalid PR URL');
    expect(execFile).toHaveBeenCalledTimes(0);
  });

  test('reviewPullRequestByUrl builds gh args for approve', async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => cb(null, 'approved', ''));

    const service = PullRequestService.getInstance();
    const url = 'https://github.com/web3dev1337/agent-workspace/pull/123';
    const result = await service.reviewPullRequestByUrl(url, { action: 'approve' });

    expect(result.ok).toBe(true);
    expect(execFile).toHaveBeenCalledTimes(1);
    const [cmd, args] = execFile.mock.calls[0];
    expect(cmd).toBe('gh');
    expect(args).toEqual(['pr', 'review', url, '--approve']);
  });

  test('reviewPullRequestByUrl builds gh args for request changes and includes body', async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => cb(null, 'requested', ''));

    const service = PullRequestService.getInstance();
    const url = 'https://github.com/web3dev1337/agent-workspace/pull/123';
    const result = await service.reviewPullRequestByUrl(url, { action: 'request_changes', body: 'please fix' });

    expect(result.ok).toBe(true);
    expect(execFile).toHaveBeenCalledTimes(1);
    const [cmd, args] = execFile.mock.calls[0];
    expect(cmd).toBe('gh');
    expect(args).toEqual(['pr', 'review', url, '--request-changes', '--body', 'please fix']);
  });

  test('reviewPullRequestByUrl rejects invalid URLs', async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => cb(null, 'ok', ''));

    const service = PullRequestService.getInstance();
    await expect(service.reviewPullRequestByUrl('not-a-url', { action: 'approve' })).rejects.toThrow('Invalid PR URL');
    expect(execFile).toHaveBeenCalledTimes(0);
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
      repos: ['web3dev1337/agent-workspace'],
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

  test('ghApi adds --paginate and flattens paginated arrays', async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      expect(cmd).toBe('gh');
      expect(args).toEqual(['api', 'repos/o/r/pulls/1/files', '--method', 'GET', '--paginate']);
      cb(null, JSON.stringify([{ filename: 'a' }]) + '\n' + JSON.stringify([{ filename: 'b' }]) + '\n', '');
    });

    const service = PullRequestService.getInstance();
    const result = await service.ghApi('repos/o/r/pulls/1/files', { paginate: true });
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([{ filename: 'a' }, { filename: 'b' }]);
  });

  test('getPullRequestDetailsByUrl aggregates PR metadata, files, commits, and conversation', async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      expect(cmd).toBe('gh');

      // PR metadata + commits via `gh pr view --json ...`
      if (args[0] === 'pr' && args[1] === 'view') {
        cb(null, JSON.stringify({
          number: 123,
          title: 'Hello',
          state: 'OPEN',
          url: 'https://github.com/web3dev1337/repo/pull/123',
          isDraft: false,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z',
          mergedAt: null,
          closedAt: null,
          mergeable: 'MERGEABLE',
          baseRefName: 'main',
          headRefName: 'feature/x',
          author: { login: 'me' },
          commits: []
        }), '');
        return;
      }

      const path = args[1];
      if (args[0] !== 'api') {
        cb(new Error(`Unexpected gh invocation: ${args.join(' ')}`));
        return;
      }

      // PR files via REST (status + rename info)
      if (path === 'repos/web3dev1337/repo/pulls/123/files') {
        cb(null, JSON.stringify([{
          filename: 'src/a.js',
          status: 'modified',
          additions: 1,
          deletions: 2,
          changes: 3,
          previous_filename: null
        }]), '');
        return;
      }

      if (path === 'repos/web3dev1337/repo/pulls/123/commits') {
        cb(null, JSON.stringify([{
          sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          commit: {
            message: 'feat: x\n\nbody',
            author: { name: 'Me', date: '2026-01-02T00:00:00Z' },
            committer: { date: '2026-01-02T00:00:00Z' }
          },
          author: { login: 'me' }
        }]), '');
        return;
      }

      if (path === 'repos/web3dev1337/repo/issues/123/comments') {
        cb(null, JSON.stringify([{
          id: 1,
          user: { login: 'reviewer' },
          created_at: '2026-01-02T01:00:00Z',
          updated_at: '2026-01-02T01:00:00Z',
          body: 'Looks good'
        }]), '');
        return;
      }

      if (path === 'repos/web3dev1337/repo/pulls/123/reviews') {
        cb(null, JSON.stringify([{
          id: 2,
          user: { login: 'reviewer' },
          state: 'APPROVED',
          submitted_at: '2026-01-02T02:00:00Z',
          body: 'Approved'
        }]), '');
        return;
      }

      cb(new Error(`Unexpected gh api path: ${path}`));
    });

    const service = PullRequestService.getInstance();
    const result = await service.getPullRequestDetailsByUrl('https://github.com/web3dev1337/repo/pull/123', {
      maxFiles: 50,
      maxCommits: 50,
      maxComments: 50,
      maxReviews: 50
    });

    expect(execFile).toHaveBeenCalledTimes(5);
    expect(result.pr.number).toBe(123);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].filename).toBe('src/a.js');
    expect(result.commits).toHaveLength(1);
    expect(result.commits[0].sha).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(result.conversation.issueComments).toHaveLength(1);
    expect(result.conversation.reviews).toHaveLength(1);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });
});
