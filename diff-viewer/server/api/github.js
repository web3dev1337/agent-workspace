const express = require('express');
const { Octokit } = require('@octokit/rest');
const { execFile } = require('child_process');
const util = require('util');
const { getCache } = require('../cache/database');
const router = express.Router();

const execFileAsync = util.promisify(execFile);

const hasGitHubToken = () => typeof process.env.GITHUB_TOKEN === 'string' && process.env.GITHUB_TOKEN.trim().length > 0;

// Initialize GitHub client (optional). If not provided, we fall back to `gh api`
// which uses the user's authenticated GitHub CLI session (works for private repos too).
const octokit = hasGitHubToken()
  ? new Octokit({ auth: process.env.GITHUB_TOKEN.trim() })
  : null;

async function ghApiJson(endpoint, params = {}, timeout = 20000) {
  const args = ['api', '-X', 'GET', endpoint];

  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    args.push('-f', `${key}=${value}`);
  });

  try {
    const { stdout } = await execFileAsync('gh', args, { timeout });
    return JSON.parse(stdout || 'null');
  } catch (error) {
    const message = error?.stderr || error?.message || String(error);
    const hint = hasGitHubToken()
      ? 'GITHUB_TOKEN is set but Octokit failed; check token scopes or connectivity.'
      : 'No GITHUB_TOKEN set; ensure `gh auth status` shows you are logged in.';
    throw new Error(`Failed to call gh api (${endpoint}): ${message}\n${hint}`);
  }
}

async function ghApiGetAllPages(endpoint, params = {}, { perPage = 100, maxPages = 20, timeout = 20000 } = {}) {
  const all = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const pageData = await ghApiJson(endpoint, { ...params, per_page: perPage, page }, timeout);
    if (!Array.isArray(pageData)) {
      throw new Error(`Expected array from gh api (${endpoint}), got ${typeof pageData}`);
    }
    all.push(...pageData);
    if (pageData.length < perPage) break;
  }
  return all;
}

function extractContentsFromPatch(file) {
  let oldContent = '';
  let newContent = '';

  if (!file || !file.patch) {
    return { oldContent, newContent };
  }

  // For new files, the patch contains the entire content
  if (file.status === 'added') {
    const lines = file.patch.split('\n');
    const contentLines = [];

    lines.forEach(line => {
      // Skip git headers and hunk markers
      if (line.startsWith('@@') || line.startsWith('+++') || line.startsWith('---')) {
        return;
      }
      // New content lines start with +
      if (line.startsWith('+')) {
        contentLines.push(line.substring(1));
      }
    });

    oldContent = '';
    newContent = contentLines.join('\n');
    return { oldContent, newContent };
  }

  // For modified files, extract both old and new
  if (file.status === 'modified') {
    const lines = file.patch.split('\n');
    const oldLines = [];
    const newLines = [];

    lines.forEach(line => {
      if (line.startsWith('@@') || line.startsWith('+++') || line.startsWith('---')) {
        return;
      }

      if (line.startsWith('-')) {
        oldLines.push(line.substring(1));
      } else if (line.startsWith('+')) {
        newLines.push(line.substring(1));
      } else if (line.startsWith(' ')) {
        // Context line - add to both
        oldLines.push(line.substring(1));
        newLines.push(line.substring(1));
      }
    });

    oldContent = oldLines.join('\n');
    newContent = newLines.join('\n');
    return { oldContent, newContent };
  }

  // For removed files
  if (file.status === 'removed') {
    const lines = file.patch.split('\n');
    const contentLines = [];

    lines.forEach(line => {
      if (line.startsWith('@@') || line.startsWith('+++') || line.startsWith('---')) {
        return;
      }
      if (line.startsWith('-')) {
        contentLines.push(line.substring(1));
      }
    });

    oldContent = contentLines.join('\n');
    newContent = '';
    return { oldContent, newContent };
  }

  return { oldContent, newContent };
}

function normalizeFileEntry(file) {
  const { oldContent, newContent } = extractContentsFromPatch(file);
  return {
    filename: file.filename,
    path: file.filename, // frontend compatibility
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    changes: file.changes,
    patch: file.patch,
    oldContent,
    newContent,
    sha: file.sha,
    blob_url: file.blob_url,
    raw_url: file.raw_url,
    contents_url: file.contents_url
  };
}

// Get database cache instance
const dbCache = getCache();

// Get PR data
router.get('/pr/:owner/:repo/:pr', async (req, res) => {
  try {
    const { owner, repo, pr } = req.params;
    const prNumber = parseInt(pr, 10);
    if (!Number.isFinite(prNumber)) {
      return res.status(400).json({ error: 'Invalid PR number' });
    }
    
    // Check cache
    const cached = dbCache.getMetadata('pr', owner, repo, pr);
    if (cached) {
      return res.json(cached);
    }

    // Fetch PR data
    console.log(`📥 Fetching PR #${pr} from ${owner}/${repo}...`);

    let prData;
    let files;

    if (octokit) {
      const [prRes, filesRes] = await Promise.all([
        octokit.pulls.get({
          owner,
          repo,
          pull_number: prNumber
        }),
        octokit.pulls.listFiles({
          owner,
          repo,
          pull_number: prNumber,
          per_page: 100
        })
      ]);

      prData = prRes?.data;
      files = filesRes?.data || [];
    } else {
      prData = await ghApiJson(`repos/${owner}/${repo}/pulls/${prNumber}`);
      files = await ghApiGetAllPages(`repos/${owner}/${repo}/pulls/${prNumber}/files`);
    }

    const result = {
      pr: {
        number: prData.number,
        title: prData.title,
        body: prData.body,
        state: prData.state,
        user: prData.user?.login,
        created_at: prData.created_at,
        updated_at: prData.updated_at,
        base: prData.base?.ref,
        head: prData.head?.ref,
        additions: prData.additions,
        deletions: prData.deletions,
        changed_files: prData.changed_files
      },
      files: Array.isArray(files) ? files.map(normalizeFileEntry) : []
    };

    console.log(`✅ Fetched ${result.files.length} files for PR #${pr}`);
    
    // Cache result
    dbCache.setMetadata('pr', owner, repo, pr, result);

    res.json(result);
  } catch (error) {
    console.error('GitHub API error:', error);
    res.status(error.status || 500).json({
      error: 'Failed to fetch PR data',
      message: error.message
    });
  }
});

