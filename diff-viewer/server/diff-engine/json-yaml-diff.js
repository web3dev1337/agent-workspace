const yaml = require('js-yaml');
const jsonDiff = require('json-diff');

class JsonYamlDiffEngine {
  constructor() {
    this.supportedTypes = {
      json: ['.json', '.jsonc', '.json5'],
      yaml: ['.yaml', '.yml']
    };
  }

  isSupported(filename) {
    const allExtensions = [...this.supportedTypes.json, ...this.supportedTypes.yaml];
    return allExtensions.some(ext => filename.endsWith(ext));
  }

  getType(filename) {
    for (const ext of this.supportedTypes.json) {
      if (filename.endsWith(ext)) return 'json';
    }
    for (const ext of this.supportedTypes.yaml) {
      if (filename.endsWith(ext)) return 'yaml';
    }
    return null;
  }

  parse(content, type) {
    try {
      switch (type) {
        case 'json':
          return JSON.parse(content);
        case 'yaml':
          return yaml.load(content);
        default:
          throw new Error(`Unsupported type: ${type}`);
      }
    } catch (error) {
      throw new Error(`Failed to parse ${type}: ${error.message}`);
    }
  }

  computeSemanticDiff(oldContent, newContent, filename) {
    const type = this.getType(filename);
    if (!type) {
      throw new Error(`Unsupported file type: ${filename}`);
    }

    try {
      // Parse both versions
      const oldData = this.parse(oldContent, type);
      const newData = this.parse(newContent, type);

      // Compute structured diff
      const diff = jsonDiff.diff(oldData, newData, {
        keysOnly: false,
        full: true
      });

      // Analyze the diff
      const analysis = this.analyzeDiff(diff);

      // Generate human-readable changes
      const changes = this.extractChanges(diff);

      return {
        type,
        diff,
        changes,
        analysis,
        isSemanticDiff: true
      };
    } catch (error) {
      // Fallback to text diff if parsing fails
      return {
        type,
        error: error.message,
        fallbackToText: true,
        isSemanticDiff: false
      };
    }
  }

  analyzeDiff(diff) {
    const stats = {
      keysAdded: 0,
      keysRemoved: 0,
      keysModified: 0,
      valuesChanged: 0,
      arrayChanges: 0,
      typeChanges: 0
    };

    const analyze = (obj, path = '') => {
      if (!obj || typeof obj !== 'object') return;

      Object.keys(obj).forEach(key => {
        if (key === '__old') return;
        if (key === '__new') return;

        const value = obj[key];
        const currentPath = path ? `${path}.${key}` : key;

        // Detect additions (marked with ~)
        if (key.startsWith('~')) {
          stats.keysRemoved++;
          return;
        }

        // Check for changes
        if (value && typeof value === 'object') {
          if (value.__old !== undefined && value.__new !== undefined) {
            stats.keysModified++;
            stats.valuesChanged++;

            // Check for type changes
            if (typeof value.__old !== typeof value.__new) {
              stats.typeChanges++;
            }
          } else if (Array.isArray(value)) {
            // Check for array modifications
            const hasChanges = value.some(item => 
              item && typeof item === 'object' && (item.__old !== undefined || item.__new !== undefined)
            );
            if (hasChanges) {
              stats.arrayChanges++;
            }
          }

          // Recurse
          analyze(value, currentPath);
        }
      });

      // Count new keys
      if (obj.__new && !obj.__old) {
        stats.keysAdded++;
      }
    };

    analyze(diff);

    return {
      stats,
      complexity: this.calculateComplexity(stats),
      summary: this.generateSummary(stats)
    };
  }

  calculateComplexity(stats) {
    const score = 
      stats.keysAdded * 1 +
      stats.keysRemoved * 1 +
      stats.keysModified * 2 +
      stats.typeChanges * 3 +
      stats.arrayChanges * 2;

    if (score === 0) return 'no-change';
    if (score < 5) return 'trivial';
    if (score < 20) return 'minor';
    if (score < 50) return 'moderate';
    return 'major';
  }

  generateSummary(stats) {
    const parts = [];
    
    if (stats.keysAdded > 0) {
      parts.push(`${stats.keysAdded} key${stats.keysAdded > 1 ? 's' : ''} added`);
    }
    if (stats.keysRemoved > 0) {
      parts.push(`${stats.keysRemoved} key${stats.keysRemoved > 1 ? 's' : ''} removed`);
    }
    if (stats.keysModified > 0) {
      parts.push(`${stats.keysModified} value${stats.keysModified > 1 ? 's' : ''} modified`);
    }
    if (stats.typeChanges > 0) {
      parts.push(`${stats.typeChanges} type change${stats.typeChanges > 1 ? 's' : ''}`);
    }
    if (stats.arrayChanges > 0) {
      parts.push(`${stats.arrayChanges} array modification${stats.arrayChanges > 1 ? 's' : ''}`);
    }

    return parts.length > 0 ? parts.join(', ') : 'No changes detected';
  }

  extractChanges(diff, path = '') {
    const changes = [];

    const extract = (obj, currentPath) => {
      if (!obj || typeof obj !== 'object') return;

      Object.keys(obj).forEach(key => {
        if (key === '__old' || key === '__new') return;

        const value = obj[key];
        const keyPath = currentPath ? `${currentPath}.${key}` : key;

        // Handle removed keys
        if (key.startsWith('~')) {
          const actualKey = key.substring(1);
          const actualPath = currentPath ? `${currentPath}.${actualKey}` : actualKey;
          changes.push({
            type: 'removed',
            path: actualPath,
            oldValue: value,
            newValue: undefined
          });
          return;
        }

        // Handle modified values
        if (value && typeof value === 'object') {
          if (value.__old !== undefined && value.__new !== undefined) {
            changes.push({
              type: 'modified',
              path: keyPath,
              oldValue: value.__old,
              newValue: value.__new,
              typeChange: typeof value.__old !== typeof value.__new
            });
          } else if (value.__new !== undefined && value.__old === undefined) {
            changes.push({
              type: 'added',
              path: keyPath,
              oldValue: undefined,
              newValue: value.__new
            });
          } else {
            // Recurse for nested objects
            extract(value, keyPath);
          }
        }
      });
    };

    extract(diff, path);

    // Sort changes by path for consistent display
    changes.sort((a, b) => a.path.localeCompare(b.path));

    return changes;
  }

  // Format the diff for display
  formatDiff(semanticDiff) {
    if (!semanticDiff.isSemanticDiff) {
      return {
        error: semanticDiff.error,
        fallback: true
      };
    }

    const { changes, analysis, type } = semanticDiff;

    // Group changes by operation type
    const grouped = {
      added: changes.filter(c => c.type === 'added'),
      removed: changes.filter(c => c.type === 'removed'),
      modified: changes.filter(c => c.type === 'modified')
    };

    return {
      type,
      summary: analysis.summary,
      complexity: analysis.complexity,
      stats: analysis.stats,
      grouped,
      changes: changes.map(change => ({
        ...change,
        oldValueStr: this.valueToString(change.oldValue),
        newValueStr: this.valueToString(change.newValue)
      }))
    };
  }

  valueToString(value) {
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    if (typeof value === 'string') return `"${value}"`;
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    }
    return String(value);
  }
}

module.exports = JsonYamlDiffEngine;