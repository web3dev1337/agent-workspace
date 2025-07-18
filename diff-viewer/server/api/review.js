const express = require('express');
const { getCache } = require('../cache/database');

const router = express.Router();

/**
 * Get review state for a PR
 */
router.get('/state/:owner/:repo/:pr', (req, res) => {
  try {
    const { owner, repo, pr } = req.params;
    const prId = `${owner}/${repo}/${pr}`;
    const cache = getCache();
    
    // Get total files from query param
    const totalFiles = parseInt(req.query.totalFiles) || 0;
    
    // Get review progress
    const progress = cache.getReviewProgress(prId, totalFiles);
    
    res.json({
      success: true,
      progress
    });
  } catch (error) {
    console.error('Error getting review state:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get review state for a specific file
 */
router.get('/state/:owner/:repo/:pr/file', (req, res) => {
  try {
    const { owner, repo, pr } = req.params;
    const filePath = req.query.path;
    
    if (!filePath) {
      return res.status(400).json({
        success: false,
        error: 'File path is required'
      });
    }
    
    const prId = `${owner}/${repo}/${pr}`;
    const cache = getCache();
    
    const state = cache.getFileReviewState(prId, filePath);
    
    res.json({
      success: true,
      state: state || { reviewed: false }
    });
  } catch (error) {
    console.error('Error getting file review state:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Mark a file as reviewed/unreviewed
 */
router.post('/state/:owner/:repo/:pr/file', (req, res) => {
  try {
    const { owner, repo, pr } = req.params;
    const { filePath, reviewed, notes } = req.body;
    
    if (!filePath) {
      return res.status(400).json({
        success: false,
        error: 'File path is required'
      });
    }
    
    const prId = `${owner}/${repo}/${pr}`;
    const cache = getCache();
    
    cache.setFileReviewState(prId, filePath, reviewed, notes);
    
    // Update session if provided
    const sessionId = req.body.sessionId;
    if (sessionId) {
      const progress = cache.getReviewProgress(prId, req.body.totalFiles || 0);
      cache.updateSessionProgress(sessionId, progress.reviewed, filePath);
    }
    
    res.json({
      success: true,
      reviewed
    });
  } catch (error) {
    console.error('Error setting file review state:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Batch mark files as reviewed
 */
router.post('/state/:owner/:repo/:pr/batch', (req, res) => {
  try {
    const { owner, repo, pr } = req.params;
    const { files, reviewed } = req.body;
    
    if (!Array.isArray(files)) {
      return res.status(400).json({
        success: false,
        error: 'Files must be an array'
      });
    }
    
    const prId = `${owner}/${repo}/${pr}`;
    const cache = getCache();
    
    // Mark all files
    files.forEach(filePath => {
      cache.setFileReviewState(prId, filePath, reviewed);
    });
    
    // Get updated progress
    const progress = cache.getReviewProgress(prId, req.body.totalFiles || files.length);
    
    res.json({
      success: true,
      progress
    });
  } catch (error) {
    console.error('Error batch marking files:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Create or resume a review session
 */
router.post('/session/:owner/:repo/:pr', (req, res) => {
  try {
    const { owner, repo, pr } = req.params;
    const { totalFiles } = req.body;
    
    const prId = `${owner}/${repo}/${pr}`;
    const cache = getCache();
    
    const sessionId = cache.createOrResumeSession(prId, totalFiles || 0);
    const session = cache.getSessionDetails(sessionId);
    
    res.json({
      success: true,
      sessionId,
      session
    });
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;