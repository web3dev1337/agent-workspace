const fs = require('fs').promises;
const os = require('os');
const path = require('path');

const {
  getDiscordStatus,
  ensureDiscordServices,
  processDiscordQueue
} = require('../../server/discordIntegrationService');

async function makeTempDir(prefix) {
  const base = path.join(os.tmpdir(), prefix);
  return await fs.mkdtemp(base);
}

describe('discordIntegrationService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('getDiscordStatus counts pending tasks', async () => {
    const dir = await makeTempDir('orchestrator-discord-queue-');
    process.env.DISCORD_QUEUE_DIR = dir;

    const pendingPath = path.join(dir, 'pending-tasks.json');
    await fs.writeFile(pendingPath, JSON.stringify([{ text: 'a' }, { text: 'b' }], null, 2));

    const sessionManager = { getSessionById: () => null };
    const workspaceManager = { getWorkspace: () => null };

    const status = await getDiscordStatus({ sessionManager, workspaceManager });
    expect(status.ok).toBe(true);
    expect(status.queue.pendingCount).toBe(2);
    expect(status.queue.pendingTasksPath).toBe(pendingPath);
    expect(status.queue.pendingUpdatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('ensureDiscordServices creates workspace and ensures sessions', async () => {
    const dir = await makeTempDir('orchestrator-discord-queue-');
    process.env.DISCORD_QUEUE_DIR = dir;
    process.env.DISCORD_SERVICES_WORKSPACE_ID = 'services-test';
    process.env.DISCORD_BOT_SESSION_ID = 'bot-test';
    process.env.DISCORD_PROCESSOR_SESSION_ID = 'processor-test';

    const created = { value: null };
    const workspaceManager = {
      getWorkspace: (id) => (created.value && created.value.id === id ? created.value : null),
      createWorkspace: async (cfg) => {
        created.value = cfg;
        return cfg;
      }
    };

    const sessionManager = {
      ensureWorkspaceSessions: jest.fn(async () => ({})),
      getSessionById: (id) => (id ? { id, pty: {}, status: 'idle' } : null),
      writeToSession: jest.fn(() => true)
    };

    const status = await ensureDiscordServices({ sessionManager, workspaceManager });
    expect(status.ok).toBe(true);
    expect(status.workspace.exists).toBe(true);
    expect(sessionManager.ensureWorkspaceSessions).toHaveBeenCalledTimes(1);
  });

  test('processDiscordQueue sends prompt to processor session', async () => {
    const dir = await makeTempDir('orchestrator-discord-queue-');
    process.env.DISCORD_QUEUE_DIR = dir;
    process.env.DISCORD_SERVICES_WORKSPACE_ID = 'services-test';
    process.env.DISCORD_BOT_SESSION_ID = 'bot-test';
    process.env.DISCORD_PROCESSOR_SESSION_ID = 'processor-test';

    await fs.writeFile(path.join(dir, 'pending-tasks.json'), JSON.stringify([], null, 2));

    const ws = { id: 'services-test' };
    const workspaceManager = {
      getWorkspace: () => ws,
      createWorkspace: async () => ws
    };

    const sessionManager = {
      ensureWorkspaceSessions: jest.fn(async () => ({})),
      getSessionById: (id) => (id === 'processor-test' ? { id, pty: {}, status: 'idle' } : { id, pty: {}, status: 'idle' }),
      writeToSession: jest.fn(() => true)
    };

    const result = await processDiscordQueue({ sessionManager, workspaceManager });
    expect(result.ok).toBe(true);
    expect(result.sent).toBe(true);
    expect(sessionManager.writeToSession).toHaveBeenCalledTimes(1);
  });
});

