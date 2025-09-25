// const Parser = require('tree-sitter'); // Temporarily disabled - Node 24 compatibility issue
const crypto = require('crypto');

class AdvancedSemanticEngine {
  constructor() {
    this.NOISE_THRESHOLD = 0.15; // Changes below 15% are noise
    this.DUPLICATION_THRESHOLD = 0.85; // 85% similarity = duplicate
  }

  /**
   * Analyzes a diff with GitClear-style intelligence
   * Returns structured changes with noise filtered out
   */
  async analyzeSmartDiff(oldContent, newContent, language, fileName) {
    const analysis = {
      netNewLogic: 0,
      noiseLines: 0,
      significantChanges: [],
      refactorings: [],
      duplications: [],
      movedBlocks: [],
      stats: {
        totalLinesChanged: 0,
        significantLinesChanged: 0,
        noiseReduction: 0
      }
    };

    try {
      // Parse ASTs
      const oldAST = await this.parseAST(oldContent, language);
      const newAST = await this.parseAST(newContent, language);

      // Extract semantic units (functions, classes, methods)
      const oldUnits = this.extractSemanticUnits(oldAST);
      const newUnits = this.extractSemanticUnits(newAST);

      // Detect refactorings first (they're not really "changes")
      analysis.refactorings = this.detectRefactorings(oldUnits, newUnits);
      
      // Find moved code blocks
      analysis.movedBlocks = this.detectMovedCode(oldUnits, newUnits);
      
      // Detect duplicated code
      analysis.duplications = this.detectDuplications(newUnits);
      
      // Analyze remaining changes
      const changes = this.computeSemanticChanges(oldUnits, newUnits, analysis);
      
      // Filter out noise
      analysis.significantChanges = this.filterNoise(changes);
      
      // Calculate stats
      this.calculateStats(analysis, oldContent, newContent);
      
      return analysis;
    } catch (error) {
      console.error('Advanced semantic analysis failed:', error);
      throw error;
    }
  }

  /**
   * Extract semantic units from AST - these are the "atoms" of code
   */
  extractSemanticUnits(ast) {
    const units = [];
    
    const traverse = (node, context = {}) => {
      const unit = this.nodeToSemanticUnit(node, context);
      if (unit) {
        units.push(unit);
        
        // Add nested context for children
        context = { ...context, parent: unit };
      }

      // Traverse children
      for (let i = 0; i < node.childCount; i++) {
        traverse(node.child(i), context);
      }
    };

    traverse(ast.rootNode);
    return units;
  }

  /**
   * Convert AST node to semantic unit with fingerprinting
   */
  nodeToSemanticUnit(node, context) {
    const semanticTypes = {
      // Functions and methods
      'function_declaration': 'function',
      'method_definition': 'method',
      'arrow_function': 'function',
      'function_expression': 'function',
      
      // Classes and objects
      'class_declaration': 'class',
      'interface_declaration': 'interface',
      'type_alias_declaration': 'type',
      'object_pattern': 'object',
      
      // Variables and properties
      'variable_declaration': 'variable',
      'property_definition': 'property',
      'field_definition': 'field',
      
      // Control flow
      'if_statement': 'conditional',
      'switch_statement': 'conditional',
      'for_statement': 'loop',
      'while_statement': 'loop',
      
      // Imports/exports
      'import_statement': 'import',
      'export_statement': 'export',
      
      // JSX/React
      'jsx_element': 'component',
      'jsx_self_closing_element': 'component'
    };

    const type = semanticTypes[node.type];
    if (!type) return null;

    // Extract semantic properties
    const unit = {
      type,
      nodeType: node.type,
      name: this.extractName(node),
      signature: this.extractSignature(node),
      content: node.text,
      normalizedContent: this.normalizeContent(node.text),
      fingerprint: this.generateFingerprint(node),
      complexity: this.calculateComplexity(node),
      startLine: node.startPosition.row,
      endLine: node.endPosition.row,
      context: context.parent?.name || 'global',
      children: []
    };

    return unit;
  }

