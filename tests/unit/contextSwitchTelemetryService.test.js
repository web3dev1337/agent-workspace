const fs = require('fs');
const os = require('os');
const path = require('path');

const { ContextSwitchTelemetryService } = require('../../server/contextSwitchTelemetryService');

const makeService = () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-ctx-'));
  return new ContextSwitchTelemetryService({ filePath: path.join(tmp, 'context-switches.jsonl') });
};

describe('ContextSwitchTelemetryService', () => {
  test('tracks events to JSONL and summarizes switches with cost estimate', () => {
    const svc = makeService();
    expect(svc.track({ type: 'worktree-focus', from: 'work1', to: 'work2' }).ok).toBe(true);
    expect(svc.track({ type: 'worktree-focus', from: 'work2', to: 'work3' }).ok).toBe(true);
    expect(svc.track({ type: 'workflow-mode', from: 'focus', to: 'review' }).ok).toBe(true);

    const summary = svc.getSummary({ hours: 1 });
    expect(summary.switches).toBe(3);
    expect(summary.estimatedCostMinutes).toBe(30);
    expect(summary.byType['worktree-focus']).toBe(2);
    expect(summary.topPairs[0].count).toBe(1);
  });

  test('rejects unknown event types', () => {
    const svc = makeService();
    const result = svc.track({ type: 'keyboard-smash' });
    expect(result.ok).toBe(false);
  });

  test('dedupes identical rapid repeats', () => {
    const svc = makeService();
    svc.track({ type: 'workspace-switch', from: 'a', to: 'b' });
    const second = svc.track({ type: 'workspace-switch', from: 'a', to: 'b' });
    expect(second.deduped).toBe(true);
    expect(svc.getSummary({ hours: 1 }).switches).toBe(1);
  });

  test('same-context events do not count as switches', () => {
    const svc = makeService();
    svc.track({ type: 'worktree-focus', from: 'work1', to: 'work1' });
    expect(svc.getSummary({ hours: 1 }).switches).toBe(0);
  });

  test('pairs review-start/review-end into review minutes', () => {
    const svc = makeService();
    const start = new Date(Date.now() - 10 * 60_000).toISOString();
    const end = new Date(Date.now() - 4 * 60_000).toISOString();
    fs.mkdirSync(path.dirname(svc.filePath), { recursive: true });
    fs.writeFileSync(svc.filePath, [
      JSON.stringify({ at: start, type: 'review-start', to: 'pr:a/b#1' }),
      JSON.stringify({ at: end, type: 'review-end', to: 'pr:a/b#1' })
    ].join('\n') + '\n');

    const summary = svc.getSummary({ hours: 1 });
    expect(summary.reviewMinutes).toBe(6);
  });
});
