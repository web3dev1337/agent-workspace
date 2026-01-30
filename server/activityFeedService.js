const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/activity.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

const DEFAULT_DIR = path.join(os.homedir(), '.orchestrator');
const DEFAULT_FILE = path.join(DEFAULT_DIR, 'activity.jsonl');
const DEFAULT_MAX_EVENTS = 500;

function safeJsonLine(obj) {
  try {
    return `${JSON.stringify(obj)}\n`;
  } catch {
    return null;
  }
}

function clampInt(n, { min, max, fallback }) {
  const v = Number.parseInt(String(n || ''), 10);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, v));
}

class ActivityFeedService {
  constructor({ filePath = DEFAULT_FILE, maxEvents = DEFAULT_MAX_EVENTS } = {}) {
    this.filePath = filePath;
    this.maxEvents = maxEvents;
    this.events = [];
    this.io = null;
    this._loaded = false;
  }

  static getInstance() {
    if (!ActivityFeedService.instance) {
      ActivityFeedService.instance = new ActivityFeedService();
    }
    return ActivityFeedService.instance;
  }

  setIO(io) {
    this.io = io || null;
  }

  async ensureLoaded() {
    if (this._loaded) return;
    this._loaded = true;
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      // Do not load entire history into memory; keep v1 in-memory only.
      // Existence is enough to ensure appends won't throw due to missing dir.
    } catch (error) {
      logger.warn('Failed to ensure activity dir exists', { error: error.message });
    }
  }

  list({ since = 0, limit = 200 } = {}) {
    const sinceMs = Number.isFinite(Number(since)) ? Number(since) : 0;
    const lim = clampInt(limit, { min: 1, max: 1000, fallback: 200 });
    const items = this.events
      .filter(e => (e?.ts || 0) >= sinceMs)
      .slice(-lim);
    // Return newest-first for UI convenience
    return items.reverse();
  }

  track(kind, data = {}) {
    const k = String(kind || '').trim();
    if (!k) return null;

    const ts = Date.now();
    const event = {
      id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
      ts,
      kind: k,
      data: data && typeof data === 'object' ? data : { value: data }
    };

    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }

    this.ensureLoaded().then(async () => {
      const line = safeJsonLine(event);
      if (!line) return;
      try {
        await fs.appendFile(this.filePath, line, 'utf8');
      } catch (error) {
        logger.warn('Failed to append activity event', { error: error.message, kind: k });
      }
    });

    try {
      this.io?.emit?.('activity-event', event);
    } catch {
      // ignore
    }

    return event;
  }
}

module.exports = { ActivityFeedService };

