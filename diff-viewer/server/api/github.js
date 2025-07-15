const express = require('express');
const { Octokit } = require('@octokit/rest');
const router = express.Router();

// Initialize GitHub client
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

// Cache for GitHub data (simple in-memory for MVP)
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Get PR data
router.get('/pr/:owner/:repo/:pr', async (req, res) => {
  try {
    const { owner, repo, pr } = req.params;
    const cacheKey = `pr:${owner}/${repo}/${pr}`;
    
    // Check cache
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return res.json(cached.data);
    }

    // Fetch PR data
    const [prData, files] = await Promise.all([
      octokit.pulls.get({
        owner,
        repo,
        pull_number: parseInt(pr)
      }),
      octokit.pulls.listFiles({
        owner,
        repo,
        pull_number: parseInt(pr),
        per_page: 100
      })
    ]);

    const result = {
      pr: {
        number: prData.data.number,
        title: prData.data.title,
        body: prData.data.body,
        state: prData.data.state,
        user: prData.data.user.login,
        created_at: prData.data.created_at,
        updated_at: prData.data.updated_at,
        base: prData.data.base.ref,
        head: prData.data.head.ref,
        additions: prData.data.additions,
        deletions: prData.data.deletions,
        changed_files: prData.data.changed_files
      },
      files: files.data.map(file => ({
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
    cache.set(cacheKey, {
      data: result,
      timestamp: Date.now()
    });

    res.json(result);
  } catch (error) {
    console.error('GitHub API error:', error);
    res.status(error.status || 500).json({
      error: 'Failed to fetch PR data',
      message: error.message
    });
  }
});

// Get commit data
router.get('/commit/:owner/:repo/:sha', async (req, res) => {
  try {
    const { owner, repo, sha } = req.params;
    const cacheKey = `commit:${owner}/${repo}/${sha}`;
    
    // Check cache
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return res.json(cached.data);
    }

    // Fetch commit data
    const commitData = await octokit.repos.getCommit({
      owner,
      repo,
      ref: sha
    });

    const result = {
      commit: {
        sha: commitData.data.sha,
        message: commitData.data.commit.message,
        author: commitData.data.commit.author,
        committer: commitData.data.commit.committer,
        stats: commitData.data.stats,
        parents: commitData.data.parents.map(p => p.sha)
      },
      files: commitData.data.files.map(file => ({
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
    cache.set(cacheKey, {
      data: result,
      timestamp: Date.now()
    });

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

    const content = await octokit.repos.getContent({
      owner,
      repo,
      path,
      ref
    });

    if (Array.isArray(content.data)) {
      return res.status(400).json({ error: 'Path is a directory' });
    }

    res.json({
      name: content.data.name,
      path: content.data.path,
      sha: content.data.sha,
      size: content.data.size,
      content: Buffer.from(content.data.content, 'base64').toString('utf-8'),
      encoding: content.data.encoding
    });
  } catch (error) {
    console.error('GitHub API error:', error);
    res.status(error.status || 500).json({
      error: 'Failed to fetch file content',
      message: error.message
    });
  }
});

module.exports = router;