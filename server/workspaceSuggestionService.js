const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const util = require('util');

const execAsync = util.promisify(exec);

class WorkspaceSuggestionService {
  constructor({ workspaceManager } = {}) {
    this.workspaceManager = workspaceManager;
  }

  _normalizeRepoPath(p) {
    if (!p) return null;
    try {
      const resolved = path.resolve(String(p));
      return resolved;
    } catch {
      return String(p);
    }
  }

  _safeRepoLabel(repoPath) {
    const p = String(repoPath || '').trim();
    if (!p) return '';
    const base = path.basename(p);
    return base || p;
  }

  _extractReposFromWorkspace(workspace) {
    if (!workspace || typeof workspace !== 'object') return [];
    const repos = new Map(); // path -> { path, name }

    if (Array.isArray(workspace.terminals)) {
      for (const t of workspace.terminals) {
        const p = this._normalizeRepoPath(t?.repository?.path);
        if (!p) continue;
        repos.set(p, { path: p, name: t?.repository?.name || this._safeRepoLabel(p) });
      }
    } else if (workspace.repository?.path) {
      const p = this._normalizeRepoPath(workspace.repository.path);
      repos.set(p, { path: p, name: workspace.repository?.name || this._safeRepoLabel(p) });
    }

    return Array.from(repos.values());
  }

  async _getLastCommitEpochSeconds(repoPath) {
    const p = this._normalizeRepoPath(repoPath);
    if (!p) return null;

    // Best-effort; if not a git repo, returns null.
    try {
      const { stdout } = await execAsync('git log -1 --format=%ct', {
        cwd: p,
        timeout: 2500,
        env: {
          ...process.env,
          GIT_CONFIG_NOSYSTEM: '1',
          HOME: process.env.HOME || os.homedir()
        }
      });
      const s = String(stdout || '').trim();
      const n = Number(s);
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  }

  async getSuggestions({ limit = 8 } = {}) {
    const max = Math.max(1, Math.min(25, Number(limit) || 8));
    const workspaces = Array.isArray(this.workspaceManager?.listWorkspaces?.())
      ? this.workspaceManager.listWorkspaces()
      : [];

    const repoToWorkspaces = new Map(); // repoPath -> Set(workspaceId)
    const pairCounts = new Map(); // "a|b" -> count
    const repoMeta = new Map(); // repoPath -> { path, name }

    for (const w of workspaces) {
      const repos = this._extractReposFromWorkspace(w);
      const uniquePaths = Array.from(new Set(repos.map(r => r.path).filter(Boolean))).sort();
      for (const r of repos) repoMeta.set(r.path, r);
      for (const p of uniquePaths) {
        if (!repoToWorkspaces.has(p)) repoToWorkspaces.set(p, new Set());
        repoToWorkspaces.get(p).add(w.id || w.name || 'unknown');
      }
      for (let i = 0; i < uniquePaths.length; i++) {
        for (let j = i + 1; j < uniquePaths.length; j++) {
          const a = uniquePaths[i];
          const b = uniquePaths[j];
          const key = `${a}|${b}`;
          pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
        }
      }
    }

    const frequentCombos = Array.from(pairCounts.entries())
      .map(([key, count]) => {
        const [a, b] = key.split('|');
        const ra = repoMeta.get(a) || { path: a, name: this._safeRepoLabel(a) };
        const rb = repoMeta.get(b) || { path: b, name: this._safeRepoLabel(b) };
        const wa = repoToWorkspaces.get(a) ? Array.from(repoToWorkspaces.get(a)) : [];
        const wb = repoToWorkspaces.get(b) ? Array.from(repoToWorkspaces.get(b)) : [];
        const inWorkspaces = Array.from(new Set([...wa, ...wb])).slice(0, 8);
        return {
          kind: 'combo',
          score: count,
          label: `${ra.name} + ${rb.name}`,
          repositories: [ra, rb],
          seenInWorkspaces: inWorkspaces
        };
      })
      .sort((x, y) => (y.score - x.score) || String(x.label).localeCompare(String(y.label)))
      .slice(0, max);

    const repoPaths = Array.from(repoMeta.keys());
    const recentCandidates = [];
    for (const p of repoPaths.slice(0, 30)) {
      const lastCommit = await this._getLastCommitEpochSeconds(p);
      if (!lastCommit) continue;
      recentCandidates.push({ path: p, lastCommit });
    }

    recentCandidates.sort((a, b) => b.lastCommit - a.lastCommit);
    const recentRepos = recentCandidates.slice(0, max).map((r) => {
      const meta = repoMeta.get(r.path) || { path: r.path, name: this._safeRepoLabel(r.path) };
      return {
        kind: 'recent',
        score: r.lastCommit,
        label: meta.name,
        repositories: [meta],
        lastCommitEpochSeconds: r.lastCommit
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      sources: {
        workspaceCount: workspaces.length,
        repoCount: repoMeta.size
      },
      suggestions: {
        frequentCombos,
        recentRepos
      }
    };
  }
}

module.exports = { WorkspaceSuggestionService };

