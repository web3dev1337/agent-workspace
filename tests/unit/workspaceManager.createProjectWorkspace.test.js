const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../scripts/create-project', () => ({
  createProject: jest.fn()
}));

const { createProject } = require('../../scripts/create-project');
const { WorkspaceManager } = require('../../server/workspaceManager');

describe('WorkspaceManager.createProjectWorkspace', () => {
  let tmpDir;
  let manager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-workspace-create-project-'));
    manager = new WorkspaceManager();
    manager.workspacesPath = tmpDir;
    manager.workspaces = new Map();
    createProject.mockReset();
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test('creates workspace from generated project payload', async () => {
    createProject.mockResolvedValue({
      success: true,
      name: 'demo-tool',
      projectPath: '/tmp/demo-tool',
      repositoryType: 'tool-project',
      remoteUrl: 'https://github.com/acme/demo-tool.git',
      worktrees: [
        { id: 'master', path: '/tmp/demo-tool/master' },
        { id: 'work1', path: '/tmp/demo-tool/work1' },
        { id: 'work2', path: '/tmp/demo-tool/work2' }
      ]
    });

    const result = await manager.createProjectWorkspace({
      name: 'Demo Tool',
      description: 'CLI helper',
      worktreeCount: 2,
      createGithub: true
    });

    expect(createProject).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Demo Tool',
      description: 'CLI helper',
      worktreeCount: 2,
      createGithub: true,
      push: true,
      initGit: true
    }));

    expect(result.success).toBe(true);
    expect(result.workspace.id).toBe('demo-tool');
    expect(result.workspace.type).toBe('tool-project');
    expect(result.workspace.repository.path).toBe('/tmp/demo-tool');
    expect(result.workspace.repository.remote).toBe('https://github.com/acme/demo-tool.git');
    expect(result.workspace.terminals.pairs).toBe(2);
    expect(fs.existsSync(path.join(tmpDir, 'demo-tool.json'))).toBe(true);
  });

  test('maps unknown/generic repository types to tool-project workspace type', async () => {
    createProject.mockResolvedValue({
      success: true,
      name: 'misc-project',
      projectPath: '/tmp/misc-project',
      repositoryType: 'generic',
      remoteUrl: null,
      worktrees: [
        { id: 'master', path: '/tmp/misc-project/master' },
        { id: 'work1', path: '/tmp/misc-project/work1' }
      ]
    });

    const result = await manager.createProjectWorkspace({ name: 'Misc Project' });
    expect(result.workspace.type).toBe('tool-project');
  });

  test('throws if derived workspace id already exists', async () => {
    manager.workspaces.set('demo-tool', {
      id: 'demo-tool',
      name: 'Existing Demo Tool',
      type: 'tool-project',
      repository: { path: '/tmp/existing' },
      terminals: { pairs: 1 }
    });

    createProject.mockResolvedValue({
      success: true,
      name: 'demo-tool',
      projectPath: '/tmp/demo-tool-2',
      repositoryType: 'tool-project',
      remoteUrl: null,
      worktrees: [{ id: 'master', path: '/tmp/demo-tool-2/master' }, { id: 'work1', path: '/tmp/demo-tool-2/work1' }]
    });

    await expect(manager.createProjectWorkspace({ name: 'Demo Tool' })).rejects.toThrow('Workspace ID already exists');
  });
});
