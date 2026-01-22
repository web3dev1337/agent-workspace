// Temporarily disabled tree-sitter - Node 24 compatibility issue
// const Parser = require('tree-sitter');
// const JavaScript = require('tree-sitter-javascript');
// const TypeScript = require('tree-sitter-typescript').typescript;
// const Python = require('tree-sitter-python');
const diff = require('diff');
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
    const patch = file?.patch || '';
    const patchLines = patch.split('\n');

    const hunks = [];
    let currentHunk = null;
    let oldLine = 0;
    let newLine = 0;

    patchLines.forEach((line) => {
      if (line.startsWith('@@')) {
        // Parse hunk header
        const match = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
        if (match) {
          const oldStart = parseInt(match[1], 10);
          const oldCount = parseInt(match[2] || '1', 10);
          const newStart = parseInt(match[3], 10);
          const newCount = parseInt(match[4] || '1', 10);

          currentHunk = {
            header: line,
            oldStart,
            oldCount,
            newStart,
            newCount,
            rows: []
          };
          hunks.push(currentHunk);
          oldLine = oldStart;
          newLine = newStart;
        } else {
          currentHunk = null;
        }
        return;
      }

      if (!currentHunk) return;

      // Ignore metadata lines inside patches
      if (line.startsWith('+++') || line.startsWith('---')) return;
      if (line.startsWith('\\ No newline at end of file')) return;

      if (line.startsWith(' ')) {
        currentHunk.rows.push({
          type: 'context',
          oldLine,
          newLine,
          content: line.substring(1)
        });
        oldLine += 1;
        newLine += 1;
        return;
      }

      if (line.startsWith('-')) {
        currentHunk.rows.push({
          type: 'deleted',
          oldLine,
          newLine: null,
          content: line.substring(1)
        });
        oldLine += 1;
        return;
      }

      if (line.startsWith('+')) {
        currentHunk.rows.push({
          type: 'added',
          oldLine: null,
          newLine,
          content: line.substring(1)
        });
        newLine += 1;
      }
    });

    const changes = hunks.flatMap(h =>
      h.rows.map(r => {
        if (r.type === 'context') {
          return {
            type: 'context',
            line: r.newLine,
            content: r.content,
            significant: false
          };
        }

        if (r.type === 'deleted') {
          return {
            type: 'deleted',
            line: r.oldLine,
            content: r.content,
            significant: !this.isWhitespaceOnly(r.content || '')
          };
        }

        if (r.type === 'added') {
          return {
            type: 'added',
            line: r.newLine,
            content: r.content,
            significant: !this.isWhitespaceOnly(r.content || '')
          };
        }

        return {
          type: r.type,
          line: r.newLine ?? r.oldLine,
          content: r.content ?? '',
          significant: false
        };
      })
    );

    // Pair delete+add runs into "updated" operations (line-level updates).
    const richHunks = hunks.map(h => ({
      ...h,
      rows: this.pairUpdatedRows(h.rows)
    }));

    const findReplace = this.detectFindReplacePatterns(richHunks);
    const movedBlocks = this.detectMovedBlocks(richHunks);
    const copyPaste = this.detectCopyPaste(richHunks);
    const operations = {
      ...this.computeRichOperations(richHunks),
      moved: movedBlocks.length,
      copyPaste: copyPaste.length,
      findReplace: findReplace.length
    };

    return {
      type: 'text',
      changes,
      stats: this.calculateStats(changes),
      richText: {
        type: 'rich-text',
        hunks: richHunks,
        operations,
        findReplace,
        movedBlocks,
        copyPaste,
        stats: {
          totalHunks: richHunks.length,
          ...operations
        }
      }
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

  pairUpdatedRows(rows) {
    const paired = [];
    let idx = 0;

    while (idx < rows.length) {
      const row = rows[idx];
      if (row.type !== 'deleted' && row.type !== 'added') {
        paired.push(row);
        idx += 1;
        continue;
      }

      // Collect a run of deletes or adds
      const deletes = [];
      const adds = [];

      if (row.type === 'deleted') {
        while (idx < rows.length && rows[idx].type === 'deleted') {
          deletes.push(rows[idx]);
          idx += 1;
        }
        while (idx < rows.length && rows[idx].type === 'added') {
          adds.push(rows[idx]);
          idx += 1;
        }
      } else {
        while (idx < rows.length && rows[idx].type === 'added') {
          adds.push(rows[idx]);
          idx += 1;
        }
        while (idx < rows.length && rows[idx].type === 'deleted') {
          deletes.push(rows[idx]);
          idx += 1;
        }
      }

      // Pair 1:1 as updates when we have both sides.
      const pairs = Math.min(deletes.length, adds.length);
      for (let i = 0; i < pairs; i += 1) {
        const oldContent = deletes[i].content || '';
        const newContent = adds[i].content || '';

        const wordDiff = diff.diffWordsWithSpace(oldContent, newContent);
        const oldSegments = [];
        const newSegments = [];
        wordDiff.forEach(part => {
          const value = part.value || '';
          if (part.added) {
            newSegments.push({ type: 'added', value });
          } else if (part.removed) {
            oldSegments.push({ type: 'removed', value });
          } else {
            oldSegments.push({ type: 'common', value });
            newSegments.push({ type: 'common', value });
          }
        });

        paired.push({
          type: 'updated',
          oldLine: deletes[i].oldLine,
          newLine: adds[i].newLine,
          oldContent,
          newContent,
          oldSegments,
          newSegments
        });
      }

      // Any leftover lines remain add/delete operations.
      deletes.slice(pairs).forEach(d => paired.push(d));
      adds.slice(pairs).forEach(a => paired.push(a));
    }

    return paired;
  }

  computeRichOperations(hunks) {
    const ops = {
      added: 0,
      deleted: 0,
      updated: 0,
      context: 0,
      moved: 0,
      copyPaste: 0,
      findReplace: 0
    };

    hunks.forEach(h => {
      h.rows.forEach(r => {
        if (r.type === 'added') ops.added += 1;
        else if (r.type === 'deleted') ops.deleted += 1;
        else if (r.type === 'updated') ops.updated += 1;
        else ops.context += 1;
      });
    });

    return ops;
  }

  detectFindReplacePatterns(hunks) {
    const counts = new Map();

    hunks.forEach(h => {
      h.rows.forEach(r => {
        if (r.type !== 'updated') return;

        const parts = diff.diffWordsWithSpace(r.oldContent || '', r.newContent || '');
        const removedParts = parts
          .filter(p => p.removed)
          .map(p => (p.value || '').trim())
          .filter(Boolean);
        const addedParts = parts
          .filter(p => p.added)
          .map(p => (p.value || '').trim())
          .filter(Boolean);

        // Heuristic: treat a single removed -> single added as a candidate replace pattern.
        if (removedParts.length !== 1 || addedParts.length !== 1) return;

        const from = removedParts[0];
        const to = addedParts[0];
        if (from.length < 1 || to.length < 1) return;
        if (from.length > 80 || to.length > 80) return;

        const key = `${from}=>${to}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      });
    });

    const patterns = Array.from(counts.entries())
      .map(([key, count]) => {
        const [from, to] = key.split('=>');
        return { from, to, count };
      })
      .filter(p => p.count >= 3)
      .sort((a, b) => b.count - a.count);

    return patterns;
  }

  detectMovedBlocks(hunks) {
    // Exact-match moved blocks (min 2 lines) within the patch.
    const buildBlocks = (type) => {
      const blocks = [];
      hunks.forEach((h, hunkIndex) => {
        let i = 0;
        while (i < h.rows.length) {
          if (h.rows[i].type !== type) {
            i += 1;
            continue;
          }
          const start = i;
          const lines = [];
          while (i < h.rows.length && h.rows[i].type === type) {
            const content = (h.rows[i].content || '').trimEnd();
            lines.push({ rowIndex: i, content, oldLine: h.rows[i].oldLine, newLine: h.rows[i].newLine });
            i += 1;
          }
          const nonEmpty = lines.filter(l => l.content.trim().length > 0);
          if (nonEmpty.length >= 2) {
            blocks.push({
              hunkIndex,
              startRow: start,
              lines: nonEmpty
            });
          }
        }
      });
      return blocks;
    };

    const deletedBlocks = buildBlocks('deleted');
    const addedBlocks = buildBlocks('added');

    const addedBySig = new Map();
    addedBlocks.forEach((b, idx) => {
      const signature = b.lines.map(l => l.content).join('\n');
      const list = addedBySig.get(signature) || [];
      list.push({ ...b, idx });
      addedBySig.set(signature, list);
    });

    const usedAdded = new Set();
    const moves = [];

    deletedBlocks.forEach((delBlock) => {
      const signature = delBlock.lines.map(l => l.content).join('\n');
      const candidates = addedBySig.get(signature);
      if (!candidates || candidates.length === 0) return;

      const candidate = candidates.find(c => !usedAdded.has(c.idx));
      if (!candidate) return;

      usedAdded.add(candidate.idx);

      moves.push({
        lines: delBlock.lines.length,
        from: {
          hunk: delBlock.hunkIndex,
          line: delBlock.lines[0].oldLine
        },
        to: {
          hunk: candidate.hunkIndex,
          line: candidate.lines[0].newLine
        }
      });
    });

    return moves;
  }

  detectCopyPaste(hunks) {
    // Detect identical added lines added multiple times (within this patch).
    const counts = new Map();
    hunks.forEach(h => {
      h.rows.forEach(r => {
        if (r.type !== 'added') return;
        const content = (r.content || '').trim();
        if (!content) return;
        counts.set(content, (counts.get(content) || 0) + 1);
      });
    });

    return Array.from(counts.entries())
      .map(([content, count]) => ({ content, count }))
      .filter(item => item.count >= 2)
      .sort((a, b) => b.count - a.count);
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
