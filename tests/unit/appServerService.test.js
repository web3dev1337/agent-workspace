const { EventEmitter } = require('events');

const { AppServerClient } = require('../../server/agents/appServerClient');
const { AppServerSignalSource, ACTIVE_FLAGS } = require('../../server/agents/appServerSignals');
const { applyStructuredSignal } = require('../../server/supervisor/supervisorSignals');
const { loadRules, DEFAULT_RULES_PATH, evaluate } = require('../../server/supervisor/supervisorRules');

/** A client stand-in that lets tests push protocol frames without spawning codex. */
class FakeClient extends EventEmitter {
  constructor() {
    super();
    this.responses = [];
  }

  respond(id, result) {
    this.responses.push({ id, result });
    return true;
  }

  emitNotification(method, params) {
    this.emit('notification', { method, params });
    this.emit(method, params);
  }

  emitRequest(id, method, params) {
    this.emit('request', { id, method, params });
  }
}

describe('AppServerClient framing', () => {
  test('parses newline-delimited JSON and resolves the matching request', async () => {
    const client = new AppServerClient({ autoRestart: false });
    const resolved = [];
    client.pending.set(7, { resolve: (v) => resolved.push(v), reject: () => {}, timer: setTimeout(() => {}, 0), method: 'x' });

    client.consume('{"id":7,"result":{"threadId":"t1"}}\n');
    expect(resolved).toEqual([{ threadId: 't1' }]);
  });

  test('a frame split across chunks is reassembled', () => {
    const client = new AppServerClient({ autoRestart: false });
    const seen = [];
    client.on('notification', (n) => seen.push(n.method));

    client.consume('{"method":"turn/');
    client.consume('started","params":{"threadId":"t1"}}\n');
    expect(seen).toEqual(['turn/started']);
  });

  test('non-JSON stdout noise is skipped rather than throwing', () => {
    const client = new AppServerClient({ autoRestart: false });
    expect(() => client.consume('starting up...\n{"method":"x"}\n')).not.toThrow();
  });

  test('a server error response rejects with the protocol message', async () => {
    const client = new AppServerClient({ autoRestart: false });
    const rejected = [];
    client.pending.set(1, { resolve: () => {}, reject: (e) => rejected.push(e.message), timer: setTimeout(() => {}, 0), method: 'x' });

    client.consume('{"id":1,"error":{"code":-32000,"message":"nope"}}\n');
    expect(rejected).toEqual(['nope']);
  });

  test('requests fail fast when the server is not running', async () => {
    await expect(new AppServerClient({ autoRestart: false }).request('thread/list')).rejects.toThrow(/not running/);
  });
});

describe('AppServerSignalSource', () => {
  const source = () => {
    const client = new FakeClient();
    return { client, signals: new AppServerSignalSource({ client, logger: { warn: () => {} } }).bind() };
  };

  test('an active thread waiting on approval is reported as waiting, not guessed', () => {
    const { client, signals } = source();
    client.emitNotification('thread/status/changed', {
      threadId: 't1',
      status: { type: 'active', activeFlags: [ACTIVE_FLAGS.WAITING_ON_APPROVAL] }
    });

    const signal = signals.getSignal('t1');
    expect(signal.status).toBe('waiting');
    expect(signal.awaitingApproval).toBe(true);
    expect(signal.source).toBe('app-server');
  });

  test('an active thread with no flags is simply busy', () => {
    const { client, signals } = source();
    client.emitNotification('thread/status/changed', { threadId: 't1', status: { type: 'active', activeFlags: [] } });
    expect(signals.getSignal('t1').status).toBe('busy');
    expect(signals.getSignal('t1').awaitingApproval).toBe(false);
  });

  test('systemError surfaces as an error state we cannot see from a PTY at all', () => {
    const { client, signals } = source();
    client.emitNotification('thread/status/changed', { threadId: 't1', status: { type: 'systemError' } });
    expect(signals.getSignal('t1').status).toBe('error');
  });

  test('turn completion is an event, not a cost line to be spotted', () => {
    const { client, signals } = source();
    client.emitNotification('turn/started', { threadId: 't1', turn: { id: 'turn1' } });
    expect(signals.getSignal('t1').status).toBe('busy');

    client.emitNotification('turn/completed', { threadId: 't1', turn: { id: 'turn1', status: 'completed', durationMs: 4200 } });
    const signal = signals.getSignal('t1');
    expect(signal.status).toBe('idle');
    expect(signal.lastTurnStatus).toBe('completed');
    expect(signal.turnId).toBeNull();
  });

  test('token usage and rate limits are captured — invisible to PTY scraping', () => {
    const { client, signals } = source();
    client.emitNotification('thread/tokenUsage/updated', { threadId: 't1', turnId: 'x', tokenUsage: { input: 100, output: 20 } });
    client.emitNotification('account/rateLimits/updated', { threadId: 't1', primary: { usedPercent: 82 } });

    const signal = signals.getSignal('t1');
    expect(signal.tokenUsage).toEqual({ input: 100, output: 20 });
    expect(signal.rateLimits.primary.usedPercent).toBe(82);
  });

  test('an approval request marks the thread waiting and is answerable over the wire', () => {
    const { client, signals } = source();
    client.emitRequest(42, 'item/commandExecution/requestApproval', { threadId: 't1', command: 'npm test' });

    expect(signals.getSignal('t1').awaitingApproval).toBe(true);
    expect(signals.listPendingApprovals()[0].command).toBe('npm test');

    const result = signals.answerApproval(42, true);
    expect(result.ok).toBe(true);
    expect(client.responses[0].result.decision).toBe('approved');
    expect(signals.listPendingApprovals()).toEqual([]);
  });

  test('answering an unknown approval is refused rather than silently dropped', () => {
    const { signals } = source();
    expect(signals.answerApproval('nope', true).ok).toBe(false);
  });

  test('a numeric request id 0 is answerable via the string an HTTP route delivers', () => {
    const { client, signals } = source();
    // The first JSON-RPC request a real app-server sends has id 0 (a number);
    // an Express path param arrives as the string "0".
    client.emitRequest(0, 'item/commandExecution/requestApproval', { threadId: 't1', command: 'printf ok' });
    expect(signals.listPendingApprovals()).toHaveLength(1);

    const result = signals.answerApproval('0', true);
    expect(result.ok).toBe(true);
    // The response on the wire must carry the ORIGINAL numeric id back.
    expect(client.responses[0].id).toBe(0);
    expect(signals.listPendingApprovals()).toEqual([]);
  });

  test('a closed thread stops producing signals', () => {
    const { client, signals } = source();
    client.emitNotification('thread/status/changed', { threadId: 't1', status: { type: 'idle' } });
    client.emitNotification('thread/closed', { threadId: 't1' });
    expect(signals.getSignal('t1')).toBeNull();
  });

  test('signals go stale when the app-server dies, so the PTY takes over again', () => {
    const { client, signals } = source();
    client.emitNotification('thread/status/changed', { threadId: 't1', status: { type: 'idle' } });
    client.emit('exit', { code: 1 });
    expect(signals.getSignal('t1')).toBeNull();
  });
});

