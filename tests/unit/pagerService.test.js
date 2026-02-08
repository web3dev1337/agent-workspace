const { PagerService } = require('../../server/pagerService');

describe('PagerService', () => {
  const buildSessionManager = () => {
    const session = {
      id: 'work1-claude',
      type: 'claude',
      workspace: 'ws-1',
      pty: { write: jest.fn() },
      status: 'idle',
      buffer: ''
    };
    const writes = [];
    const sessionManager = {
      sessions: new Map([['work1-claude', session]]),
      workspaceSessionMaps: new Map([
        ['ws-1', new Map([['work1-claude', session]])]
      ]),
      getSessionById: jest.fn((id) => (id === 'work1-claude' ? session : null)),
      writeToSession: jest.fn((id, data) => {
        writes.push({ id, data });
        return id === 'work1-claude';
      })
    };
    return { sessionManager, session, writes };
  };

  test('starts a pager job and sends two-step input', async () => {
    const { sessionManager, writes } = buildSessionManager();
    const service = new PagerService({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } });
    service.init({ sessionManager });

    const job = await service.startJob({
      sessionId: 'work1-claude',
      intervalSeconds: 300,
      enterDelayMs: 1,
      maxPings: 1,
      maxRuntimeMinutes: 120,
      nudgeText: 'next'
    });

    expect(job.id).toBeTruthy();
    expect(writes.length).toBe(2);
    expect(writes[0]).toEqual({ id: 'work1-claude', data: 'next' });
    expect(writes[1]).toEqual({ id: 'work1-claude', data: '\r' });

    const status = service.getStatus();
    expect(status.count).toBe(1);
    expect(status.jobs[0].stopReason).toBe('max-pings-reached');
  });

  test('stops when done token is detected', async () => {
    const { sessionManager, session } = buildSessionManager();
    const service = new PagerService({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } });
    service.init({ sessionManager });

    const job = await service.startJob({
      sessionId: 'work1-claude',
      enterDelayMs: 1,
      maxPings: 50,
      doneCheckEnabled: true,
      doneToken: 'PAGER_DONE'
    });

    const activeJob = service.jobs.get(job.id);
    expect(activeJob.status).toBe('running');

    session.buffer += '\nall done PAGER_DONE\n';
    await service.tickJob(job.id);

    const finalJob = service.jobs.get(job.id);
    expect(finalJob.status).toBe('stopped');
    expect(finalJob.stopReason).toBe('done-token-detected');
  });

  test('stops manually by id', async () => {
    const { sessionManager } = buildSessionManager();
    const service = new PagerService({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } });
    service.init({ sessionManager });

    const job = await service.startJob({
      sessionId: 'work1-claude',
      intervalSeconds: 3600,
      enterDelayMs: 1,
      maxPings: 10
    });

    const result = service.stopJob(job.id, { reason: 'manual-test' });
    expect(result.ok).toBe(true);
    expect(result.job.stopReason).toBe('manual-test');
  });
});
