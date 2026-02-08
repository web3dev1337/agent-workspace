const { ServiceStackRuntimeService } = require('../../server/serviceStackRuntimeService');

function createHarness({ services }) {
  const workspace = {
    id: 'ws-1',
    name: 'Workspace One',
    repository: { path: '/tmp/ws-1' },
    serviceStack: { services }
  };
  const sessions = new Map();
  const sessionManager = {
    createSession: jest.fn((sessionId, config) => {
      sessions.set(sessionId, { id: sessionId, status: 'idle', config });
    }),
    terminateSession: jest.fn((sessionId) => {
      sessions.delete(sessionId);
    }),
    getSessionById: jest.fn((sessionId) => sessions.get(sessionId) || null)
  };
  const workspaceManager = {
    getWorkspace: jest.fn((workspaceId) => (workspaceId === 'ws-1' ? workspace : null))
  };
  const io = { emit: jest.fn() };
  const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
  const service = new ServiceStackRuntimeService({
    workspaceManager,
    sessionManager,
    io,
    logger,
    monitorIntervalMs: 0
  });
  return { service, sessions, sessionManager, workspaceManager, io };
}

describe('ServiceStackRuntimeService', () => {
  test('starts and stops services from workspace manifest', async () => {
    const { service, sessions, sessionManager } = createHarness({
      services: [
        { id: 'api', name: 'API', command: 'npm run dev', restartPolicy: 'on-failure' },
        { id: 'worker', name: 'Worker', command: 'npm run worker', restartPolicy: 'always' }
      ]
    });

    const startResult = service.start('ws-1');
    expect(startResult.started).toBe(2);
    expect(sessionManager.createSession).toHaveBeenCalledTimes(2);
    expect(sessions.has('ws-1-svc-api')).toBe(true);
    expect(sessions.has('ws-1-svc-worker')).toBe(true);

    const runtimeRunning = await service.getRuntimeStatus('ws-1');
    expect(runtimeRunning.services).toHaveLength(2);
    expect(runtimeRunning.services.every((item) => item.running)).toBe(true);
    expect(runtimeRunning.services.every((item) => item.health.status === 'unknown')).toBe(true);

    const stopResult = service.stop('ws-1');
    expect(stopResult.stopped).toBe(2);
    expect(sessionManager.terminateSession).toHaveBeenCalledTimes(2);
    const runtimeStopped = await service.getRuntimeStatus('ws-1');
    expect(runtimeStopped.services.every((item) => item.running === false)).toBe(true);
  });

  test('tick auto-restarts desired services for always policy', async () => {
    const { service, sessions, sessionManager } = createHarness({
      services: [
        { id: 'api', name: 'API', command: 'npm run dev', restartPolicy: 'always' }
      ]
    });

    service.start('ws-1');
    expect(sessions.has('ws-1-svc-api')).toBe(true);
    sessions.delete('ws-1-svc-api');

    await service.tick();
    expect(sessionManager.createSession).toHaveBeenCalledTimes(2);
    expect(sessions.has('ws-1-svc-api')).toBe(true);
  });

  test('tick disables desired for never restart policy after exit', async () => {
    const { service, sessions } = createHarness({
      services: [
        { id: 'batch', name: 'Batch', command: 'node batch.js', restartPolicy: 'never' }
      ]
    });

    service.start('ws-1');
    sessions.delete('ws-1-svc-batch');
    await service.tick();

    const runtime = await service.getRuntimeStatus('ws-1');
    expect(runtime.services).toHaveLength(1);
    expect(runtime.services[0].desired).toBe(false);
    expect(runtime.services[0].lastStopReason).toBe('service_exited');
  });
});