describe('supervisor integration', () => {
  test('a structured signal overrides the scraped guess but keeps the tail', () => {
    const scraped = { sessionId: 's1', signalSource: 'pty', status: 'busy', quietSeconds: 400, tail: 'some output' };
    const merged = applyStructuredSignal(scraped, {
      source: 'app-server',
      threadId: 't1',
      status: 'waiting',
      activeFlags: ['waitingOnApproval'],
      awaitingApproval: true,
      quietSeconds: 12
    });

    expect(merged.status).toBe('waiting');
    expect(merged.signalSource).toBe('app-server');
    expect(merged.quietSeconds).toBe(12);
    expect(merged.tail).toBe('some output');
  });

  test('no structured signal leaves the scraped one untouched', () => {
    const scraped = { sessionId: 's1', signalSource: 'pty', status: 'busy', quietSeconds: 400 };
    expect(applyStructuredSignal(scraped, null)).toBe(scraped);
  });

  test('an unknown structured status does not clobber a known scraped one', () => {
    const merged = applyStructuredSignal(
      { status: 'busy', quietSeconds: 30 },
      { source: 'app-server', status: 'unknown', quietSeconds: 5 }
    );
    expect(merged.status).toBe('busy');
  });

  test('a reported approval fires the structured rule in seconds, not minutes', () => {
    const rules = loadRules({ rulesPath: DEFAULT_RULES_PATH });
    const findings = evaluate([{
      sessionId: 'work1-codex',
      type: 'codex',
      status: 'waiting',
      signalSource: 'app-server',
      awaitingApproval: true,
      agentPresent: true,
      quietSeconds: 15,
      tail: '',
      repeatedLineCount: 0,
      git: null,
      tier: 2
    }], rules);

    expect(findings[0].conditionId).toBe('structured-approval');
    expect(findings[0].signalSource).toBe('app-server');
  });

  test('a reported system error is delegated, not nudged', () => {
    const rules = loadRules({ rulesPath: DEFAULT_RULES_PATH });
    const condition = rules.conditions.find((c) => c.id === 'thread-system-error');
    expect(condition.resolve.handler).toBe('delegate-to-commander');
    expect(condition.severity).toBe('critical');
  });

  test('PTY sessions never match the structured-only rules', () => {
    const rules = loadRules({ rulesPath: DEFAULT_RULES_PATH });
    const findings = evaluate([{
      sessionId: 'work1-claude',
      type: 'claude',
      status: 'busy',
      signalSource: 'pty',
      agentPresent: true,
      quietSeconds: 15,
      tail: 'working',
      repeatedLineCount: 0,
      git: null,
      tier: 2
    }], rules);

    expect(findings.map((f) => f.conditionId)).not.toContain('structured-approval');
  });
});
