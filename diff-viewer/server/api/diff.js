const express = require('express');
const router = express.Router();
const { DiffEngine } = require('../diff-engine/engine');
const { AIAnalyzer } = require('../diff-engine/ai-analyzer');

const diffEngine = new DiffEngine();
const aiAnalyzer = new AIAnalyzer();

// Process diff for a PR
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