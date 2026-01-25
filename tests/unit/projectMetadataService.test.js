const fs = require('fs');
const os = require('os');
const path = require('path');

const { ProjectMetadataService, deriveProjectRootFromWorktreePath } = require('../../server/projectMetadataService');

const writeJson = (filePath, obj) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
};

describe('ProjectMetadataService', () => {
  test('deriveProjectRootFromWorktreePath strips workN suffix', () => {
    const root = deriveProjectRootFromWorktreePath('/tmp/some/project/work7');
    expect(root).toBe(path.resolve('/tmp/some/project'));
  });

  test('cascades .orchestrator-config.json and registry overrides', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-project-meta-'));
    const basePath = path.join(tmp, 'GitHub');
    const registryPath = path.join(tmp, '.orchestrator', 'project-metadata.json');

    // Create hierarchy: GitHub/games/hytopia/zoo-game/work1
    const worktreePath = path.join(basePath, 'games', 'hytopia', 'zoo-game', 'work1');
    fs.mkdirSync(worktreePath, { recursive: true });

    // Parent config sets low risk; project config sets medium risk
    writeJson(path.join(basePath, 'games', 'hytopia', '.orchestrator-config.json'), { project: { baseImpactRisk: 'low' } });
    writeJson(path.join(basePath, 'games', 'hytopia', 'zoo-game', '.orchestrator-config.json'), { project: { baseImpactRisk: 'medium' } });

    // Registry overrides to critical
    writeJson(registryPath, {
      version: 1,
      defaults: { baseImpactRisk: 'low' },
      projects: {
        'games/hytopia/zoo-game': { baseImpactRisk: 'critical', displayName: 'Zoo Game' }
      }
    });

    const svc = new ProjectMetadataService({ basePath, registryPath });
    const meta = await svc.getForWorktree(worktreePath, { refresh: true });

    expect(meta.projectKey).toBe('games/hytopia/zoo-game');
    expect(meta.baseImpactRisk).toBe('critical');
    expect(meta.displayName).toBe('Zoo Game');
    expect(meta.sources.registryPath).toBe(registryPath);
  });
});

