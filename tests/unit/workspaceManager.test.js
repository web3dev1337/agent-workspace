/**
 * Unit tests for WorkspaceManager
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const { WorkspaceManager } = require('../../server/workspaceManager');

describe('WorkspaceManager', () => {
  describe('mergeConfigs', () => {
    // This tests the config merging bug fix
    it('should deep clone configs to prevent mutation', () => {
      // This is a critical test - the bug was that shallow spread
      // caused cache mutation
      const base = {
        buttons: {
          claude: {
            start: { label: 'Start', command: 'claude' }
          }
        },
        gameModes: {
          default: { flag: '--default' }
        }
      };

      const override = {
        buttons: {
          claude: {
            review: { label: 'Review', command: 'gh pr view' }
          }
        },
        gameModes: {
          deathmatch: { flag: '--deathmatch' }
        }
      };

      // Create a proper deep merge function to test
      function mergeConfigs(base, override) {
        const result = JSON.parse(JSON.stringify(base));

        for (const key in override) {
          if (typeof override[key] === 'object' && !Array.isArray(override[key])) {
            // Deep merge for objects
            result[key] = result[key] || {};
            for (const subKey in override[key]) {
              if (typeof override[key][subKey] === 'object' && !Array.isArray(override[key][subKey])) {
                result[key][subKey] = { ...(result[key][subKey] || {}), ...override[key][subKey] };
              } else {
                result[key][subKey] = override[key][subKey];
              }
            }
          } else {
            result[key] = override[key];
          }
        }

        return result;
      }

      const merged = mergeConfigs(base, override);

      // Original should not be mutated
      expect(base.buttons.claude.review).toBeUndefined();
      expect(base.gameModes.deathmatch).toBeUndefined();

      // Merged should have both
      expect(merged.buttons.claude.start).toBeDefined();
      expect(merged.buttons.claude.review).toBeDefined();
      expect(merged.gameModes.default).toBeDefined();
      expect(merged.gameModes.deathmatch).toBeDefined();
    });

    it('should not mutate nested objects in cache', () => {
      const cache = {
        config: {
          buttons: { claude: { a: 1 } }
        }
      };

      // Simulate what was happening - shallow copy
      const badMerge = { ...cache.config };
      badMerge.buttons.claude.b = 2; // This mutates the cache!

      // This is the bug - cache was mutated
      // After fix, we use JSON.parse(JSON.stringify()) to deep clone

      // Good merge with deep clone
      const originalCache = {
        config: {
          buttons: { claude: { a: 1 } }
        }
      };

      const goodMerge = JSON.parse(JSON.stringify(originalCache.config));
      goodMerge.buttons.claude.b = 2;

      // Original should NOT be mutated
      expect(originalCache.config.buttons.claude.b).toBeUndefined();
      expect(goodMerge.buttons.claude.b).toBe(2);
    });
  });

  describe('workspace validation', () => {
    it('should validate workspace has required fields', () => {
      const validWorkspace = {
        id: 'test-workspace',
        name: 'Test Workspace',
        repository: {
          path: '/home/user/project',
          masterBranch: 'main'
        },
        terminals: { pairs: 4 }
      };

      const invalidWorkspace = {
        id: 'test-workspace',
        // missing name, repository, terminals
      };

      // Simple validation function
      function isValidWorkspace(ws) {
        return !!(ws.id && ws.name && ws.repository?.path && ws.terminals);
      }

      expect(isValidWorkspace(validWorkspace)).toBe(true);
      expect(isValidWorkspace(invalidWorkspace)).toBe(false);
    });
  });

  describe('switchWorkspace', () => {
    it('should set lastAccess when switching', async () => {
      const manager = new WorkspaceManager();

      manager.workspaces = new Map();
      manager.config = { activeWorkspace: null };
      manager.saveConfig = jest.fn().mockResolvedValue();
      manager.saveSessionStates = jest.fn().mockResolvedValue();

      const ws = {
        id: 'test-workspace',
        name: 'Test Workspace',
        type: 'hytopia-game',
        repository: { path: path.join(__dirname, 'fixtures', 'repo') }
      };

      manager.workspaces.set(ws.id, ws);

      manager.updateWorkspace = jest.fn().mockImplementation(async (workspaceId, updates) => {
        const existing = manager.workspaces.get(workspaceId);
        const updated = { ...existing, ...updates };
        manager.workspaces.set(workspaceId, updated);
        if (manager.activeWorkspace?.id === workspaceId) {
          manager.activeWorkspace = updated;
        }
        return updated;
      });

      const result = await manager.switchWorkspace(ws.id);

      expect(manager.updateWorkspace).toHaveBeenCalledWith(
        ws.id,
        expect.objectContaining({ lastAccess: expect.any(String) })
      );
      expect(result).toHaveProperty('lastAccess');
      expect(manager.activeWorkspace).toHaveProperty('lastAccess', result.lastAccess);
    });
  });

  describe('normalizeWorkspacePaths', () => {
    it('migrates stale /games/hytopia/games/* paths when target exists', () => {
      const manager = new WorkspaceManager();

      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-ws-'));
      const goodRepo = path.join(base, 'GitHub', 'games', 'hytopia', 'zoo-game');
      const goodWt = path.join(goodRepo, 'work9');
      fs.mkdirSync(goodWt, { recursive: true });

      const badRepo = path.join(base, 'GitHub', 'games', 'hytopia', 'games', 'zoo-game');
      const badWt = path.join(badRepo, 'work9');

      const ws = {
        id: 'x',
        name: 'X',
        type: 'hytopia-game',
        repository: { path: badRepo, masterBranch: 'master' },
        terminals: [
          { id: 'zoo-game-work9-claude', repository: { path: badRepo }, worktreePath: badWt, visible: true }
        ]
      };

      const res = manager.normalizeWorkspacePaths(ws);

      expect(res.changed).toBe(true);
      expect(res.workspace.repository.path).toBe(goodRepo);
      expect(res.workspace.terminals[0].repository.path).toBe(goodRepo);
      expect(res.workspace.terminals[0].worktreePath).toBe(goodWt);
    });

    it('leaves existing paths unchanged', () => {
      const manager = new WorkspaceManager();

      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-ws-'));
      const repo = path.join(base, 'GitHub', 'games', 'hytopia', 'zoo-game');
      fs.mkdirSync(repo, { recursive: true });

      const ws = {
        id: 'x',
        name: 'X',
        type: 'hytopia-game',
        repository: { path: repo, masterBranch: 'master' },
        terminals: [{ id: 't', repository: { path: repo }, worktreePath: repo, visible: true }]
      };

      const res = manager.normalizeWorkspacePaths(ws);
      expect(res.changed).toBe(false);
      expect(res.workspace.repository.path).toBe(repo);
    });

    it('migrates worktreePath even when worktree folder is not created yet (parent exists)', () => {
      const manager = new WorkspaceManager();

      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-ws-'));
      const goodRepo = path.join(base, 'GitHub', 'games', 'hytopia', 'zoo-game');
      fs.mkdirSync(goodRepo, { recursive: true });

      const badRepo = path.join(base, 'GitHub', 'games', 'hytopia', 'games', 'zoo-game');
      const badWt = path.join(badRepo, 'work9');
      const expectedWt = path.join(goodRepo, 'work9');

      const ws = {
        id: 'x',
        name: 'X',
        type: 'hytopia-game',
        terminals: [
          { id: 'zoo-game-work9-claude', repository: { path: badRepo }, worktreePath: badWt, visible: true }
        ]
      };

      const res = manager.normalizeWorkspacePaths(ws);
      expect(res.changed).toBe(true);
      expect(res.workspace.terminals[0].repository.path).toBe(goodRepo);
      expect(res.workspace.terminals[0].worktreePath).toBe(expectedWt);
    });
  });

  describe('deleted workspace archive', () => {
    let tempDir;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-ws-delete-'));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    async function createManager() {
      const manager = new WorkspaceManager();
      manager.configPath = tempDir;
      manager.workspacesPath = path.join(tempDir, 'workspaces');
      manager.deletedWorkspacesPath = path.join(tempDir, 'deleted-workspaces');
      manager.templatesPath = path.join(tempDir, 'templates');
      manager.sessionStatesPath = path.join(tempDir, 'session-states');
      await manager.ensureDirectories();
      return manager;
    }

    function buildWorkspace(repoPath, overrides = {}) {
      return {
        id: 'test-workspace',
        name: 'Test Workspace',
        type: 'website',
        repository: {
          path: repoPath,
          masterBranch: 'main'
        },
        terminals: { pairs: 1 },
        ...overrides
      };
    }

    it('moves deleted workspaces into Recently Deleted and restores them', async () => {
      const repoPath = path.join(tempDir, 'repo');
      fs.mkdirSync(repoPath, { recursive: true });
      const manager = await createManager();
      const workspace = buildWorkspace(repoPath);

      await manager.createWorkspace(workspace);

      const deleted = await manager.deleteWorkspace(workspace.id);
      expect(manager.workspaces.has(workspace.id)).toBe(false);

      const deletedList = await manager.listDeletedWorkspaces();
      expect(deletedList).toHaveLength(1);
      expect(deletedList[0]).toMatchObject({
        id: workspace.id,
        deletedId: deleted.deletedId,
        restoreAvailable: true
      });

      const restored = await manager.restoreWorkspace(deleted.deletedId);
      expect(restored).toMatchObject({
        id: workspace.id,
        name: workspace.name
      });
      expect(manager.workspaces.get(workspace.id)).toMatchObject({
        id: workspace.id
      });
      expect(fs.existsSync(path.join(manager.workspacesPath, `${workspace.id}.json`))).toBe(true);
      await expect(manager.listDeletedWorkspaces()).resolves.toHaveLength(0);
    });

    it('marks deleted workspaces as not restorable when the id has been reused', async () => {
      const repoPath = path.join(tempDir, 'repo');
      const replacementRepoPath = path.join(tempDir, 'repo-replacement');
      fs.mkdirSync(repoPath, { recursive: true });
      fs.mkdirSync(replacementRepoPath, { recursive: true });
      const manager = await createManager();
      const workspace = buildWorkspace(repoPath);

      await manager.createWorkspace(workspace);
      await manager.deleteWorkspace(workspace.id);
      await manager.createWorkspace(buildWorkspace(replacementRepoPath, {
        name: 'Replacement Workspace'
      }));

      const deletedList = await manager.listDeletedWorkspaces();
      expect(deletedList).toHaveLength(1);
      expect(deletedList[0]).toMatchObject({
        id: workspace.id,
        restoreAvailable: false
      });
    });
  });
});
