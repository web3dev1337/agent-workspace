// Temporarily disabled tree-sitter - Node 24 compatibility issue
// const Parser = require('tree-sitter');
// const JavaScript = require('tree-sitter-javascript');
// const TypeScript = require('tree-sitter-typescript').typescript;
// const Python = require('tree-sitter-python');
const MinifiedDiffEngine = require('./minified-diff');
const JsonYamlDiffEngine = require('./json-yaml-diff');
const BinaryDiffEngine = require('./binary-diff');
const AdvancedSemanticEngine = require('./advanced-semantic-engine');

class DiffEngine {
  constructor() {
    this.parsers = new Map();
    // this.initializeParsers(); // Disabled - tree-sitter compatibility

    // Initialize specialized engines
    this.minifiedEngine = new MinifiedDiffEngine();
    this.jsonYamlEngine = new JsonYamlDiffEngine();
    this.binaryEngine = new BinaryDiffEngine();
    this.semanticEngine = new AdvancedSemanticEngine();
  }

  initializeParsers() {
    // Disabled - tree-sitter compatibility with Node 24
    // JavaScript parser
    // const jsParser = new Parser();
    // jsParser.setLanguage(JavaScript);
    // this.parsers.set('js', jsParser);
    // this.parsers.set('jsx', jsParser);

    // TypeScript parser
    // const tsParser = new Parser();
    // tsParser.setLanguage(TypeScript);
    // this.parsers.set('ts', tsParser);
    // this.parsers.set('tsx', tsParser);

    // Python parser
    // const pyParser = new Parser();
    // pyParser.setLanguage(Python);
    // this.parsers.set('py', pyParser);
  }

  async analyzeDiff(file) {
    const filename = file.filename;
    const extension = filename.split('.').pop().toLowerCase();
    
    // Check for binary files first
    if (this.binaryEngine.isBinary(filename)) {
      return this.analyzeBinaryDiff(file);
    }
    
    // Check for JSON/YAML files
    if (this.jsonYamlEngine.isSupported(filename)) {
      return this.analyzeStructuredDiff(file);
    }
    
    // Check if file is minified
    if (file.patch && this.minifiedEngine.isMinified(filename, file.patch)) {
      return this.analyzeMinifiedDiff(file);
    }
    
    const parser = this.parsers.get(extension);
    if (!parser) {
      // Fallback to text-based diff
      return this.textBasedDiff(file);
    }

    try {
      // Parse the patch to extract old and new content
      const { oldContent, newContent } = this.extractContentFromPatch(file.patch);
      
      // Parse ASTs
      const oldTree = parser.parse(oldContent);
      const newTree = parser.parse(newContent);

      // Use advanced semantic analysis
      const semanticAnalysis = await this.performAdvancedAnalysis(
        oldContent, 
        newContent, 
        oldTree, 
        newTree, 
        extension,
        filename
      );

      return {
        type: 'semantic',
        language: extension,
        ...semanticAnalysis,
        // Add backwards compatibility
        changes: semanticAnalysis.significantChanges,
        stats: semanticAnalysis.stats
      };
    } catch (error) {
      console.error('AST parsing failed, falling back to text diff:', error);
      return this.textBasedDiff(file);
    }
  }

  extractContentFromPatch(patch) {
    const lines = patch.split('\n');
    const oldLines = [];
    const newLines = [];
    
    let inHunk = false;
    
    for (const line of lines) {
      if (line.startsWith('@@')) {
        inHunk = true;
        continue;
      }
      
      if (!inHunk) continue;
      
      if (line.startsWith('-')) {
        oldLines.push(line.substring(1));
      } else if (line.startsWith('+')) {
        newLines.push(line.substring(1));
      } else if (line.startsWith(' ')) {
        // Context line - add to both
        oldLines.push(line.substring(1));
        newLines.push(line.substring(1));
      }
    }
    
    return {
      oldContent: oldLines.join('\n'),
      newContent: newLines.join('\n')
    };
  }

  computeSemanticDiff(oldTree, newTree, file) {
    const changes = [];
    const oldNodes = this.collectNodes(oldTree.rootNode);
    const newNodes = this.collectNodes(newTree.rootNode);
    
    // Track moved nodes
    const movedNodes = this.detectMovedNodes(oldNodes, newNodes);
    
    // Find additions and modifications
    newNodes.forEach((newNode, path) => {
      const oldNode = oldNodes.get(path);
      
      if (!oldNode) {
        // Check if this was moved from elsewhere
        const movedFrom = movedNodes.get(newNode);
        if (movedFrom) {
          changes.push({
            type: 'moved',
            path,
            fromPath: movedFrom,
            node: this.nodeToChange(newNode),
            significant: false
          });
        } else {
          changes.push({
            type: 'added',
            path,
            node: this.nodeToChange(newNode),
            significant: this.isSignificantNode(newNode)
          });
        }
      } else if (!this.nodesEqual(oldNode, newNode)) {
        const change = this.compareNodes(oldNode, newNode);
        if (change.significant) {
          changes.push({
            type: 'modified',
            path,
            change,
            significant: true
          });
        }
      }
    });
    
    // Find deletions
    oldNodes.forEach((oldNode, path) => {
      if (!newNodes.has(path) && !Array.from(movedNodes.values()).includes(path)) {
        changes.push({
          type: 'deleted',
          path,
          node: this.nodeToChange(oldNode),
          significant: this.isSignificantNode(oldNode)
        });
      }
    });
    
    return changes;
  }

