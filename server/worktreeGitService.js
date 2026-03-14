const { execFile } = require('child_process');
const util = require('util');
const winston = require('winston');
const { TTLCache } = require('./utils/ttlCache');
const { augmentProcessEnv, getHiddenProcessOptions } = require('./utils/processUtils');

const execFileAsync = util.promisify(execFile);

const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024; // 10MB

async function execFileSafe(command, args, options = {}) {
  return execFileAsync(command, args, {
    ...getHiddenProcessOptions(options),
    env: augmentProcessEnv(options.env || process.env),
    maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER
  });
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/worktree-git.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

const normalizeRenamePath = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  // "old -> new"
  if (raw.includes(' -> ')) {
    const parts = raw.split(' -> ').map(s => s.trim()).filter(Boolean);
    return parts[parts.length - 1] || raw;
  }

  // "old => new" OR "src/{old => new}.js"
  if (raw.includes('=>')) {
    // Handle brace rename expansions.
    const brace = raw.match(/\{([^{}]+)=>\s*([^{}]+)\}/);
    if (brace) {
      return raw.replace(/\{[^{}]+=>\s*([^{}]+)\}/g, '$1').replace(/\s+/g, '');
    }

    const parts = raw.split('=>').map(s => s.trim()).filter(Boolean);
    return parts[parts.length - 1] || raw;
  }

  return raw;
};

const parsePorcelainStatus = (porcelain) => {
  const raw = String(porcelain || '');
  if (!raw.trim()) return [];

  const entries = [];
  for (const line of raw.split('\n')) {
    const trimmed = String(line || '').replace(/\r$/, '').trimEnd();
    if (!trimmed.trim()) continue;

    const x = trimmed[0] || ' ';
    const y = trimmed[1] || ' ';
    let file = trimmed.slice(3).trim();
    if (!file) continue;

    let oldPath = '';
    if (file.includes(' -> ')) {
      const parts = file.split(' -> ').map(s => s.trim()).filter(Boolean);
      oldPath = parts.length >= 2 ? parts[0] : '';
      file = parts[parts.length - 1] || file;
    }

    const isUntracked = x === '?' && y === '?';
    entries.push({
      path: file,
      oldPath: oldPath || null,
      indexStatus: isUntracked ? '?' : x,
      worktreeStatus: isUntracked ? '?' : y,
      isUntracked
    });
  }

  // Deduplicate by path (prefer entries that include oldPath if present).
  const byPath = new Map();
  for (const e of entries) {
    if (!e?.path) continue;
    const prev = byPath.get(e.path);
    if (!prev || (!prev.oldPath && e.oldPath)) byPath.set(e.path, e);
  }
  return Array.from(byPath.values()).sort((a, b) => String(a.path).localeCompare(String(b.path)));
};

const parseNumstat = (numstat) => {
  const raw = String(numstat || '');
  if (!raw.trim()) return new Map();

  const map = new Map();
  for (const line of raw.split('\n')) {
    const trimmed = String(line || '').replace(/\r$/, '').trimEnd();
    if (!trimmed.trim()) continue;

    const [addedRaw, deletedRaw, ...pathParts] = trimmed.split('\t');
    const pathRaw = pathParts.join('\t');
    const path = normalizeRenamePath(pathRaw);
    if (!path) continue;

    const binary = addedRaw === '-' || deletedRaw === '-';
    const added = binary ? null : Number(addedRaw);
    const deleted = binary ? null : Number(deletedRaw);
    map.set(path, {
      added: Number.isFinite(added) ? added : null,
      deleted: Number.isFinite(deleted) ? deleted : null,
      binary
    });
  }
  return map;
};

class WorktreeGitService {
  constructor() {
    this.cache = new TTLCache({ defaultTtlMs: 5_000, maxEntries: 250 });
  }

  static getInstance() {
    if (!WorktreeGitService.instance) {
      WorktreeGitService.instance = new WorktreeGitService();
    }
    return WorktreeGitService.instance;
  }

