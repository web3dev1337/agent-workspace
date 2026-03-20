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

const { getAgentWorkspaceDir } = require('./utils/pathUtils');
const DEFAULT_DIR = getAgentWorkspaceDir();
const DEFAULT_FILE = path.join(DEFAULT_DIR, 'activity.jsonl');
const DEFAULT_MAX_EVENTS = 500;
const DEFAULT_LOAD_MAX_BYTES = 1024 * 1024; // 1MB tail read

function safeJsonLine(obj) {
  try {
    return `${JSON.stringify(obj)}\n`;
  } catch {
    return null;
  }
}

function safeJsonParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function clampInt(n, { min, max, fallback }) {
  const v = Number.parseInt(String(n || ''), 10);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, v));
}

function dedupeByIdKeepLast(items) {
  const seen = new Set();
  const out = [];
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const ev = items[i];
    const id = ev?.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(ev);
  }
  out.reverse();
  return out;
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
      await this.loadRecentFromDisk();
    } catch (error) {
      logger.warn('Failed to ensure activity dir exists', { error: error.message });
    }
  }

  async loadRecentFromDisk({ maxBytes = DEFAULT_LOAD_MAX_BYTES } = {}) {
    const byteBudget = clampInt(maxBytes, { min: 16 * 1024, max: 10 * 1024 * 1024, fallback: DEFAULT_LOAD_MAX_BYTES });
    try {
      const stat = await fs.stat(this.filePath);
      const size = Number(stat.size) || 0;
      if (!size) return;

      const start = Math.max(0, size - byteBudget);
      const length = Math.max(0, size - start);
      if (!length) return;

      const handle = await fs.open(this.filePath, 'r');
      try {
        const buf = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buf, 0, length, start);
        const text = buf.toString('utf8', 0, bytesRead);
        let lines = text.split('\n').filter(Boolean);
        // If we started mid-file, first line may be partial; drop it.
        if (start > 0 && lines.length > 0) {
          lines = lines.slice(1);
        }

        const parsed = [];
        for (const line of lines) {
          const ev = safeJsonParse(line);
          if (!ev || typeof ev !== 'object') continue;
          if (!ev.id || !ev.kind || !ev.ts) continue;
          parsed.push(ev);
        }

        const merged = dedupeByIdKeepLast([...parsed, ...this.events]);
        this.events = merged.slice(-this.maxEvents);
      } finally {
        await handle.close();
      }
    } catch (error) {
      // If the file doesn't exist, that's fine. Any other errors should be logged but not fatal.
      if (String(error?.code || '') !== 'ENOENT') {
        logger.warn('Failed to load activity history from disk', { error: error.message });
      }
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
