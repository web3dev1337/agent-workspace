const express = require('express');
const { Octokit } = require('@octokit/rest');
const { getCache } = require('../cache/database');
const router = express.Router();

// Initialize GitHub client
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

// Get database cache instance
const dbCache = getCache();

// Get PR data
router.get('/pr/:owner/:repo/:pr', async (req, res) => {
  try {
    const { owner, repo, pr } = req.params;
    
    // Check cache
    const cached = dbCache.getMetadata('pr', owner, repo, pr);
    if (cached) {
      return res.json(cached);
    }

    // Fetch PR data
    console.log(`📥 Fetching PR #${pr} from ${owner}/${repo}...`);
    
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
      files: files.data.map(file => {
        // Extract content from patch if available
        let oldContent = '';
        let newContent = '';
        
        if (file.patch) {
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
          } 
          // For modified files, extract both old and new
          else if (file.status === 'modified') {
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
          }
          // For removed files
          else if (file.status === 'removed') {
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
          }
        }
        
        return {
          filename: file.filename,
          path: file.filename, // Add path field for frontend compatibility
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
      })
    };

    console.log(`✅ Fetched ${files.data.length} files for PR #${pr}`);
    console.log(`📊 First file: ${files.data[0]?.filename || 'none'}`);
    console.log(`📊 Has patch data: ${files.data.filter(f => f.patch).length}/${files.data.length} files`);
    
    // Debug first file content extraction
    if (files.data[0]) {
      const firstFile = result.files[0];
      console.log(`🔍 First file content extraction:`);
      console.log(`   - Status: ${firstFile.status}`);
      console.log(`   - oldContent length: ${firstFile.oldContent?.length || 0}`);
      console.log(`   - newContent length: ${firstFile.newContent?.length || 0}`);
      if (firstFile.newContent && firstFile.newContent.length > 0) {
        console.log(`   - newContent preview: "${firstFile.newContent.substring(0, 50)}..."`);
      }
    }
    
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

// Get commit data
router.get('/commit/:owner/:repo/:sha', async (req, res) => {
  try {
    const { owner, repo, sha } = req.params;
    
    // Check cache
    const cached = dbCache.getMetadata('commit', owner, repo, sha);
    if (cached) {
      return res.json(cached);
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