const { EventEmitter } = require('events');

// From the protocol: ThreadStatus is a tagged union, and an active thread
// carries flags saying *why* it is active. `waitingOnApproval` is the fact we
// currently reconstruct by pattern-matching prose that changes between releases.
const ACTIVE_FLAGS = { WAITING_ON_APPROVAL: 'waitingOnApproval', WAITING_ON_USER_INPUT: 'waitingOnUserInput' };

const NOTIFICATIONS = {
  THREAD_STATUS_CHANGED: 'thread/status/changed',
  THREAD_STARTED: 'thread/started',
  THREAD_CLOSED: 'thread/closed',
  TURN_STARTED: 'turn/started',
  TURN_COMPLETED: 'turn/completed',
  TOKEN_USAGE: 'thread/tokenUsage/updated',
  RATE_LIMITS: 'account/rateLimits/updated',
  ERROR: 'error',
  ITEM_COMPLETED: 'item/completed',
  COMMAND_APPROVAL: 'item/commandExecution/requestApproval',
  FILE_APPROVAL: 'item/fileChange/requestApproval'
};

/**
 * Translates app-server notifications into the shape the supervisor already
 * understands, so structured signals slot in beside scraped ones rather than
 * requiring a second rule engine.
 *
 * Where a thread is tracked here, its state is *known* rather than inferred:
 * `waiting` means the thread told us it is waiting, and for what.
 */
class AppServerSignalSource extends EventEmitter {
  constructor({ client, logger = console } = {}) {
    super();
    this.client = client;
    this.logger = logger;
    this.threads = new Map();
    this.pendingApprovals = new Map();
    this.bound = false;
  }

  bind() {
    if (this.bound || !this.client) return this;
    this.bound = true;

    this.client.on('notification', ({ method, params }) => {
      try {
        this.handleNotification(method, params);
      } catch (error) {
        this.logger.warn?.('app-server signal mapping failed', { method, error: error.message });
      }
    });

    this.client.on('request', ({ id, method, params }) => {
      if (method === NOTIFICATIONS.COMMAND_APPROVAL || method === NOTIFICATIONS.FILE_APPROVAL) {
        this.recordApprovalRequest(id, method, params);
      }
    });

    this.client.on('exit', () => {
      for (const state of this.threads.values()) state.stale = true;
    });

    return this;
  }

  ensureThread(threadId) {
    if (!threadId) return null;
    if (!this.threads.has(threadId)) {
      this.threads.set(threadId, {
        threadId,
        status: 'unknown',
        activeFlags: [],
        lastEventAt: Date.now(),
        turnId: null,
        turnStartedAt: null,
        lastTurnStatus: null,
        lastTurnError: null,
        tokenUsage: null,
        rateLimits: null,
        lastError: null,
        stale: false
      });
    }
    return this.threads.get(threadId);
  }

  /**
   * The union arrives as `{ type, activeFlags? }`; flatten it to the vocabulary
   * the supervisor rule table already uses (busy / waiting / idle / error).
   */
  mapStatus(raw) {
    const type = String(raw?.type || '').trim();
    const flags = Array.isArray(raw?.activeFlags) ? raw.activeFlags : [];

    if (type === 'active') {
      const waiting = flags.includes(ACTIVE_FLAGS.WAITING_ON_APPROVAL) || flags.includes(ACTIVE_FLAGS.WAITING_ON_USER_INPUT);
      return { status: waiting ? 'waiting' : 'busy', activeFlags: flags };
    }
    if (type === 'idle') return { status: 'idle', activeFlags: [] };
    if (type === 'systemError') return { status: 'error', activeFlags: [] };
    return { status: 'unknown', activeFlags: [] };
  }

