const express = require('express');
const router = express.Router();
const { DiffEngine } = require('../diff-engine/engine');
const { AIAnalyzer } = require('../diff-engine/ai-analyzer');
const { getCache } = require('../cache/database');

const diffEngine = new DiffEngine();
const aiAnalyzer = new AIAnalyzer();
const dbCache = getCache();

// Get diff analysis for a PR
router.get('/pr/:owner/:repo/:pr', async (req, res) => {
  try {
    const { owner, repo, pr } = req.params;
    
    // Check cache
    const cached = dbCache.getDiff('pr', owner, repo, pr);
    if (cached) {
      console.log('📦 Returning cached diff data');
      return res.json(cached.analysis);
    }
    console.log('🔄 No cache found, generating new analysis...');
    
    // Get PR data from GitHub API cache
    const prData = dbCache.getMetadata('pr', owner, repo, pr);
    if (!prData) {
      return res.status(404).json({ error: 'PR data not found. Fetch from GitHub first.' });
    }
    
    const { files } = prData;
    
    // Analyze each file with enhanced content support
    const analyzedFiles = await Promise.all(
      files.map(async file => {
        // Handle different file types
        const diffAnalysis = await diffEngine.analyzeDiff(file);
        
        console.log(`📊 Analysis for ${file.filename}:`, {
          hasAnalysis: !!diffAnalysis,
          type: diffAnalysis?.type,
          hasRefactorings: !!diffAnalysis?.refactorings,
          hasStats: !!diffAnalysis?.stats
        });
        
        return {
          filename: file.filename,
          path: file.filename,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          patch: file.patch,
          // Include the full analysis for SmartDiffView
          analysis: diffAnalysis,
          // Legacy support
          ...diffAnalysis,
          semanticChanges: diffAnalysis.stats
        };
      })
    );
    
    // Calculate overall stats
    const stats = calculateOverallStats(analyzedFiles);
    
    const result = {
      files: analyzedFiles,
      stats,
      metadata: {
        pr: prData.pr,
        analyzedAt: new Date().toISOString()
      }
    };
    
    // Cache the analysis
    const semanticReduction = stats.semanticReduction || 0;
    dbCache.setDiff('pr', owner, repo, pr, result, semanticReduction);
    
    res.json(result);
  } catch (error) {
    console.error('PR diff analysis error:', error);
    res.status(500).json({
      error: 'Failed to analyze PR diff',
      message: error.message
    });
  }
});

// Get diff analysis for a commit
router.get('/commit/:owner/:repo/:sha', async (req, res) => {
  try {
    const { owner, repo, sha } = req.params;
    
    // Similar logic for commits
    const cached = dbCache.getDiff('commit', owner, repo, sha);
    if (cached) {
      return res.json(cached.analysis);
    }
    
    const commitData = dbCache.getMetadata('commit', owner, repo, sha);
    if (!commitData) {
      return res.status(404).json({ error: 'Commit data not found. Fetch from GitHub first.' });
    }
    
    // Process similar to PR
    const { files } = commitData;
    const analyzedFiles = await Promise.all(
      files.map(file => diffEngine.analyzeDiff(file))
    );
    
    const stats = calculateOverallStats(analyzedFiles);
    const result = {
      files: analyzedFiles,
      stats,
      metadata: {
        commit: commitData.commit,
        analyzedAt: new Date().toISOString()
      }
    };
    
    dbCache.setDiff('commit', owner, repo, sha, result, stats.semanticReduction || 0);
    
    res.json(result);
  } catch (error) {
    console.error('Commit diff analysis error:', error);
    res.status(500).json({
      error: 'Failed to analyze commit diff',
      message: error.message
    });
  }
});

// Get diff analysis for a compare (base...head)
router.get('/compare/:owner/:repo', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const base = String(req.query.base || '').trim();
    const head = String(req.query.head || '').trim();

    if (!base || !head) {
      return res.status(400).json({ error: 'Missing base/head query params' });
    }

    const cacheKey = `${encodeURIComponent(base)}...${encodeURIComponent(head)}`;

    const cached = dbCache.getDiff('compare', owner, repo, cacheKey);
    if (cached) {
      return res.json(cached.analysis);
    }

    const compareData = dbCache.getMetadata('compare', owner, repo, cacheKey);
    if (!compareData) {
      return res.status(404).json({ error: 'Compare data not found. Fetch from GitHub first.' });
    }

    const { files } = compareData;
    const analyzedFiles = await Promise.all(
      (Array.isArray(files) ? files : []).map(async file => {
        const diffAnalysis = await diffEngine.analyzeDiff(file);
        return {
          filename: file.filename,
          path: file.filename,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          patch: file.patch,
          analysis: diffAnalysis,
          ...diffAnalysis,
          semanticChanges: diffAnalysis.stats
        };
      })
    );

    const stats = calculateOverallStats(analyzedFiles);
    const result = {
      files: analyzedFiles,
      stats,
      metadata: {
        compare: compareData.compare,
        analyzedAt: new Date().toISOString()
      }
    };

    dbCache.setDiff('compare', owner, repo, cacheKey, result, stats.semanticReduction || 0);
    res.json(result);
  } catch (error) {
    console.error('Compare diff analysis error:', error);
    res.status(500).json({
      error: 'Failed to analyze compare diff',
      message: error.message
    });
  }
});

