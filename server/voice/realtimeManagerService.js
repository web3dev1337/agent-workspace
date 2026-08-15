const fs = require('fs');
const path = require('path');

/**
 * The Realtime Manager: the ambient half of JARVIS.
 *
 * Everything else in the voice stack is reactive — you speak, it answers. This
 * service watches the orchestrator's live state and VOLUNTEERS one short
 * spoken line when something you'd care about changes: a session flipping
 * busy->idle (an agent finished), sessions appearing/dying, the queue moving.
 *
 * Design rules:
 *   - narrate TRANSITIONS only, never heartbeat status
 *   - hard floor between spoken updates (default 30s) — silence is the default
 *   - deterministic templates, zero tokens; an LLM summarizer can slot in later
 *   - config-gated via config/voice-tiers.json -> realtimeManager
 */
class RealtimeManagerService {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this.deps = {};
    this.timer = null;
    this.lastSpokenAt = 0;
    this.prev = null;
    this.pendingLines = [];
    this.config = this.loadConfig();
  }

  static getInstance(options = {}) {
    if (!RealtimeManagerService.instance) {
      RealtimeManagerService.instance = new RealtimeManagerService(options);
    }
    return RealtimeManagerService.instance;
  }

  loadConfig() {
    try {
      const raw = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', '..', 'config', 'voice-tiers.json'), 'utf8'));
      return { enabled: true, minSecondsBetweenUpdates: 30, speakInBackgroundMode: false, ...(raw.realtimeManager || {}) };
    } catch {
      return { enabled: true, minSecondsBetweenUpdates: 30, speakInBackgroundMode: false };
    }
  }

  init(deps = {}) {
    this.deps = { ...this.deps, ...deps };
    if (this.config.enabled && !this.timer) {
      this.timer = setInterval(() => this.tick(), 5000);
      this.timer.unref?.();
    }
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  snapshot() {
    try {
      const d = this.deps;
      const snap = d.commanderContextService?.getSnapshot?.({
        workspaceManager: d.workspaceManager,
        commanderService: d.commanderService,
        commandRegistry: d.commandRegistry
      }) || {};
      const sessions = {};
      for (const s of snap.computed?.sessions || []) {
        sessions[s.sessionId || s.id || s.name || 'unknown'] = String(s.status || 'active').toLowerCase();
      }
      return { sessions, queue: (snap.context?.queueSummary || []).length };
    } catch {
      return null;
    }
  }

  diff(prev, now) {
    const lines = [];
    if (!prev || !now) return lines;
    for (const [id, status] of Object.entries(now.sessions)) {
      const before = prev.sessions[id];
      if (before === undefined) {
        lines.push(`New session on ${this.speakId(id)}.`);
      } else if (before !== status) {
        if (/idle|waiting/.test(status) && /busy|working|running/.test(before)) {
          lines.push(`${this.speakId(id)} just finished — it's idle now.`);
        } else if (/error|dead|crashed/.test(status)) {
          lines.push(`${this.speakId(id)} hit a problem.`);
        }
      }
    }
    for (const id of Object.keys(prev.sessions)) {
      if (!(id in now.sessions)) lines.push(`${this.speakId(id)} is gone.`);
    }
    if (now.queue > prev.queue) lines.push(`${now.queue - prev.queue} new item${now.queue - prev.queue > 1 ? 's' : ''} in the queue.`);
    return lines;
  }

  currentMode() {
    if (this.deps.commandRegistry?.workflowMode) return this.deps.commandRegistry.workflowMode;
    try {
      const all = this.deps.userSettingsService?.getAllSettings?.();
      return all?.global?.ui?.workflow?.mode || null;
    } catch {
      return null;
    }
  }

  speakId(id) {
    return String(id).replace(/-/g, ' ');
  }

  tick() {
    const now = this.snapshot();
    if (!now) return;
    if (this.prev) {
      this.pendingLines.push(...this.diff(this.prev, now));
    }
    this.prev = now;

    if (!this.pendingLines.length) return;
    // Background mode means "stop talking to me" unless configured otherwise.
    // The UI persists its mode via user settings (ui.workflow.mode); the voice
    // command path sets commandRegistry.workflowMode. Either source counts.
    if (!this.config.speakInBackgroundMode && this.currentMode() === 'background') {
      this.pendingLines = [];
      return;
    }
    const floorMs = (this.config.minSecondsBetweenUpdates || 30) * 1000;
    if (Date.now() - this.lastSpokenAt < floorMs) return;

    // Everything that accumulated since the last update, one breath.
    const line = this.pendingLines.slice(0, 3).join(' ');
    this.pendingLines = [];
    this.lastSpokenAt = Date.now();
    try {
      this.deps.speechService?.speak?.(line, { priority: 'normal' });
      this.logger.info?.('realtime manager spoke', { line });
    } catch (error) {
      this.logger.warn?.('realtime manager speak failed', { error: error.message });
    }
  }
}

module.exports = RealtimeManagerService;
