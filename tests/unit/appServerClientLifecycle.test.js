const { EventEmitter } = require('events');

const mockSpawn = jest.fn();
jest.mock('child_process', () => ({ spawn: (...args) => mockSpawn(...args) }));

const { AppServerClient } = require('../../server/agents/appServerClient');

const quietLogger = { warn: () => {}, debug: () => {}, info: () => {} };

function makeChild(pid = 4242) {
  const child = new EventEmitter();
  child.pid = pid;
  child.killed = false;
  child.exitCode = null;
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter();
  child.stderr.setEncoding = () => {};
  child.stdin = { write: jest.fn() };
  child.kill = jest.fn(() => { child.killed = true; });
  return child;
}

beforeEach(() => mockSpawn.mockReset());

describe('AppServerClient lifecycle', () => {
  test('an "error" notification does not crash the process (reserved event guard)', () => {
    const client = new AppServerClient({ autoRestart: false, logger: quietLogger });
    // Before the fix this emitted a listener-less 'error' event, which Node
    // throws for — taking the whole orchestrator down via uncaughtException.
    expect(() => client.consume('{"method":"error","params":{"message":"boom"}}\n')).not.toThrow();
  });

  test('the "error" notification is still delivered via the generic notification event', () => {
    const client = new AppServerClient({ autoRestart: false, logger: quietLogger });
    const seen = [];
    client.on('notification', (n) => seen.push(n.method));
    client.consume('{"method":"error","params":{"message":"boom"}}\n');
    expect(seen).toEqual(['error']);
  });

  test('a child-process error event is recorded instead of crashing', async () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child);
    const client = new AppServerClient({ autoRestart: false, logger: quietLogger });
    await client.start();

    expect(() => child.emit('error', new Error('spawn EACCES'))).not.toThrow();
    expect(client.lastError).toMatch(/EACCES/);
  });

  test('start() spawns again after the child exits (no stale in-flight promise)', async () => {
    mockSpawn.mockImplementation(() => makeChild());
    const client = new AppServerClient({ autoRestart: false, logger: quietLogger });

    const first = await client.start();
    expect(first.running).toBe(true);
    expect(mockSpawn).toHaveBeenCalledTimes(1);

    // The child dies; its exit handler nulls this.child.
    client.child.emit('exit', 0, null);
    expect(client.isRunning()).toBe(false);

    // Before the fix, `this.starting` held a stale resolved promise, so this
    // returned the old result and never respawned.
    const second = await client.start();
    expect(second.running).toBe(true);
    expect(mockSpawn).toHaveBeenCalledTimes(2);
  });

  test('a stopped child exiting late cannot clobber its replacement', async () => {
    const first = makeChild(1001);
    const second = makeChild(1002);
    mockSpawn.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const client = new AppServerClient({ autoRestart: false, logger: quietLogger });

    await client.start();
    client.stop();
    await client.start();
    expect(client.child).toBe(second);

    // The new child has a request in flight when the OLD child's SIGTERM'd
    // exit event finally lands (it always arrives on a later tick).
    const pending = client.request('initialize', {});
    first.emit('exit', 0, null);

    // The new child and its pending request must be untouched.
    expect(client.child).toBe(second);
    expect(client.pending.size).toBe(1);
    second.emit('data-noop');
    client.consume('{"id":1,"result":{"ok":true}}\n');
    await expect(pending).resolves.toEqual({ ok: true });
  });

  test('every successful spawn emits "started" so the handshake can re-run', async () => {
    mockSpawn.mockImplementation(() => makeChild());
    const client = new AppServerClient({ autoRestart: false, logger: quietLogger });
    const started = [];
    client.on('started', (info) => started.push(info.pid));

    await client.start();
    client.child.emit('exit', 1, null);
    await client.start();
    expect(started).toHaveLength(2);
  });

  test('an oversized trailing line is dropped without discarding complete frames ahead of it', () => {
    const client = new AppServerClient({ autoRestart: false, logger: quietLogger });
    const seen = [];
    client.on('notification', (n) => seen.push(n.method));

    // A complete frame, then an unterminated 9MB line (no newline).
    client.consume('{"method":"turn/completed","params":{}}\n');
    client.consume(`{"method":"x","params":{"blob":"${'a'.repeat(9 * 1024 * 1024)}`);

    // The complete frame was handled; the oversized incomplete line was dropped.
    expect(seen).toEqual(['turn/completed']);
    expect(client.buffer).toBe('');
  });

  test('a spawn failure resolves cleanly and leaves start() retryable', async () => {
    mockSpawn.mockImplementationOnce(() => { throw new Error('ENOENT'); });
    const client = new AppServerClient({ autoRestart: false, logger: quietLogger });

    const failed = await client.start();
    expect(failed.running).toBe(false);
    expect(failed.error).toMatch(/ENOENT/);

    // The in-flight marker must be cleared so a later attempt actually retries.
    mockSpawn.mockImplementationOnce(() => makeChild());
    const recovered = await client.start();
    expect(recovered.running).toBe(true);
    expect(mockSpawn).toHaveBeenCalledTimes(2);
  });
});
