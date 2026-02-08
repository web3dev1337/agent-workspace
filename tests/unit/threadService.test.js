const fs = require('fs');
const os = require('os');
const path = require('path');
const { ThreadService } = require('../../server/threadService');

describe('ThreadService', () => {
  let prevDataDir;
  let tmpDir;

  beforeEach(() => {
    prevDataDir = process.env.ORCHESTRATOR_DATA_DIR;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-threads-'));
    process.env.ORCHESTRATOR_DATA_DIR = tmpDir;
  });

  afterEach(() => {
    if (prevDataDir === undefined) delete process.env.ORCHESTRATOR_DATA_DIR;
    else process.env.ORCHESTRATOR_DATA_DIR = prevDataDir;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test('creates and persists a thread', () => {
    const service = new ThreadService({ logger: { info: () => {}, warn: () => {}, error: () => {} } });
    service.init({});

    const thread = service.createThread({
      workspaceId: 'zoo-game',
      worktreeId: 'work8',
      title: 'Dragon Egg',
      sessionIds: ['zoo-game-work8-claude']
    });

    expect(thread.workspaceId).toBe('zoo-game');
    expect(thread.worktreeId).toBe('work8');
    expect(thread.status).toBe('active');

    const raw = JSON.parse(fs.readFileSync(path.join(tmpDir, 'threads.json'), 'utf8'));
    expect(Array.isArray(raw.threads)).toBe(true);
    expect(raw.threads.length).toBe(1);
    expect(raw.threads[0].workspaceId).toBe('zoo-game');
  });

  test('allows multiple active threads for same workspace/worktree', () => {
    const service = new ThreadService({ logger: { info: () => {}, warn: () => {}, error: () => {} } });
    service.init({});

    const first = service.createThread({
      workspaceId: 'zoo-game',
      worktreeId: 'work3',
      title: 'First'
    });
    const second = service.createThread({
      workspaceId: 'zoo-game',
      worktreeId: 'work3',
      title: 'Second'
    });

    expect(second.id).not.toBe(first.id);
    expect(service.list({ workspaceId: 'zoo-game' }).length).toBe(2);
  });

  test('supports projectId filtering and derives projectId from repositoryPath', () => {
    const service = new ThreadService({ logger: { info: () => {}, warn: () => {}, error: () => {} } });
    service.init({});

    const t1 = service.createThread({
      workspaceId: 'zoo-game',
      repositoryPath: '/tmp/repo-a',
      repositoryName: 'repo-a',
      worktreeId: 'work1',
      title: 'A1'
    });
    const t2 = service.createThread({
      workspaceId: 'zoo-game',
      repositoryPath: '/tmp/repo-b',
      repositoryName: 'repo-b',
      worktreeId: 'work1',
      title: 'B1'
    });

    expect(t1.projectId).toBe('repo:/tmp/repo-a');
    expect(t2.projectId).toBe('repo:/tmp/repo-b');
    expect(service.list({ workspaceId: 'zoo-game', projectId: 'repo:/tmp/repo-a' }).length).toBe(1);
    expect(service.list({ workspaceId: 'zoo-game', projectId: 'repo:/tmp/repo-b' }).length).toBe(1);
  });

  test('close and archive transitions are persisted', () => {
    const service = new ThreadService({ logger: { info: () => {}, warn: () => {}, error: () => {} } });
    service.init({});

    const created = service.createThread({
      workspaceId: 'workspace-a',
      worktreeId: 'work9',
      title: 'Thread status flow'
    });

    const closed = service.closeThread(created.id);
    expect(closed.status).toBe('closed');

    const archived = service.archiveThread(created.id);
    expect(archived.status).toBe('archived');

    const activeOnly = service.list({ workspaceId: 'workspace-a' });
    expect(activeOnly.length).toBe(0);

    const withArchived = service.list({ workspaceId: 'workspace-a', includeArchived: true });
    expect(withArchived.length).toBe(1);
    expect(withArchived[0].status).toBe('archived');
  });
});
