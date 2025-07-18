const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class DiffCache {
  constructor() {
    // Ensure cache directory exists
    const cacheDir = path.join(__dirname, '../../cache');
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    // Initialize database
    const dbPath = path.join(cacheDir, 'diffs.db');
    this.db = new Database(dbPath);
    
    // Create tables
    this.initializeTables();
    
    // Prepare statements
    this.prepareStatements();
  }

  initializeTables() {
    // PR/Commit metadata cache
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
      )
    `);

    // Diff analysis cache
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS diffs (
        id TEXT PRIMARY KEY,
        metadata_id TEXT,
        analysis TEXT NOT NULL,
        semantic_reduction REAL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (metadata_id) REFERENCES metadata(id)
      )
    `);

    // User preferences
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS preferences (
        user_id TEXT PRIMARY KEY,
        settings TEXT NOT NULL,
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    // Review state tracking
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS review_state (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pr_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        reviewed BOOLEAN DEFAULT 0,
        marked_at INTEGER DEFAULT (strftime('%s', 'now')),
        notes TEXT,
        UNIQUE(pr_id, file_path)
      )
    `);

    // Review sessions
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS review_sessions (
        session_id TEXT PRIMARY KEY,
        pr_id TEXT NOT NULL,
        started_at INTEGER DEFAULT (strftime('%s', 'now')),
        last_activity INTEGER DEFAULT (strftime('%s', 'now')),
        files_reviewed INTEGER DEFAULT 0,
        total_files INTEGER DEFAULT 0,
        current_file TEXT
      )
    `);

    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_metadata_expires ON metadata(expires_at);
      CREATE INDEX IF NOT EXISTS idx_metadata_repo ON metadata(owner, repo);
      CREATE INDEX IF NOT EXISTS idx_diffs_metadata ON diffs(metadata_id);
    `);
  }

  prepareStatements() {
    // Metadata statements
    this.stmts = {
      getMetadata: this.db.prepare(`
        SELECT * FROM metadata 
        WHERE id = ? AND (expires_at IS NULL OR expires_at > strftime('%s', 'now'))
      `),
      
      setMetadata: this.db.prepare(`
        INSERT OR REPLACE INTO metadata (id, type, owner, repo, number, sha, data, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `),
      
      // Diff statements
      getDiff: this.db.prepare(`
        SELECT * FROM diffs WHERE id = ?
      `),
      
      setDiff: this.db.prepare(`
        INSERT OR REPLACE INTO diffs (id, metadata_id, analysis, semantic_reduction)
        VALUES (?, ?, ?, ?)
      `),
      
      // Cleanup statements
      cleanExpired: this.db.prepare(`
        DELETE FROM metadata WHERE expires_at < strftime('%s', 'now')
      `),
      
      // Stats
      getCacheStats: this.db.prepare(`
        SELECT 
          (SELECT COUNT(*) FROM metadata) as metadata_count,
          (SELECT COUNT(*) FROM diffs) as diff_count,
          (SELECT SUM(LENGTH(data)) FROM metadata) as metadata_size,
          (SELECT SUM(LENGTH(analysis)) FROM diffs) as diff_size
      `),

      // Review state statements
      getReviewState: this.db.prepare(`
        SELECT * FROM review_state 
        WHERE pr_id = ? AND file_path = ?
      `),
      
      setReviewState: this.db.prepare(`
        INSERT OR REPLACE INTO review_state (pr_id, file_path, reviewed, notes)
        VALUES (?, ?, ?, ?)
      `),
      
      getReviewedFiles: this.db.prepare(`
        SELECT file_path FROM review_state 
        WHERE pr_id = ? AND reviewed = 1
      `),
      
      // Review session statements
      getSession: this.db.prepare(`
        SELECT * FROM review_sessions 
        WHERE session_id = ?
      `),
      
      createSession: this.db.prepare(`
        INSERT INTO review_sessions (session_id, pr_id, total_files)
        VALUES (?, ?, ?)
      `),
      
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

  // Get cached PR/commit metadata
  getMetadata(type, owner, repo, numberOrSha) {
    const id = `${type}:${owner}/${repo}/${numberOrSha}`;
    const row = this.stmts.getMetadata.get(id);
    
    if (row) {
      return JSON.parse(row.data);
    }
    return null;
  }

  // Cache PR/commit metadata
  setMetadata(type, owner, repo, numberOrSha, data, ttlMinutes = 5) {
    const id = `${type}:${owner}/${repo}/${numberOrSha}`;
    const expiresAt = Math.floor(Date.now() / 1000) + (ttlMinutes * 60);
    
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

  // Get cached diff analysis
  getDiff(type, owner, repo, numberOrSha) {
    const id = `${type}:${owner}/${repo}/${numberOrSha}`;
    const row = this.stmts.getDiff.get(id);
    
    if (row) {
      return {
        analysis: JSON.parse(row.analysis),
        semanticReduction: row.semantic_reduction
      };
    }
    return null;
  }

  // Cache diff analysis
  setDiff(type, owner, repo, numberOrSha, analysis, semanticReduction) {
    const id = `${type}:${owner}/${repo}/${numberOrSha}`;
    const metadataId = id; // Same ID for simplicity
    
    this.stmts.setDiff.run(
      id,
      metadataId,
      JSON.stringify(analysis),
      semanticReduction
    );
  }

  // Get cache statistics
  getStats() {
    const stats = this.stmts.getCacheStats.get();
    return {
      ...stats,
      totalSize: (stats.metadata_size || 0) + (stats.diff_size || 0),
      totalSizeMB: ((stats.metadata_size || 0) + (stats.diff_size || 0)) / (1024 * 1024)
    };
  }

  // Clean expired entries
  cleanup() {
    const result = this.stmts.cleanExpired.run();
    return result.changes;
  }

  // Close database connection
  close() {
    this.db.close();
  }

  // Review State Methods
  
  /**
   * Get review state for a file
   */
  getFileReviewState(prId, filePath) {
    const row = this.stmts.getReviewState.get(prId, filePath);
    return row ? {
      reviewed: Boolean(row.reviewed),
      markedAt: row.marked_at,
      notes: row.notes
    } : null;
  }

  /**
   * Mark a file as reviewed/unreviewed
   */
  setFileReviewState(prId, filePath, reviewed, notes = null) {
    this.stmts.setReviewState.run(prId, filePath, reviewed ? 1 : 0, notes);
  }

  /**
   * Get all reviewed files for a PR
   */
  getReviewedFiles(prId) {
    const rows = this.stmts.getReviewedFiles.all(prId);
    return rows.map(row => row.file_path);
  }

  /**
   * Get review progress for a PR
   */
  getReviewProgress(prId, totalFiles) {
    const reviewedFiles = this.getReviewedFiles(prId);
    return {
      reviewed: reviewedFiles.length,
      total: totalFiles,
      percentage: totalFiles > 0 ? Math.round((reviewedFiles.length / totalFiles) * 100) : 0,
      files: reviewedFiles
    };
  }

  // Review Session Methods

  /**
   * Create or resume a review session
   */
  createOrResumeSession(prId, totalFiles) {
    const sessionId = `session_${prId}_${Date.now()}`;
    
    // Check for existing recent session (within last hour)
    const existingSession = this.stmts.getLatestSession.get(prId);
    const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;
    
    if (existingSession && existingSession.last_activity > oneHourAgo) {
      // Resume existing session
      return existingSession.session_id;
    }
    
    // Create new session
    this.stmts.createSession.run(sessionId, prId, totalFiles);
    return sessionId;
  }

  /**
   * Update session progress
   */
  updateSessionProgress(sessionId, filesReviewed, currentFile) {
    this.stmts.updateSession.run(filesReviewed, currentFile, sessionId);
  }

  /**
   * Get session details
   */
  getSessionDetails(sessionId) {
    return this.stmts.getSession.get(sessionId);
  }
}

// Create singleton instance
let cacheInstance = null;

module.exports = {
  getCache: () => {
    if (!cacheInstance) {
      cacheInstance = new DiffCache();
    }
    return cacheInstance;
  },
  
  DiffCache
};