const express = require('express');
const puppeteer = require('puppeteer');
const marked = require('marked');
const path = require('path');
const fs = require('fs').promises;
const router = express.Router();

// Configure marked for better code blocks
marked.setOptions({
  highlight: function(code, lang) {
    return `<pre><code class="language-${lang}">${code}</code></pre>`;
  },
  gfm: true,
  breaks: true
});

// Export diff as PDF
router.post('/pdf', async (req, res) => {
  try {
    const { diffData, metadata } = req.body;
    
    if (!diffData || !metadata) {
      return res.status(400).json({ error: 'Missing diff data or metadata' });
    }

    // Generate HTML content
    const html = await generateDiffHTML(diffData, metadata);
    
    // Launch puppeteer
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Set content and styles
    await page.setContent(html, { waitUntil: 'networkidle0' });
    
    // Generate PDF
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20mm',
        right: '15mm',
        bottom: '20mm',
        left: '15mm'
      }
    });
    
    await browser.close();
    
    // Send PDF
    res.contentType('application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="diff-${metadata.number || metadata.sha}.pdf"`);
    res.send(pdf);
    
  } catch (error) {
    console.error('PDF export error:', error);
    res.status(500).json({
      error: 'Failed to export PDF',
      message: error.message
    });
  }
});

// Export diff as Markdown
router.post('/markdown', async (req, res) => {
  try {
    const { diffData, metadata } = req.body;
    
    if (!diffData || !metadata) {
      return res.status(400).json({ error: 'Missing diff data or metadata' });
    }

    const markdown = generateDiffMarkdown(diffData, metadata);
    
    res.contentType('text/markdown');
    res.setHeader('Content-Disposition', `attachment; filename="diff-${metadata.number || metadata.sha}.md"`);
    res.send(markdown);
    
  } catch (error) {
    console.error('Markdown export error:', error);
    res.status(500).json({
      error: 'Failed to export Markdown',
      message: error.message
    });
  }
});

