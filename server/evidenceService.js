'use strict';

const fs = require('fs');
const path = require('path');
const winston = require('winston');

const { normalizeEvidence } = require('./taskRecordService');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: path.join(process.cwd(), 'logs', 'evidence.log'), maxsize: 2_000_000, maxFiles: 2 })
  ]
});

const EVIDENCE_FENCE_RE = /```agent-evidence\s*\n([\s\S]*?)```/g;
const MAX_BLOCKS_PER_TEXT = 10;
const MAX_BLOCK_CHARS = 20_000;
const WORKTREE_EVIDENCE_FILE = '.agent-evidence.json';
const MEDIA_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.mp4', '.webm', '.mov']);

const PR_ID_RE = /^pr:([^/]+)\/([^#]+)#(\d+)$/;

const parsePrTaskId = (taskId) => {
  const match = String(taskId || '').match(PR_ID_RE);
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: parseInt(match[3], 10) };
};

// Fields agents must not control: the server decides where media may be
// served from, so a crafted evidence block cannot point the media endpoint
// at an arbitrary directory.
const SERVER_ONLY_KEYS = new Set(['worktreePath']);

const stripServerOnlyKeys = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SERVER_ONLY_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
};

const parseEvidenceBlocks = (text) => {
  const blocks = [];
  if (!text || typeof text !== 'string') return blocks;
  let match;
  EVIDENCE_FENCE_RE.lastIndex = 0;
  while ((match = EVIDENCE_FENCE_RE.exec(text)) !== null && blocks.length < MAX_BLOCKS_PER_TEXT) {
    const body = String(match[1] || '').trim();
    if (!body || body.length > MAX_BLOCK_CHARS) continue;
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        blocks.push(stripServerOnlyKeys(parsed));
      }
    } catch {
      // Malformed JSON inside a fence is ignored; agents get feedback via
      // the evidence card showing nothing rather than a hard failure.
    }
  }
  return blocks;
};

const dedupeBy = (items, keyFn) => {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
};

// Later blocks win for scalar sections; list sections accumulate with de-dupe.
const mergeEvidence = (...blocks) => {
  const merged = {};
  const reviews = [];
  const media = [];
  const data = [];
  const standards = [];

  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    // worktreePath only ever comes from trusted inputs (our own store or the
    // server-side resolver) — agent-supplied blocks have it stripped upstream.
    for (const key of ['summary', 'tests', 'appRun', 'handoff', 'diffStats', 'worktreePath']) {
      if (block[key] !== undefined && block[key] !== null) merged[key] = block[key];
    }
    if (Array.isArray(block.reviews)) reviews.push(...block.reviews);
    if (Array.isArray(block.media)) media.push(...block.media);
    if (Array.isArray(block.data)) data.push(...block.data);
    if (Array.isArray(block.standards)) standards.push(...block.standards);
  }

  if (reviews.length) {
    merged.reviews = dedupeBy(reviews.filter(r => r && typeof r === 'object'), (r) =>
      [r.role || '', r.by || '', r.at || '', r.verdict || ''].join('|'));
  }
  if (media.length) {
    merged.media = dedupeBy(media.filter(m => m && typeof m === 'object'), (m) => String(m.path || ''));
  }
  if (data.length) {
    merged.data = dedupeBy(data.filter(d => d && typeof d === 'object'), (d) =>
      [d.metric || '', d.note || ''].join('|'));
  }
  if (standards.length) {
    merged.standards = [...new Set(standards.map(s => String(s || '').trim()).filter(Boolean))];
  }

  return Object.keys(merged).length ? merged : null;
};

class EvidenceService {
  constructor({ taskRecordService, pullRequestService, gitHelper, workspaceManager } = {}) {
    this.taskRecordService = taskRecordService || null;
    this.pullRequestService = pullRequestService || null;
    this.gitHelper = gitHelper || null;
    this.workspaceManager = workspaceManager || null;
  }

  static getInstance(deps = {}) {
    if (!EvidenceService.instance) {
      EvidenceService.instance = new EvidenceService(deps);
    }
    return EvidenceService.instance;
  }

  // -------------------------------------------------------------------------
  // Worktree source
  // -------------------------------------------------------------------------