// Merge a PR (uses the user's authenticated GitHub CLI session)
router.post('/pr/:owner/:repo/:pr/merge', async (req, res) => {
  try {
    const owner = String(req.params?.owner || '').trim();
    const repo = String(req.params?.repo || '').trim();
    const prNumber = parseInt(String(req.params?.pr || ''), 10);
    const methodRaw = String(req.body?.method || 'merge').trim().toLowerCase();
    const auto = !!req.body?.auto;

    if (!owner || !repo || !Number.isFinite(prNumber)) {
      return res.status(400).json({ error: 'Invalid PR identifier' });
    }
    if (!['merge', 'squash', 'rebase'].includes(methodRaw)) {
      return res.status(400).json({ error: 'method must be merge|squash|rebase' });
    }

    const mergeFlag = methodRaw === 'squash'
      ? '--squash'
      : (methodRaw === 'rebase' ? '--rebase' : '--merge');

    const args = ['pr', 'merge', String(prNumber), '--repo', `${owner}/${repo}`, mergeFlag];
    if (auto) args.push('--auto');

    const { stdout } = await execFileAsync('gh', args, { timeout: 60000 });

    // Best-effort: invalidate cached metadata/diff since the PR state likely changed.
    try {
      dbCache?.deleteMetadata?.('pr', owner, repo, String(prNumber));
      dbCache?.deleteDiff?.('pr', owner, repo, String(prNumber));
    } catch {
      // ignore
    }

    res.json({
      ok: true,
      owner,
      repo,
      number: prNumber,
      method: methodRaw,
      auto,
      stdout: String(stdout || '')
    });
  } catch (error) {
    const message = error?.stderr || error?.message || String(error);
    res.status(500).json({
      error: 'Failed to merge PR',
      message
    });
  }
});

// Get commit data
router.get('/commit/:owner/:repo/:sha', async (req, res) => {
  try {
    const { owner, repo, sha } = req.params;
    
    // Check cache
    const cached = dbCache.getMetadata('commit', owner, repo, sha);
    if (cached) {
      return res.json(cached);
    }

    let commitData;
    if (octokit) {
      const commitRes = await octokit.repos.getCommit({
        owner,
        repo,
        ref: sha
      });
      commitData = commitRes?.data;
    } else {
      commitData = await ghApiJson(`repos/${owner}/${repo}/commits/${sha}`);
    }

    const result = {
      commit: {
        sha: commitData.sha,
        message: commitData.commit?.message,
        author: commitData.commit?.author,
        committer: commitData.commit?.committer,
        stats: commitData.stats,
        parents: (commitData.parents || []).map(p => p.sha)
      },
      files: (commitData.files || []).map(file => ({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
        patch: file.patch,
        sha: file.sha,
        blob_url: file.blob_url,
        raw_url: file.raw_url,
        contents_url: file.contents_url
      }))
    };

    // Cache result
    dbCache.setMetadata('commit', owner, repo, sha, result);

    res.json(result);
  } catch (error) {
    console.error('GitHub API error:', error);
    res.status(error.status || 500).json({
      error: 'Failed to fetch commit data',
      message: error.message
    });
  }
});

// Get file content
router.get('/file/:owner/:repo/:path(*)', async (req, res) => {
  try {
    const { owner, repo, path } = req.params;
    const { ref } = req.query;

    let contentData;
    if (octokit) {
      const content = await octokit.repos.getContent({
        owner,
        repo,
        path,
        ref
      });
      contentData = content?.data;
    } else {
      // Encode each segment but keep slashes intact
      const encodedPath = String(path || '')
        .split('/')
        .map(seg => encodeURIComponent(seg))
        .join('/');
      contentData = await ghApiJson(`repos/${owner}/${repo}/contents/${encodedPath}`, ref ? { ref } : {});
    }

    if (Array.isArray(contentData)) {
      return res.status(400).json({ error: 'Path is a directory' });
    }

    res.json({
      name: contentData.name,
      path: contentData.path,
      sha: contentData.sha,
      size: contentData.size,
      content: Buffer.from(contentData.content, 'base64').toString('utf-8'),
      encoding: contentData.encoding
    });
  } catch (error) {
    console.error('GitHub API error:', error);
    res.status(error.status || 500).json({
      error: 'Failed to fetch file content',
      message: error.message
    });
  }
});

// Get cache statistics
router.get('/cache/stats', (req, res) => {
  try {
    const stats = dbCache.getStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get cache stats',
      message: error.message
    });
  }
});

// Clear expired cache entries
router.post('/cache/cleanup', (req, res) => {
  try {
    const deletedCount = dbCache.cleanup();
    res.json({ 
      message: 'Cache cleanup completed',
      deletedEntries: deletedCount 
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to cleanup cache',
      message: error.message
    });
  }
});

module.exports = router;