// Process custom diff analysis
router.post('/analyze', async (req, res) => {
  try {
    const { files, prInfo } = req.body;

    // Process files in parallel
    const results = await Promise.all(
      files.map(async (file) => {
        // Skip binary files
        if (file.patch === undefined) {
          return {
            filename: file.filename,
            status: file.status,
            binary: true,
            analysis: {
              summary: 'Binary file changed',
              changes: []
            }
          };
        }

        // Get semantic diff
        const semanticDiff = await diffEngine.analyzeDiff(file);
        
        // Get AI analysis if enabled
        let aiAnalysis = null;
        if (process.env.ENABLE_AI_ANALYSIS === 'true') {
          aiAnalysis = await aiAnalyzer.analyzeChanges(semanticDiff, file);
        }

        return {
          filename: file.filename,
          status: file.status,
          semanticDiff,
          aiAnalysis,
          metrics: {
            linesShown: semanticDiff.changes.length,
            linesOriginal: file.additions + file.deletions,
            reduction: calculateReduction(semanticDiff, file)
          }
        };
      })
    );

    // Generate PR-level summary
    const prSummary = await generatePRSummary(results, prInfo);

    res.json({
      pr: prInfo,
      files: results,
      summary: prSummary,
      metrics: calculateOverallMetrics(results)
    });
  } catch (error) {
    console.error('Diff analysis error:', error);
    res.status(500).json({
      error: 'Failed to analyze diff',
      message: error.message
    });
  }
});

// Get diff between two commits
router.post('/compare', async (req, res) => {
  try {
    const { baseCommit, headCommit, files } = req.body;

    const results = await Promise.all(
      files.map(file => diffEngine.compareCommits(file, baseCommit, headCommit))
    );

    res.json({
      base: baseCommit,
      head: headCommit,
      files: results
    });
  } catch (error) {
    console.error('Compare error:', error);
    res.status(500).json({
      error: 'Failed to compare commits',
      message: error.message
    });
  }
});

// Utility functions
function calculateReduction(semanticDiff, originalFile) {
  const originalLines = originalFile.additions + originalFile.deletions;
  const shownLines = semanticDiff.changes.filter(c => c.significant).length;
  return originalLines > 0 ? ((originalLines - shownLines) / originalLines * 100).toFixed(1) : 0;
}

function calculateOverallMetrics(results) {
  const totals = results.reduce((acc, file) => {
    if (!file.binary) {
      acc.originalLines += file.metrics.linesOriginal;
      acc.shownLines += file.metrics.linesShown;
    }
    return acc;
  }, { originalLines: 0, shownLines: 0 });

  return {
    totalFiles: results.length,
    binaryFiles: results.filter(f => f.binary).length,
    totalOriginalLines: totals.originalLines,
    totalShownLines: totals.shownLines,
    overallReduction: totals.originalLines > 0 
      ? ((totals.originalLines - totals.shownLines) / totals.originalLines * 100).toFixed(1)
      : 0
  };
}

function calculateOverallStats(analyzedFiles) {
  let totalOriginal = 0;
  let totalSignificant = 0;
  let totalAdded = 0;
  let totalDeleted = 0;
  
  analyzedFiles.forEach(file => {
    if (file.stats) {
      totalOriginal += file.additions + file.deletions;
      totalSignificant += file.stats.significant || 0;
      totalAdded += file.additions || 0;
      totalDeleted += file.deletions || 0;
    }
  });
  
  const semanticReduction = totalOriginal > 0
    ? ((totalOriginal - totalSignificant) / totalOriginal * 100).toFixed(1)
    : 0;
  
  return {
    files: analyzedFiles.length,
    additions: totalAdded,
    deletions: totalDeleted,
    changes: totalAdded + totalDeleted,
    semanticReduction: parseFloat(semanticReduction)
  };
}

async function generatePRSummary(fileResults, prInfo) {
  const significantChanges = fileResults
    .filter(f => !f.binary)
    .map(f => ({
      file: f.filename,
      summary: f.aiAnalysis?.summary || 'Changes detected'
    }));

  return {
    title: prInfo.title,
    description: `This PR modifies ${fileResults.length} files with ${significantChanges.length} significant changes.`,
    keyChanges: significantChanges.slice(0, 5),
    risks: extractRisks(fileResults),
    recommendations: generateRecommendations(fileResults)
  };
}

function extractRisks(fileResults) {
  const risks = [];
  fileResults.forEach(file => {
    if (file.aiAnalysis?.risks) {
      risks.push(...file.aiAnalysis.risks);
    }
  });
  return risks.sort((a, b) => b.severity - a.severity).slice(0, 5);
}

function generateRecommendations(fileResults) {
  const recommendations = [];
  
  // Check for common patterns
  const hasLargeFiles = fileResults.some(f => f.metrics?.linesOriginal > 500);
  const hasDuplication = fileResults.some(f => f.aiAnalysis?.duplication);
  
  if (hasLargeFiles) {
    recommendations.push('Consider breaking down large file changes into smaller PRs');
  }
  
  if (hasDuplication) {
    recommendations.push('Detected code duplication - consider refactoring to reduce redundancy');
  }
  
  return recommendations;
}

module.exports = router;
