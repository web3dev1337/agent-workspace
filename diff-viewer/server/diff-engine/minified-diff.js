const diff = require('diff');

class MinifiedDiffEngine {
  constructor() {
    // Patterns for common minified file types
    this.minifiedPatterns = {
      javascript: /\.min\.js$/,
      css: /\.min\.css$/,
      json: /\.min\.json$/,
      general: /(\.min\.|\.prod\.|\.production\.)/
    };

    // Token delimiters for different file types
    this.tokenDelimiters = {
      javascript: /([;,{}()\[\]"'`\s]+)/,
      css: /([;,{}:()"\s]+)/,
      json: /([,{}\[\]:"\s]+)/,
      default: /([;,{}()\[\]:"\s]+)/
    };
  }

  isMinified(filename, content) {
    // Check filename patterns
    for (const pattern of Object.values(this.minifiedPatterns)) {
      if (pattern.test(filename)) return true;
    }

    // Check content characteristics
    const lines = content.split('\n');
    if (lines.length === 1 && lines[0].length > 500) return true;
    
    // Check average line length
    const avgLineLength = content.length / lines.length;
    if (avgLineLength > 300) return true;

    // Check for lack of whitespace
    const whitespaceRatio = (content.match(/\s/g) || []).length / content.length;
    if (whitespaceRatio < 0.1 && content.length > 200) return true;

    return false;
  }

  getFileType(filename) {
    if (/\.js$/.test(filename)) return 'javascript';
    if (/\.css$/.test(filename)) return 'css';
    if (/\.json$/.test(filename)) return 'json';
    return 'default';
  }

  tokenize(content, fileType) {
    const delimiter = this.tokenDelimiters[fileType] || this.tokenDelimiters.default;
    const tokens = content.split(delimiter).filter(token => token.length > 0);
    return tokens;
  }

  computeTokenDiff(oldContent, newContent, filename) {
    const fileType = this.getFileType(filename);
    const oldTokens = this.tokenize(oldContent, fileType);
    const newTokens = this.tokenize(newContent, fileType);

    // Use diff library for token-level comparison
    const tokenDiff = diff.diffArrays(oldTokens, newTokens);

    // Convert to a more useful format
    const changes = [];
    let oldIndex = 0;
    let newIndex = 0;

    tokenDiff.forEach(part => {
      if (part.added) {
        changes.push({
          type: 'added',
          tokens: part.value,
          newIndex: newIndex,
          count: part.count || part.value.length
        });
        newIndex += part.count || part.value.length;
      } else if (part.removed) {
        changes.push({
          type: 'removed',
          tokens: part.value,
          oldIndex: oldIndex,
          count: part.count || part.value.length
        });
        oldIndex += part.count || part.value.length;
      } else {
        oldIndex += part.count || part.value.length;
        newIndex += part.count || part.value.length;
      }
    });

    return {
      changes,
      stats: {
        tokensAdded: changes.filter(c => c.type === 'added').reduce((sum, c) => sum + c.count, 0),
        tokensRemoved: changes.filter(c => c.type === 'removed').reduce((sum, c) => sum + c.count, 0),
        totalOldTokens: oldTokens.length,
        totalNewTokens: newTokens.length
      }
    };
  }

  // Format minified content for better readability
  prettifyMinified(content, fileType) {
    switch (fileType) {
      case 'javascript':
        return this.prettifyJavaScript(content);
      case 'css':
        return this.prettifyCSS(content);
      case 'json':
        return this.prettifyJSON(content);
      default:
        return this.genericPrettify(content);
    }
  }

  prettifyJavaScript(content) {
    // Basic JS prettification
    return content
      .replace(/;/g, ';\n')
      .replace(/\{/g, ' {\n  ')
      .replace(/\}/g, '\n}\n')
      .replace(/,/g, ',\n  ')
      .replace(/\n\s*\n/g, '\n');
  }

  prettifyCSS(content) {
    // Basic CSS prettification
    return content
      .replace(/\{/g, ' {\n  ')
      .replace(/\}/g, '\n}\n')
      .replace(/;/g, ';\n  ')
      .replace(/,/g, ',\n')
      .replace(/\n\s*\n/g, '\n');
  }

  prettifyJSON(content) {
    try {
      return JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      return this.genericPrettify(content);
    }
  }

  genericPrettify(content) {
    // Generic prettification for unknown types
    return content
      .replace(/([;,])/g, '$1\n')
      .replace(/(\{|\[)/g, '$1\n  ')
      .replace(/(\}|\])/g, '\n$1')
      .replace(/\n\s*\n/g, '\n');
  }

  // Generate a visual diff for minified files
  generateMinifiedDiff(oldContent, newContent, filename) {
    const fileType = this.getFileType(filename);
    const tokenDiff = this.computeTokenDiff(oldContent, newContent, filename);

    // For display, we'll show context around changes
    const contextSize = 5; // tokens before/after change
    const displayChunks = [];

    tokenDiff.changes.forEach((change, index) => {
      const chunk = {
        type: change.type,
        content: change.tokens.slice(0, 10).join(''), // Show first 10 tokens
        tokenCount: change.count,
        isLarge: change.count > 20
      };

      // Add ellipsis for large changes
      if (chunk.isLarge) {
        chunk.content += `... (${change.count - 10} more tokens)`;
      }

      displayChunks.push(chunk);
    });

    return {
      fileType,
      isMinified: true,
      tokenDiff,
      displayChunks,
      suggestion: this.getSuggestion(tokenDiff.stats)
    };
  }

  getSuggestion(stats) {
    const changeRatio = (stats.tokensAdded + stats.tokensRemoved) / (stats.totalOldTokens || 1);
    
    if (changeRatio < 0.01) {
      return 'Minor changes detected (< 1% of tokens modified)';
    } else if (changeRatio < 0.1) {
      return 'Small changes detected (< 10% of tokens modified)';
    } else if (changeRatio < 0.5) {
      return 'Moderate changes detected (< 50% of tokens modified)';
    } else {
      return 'Major changes detected (> 50% of tokens modified)';
    }
  }
}

module.exports = MinifiedDiffEngine;