const fs = require('fs');
const os = require('os');
const path = require('path');
const { ConfigPromoterService } = require('../../server/configPromoterService');

function makeRepoRoot() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-promoter-'));
  fs.mkdirSync(path.join(repoRoot, '.git'), { recursive: true });
  return repoRoot;
}

describe('ConfigPromoterService', () => {
  test('promotes shared baseline and resolves local overrides', async () => {
    const repoRoot = makeRepoRoot();
    const service = new ConfigPromoterService({ logger: { warn: jest.fn() } });
    const workspace = {
      id: 'ws-one',
      name: 'Workspace One',
      repository: { path: repoRoot },
      serviceStack: {
        services: [
          { id: 'api', name: 'API', command: 'npm run dev', order: 1 }
        ]
      }
    };

    const promoted = await service.writeTeamManifest({
      workspace,
      visibility: 'shared',
      relPath: '.orchestrator/service-stack/team.json'
    });

    expect(fs.existsSync(promoted.location.fullPath)).toBe(true);

    workspace.serviceStackShared = promoted.pointer;
    workspace.serviceStackLocal = {
      services: [
        { id: 'api', name: 'API', command: 'npm run dev:local', order: 1 },
        { id: 'worker', name: 'Worker', command: 'npm run worker', order: 2 }
      ]
    };

    const resolved = service.resolveWorkspaceManifest(workspace);
    expect(resolved.services).toHaveLength(2);
    expect(resolved.services.find((item) => item.id === 'api')?.command).toBe('npm run dev:local');
    expect(resolved.services.find((item) => item.id === 'worker')?.command).toBe('npm run worker');
  });

  test('writes and reads encrypted team baseline', async () => {
    const repoRoot = makeRepoRoot();
    const service = new ConfigPromoterService({ logger: { warn: jest.fn() } });
    const workspace = {
      id: 'ws-two',
      name: 'Workspace Two',
      repository: { path: repoRoot },
      serviceStack: {
        services: [
          { id: 'api', name: 'API', command: 'npm run dev' }
        ]
      }
    };

    const promoted = await service.writeTeamManifest({
      workspace,
      visibility: 'encrypted',
      relPath: '.orchestrator/service-stack/team.enc.json',
      passphrase: 'test-passphrase'
    });

    const loaded = await service.readTeamManifest({
      workspace,
      pointer: promoted.pointer,
      passphrase: 'test-passphrase'
    });

    expect(loaded.manifest.services).toHaveLength(1);
    expect(loaded.manifest.services[0].id).toBe('api');

    workspace.serviceStackShared = promoted.pointer;
    workspace.serviceStackLocal = { services: [] };
    const resolved = service.resolveWorkspaceManifest(workspace, { passphrase: 'test-passphrase' });
    expect(resolved.services).toHaveLength(1);
    expect(resolved.services[0].id).toBe('api');
  });

  test('enforces signature verification when required', async () => {
    const repoRoot = makeRepoRoot();
    const service = new ConfigPromoterService({ logger: { warn: jest.fn() } });
    const workspace = {
      id: 'ws-three',
      name: 'Workspace Three',
      repository: { path: repoRoot },
      serviceStack: {
        services: [
          { id: 'api', name: 'API', command: 'npm run dev' }
        ]
      }
    };

    const promoted = await service.writeTeamManifest({
      workspace,
      visibility: 'shared',
      relPath: '.orchestrator/service-stack/team-signed.json',
      signed: true,
      signingSecret: 'correct-secret'
    });

    await expect(service.readTeamManifest({
      workspace,
      pointer: {
        ...promoted.pointer,
        signed: true,
        requireSignature: true
      },
      signingSecret: 'wrong-secret'
    })).rejects.toThrow('Manifest signature verification failed');
  });
});
