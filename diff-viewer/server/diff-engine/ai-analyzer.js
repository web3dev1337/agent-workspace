class AIAnalyzer {
  constructor() {
    this.apiKey = process.env.CLAUDE_API_KEY;
    this.enabled = !!this.apiKey;
  }

  async analyzeChanges(semanticDiff, file) {
    if (!this.enabled) {
      return this.generateBasicAnalysis(semanticDiff, file);
    }

    try {
      // TODO: Implement Claude API integration
      // For MVP, return structured analysis
      return {
        summary: this.generateSummary(semanticDiff, file),
        risks: this.detectRisks(semanticDiff),
        duplication: this.checkDuplication(semanticDiff),
        suggestions: this.generateSuggestions(semanticDiff)
      };
    } catch (error) {
      console.error('AI analysis failed:', error);
      return this.generateBasicAnalysis(semanticDiff, file);
    }
  }

  generateBasicAnalysis(semanticDiff, file) {
    return {
      summary: `Modified ${file.filename} with ${semanticDiff.stats.significant} significant changes`,
      risks: [],
      duplication: false,
      suggestions: []
    };
  }

  generateSummary(semanticDiff, file) {
    const { stats } = semanticDiff;
    const parts = [];

    if (stats.added > 0) {
      parts.push(`added ${stats.added} new elements`);
    }
    if (stats.modified > 0) {
      parts.push(`modified ${stats.modified} existing elements`);
    }
    if (stats.deleted > 0) {
      parts.push(`removed ${stats.deleted} elements`);
    }
    if (stats.moved > 0) {
      parts.push(`moved ${stats.moved} elements`);
    }

    return `Changes to ${file.filename}: ${parts.join(', ')}`;
  }

  detectRisks(semanticDiff) {
    const risks = [];

    // Check for common risk patterns
    semanticDiff.changes.forEach(change => {
      if (change.type === 'deleted' && change.node?.type === 'if_statement') {
        risks.push({
          type: 'security',
          severity: 'medium',
          message: 'Removed conditional check - verify this doesn\'t introduce vulnerabilities'
        });
      }

      if (change.type === 'modified' && change.change?.oldText?.includes('TODO')) {
        risks.push({
          type: 'quality',
          severity: 'low',
          message: 'Modified TODO comment - ensure task is completed'
        });
      }
    });

    return risks;
  }

  checkDuplication(semanticDiff) {
    // Simple duplication check
    const codeBlocks = new Map();
    
    semanticDiff.changes.forEach(change => {
      if (change.type === 'added' && change.node?.text) {
        const normalizedText = change.node.text.replace(/\s+/g, ' ').trim();
        if (normalizedText.length > 50) {
          const count = codeBlocks.get(normalizedText) || 0;
          codeBlocks.set(normalizedText, count + 1);
        }
      }
    });

    return Array.from(codeBlocks.values()).some(count => count > 1);
  }

  generateSuggestions(semanticDiff) {
    const suggestions = [];

    if (semanticDiff.stats.moved > semanticDiff.stats.significant * 0.5) {
      suggestions.push('Consider documenting the refactoring rationale');
    }

    if (semanticDiff.changes.some(c => c.node?.type === 'function_declaration' && c.type === 'added')) {
      suggestions.push('Add tests for new functions');
    }

    return suggestions;
  }
}

module.exports = { AIAnalyzer };