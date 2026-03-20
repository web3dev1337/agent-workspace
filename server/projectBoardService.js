const fs = require('fs');
const path = require('path');
const os = require('os');
const { getAgentWorkspaceDir } = require('./utils/pathUtils');

const DEFAULT_COLUMN_ID = 'backlog';
const BOARD_VERSION = 2;

const COLUMN_DEFS = Object.freeze([
  { id: 'archived', label: 'Archive' },
  { id: 'someday', label: 'Maybe One Day' },
  { id: 'backlog', label: 'Backlog' },
  { id: 'active', label: 'Active' },
  { id: 'next', label: 'Ship Next' },
  { id: 'done', label: 'Done' }
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
    const baseDir = dataDirRaw ? path.resolve(dataDirRaw) : getAgentWorkspaceDir();
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
    if (id === 'archive') return 'archived';
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

  normalizeOrderList(value) {
    if (!Array.isArray(value)) return [];
    const out = [];
    const seen = new Set();
    for (const rawKey of value) {
      const key = this.normalizeProjectKey(rawKey);
      if (!key) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
    return out;
  }

  normalizeOrderByColumn(value) {
    if (!value || typeof value !== 'object') return {};
    const out = {};
    for (const [rawColId, rawList] of Object.entries(value)) {
      const colId = this.normalizeColumnId(rawColId);
      if (!colId) continue;
      const list = this.normalizeOrderList(rawList);
      if (!list.length) continue;
      out[colId] = list;
    }
    return out;
  }

  normalizeCollapsedColumnIds(value) {
    if (!Array.isArray(value)) return [];
    const out = [];
    const seen = new Set();
    for (const rawId of value) {
      const colId = this.normalizeColumnId(rawId);
      if (!colId) continue;
      if (seen.has(colId)) continue;
      seen.add(colId);
      out.push(colId);
    }
    return out;
  }

  normalizeTagsByProjectKey(value) {
    if (!value || typeof value !== 'object') return {};
    const out = {};
    for (const [rawKey, rawTags] of Object.entries(value)) {
      const key = this.normalizeProjectKey(rawKey);
      if (!key) continue;
      const tags = rawTags && typeof rawTags === 'object' ? rawTags : {};
      if (tags.live) {
        out[key] = { live: true };
      }
    }
    return out;
  }

  getProjectColumnFromBoard(board, projectKey) {
    const key = this.normalizeProjectKey(projectKey);
    if (!key) return DEFAULT_COLUMN_ID;
    const mapped = board?.projectToColumn && typeof board.projectToColumn === 'object' ? board.projectToColumn[key] : null;
    return this.normalizeColumnId(mapped) || DEFAULT_COLUMN_ID;
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
      version: BOARD_VERSION,
      updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : null,
      projectToColumn: this.normalizeProjectToColumn(parsed?.projectToColumn || {}),
      orderByColumn: this.normalizeOrderByColumn(parsed?.orderByColumn || {}),
      collapsedColumnIds: this.normalizeCollapsedColumnIds(parsed?.collapsedColumnIds || []),
      tagsByProjectKey: this.normalizeTagsByProjectKey(parsed?.tagsByProjectKey || {})
    };

    this.cache = board;
    this.cacheAt = now;
    return board;
  }

  async save(board) {
    const payload = {
      version: BOARD_VERSION,
      updatedAt: new Date().toISOString(),
      projectToColumn: this.normalizeProjectToColumn(board?.projectToColumn || {}),
      orderByColumn: this.normalizeOrderByColumn(board?.orderByColumn || {}),
      collapsedColumnIds: this.normalizeCollapsedColumnIds(board?.collapsedColumnIds || []),
      tagsByProjectKey: this.normalizeTagsByProjectKey(board?.tagsByProjectKey || {})
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

  async moveProject({ projectKey, columnId, orderByColumn } = {}) {
    const key = this.normalizeProjectKey(projectKey);
    if (!key) throw new Error('projectKey is required');

    const col = this.normalizeColumnId(columnId);
    if (!col) throw new Error('columnId is invalid');

    const board = await this.load({ refresh: true });
    const next = {
      ...board,
      projectToColumn: { ...(board?.projectToColumn || {}) },
      orderByColumn: { ...(board?.orderByColumn || {}) }
    };

    if (col === DEFAULT_COLUMN_ID) delete next.projectToColumn[key];
    else next.projectToColumn[key] = col;

    const normalizedPatch = this.normalizeOrderByColumn(orderByColumn || {});
    if (Object.keys(normalizedPatch).length) {
      const merged = { ...(next.orderByColumn || {}) };
      for (const [colId, list] of Object.entries(normalizedPatch)) {
        merged[colId] = list;
      }
      next.orderByColumn = merged;
    }

    const destinationColumn = this.getProjectColumnFromBoard(next, key);
    const cleaned = {};
    for (const [colId, list] of Object.entries(next.orderByColumn || {})) {
      if (!Array.isArray(list)) continue;
      const normalizedColId = this.normalizeColumnId(colId);
      if (!normalizedColId) continue;
      const normalizedList = this.normalizeOrderList(list);
      if (!normalizedList.length) continue;

      if (normalizedColId !== destinationColumn) {
        const withoutKey = normalizedList.filter((k) => k !== key);
        if (withoutKey.length) cleaned[normalizedColId] = withoutKey;
        continue;
      }

      const out = [];
      let sawKey = false;
      for (const item of normalizedList) {
        if (item === key) {
          if (sawKey) continue;
          sawKey = true;
        }
        out.push(item);
      }
      if (!sawKey) out.push(key);
      cleaned[normalizedColId] = out;
    }

    if (!Array.isArray(cleaned[destinationColumn])) cleaned[destinationColumn] = [key];
    else if (!cleaned[destinationColumn].includes(key)) cleaned[destinationColumn].push(key);

    next.orderByColumn = cleaned;

    return await this.save(next);
  }

  async setCollapsedColumnIds(collapsedColumnIds) {
    const board = await this.load({ refresh: true });
    const next = { ...board, collapsedColumnIds: this.normalizeCollapsedColumnIds(collapsedColumnIds || []) };
    return await this.save(next);
  }

  async setProjectLiveTag({ projectKey, live } = {}) {
    const key = this.normalizeProjectKey(projectKey);
    if (!key) throw new Error('projectKey is required');

    const enabled = !!live;
    const board = await this.load({ refresh: true });
    const current = board?.tagsByProjectKey && typeof board.tagsByProjectKey === 'object' ? board.tagsByProjectKey : {};
    const nextTags = { ...current };

    if (enabled) {
      nextTags[key] = { ...(nextTags[key] || {}), live: true };
    } else {
      if (nextTags[key]) {
        const updated = { ...(nextTags[key] || {}) };
        delete updated.live;
        if (Object.keys(updated).length) nextTags[key] = updated;
        else delete nextTags[key];
      }
    }

    return await this.save({ ...board, tagsByProjectKey: nextTags });
  }

  async patchBoard({ collapsedColumnIds, projectKey, live } = {}) {
    const board = await this.load({ refresh: true });
    const next = { ...board };

    if (collapsedColumnIds !== undefined) {
      next.collapsedColumnIds = this.normalizeCollapsedColumnIds(collapsedColumnIds || []);
    }

    if (projectKey !== undefined && live !== undefined) {
      const key = this.normalizeProjectKey(projectKey);
      if (!key) throw new Error('projectKey is required');
      const enabled = !!live;
      const current = next?.tagsByProjectKey && typeof next.tagsByProjectKey === 'object' ? next.tagsByProjectKey : {};
      const nextTags = { ...current };

      if (enabled) {
        nextTags[key] = { ...(nextTags[key] || {}), live: true };
      } else if (nextTags[key]) {
        const updated = { ...(nextTags[key] || {}) };
        delete updated.live;
        if (Object.keys(updated).length) nextTags[key] = updated;
        else delete nextTags[key];
      }

      next.tagsByProjectKey = nextTags;
    }

    return await this.save(next);
  }
}

module.exports = { ProjectBoardService, DEFAULT_COLUMN_ID, COLUMN_DEFS };
