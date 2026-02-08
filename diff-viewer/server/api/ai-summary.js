const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { getCache } = require('../cache/database');
const router = express.Router();

// Initialize Claude client
const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY
});

const dbCache = getCache();

function formatDeltaSummary(additions, deletions) {
  const add = Number(additions || 0);
  const del = Number(deletions || 0);
  const parts = [];
  if (add > 0) parts.push(`+${add}`);
  if (del > 0) parts.push(`-${del}`);
  return parts.join('/') || 'no line delta';
}

// Generate AI summary for PR/commit
router.post('/generate', async (req, res) => {
  try {
    const { type, owner, repo, id, diffData, metadata } = req.body;
    
    // Check if AI summaries are enabled
    if (!process.env.CLAUDE_API_KEY || process.env.ENABLE_AI_ANALYSIS === 'false') {
      return res.status(400).json({ 
        error: 'AI summaries are not enabled',
        message: 'Please configure CLAUDE_API_KEY in .env'
      });
    }

    // Check cache first
    const cacheKey = `ai-summary:${type}:${owner}/${repo}/${id}`;
    const cached = dbCache.getMetadata('ai-summary', owner, repo, id);
    if (cached) {
      return res.json(cached);
    }

    // Prepare diff context
    const diffContext = prepareDiffContext(diffData, metadata);
    
    // Generate summary using Claude
    const response = await anthropic.messages.create({
      model: 'claude-3-sonnet-20240229',
      max_tokens: 1500,
      temperature: 0,
      system: `You are an expert code reviewer analyzing git diffs. Provide concise, actionable summaries focused on:
1. Key changes and their purpose
2. Potential risks or concerns
3. Architecture/design impacts
4. Security implications
5. Performance considerations

Be specific and reference actual file names and changes. Keep summaries under 500 words.`,
      messages: [{
        role: 'user',
        content: `Analyze this ${type === 'pr' ? 'pull request' : 'commit'}:

Title: ${metadata.title || metadata.message}
${metadata.body ? `Description: ${metadata.body}` : ''}
Stats: ${diffData.stats.files} files, ${formatDeltaSummary(diffData.stats.additions, diffData.stats.deletions)}

Key file changes:
${diffContext}

Provide a comprehensive summary covering the points mentioned.`
      }]
    });

    const summary = response.content[0].text;
    
    // Analyze for risks
    const riskAnalysis = await analyzeRisks(diffData, summary);
    
    const result = {
      summary,
      risks: riskAnalysis,
      generatedAt: new Date().toISOString(),
      stats: {
        filesAnalyzed: diffData.files.length,
        semanticReduction: diffData.stats.semanticReduction || 0
      }
    };

    // Cache the result
    dbCache.setMetadata('ai-summary', owner, repo, id, result, 60); // Cache for 1 hour
    
    // Broadcast to WebSocket clients
    if (req.app.locals.wsManager) {
      req.app.locals.wsManager.broadcastDiffUpdate(type, owner, repo, id, {
        type: 'ai-summary',
        data: result
      });
    }

    res.json(result);
  } catch (error) {
    console.error('AI summary error:', error);
    res.status(500).json({
      error: 'Failed to generate AI summary',
      message: error.message
    });
  }
});

// Generate risk analysis
async function analyzeRisks(diffData, summary) {
  const risks = [];
  
  // Check for security patterns
  const securityPatterns = [
    { pattern: /api[_-]?key|secret|password|token/i, risk: 'Potential hardcoded credentials' },
    { pattern: /eval\(|exec\(|system\(/i, risk: 'Dynamic code execution' },
    { pattern: /innerHTML|dangerouslySetInnerHTML/i, risk: 'Potential XSS vulnerability' },
    { pattern: /sql.*query|executeQuery/i, risk: 'SQL injection risk' }
  ];

  diffData.files.forEach(file => {
    const content = file.patch || file.newContent || '';
    
    securityPatterns.forEach(({ pattern, risk }) => {
      if (pattern.test(content)) {
        risks.push({
          type: 'security',
          severity: 'high',
          file: file.path || file.filename,
          description: risk
        });
      }
    });

    // Check for large file changes
    if (file.additions > 500) {
      risks.push({
        type: 'complexity',
        severity: 'medium',
        file: file.path || file.filename,
        description: `Large file change (${file.additions} additions)`
      });
    }

    // Check for deleted test files
    if (file.status === 'removed' && /test|spec/i.test(file.filename)) {
      risks.push({
        type: 'testing',
        severity: 'medium',
        file: file.filename,
        description: 'Test file deleted'
      });
    }
  });

  // Performance risks
  if (diffData.stats.additions > 1000) {
    risks.push({
      type: 'performance',
      severity: 'low',
      description: 'Large changeset may impact build/deploy times'
    });
  }

  return risks;
}

// Prepare diff context for AI analysis
function prepareDiffContext(diffData, metadata) {
  const { files } = diffData;
  
  // Group files by type
  const fileGroups = {
    source: [],
    config: [],
    tests: [],
    docs: [],
    other: []
  };

  files.forEach(file => {
    const filename = file.path || file.filename;
    if (/\.(js|jsx|ts|tsx|py|java|go|rs)$/i.test(filename)) {
      fileGroups.source.push(file);
    } else if (/\.(json|yml|yaml|toml|ini|env)$/i.test(filename)) {
      fileGroups.config.push(file);
    } else if (/test|spec/i.test(filename)) {
      fileGroups.tests.push(file);
    } else if (/\.(md|txt|rst)$/i.test(filename)) {
      fileGroups.docs.push(file);
    } else {
      fileGroups.other.push(file);
    }
  });

  // Build context string
  let context = '';
  
  if (fileGroups.source.length > 0) {
    context += '\nSource code changes:\n';
    fileGroups.source.slice(0, 10).forEach(file => {
      context += `- ${file.filename}: ${file.status} (${formatDeltaSummary(file.additions, file.deletions)})\n`;
      if (file.semanticChanges) {
        context += `  Semantic: ${JSON.stringify(file.semanticChanges)}\n`;
      }
    });
  }

  if (fileGroups.config.length > 0) {
    context += '\nConfiguration changes:\n';
    fileGroups.config.forEach(file => {
      context += `- ${file.filename}: ${file.status}\n`;
    });
  }

  if (fileGroups.tests.length > 0) {
    context += '\nTest changes:\n';
    fileGroups.tests.forEach(file => {
      context += `- ${file.filename}: ${file.status}\n`;
    });
  }

  // Add sample diffs for key files
  const keyFiles = files
    .filter(f => f.additions + f.deletions > 10)
    .sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions))
    .slice(0, 3);

  if (keyFiles.length > 0) {
    context += '\nKey file diffs:\n';
    keyFiles.forEach(file => {
      if (file.patch) {
        const lines = file.patch.split('\n').slice(0, 20);
        context += `\n${file.filename}:\n\`\`\`diff\n${lines.join('\n')}\n\`\`\`\n`;
      }
    });
  }

  return context;
}

module.exports = router;
