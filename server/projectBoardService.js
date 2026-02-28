const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_COLUMN_ID = 'backlog';

const COLUMN_DEFS = Object.freeze([
  { id: 'backlog', label: 'Backlog' },
  { id: 'active', label: 'Active' },
  { id: 'next', label: 'Ship Next' },
  { id: 'done', label: 'Done' },
  { id: 'archived', label: 'Archived' }
]);

const COLUMN_IDS = new Set(COLUMN_DEFS.map((c) => c.id));

class ProjectBoardService {
  constructor({ logger = console, storePath = null } = {}) {
    this.logger = logger;
    this.storePath = storePath ? path.resolve(String(storePath)) : this.resolveStorePath();
    this.cache = null;
    this.cacheAt = 0;
    this.cacheMs = 15_000;
  }

  static getInstance(options = {}) {
    if (!ProjectBoardService.instance) {
      ProjectBoardService.instance = new ProjectBoardService(options);
    }
    return ProjectBoardService.instance;
  }

  resolveStorePath() {
    const dataDirRaw = String(process.env.ORCHESTRATOR_DATA_DIR || '').trim();
    const baseDir = dataDirRaw ? path.resolve(dataDirRaw) : path.join(os.homedir(), '.orchestrator');
    try {
      if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
    } catch {
      // ignore
    }
    return path.join(baseDir, 'project-board.json');
  }

  getColumns() {
    return COLUMN_DEFS.slice();
  }

  normalizeProjectKey(value) {
    return String(value || '').trim().replace(/\\/g, '/');
  }

  normalizeColumnId(value) {
    const id = String(value || '').trim().toLowerCase();
    if (!id) return null;
    if (!COLUMN_IDS.has(id)) return null;
    return id;
  }

  normalizeProjectToColumn(value) {
    if (!value || typeof value !== 'object') return {};
    const out = {};
    for (const [rawKey, rawCol] of Object.entries(value)) {
      const key = this.normalizeProjectKey(rawKey);
      const col = this.normalizeColumnId(rawCol);
      if (!key || !col || col === DEFAULT_COLUMN_ID) continue;
      out[key] = col;
    }
    return out;
  }

  async load({ refresh = false } = {}) {
    const now = Date.now();
    if (!refresh && this.cache && (now - this.cacheAt) < this.cacheMs) return this.cache;

    let parsed = null;
    try {
      if (fs.existsSync(this.storePath)) {
        const raw = await fs.promises.readFile(this.storePath, 'utf8');
        parsed = JSON.parse(raw);
      }
    } catch (error) {
      this.logger.warn?.('Failed to load project board', { error: error.message, path: this.storePath });
      parsed = null;
    }

    const board = {
      version: 1,
      updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : null,
      projectToColumn: this.normalizeProjectToColumn(parsed?.projectToColumn || {})
    };

    this.cache = board;
    this.cacheAt = now;
    return board;
  }

  async save(board) {
    const payload = {
      version: 1,
      updatedAt: new Date().toISOString(),
      projectToColumn: this.normalizeProjectToColumn(board?.projectToColumn || {})
    };

    const dir = path.dirname(this.storePath);
    await fs.promises.mkdir(dir, { recursive: true });
    const tmp = `${this.storePath}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(payload, null, 2));
    await fs.promises.rename(tmp, this.storePath);

    this.cache = payload;
    this.cacheAt = Date.now();
    return payload;
  }

  async moveProject({ projectKey, columnId } = {}) {
    const key = this.normalizeProjectKey(projectKey);
    if (!key) throw new Error('projectKey is required');

    const col = this.normalizeColumnId(columnId);
    if (!col) throw new Error('columnId is invalid');

    const board = await this.load({ refresh: true });
    const next = { ...board, projectToColumn: { ...(board?.projectToColumn || {}) } };

    if (col === DEFAULT_COLUMN_ID) delete next.projectToColumn[key];
    else next.projectToColumn[key] = col;

    return await this.save(next);
  }
}

module.exports = { ProjectBoardService, DEFAULT_COLUMN_ID, COLUMN_DEFS };

