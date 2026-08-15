jest.mock('child_process', () => ({
  execFile: jest.fn()
}));

const { execFile } = require('child_process');
const { PullRequestService } = require('../../server/pullRequestService');

const samplePrs = [
  {
    number: 7,
    title: 'Sample PR',
    state: 'OPEN',
    url: 'https://github.com/web3dev1337/agent-workspace/pull/7',
    isDraft: false,
    repository: { name: 'agent-workspace', owner: { login: 'web3dev1337' } },
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-02T00:00:00Z',
    author: { login: 'web3dev1337' }
  }
];

describe('PullRequestService search cache', () => {
  let nowSpy;

  beforeEach(() => {
    execFile.mockReset();
    execFile.mockImplementation((cmd, args, opts, cb) => cb(null, JSON.stringify(samplePrs), ''));
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  test('identical searches within the TTL reuse the cached result', async () => {
    const service = new PullRequestService();

    const first = await service.searchPullRequests({ mode: 'mine', state: 'open' });
    const second = await service.searchPullRequests({ mode: 'mine', state: 'open' });

    expect(execFile).toHaveBeenCalledTimes(1);
    expect(second.prs).toEqual(first.prs);
  });

  test('different params trigger separate gh invocations', async () => {
    const service = new PullRequestService();

    await service.searchPullRequests({ mode: 'mine', state: 'open' });
    await service.searchPullRequests({ mode: 'mine', state: 'merged' });

    expect(execFile).toHaveBeenCalledTimes(2);
  });

  test('concurrent identical searches coalesce into one gh invocation', async () => {
    let release;
    execFile.mockImplementation((cmd, args, opts, cb) => {
      release = () => cb(null, JSON.stringify(samplePrs), '');
    });
    const service = new PullRequestService();

    const a = service.searchPullRequests({ mode: 'mine', state: 'open' });
    const b = service.searchPullRequests({ mode: 'mine', state: 'open' });
    release();

    const [ra, rb] = await Promise.all([a, b]);
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(ra.count).toBe(1);
    expect(rb.count).toBe(1);
  });

  test('expired entries are refetched', async () => {
    const service = new PullRequestService();

    await service.searchPullRequests({ mode: 'mine', state: 'open' });
    nowSpy.mockReturnValue(1_000_000 + 31_000);
    await service.searchPullRequests({ mode: 'mine', state: 'open' });

    expect(execFile).toHaveBeenCalledTimes(2);
  });

  test('refresh param bypasses the cache', async () => {
    const service = new PullRequestService();

    await service.searchPullRequests({ mode: 'mine', state: 'open' });
    await service.searchPullRequests({ mode: 'mine', state: 'open', refresh: '1' });

    expect(execFile).toHaveBeenCalledTimes(2);
  });

  test('merging a PR invalidates cached searches', async () => {
    const service = new PullRequestService();

    await service.searchPullRequests({ mode: 'mine', state: 'open' });
    await service.mergePullRequestByUrl('https://github.com/web3dev1337/agent-workspace/pull/7', { method: 'merge' });
    await service.searchPullRequests({ mode: 'mine', state: 'open' });

    expect(execFile).toHaveBeenCalledTimes(3); // search, merge, fresh search
  });

  test('reviewing a PR invalidates cached searches', async () => {
    const service = new PullRequestService();

    await service.searchPullRequests({ mode: 'mine', state: 'open' });
    await service.reviewPullRequestByUrl('https://github.com/web3dev1337/agent-workspace/pull/7', { action: 'approve' });
    await service.searchPullRequests({ mode: 'mine', state: 'open' });

    expect(execFile).toHaveBeenCalledTimes(3);
  });

  test('failed searches are not cached', async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => cb(new Error('gh exploded'), '', 'boom'));
    const service = new PullRequestService();

    await expect(service.searchPullRequests({ mode: 'mine', state: 'open' })).rejects.toThrow('gh exploded');

    execFile.mockImplementation((cmd, args, opts, cb) => cb(null, JSON.stringify(samplePrs), ''));
    const result = await service.searchPullRequests({ mode: 'mine', state: 'open' });

    expect(result.count).toBe(1);
    expect(execFile).toHaveBeenCalledTimes(2);
  });

  test('mutating a returned result does not pollute the cache', async () => {
    const service = new PullRequestService();

    const first = await service.searchPullRequests({ mode: 'mine', state: 'open' });
    first.prs[0].title = 'MUTATED';
    first.prs.push({ number: 99 });

    const second = await service.searchPullRequests({ mode: 'mine', state: 'open' });
    expect(second.prs).toHaveLength(1);
    expect(second.prs[0].title).toBe('Sample PR');
  });
});
