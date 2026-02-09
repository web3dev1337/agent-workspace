const fs = require('fs');
const path = require('path');
const os = require('os');

class ThreadService {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this.workspaceManager = null;
    this.sessionManager = null;
    this.storePath = this.resolveStorePath();
    this.threads = [];
    this.loaded = false;
  }

  static getInstance(options = {}) {
    if (!ThreadService.instance) {
      ThreadService.instance = new ThreadService(options);
    }
    return ThreadService.instance;
  }

  resolveStorePath() {
    const dataDirRaw = String(process.env.ORCHESTRATOR_DATA_DIR || '').trim();
    const baseDir = dataDirRaw ? path.resolve(dataDirRaw) : path.join(os.homedir(), '.orchestrator');
    try {
      if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
    } catch {
      // ignore
    }
    return path.join(baseDir, 'threads.json');
  }

  init({ workspaceManager, sessionManager } = {}) {
    this.workspaceManager = workspaceManager || this.workspaceManager;
    this.sessionManager = sessionManager || this.sessionManager;
    this.ensureLoaded();
  }

  ensureLoaded() {
    if (this.loaded) return;
    this.loaded = true;
    this.loadFromDisk();
  }

  safeIso(value, fallback) {
    const input = String(value || '').trim();
    if (!input) return fallback;
    const parsed = Date.parse(input);
    if (!Number.isFinite(parsed)) return fallback;
    return new Date(parsed).toISOString();
  }

  normalizeId(raw) {
    return String(raw || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  normalizeStatus(raw) {
    const status = String(raw || '').trim().toLowerCase();
    if (status === 'closed' || status === 'archived') return status;
    return 'active';
  }

  normalizeSessionIds(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const item of raw) {
      const id = String(item || '').trim();
      if (!id || out.includes(id)) continue;
      out.push(id);
    }
    return out;
  }

  normalizeThread(thread, index = 0) {
    if (!thread || typeof thread !== 'object') return null;

    const createdAt = this.safeIso(thread.createdAt, new Date().toISOString());
    const updatedAt = this.safeIso(thread.updatedAt, createdAt);
    const lastActivityAt = this.safeIso(thread.lastActivityAt, updatedAt);
    const id = this.normalizeId(thread.id || `thread-${index + 1}`);
    if (!id) return null;

    const workspaceId = String(thread.workspaceId || thread.projectId || '').trim();
    if (!workspaceId) return null;

    return {
      id,
      workspaceId,
      projectId: String(thread.projectId || workspaceId).trim() || workspaceId,
      title: String(thread.title || `${thread.repositoryName || workspaceId}/${thread.worktreeId || 'chat'}`).trim(),
      worktreeId: String(thread.worktreeId || '').trim() || null,
      worktreePath: String(thread.worktreePath || '').trim() || null,
      sessionIds: this.normalizeSessionIds(thread.sessionIds),
      provider: String(thread.provider || 'claude').trim().toLowerCase() || 'claude',
      status: this.normalizeStatus(thread.status),
      repositoryName: String(thread.repositoryName || '').trim() || null,
      repositoryPath: String(thread.repositoryPath || '').trim() || null,
      repositoryType: String(thread.repositoryType || '').trim() || null,
      metadata: (thread.metadata && typeof thread.metadata === 'object') ? thread.metadata : {},
      createdAt,
      updatedAt,
      lastActivityAt
    };
  }

  loadFromDisk() {
    try {
      if (!fs.existsSync(this.storePath)) {
        this.threads = [];
        return;
      }
      const raw = fs.readFileSync(this.storePath, 'utf8');
      const parsed = JSON.parse(raw);
      const rows = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.threads) ? parsed.threads : []);
      this.threads = rows.map((item, index) => this.normalizeThread(item, index)).filter(Boolean);
      this.logger.info?.('Loaded threads', { count: this.threads.length, path: this.storePath });
    } catch (error) {
      this.logger.error?.('Failed to load threads', { error: error.message, path: this.storePath });
      this.threads = [];
    }
  }

  persist() {
    const payload = {
      version: 1,
      updatedAt: new Date().toISOString(),
      threads: this.threads
    };
    const dir = path.dirname(this.storePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.storePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
    fs.renameSync(tmp, this.storePath);
  }

  list({ workspaceId, status, includeArchived = false } = {}) {
    this.ensureLoaded();
    const ws = String(workspaceId || '').trim();
    const normalizedStatus = String(status || '').trim().toLowerCase();

    return this.threads
      .filter((thread) => {
        if (ws && thread.workspaceId !== ws) return false;
        if (!includeArchived && !normalizedStatus && thread.status === 'archived') return false;
        if (normalizedStatus && normalizedStatus !== 'all' && thread.status !== normalizedStatus) return false;
        return true;
      })
      .slice()
      .sort((a, b) => Date.parse(String(b.lastActivityAt || b.updatedAt || 0)) - Date.parse(String(a.lastActivityAt || a.updatedAt || 0)));
  }

  getById(threadId) {
    this.ensureLoaded();
    const id = this.normalizeId(threadId);
    if (!id) return null;
    return this.threads.find((thread) => thread.id === id) || null;
  }

  allocateId(base) {
    const root = this.normalizeId(base) || `thread-${Date.now()}`;
    let candidate = root;
    let idx = 2;
    while (this.threads.some((thread) => thread.id === candidate)) {
      candidate = `${root}-${idx}`;
      idx += 1;
    }
    return candidate;
  }

  createThread(input = {}) {
    this.ensureLoaded();
    const workspaceId = String(input.workspaceId || '').trim();
    if (!workspaceId) throw new Error('workspaceId is required');

    const worktreeId = String(input.worktreeId || '').trim();
    const requestedRepoPath = String(input.repositoryPath || '').trim();
    const requestedRepoName = String(input.repositoryName || '').trim().toLowerCase();
    const matchesRepository = (thread) => {
      const threadRepoPath = String(thread?.repositoryPath || '').trim();
      const threadRepoName = String(thread?.repositoryName || '').trim().toLowerCase();
      if (requestedRepoPath && threadRepoPath) return threadRepoPath === requestedRepoPath;
      if (requestedRepoName && threadRepoName) return threadRepoName === requestedRepoName;
      if (requestedRepoPath || requestedRepoName) return false;
      return true;
    };
    const existingActive = this.threads.find((thread) =>
      thread.workspaceId === workspaceId
      && thread.worktreeId === worktreeId
      && matchesRepository(thread)
      && thread.status === 'active'
    );
    if (existingActive) {
      return existingActive;
    }

    const now = new Date().toISOString();
    const baseId = input.id || `${workspaceId}-${worktreeId || 'chat'}-${Date.now()}`;
    const normalized = this.normalizeThread({
      ...input,
      id: this.allocateId(baseId),
      status: input.status || 'active',
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now
    }, this.threads.length);

    if (!normalized) throw new Error('Invalid thread payload');
    this.threads.push(normalized);
    this.persist();
    return normalized;
  }

  updateThread(threadId, patch = {}) {
    this.ensureLoaded();
    const id = this.normalizeId(threadId);
    if (!id) throw new Error('threadId is required');
    const index = this.threads.findIndex((thread) => thread.id === id);
    if (index < 0) throw new Error(`Thread not found: ${id}`);

    const current = this.threads[index];
    const now = new Date().toISOString();
    const next = this.normalizeThread({
      ...current,
      ...patch,
      id: current.id,
      workspaceId: current.workspaceId,
      projectId: current.projectId,
      updatedAt: now,
      lastActivityAt: patch.lastActivityAt || now
    }, index);

    if (!next) throw new Error('Invalid thread update');
    this.threads[index] = next;
    this.persist();
    return next;
  }

  setSessionIds(threadId, sessionIds = []) {
    return this.updateThread(threadId, { sessionIds: this.normalizeSessionIds(sessionIds) });
  }

  closeThread(threadId) {
    return this.updateThread(threadId, { status: 'closed' });
  }

  archiveThread(threadId) {
    return this.updateThread(threadId, { status: 'archived' });
  }
}

module.exports = { ThreadService };