  readWorktreeEvidence(worktreePath) {
    const root = String(worktreePath || '').trim();
    if (!root) return null;
    const file = path.join(root, WORKTREE_EVIDENCE_FILE);
    try {
      if (!fs.existsSync(file)) return null;
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > 200_000) return null;
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return stripServerOnlyKeys(parsed);
      }
      return null;
    } catch (e) {
      logger.warn('Failed to read worktree evidence', { worktreePath: root, error: e.message });
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // PR source
  // -------------------------------------------------------------------------

  async collectForPr(taskId) {
    const parsed = parsePrTaskId(taskId);
    if (!parsed || !this.pullRequestService) return { blocks: [], diffStats: null, headRefName: null };

    const prUrl = `https://github.com/${parsed.owner}/${parsed.repo}/pull/${parsed.number}`;
    const blocks = [];
    let diffStats = null;
    let headRefName = null;

    try {
      const [details, prBody] = await Promise.all([
        this.pullRequestService.getPullRequestDetailsByUrl(prUrl, { maxFiles: 2000, maxComments: 200, maxReviews: 100 }),
        this.pullRequestService.getPullRequest({ ...parsed, fields: ['body'] }).catch(() => null)
      ]);

      if (prBody?.body) blocks.push(...parseEvidenceBlocks(prBody.body));
      const comments = details?.conversation?.issueComments || [];
      for (const comment of comments) {
        blocks.push(...parseEvidenceBlocks(comment?.body || ''));
      }
      const reviews = details?.conversation?.reviews || [];
      for (const review of reviews) {
        blocks.push(...parseEvidenceBlocks(review?.body || ''));
      }

      const files = Array.isArray(details?.files) ? details.files : [];
      if (files.length) {
        diffStats = {
          files: files.length,
          additions: files.reduce((sum, f) => sum + (Number.isFinite(f?.additions) ? f.additions : 0), 0),
          deletions: files.reduce((sum, f) => sum + (Number.isFinite(f?.deletions) ? f.deletions : 0), 0)
        };
      }
      headRefName = details?.pr?.headRefName || null;
    } catch (e) {
      logger.warn('Failed to collect PR evidence', { taskId, error: e.message });
    }

    return { blocks, diffStats, headRefName };
  }

  // -------------------------------------------------------------------------
  // Worktree discovery (trusted paths only)
  // -------------------------------------------------------------------------

  listWorkspaceWorktreePaths() {
    const paths = [];
    try {
      const active = this.workspaceManager?.getActiveWorkspace?.();
      const workspace = active?.id ? this.workspaceManager?.getWorkspaceById?.(active.id) : null;
      const terminals = workspace?.terminals || [];
      for (const terminal of terminals) {
        const repoPath = terminal?.repository?.path || terminal?.repositoryPath || '';
        const worktreeId = terminal?.worktreeId || terminal?.worktree || '';
        if (!repoPath || !worktreeId) continue;
        const full = path.join(String(repoPath), String(worktreeId));
        if (!paths.includes(full)) paths.push(full);
      }
    } catch (e) {
      logger.warn('Failed to list workspace worktrees', { error: e.message });
    }
    return paths;
  }

  async findWorktreeForBranch(branch) {
    const wanted = String(branch || '').trim();
    if (!wanted || !this.gitHelper) return null;
    for (const worktreePath of this.listWorkspaceWorktreePaths()) {
      try {
        const current = await this.gitHelper.getCurrentBranch(worktreePath);
        if (current && String(current).trim() === wanted) return worktreePath;
      } catch {
        // ignore unreadable worktrees
      }
    }
    return null;
  }

  // A candidate media root is only trusted if it resolves (via realpath, so
  // symlinks can't disguise it) to a worktree the orchestrator actually
  // manages. This is what makes the media endpoint safe: an explicit
  // worktreePath from the request body, or a path embedded in a task id,
  // cannot point the file server at an arbitrary directory.
  isKnownWorktreePath(candidate) {
    const target = String(candidate || '').trim();
    if (!target) return false;
    let realTarget;
    try {
      realTarget = fs.realpathSync(target);
    } catch {
      return false;
    }
    for (const known of this.listWorkspaceWorktreePaths()) {
      try {
        if (fs.realpathSync(known) === realTarget) return true;
      } catch {
        // unreadable known worktree — skip
      }
    }
    return false;
  }

  resolveWorktreePathForTask(taskId, explicitPath) {
    const explicit = String(explicitPath || '').trim();
    if (explicit) {
      // Untrusted request-body input: only honor it if it resolves to a
      // worktree the orchestrator actually manages (finding #4).
      return this.isKnownWorktreePath(explicit) ? explicit : null;
    }
    // The `worktree:<path>` id IS the task's identity (assigned by the
    // orchestrator, not free request input); trust it as the root. The media
    // endpoint still realpath-confines every read to within it (finding #3).
    const match = String(taskId || '').match(/^worktree:(.+)$/);
    if (match) return match[1];
    return null;
  }

  // -------------------------------------------------------------------------
  // Refresh: collect from all sources, merge, persist on the task record
  // -------------------------------------------------------------------------

  async refresh(taskId, { worktreePath } = {}) {
    if (!taskId) throw new Error('taskId is required');
    if (!this.taskRecordService) throw new Error('taskRecordService not available');

    const sources = [];
    const blocks = [];
    let diffStats = null;
    let resolvedWorktree = this.resolveWorktreePathForTask(taskId, worktreePath);

    if (parsePrTaskId(taskId)) {
      const pr = await this.collectForPr(taskId);
      if (pr.blocks.length) sources.push({ source: 'pr', blocks: pr.blocks.length });
      blocks.push(...pr.blocks);
      diffStats = pr.diffStats;
      if (!resolvedWorktree && pr.headRefName) {
        resolvedWorktree = await this.findWorktreeForBranch(pr.headRefName);
      }
    }

    if (resolvedWorktree) {
      const fileEvidence = this.readWorktreeEvidence(resolvedWorktree);
      if (fileEvidence) {
        sources.push({ source: 'worktree-file', path: resolvedWorktree });
        blocks.push(fileEvidence);
      }
    }

    const existing = this.taskRecordService.get(taskId)?.evidence || null;
    const merged = mergeEvidence(existing, ...blocks);
    if (!merged && !diffStats) {
      return { taskId, evidence: existing, sources, updated: false };
    }

    const evidencePatch = merged || {};
    if (diffStats) evidencePatch.diffStats = diffStats;
    if (resolvedWorktree) evidencePatch.worktreePath = resolvedWorktree;

    const record = await this.taskRecordService.upsert(taskId, { evidence: evidencePatch });
    return { taskId, evidence: record.evidence || null, sources, updated: true };
  }

  async setDirect(taskId, evidence) {
    if (!taskId) throw new Error('taskId is required');
    if (!this.taskRecordService) throw new Error('taskRecordService not available');
    const existing = this.taskRecordService.get(taskId)?.evidence || null;
    const merged = evidence === null ? null : mergeEvidence(existing, stripServerOnlyKeys(evidence));
    if (merged && existing?.worktreePath) merged.worktreePath = existing.worktreePath;
    const record = await this.taskRecordService.upsert(taskId, { evidence: merged });
    return record.evidence || null;
  }

  // -------------------------------------------------------------------------
  // Media resolution (path-validated streaming support)
  // -------------------------------------------------------------------------

  resolveMediaPath(taskId, index) {
    const record = this.taskRecordService?.get?.(taskId);
    const evidence = record?.evidence;
    const media = Array.isArray(evidence?.media) ? evidence.media : [];
    const idx = Number(index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= media.length) {
      return { error: 'media index out of range', status: 404 };
    }

    const root = String(evidence?.worktreePath || '').trim();
    if (!root) return { error: 'no trusted worktree path recorded for this evidence', status: 400 };

    const rawPath = String(media[idx]?.path || '');
    if (!rawPath) return { error: 'media entry has no path', status: 404 };

    const rootResolved = path.resolve(root);
    const abs = path.resolve(rootResolved, rawPath);

    // 1) Lexical containment (no filesystem needed): rejects `../` traversal.
    if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) {
      return { error: 'media path escapes the evidence worktree', status: 403 };
    }

    // 2) Extension allowlist.
    const ext = path.extname(abs).toLowerCase();
    if (!MEDIA_EXTENSIONS.has(ext)) {
      return { error: `media extension not allowed: ${ext || '(none)'}`, status: 415 };
    }

    // 3) Realpath containment: a symlink INSIDE the worktree pointing OUT
    // (e.g. .agent-evidence/leak.png -> ~/.ssh/id_rsa) passes steps 1-2 but
    // must not be served. Resolve both through realpath and re-check.
    let realRoot;
    try {
      realRoot = fs.realpathSync(rootResolved);
    } catch {
      return { error: 'evidence worktree no longer exists', status: 404 };
    }
    let realTarget;
    try {
      realTarget = fs.realpathSync(abs);
    } catch {
      return { error: 'media file not found', status: 404 };
    }
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
      return { error: 'media path escapes the evidence worktree', status: 403 };
    }

    // 4) Must be a regular file.
    let stat;
    try {
      stat = fs.lstatSync(realTarget);
    } catch {
      return { error: 'media file not found', status: 404 };
    }
    if (!stat.isFile()) {
      return { error: 'media target is not a regular file', status: 415 };
    }

    return { path: realTarget };
  }
}

module.exports = {
  EvidenceService,
  parseEvidenceBlocks,
  mergeEvidence
};
