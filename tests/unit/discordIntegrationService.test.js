const crypto = require('crypto');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');

const {
  buildServicesWorkspaceConfig,
  getDiscordStatus,
  ensureDiscordServices,
  processDiscordQueue
} = require('../../server/discordIntegrationService');

async function makeTempDir(prefix) {
  const base = path.join(os.tmpdir(), prefix);
  return await fs.mkdtemp(base);
}

function stableStringify(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
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

    await fs.writeFile(path.join(dir, 'pending-tasks.json'), JSON.stringify([{ id: 'task-1' }], null, 2));

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

  test('buildServicesWorkspaceConfig supports safe default and dangerous override commands', () => {
    const safeConfig = buildServicesWorkspaceConfig({
      servicesWorkspaceId: 'services',
      botRepoPath: '/tmp/bot',
      botSessionId: 'bot',
      processorSessionId: 'processor',
      dangerousModeEnabled: false
    });
    const safeProcessor = safeConfig.terminals.find((terminal) => terminal.id === 'processor');
    expect(safeProcessor.startCommand).toBe('claude --continue');

    const dangerousConfig = buildServicesWorkspaceConfig({
      servicesWorkspaceId: 'services',
      botRepoPath: '/tmp/bot',
      botSessionId: 'bot',
      processorSessionId: 'processor',
      dangerousModeEnabled: true
    });
    const dangerousProcessor = dangerousConfig.terminals.find((terminal) => terminal.id === 'processor');
    expect(dangerousProcessor.startCommand).toBe('claude --continue --dangerously-skip-permissions');
  });

  test('processDiscordQueue verifies signed queue payloads when signing secret is configured', async () => {
    const dir = await makeTempDir('orchestrator-discord-queue-');
    process.env.DISCORD_QUEUE_DIR = dir;
    process.env.DISCORD_SERVICES_WORKSPACE_ID = 'services-test';
    process.env.DISCORD_BOT_SESSION_ID = 'bot-test';
    process.env.DISCORD_PROCESSOR_SESSION_ID = 'processor-test';
    process.env.DISCORD_QUEUE_SIGNING_SECRET = 'unit-test-signing-secret';
    process.env.DISCORD_REQUIRE_SIGNED_QUEUE = 'true';

    const timestamp = '2026-02-10T00:00:00.000Z';
    const nonce = 'nonce-1';
    const tasks = [{ id: 'task-1', idempotencyKey: 'task-1', text: 'hello' }];
    const meta = { producer: 'unit-test' };
    const signingInput = `${timestamp}\n${nonce}\n${stableStringify({ tasks, meta })}`;
    const signature = crypto
      .createHmac('sha256', process.env.DISCORD_QUEUE_SIGNING_SECRET)
      .update(signingInput, 'utf8')
      .digest('hex');

    await fs.writeFile(
      path.join(dir, 'pending-tasks.json'),
      JSON.stringify({
        tasks,
        meta,
        signature: {
          algorithm: 'hmac-sha256',
          keyId: 'default',
          timestamp,
          nonce,
          signature
        }
      }, null, 2)
    );

    const ws = { id: 'services-test' };
    const workspaceManager = {
      getWorkspace: () => ws,
      createWorkspace: async () => ws
    };
    const sessionManager = {
      ensureWorkspaceSessions: jest.fn(async () => ({})),
      getSessionById: () => ({ pty: {}, status: 'idle' }),
      writeToSession: jest.fn(() => true)
    };

    const result = await processDiscordQueue({
      sessionManager,
      workspaceManager,
      idempotencyKey: 'run-1'
    });
    expect(result.ok).toBe(true);
    expect(result.signature.verified).toBe(true);
    expect(sessionManager.writeToSession).toHaveBeenCalledTimes(1);
  });

  test('processDiscordQueue rejects unsigned queue when signed queue is required', async () => {
    const dir = await makeTempDir('orchestrator-discord-queue-');
    process.env.DISCORD_QUEUE_DIR = dir;
    process.env.DISCORD_SERVICES_WORKSPACE_ID = 'services-test';
    process.env.DISCORD_BOT_SESSION_ID = 'bot-test';
    process.env.DISCORD_PROCESSOR_SESSION_ID = 'processor-test';
    process.env.DISCORD_QUEUE_SIGNING_SECRET = 'unit-test-signing-secret';
    process.env.DISCORD_REQUIRE_SIGNED_QUEUE = 'true';

    await fs.writeFile(path.join(dir, 'pending-tasks.json'), JSON.stringify([{ id: 'task-1' }], null, 2));

    const ws = { id: 'services-test' };
    const workspaceManager = {
      getWorkspace: () => ws,
      createWorkspace: async () => ws
    };
    const sessionManager = {
      ensureWorkspaceSessions: jest.fn(async () => ({})),
      getSessionById: () => ({ pty: {}, status: 'idle' }),
      writeToSession: jest.fn(() => true)
    };

    await expect(processDiscordQueue({
      sessionManager,
      workspaceManager,
      idempotencyKey: 'run-unsigned'
    })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('processDiscordQueue replays idempotent responses without dispatching prompt twice', async () => {
    const dir = await makeTempDir('orchestrator-discord-queue-');
    process.env.DISCORD_QUEUE_DIR = dir;
    process.env.DISCORD_SERVICES_WORKSPACE_ID = 'services-test';
    process.env.DISCORD_BOT_SESSION_ID = 'bot-test';
    process.env.DISCORD_PROCESSOR_SESSION_ID = 'processor-test';

    await fs.writeFile(path.join(dir, 'pending-tasks.json'), JSON.stringify([{ id: 'task-1' }], null, 2));

    const ws = { id: 'services-test' };
    const workspaceManager = {
      getWorkspace: () => ws,
      createWorkspace: async () => ws
    };
    const sessionManager = {
      ensureWorkspaceSessions: jest.fn(async () => ({})),
      getSessionById: () => ({ pty: {}, status: 'idle' }),
      writeToSession: jest.fn(() => true)
    };

    const first = await processDiscordQueue({
      sessionManager,
      workspaceManager,
      idempotencyKey: 'repeat-me'
    });
    const second = await processDiscordQueue({
      sessionManager,
      workspaceManager,
      idempotencyKey: 'repeat-me'
    });

    expect(first.ok).toBe(true);
    expect(second.idempotentReplay).toBe(true);
    expect(sessionManager.writeToSession).toHaveBeenCalledTimes(1);
  });

  test('processDiscordQueue returns no-op when there are no pending tasks', async () => {
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
      getSessionById: () => ({ pty: {}, status: 'idle' }),
      writeToSession: jest.fn(() => true)
    };

    const result = await processDiscordQueue({
      sessionManager,
      workspaceManager,
      idempotencyKey: 'noop-run'
    });

    expect(result.ok).toBe(true);
    expect(result.sent).toBe(false);
    expect(result.reason).toBe('NO_PENDING_TASKS');
    expect(sessionManager.writeToSession).not.toHaveBeenCalled();
  });

  test('processDiscordQueue rejects invalid queue JSON payload', async () => {
    const dir = await makeTempDir('orchestrator-discord-queue-');
    process.env.DISCORD_QUEUE_DIR = dir;
    process.env.DISCORD_SERVICES_WORKSPACE_ID = 'services-test';
    process.env.DISCORD_BOT_SESSION_ID = 'bot-test';
    process.env.DISCORD_PROCESSOR_SESSION_ID = 'processor-test';

    await fs.writeFile(path.join(dir, 'pending-tasks.json'), '{ invalid-json', 'utf8');

    const ws = { id: 'services-test' };
    const workspaceManager = {
      getWorkspace: () => ws,
      createWorkspace: async () => ws
    };
    const sessionManager = {
      ensureWorkspaceSessions: jest.fn(async () => ({})),
      getSessionById: () => ({ pty: {}, status: 'idle' }),
      writeToSession: jest.fn(() => true)
    };

    await expect(processDiscordQueue({
      sessionManager,
      workspaceManager,
      idempotencyKey: 'invalid-json'
    })).rejects.toMatchObject({ statusCode: 422 });
  });

  test('dangerousModeOverride=true is blocked unless explicitly allowed', async () => {
    const dir = await makeTempDir('orchestrator-discord-queue-');
    process.env.DISCORD_QUEUE_DIR = dir;
    process.env.DISCORD_SERVICES_WORKSPACE_ID = 'services-test';
    process.env.DISCORD_BOT_SESSION_ID = 'bot-test';
    process.env.DISCORD_PROCESSOR_SESSION_ID = 'processor-test';
    process.env.DISCORD_ALLOW_DANGEROUS_OVERRIDE = 'false';

    await fs.writeFile(path.join(dir, 'pending-tasks.json'), JSON.stringify([{ id: 'task-1' }], null, 2));

    const ws = { id: 'services-test' };
    const workspaceManager = {
      getWorkspace: () => ws,
      createWorkspace: async () => ws
    };
    const sessionManager = {
      ensureWorkspaceSessions: jest.fn(async () => ({})),
      getSessionById: () => ({ pty: {}, status: 'idle' }),
      writeToSession: jest.fn(() => true)
    };

    await expect(processDiscordQueue({
      sessionManager,
      workspaceManager,
      dangerousModeOverride: true,
      idempotencyKey: 'danger-override-disallowed'
    })).rejects.toMatchObject({ statusCode: 403 });
  });
});