  collectNodes(node, path = '', nodes = new Map()) {
    const currentPath = path ? `${path}/${node.type}` : node.type;
    
    if (this.isInterestingNode(node)) {
      nodes.set(currentPath, node);
    }
    
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      this.collectNodes(child, currentPath, nodes);
    }
    
    return nodes;
  }

  isInterestingNode(node) {
    const interestingTypes = [
      'function_declaration',
      'method_definition',
      'class_declaration',
      'variable_declaration',
      'assignment_expression',
      'call_expression',
      'if_statement',
      'for_statement',
      'while_statement',
      'return_statement'
    ];
    
    return interestingTypes.includes(node.type);
  }

  isSignificantNode(node) {
    // Whitespace and formatting changes are not significant
    const insignificantTypes = ['comment', 'line_comment', 'block_comment'];
    return !insignificantTypes.includes(node.type);
  }

  detectMovedNodes(oldNodes, newNodes) {
    const moved = new Map();
    
    // Simple content-based matching for now
    oldNodes.forEach((oldNode, oldPath) => {
      if (!newNodes.has(oldPath)) {
        const oldContent = oldNode.text;
        
        // Look for same content elsewhere
        newNodes.forEach((newNode, newPath) => {
          if (!oldNodes.has(newPath) && newNode.text === oldContent) {
            moved.set(newNode, oldPath);
          }
        });
      }
    });
    
    return moved;
  }

  nodesEqual(node1, node2) {
    // Compare normalized text (ignoring whitespace)
    const text1 = node1.text.replace(/\s+/g, ' ').trim();
    const text2 = node2.text.replace(/\s+/g, ' ').trim();
    return text1 === text2;
  }

  compareNodes(oldNode, newNode) {
    const oldText = oldNode.text;
    const newText = newNode.text;
    
    // Detect type of change
    if (oldText.replace(/\s+/g, '') === newText.replace(/\s+/g, '')) {
      return {
        type: 'whitespace',
        significant: false,
        oldText,
        newText
      };
    }
    
    return {
      type: 'content',
      significant: true,
      oldText,
      newText,
      startLine: oldNode.startPosition.row,
      endLine: oldNode.endPosition.row
    };
  }

  nodeToChange(node) {
    return {
      type: node.type,
      text: node.text,
      startLine: node.startPosition.row,
      endLine: node.endPosition.row,
      startColumn: node.startPosition.column,
      endColumn: node.endPosition.column
    };
  }

  textBasedDiff(file) {
    // Fallback for files without AST support
    const lines = file.patch.split('\n');
    const changes = [];
    
    let currentHunk = null;
    
    lines.forEach((line, index) => {
      if (line.startsWith('@@')) {
        // Parse hunk header
        const match = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
        if (match) {
          currentHunk = {
            oldStart: parseInt(match[1]),
            oldCount: parseInt(match[2] || 1),
            newStart: parseInt(match[3]),
            newCount: parseInt(match[4] || 1)
          };
        }
      } else if (line.startsWith('-')) {
        changes.push({
          type: 'deleted',
          line: currentHunk?.oldStart + index,
          content: line.substring(1),
          significant: !this.isWhitespaceOnly(line.substring(1))
        });
      } else if (line.startsWith('+')) {
        changes.push({
          type: 'added',
          line: currentHunk?.newStart + index,
          content: line.substring(1),
          significant: !this.isWhitespaceOnly(line.substring(1))
        });
      } else if (line.startsWith(' ')) {
        // Context lines - these appear in both old and new
        changes.push({
          type: 'context',
          line: currentHunk?.newStart + index,
          content: line.substring(1),
          significant: false
        });
      }
    });
    
    return {
      type: 'text',
      changes,
      stats: this.calculateStats(changes)
    };
  }

  isWhitespaceOnly(text) {
    return text.trim().length === 0;
  }

  calculateStats(changes) {
    const stats = {
      total: changes.length,
      significant: changes.filter(c => c.significant).length,
      added: changes.filter(c => c.type === 'added').length,
      deleted: changes.filter(c => c.type === 'deleted').length,
      modified: changes.filter(c => c.type === 'modified').length,
      moved: changes.filter(c => c.type === 'moved').length
    };
    
    stats.reduction = stats.total > 0 
      ? ((stats.total - stats.significant) / stats.total * 100).toFixed(1)
      : 0;
    
    return stats;
  }
  
  async analyzeBinaryDiff(file) {
    try {
      // Extract old and new content from the file object
      // For binary files, we need the actual content, not the patch
      const oldContent = file.previous_content || '';
      const newContent = file.content || '';
      
      const binaryDiff = await this.binaryEngine.computeBinaryDiff(
        oldContent,
        newContent,
        file.filename
      );
      
      return {
        type: 'binary',
        filename: file.filename,
        diff: this.binaryEngine.formatBinaryDiff(binaryDiff),
        stats: {
          significant: binaryDiff.hasChanged ? 1 : 0,
          total: 1
        }
      };
    } catch (error) {
      console.error('Binary diff failed:', error);
      return this.textBasedDiff(file);
    }
  }
  
  async analyzeStructuredDiff(file) {
    try {
      const { oldContent, newContent } = this.extractContentFromPatch(file.patch);
      
      const structuredDiff = this.jsonYamlEngine.computeSemanticDiff(
        oldContent,
        newContent,
        file.filename
      );
      
      if (structuredDiff.fallbackToText) {
        return this.textBasedDiff(file);
      }
      
      return {
        type: 'structured',
        language: structuredDiff.type,
        diff: this.jsonYamlEngine.formatDiff(structuredDiff),
        stats: {
          significant: structuredDiff.analysis.stats.keysModified + 
                      structuredDiff.analysis.stats.keysAdded + 
                      structuredDiff.analysis.stats.keysRemoved,
          total: structuredDiff.changes.length
        }
      };
    } catch (error) {
      console.error('Structured diff failed:', error);
      return this.textBasedDiff(file);
    }
  }
  
  async analyzeMinifiedDiff(file) {
    try {
      const { oldContent, newContent } = this.extractContentFromPatch(file.patch);
      
      const minifiedDiff = this.minifiedEngine.generateMinifiedDiff(
        oldContent,
        newContent,
        file.filename
      );
      
      return {
        type: 'minified',
        filename: file.filename,
        diff: minifiedDiff,
        stats: {
          significant: minifiedDiff.tokenDiff.stats.tokensAdded + 
                      minifiedDiff.tokenDiff.stats.tokensRemoved,
          total: minifiedDiff.tokenDiff.stats.totalNewTokens
        }
      };
    } catch (error) {
      console.error('Minified diff failed:', error);
      return this.textBasedDiff(file);
    }
  }

  /**
   * Perform advanced semantic analysis using the new engine
   */
  async performAdvancedAnalysis(oldContent, newContent, oldTree, newTree, language, filename) {
    // Bind the parseAST method to use our tree-sitter parsers
    this.semanticEngine.parseAST = async (content, lang) => {
      const parser = this.parsers.get(lang);
      if (!parser) throw new Error(`No parser for language: ${lang}`);
      return parser.parse(content);
    };

    // Run the advanced analysis
    const analysis = await this.semanticEngine.analyzeSmartDiff(
      oldContent,
      newContent,
      language,
      filename
    );

    // Add visual hints for the UI
    analysis.visualHints = {
      collapseNoise: true,
      highlightRefactorings: true,
      groupRelatedChanges: true,
      showComplexityIndicators: true
    };

    // Add summary for quick understanding
    analysis.summary = this.generateSmartSummary(analysis);

    return analysis;
  }

  /**
   * Generate a smart summary of the changes
   */
  generateSmartSummary(analysis) {
    const parts = [];
    
    if (analysis.netNewLogic > 0) {
      parts.push(`${analysis.netNewLogic} lines of new logic`);
    }
    
    if (analysis.refactorings.length > 0) {
      const refactorTypes = {};
      analysis.refactorings.forEach(r => {
        refactorTypes[r.type] = (refactorTypes[r.type] || 0) + 1;
      });
      
      Object.entries(refactorTypes).forEach(([type, count]) => {
        parts.push(`${count} ${type.replace(/_/g, ' ')}${count > 1 ? 's' : ''}`);
      });
    }
    
    if (analysis.movedBlocks.length > 0) {
      parts.push(`${analysis.movedBlocks.length} code blocks moved`);
    }
    
    if (analysis.duplications.length > 0) {
      parts.push(`${analysis.duplications.length} duplications detected`);
    }
    
    if (analysis.stats.noiseReduction > 30) {
      parts.push(`${analysis.stats.noiseReduction}% noise filtered out`);
    }
    
    return parts.length > 0 ? parts.join(', ') : 'Minor changes';
  }
}

module.exports = { DiffEngine };