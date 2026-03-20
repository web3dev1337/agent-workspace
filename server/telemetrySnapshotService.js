const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const winston = require('winston');

const { getAgentWorkspaceDir } = require('./utils/pathUtils');
const DEFAULT_DIR = path.join(getAgentWorkspaceDir(), 'telemetry-snapshots');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/telemetry-snapshots.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

const sanitizeId = (raw) => {
  const id = String(raw || '').trim();
  if (!id) return null;
  if (!/^[a-zA-Z0-9_-]{6,80}$/.test(id)) return null;
  return id;
};

class TelemetrySnapshotService {
  constructor({ dirPath } = {}) {
    this.dirPath = dirPath || DEFAULT_DIR;
  }

  static getInstance(deps = {}) {
    if (!TelemetrySnapshotService.instance) {
      TelemetrySnapshotService.instance = new TelemetrySnapshotService(deps);
    }
    return TelemetrySnapshotService.instance;
  }

  async ensureDir() {
    await fs.mkdir(this.dirPath, { recursive: true });
  }

  _snapshotPath(id) {
    const safe = sanitizeId(id);
    if (!safe) throw new Error('Invalid snapshot id');
    return path.join(this.dirPath, `${safe}.json`);
  }

  _createId() {
    try {
      if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
      }
    } catch {
      // fall through
    }
    return crypto.randomBytes(16).toString('hex');
  }

  async create({ kind = 'telemetry_details', params = {}, data = {} } = {}) {
    await this.ensureDir();
    const createdAt = new Date().toISOString();
    const id = this._createId();
    const filePath = this._snapshotPath(id);

    const payload = {
      id,
      kind: String(kind || 'telemetry_details'),
      createdAt,
      params: params && typeof params === 'object' ? params : {},
      data
    };

    await fs.writeFile(filePath, JSON.stringify(payload, null, 2) + '\n');
    return { id, createdAt };
  }

  async get(id) {
    const filePath = this._snapshotPath(id);
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed;
  }

  list({ limit = 50 } = {}) {
    try {
      if (!fsSync.existsSync(this.dirPath)) return [];
      const entries = fsSync.readdirSync(this.dirPath, { withFileTypes: true });
      const items = entries
        .filter((e) => e.isFile() && e.name.endsWith('.json'))
        .map((e) => {
          const id = e.name.slice(0, -'.json'.length);
          const safe = sanitizeId(id);
          if (!safe) return null;
          const filePath = path.join(this.dirPath, e.name);
          let st = null;
          try { st = fsSync.statSync(filePath); } catch {}
          return {
            id: safe,
            updatedAt: st ? new Date(st.mtimeMs).toISOString() : null
          };
        })
        .filter(Boolean)
        .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));

      const lim = Number(limit);
      const safeLimit = Number.isFinite(lim) ? Math.max(1, Math.min(200, Math.round(lim))) : 50;
      return items.slice(0, safeLimit);
    } catch (error) {
      logger.warn('Failed to list telemetry snapshots', { error: error.message });
      return [];
    }
  }
}

module.exports = { TelemetrySnapshotService };

