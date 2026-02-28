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
      version: 1,
      updatedAt: null,
      projectToColumn: {}
    });
  });

  test('moves project and persists mapping', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-project-board-'));
    const storePath = path.join(tmp, 'project-board.json');
    const svc = new ProjectBoardService({ storePath });

    const saved = await svc.moveProject({ projectKey: 'tools/automation/claude-orchestrator', columnId: 'active' });
    expect(saved.projectToColumn['tools/automation/claude-orchestrator']).toBe('active');
    expect(typeof saved.updatedAt).toBe('string');

    const reloaded = await svc.load({ refresh: true });
    expect(reloaded.projectToColumn['tools/automation/claude-orchestrator']).toBe('active');
  });

  test('backlog clears mapping entry', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-project-board-'));
    const storePath = path.join(tmp, 'project-board.json');
    const svc = new ProjectBoardService({ storePath });

    await svc.moveProject({ projectKey: 'games/hytopia/zoo-game', columnId: 'next' });
    const cleared = await svc.moveProject({ projectKey: 'games/hytopia/zoo-game', columnId: 'backlog' });
    expect(cleared.projectToColumn['games/hytopia/zoo-game']).toBeUndefined();
  });

  test('rejects invalid columns', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-project-board-'));
    const storePath = path.join(tmp, 'project-board.json');
    const svc = new ProjectBoardService({ storePath });

    await expect(svc.moveProject({ projectKey: 'x', columnId: 'wat' })).rejects.toThrow(/columnId is invalid/i);
  });
});

