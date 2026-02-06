const fs = require('fs');
const os = require('os');
const path = require('path');
const { AuditExportService } = require('../../server/auditExportService');

describe('AuditExportService', () => {
  let tmpDir;
  let activityPath;
  let schedulerPath;
  let service;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-audit-export-'));
    activityPath = path.join(tmpDir, 'activity.jsonl');
    schedulerPath = path.join(tmpDir, 'scheduler-audit.log');

    const now = Date.now();
    fs.writeFileSync(activityPath, `${JSON.stringify({
      id: 'a1',
      ts: now - 1000,
      kind: 'pr.merge',
      data: {
        actorEmail: 'dev@example.com',
        token: 'fixture_token_redacted',
        cwd: path.join(os.homedir(), 'GitHub', 'repo')
      }
    })}\n`);

    fs.writeFileSync(schedulerPath, `${JSON.stringify({
      at: new Date(now).toISOString(),
      scheduleId: 'health-snapshot',
      command: 'open-advice',
      message: 'bearer fixture_token_redacted'
    })}\n`);

    service = new AuditExportService();
    service.init({
      activityFeed: { filePath: activityPath },
      schedulerService: { auditPath: schedulerPath },
      userSettingsService: {
        getAllSettings: () => ({
          global: {
            audit: {
              maxRecords: 10000,
              redaction: {
                enabled: true,
                emails: true,
                tokens: true,
                homePaths: true
              }
            }
          }
        })
      }
    });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test('exports redacted JSON records from both sources', async () => {
    const payload = await service.exportJson({
      sources: 'activity,scheduler',
      sinceMs: Date.now() - 60_000,
      limit: 100
    });

    expect(payload.ok).toBe(true);
    expect(payload.redacted).toBe(true);
    expect(payload.count).toBe(2);

    const asText = JSON.stringify(payload);
    expect(asText).not.toContain('dev@example.com');
    expect(asText).not.toContain('fixture_token_redacted');
    expect(asText).toContain('[REDACTED]');
    expect(asText).toContain('~');
  });

  test('exports CSV with expected columns', async () => {
    const payload = await service.exportCsv({
      sources: 'activity',
      sinceMs: Date.now() - 60_000,
      limit: 100
    });

    expect(payload.ok).toBe(true);
    expect(typeof payload.csv).toBe('string');
    expect(payload.csv.startsWith('at,source,kind,data')).toBe(true);
    expect(payload.csv).toContain('activity');
  });

  test('reports source status counts', async () => {
    const status = await service.getStatus();
    expect(status.ok).toBe(true);
    expect(status.sources.activity.count).toBe(1);
    expect(status.sources.scheduler.count).toBe(1);
  });
});
