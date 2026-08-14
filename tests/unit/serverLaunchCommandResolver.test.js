const { resolveServerLaunchCommand } = require('../../server/serverLaunchCommandResolver');

const makeWorkspaceManager = ({ type = 'hytopia-game', cascaded = null } = {}) => ({
  getActiveWorkspace: () => ({ id: 'ws1', type }),
  getWorkspaceById: () => ({
    terminals: {
      pairs: [
        { worktreeId: 'work2', repository: { name: 'zoo-game', type } }
      ]
    }
  }),
  getCascadedConfigForWorktree: async () => cascaded
});

describe('resolveServerLaunchCommand', () => {
  test('substitutes gameMode and commonFlags into the configured template', async () => {
    const workspaceManager = makeWorkspaceManager({
      cascaded: {
        serverCommand: 'hytopia start {{gameMode}} {{commonFlags}}',
        gameModes: { deathmatch: { flag: '--mode=deathmatch', label: 'Deathmatch' } },
        commonFlags: {
          unlockAll: { flag: '--unlock-all', label: 'Unlock All' },
          debug: { flag: '--debug', label: 'Debug' }
        }
      }
    });

    const result = await resolveServerLaunchCommand({
      workspaceManager,
      sessionId: 'zoo-game-work2-server',
      cwd: '/repo/work2',
      environment: 'deathmatch',
      launchSettings: { flags: { unlockAll: true, debug: false } }
    });

    expect(result.command).toBe('hytopia start --mode=deathmatch --unlock-all');
    expect(result.usedGameMode).toBe('deathmatch');
  });

  test('falls back to hytopia default for hytopia-game type without config', async () => {
    const workspaceManager = makeWorkspaceManager({ cascaded: null });
    const result = await resolveServerLaunchCommand({
      workspaceManager,
      sessionId: 'zoo-game-work2-server',
      environment: 'development'
    });
    expect(result.command).toBe('hytopia start');
  });

  test('falls back to npm run dev for unknown types and appends gameArgs', async () => {
    const workspaceManager = makeWorkspaceManager({ type: 'website', cascaded: {} });
    const result = await resolveServerLaunchCommand({
      workspaceManager,
      sessionId: 'my-site-work1-server',
      environment: 'development',
      launchSettings: { gameArgs: '--host 0.0.0.0' }
    });
    expect(result.command).toBe('npm run dev --host 0.0.0.0');
  });

  test('unknown environment keys leave the template placeholders empty', async () => {
    const workspaceManager = makeWorkspaceManager({
      cascaded: { serverCommand: 'hytopia start {{gameMode}}', gameModes: {} }
    });
    const result = await resolveServerLaunchCommand({
      workspaceManager,
      sessionId: 'zoo-game-work2-server',
      environment: 'production'
    });
    expect(result.command).toBe('hytopia start');
    expect(result.usedGameMode).toBeNull();
  });
});
