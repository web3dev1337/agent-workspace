const fs = require('fs').promises;
const os = require('os');
const path = require('path');

const { TelemetrySnapshotService } = require('../../server/telemetrySnapshotService');

describe('TelemetrySnapshotService', () => {
  test('creates and reads snapshots', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'telemetry-snapshots-'));
    const svc = new TelemetrySnapshotService({ dirPath: dir });

    const created = await svc.create({ kind: 'telemetry_details', params: { lookbackHours: 24 }, data: { ok: true } });
    expect(created).toEqual(expect.objectContaining({ id: expect.any(String), createdAt: expect.any(String) }));

    const loaded = await svc.get(created.id);
    expect(loaded).toEqual(expect.objectContaining({
      id: created.id,
      kind: 'telemetry_details',
      createdAt: created.createdAt,
      params: { lookbackHours: 24 },
      data: { ok: true }
    }));

    const list = svc.list({ limit: 10 });
    expect(Array.isArray(list)).toBe(true);
    expect(list[0]).toEqual(expect.objectContaining({ id: created.id, updatedAt: expect.any(String) }));
  });

  test('rejects invalid ids', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'telemetry-snapshots-'));
    const svc = new TelemetrySnapshotService({ dirPath: dir });
    await expect(svc.get('../nope')).rejects.toThrow('Invalid snapshot id');
  });
});

