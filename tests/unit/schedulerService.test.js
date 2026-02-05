const { SchedulerService } = require('../../server/schedulerService');

describe('SchedulerService', () => {
  const buildService = ({ command = 'open-queue' } = {}) => {
    const settings = {
      global: {
        scheduler: {
          enabled: true,
          tickSeconds: 30,
          safety: {
            defaultMode: 'safe',
            blockedCommandPatterns: ['queue-merge']
          },
          schedules: [
            {
              id: 's1',
              enabled: true,
              intervalMinutes: 30,
              command,
              params: {}
            }
          ]
        }
      }
    };

    const userSettingsService = {
      getAllSettings: jest.fn(() => JSON.parse(JSON.stringify(settings))),
      updateGlobalSettings: jest.fn((nextGlobal) => {
        settings.global = nextGlobal;
        return true;
      })
    };

    const commandRegistry = {
      execute: jest.fn(async () => ({ success: true, message: 'ok' }))
    };

    const service = new SchedulerService({ logger: { info: () => {}, warn: () => {}, error: () => {} } });
    service.init({ userSettingsService, commandRegistry });
    return { service, commandRegistry };
  };

  test('blocks dangerous command by default safety policy', async () => {
    const { service, commandRegistry } = buildService({ command: 'queue-merge' });
    try {
      const result = await service.runNow('s1');
      expect(result.ok).toBe(false);
      expect(result.blocked).toBe(true);
      expect(commandRegistry.execute).not.toHaveBeenCalled();
    } finally {
      service.stop();
    }
  });

  test('runs safe command and records result', async () => {
    const { service, commandRegistry } = buildService({ command: 'open-queue' });
    try {
      const result = await service.runNow('s1');
      expect(result.ok).toBe(true);
      expect(commandRegistry.execute).toHaveBeenCalledWith('open-queue', {});
      const status = service.getStatus();
      expect(Array.isArray(status.recentRuns)).toBe(true);
      expect(status.recentRuns.length).toBeGreaterThan(0);
    } finally {
      service.stop();
    }
  });
});
