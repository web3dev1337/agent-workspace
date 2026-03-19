const fs = require('fs').promises;
const os = require('os');
const path = require('path');

const { ActivityFeedService } = require('../../server/activityFeedService');

function nextTmpFile(name) {
  const dir = path.join(os.tmpdir(), 'orchestrator-test-activity');
  return path.join(dir, `${Date.now()}-${Math.random().toString(16).slice(2)}-${name}`);
}

describe('ActivityFeedService', () => {
  test('track() stores newest events and list() returns newest-first with limit', () => {
    const svc = new ActivityFeedService({ filePath: nextTmpFile('activity.jsonl'), maxEvents: 500 });
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(1000);
    nowSpy.mockReturnValueOnce(2000);
    nowSpy.mockReturnValueOnce(3000);

    svc.track('a.one', { n: 1 });
    svc.track('a.two', { n: 2 });
    svc.track('a.three', { n: 3 });

    const list2 = svc.list({ limit: 2 });
    expect(list2).toHaveLength(2);
    expect(list2[0].kind).toBe('a.three');
    expect(list2[1].kind).toBe('a.two');

    const since2500 = svc.list({ since: 2500, limit: 50 });
    expect(since2500).toHaveLength(1);
    expect(since2500[0].kind).toBe('a.three');

    nowSpy.mockRestore();
  });

  test('ensureLoaded() loads recent events from existing JSONL file', async () => {
    const filePath = nextTmpFile('activity.jsonl');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, [
      JSON.stringify({ id: 'a', ts: 1, kind: 'k1', data: { n: 1 } }),
      JSON.stringify({ id: 'b', ts: 2, kind: 'k2', data: { n: 2 } })
    ].join('\n') + '\n', 'utf8');

    const svc = new ActivityFeedService({ filePath, maxEvents: 10 });
    expect(svc.list({ limit: 10 })).toHaveLength(0);

    await svc.ensureLoaded();
    const list = svc.list({ limit: 10 });
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe('b');
    expect(list[1].id).toBe('a');
  });

  test('track() caps in-memory events to maxEvents', () => {
    const svc = new ActivityFeedService({ filePath: nextTmpFile('activity.jsonl'), maxEvents: 2 });
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(10);
    nowSpy.mockReturnValueOnce(20);
    nowSpy.mockReturnValueOnce(30);

    svc.track('k1', {});
    svc.track('k2', {});
    svc.track('k3', {});

    const all = svc.list({ limit: 10 }).reverse(); // oldest-first for assertion
    expect(all).toHaveLength(2);
    expect(all[0].kind).toBe('k2');
    expect(all[1].kind).toBe('k3');

    nowSpy.mockRestore();
  });

  test('track() emits to socket.io when configured and appends JSONL to file (best-effort)', async () => {
    const filePath = nextTmpFile('activity.jsonl');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const svc = new ActivityFeedService({ filePath, maxEvents: 10 });
    const io = { emit: jest.fn() };
    svc.setIO(io);

    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(12345);
    const ev = svc.track('server.started', { port: 3000 });
    expect(ev).toBeTruthy();
    expect(ev.kind).toBe('server.started');
    expect(typeof ev.id).toBe('string');
    expect(ev.ts).toBe(12345);
    expect(io.emit).toHaveBeenCalledWith('activity-event', expect.objectContaining({ id: ev.id }));

    // Allow async append to happen (Windows CI can be slow)
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      try {
        const contents = await fs.readFile(filePath, 'utf8');
        if (contents.includes('"kind":"server.started"')) break;
      } catch { /* file not yet written */ }
    }
    const contents = await fs.readFile(filePath, 'utf8');
    expect(contents).toContain('"kind":"server.started"');

    nowSpy.mockRestore();
  });
});
