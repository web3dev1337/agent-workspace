/**
 * ConversationService - Index and search Claude Code conversations
 *
 * Scans ~/.claude/projects/ for conversation history and provides:
 * - Full-text search with autocomplete
 * - Filter by project, date, branch, folder
 * - Metadata extraction (branch, cwd, timestamps, tokens)
 * - Caching with periodic refresh
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const readline = require('readline');
const { exec } = require('child_process');
const util = require('util');
const winston = require('winston');

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

const CLAUDE_PROJECTS_DIR = path.join(process.env.HOME, '.claude', 'projects');
const INDEX_CACHE_FILE = path.join(process.env.HOME, '.orchestrator', 'conversation-index.json');

class ConversationService {
  constructor() {
    this.index = null;
    this.lastIndexTime = null;
    this.indexing = false;
    this.cacheMaxAge = 5 * 60 * 1000; // 5 minutes
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
    // Return cached index if fresh
    if (!forceRefresh && this.index && this.lastIndexTime) {
      const age = Date.now() - this.lastIndexTime;
      if (age < this.cacheMaxAge) {
        return this.index;
      }
    }

    // Try loading from disk cache
    if (!forceRefresh && !this.index) {
      try {
        const cached = await this.loadCachedIndex();
        if (cached) {
          this.index = cached;
          this.lastIndexTime = Date.now();
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
  async loadCachedIndex() {
    try {
      const stat = await fs.stat(INDEX_CACHE_FILE);
      const age = Date.now() - stat.mtimeMs;

      // Don't use cache older than 1 hour
      if (age > 60 * 60 * 1000) {
        return null;
      }

      const data = await fs.readFile(INDEX_CACHE_FILE, 'utf8');
      return JSON.parse(data);
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
  async buildIndex() {
    if (this.indexing) {
      // Wait for ongoing indexing
      while (this.indexing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return this.index;
    }

    this.indexing = true;
    logger.info('Building conversation index...');

    try {
      const conversations = [];
      const projects = new Set();

      // Check if projects directory exists
      if (!fsSync.existsSync(CLAUDE_PROJECTS_DIR)) {
        logger.warn('Claude projects directory not found', { path: CLAUDE_PROJECTS_DIR });
        this.index = { conversations: [], projects: [], stats: {} };
        return this.index;
      }

      // Scan project directories
      const projectDirs = await fs.readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true });

      for (const dirent of projectDirs) {
        if (!dirent.isDirectory()) continue;

        const projectPath = path.join(CLAUDE_PROJECTS_DIR, dirent.name);
        const jsonlFiles = await this.findJsonlFiles(projectPath);

        for (const jsonlFile of jsonlFiles) {
          // Skip agent sub-conversations and tiny files
          if (path.basename(jsonlFile).startsWith('agent-')) continue;

          try {
            const stat = await fs.stat(jsonlFile);
            if (stat.size < 500) continue;

            const conv = await this.parseConversationFile(jsonlFile, dirent.name);
            if (conv) {
              conversations.push(conv);
              projects.add(dirent.name);
            }
          } catch (e) {
            logger.debug('Failed to parse conversation', { file: jsonlFile, error: e.message });
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

      this.index = {
        conversations,
        projects: Array.from(projects).sort(),
        stats
      };

      this.lastIndexTime = Date.now();

      // Save to disk cache (async, don't wait)
      this.saveCachedIndex(this.index);

      logger.info('Conversation index built', {
        conversations: conversations.length,
        projects: projects.size
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

          const msgContent = extractText(obj.message?.content);

          // Track first user message
          if (obj.type === 'user') {
            userMessageCount++;
            if (!firstUserMessage && msgContent) {
              firstUserMessage = msgContent.slice(0, 500);
              preview = msgContent.slice(0, 300); // Keep preview for backwards compat
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
   * Get GitHub repo info from a directory's git remote
   */
  async getGitRepoInfo(dirPath) {
    try {
      const { stdout } = await execAsync('git remote get-url origin', {
        cwd: dirPath,
        timeout: 5000
      });
      const url = stdout.trim();
      if (!url) return null;

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

      return { repo, url: normalizedUrl };
    } catch (e) {
      // Not a git repo or no remote
      return null;
    }
  }

  /**
   * Search conversations with text query
   */
  async search(query, options = {}) {
    const {
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

    // Filter by project
    if (project) {
      results = results.filter(c =>
        c.project.toLowerCase().includes(project.toLowerCase())
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
        const parts = conv.cwd.split('/');
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
  async getConversation(conversationId, project) {
    const index = await this.getIndex();
    const conv = index.conversations.find(c =>
      c.id === conversationId && (!project || c.project === project)
    );

    if (!conv) return null;

    // Parse full messages from file
    const messages = await this.parseFullConversation(conv.filepath);

    return {
      ...conv,
      messages
    };
  }

  /**
   * Parse full conversation messages from file
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
    return await this.buildIndex();
  }
}

module.exports = { ConversationService };
