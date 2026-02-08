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

  test('creates a schedule from a template', async () => {
    const { service } = buildService({ command: 'open-queue' });
    try {
      const created = await service.createScheduleFromTemplate('health-snapshot', { intervalMinutes: 25 });
      expect(created.schedule.id).toBeTruthy();
      expect(created.schedule.command).toBe('open-advice');
      expect(created.schedule.intervalMinutes).toBe(25);

      const status = service.getStatus();
      const ids = (status.config?.schedules || []).map((row) => row.id);
      expect(ids).toContain(created.schedule.id);
    } finally {
      service.stop();
    }
  });

  test('previews a schedule from template without persisting it', async () => {
    const { service } = buildService({ command: 'open-queue' });
    try {
      const before = service.getStatus();
      const beforeIds = (before.config?.schedules || []).map((row) => row.id);

      const preview = await service.previewScheduleFromTemplate('health-snapshot', { intervalMinutes: 25 });
      expect(preview.template.id).toBe('health-snapshot');
      expect(preview.schedule.command).toBe('open-advice');
      expect(preview.schedule.intervalMinutes).toBe(25);
      expect(preview.safety.ok).toBe(true);

      const after = service.getStatus();
      const afterIds = (after.config?.schedules || []).map((row) => row.id);
      expect(afterIds).toEqual(beforeIds);
    } finally {
      service.stop();
    }
  });

  test('exposes expanded scheduler templates', async () => {
    const { service } = buildService({ command: 'open-queue' });
    try {
      const templates = service.getTemplates();
      const ids = templates.map((row) => row.id);
      expect(ids).toContain('discord-queue-cadence');
      expect(ids).toContain('workspace-refresh-snapshot');
      expect(ids).toContain('queue-conveyor-t3');
    } finally {
      service.stop();
    }
  });

  test('rejects unknown template id', async () => {
    const { service } = buildService({ command: 'open-queue' });
    try {
      await expect(service.createScheduleFromTemplate('does-not-exist')).rejects.toThrow('Unknown scheduler template');
    } finally {
      service.stop();
    }
  });
});
