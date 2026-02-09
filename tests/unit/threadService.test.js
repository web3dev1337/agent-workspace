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

  test('returns existing active thread for same workspace/worktree', () => {
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

    expect(second.id).toBe(first.id);
    expect(service.list({ workspaceId: 'zoo-game' }).length).toBe(1);
  });

  test('does not collide active threads across repos with same worktree id', () => {
    const service = new ThreadService({ logger: { info: () => {}, warn: () => {}, error: () => {} } });
    service.init({});

    const first = service.createThread({
      workspaceId: 'zoo-game',
      worktreeId: 'work1',
      repositoryName: 'incremental-game',
      repositoryPath: '/tmp/incremental-game',
      title: 'Incremental'
    });
    const second = service.createThread({
      workspaceId: 'zoo-game',
      worktreeId: 'work1',
      repositoryName: 'epic-survivors',
      repositoryPath: '/tmp/epic-survivors',
      title: 'Survivors'
    });

    expect(second.id).not.toBe(first.id);
    expect(service.list({ workspaceId: 'zoo-game' }).length).toBe(2);
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

  test('aggregates repository-level projects across workspaces', () => {
    const service = new ThreadService({ logger: { info: () => {}, warn: () => {}, error: () => {} } });
    service.init({
      workspaceManager: {
        getWorkspace: (workspaceId) => {
          if (workspaceId === 'workspace-a') return { id: 'workspace-a', name: 'Workspace A' };
          if (workspaceId === 'workspace-b') return { id: 'workspace-b', name: 'Workspace B' };
          return null;
        }
      }
    });

    const first = service.createThread({
      workspaceId: 'workspace-a',
      worktreeId: 'work1',
      repositoryName: 'incremental-game',
      repositoryPath: '/tmp/incremental-game/master',
      title: 'Repo 1 active'
    });
    const second = service.createThread({
      workspaceId: 'workspace-b',
      worktreeId: 'work2',
      repositoryName: 'incremental-game',
      repositoryPath: '/tmp/incremental-game/work2',
      title: 'Repo 1 closed'
    });
    service.closeThread(second.id);

    const archived = service.createThread({
      workspaceId: 'workspace-a',
      worktreeId: 'work9',
      repositoryName: 'epic-survivors',
      repositoryPath: '/tmp/epic-survivors/master',
      title: 'Repo 2 archived'
    });
    service.archiveThread(archived.id);

    const projects = service.listProjects();
    expect(projects.length).toBe(1);
    expect(projects[0].projectId).toBe('repo-path:/tmp/incremental-game');
    expect(projects[0].workspaceIds).toEqual(['workspace-a', 'workspace-b']);
    expect(projects[0].workspaceNames).toEqual(['Workspace A', 'Workspace B']);
    expect(projects[0].activeThreadCount).toBe(1);
    expect(projects[0].closedThreadCount).toBe(1);
    expect(projects[0].archivedThreadCount).toBe(0);
    expect(projects[0].threadCount).toBe(2);

    const withArchived = service.listProjects({ includeArchived: true });
    expect(withArchived.length).toBe(2);
    const archivedProject = withArchived.find((row) => row.projectId === 'repo-path:/tmp/epic-survivors');
    expect(archivedProject).toBeTruthy();
    expect(archivedProject.archivedThreadCount).toBe(1);
    expect(archivedProject.threadCount).toBe(1);
  });
});