// Generate HTML for PDF export
async function generateDiffHTML(diffData, metadata) {
  const { files, stats } = diffData;
  
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Diff Report - ${metadata.title || metadata.message}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: #24292e;
      max-width: 900px;
      margin: 0 auto;
      padding: 20px;
    }
    h1, h2, h3 {
      margin-top: 24px;
      margin-bottom: 16px;
      font-weight: 600;
    }
    .header {
      border-bottom: 1px solid #e1e4e8;
      padding-bottom: 20px;
      margin-bottom: 20px;
    }
    .stats {
      display: flex;
      gap: 20px;
      margin: 16px 0;
    }
    .stat {
      padding: 8px 16px;
      background: #f6f8fa;
      border-radius: 6px;
    }
    .additions { color: #28a745; }
    .deletions { color: #d73a49; }
    .file-header {
      background: #f6f8fa;
      padding: 8px 16px;
      border-radius: 6px 6px 0 0;
      margin-top: 24px;
      font-family: monospace;
    }
    .diff-block {
      border: 1px solid #e1e4e8;
      border-radius: 0 0 6px 6px;
      margin-bottom: 24px;
      overflow: hidden;
    }
    pre {
      margin: 0;
      padding: 16px;
      overflow-x: auto;
      background: #f6f8fa;
    }
    code {
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      font-size: 12px;
    }
    .line-added {
      background: #e6ffed;
      color: #24292e;
    }
    .line-deleted {
      background: #ffeef0;
      color: #24292e;
    }
    .metadata {
      font-size: 14px;
      color: #586069;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${metadata.title || metadata.message}</h1>
    <div class="metadata">
      ${metadata.user ? `<p>Author: ${metadata.user.login || metadata.user}</p>` : ''}
      ${metadata.created_at ? `<p>Created: ${new Date(metadata.created_at).toLocaleString()}</p>` : ''}
      ${metadata.base && metadata.head ? `<p>Branch: ${metadata.head.ref} → ${metadata.base.ref}</p>` : ''}
    </div>
    <div class="stats">
      <div class="stat">Files: ${stats.files || files.length}</div>
      ${Number(stats.additions || 0) > 0 ? `<div class="stat additions">+${Number(stats.additions || 0)}</div>` : ''}
      ${Number(stats.deletions || 0) > 0 ? `<div class="stat deletions">-${Number(stats.deletions || 0)}</div>` : ''}
      ${stats.semanticReduction ? `<div class="stat">Reduction: ${stats.semanticReduction}%</div>` : ''}
    </div>
  </div>
  
  <h2>Files Changed</h2>
  ${files.map(file => `
    <div class="diff-block">
      <div class="file-header">
        ${file.path || file.filename} 
        ${Number(file.additions || 0) > 0 ? `<span class="additions">+${Number(file.additions || 0)}</span>` : ''}
        ${Number(file.deletions || 0) > 0 ? `<span class="deletions">-${Number(file.deletions || 0)}</span>` : ''}
      </div>
      <pre><code>${formatDiffContent(file)}</code></pre>
    </div>
  `).join('')}
</body>
</html>
`;

  return html;
}

// Generate Markdown for export
function generateDiffMarkdown(diffData, metadata) {
  const { files, stats } = diffData;
  
  let markdown = `# ${metadata.title || metadata.message}\n\n`;
  
  // Metadata
  if (metadata.user) {
    markdown += `**Author:** ${metadata.user.login || metadata.user}\n`;
  }
  if (metadata.created_at) {
    markdown += `**Created:** ${new Date(metadata.created_at).toLocaleString()}\n`;
  }
  if (metadata.base && metadata.head) {
    markdown += `**Branch:** ${metadata.head.ref} → ${metadata.base.ref}\n`;
  }
  
  markdown += '\n## Statistics\n\n';
  markdown += `- **Files Changed:** ${stats.files || files.length}\n`;
  if (Number(stats.additions || 0) > 0) {
    markdown += `- **Additions:** +${stats.additions || 0}\n`;
  }
  if (Number(stats.deletions || 0) > 0) {
    markdown += `- **Deletions:** -${stats.deletions || 0}\n`;
  }
  if (Number(stats.additions || 0) <= 0 && Number(stats.deletions || 0) <= 0) {
    markdown += '- **Line Delta:** none\n';
  }
  if (stats.semanticReduction) {
    markdown += `- **Semantic Reduction:** ${stats.semanticReduction}%\n`;
  }
  
  markdown += '\n## Files\n\n';
  
  // File changes
  files.forEach(file => {
    markdown += `### ${file.path || file.filename}\n\n`;
    if (Number(file.additions || 0) > 0) {
      markdown += `- Additions: +${file.additions || 0}\n`;
    }
    if (Number(file.deletions || 0) > 0) {
      markdown += `- Deletions: -${file.deletions || 0}\n`;
    }
    if (Number(file.additions || 0) <= 0 && Number(file.deletions || 0) <= 0) {
      markdown += '- Line Delta: none\n';
    }
    markdown += '\n';
    
    if (file.patch || file.content) {
      markdown += '```diff\n';
      markdown += formatDiffContent(file);
      markdown += '\n```\n\n';
    }
  });
  
  return markdown;
}

// Format diff content for display
function formatDiffContent(file) {
  if (file.patch) {
    return file.patch;
  }
  
  if (file.oldContent && file.newContent) {
    // Generate simple diff representation
    const oldLines = file.oldContent.split('\n');
    const newLines = file.newContent.split('\n');
    let diff = '';
    
    // Simple line-by-line comparison (for now)
    const maxLines = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLines; i++) {
      if (i >= oldLines.length) {
        diff += `+ ${newLines[i]}\n`;
      } else if (i >= newLines.length) {
        diff += `- ${oldLines[i]}\n`;
      } else if (oldLines[i] !== newLines[i]) {
        diff += `- ${oldLines[i]}\n`;
        diff += `+ ${newLines[i]}\n`;
      } else {
        diff += `  ${oldLines[i]}\n`;
      }
    }
    
    return diff;
  }
  
  return 'No diff content available';
}

module.exports = router;
