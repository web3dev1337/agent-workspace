const path = require('path');
const fs = require('fs');

function ensureCacheDir() {
  const cacheDir = path.join(__dirname, '../../cache');
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  return cacheDir;
}

let BetterSqlite = null;
try {
  // Prefer better-sqlite3 (sync). Falls back to in-memory cache if native module isn't compatible.
  // NOTE: This commonly fails when Node major versions change and native modules need rebuild.
  // We handle that gracefully so the diff viewer still works.
  const TestDB = require('better-sqlite3');
  const test = new TestDB(':memory:');
  test.close();
  BetterSqlite = TestDB;
  console.log('Using better-sqlite3 (synchronous)');
} catch (error) {
  console.warn('better-sqlite3 unavailable; using in-memory cache:', error.message);
}

class MemoryDiffCache {
  constructor() {
    this.metadata = new Map(); // id -> { data, expiresAt }
    this.diffs = new Map(); // id -> { analysis, semanticReduction }
    this.reviewState = new Map(); // `${prId}::${filePath}` -> { reviewed, markedAt, notes }
    this.sessions = new Map(); // sessionId -> session object
  }

  makeId(type, owner, repo, numberOrSha) {
    return `${type}:${owner}/${repo}/${numberOrSha}`;
  }

  nowSeconds() {
    return Math.floor(Date.now() / 1000);
  }

  // Metadata cache
  getMetadata(type, owner, repo, numberOrSha) {
    const id = this.makeId(type, owner, repo, numberOrSha);
    const entry = this.metadata.get(id);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt <= this.nowSeconds()) {
      this.metadata.delete(id);
      return null;
    }
    return entry.data;
  }

  setMetadata(type, owner, repo, numberOrSha, data, ttlMinutes = 5) {
    const id = this.makeId(type, owner, repo, numberOrSha);
    const expiresAt = this.nowSeconds() + ttlMinutes * 60;
    this.metadata.set(id, { data, expiresAt });
    return id;
  }

  // Diff cache
  getDiff(type, owner, repo, numberOrSha) {
    const id = this.makeId(type, owner, repo, numberOrSha);
    const entry = this.diffs.get(id);
    if (!entry) return null;
    return {
      analysis: entry.analysis,
      semanticReduction: entry.semanticReduction
    };
  }

  setDiff(type, owner, repo, numberOrSha, analysis, semanticReduction) {
    const id = this.makeId(type, owner, repo, numberOrSha);
    this.diffs.set(id, { analysis, semanticReduction });
  }

  // Stats / cleanup
  getStats() {
    const metadataStrings = Array.from(this.metadata.values()).map(v => JSON.stringify(v.data) || '');
    const diffStrings = Array.from(this.diffs.values()).map(v => JSON.stringify(v.analysis) || '');

    const metadataSize = metadataStrings.reduce((acc, s) => acc + s.length, 0);
    const diffSize = diffStrings.reduce((acc, s) => acc + s.length, 0);

    return {
      metadata_count: this.metadata.size,
      diff_count: this.diffs.size,
      metadata_size: metadataSize,
      diff_size: diffSize,
      totalSize: metadataSize + diffSize,
      totalSizeMB: (metadataSize + diffSize) / (1024 * 1024)
    };
  }

  cleanup() {
    const now = this.nowSeconds();
    let deleted = 0;
    for (const [id, entry] of this.metadata.entries()) {
      if (entry.expiresAt && entry.expiresAt <= now) {
        this.metadata.delete(id);
        deleted += 1;
      }
    }
    return deleted;
  }

  close() {
    // no-op for memory cache
  }

  // Review state
  getFileReviewState(prId, filePath) {
    const key = `${prId}::${filePath}`;
    const row = this.reviewState.get(key);
    return row
      ? {
          reviewed: Boolean(row.reviewed),
          markedAt: row.markedAt,
          notes: row.notes ?? null
        }
      : null;
  }

  setFileReviewState(prId, filePath, reviewed, notes = null) {
    const key = `${prId}::${filePath}`;
    this.reviewState.set(key, {
      reviewed: reviewed ? 1 : 0,
      markedAt: this.nowSeconds(),
      notes
    });
  }

  getReviewedFiles(prId) {
    const out = [];
    for (const [key, row] of this.reviewState.entries()) {
      if (!key.startsWith(`${prId}::`)) continue;
      if (row.reviewed) {
        out.push(key.slice(`${prId}::`.length));
      }
    }
    return out;
  }

  getReviewProgress(prId, totalFiles) {
    const reviewedFiles = this.getReviewedFiles(prId);
    return {
      reviewed: reviewedFiles.length,
      total: totalFiles,
      percentage: totalFiles > 0 ? Math.round((reviewedFiles.length / totalFiles) * 100) : 0,
      files: reviewedFiles
    };
  }

  // Review sessions
  createOrResumeSession(prId, totalFiles) {
    const oneHourAgo = this.nowSeconds() - 3600;
    let latest = null;

    for (const session of this.sessions.values()) {
      if (session.pr_id !== prId) continue;
      if (session.last_activity > oneHourAgo) {
        if (!latest || session.last_activity > latest.last_activity) {
          latest = session;
        }
      }
    }

    if (latest) return latest.session_id;

    const sessionId = `session_${prId}_${Date.now()}`;
    const now = this.nowSeconds();
    this.sessions.set(sessionId, {
      session_id: sessionId,
      pr_id: prId,
      started_at: now,
      last_activity: now,
      files_reviewed: 0,
      total_files: totalFiles || 0,
      current_file: null
    });
    return sessionId;
  }

  updateSessionProgress(sessionId, filesReviewed, currentFile) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.last_activity = this.nowSeconds();
    session.files_reviewed = filesReviewed || 0;
    session.current_file = currentFile || null;
  }

  getSessionDetails(sessionId) {
    return this.sessions.get(sessionId) || null;
  }
}

