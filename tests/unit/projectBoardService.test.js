const fs = require('fs');
const os = require('os');
const path = require('path');

const { ProjectBoardService } = require('../../server/projectBoardService');

describe('ProjectBoardService', () => {
  test('loads default board when missing', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-project-board-'));
    const storePath = path.join(tmp, 'project-board.json');
    const svc = new ProjectBoardService({ storePath });

    const board = await svc.load({ refresh: true });
    expect(board).toEqual({
      version: 2,
      updatedAt: null,
      projectToColumn: {},
      orderByColumn: {},
      collapsedColumnIds: [],
      tagsByProjectKey: {}
    });
  });

  test('moves project and persists mapping', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-project-board-'));
    const storePath = path.join(tmp, 'project-board.json');
    const svc = new ProjectBoardService({ storePath });

    const saved = await svc.moveProject({ projectKey: 'tools/automation/agent-workspace', columnId: 'active' });
    expect(saved.projectToColumn['tools/automation/agent-workspace']).toBe('active');
    expect(saved.orderByColumn.active).toEqual(['tools/automation/agent-workspace']);
    expect(typeof saved.updatedAt).toBe('string');

    const reloaded = await svc.load({ refresh: true });
    expect(reloaded.projectToColumn['tools/automation/agent-workspace']).toBe('active');
    expect(reloaded.orderByColumn.active).toEqual(['tools/automation/agent-workspace']);
  });

  test('backlog clears mapping entry', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-project-board-'));
    const storePath = path.join(tmp, 'project-board.json');
    const svc = new ProjectBoardService({ storePath });

    await svc.moveProject({ projectKey: 'games/hytopia/zoo-game', columnId: 'next' });
    const cleared = await svc.moveProject({ projectKey: 'games/hytopia/zoo-game', columnId: 'backlog' });
    expect(cleared.projectToColumn['games/hytopia/zoo-game']).toBeUndefined();
    expect(cleared.orderByColumn.next).toBeUndefined();
    expect(cleared.orderByColumn.backlog).toEqual(['games/hytopia/zoo-game']);
  });

  test('rejects invalid columns', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-project-board-'));
    const storePath = path.join(tmp, 'project-board.json');
    const svc = new ProjectBoardService({ storePath });

    await expect(svc.moveProject({ projectKey: 'x', columnId: 'wat' })).rejects.toThrow(/columnId is invalid/i);
  });

  test('patches collapsed columns and live tags', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-project-board-'));
    const storePath = path.join(tmp, 'project-board.json');
    const svc = new ProjectBoardService({ storePath });

    const first = await svc.patchBoard({ collapsedColumnIds: ['active', 'done'] });
    expect(first.collapsedColumnIds).toEqual(['active', 'done']);

    const tagged = await svc.patchBoard({ projectKey: 'games/hytopia/zoo-game', live: true });
    expect(tagged.tagsByProjectKey['games/hytopia/zoo-game']).toEqual({ live: true });

    const untagged = await svc.patchBoard({ projectKey: 'games/hytopia/zoo-game', live: false });
    expect(untagged.tagsByProjectKey['games/hytopia/zoo-game']).toBeUndefined();
  });
});
