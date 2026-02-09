const { ThreadService } = require('../../server/threadService');

describe('ThreadService projectId derivation', () => {
  let service;

  beforeEach(() => {
    service = new ThreadService();
  });

  test('derives repo-path projectId from repositoryPath ending in master', () => {
    const row = service.normalizeThread({
      id: 't1',
      workspaceId: 'zoo-gamabc',
      repositoryPath: '/tmp/incremental-game/master',
      worktreeId: 'work1'
    }, 0);

    expect(row.projectId).toBe('repo-path:/tmp/incremental-game');
  });

  test('derives repo-path projectId from repositoryPath ending in workN', () => {
    const row = service.normalizeThread({
      id: 't2',
      workspaceId: 'zoo-gamabc',
      repositoryPath: '/tmp/incremental-game/work8',
      worktreeId: 'work8'
    }, 0);

    expect(row.projectId).toBe('repo-path:/tmp/incremental-game');
  });

  test('migrates legacy workspace-scoped projectId to repository-scoped id', () => {
    const row = service.normalizeThread({
      id: 't3',
      workspaceId: 'zoo-gamabc',
      projectId: 'zoo-gamabc',
      repositoryName: 'Incremental-Game'
    }, 0);

    expect(row.projectId).toBe('repo-name:incremental-game');
  });

  test('keeps explicit non-legacy projectId value', () => {
    const row = service.normalizeThread({
      id: 't4',
      workspaceId: 'zoo-gamabc',
      projectId: 'custom-project-id',
      repositoryPath: '/tmp/incremental-game/master'
    }, 0);

    expect(row.projectId).toBe('custom-project-id');
  });
});
