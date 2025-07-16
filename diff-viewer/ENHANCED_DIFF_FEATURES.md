# Enhanced Diff Features

This document describes the three new specialized diff engines added to the Advanced Git Diff Viewer.

## 1. Token-Level Diff for Minified Files

The `MinifiedDiffEngine` provides intelligent diffing for minified JavaScript, CSS, and other compressed files.

### Features:
- **Token-based comparison**: Breaks minified code into meaningful tokens (functions, variables, operators)
- **Smart chunking**: Groups related changes together for better readability
- **Language awareness**: Different tokenization rules for JS, CSS, HTML
- **Statistics**: Shows token additions, deletions, and total count

### Example Usage:
```javascript
const minifiedEngine = new MinifiedDiffEngine();
const diff = minifiedEngine.generateMinifiedDiff(oldContent, newContent, 'app.min.js');
```

### Output Format:
```json
{
  "isMinified": true,
  "suggestion": "View formatted diff for better readability",
  "tokenDiff": {
    "stats": {
      "tokensAdded": 15,
      "tokensRemoved": 8,
      "totalOldTokens": 45,
      "totalNewTokens": 52
    },
    "changes": [/* token-level changes */]
  },
  "displayChunks": [/* formatted chunks for UI display */]
}
```

## 2. JSON/YAML Semantic Comparison

The `JsonYamlDiffEngine` provides structural comparison for JSON and YAML files.

### Features:
- **Structural diff**: Compares objects at the semantic level, not text
- **Path tracking**: Shows exact path to changed values (e.g., `dependencies.axios`)
- **Type change detection**: Identifies when values change type
- **Complexity analysis**: Rates changes as trivial, minor, moderate, or major
- **Smart summaries**: Generates human-readable change descriptions

### Example Usage:
```javascript
const jsonYamlEngine = new JsonYamlDiffEngine();
const diff = jsonYamlEngine.computeSemanticDiff(oldJson, newJson, 'package.json');
const formatted = jsonYamlEngine.formatDiff(diff);
```

### Output Format:
```json
{
  "type": "json",
  "complexity": "moderate",
  "summary": "Modified 3 values, added 2 keys, removed 0 keys",
  "stats": {
    "keysAdded": 2,
    "keysRemoved": 0,
    "keysModified": 3,
    "totalKeys": 15
  },
  "grouped": {
    "added": [/* new keys */],
    "removed": [/* deleted keys */],
    "modified": [/* changed values */]
  }
}
```

## 3. Binary File Metadata Diffs

The `BinaryDiffEngine` extracts and compares metadata from binary files.

### Features:
- **File type detection**: Identifies images, documents, archives, media, fonts, ML models
- **Metadata extraction**: Size, hash, dimensions, format info
- **Type-specific analysis**: 
  - Images: dimensions, format, color space
  - Documents: page count, author, title
  - Archives: file count, compression ratio
  - Media: duration, bitrate, codec
- **Change visualization**: Shows what changed in human-readable format

### Example Usage:
```javascript
const binaryEngine = new BinaryDiffEngine();
const diff = await binaryEngine.computeBinaryDiff(oldBuffer, newBuffer, 'logo.png');
const formatted = binaryEngine.formatBinaryDiff(diff);
```

### Output Format:
```json
{
  "status": "changed",
  "fileType": "image",
  "changes": [
    {
      "label": "Size",
      "oldValue": "45.2 KB",
      "newValue": "52.8 KB",
      "diff": "+16.8%",
      "changeType": "increase"
    },
    {
      "label": "Hash",
      "oldValue": "abc123...",
      "newValue": "def456...",
      "changeType": "modified"
    }
  ],
  "summary": "Image file size increased by 16.8%"
}
```

## Integration with Main Diff Engine

All three engines are integrated into the main `DiffEngine` class:

```javascript
// The engine automatically detects file type and uses appropriate analyzer
const diffEngine = new DiffEngine();
const analysis = await diffEngine.analyzeDiff(file);

// Returns appropriate type: 'binary', 'minified', 'structured', 'semantic', or 'text'
```

## UI Components

Enhanced React components display these diff types:

- `BinaryDiffView`: Shows metadata changes with icons and badges
- `MinifiedDiffView`: Displays token-level changes with statistics
- `StructuredDiffView`: Shows JSON/YAML changes in a tree structure

## Testing

Example test files are provided in the `examples/` directory:
- `test-minified.js`: Tests minified JavaScript and CSS
- `test-json-yaml.js`: Tests JSON and YAML structural diffs  
- `test-binary.js`: Tests binary file metadata extraction

Run tests with:
```bash
node examples/test-minified.js
node examples/test-json-yaml.js
node examples/test-binary.js
```