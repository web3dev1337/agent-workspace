/**
 * ConversationService - Index and search local conversations (Claude Code + Codex CLI)
 *
 * Scans local CLI history locations and provides:
 * - Full-text search with autocomplete
 * - Filter by source, project, date, branch, folder
 * - Metadata extraction (branch, cwd, timestamps, tokens)
 * - Caching with periodic refresh
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const readline = require('readline');
const { exec } = require('child_process');
const util = require('util');
const os = require('os');
const winston = require('winston');
const { splitPathSegments, getAgentWorkspaceDir } = require('./utils/pathUtils');

const execAsync = util.promisify(exec);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/conversations.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

const HOME_DIR = process.env.HOME || os.homedir();
const CLAUDE_PROJECTS_DIR = path.join(HOME_DIR, '.claude', 'projects');
const CODEX_SESSIONS_DIR = path.join(HOME_DIR, '.codex', 'sessions');
const INDEX_CACHE_FILE = path.join(getAgentWorkspaceDir(), 'conversation-index.json');
const INDEX_CACHE_VERSION = 3;

class ConversationService {
  constructor() {
    this.index = null;
    this.lastIndexTime = null;
    this.indexing = false;
    this.refreshScheduled = false;
    this.cacheMaxAge = 5 * 60 * 1000; // 5 minutes
    this.diskCacheMaxAge = 24 * 60 * 60 * 1000; // 24 hours
    this.gitRepoInfoCache = new Map();
  }

  static getInstance() {
    if (!ConversationService.instance) {
      ConversationService.instance = new ConversationService();
    }
    return ConversationService.instance;
  }

  /**
   * Get or build the conversation index
   */
  async getIndex(forceRefresh = false) {
    if (forceRefresh) {
      return await this.buildIndex({ force: true });
    }

    if (this.indexing && this.index) {
      return this.index;
    }

    // Return cached index if fresh
    if (!forceRefresh && this.index && this.lastIndexTime) {
      const age = Date.now() - this.lastIndexTime;
      if (age < this.cacheMaxAge) {
        return this.index;
      }

      this.scheduleBackgroundRefresh('memory-cache-stale');
      return this.index;
    }

    // Try loading from disk cache
    if (!forceRefresh && !this.index) {
      try {
        const cached = await this.loadCachedIndex({ allowStale: true });
        if (cached?.index) {
          this.index = cached.index;
          if (cached.savedAtMs) {
            this.lastIndexTime = cached.savedAtMs;
          } else {
            this.lastIndexTime = Date.now();
          }

          if (cached.cacheAgeMs > this.cacheMaxAge) {
            this.scheduleBackgroundRefresh('disk-cache-stale');
          }

          return this.index;
        }
      } catch (e) {
        logger.debug('No cached index found');
      }
    }

    // Build fresh index
    return await this.buildIndex();
  }

  /**
   * Load cached index from disk
   */
  async loadCachedIndex(options = {}) {
    const { allowStale = false } = options;
    try {
      const stat = await fs.stat(INDEX_CACHE_FILE);
      const cacheAgeMs = Date.now() - stat.mtimeMs;

      // Don't use cache older than disk max age unless stale is allowed
      if (!allowStale && cacheAgeMs > this.diskCacheMaxAge) {
        return null;
      }

      const data = await fs.readFile(INDEX_CACHE_FILE, 'utf8');
      const index = JSON.parse(data);
      const version = index?.cacheMeta?.version || 0;
      if (version !== INDEX_CACHE_VERSION) {
        return null;
      }
      const savedAtMs = index?.cacheMeta?.savedAt ||
        (index?.stats?.indexedAt ? Date.parse(index.stats.indexedAt) : null) ||
        stat.mtimeMs;

      return { index, cacheAgeMs, savedAtMs };
    } catch (e) {
      return null;
    }
  }

  /**
   * Save index to disk cache
   */
  async saveCachedIndex(index) {
    try {
      const dir = path.dirname(INDEX_CACHE_FILE);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(INDEX_CACHE_FILE, JSON.stringify(index));
    } catch (e) {
      logger.warn('Failed to save index cache', { error: e.message });
    }
  }

  /**
   * Build the conversation index by scanning ~/.claude/projects/
   */
  async buildIndex(options = {}) {
    const { force = false } = options;
    if (this.indexing) {
      // Wait for ongoing indexing
      while (this.indexing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return this.index;
    }

    this.indexing = true;
    logger.info('Building conversation index...', { mode: force ? 'full' : 'incremental' });

    try {
      const conversations = [];
      const projects = new Set();
      const cachedByPath = new Map();
      const cacheSavedAt = this.index?.cacheMeta?.savedAt ||
        (this.index?.stats?.indexedAt ? Date.parse(this.index.stats.indexedAt) : null);
      const reuseCounters = {
        reused: 0,
        parsed: 0,
        skippedSmall: 0,
        skippedAgent: 0
      };

      if (!force && this.index?.conversations) {
        for (const cachedConv of this.index.conversations) {
          if (cachedConv?.filepath) {
            cachedByPath.set(cachedConv.filepath, cachedConv);
          }
        }
      }

      // Scan Claude project directories (optional)
      const projectDirs = fsSync.existsSync(CLAUDE_PROJECTS_DIR)
        ? await fs.readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true })
        : [];
      if (projectDirs.length === 0) {
        logger.warn('Claude projects directory not found', { path: CLAUDE_PROJECTS_DIR });
      }

      for (const dirent of projectDirs) {
        if (!dirent.isDirectory()) continue;

        const projectPath = path.join(CLAUDE_PROJECTS_DIR, dirent.name);
        const jsonlFiles = await this.findJsonlFiles(projectPath);

        for (const jsonlFile of jsonlFiles) {
          // Skip agent sub-conversations and tiny files
          if (path.basename(jsonlFile).startsWith('agent-')) {
            reuseCounters.skippedAgent++;
            continue;
          }

          try {
            const stat = await fs.stat(jsonlFile);
            if (stat.size < 500) {
              reuseCounters.skippedSmall++;
              continue;
            }

            const cachedConv = !force ? cachedByPath.get(jsonlFile) : null;
            const hasFileMeta = cachedConv &&
              typeof cachedConv.fileMtimeMs === 'number' &&
              typeof cachedConv.fileSize === 'number';
            const isUnchanged = cachedConv && (
              (hasFileMeta && cachedConv.fileMtimeMs === stat.mtimeMs && cachedConv.fileSize === stat.size) ||
              (!hasFileMeta && cacheSavedAt && stat.mtimeMs <= cacheSavedAt)
            );

	            if (cachedConv && isUnchanged) {
	              if (!hasFileMeta) {
	                cachedConv.fileMtimeMs = stat.mtimeMs;
	                cachedConv.fileSize = stat.size;
	              }
	              if (!cachedConv.project) cachedConv.project = dirent.name;
	              cachedConv.source = cachedConv.source || 'claude';
	              conversations.push(cachedConv);
	              projects.add(cachedConv.project || dirent.name);
	              reuseCounters.reused++;
	              continue;
	            }

            const conv = await this.parseConversationFile(jsonlFile, dirent.name);
            if (conv) {
              conv.fileMtimeMs = stat.mtimeMs;
              conv.fileSize = stat.size;
              conversations.push(conv);
              projects.add(dirent.name);
              reuseCounters.parsed++;
            }
          } catch (e) {
            logger.debug('Failed to parse conversation', { file: jsonlFile, error: e.message });
          }
        }
      }

      // Scan Codex sessions directory (~/.codex/sessions/**.jsonl)
      if (fsSync.existsSync(CODEX_SESSIONS_DIR)) {
        const codexFiles = await this.findJsonlFilesRecursive(CODEX_SESSIONS_DIR);
        for (const jsonlFile of codexFiles) {
          try {
            const stat = await fs.stat(jsonlFile);
            if (stat.size < 500) {
              reuseCounters.skippedSmall++;
              continue;
            }

            const cachedConv = !force ? cachedByPath.get(jsonlFile) : null;
            const hasFileMeta = cachedConv &&
              typeof cachedConv.fileMtimeMs === 'number' &&
              typeof cachedConv.fileSize === 'number';
            const isUnchanged = cachedConv && (
              (hasFileMeta && cachedConv.fileMtimeMs === stat.mtimeMs && cachedConv.fileSize === stat.size) ||
              (!hasFileMeta && cacheSavedAt && stat.mtimeMs <= cacheSavedAt)
            );

            if (cachedConv && isUnchanged) {
              if (!hasFileMeta) {
                cachedConv.fileMtimeMs = stat.mtimeMs;
                cachedConv.fileSize = stat.size;
              }
              cachedConv.source = cachedConv.source || 'codex';
              conversations.push(cachedConv);
              if (cachedConv.project) projects.add(cachedConv.project);
              reuseCounters.reused++;
              continue;
            }

            const conv = await this.parseCodexSessionFile(jsonlFile, { stat });
            if (conv) {
              conv.fileMtimeMs = stat.mtimeMs;
              conv.fileSize = stat.size;
              conversations.push(conv);
              if (conv.project) projects.add(conv.project);
              reuseCounters.parsed++;
            }
          } catch (e) {
            logger.debug('Failed to parse Codex session', { file: jsonlFile, error: e.message });
          }
        }
      }

      // Sort by last timestamp (newest first)
      conversations.sort((a, b) => {
        const aTime = a.lastTimestamp || '1970-01-01';
        const bTime = b.lastTimestamp || '1970-01-01';
        return bTime.localeCompare(aTime);
      });

      // Calculate stats
      const stats = {
        totalConversations: conversations.length,
        totalProjects: projects.size,
        totalMessages: conversations.reduce((sum, c) => sum + (c.messageCount || 0), 0),
        totalTokens: conversations.reduce((sum, c) => sum + (c.totalTokens || 0), 0),
        indexedAt: new Date().toISOString()
      };

      const savedAt = Date.now();
      this.index = {
        conversations,
        projects: Array.from(projects).sort(),
        stats,
        cacheMeta: {
          savedAt,
          version: INDEX_CACHE_VERSION
        }
      };

      this.lastIndexTime = savedAt;

      // Save to disk cache (async, don't wait)
      this.saveCachedIndex(this.index);

      logger.info('Conversation index built', {
        conversations: conversations.length,
        projects: projects.size,
        ...reuseCounters
      });

      return this.index;

    } finally {
      this.indexing = false;
    }
  }

  /**
   * Find all .jsonl files in a directory
   */
  async findJsonlFiles(dir) {
    const files = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(path.join(dir, entry.name));
      }
    }

    return files;
  }

  /**
   * Find all .jsonl files in a directory tree (depth-first).
   */
  async findJsonlFilesRecursive(dir, options = {}) {
    const { maxDepth = 6 } = options;
    const files = [];

    const walk = async (currentDir, depth) => {
      if (depth > maxDepth) return;
      let entries = [];
      try {
        entries = await fs.readdir(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath, depth + 1);
          continue;
        }
        if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          files.push(fullPath);
        }
      }
    };

    await walk(dir, 0);
    return files;
  }

  /**
   * Parse a conversation JSONL file and extract metadata
   * (Lightweight - doesn't store full messages, just metadata)
   */
  async parseConversationFile(filePath, projectName) {
    const fileStream = fsSync.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    let summary = null;
    let preview = '';
    let firstUserMessage = '';
    let lastMessage = '';
    let lastMessageRole = '';
    let firstTimestamp = null;
    let lastTimestamp = null;
    let branch = null;
    let cwd = null;
    let sessionId = null;
    let model = null;
    let messageCount = 0;
    let userMessageCount = 0;
    let toolUseCount = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for await (const line of rl) {
      if (!line.trim()) continue;

      try {
        const obj = JSON.parse(line);

        if (obj.type === 'summary') {
          summary = obj.summary;
        } else if (obj.type === 'user' || obj.type === 'assistant') {
          messageCount++;

          // Extract timestamps
          if (obj.timestamp) {
            if (!firstTimestamp || obj.timestamp < firstTimestamp) {
              firstTimestamp = obj.timestamp;
            }
            if (!lastTimestamp || obj.timestamp > lastTimestamp) {
              lastTimestamp = obj.timestamp;
            }
          }

          // Extract metadata from first messages
          if (!branch && obj.gitBranch) branch = obj.gitBranch;
          if (!cwd && obj.cwd) cwd = obj.cwd;
          if (!sessionId && obj.sessionId) sessionId = obj.sessionId;
          if (!model && obj.message?.model) model = obj.message.model;

          // Extract message content as text
          const extractText = (content) => {
            if (typeof content === 'string') {
              return content.replace(/\n/g, ' ').trim();
            } else if (Array.isArray(content)) {
              const textParts = content
                .filter(c => c.type === 'text' || typeof c === 'string')
                .map(c => typeof c === 'string' ? c : c.text);
              return textParts.join(' ').replace(/\n/g, ' ').trim();
            }
            return '';
          };

          // Clean system cruft from message
          const cleanMessage = (text) => {
            if (!text) return '';
            return text
              .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/gi, '')
              .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
              .replace(/<command-name>[\s\S]*?<\/command-name>/gi, '')
              .replace(/<command-message>[\s\S]*?<\/command-message>/gi, '')
              .replace(/<command-args>[\s\S]*?<\/command-args>/gi, '')
              .replace(/Caveat:.*?consider them in your response[^.]*\./gi, '')
              .replace(/\[Request interrupted by user\]/gi, '')
              .replace(/<[^>]+>/g, '')
              .trim();
          };

          // Check if message is just system cruft
          const isSystemCruft = (text) => {
            if (!text) return true;
            const cleaned = cleanMessage(text);
            return cleaned.length < 5; // Too short after cleaning = likely just cruft
          };

          const msgContent = extractText(obj.message?.content);
          const cleanedContent = cleanMessage(msgContent);

          // Track first user message (skip system cruft)
          if (obj.type === 'user') {
            userMessageCount++;
            if (!firstUserMessage && cleanedContent && !isSystemCruft(msgContent)) {
              firstUserMessage = cleanedContent.slice(0, 500);
              preview = cleanedContent.slice(0, 300); // Keep preview for backwards compat
            }
          }

          // Always update last message (so we end up with the final one)
          if (msgContent) {
            lastMessage = msgContent.slice(0, 500);
            lastMessageRole = obj.type;
          }

          // Count tool uses
          const content = obj.message?.content;
          if (Array.isArray(content)) {
            toolUseCount += content.filter(c => c.type === 'tool_use').length;
          }

          // Extract token usage
          const usage = obj.message?.usage;
          if (usage) {
            totalInputTokens += (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0);
            totalOutputTokens += usage.output_tokens || 0;
          }
        }
      } catch (e) {
        // Skip malformed lines
      }
    }

    if (messageCount === 0) return null;

    // Get actual GitHub repo info from git remote
    let gitRepo = null;
    let gitRepoUrl = null;
    if (cwd) {
      const repoInfo = await this.getGitRepoInfo(cwd);
      gitRepo = repoInfo?.repo;
      gitRepoUrl = repoInfo?.url;
    }

	    return {
	      id: path.basename(filePath, '.jsonl'),
	      filename: path.basename(filePath),
	      filepath: filePath,
	      source: 'claude',
	      project: projectName,
	      summary,
	      preview,
	      firstUserMessage,   // Full first user message (up to 500 chars)
      lastMessage,        // Last message content (up to 500 chars)
      lastMessageRole,    // 'user' or 'assistant'
      branch,
      cwd,
      sessionId,
      model,
      gitRepo,      // e.g., "web3dev1337/zoo-game"
      gitRepoUrl,   // e.g., "https://github.com/web3dev1337/zoo-game"
      messageCount,
      userMessageCount,
      toolUseCount,
      totalInputTokens,
      totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      firstTimestamp,
	      lastTimestamp
	    };
	  }

  /**
   * Parse a Codex session JSONL file (lightweight metadata for listing/search).
   * Codex sessions live under ~/.codex/sessions/YYYY/MM/DD/*.jsonl
   */
  async parseCodexSessionFile(filePath, options = {}) {
    const { stat } = options;

    const fileStream = fsSync.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    let summary = null;
    let preview = '';
    let firstUserMessage = '';
    let lastMessage = '';
    let lastMessageRole = '';
    let firstTimestamp = null;
    let lastTimestamp = null;
    let branch = null;
    let cwd = null;
    let sessionId = null;
    let model = null;
    let messageCount = 0;
    let userMessageCount = 0;

    const extractText = (content) => {
      if (!content) return '';
      if (typeof content === 'string') return content.replace(/\n/g, ' ').trim();
      if (!Array.isArray(content)) return '';

      const parts = [];
      for (const item of content) {
        if (!item) continue;
        if (typeof item === 'string') {
          parts.push(item);
          continue;
        }
        if (typeof item.text === 'string') {
          parts.push(item.text);
          continue;
        }
      }
      return parts.join(' ').replace(/\n/g, ' ').trim();
    };

    const cleanMessage = (text) => {
      if (!text) return '';
      return text
        .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/gi, '')
        .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
        .replace(/<command-name>[\s\S]*?<\/command-name>/gi, '')
        .replace(/<command-message>[\s\S]*?<\/command-message>/gi, '')
        .replace(/<command-args>[\s\S]*?<\/command-args>/gi, '')
        .replace(/Caveat:.*?consider them in your response[^.]*\./gi, '')
        .replace(/\[Request interrupted by user\]/gi, '')
        .replace(/<[^>]+>/g, '')
        .trim();
    };

    const isSystemCruft = (text) => {
      if (!text) return true;
      const cleaned = cleanMessage(text);
      if (cleaned.length < 5) return true;
      // Codex sessions commonly start with orchestrator boilerplate; don't use it as preview.
      if (cleaned.includes('AGENTS.md instructions')) return true;
      if (cleaned.includes('<environment_context')) return true;
      return false;
    };

    // For very large sessions, avoid scanning the entire file (listing only needs metadata).
    const maxBytesToScan = 4 * 1024 * 1024; // 4MB
    let scannedBytes = 0;
    const isLargeFile = stat && typeof stat.size === 'number' ? stat.size > 10 * 1024 * 1024 : false;

    for await (const line of rl) {
      if (!line.trim()) continue;
      scannedBytes += Buffer.byteLength(line, 'utf8');

      try {
        const obj = JSON.parse(line);

        if (obj.type === 'session_meta') {
          const payload = obj.payload || {};
          sessionId = payload.id || sessionId;
          cwd = payload.cwd || cwd;
          branch = payload.git?.branch || branch;
          model = payload.model || payload.model_provider || model;

          if (obj.timestamp) {
            firstTimestamp = firstTimestamp || obj.timestamp;
            lastTimestamp = obj.timestamp;
          }
          continue;
        }

        if (obj.type === 'response_item' && obj.payload?.type === 'message') {
          const payload = obj.payload || {};
          const role = payload.role || '';
          messageCount++;
          if (role === 'user') userMessageCount++;

          if (obj.timestamp) {
            firstTimestamp = firstTimestamp || obj.timestamp;
            lastTimestamp = obj.timestamp;
          }

          const msgContent = extractText(payload.content);
          const cleanedContent = cleanMessage(msgContent);

          if (role === 'user' && !firstUserMessage && cleanedContent && !isSystemCruft(msgContent)) {
            firstUserMessage = cleanedContent.slice(0, 500);
            preview = cleanedContent.slice(0, 300);
          }

          if (msgContent) {
            lastMessage = msgContent.slice(0, 500);
            lastMessageRole = role;
          }
        }
      } catch {
        // Skip malformed lines
      }

      if (isLargeFile && firstUserMessage && scannedBytes >= maxBytesToScan) {
        try {
          rl.close();
          fileStream.destroy();
        } catch {
          // ignore
        }
        break;
      }
    }

    // Use file mtime as a stable "last used" timestamp for large sessions (we may have early-exited).
    if (stat?.mtimeMs && (!lastTimestamp || isLargeFile)) {
      lastTimestamp = new Date(stat.mtimeMs).toISOString();
    }

    // If we couldn't find a session id, try to parse from filename.
    if (!sessionId) {
      const match = String(path.basename(filePath)).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (match) sessionId = match[1];
    }

    if (!sessionId && messageCount === 0) return null;

    // Get actual GitHub repo info from git remote
    let gitRepo = null;
    let gitRepoUrl = null;
    if (cwd) {
      const repoInfo = await this.getGitRepoInfo(cwd);
      gitRepo = repoInfo?.repo;
      gitRepoUrl = repoInfo?.url;
    }

    const projectName = gitRepo || (cwd ? path.basename(cwd) : 'Codex');

    return {
      id: sessionId || path.basename(filePath, '.jsonl'),
      filename: path.basename(filePath),
      filepath: filePath,
      source: 'codex',
      project: projectName,
      summary,
      preview,
      firstUserMessage,
      lastMessage,
      lastMessageRole,
      branch,
      cwd,
      sessionId,
      model: model || 'Codex',
      gitRepo,
      gitRepoUrl,
      messageCount: isLargeFile ? undefined : messageCount,
      userMessageCount: isLargeFile ? undefined : userMessageCount,
      totalTokens: undefined,
      firstTimestamp,
      lastTimestamp
    };
  }

  /**
   * Get GitHub repo info from a directory's git remote
   */
  async getGitRepoInfo(dirPath) {
    try {
      if (!dirPath) return null;
      const resolved = path.resolve(dirPath);
      if (this.gitRepoInfoCache.has(resolved)) {
        return this.gitRepoInfoCache.get(resolved);
      }
      if (!fsSync.existsSync(resolved)) {
        this.gitRepoInfoCache.set(resolved, null);
        return null;
      }

      const { stdout } = await execAsync('git remote get-url origin', {
        cwd: resolved,
        timeout: 5000
      });
      const url = stdout.trim();
      if (!url) {
        this.gitRepoInfoCache.set(resolved, null);
        return null;
      }

      // Parse GitHub URL formats:
      // https://github.com/owner/repo.git
      // git@github.com:owner/repo.git
      let repo = null;
      const httpsMatch = url.match(/github\.com\/([^\/]+\/[^\/\.]+)/);
      const sshMatch = url.match(/github\.com:([^\/]+\/[^\/\.]+)/);

      if (httpsMatch) {
        repo = httpsMatch[1].replace(/\.git$/, '');
      } else if (sshMatch) {
        repo = sshMatch[1].replace(/\.git$/, '');
      }

      // Normalize URL to https
      let normalizedUrl = url;
      if (url.startsWith('git@github.com:')) {
        normalizedUrl = url.replace('git@github.com:', 'https://github.com/').replace(/\.git$/, '');
      } else {
        normalizedUrl = url.replace(/\.git$/, '');
      }

      const info = { repo, url: normalizedUrl };
      this.gitRepoInfoCache.set(resolved, info);
      return info;
    } catch (e) {
      // Not a git repo or no remote
      if (dirPath) {
        this.gitRepoInfoCache.set(path.resolve(dirPath), null);
      }
      return null;
    }
  }

  scheduleBackgroundRefresh(reason) {
    if (this.indexing || this.refreshScheduled) return;
    this.refreshScheduled = true;

    logger.info('Scheduling background conversation index refresh', { reason });

    setImmediate(async () => {
      try {
        await this.buildIndex();
      } catch (e) {
        logger.warn('Background conversation index refresh failed', { error: e.message });
      } finally {
        this.refreshScheduled = false;
      }
    });
  }

  /**
   * Search conversations with text query
   */
  async search(query, options = {}) {
    const {
      source,
      project,
      branch,
      folder,
      startDate,
      endDate,
      limit = 50,
      offset = 0
    } = options;

    const index = await this.getIndex();
    let results = [...index.conversations];

    // Filter by source (claude/codex)
    if (source && source !== 'all') {
      results = results.filter(c => c.source === source);
    }

    // Filter by project
    if (project) {
      results = results.filter(c =>
        (c.project || '').toLowerCase().includes(project.toLowerCase())
      );
    }

    // Filter by branch
    if (branch) {
      results = results.filter(c =>
        c.branch && c.branch.toLowerCase().includes(branch.toLowerCase())
      );
    }

    // Filter by folder/cwd
    if (folder) {
      results = results.filter(c =>
        c.cwd && c.cwd.toLowerCase().includes(folder.toLowerCase())
      );
    }

    // Filter by date range
    if (startDate) {
      results = results.filter(c =>
        c.lastTimestamp && c.lastTimestamp >= startDate
      );
    }
    if (endDate) {
      results = results.filter(c =>
        c.firstTimestamp && c.firstTimestamp <= endDate
      );
    }

    // Text search in summary, preview, project, branch, cwd
    if (query) {
      const q = query.toLowerCase();
      results = results.filter(c =>
        (c.summary && c.summary.toLowerCase().includes(q)) ||
        (c.preview && c.preview.toLowerCase().includes(q)) ||
        (c.project && c.project.toLowerCase().includes(q)) ||
        (c.branch && c.branch.toLowerCase().includes(q)) ||
        (c.cwd && c.cwd.toLowerCase().includes(q))
      );
    }

    // Apply pagination
    const total = results.length;
    results = results.slice(offset, offset + limit);

    return {
      results,
      total,
      limit,
      offset
    };
  }

  /**
   * Get autocomplete suggestions for search
   */
  async autocomplete(query, limit = 10) {
    if (!query || query.length < 2) return [];

    const index = await this.getIndex();
    const q = query.toLowerCase();
    const suggestions = new Set();

    for (const conv of index.conversations) {
      if (suggestions.size >= limit) break;

      // Match project names
      if (conv.project && conv.project.toLowerCase().includes(q)) {
        suggestions.add({ type: 'project', value: conv.project });
      }

      // Match branches
      if (conv.branch && conv.branch.toLowerCase().includes(q)) {
        suggestions.add({ type: 'branch', value: conv.branch });
      }

      // Match folder paths
      if (conv.cwd && conv.cwd.toLowerCase().includes(q)) {
        // Extract folder name from path
        const parts = splitPathSegments(conv.cwd);
        const folder = parts[parts.length - 1] || parts[parts.length - 2];
        if (folder && folder.toLowerCase().includes(q)) {
          suggestions.add({ type: 'folder', value: folder, fullPath: conv.cwd });
        }
      }
    }

    return Array.from(suggestions).slice(0, limit);
  }

  /**
   * Get conversation details with full messages
   */
  async getConversation(conversationId, options = {}) {
    const { project, source } = options || {};
    const index = await this.getIndex();
    const conv = index.conversations.find(c =>
      c.id === conversationId &&
      (!source || c.source === source) &&
      (!project || c.project === project)
    );

    if (!conv) return null;

    // Parse full messages from file
    const messages = conv.source === 'codex'
      ? await this.parseFullCodexConversation(conv.filepath)
      : await this.parseFullConversation(conv.filepath);

    return {
      ...conv,
      messages
    };
  }

  /**
   * Parse full Claude conversation messages from file
   */
  async parseFullConversation(filePath) {
    const messages = [];
    const fileStream = fsSync.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      if (!line.trim()) continue;

      try {
        const obj = JSON.parse(line);

        if (obj.type === 'user' || obj.type === 'assistant') {
          const content = obj.message?.content;
          let textContent = '';
          let toolUses = [];
          let toolResults = [];

          if (typeof content === 'string') {
            textContent = content;
          } else if (Array.isArray(content)) {
            for (const item of content) {
              if (typeof item === 'string') {
                textContent += item;
              } else if (item.type === 'text') {
                textContent += item.text;
              } else if (item.type === 'tool_use') {
                toolUses.push({
                  name: item.name,
                  id: item.id,
                  input: item.input
                });
              } else if (item.type === 'tool_result') {
                toolResults.push({
                  toolUseId: item.tool_use_id,
                  content: item.content,
                  isError: item.is_error
                });
              }
            }
          }

          messages.push({
            role: obj.type,
            content: textContent,
            timestamp: obj.timestamp,
            toolUses: toolUses.length ? toolUses : undefined,
            toolResults: toolResults.length ? toolResults : undefined,
            stopReason: obj.message?.stop_reason,
            model: obj.message?.model
          });
        }
      } catch (e) {
        // Skip malformed lines
      }
    }

    return messages;
  }

  /**
   * Parse full Codex session messages from file.
   */
  async parseFullCodexConversation(filePath) {
    const messages = [];
    const fileStream = fsSync.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    const extractText = (content) => {
      if (!content) return '';
      if (typeof content === 'string') return content;
      if (!Array.isArray(content)) return '';

      const parts = [];
      for (const item of content) {
        if (!item) continue;
        if (typeof item === 'string') {
          parts.push(item);
          continue;
        }
        if (typeof item.text === 'string') {
          parts.push(item.text);
          continue;
        }
      }
      return parts.join('');
    };

    for await (const line of rl) {
      if (!line.trim()) continue;

      try {
        const obj = JSON.parse(line);
        if (obj.type === 'response_item' && obj.payload?.type === 'message') {
          const role = obj.payload?.role || 'unknown';
          const content = extractText(obj.payload?.content);
          messages.push({
            role,
            content,
            timestamp: obj.timestamp
          });
        }
      } catch {
        // Skip malformed lines
      }
    }

    return messages;
  }

  /**
   * Get recent conversations for quick access
   */
  async getRecent(limit = 20) {
    const index = await this.getIndex();
    return index.conversations.slice(0, limit);
  }

  /**
   * Get conversations by folder path
   */
  async getByFolder(folderPath) {
    const index = await this.getIndex();
    return index.conversations.filter(c =>
      c.cwd && c.cwd.includes(folderPath)
    );
  }

  /**
   * Get conversations by project
   */
  async getByProject(projectName) {
    const index = await this.getIndex();
    return index.conversations.filter(c =>
      c.project.toLowerCase() === projectName.toLowerCase()
    );
  }

  /**
   * Get list of all projects
   */
  async getProjects() {
    const index = await this.getIndex();
    return index.projects;
  }

  /**
   * Get index stats
   */
  async getStats() {
    const index = await this.getIndex();
    return index.stats;
  }

  /**
   * Force refresh the index
   */
  async refresh() {
    return await this.buildIndex({ force: true });
  }
}

module.exports = { ConversationService };