  handleNotification(method, params) {
    const threadId = params?.threadId || params?.thread_id || null;
    const state = this.ensureThread(threadId);
    if (!state) return;

    state.lastEventAt = Date.now();
    state.stale = false;

    switch (method) {
      case NOTIFICATIONS.THREAD_STATUS_CHANGED: {
        const mapped = this.mapStatus(params?.status);
        state.status = mapped.status;
        state.activeFlags = mapped.activeFlags;
        this.emit('status', { threadId, ...mapped });
        break;
      }
      case NOTIFICATIONS.TURN_STARTED:
        state.turnId = params?.turn?.id || null;
        state.turnStartedAt = Date.now();
        state.status = state.status === 'waiting' ? 'waiting' : 'busy';
        break;
      case NOTIFICATIONS.TURN_COMPLETED:
        state.turnId = null;
        state.lastTurnStatus = params?.turn?.status || null;
        state.lastTurnError = params?.turn?.error || null;
        state.lastTurnDurationMs = params?.turn?.durationMs ?? null;
        state.status = 'idle';
        this.emit('turn-completed', { threadId, turn: params?.turn || null });
        break;
      case NOTIFICATIONS.TOKEN_USAGE:
        state.tokenUsage = params?.tokenUsage || null;
        break;
      case NOTIFICATIONS.RATE_LIMITS:
        state.rateLimits = params || null;
        this.emit('rate-limits', params || {});
        break;
      case NOTIFICATIONS.THREAD_CLOSED:
        this.threads.delete(threadId);
        break;
      case NOTIFICATIONS.ERROR:
        state.lastError = params?.message || params?.error || 'unknown error';
        break;
      default:
        break;
    }
  }

  recordApprovalRequest(id, method, params) {
    const threadId = params?.threadId || null;
    const state = this.ensureThread(threadId);
    const entry = {
      requestId: id,
      method,
      threadId,
      command: params?.command || params?.changes || null,
      reason: params?.reason || '',
      requestedAt: Date.now()
    };

    // Keyed by String(id): JSON-RPC ids are numbers (the first is literally 0)
    // but an HTTP route param arrives as a string, and a Map lookup with the
    // wrong type silently misses. The entry keeps the ORIGINAL id because the
    // response on the wire must carry it back with its exact type.
    this.pendingApprovals.set(String(id), entry);
    if (state) {
      state.status = 'waiting';
      state.activeFlags = [ACTIVE_FLAGS.WAITING_ON_APPROVAL];
      state.lastEventAt = Date.now();
    }
    this.emit('approval-request', entry);
  }

  /**
   * Grant or refuse an approval over the wire. Compare with the PTY path, which
   * can only type a keystroke at whatever prompt happens to be showing.
   */
  answerApproval(requestId, approved, { note = '' } = {}) {
    const key = String(requestId);
    const entry = this.pendingApprovals.get(key);
    if (!entry) return { ok: false, error: `no pending approval "${requestId}"` };

    const sent = this.client?.respond(entry.requestId, { decision: approved ? 'approved' : 'denied', note });
    // An undelivered answer (app-server mid-restart) must keep the approval
    // pending and retryable — deleting it here made the request vanish from
    // the UI while the real codex thread stayed blocked on it forever.
    if (!sent) {
      return { ok: false, error: 'app-server is not running — answer not delivered, approval still pending', approved, threadId: entry.threadId };
    }
    this.pendingApprovals.delete(key);

    const state = this.threads.get(entry.threadId);
    if (state && approved) {
      state.status = 'busy';
      state.activeFlags = [];
    }
    return { ok: true, approved, threadId: entry.threadId };
  }

  listPendingApprovals() {
    return [...this.pendingApprovals.values()];
  }

  /**
   * A supervisor-shaped signal for one thread, or null when this source knows
   * nothing about it — in which case the PTY scraper remains authoritative.
   */
  getSignal(threadId) {
    const state = this.threads.get(threadId);
    if (!state || state.stale) return null;

    const quietSeconds = Math.max(0, Math.round((Date.now() - state.lastEventAt) / 1000));
    return {
      source: 'app-server',
      threadId,
      status: state.status,
      activeFlags: state.activeFlags,
      awaitingApproval: state.activeFlags.includes(ACTIVE_FLAGS.WAITING_ON_APPROVAL),
      awaitingUserInput: state.activeFlags.includes(ACTIVE_FLAGS.WAITING_ON_USER_INPUT),
      quietSeconds,
      turnId: state.turnId,
      lastTurnStatus: state.lastTurnStatus,
      lastTurnError: state.lastTurnError,
      tokenUsage: state.tokenUsage,
      rateLimits: state.rateLimits,
      lastError: state.lastError
    };
  }

  listThreads() {
    return [...this.threads.keys()].map((threadId) => this.getSignal(threadId)).filter(Boolean);
  }

  getStatus() {
    return {
      bound: this.bound,
      threadCount: this.threads.size,
      pendingApprovals: this.pendingApprovals.size,
      threads: this.listThreads()
    };
  }
}

module.exports = { AppServerSignalSource, ACTIVE_FLAGS, NOTIFICATIONS };
