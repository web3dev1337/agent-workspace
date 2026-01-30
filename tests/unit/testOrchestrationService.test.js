const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const { EventEmitter } = require('events');

const { TestOrchestrationService, detectTestCommandForWorktree } = require('../../server/testOrchestrationService');

const waitFor = async (fn, { timeoutMs = 1500, intervalMs = 25 } = {}) => {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeoutMs) return null;
    await new Promise(r => setTimeout(r, intervalMs));
  }
};

describe('TestOrchestrationService', () => {
  test('detectTestCommandForWorktree prefers test:unit for auto', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-tests-'));
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: 'example',
      scripts: { 'test:unit': 'jest', test: 'echo ok' }
    }, null, 2));

    const cmd = await detectTestCommandForWorktree(dir, { script: 'auto' });
    expect(cmd).toBeTruthy();
    expect(String(cmd.command)).toMatch(/npm(\.cmd)?$/);
    expect(cmd.args).toEqual(['run', 'test:unit']);
  });

  test('detectTestCommandForWorktree returns null when script missing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-tests-'));
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: 'example',
      scripts: { test: 'echo ok' }
    }, null, 2));

    const cmd = await detectTestCommandForWorktree(dir, { script: 'test:unit' });
    expect(cmd).toBeNull();
  });

  test('startRun executes across worktrees and aggregates results', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-tests-'));
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: 'example',
      scripts: { test: 'echo ok' }
    }, null, 2));

    const spawnImpl = () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      setTimeout(() => {
        child.stdout.emit('data', Buffer.from('ok\n'));
        child.emit('close', 0);
      }, 10);
      return child;
    };

    const service = new TestOrchestrationService({
      sessionManager: { worktrees: [{ id: 'work1', path: dir }] },
      workspaceManager: { getActiveWorkspace: () => ({ id: 'ws1', name: 'WS' }) },
      spawnImpl
    });

    const run = await service.startRun({ script: 'auto', concurrency: 2, existingOnly: true });
    expect(run.ok).toBe(true);
    expect(run.runId).toBeTruthy();

    const done = await waitFor(() => {
      const current = service.getRun(run.runId);
      return current && current.status === 'done' ? current : null;
    });

    expect(done).toBeTruthy();
    expect(done.summary.passed).toBe(1);
    expect(done.summary.failed).toBe(0);
    expect(done.results[0].status).toBe('passed');
    expect(done.results[0].outputTail).toContain('ok');
  });

  test('cancelRun marks queued targets cancelled', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-tests-'));
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: 'example',
      scripts: { test: 'echo ok' }
    }, null, 2));

    const spawnImpl = () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = jest.fn();
      // Never closes on its own (simulates long test run)
      return child;
    };

    const service = new TestOrchestrationService({
      sessionManager: { worktrees: [{ id: 'work1', path: dir }, { id: 'work2', path: dir }] },
      workspaceManager: { getActiveWorkspace: () => ({ id: 'ws1', name: 'WS' }) },
      spawnImpl
    });

    const run = await service.startRun({ script: 'test', concurrency: 1, existingOnly: true });
    expect(run.ok).toBe(true);

    const cancelRes = service.cancelRun(run.runId);
    expect(cancelRes.ok).toBe(true);

    const after = service.getRun(run.runId);
    const queued = after.results.find(r => r.worktreeId === 'work2');
    expect(queued.status).toBe('cancelled');
  });
});
