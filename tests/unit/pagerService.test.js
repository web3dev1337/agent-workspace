const { PagerService } = require('../../server/pagerService');

describe('PagerService', () => {
  const buildSessionManager = () => {
    const sessionA = {
      id: 'work1-claude',
      type: 'claude',
      workspace: 'ws-1',
      pty: { write: jest.fn() },
      status: 'idle',
      buffer: ''
    };
    const sessionB = {
      id: 'work2-claude',
      type: 'claude',
      workspace: 'ws-1',
      pty: { write: jest.fn() },
      status: 'idle',
      buffer: ''
    };
    const writes = [];
    const sessionManager = {
      sessions: new Map([
        ['work1-claude', sessionA],
        ['work2-claude', sessionB]
      ]),
      workspaceSessionMaps: new Map([
        ['ws-1', new Map([
          ['work1-claude', sessionA],
          ['work2-claude', sessionB]
        ])]
      ]),
      getSessionById: jest.fn((id) => ({
        'work1-claude': sessionA,
        'work2-claude': sessionB
      }[id] || null)),
      writeToSession: jest.fn((id, data) => {
        writes.push({ id, data });
        return id === 'work1-claude' || id === 'work2-claude';
      })
    };
    const taskRecordService = {
      get: jest.fn((id) => ({
        'session:work1-claude': { tier: 3 },
        'session:work2-claude': { tier: 1 }
      }[id] || null))
    };
    const userSettingsService = {
      getAllSettings: jest.fn(() => ({
        global: {
          pager: {
            customInstruction: 'global-instruction',
            customInstructionMode: 'append',
            doneCheck: {
              enabled: false,
              token: 'PAGER_DONE',
              prompt: 'If complete, reply PAGER_DONE'
            }
          }
        }
      }))
    };
    return { sessionManager, taskRecordService, userSettingsService, sessionA, sessionB, writes };
  };

  test('starts a pager job and sends two-step input', async () => {
    const { sessionManager, taskRecordService, userSettingsService, writes } = buildSessionManager();
    const service = new PagerService({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } });
    service.init({ sessionManager, taskRecordService, userSettingsService });

    const job = await service.startJob({
      sessionId: 'work1-claude',
      intervalSeconds: 300,
      enterDelayMs: 1,
      maxPings: 1,
      maxRuntimeMinutes: 120,
      nudgeText: 'next',
      customInstruction: 'job-instruction'
    });

    expect(job.id).toBeTruthy();
    expect(writes.length).toBe(2);
    expect(writes[0]).toEqual({ id: 'work1-claude', data: 'next global-instruction job-instruction' });
    expect(writes[1]).toEqual({ id: 'work1-claude', data: '\r' });

    const status = service.getStatus();
    expect(status.count).toBe(1);
    expect(status.jobs[0].stopReason).toBe('max-pings-reached');
  });

  test('stops when done token is detected', async () => {
    const { sessionManager, taskRecordService, userSettingsService, sessionA } = buildSessionManager();
    const service = new PagerService({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } });
    service.init({ sessionManager, taskRecordService, userSettingsService });

    const job = await service.startJob({
      sessionId: 'work1-claude',
      enterDelayMs: 1,
      maxPings: 50,
      doneCheckEnabled: true,
      doneToken: 'PAGER_DONE'
    });

    const activeJob = service.jobs.get(job.id);
    expect(activeJob.status).toBe('running');

    sessionA.buffer += '\nall done PAGER_DONE\n';
    await service.tickJob(job.id);

    const finalJob = service.jobs.get(job.id);
    expect(finalJob.status).toBe('stopped');
    expect(finalJob.stopReason).toBe('done-token-detected');
  });

  test('stops manually by id', async () => {
    const { sessionManager, taskRecordService, userSettingsService } = buildSessionManager();
    const service = new PagerService({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } });
    service.init({ sessionManager, taskRecordService, userSettingsService });

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

  test('supports workspace + tier filtering for targets', async () => {
    const { sessionManager, taskRecordService, userSettingsService, writes } = buildSessionManager();
    const service = new PagerService({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } });
    service.init({ sessionManager, taskRecordService, userSettingsService });

    const job = await service.startJob({
      workspaceId: 'ws-1',
      tiers: [3],
      enterDelayMs: 1,
      maxPings: 1
    });

    expect(job.sessionIds).toEqual(['work1-claude']);
    expect(job.filteredSessionIds).toContain('work2-claude');
    expect(writes.every((row) => row.id === 'work1-claude')).toBe(true);
  });
});
