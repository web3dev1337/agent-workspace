const { exec } = require('child_process');
const util = require('util');
const path = require('path');

const execAsync = util.promisify(exec);

const parsePorcelainFiles = (porcelain) => {
  const files = new Set();
  const raw = String(porcelain || '');
  if (!raw || !raw.trim()) return [];
  for (const line of raw.split('\n')) {
    const trimmed = String(line || '').replace(/\r$/, '').trimEnd();
    if (!trimmed.trim()) continue;
    // Porcelain is typically: "XY <path>" or "?? <path>"
    let file = trimmed.slice(3).trim();
    if (!file) continue;
    if (file.includes(' -> ')) {
      const parts = file.split(' -> ');
      file = parts[parts.length - 1].trim();
    }
    files.add(file);
  }
  return Array.from(files);
};

class WorktreeConflictService {
  constructor({ projectMetadataService, worktreeMetadataService } = {}) {
    this.projectMetadataService = projectMetadataService;
    this.worktreeMetadataService = worktreeMetadataService;
  }

  async getChangedFiles(worktreePath) {
    try {
      const { stdout } = await execAsync('git status --porcelain', {
        cwd: worktreePath,
        timeout: 7000
      });
      return parsePorcelainFiles(stdout);
    } catch {
      return [];
    }
  }

  async analyze({ paths = [], refresh = false } = {}) {
    const unique = Array.from(new Set((Array.isArray(paths) ? paths : []).filter(Boolean)));
    const items = await Promise.all(unique.map(async (worktreePath) => {
      const project = this.projectMetadataService
        ? await this.projectMetadataService.getForWorktree(worktreePath, { refresh })
        : null;

      const git = this.worktreeMetadataService
        ? await this.worktreeMetadataService.getGitStatus(worktreePath)
        : null;

      const pr = this.worktreeMetadataService
        ? await this.worktreeMetadataService.getPRStatus(worktreePath)
        : null;

      const changedFiles = await this.getChangedFiles(worktreePath);

      return {
        worktreePath,
        projectKey: project?.projectKey || '',
        projectRoot: project?.projectRoot || '',
        baseImpactRisk: project?.baseImpactRisk || 'low',
        branch: git?.branch || null,
        pr: pr || { hasPR: false },
        changedFiles
      };
    }));

    const groups = new Map();
    for (const item of items) {
      const key = item.projectKey || item.projectRoot || path.resolve(item.worktreePath);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }

    const conflicts = [];
    for (const [projectKey, group] of groups.entries()) {
      if (group.length < 2) continue;

      const sets = group.map(g => ({ ...g, fileSet: new Set(g.changedFiles || []) }));
      for (let i = 0; i < sets.length; i += 1) {
        for (let j = i + 1; j < sets.length; j += 1) {
          const a = sets[i];
          const b = sets[j];
          const overlap = [];
          for (const f of a.fileSet) {
            if (b.fileSet.has(f)) overlap.push(f);
          }
          const bothDirty = (a.changedFiles?.length || 0) > 0 && (b.changedFiles?.length || 0) > 0;
          const bothHavePR = !!a.pr?.hasPR && !!b.pr?.hasPR;

          if (overlap.length === 0 && !bothDirty && !bothHavePR) continue;

          let type = 'same-project';
          if (overlap.length > 0) type = 'file-overlap';
          else if (bothHavePR) type = 'parallel-prs';
          else if (bothDirty) type = 'parallel-uncommitted';

          conflicts.push({
            projectKey,
            type,
            a: { worktreePath: a.worktreePath, branch: a.branch, pr: a.pr, changedFilesCount: a.changedFiles.length },
            b: { worktreePath: b.worktreePath, branch: b.branch, pr: b.pr, changedFilesCount: b.changedFiles.length },
            overlapFiles: overlap.slice(0, 50)
          });
        }
      }
    }

    const grouped = Array.from(groups.entries()).map(([projectKey, group]) => ({
      projectKey,
      baseImpactRisk: group[0]?.baseImpactRisk || 'low',
      projectRoot: group[0]?.projectRoot || '',
      worktrees: group.map(g => ({
        worktreePath: g.worktreePath,
        branch: g.branch,
        pr: g.pr,
        changedFilesCount: g.changedFiles.length
      }))
    }));

    return {
      count: conflicts.length,
      conflicts,
      groups: grouped
    };
  }
}

module.exports = { WorktreeConflictService, parsePorcelainFiles };
