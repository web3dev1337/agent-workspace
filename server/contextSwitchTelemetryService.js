'use strict';

const fs = require('fs');
const path = require('path');
const winston = require('winston');

const { getAgentWorkspaceDir } = require('./utils/pathUtils');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: path.join(process.cwd(), 'logs', 'context-telemetry.log'), maxsize: 1_000_000, maxFiles: 1 })
  ]
});

// Local-only context-switch log (JSONL). The research's Context Tax law:
// each switch costs 5-15 minutes of refocus time (10 used as the default
// estimator here). Nothing leaves the machine.

const EVENT_TYPES = new Set([
  'worktree-focus',
  'workspace-switch',
  'workflow-mode',
  'review-start',
  'review-end',
  'panel-open'
]);

const DEFAULT_COST_MINUTES = 10;
const MAX_FILE_BYTES = 5_000_000;

class ContextSwitchTelemetryService {
  constructor({ filePath, costMinutesPerSwitch } = {}) {
    this.filePath = filePath || path.join(getAgentWorkspaceDir(), 'telemetry', 'context-switches.jsonl');
    this.costMinutesPerSwitch = Number(costMinutesPerSwitch) > 0 ? Number(costMinutesPerSwitch) : DEFAULT_COST_MINUTES;
    this._lastEventByType = new Map();
  }

  static getInstance(deps = {}) {
    if (!ContextSwitchTelemetryService.instance) {
      ContextSwitchTelemetryService.instance = new ContextSwitchTelemetryService(deps);
    }
    return ContextSwitchTelemetryService.instance;
  }

  track({ type, from, to, meta } = {}) {
    const t = String(type || '').trim().toLowerCase();
    if (!EVENT_TYPES.has(t)) {
      return { ok: false, error: `Unknown event type: ${t}` };
    }

    const event = {
      at: new Date().toISOString(),
      type: t,
      from: String(from || '').slice(0, 300) || null,
      to: String(to || '').slice(0, 300) || null
    };
    if (meta && typeof meta === 'object') {
      event.meta = JSON.parse(JSON.stringify(meta));
    }

    // De-bounce identical repeats within 5s (double-fired UI handlers).
    const last = this._lastEventByType.get(t);
    if (last && last.to === event.to && last.from === event.from
        && Date.now() - Date.parse(last.at) < 5_000) {
      return { ok: true, deduped: true };
    }
    this._lastEventByType.set(t, event);

    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      this._rotateIfNeeded();
      fs.appendFileSync(this.filePath, JSON.stringify(event) + '\n');
      return { ok: true };
    } catch (e) {
      logger.warn('Failed to append context-switch event', { error: e.message });
      return { ok: false, error: e.message };
    }
  }

  _rotateIfNeeded() {
    try {
      const stat = fs.existsSync(this.filePath) ? fs.statSync(this.filePath) : null;
      if (stat && stat.size > MAX_FILE_BYTES) {
        fs.renameSync(this.filePath, `${this.filePath}.1`);
      }
    } catch {
      // rotation is best-effort
    }
  }

  _readEvents({ sinceMs } = {}) {
    const events = [];
    try {
      if (!fs.existsSync(this.filePath)) return events;
      const lines = fs.readFileSync(this.filePath, 'utf8').split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          const at = Date.parse(event.at || '') || 0;
          if (sinceMs && at < sinceMs) continue;
          events.push(event);
        } catch {
          // skip malformed lines
        }
      }
    } catch (e) {
      logger.warn('Failed to read context-switch events', { error: e.message });
    }
    return events;
  }

  getSummary({ hours = 24 } = {}) {
    const h = Math.min(24 * 30, Math.max(1, Number(hours) || 24));
    const sinceMs = Date.now() - h * 3_600_000;
    const events = this._readEvents({ sinceMs });

    // Only actual context CHANGES count toward the tax, not review timers.
    const switchTypes = new Set(['worktree-focus', 'workspace-switch', 'workflow-mode', 'panel-open']);
    const switches = events.filter(e => switchTypes.has(e.type) && e.from !== e.to);

    const byType = {};
    for (const e of events) {
      byType[e.type] = (byType[e.type] || 0) + 1;
    }

    const pairCounts = new Map();
    for (const e of switches) {
      if (!e.from || !e.to) continue;
      const key = `${e.from} → ${e.to}`;
      pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
    }
    const topPairs = [...pairCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([pair, count]) => ({ pair, count }));

    // Review focus time from paired review-start/review-end events.
    let reviewMinutes = 0;
    let openStart = null;
    for (const e of events) {
      if (e.type === 'review-start') openStart = Date.parse(e.at) || null;
      else if (e.type === 'review-end' && openStart) {
        reviewMinutes += Math.max(0, (Date.parse(e.at) - openStart) / 60000);
        openStart = null;
      }
    }

    return {
      hours: h,
      totalEvents: events.length,
      switches: switches.length,
      estimatedCostMinutes: Math.round(switches.length * this.costMinutesPerSwitch),
      costMinutesPerSwitch: this.costMinutesPerSwitch,
      byType,
      topPairs,
      reviewMinutes: Math.round(reviewMinutes)
    };
  }
}

module.exports = { ContextSwitchTelemetryService };
