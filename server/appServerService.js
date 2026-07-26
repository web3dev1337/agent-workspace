const { AppServerClient } = require('./agents/appServerClient');
const { AppServerSignalSource } = require('./agents/appServerSignals');

const REALTIME = {
  START: 'thread/realtime/start',
  STOP: 'thread/realtime/stop',
  APPEND_TEXT: 'thread/realtime/appendText',
  APPEND_AUDIO: 'thread/realtime/appendAudio',
  APPEND_SPEECH: 'thread/realtime/appendSpeech',
  LIST_VOICES: 'thread/realtime/listVoices'
};

const REALTIME_EVENTS = [
  'thread/realtime/started',
  'thread/realtime/closed',
  'thread/realtime/error',
  'thread/realtime/itemAdded',
  'thread/realtime/transcript/delta',
  'thread/realtime/transcript/done',
  'thread/realtime/outputAudio/delta',
  'thread/realtime/sdp'
];

/**
 * Talks to `codex app-server` so Codex sessions can report facts instead of
 * being guessed at, and so the full-duplex realtime voice pipeline is usable
 * from here rather than only from OpenAI's own (Codex-only, macOS-only) app.
 *
 * Opt-in. Nothing regresses when it is off: the PTY scraper stays the universal
 * signal source for Claude, Gemini, aider and anything else.
 */
