const { ProcessStatusService } = require('../../server/processStatusService');

describe('ProcessStatusService settings', () => {
  test('getStatus uses caps + lookbackHours from user settings when not provided', async () => {
    const processTaskService = { listTasks: async () => [] };
    const taskRecordService = { get: () => null };
    const sessionManager = {
      sessions: new Map([
        ['s1', { id: 's1', status: 'running', repositoryName: 'repo-a', statusChangedAt: new Date().toISOString() }]
      ])
    };
    const workspaceManager = { workspaces: new Map() };

    const userSettingsService = {
      settings: {
        global: {
          process: {
            status: {
              lookbackHours: 6,
              caps: { wipMax: 9, q12: 1, q3: 2, q4: 3 }
            }
          }
        }
      }
    };

    const svc = new ProcessStatusService({
      processTaskService,
      taskRecordService,
      sessionManager,
      workspaceManager,
      userSettingsService
    });

    const status = await svc.getStatus({ mode: 'mine', force: true });
    expect(status.lookbackHours).toBe(6);
    expect(status.wipMax).toBe(9);
    expect(status.qCaps).toEqual({ q12: 1, q3: 2, q4: 3 });
  });
});