class DiffCache {
  constructor() {
    ensureCacheDir();
    const dbPath = path.join(__dirname, '../../cache/diffs.db');
    this.db = new BetterSqlite(dbPath);
    this.initializeTables();
    this.prepareStatements();
  }

  initializeTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        owner TEXT NOT NULL,
        repo TEXT NOT NULL,
        number INTEGER,
        sha TEXT,
        data TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        expires_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS diffs (
        id TEXT PRIMARY KEY,
        metadata_id TEXT,
        analysis TEXT NOT NULL,
        semantic_reduction REAL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (metadata_id) REFERENCES metadata(id)
      );
      CREATE TABLE IF NOT EXISTS preferences (
        user_id TEXT PRIMARY KEY,
        settings TEXT NOT NULL,
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      );
      CREATE TABLE IF NOT EXISTS review_state (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pr_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        reviewed BOOLEAN DEFAULT 0,
        marked_at INTEGER DEFAULT (strftime('%s', 'now')),
        notes TEXT,
        UNIQUE(pr_id, file_path)
      );
      CREATE TABLE IF NOT EXISTS review_sessions (
        session_id TEXT PRIMARY KEY,
        pr_id TEXT NOT NULL,
        started_at INTEGER DEFAULT (strftime('%s', 'now')),
        last_activity INTEGER DEFAULT (strftime('%s', 'now')),
        files_reviewed INTEGER DEFAULT 0,
        total_files INTEGER DEFAULT 0,
        current_file TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_metadata_expires ON metadata(expires_at);
      CREATE INDEX IF NOT EXISTS idx_metadata_repo ON metadata(owner, repo);
      CREATE INDEX IF NOT EXISTS idx_diffs_metadata ON diffs(metadata_id);
    `);
  }

  prepareStatements() {
    this.stmts = {
      getMetadata: this.db.prepare(`
        SELECT * FROM metadata
        WHERE id = ? AND (expires_at IS NULL OR expires_at > strftime('%s', 'now'))
      `),
      setMetadata: this.db.prepare(`
        INSERT OR REPLACE INTO metadata (id, type, owner, repo, number, sha, data, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `),
      getDiff: this.db.prepare(`SELECT * FROM diffs WHERE id = ?`),
      setDiff: this.db.prepare(`
        INSERT OR REPLACE INTO diffs (id, metadata_id, analysis, semantic_reduction)
        VALUES (?, ?, ?, ?)
      `),
      cleanExpired: this.db.prepare(`DELETE FROM metadata WHERE expires_at < strftime('%s', 'now')`),
      getCacheStats: this.db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM metadata) as metadata_count,
          (SELECT COUNT(*) FROM diffs) as diff_count,
          (SELECT SUM(LENGTH(data)) FROM metadata) as metadata_size,
          (SELECT SUM(LENGTH(analysis)) FROM diffs) as diff_size
      `),
      getReviewState: this.db.prepare(`SELECT * FROM review_state WHERE pr_id = ? AND file_path = ?`),
      setReviewState: this.db.prepare(`
        INSERT OR REPLACE INTO review_state (pr_id, file_path, reviewed, notes)
        VALUES (?, ?, ?, ?)
      `),
      getReviewedFiles: this.db.prepare(`SELECT file_path FROM review_state WHERE pr_id = ? AND reviewed = 1`),
      getSession: this.db.prepare(`SELECT * FROM review_sessions WHERE session_id = ?`),
      createSession: this.db.prepare(`INSERT INTO review_sessions (session_id, pr_id, total_files) VALUES (?, ?, ?)`),
      updateSession: this.db.prepare(`
        UPDATE review_sessions
        SET last_activity = strftime('%s', 'now'),
            files_reviewed = ?,
            current_file = ?
        WHERE session_id = ?
      `),
      getLatestSession: this.db.prepare(`
        SELECT * FROM review_sessions
        WHERE pr_id = ?
        ORDER BY last_activity DESC
        LIMIT 1
      `)
    };
  }

  makeId(type, owner, repo, numberOrSha) {
    return `${type}:${owner}/${repo}/${numberOrSha}`;
  }

  getMetadata(type, owner, repo, numberOrSha) {
    const id = this.makeId(type, owner, repo, numberOrSha);
    const row = this.stmts.getMetadata.get(id);
    if (!row) return null;

    try {
      return JSON.parse(row.data);
    } catch (error) {
      console.warn('Invalid cached metadata JSON, ignoring cache entry', { id, error: error.message });
      return null;
    }
  }

  setMetadata(type, owner, repo, numberOrSha, data, ttlMinutes = 5) {
    if (data === undefined) {
      throw new Error('Refusing to cache undefined metadata');
    }
    const id = this.makeId(type, owner, repo, numberOrSha);
    const expiresAt = Math.floor(Date.now() / 1000) + ttlMinutes * 60;
    this.stmts.setMetadata.run(
      id,
      type,
      owner,
      repo,
      type === 'pr' ? numberOrSha : null,
      type === 'commit' ? numberOrSha : null,
      JSON.stringify(data),
      expiresAt
    );
    return id;
  }

  getDiff(type, owner, repo, numberOrSha) {
    const id = this.makeId(type, owner, repo, numberOrSha);
    const row = this.stmts.getDiff.get(id);
    if (!row) return null;
    try {
      return { analysis: JSON.parse(row.analysis), semanticReduction: row.semantic_reduction };
    } catch (error) {
      console.warn('Invalid cached diff JSON, ignoring cache entry', { id, error: error.message });
      return null;
    }
  }

  setDiff(type, owner, repo, numberOrSha, analysis, semanticReduction) {
    const id = this.makeId(type, owner, repo, numberOrSha);
    const metadataId = id;
    this.stmts.setDiff.run(id, metadataId, JSON.stringify(analysis), semanticReduction);
  }

  getStats() {
    const stats = this.stmts.getCacheStats.get();
    return {
      ...stats,
      totalSize: (stats.metadata_size || 0) + (stats.diff_size || 0),
      totalSizeMB: ((stats.metadata_size || 0) + (stats.diff_size || 0)) / (1024 * 1024)
    };
  }

  cleanup() {
    const result = this.stmts.cleanExpired.run();
    return result.changes;
  }

  close() {
    this.db.close();
  }

  // Review state methods
  getFileReviewState(prId, filePath) {
    const row = this.stmts.getReviewState.get(prId, filePath);
    return row
      ? { reviewed: Boolean(row.reviewed), markedAt: row.marked_at, notes: row.notes }
      : null;
  }

  setFileReviewState(prId, filePath, reviewed, notes = null) {
    this.stmts.setReviewState.run(prId, filePath, reviewed ? 1 : 0, notes);
  }

  getReviewedFiles(prId) {
    const rows = this.stmts.getReviewedFiles.all(prId);
    return rows.map(r => r.file_path);
  }

  getReviewProgress(prId, totalFiles) {
    const reviewedFiles = this.getReviewedFiles(prId);
    return {
      reviewed: reviewedFiles.length,
      total: totalFiles,
      percentage: totalFiles > 0 ? Math.round((reviewedFiles.length / totalFiles) * 100) : 0,
      files: reviewedFiles
    };
  }

  createOrResumeSession(prId, totalFiles) {
    const sessionId = `session_${prId}_${Date.now()}`;
    const existingSession = this.stmts.getLatestSession.get(prId);
    const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;

    if (existingSession && existingSession.last_activity > oneHourAgo) {
      return existingSession.session_id;
    }

    this.stmts.createSession.run(sessionId, prId, totalFiles);
    return sessionId;
  }

  updateSessionProgress(sessionId, filesReviewed, currentFile) {
    this.stmts.updateSession.run(filesReviewed, currentFile, sessionId);
  }

  getSessionDetails(sessionId) {
    return this.stmts.getSession.get(sessionId);
  }
}

const CacheImpl = BetterSqlite ? DiffCache : MemoryDiffCache;
let cacheInstance = null;

module.exports = {
  getCache: () => {
    if (!cacheInstance) {
      cacheInstance = new CacheImpl();
    }
    return cacheInstance;
  },
  DiffCache: CacheImpl
};