  async getSummary(worktreePath, { maxFiles = 300, maxCommits = 25 } = {}) {
    const p = String(worktreePath || '').trim();
    if (!p) throw new Error('worktreePath is required');

    const cacheKey = `git-summary:${p}:${Number(maxFiles) || 0}:${Number(maxCommits) || 0}`;
    return this.cache.getOrCompute(cacheKey, async () => {
      let gitDetected = false;
      let gitError = null;
      let branch = null;
      let ahead = 0;
      let behind = 0;
      let statusOutput = '';
      let diffUnstaged = '';
      let diffStaged = '';
      let commitsOutput = '';
      let unpushedOutput = '';

      try {
        const { stdout } = await execFileSafe('git', ['rev-parse', '--is-inside-work-tree'], { cwd: p, timeout: 3000 });
        gitDetected = String(stdout || '').trim() === 'true';
      } catch (error) {
        gitDetected = false;
        gitError = error?.message ? String(error.message) : 'git rev-parse failed';
      }

      if (!gitDetected) {
        return {
          path: p,
          gitDetected: false,
          gitError,
          branch,
          ahead,
          behind,
          files: [],
          commits: [],
          unpushedCommits: []
        };
      }

      try {
        const { stdout } = await execFileSafe('git', ['branch', '--show-current'], { cwd: p, timeout: 7000 });
        branch = stdout.trim() || null;
      } catch (error) {
        logger.debug('Failed to get branch', { path: p, error: error.message });
      }

      try {
        const { stdout } = await execFileSafe('git', ['rev-list', '--left-right', '--count', '@{u}...HEAD'], { cwd: p, timeout: 7000 });
        const [b, a] = String(stdout || '').trim().split('\t').map(Number);
        behind = Number.isFinite(b) ? b : 0;
        ahead = Number.isFinite(a) ? a : 0;
      } catch {
        // No upstream configured.
      }

      const boundedFiles = Math.min(1000, Math.max(0, Number(maxFiles) || 0)) || 300;
      const boundedCommits = Math.min(200, Math.max(0, Number(maxCommits) || 0)) || 25;

      const cmds = [
        execFileSafe('git', ['status', '--porcelain'], { cwd: p, timeout: 7000 }).then(r => { statusOutput = r.stdout || ''; }).catch(() => {}),
        execFileSafe('git', ['diff', '--numstat'], { cwd: p, timeout: 7000 }).then(r => { diffUnstaged = r.stdout || ''; }).catch(() => {}),
        execFileSafe('git', ['diff', '--cached', '--numstat'], { cwd: p, timeout: 7000 }).then(r => { diffStaged = r.stdout || ''; }).catch(() => {}),
        execFileSafe('git', ['log', '-n', String(boundedCommits), '--date=iso', '--pretty=format:%h|%ad|%s'], { cwd: p, timeout: 7000 })
          .then(r => { commitsOutput = r.stdout || ''; })
          .catch(() => {})
      ];

      // Best-effort: list only unpushed commits when upstream exists.
      if (ahead > 0) {
        cmds.push(
          execFileSafe(
            'git',
            ['log', '-n', String(Math.min(100, Math.max(1, ahead))), '--date=iso', '--pretty=format:%h|%ad|%s', '@{u}..HEAD'],
            { cwd: p, timeout: 7000 }
          )
            .then(r => { unpushedOutput = r.stdout || ''; })
            .catch(() => {})
        );
      }

      await Promise.all(cmds);

      const statusEntries = parsePorcelainStatus(statusOutput).slice(0, boundedFiles);
      const unstagedMap = parseNumstat(diffUnstaged);
      const stagedMap = parseNumstat(diffStaged);

      const files = statusEntries.map((e) => {
        const key = normalizeRenamePath(e.path);
        const staged = stagedMap.get(key) || null;
        const unstaged = unstagedMap.get(key) || null;
        return {
          path: e.path,
          oldPath: e.oldPath,
          indexStatus: e.indexStatus,
          worktreeStatus: e.worktreeStatus,
          isUntracked: e.isUntracked,
          staged: staged ? { ...staged } : null,
          unstaged: unstaged ? { ...unstaged } : null
        };
      });

      const parseCommits = (out) => String(out || '')
        .split('\n')
        .map((line) => String(line || '').replace(/\r$/, '').trim())
        .filter(Boolean)
        .map((line) => {
          const [hash, date, ...msgParts] = line.split('|');
          return {
            hash: String(hash || '').trim(),
            date: String(date || '').trim(),
            message: msgParts.join('|').trim()
          };
        })
        .filter(c => c.hash);

      const commits = parseCommits(commitsOutput);
      const unpushedCommits = parseCommits(unpushedOutput);

      return {
        path: p,
        gitDetected: true,
        gitError: null,
        branch,
        ahead,
        behind,
        files,
        commits,
        unpushedCommits
      };
    });
  }
}

module.exports = { WorktreeGitService, parsePorcelainStatus, parseNumstat, normalizeRenamePath };
