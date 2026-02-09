const fs = require('fs');
const os = require('os');
const path = require('path');
const { createProject, parseArgs, resolveRemoteSpec } = require('../../scripts/create-project');
const { ProjectTypeService } = require('../../server/projectTypeService');

describe('create-project script', () => {
  let tmpRoot;
  let prevGithubRoot;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-create-project-'));
    prevGithubRoot = process.env.GREENFIELD_GITHUB_ROOT;
    process.env.GREENFIELD_GITHUB_ROOT = tmpRoot;
    ProjectTypeService.instance = null;
  });

  afterEach(() => {
    if (prevGithubRoot === undefined) delete process.env.GREENFIELD_GITHUB_ROOT;
    else process.env.GREENFIELD_GITHUB_ROOT = prevGithubRoot;
    ProjectTypeService.instance = null;
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test('parseArgs supports boolean flags and key/value options', () => {
    const args = parseArgs(['--name', 'demo-tool', '--init-git', 'false', '--no-push', '--worktree-count', '2']);
    expect(args.name).toBe('demo-tool');
    expect(args['init-git']).toBe('false');
    expect(args.push).toBe(false);
    expect(args['worktree-count']).toBe('2');
  });

  test('resolveRemoteSpec supports URL and slug values', () => {
    expect(resolveRemoteSpec('https://github.com/a/b.git').remoteUrl).toBe('https://github.com/a/b.git');
    expect(resolveRemoteSpec('demo-repo', 'acme').slug).toBe('acme/demo-repo');
  });

  test('creates project scaffold and metadata without git', async () => {
    const result = await createProject({
      name: 'demo-tool',
      description: 'Tooling project',
      category: 'tool',
      template: 'node-typescript-tool',
      initGit: false,
      worktreeCount: 0,
      logger: { info: () => {}, warn: () => {}, error: () => {} }
    });

    expect(result.success).toBe(true);
    expect(fs.existsSync(result.projectPath)).toBe(true);
    expect(fs.existsSync(path.join(result.masterPath, 'package.json'))).toBe(true);
    expect(fs.existsSync(result.metadataPath)).toBe(true);

    const metadata = JSON.parse(fs.readFileSync(result.metadataPath, 'utf8'));
    expect(metadata.templateId).toBe('node-typescript-tool');
    expect(metadata.categoryId).toBe('tool');
  });
});
