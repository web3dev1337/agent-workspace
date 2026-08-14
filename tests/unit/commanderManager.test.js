const { CommanderManager, PRIMARY_ID, MAX_COMMANDERS } = require('../../server/commanderManager');

const makeManager = () => {
  // Fresh manager (bypass the module singleton so tests don't leak state).
  return new CommanderManager({ io: null, sessionManager: {} });
};

describe('CommanderManager', () => {
  test('always has a primary commander with id "commander"', () => {
    const mgr = makeManager();
    expect(mgr.primary()).toBeTruthy();
    expect(mgr.primary().id).toBe(PRIMARY_ID);
    expect(mgr.list().find(c => c.primary)?.id).toBe(PRIMARY_ID);
  });

  test('resolve() defaults to primary for empty/unknown ids (no ghost creation)', () => {
    const mgr = makeManager();
    expect(mgr.resolve()).toBe(mgr.primary());
    expect(mgr.resolve('')).toBe(mgr.primary());
    expect(mgr.resolve('does-not-exist')).toBe(mgr.primary());
    // Unknown id did NOT create an instance
    expect(mgr.list()).toHaveLength(1);
  });

  test('spawn() creates an independent instance with its own id and cwd', () => {
    const mgr = makeManager();
    const second = mgr.spawn('research');
    expect(second.id).toBe('research');
    expect(second).not.toBe(mgr.primary());
    expect(second.cwd).toContain('commanders');
    expect(second.cwd).toContain('research');
    expect(mgr.resolve('research')).toBe(second);
    expect(mgr.list()).toHaveLength(2);
  });

  test('spawn() is idempotent for an existing id', () => {
    const mgr = makeManager();
    const a = mgr.spawn('research');
    const b = mgr.spawn('research');
    expect(a).toBe(b);
    expect(mgr.list()).toHaveLength(2);
  });

  test('spawn() rejects bad ids and the reserved primary id', () => {
    const mgr = makeManager();
    expect(() => mgr.spawn('commander')).toThrow(/primary/i);
    expect(() => mgr.spawn('Has Spaces')).toThrow(/Invalid commander id/);
    expect(() => mgr.spawn('UPPER')).not.toThrow(); // lowercased first
    expect(mgr.has('upper')).toBe(true);
  });

  test('spawn() enforces the commander limit', () => {
    const mgr = makeManager();
    for (let i = 1; i < MAX_COMMANDERS; i++) mgr.spawn(`c${i}`);
    expect(mgr.list()).toHaveLength(MAX_COMMANDERS);
    expect(() => mgr.spawn('one-too-many')).toThrow(/limit reached/i);
  });

  test('remove() tears down an additional commander but never the primary', async () => {
    const mgr = makeManager();
    const second = mgr.spawn('research');
    second.stop = jest.fn(() => ({ success: true }));

    const result = await mgr.remove('research');
    expect(result.removed).toBe(true);
    expect(second.stop).toHaveBeenCalled();
    expect(mgr.has('research')).toBe(false);

    await expect(mgr.remove('commander')).rejects.toThrow(/primary/i);
    expect(mgr.primary()).toBeTruthy();
  });

  test('remove() of an unknown id is a no-op', async () => {
    const mgr = makeManager();
    const result = await mgr.remove('nope');
    expect(result.removed).toBe(false);
  });
});

describe('CommanderService instance identity', () => {
  const { CommanderService } = require('../../server/commanderService');

  test('emit() scopes the payload with commanderId', () => {
    const emitted = [];
    const svc = new CommanderService({ io: { emit: (event, payload) => emitted.push({ event, payload }) }, id: 'research' });
    svc.emit('commander-output', { data: 'hi' });
    expect(emitted[0]).toEqual({ event: 'commander-output', payload: { data: 'hi', commanderId: 'research' } });
  });

  test('primary instance defaults to id "commander"', () => {
    const svc = new CommanderService({ io: null });
    expect(svc.id).toBe('commander');
  });
});
