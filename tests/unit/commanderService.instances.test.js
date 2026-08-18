const { CommanderService } = require('../../server/commanderService');

describe('CommanderService multi-instance registry', () => {
  beforeEach(() => {
    CommanderService.instance = null;
    CommanderService.instances = new Map();
  });

  test('getInstance registers the main instance with default label', () => {
    const main = CommanderService.getInstance({});
    expect(main.instanceId).toBe('main');
    expect(main.label).toBe('Commander 1');
    expect(CommanderService.forInstance('main')).toBe(main);
    expect(CommanderService.forInstance('')).toBe(main);
  });

  test('createInstance allocates sequential ids and labels', () => {
    CommanderService.getInstance({});
    const a = CommanderService.createInstance({});
    const b = CommanderService.createInstance({});
    expect(a.id).toBe('cmd-2');
    expect(a.service.label).toBe('Commander 2');
    expect(b.id).toBe('cmd-3');
    expect(CommanderService.forInstance('cmd-2')).toBe(a.service);
  });

  test('instance limit is enforced', () => {
    CommanderService.getInstance({});
    for (let i = 0; i < 5; i++) {
      expect(CommanderService.createInstance({}).id).toBeDefined();
    }
    expect(CommanderService.createInstance({}).error).toMatch(/limit/i);
  });

  test('removeInstance stops and removes, but never main', async () => {
    CommanderService.getInstance({});
    const { id, service } = CommanderService.createInstance({});
    service.stop = jest.fn();
    expect((await CommanderService.removeInstance(id)).ok).toBe(true);
    expect(service.stop).toHaveBeenCalled();
    expect(CommanderService.forInstance(id)).toBeNull();
    expect((await CommanderService.removeInstance('main')).error).toMatch(/main/i);
    expect((await CommanderService.removeInstance('cmd-99')).error).toMatch(/Unknown/i);
  });

  test('listInstances reports id, label and state', () => {
    CommanderService.getInstance({});
    CommanderService.createInstance({});
    const list = CommanderService.listInstances();
    expect(list.map(i => i.id)).toEqual(['main', 'cmd-2']);
    expect(list[1].label).toBe('Commander 2');
    expect(list[0].running).toBe(false);
  });

  test('freed ids are reused after removal', async () => {
    CommanderService.getInstance({});
    const a = CommanderService.createInstance({});
    CommanderService.createInstance({});
    a.service.stop = jest.fn();
    await CommanderService.removeInstance(a.id);
    expect(CommanderService.createInstance({}).id).toBe('cmd-2');
  });
});

describe('CommanderService.adoptOrphanInstances', () => {
  const cleanup = () => {
    for (const id of Array.from(CommanderService.instances.keys())) {
      if (id !== 'main') CommanderService.instances.delete(id);
    }
  };
  beforeEach(cleanup);
  afterEach(() => {
    for (const id of Array.from(CommanderService.instances.keys())) {
      if (id !== 'main') CommanderService.instances.delete(id);
    }
    jest.restoreAllMocks();
  });

  it('re-registers and starts instances for surviving commander panes', () => {
    const fakeBackend = { listSessionNames: () => ['commander-main', 'commander-cmd-3', 'kpop-work1-claude'] };
    const started = [];
    jest.spyOn(CommanderService.prototype, 'start').mockImplementation(function mockStart() {
      started.push(this.instanceId);
      return Promise.resolve({ success: true });
    });
    const adopted = CommanderService.adoptOrphanInstances({}, fakeBackend);
    expect(adopted).toEqual(['cmd-3']);
    expect(CommanderService.instances.has('cmd-3')).toBe(true);
    expect(started).toEqual(['cmd-3']);
  });

  it('skips already-registered instances and non-commander sessions', () => {
    const fakeBackend = { listSessionNames: () => ['commander-main', 'zoo-work1-claude'] };
    jest.spyOn(CommanderService.prototype, 'start').mockImplementation(() => Promise.resolve({ success: true }));
    expect(CommanderService.adoptOrphanInstances({}, fakeBackend)).toEqual([]);
  });

  it('fails soft when the backend cannot list sessions', () => {
    const fakeBackend = { listSessionNames: () => { throw new Error('no server'); } };
    expect(CommanderService.adoptOrphanInstances({}, fakeBackend)).toEqual([]);
  });
});
