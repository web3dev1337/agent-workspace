const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/continuity.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

class ContinuityService {
  constructor() {
    // Default paths to look for ledgers
    this.ledgerPaths = [
      'thoughts/ledgers',
      '.claude/ledgers',
      '.continuity'
    ];
  }

  static getInstance() {
    if (!ContinuityService.instance) {
      ContinuityService.instance = new ContinuityService();
    }
    return ContinuityService.instance;
  }

  /**
   * Get ledger for a worktree
   * @param {string} worktreePath - Path to the worktree
   * @returns {Object|null} Parsed ledger or null if not found
   */
  async getLedger(worktreePath) {
    // Try each possible ledger path
    for (const ledgerDir of this.ledgerPaths) {
      const ledgerPath = path.join(worktreePath, ledgerDir);

      try {
        if (fsSync.existsSync(ledgerPath)) {
          const files = await fs.readdir(ledgerPath);
          const ledgerFiles = files.filter(f => f.endsWith('.md') && f.startsWith('CONTINUITY_'));

          if (ledgerFiles.length > 0) {
            // Get the most recent ledger (by modification time)
            const ledgerStats = await Promise.all(
              ledgerFiles.map(async f => {
                const filePath = path.join(ledgerPath, f);
                const stats = await fs.stat(filePath);
                return { file: f, path: filePath, mtime: stats.mtime };
              })
            );

            ledgerStats.sort((a, b) => b.mtime - a.mtime);
            const latestLedger = ledgerStats[0];

            return this.parseLedger(latestLedger.path);
          }
        }
      } catch (error) {
        logger.debug('Error checking ledger path', { ledgerPath, error: error.message });
      }
    }

    return null;
  }

  /**
   * Parse a ledger file
   * @param {string} filePath - Path to the ledger file
   * @returns {Object} Parsed ledger content
   */
  async parseLedger(filePath) {
    const content = await fs.readFile(filePath, 'utf8');

    // Parse YAML frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    let frontmatter = {};

    if (frontmatterMatch) {
      const yamlContent = frontmatterMatch[1];
      // Simple YAML parsing (key: value pairs)
      yamlContent.split('\n').forEach(line => {
        const match = line.match(/^(\w+):\s*(.+)$/);
        if (match) {
          frontmatter[match[1]] = match[2];
        }
      });
    }

    // Parse markdown sections
    const sections = this.parseMarkdownSections(content);

    return {
      filePath,
      fileName: path.basename(filePath),
      frontmatter,
      sections,
      raw: content
    };
  }

  /**
   * Parse markdown into sections
   * @param {string} content - Markdown content
   * @returns {Object} Sections keyed by heading
   */
  parseMarkdownSections(content) {
    const sections = {};
    const lines = content.split('\n');

    let currentSection = null;
    let currentContent = [];

    // Skip frontmatter
    let inFrontmatter = false;
    let startIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === '---') {
        inFrontmatter = !inFrontmatter;
        if (!inFrontmatter) {
          startIndex = i + 1;
          break;
        }
      }
    }

    // Parse sections
    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];
      const headingMatch = line.match(/^##\s+(.+)$/);

      if (headingMatch) {
        // Save previous section
        if (currentSection) {
          sections[currentSection] = currentContent.join('\n').trim();
        }

        currentSection = headingMatch[1];
        currentContent = [];
      } else if (currentSection) {
        currentContent.push(line);
      }
    }

    // Save last section
    if (currentSection) {
      sections[currentSection] = currentContent.join('\n').trim();
    }

    return sections;
  }

  /**
   * Get all ledgers for a workspace
   * @param {Object} workspace - Workspace configuration
   * @returns {Array} Array of ledger objects keyed by worktree
   */
  async getWorkspaceLedgers(workspace) {
    const ledgers = [];

    if (!workspace) return ledgers;

    // Handle mixed-repo workspaces
    if (Array.isArray(workspace.terminals)) {
      const processedPaths = new Set();

      for (const terminal of workspace.terminals) {
        const worktreePath = path.join(terminal.repository.path, terminal.worktree);

        if (processedPaths.has(worktreePath)) continue;
        processedPaths.add(worktreePath);

        const ledger = await this.getLedger(worktreePath);
        if (ledger) {
          ledgers.push({
            worktreeId: terminal.worktree,
            repositoryName: terminal.repository.name,
            path: worktreePath,
            ledger
          });
        }
      }
    } else {
      // Handle traditional single-repo workspaces
      const repoPath = workspace.repository?.path;
      if (!repoPath) return ledgers;

      const worktreeCount = workspace.terminals?.pairs || 1;

      for (let i = 1; i <= worktreeCount; i++) {
        const worktreePath = path.join(repoPath, `work${i}`);

        if (fsSync.existsSync(worktreePath)) {
          const ledger = await this.getLedger(worktreePath);
          if (ledger) {
            ledgers.push({
              worktreeId: `work${i}`,
              path: worktreePath,
              ledger
            });
          }
        }
      }

      // Also check master directory
      const masterPath = path.join(repoPath, 'master');
      if (fsSync.existsSync(masterPath)) {
        const ledger = await this.getLedger(masterPath);
        if (ledger) {
          ledgers.push({
            worktreeId: 'master',
            path: masterPath,
            ledger
          });
        }
      }
    }

    return ledgers;
  }

  /**
   * Get summary info from a ledger
   * @param {Object} ledger - Parsed ledger object
   * @returns {Object} Summary with goal, state, next steps
   */
  getSummary(ledger) {
    if (!ledger) return null;

    return {
      project: ledger.frontmatter?.project || 'Unknown',
      date: ledger.frontmatter?.date || null,
      goal: ledger.sections?.Goal || null,
      currentState: ledger.sections?.['Current State'] || null,
      nextSteps: this.parseListItems(ledger.sections?.['Next Steps'] || ''),
      keyDecisions: this.parseListItems(ledger.sections?.['Key Decisions'] || ''),
      openPRs: this.parseListItems(ledger.sections?.['Open PRs'] || '')
    };
  }

  /**
   * Parse markdown list items
   * @param {string} content - Markdown content with list items
   * @returns {Array} Array of list item texts
   */
  parseListItems(content) {
    if (!content) return [];

    const items = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const match = line.match(/^[-*]\s+(.+)$/);
      const numberedMatch = line.match(/^\d+\.\s+(.+)$/);

      if (match) {
        items.push(match[1].trim());
      } else if (numberedMatch) {
        items.push(numberedMatch[1].trim());
      }
    }

    return items;
  }
}

module.exports = { ContinuityService };