  /**
   * Extract meaningful name from node
   */
  extractName(node) {
    // Try common name patterns
    const patterns = [
      { query: 'identifier', property: 'text' },
      { query: 'property_identifier', property: 'text' },
      { query: 'shorthand_property_identifier', property: 'text' }
    ];

    for (const pattern of patterns) {
      const nameNode = node.childForFieldName('name') || 
                      node.descendantsOfType(pattern.query)[0];
      if (nameNode) {
        return nameNode.text;
      }
    }

    // Fallback for complex nodes
    if (node.type === 'variable_declaration') {
      const declarator = node.descendantsOfType('variable_declarator')[0];
      if (declarator) {
        const id = declarator.childForFieldName('name');
        if (id) return id.text;
      }
    }

    return null;
  }

  /**
   * Extract function/method signature for comparison
   */
  extractSignature(node) {
    if (!['function_declaration', 'method_definition', 'arrow_function'].includes(node.type)) {
      return null;
    }

    const params = node.childForFieldName('parameters');
    const returnType = node.childForFieldName('return_type');
    
    return {
      params: params ? this.normalizeParams(params.text) : '',
      returnType: returnType ? returnType.text : null,
      async: node.text.includes('async'),
      generator: node.text.includes('function*')
    };
  }

  /**
   * Normalize content for comparison (remove noise)
   */
  normalizeContent(text) {
    return text
      // Remove all whitespace variations
      .replace(/\s+/g, ' ')
      // Remove trailing commas
      .replace(/,(\s*[}\]\)])/g, '$1')
      // Normalize quotes
      .replace(/["'`]/g, '"')
      // Remove semicolons
      .replace(/;/g, '')
      // Normalize line endings
      .trim();
  }

  /**
   * Generate content-based fingerprint for detecting moves/duplicates
   */
  generateFingerprint(node) {
    const content = this.normalizeContent(node.text);
    const structure = this.extractStructure(node);
    
    // Create fingerprint from content + structure
    const fingerprintData = `${node.type}:${structure}:${content}`;
    return crypto.createHash('md5').update(fingerprintData).digest('hex');
  }

  /**
   * Extract structural pattern (for detecting refactorings)
   */
  extractStructure(node) {
    const structure = [];
    
    const traverse = (n, depth = 0) => {
      if (depth > 3) return; // Limit depth
      
      if (this.isStructuralNode(n)) {
        structure.push(n.type);
      }
      
      for (let i = 0; i < n.childCount; i++) {
        traverse(n.child(i), depth + 1);
      }
    };
    
    traverse(node);
    return structure.join(',');
  }

  isStructuralNode(node) {
    const structural = [
      'if_statement', 'for_statement', 'while_statement',
      'function_declaration', 'class_declaration', 'method_definition',
      'try_statement', 'switch_statement'
    ];
    return structural.includes(node.type);
  }

  /**
   * Calculate complexity score for prioritizing changes
   */
  calculateComplexity(node) {
    let complexity = 1;
    
    // Count decision points
    const decisionPoints = node.descendantsOfType([
      'if_statement', 'conditional_expression', 'switch_statement',
      'for_statement', 'while_statement', 'do_statement',
      'catch_clause', 'case_statement'
    ]);
    
    complexity += decisionPoints.length;
    
    // Add complexity for nested functions
    const nestedFunctions = node.descendantsOfType([
      'function_declaration', 'arrow_function', 'function_expression'
    ]);
    
    complexity += nestedFunctions.length * 2;
    
    return complexity;
  }

  /**
   * Detect refactorings (rename, extract, inline)
   */
  detectRefactorings(oldUnits, newUnits) {
    const refactorings = [];
    
    // Build maps for efficient lookup
    const oldByFingerprint = new Map(oldUnits.map(u => [u.fingerprint, u]));
    const newByFingerprint = new Map(newUnits.map(u => [u.fingerprint, u]));
    const oldByName = new Map(oldUnits.map(u => [u.name, u]));
    const newByName = new Map(newUnits.map(u => [u.name, u]));
    
    // Detect renames (same fingerprint, different name)
    for (const [fingerprint, newUnit] of newByFingerprint) {
      const oldUnit = oldByFingerprint.get(fingerprint);
      if (oldUnit && oldUnit.name !== newUnit.name) {
        refactorings.push({
          type: 'rename',
          from: oldUnit.name,
          to: newUnit.name,
          unitType: newUnit.type,
          confidence: 0.95
        });
      }
    }
    
    // Detect extract method (new method with content from old method)
    for (const newUnit of newUnits) {
      if (newUnit.type !== 'method' && newUnit.type !== 'function') continue;
      
      // Check if this function's content appears in any old function
      for (const oldUnit of oldUnits) {
        if (oldUnit.type !== 'method' && oldUnit.type !== 'function') continue;
        
        const similarity = this.calculateSimilarity(
          newUnit.normalizedContent,
          oldUnit.normalizedContent
        );
        
        if (similarity > 0.7 && similarity < 0.95) {
          // Likely extracted from the old function
          refactorings.push({
            type: 'extract_method',
            extracted: newUnit.name,
            from: oldUnit.name,
            confidence: similarity
          });
        }
      }
    }
    
    // Detect parameter changes
    for (const [name, newUnit] of newByName) {
      const oldUnit = oldByName.get(name);
      if (oldUnit && oldUnit.signature && newUnit.signature) {
        if (oldUnit.signature.params !== newUnit.signature.params) {
          refactorings.push({
            type: 'change_signature',
            function: name,
            oldParams: oldUnit.signature.params,
            newParams: newUnit.signature.params,
            confidence: 0.9
          });
        }
      }
    }
    
    return refactorings;
  }

  /**
   * Detect moved code blocks
   */
  detectMovedCode(oldUnits, newUnits) {
    const moved = [];
    const oldByFingerprint = new Map(oldUnits.map(u => [u.fingerprint, u]));
    const newByFingerprint = new Map(newUnits.map(u => [u.fingerprint, u]));
    
    for (const [fingerprint, newUnit] of newByFingerprint) {
      const oldUnit = oldByFingerprint.get(fingerprint);
      if (oldUnit) {
        // Check if position changed significantly
        const lineDiff = Math.abs(newUnit.startLine - oldUnit.startLine);
        if (lineDiff > 5) { // Moved more than 5 lines
          moved.push({
            unit: newUnit.name || newUnit.type,
            from: { line: oldUnit.startLine, context: oldUnit.context },
            to: { line: newUnit.startLine, context: newUnit.context },
            lines: newUnit.endLine - newUnit.startLine + 1
          });
        }
      }
    }
    
    return moved;
  }

  /**
   * Detect duplicated code patterns
   */
  detectDuplications(units) {
    const duplications = [];
    const seen = new Map();
    
    for (const unit of units) {
      // Skip small units
      if (unit.normalizedContent.length < 50) continue;
      
      // Check against all other units
      for (const [content, existingUnit] of seen) {
        const similarity = this.calculateSimilarity(
          unit.normalizedContent,
          content
        );
        
        if (similarity > this.DUPLICATION_THRESHOLD) {
          duplications.push({
            units: [existingUnit.name, unit.name],
            similarity,
            lines: unit.endLine - unit.startLine + 1,
            type: unit.type
          });
        }
      }
      
      seen.set(unit.normalizedContent, unit);
    }
    
    return duplications;
  }

  /**
   * Calculate similarity between two strings (0-1)
   */
  calculateSimilarity(str1, str2) {
    const len1 = str1.length;
    const len2 = str2.length;
    const matrix = [];

    // Initialize matrix
    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }

    // Calculate Levenshtein distance
    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    const distance = matrix[len1][len2];
    const maxLen = Math.max(len1, len2);
    return 1 - (distance / maxLen);
  }

  /**
   * Compute semantic changes (not refactorings or moves)
   */
  computeSemanticChanges(oldUnits, newUnits, analysis) {
    const changes = [];
    const processedFingerprints = new Set();
    
    // Add fingerprints from refactorings and moves
    analysis.refactorings.forEach(r => {
      // Mark these as processed
    });
    
    const oldByName = new Map(oldUnits.map(u => [u.name, u]));
    const newByName = new Map(newUnits.map(u => [u.name, u]));
    
    // Find actual changes
    for (const [name, newUnit] of newByName) {
      const oldUnit = oldByName.get(name);
      
      if (oldUnit && !processedFingerprints.has(newUnit.fingerprint)) {
        // Compare normalized content
        if (oldUnit.normalizedContent !== newUnit.normalizedContent) {
          const change = {
            type: 'modified',
            name: name,
            unitType: newUnit.type,
            complexity: newUnit.complexity,
            oldLines: oldUnit.endLine - oldUnit.startLine + 1,
            newLines: newUnit.endLine - newUnit.startLine + 1,
            similarity: this.calculateSimilarity(
              oldUnit.normalizedContent,
              newUnit.normalizedContent
            )
          };
          
          // Classify the change
          if (change.similarity > 0.9) {
            change.classification = 'minor';
          } else if (change.similarity > 0.5) {
            change.classification = 'moderate';
          } else {
            change.classification = 'major';
          }
          
          changes.push(change);
        }
      } else if (!oldUnit && !processedFingerprints.has(newUnit.fingerprint)) {
        // New unit
        changes.push({
          type: 'added',
          name: newUnit.name,
          unitType: newUnit.type,
          complexity: newUnit.complexity,
          lines: newUnit.endLine - newUnit.startLine + 1,
          classification: 'new'
        });
      }
    }
    
    // Find deletions
    for (const [name, oldUnit] of oldByName) {
      if (!newByName.has(name) && !processedFingerprints.has(oldUnit.fingerprint)) {
        changes.push({
          type: 'deleted',
          name: name,
          unitType: oldUnit.type,
          complexity: oldUnit.complexity,
          lines: oldUnit.endLine - oldUnit.startLine + 1,
          classification: 'removed'
        });
      }
    }
    
    return changes;
  }

  /**
   * Filter out noise based on GitClear-style heuristics
   */
  filterNoise(changes) {
    return changes.filter(change => {
      // Always show new and deleted code
      if (change.type === 'added' || change.type === 'deleted') {
        return true;
      }
      
      // Filter out minor changes
      if (change.classification === 'minor' && change.complexity < 3) {
        return false;
      }
      
      // Filter out small formatting changes
      if (change.similarity > 0.95 && change.lines < 5) {
        return false;
      }
      
      // Keep everything else
      return true;
    });
  }

  /**
   * Calculate final statistics
   */
  calculateStats(analysis, oldContent, newContent) {
    const oldLines = oldContent.split('\n').length;
    const newLines = newContent.split('\n').length;
    
    // Count significant lines
    let significantLines = 0;
    analysis.significantChanges.forEach(change => {
      significantLines += change.lines || 0;
    });
    
    // Count noise lines (everything not significant)
    const totalChanged = Math.abs(newLines - oldLines) + 
      analysis.significantChanges.filter(c => c.type === 'modified').length * 2;
    
    analysis.noiseLines = Math.max(0, totalChanged - significantLines);
    analysis.netNewLogic = analysis.significantChanges
      .filter(c => c.type === 'added')
      .reduce((sum, c) => sum + (c.lines || 0), 0);
    
    analysis.stats = {
      totalLinesChanged: totalChanged,
      significantLinesChanged: significantLines,
      noiseReduction: totalChanged > 0 ? 
        ((totalChanged - significantLines) / totalChanged * 100).toFixed(1) : 0,
      refactorings: analysis.refactorings.length,
      movedBlocks: analysis.movedBlocks.length,
      duplications: analysis.duplications.length
    };
  }

  /**
   * Parse AST using tree-sitter
   */
  async parseAST(content, language) {
    // This would use the actual parser from parent class
    // For now, return a mock
    throw new Error('parseAST must be implemented by parent class');
  }

  /**
   * Normalize parameter strings for comparison
   */
  normalizeParams(params) {
    return params
      .replace(/\s+/g, ' ')
      .replace(/:\s*/g, ':')
      .replace(/,\s*/g, ',')
      .trim();
  }
}

module.exports = AdvancedSemanticEngine;