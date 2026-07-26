const { EventEmitter } = require('events');
const { spawn } = require('child_process');

const { augmentProcessEnv, getHiddenProcessOptions } = require('../utils/processUtils');

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const RESTART_BACKOFF_MS = [1_000, 2_000, 5_000, 15_000, 30_000];
const MAX_LINE_BYTES = 8 * 1024 * 1024;

/**
 * JSON-RPC client for `codex app-server`.
 *
 * This is the interface the Codex app and VS Code extension speak. It matters
 * because it replaces guesswork with facts: instead of matching "Do you want to
 * proceed" in a byte stream, a thread reports `active` with an explicit
 * `waitingOnApproval` flag; instead of spotting a cost line, a turn completes.
 *
 * Per the protocol README the `"jsonrpc":"2.0"` header is omitted on the wire;
 * framing is newline-delimited JSON over stdio.
 */
class AppServerClient extends EventEmitter {
  constructor({ command = 'codex', args = ['app-server'], cwd = null, logger = console, autoRestart = true } = {}) {
    super();
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.logger = logger;
    this.autoRestart = autoRestart;

    this.child = null;
    this.buffer = '';
    this.nextId = 1;
    this.pending = new Map();
    this.starting = null;
    this.stopped = false;
    this.restartAttempts = 0;
    this.lastError = null;
    this.startedAt = null;
  }

  isRunning() {
    return Boolean(this.child && !this.child.killed && this.child.exitCode === null);
  }

  async start() {
    if (this.isRunning()) return { running: true, alreadyRunning: true };
    if (this.starting) return this.starting;

    this.stopped = false;
    this.starting = new Promise((resolve) => {
      try {
        this.child = spawn(this.command, this.args, {
          ...getHiddenProcessOptions({ stdio: ['pipe', 'pipe', 'pipe'] }),
          cwd: this.cwd || undefined,
          env: augmentProcessEnv(process.env)
        });
      } catch (error) {
        this.lastError = error.message;
        this.starting = null;
        resolve({ running: false, error: error.message });
        return;
      }

      this.child.stdout.setEncoding('utf8');
      this.child.stdout.on('data', (chunk) => this.consume(chunk));
      this.child.stderr.setEncoding('utf8');
      this.child.stderr.on('data', (chunk) => {
        const text = String(chunk).trim();
        if (text) this.logger.debug?.('[app-server]', text);
      });

      this.child.on('error', (error) => {
        this.lastError = error.message;
        this.emit('error', error);
      });

      this.child.on('exit', (code, signal) => {
        this.rejectAllPending(new Error(`app-server exited (code ${code}, signal ${signal})`));
        this.child = null;
        this.emit('exit', { code, signal });
        if (!this.stopped && this.autoRestart) this.scheduleRestart();
      });

      this.startedAt = new Date().toISOString();
      this.restartAttempts = 0;
      this.starting = null;
      resolve({ running: true, pid: this.child.pid });
    });

    return this.starting;
  }

  scheduleRestart() {
    const delay = RESTART_BACKOFF_MS[Math.min(this.restartAttempts, RESTART_BACKOFF_MS.length - 1)];
    this.restartAttempts += 1;
    const timer = setTimeout(() => {
      if (!this.stopped) this.start().catch(() => {});
    }, delay);
    if (typeof timer.unref === 'function') timer.unref();
  }

  stop() {
    this.stopped = true;
    this.rejectAllPending(new Error('app-server client stopped'));
    if (this.child) {
      try {
        this.child.kill('SIGTERM');
      } catch {
        // Already gone.
      }
      this.child = null;
    }
    return { running: false };
  }

  rejectAllPending(error) {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  consume(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > MAX_LINE_BYTES) {
      this.logger.warn?.('app-server output exceeded the line buffer; dropping it');
      this.buffer = '';
      return;
    }

    let index = this.buffer.indexOf('\n');
    while (index !== -1) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line) this.handleLine(line);
      index = this.buffer.indexOf('\n');
    }
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      // The app-server occasionally logs non-JSON on stdout during startup.
      return;
    }

    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      this.pending.delete(message.id);
      if (message.error) entry.reject(Object.assign(new Error(message.error.message || 'app-server error'), { data: message.error }));
      else entry.resolve(message.result);
      return;
    }

    if (message.method && message.id !== undefined) {
      // A server->client request (approvals, elicitation). Emit it so a policy
      // layer can answer; unanswered requests are the caller's problem, not ours.
      this.emit('request', { id: message.id, method: message.method, params: message.params || {} });
      return;
    }

    if (message.method) {
      this.emit('notification', { method: message.method, params: message.params || {} });
      this.emit(message.method, message.params || {});
    }
  }

  send(payload) {
    if (!this.isRunning()) return false;
    try {
      this.child.stdin.write(`${JSON.stringify(payload)}\n`);
      return true;
    } catch (error) {
      this.lastError = error.message;
      return false;
    }
  }

  request(method, params = {}, { timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS } = {}) {
    return new Promise((resolve, reject) => {
      if (!this.isRunning()) {
        reject(new Error('app-server is not running'));
        return;
      }

      const id = this.nextId;
      this.nextId += 1;

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`app-server request "${method}" timed out`));
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();

      this.pending.set(id, { resolve, reject, timer, method });
      if (!this.send({ id, method, params })) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error(`could not write "${method}" to app-server`));
      }
    });
  }

  notify(method, params = {}) {
    return this.send({ method, params });
  }

  /**
   * Answer a server->client request, which is how approvals are granted over the
   * protocol instead of by typing "1" into a terminal and hoping.
   */
  respond(id, result) {
    return this.send({ id, result });
  }

  respondError(id, message, code = -32000) {
    return this.send({ id, error: { code, message } });
  }

  getStatus() {
    return {
      running: this.isRunning(),
      pid: this.child?.pid || null,
      startedAt: this.startedAt,
      pendingRequests: this.pending.size,
      restartAttempts: this.restartAttempts,
      lastError: this.lastError
    };
  }
}

module.exports = { AppServerClient, DEFAULT_REQUEST_TIMEOUT_MS };