class AppServerService {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this.enabled = String(process.env.CODEX_APP_SERVER || '').toLowerCase() === 'true';
    this.client = new AppServerClient({ logger });
    this.signals = new AppServerSignalSource({ client: this.client, logger });
    this.io = null;
    this.speechService = null;
    this.realtimeThreads = new Map();
    this.transcripts = [];
    this.maxTranscripts = 200;
    this.serverInfo = null;
  }

  static getInstance(options = {}) {
    if (!AppServerService.instance) {
      AppServerService.instance = new AppServerService(options);
    }
    return AppServerService.instance;
  }

  init({ io, speechService } = {}) {
    this.io = io || this.io;
    this.speechService = speechService || this.speechService;
    this.signals.bind();
    this.bindRealtime();
    return this;
  }

  bindRealtime() {
    if (this.realtimeBound || !this.client) return;
    this.realtimeBound = true;

    for (const event of REALTIME_EVENTS) {
      this.client.on(event, (params) => this.handleRealtimeEvent(event, params));
    }

    // An approval arriving over the wire is worth surfacing immediately — it is
    // the thing most likely to be silently blocking a session.
    this.signals.on('approval-request', (entry) => {
      this.io?.emit('app-server-approval', entry);
    });
  }

  handleRealtimeEvent(event, params = {}) {
    const threadId = params?.threadId || null;

    if (event === 'thread/realtime/started') {
      this.realtimeThreads.set(threadId, { threadId, startedAt: new Date().toISOString() });
    }
    if (event === 'thread/realtime/closed' || event === 'thread/realtime/error') {
      this.realtimeThreads.delete(threadId);
    }

    if (event === 'thread/realtime/transcript/delta' || event === 'thread/realtime/transcript/done') {
      this.recordTranscript({
        threadId,
        role: params?.role || 'assistant',
        text: params?.delta || params?.text || '',
        done: event.endsWith('done'),
        at: new Date().toISOString()
      });
    }

    // Audio deltas are large and high-frequency; forward the fact, not the bytes.
    const payload = event === 'thread/realtime/outputAudio/delta'
      ? { threadId, bytes: (params?.delta || '').length }
      : params;

    this.io?.emit('app-server-realtime', { event, payload });
  }

  recordTranscript(entry) {
    this.transcripts.unshift(entry);
    if (this.transcripts.length > this.maxTranscripts) this.transcripts.length = this.maxTranscripts;
    this.io?.emit('app-server-transcript', entry);
  }

  async start() {
    if (!this.enabled) return { running: false, reason: 'CODEX_APP_SERVER is not enabled' };

    const started = await this.client.start();
    if (!started.running) return started;

    this.signals.bind();
    this.bindRealtime();

    // The protocol requires an initialize handshake before anything else; the
    // server answers with codexHome and platform details.
    try {
      this.serverInfo = await this.client.request('initialize', {
        clientInfo: { name: 'agent-workspace', version: require('../package.json').version || '1.0.0' }
      }, { timeoutMs: 15_000 });
    } catch (error) {
      this.logger.warn?.('app-server initialize failed', { error: error.message });
      this.serverInfo = null;
    }

    return { ...started, initialized: Boolean(this.serverInfo) };
  }

  stop() {
    this.realtimeThreads.clear();
    return this.client.stop();
  }

  setEnabled(enabled) {
    this.enabled = enabled === true;
    if (!this.enabled) this.stop();
    return this.enabled;
  }

  /**
   * The protocol returns paged threads under `data`, not `threads` — verified
   * against a live app-server rather than assumed from the schema names.
   */
  async listThreads({ limit = 50 } = {}) {
    const result = await this.client.request('thread/list', { limit });
    if (Array.isArray(result?.data)) return result.data;
    if (Array.isArray(result?.threads)) return result.threads;
    return Array.isArray(result) ? result : [];
  }

  async startThread(params = {}) {
    return this.client.request('thread/start', params);
  }

  async resumeThread(threadId, params = {}) {
    return this.client.request('thread/resume', { threadId, ...params });
  }

  async startTurn(threadId, input) {
    return this.client.request('turn/start', { threadId, input });
  }

  async interruptTurn(threadId) {
    return this.client.request('turn/interrupt', { threadId });
  }

  // ---- Realtime voice -----------------------------------------------------

  /**
   * Open a full-duplex realtime session on a thread. `websocket` is the default
   * transport because it needs no peer-connection setup; `webrtc` is available
   * for a browser that wants to negotiate directly.
   */
  async startRealtime(threadId, { transport = 'websocket', sdp = '', voice = '' } = {}) {
    const params = {
      threadId,
      transport: transport === 'webrtc' ? { type: 'webrtc', sdp } : { type: 'websocket' }
    };
    if (voice) params.voice = voice;
    const result = await this.client.request(REALTIME.START, params);
    this.realtimeThreads.set(threadId, { threadId, transport, startedAt: new Date().toISOString() });
    return result;
  }

  async stopRealtime(threadId) {
    const result = await this.client.request(REALTIME.STOP, { threadId });
    this.realtimeThreads.delete(threadId);
    return result;
  }

  async sendRealtimeText(threadId, text) {
    return this.client.request(REALTIME.APPEND_TEXT, { threadId, text: String(text || '') });
  }

  async sendRealtimeAudio(threadId, audioBase64) {
    // Audio is streamed, so this is a notification rather than a round trip.
    return this.client.notify(REALTIME.APPEND_AUDIO, { threadId, audio: audioBase64 });
  }

  async listVoices() {
    return this.client.request(REALTIME.LIST_VOICES, {});
  }

  getTranscripts({ threadId = '', limit = 50 } = {}) {
    const wanted = String(threadId || '').trim();
    return this.transcripts
      .filter((entry) => (!wanted || entry.threadId === wanted))
      .slice(0, Math.max(1, Number(limit) || 50));
  }

  // ---- Supervisor integration --------------------------------------------

  /**
   * Structured signal for a session, if this source knows about it. Returning
   * null is meaningful: it means "no better information than the PTY", and the
   * supervisor keeps scraping.
   */
  getSignalForSession(session) {
    const threadId = session?.appServerThreadId || session?.threadId || null;
    if (!threadId) return null;
    return this.signals.getSignal(threadId);
  }

  listPendingApprovals() {
    return this.signals.listPendingApprovals();
  }

  answerApproval(requestId, approved, options = {}) {
    return this.signals.answerApproval(requestId, approved, options);
  }

  getStatus() {
    return {
      enabled: this.enabled,
      serverInfo: this.serverInfo,
      client: this.client.getStatus(),
      signals: this.signals.getStatus(),
      realtimeThreads: [...this.realtimeThreads.values()],
      transcriptCount: this.transcripts.length
    };
  }
}

module.exports = AppServerService;
module.exports.AppServerService = AppServerService;
module.exports.REALTIME = REALTIME;
module.exports.REALTIME_EVENTS = REALTIME_EVENTS;
