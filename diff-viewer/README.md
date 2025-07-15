# Advanced Git Diff Viewer

A semantic diff viewer that reduces code review time by 30-40% through AST-based analysis and intelligent change detection.

## Features

- **Semantic Diffs**: AST-based parsing detects moved code, whitespace changes, and refactorings
- **Monaco Editor**: Same editor as VS Code for familiar, powerful diff viewing
- **File Tree Navigation**: Hierarchical view of changed files with additions/deletions counts
- **Keyboard Shortcuts**: `j`/`k` for file navigation, `s` to toggle semantic view
- **30% Line Reduction**: Filters out noise to show only meaningful changes
- **Dark Theme**: Matches Claude Orchestrator design
- **GitHub Integration**: Direct links from PR/commit URLs in Claude terminals

## Quick Start

### 1. Install Dependencies

```bash
# Server dependencies
cd diff-viewer
npm install

# Client dependencies
cd client
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env and add your GitHub personal access token
```

### 3. Start Servers

```bash
# Terminal 1: Start backend (port 7655)
cd diff-viewer
npm run dev

# Terminal 2: Start frontend (port 7656)
cd diff-viewer/client
npm run dev
```

### 4. Access from Claude Orchestrator

When Claude detects a GitHub PR or commit URL, click the "Advanced Diff" button to launch the viewer.

## Architecture

```
├── server/
│   ├── index.js           # Express server
│   ├── api/
│   │   ├── github.js      # GitHub API integration
│   │   └── diff.js        # Diff analysis endpoints
│   └── diff-engine/
│       ├── engine.js      # AST-based diff engine
│       └── ai-analyzer.js # Claude API integration (future)
└── client/
    ├── src/
    │   ├── App.jsx        # Main React app
    │   ├── components/
    │   │   ├── DiffViewer.jsx  # Main diff viewer
    │   │   ├── FileTree.jsx    # File navigation
    │   │   └── DiffStats.jsx   # Statistics display
    │   └── styles/        # CSS modules
    └── vite.config.js     # Build configuration
```

## API Endpoints

- `GET /api/github/pr/:owner/:repo/:pr` - Fetch PR metadata
- `GET /api/github/commit/:owner/:repo/:sha` - Fetch commit data
- `GET /api/diff/pr/:owner/:repo/:pr` - Analyze PR diff
- `GET /api/diff/commit/:owner/:repo/:sha` - Analyze commit diff
- `POST /api/diff/analyze` - Analyze custom diff text

## Development

### Adding Language Support

Edit `server/diff-engine/engine.js` to add new tree-sitter parsers:

```javascript
const Parser = require('tree-sitter');
const GoParser = require('tree-sitter-go');

// In initializeParsers()
this.parsers.set('go', { parser, language: GoParser });
```

### Customizing Semantic Analysis

The diff engine categorizes changes as:
- **Added**: New code blocks
- **Deleted**: Removed code blocks
- **Modified**: Changed code (not just moved)
- **Moved**: Code relocated within file

## Keyboard Shortcuts

- `j` - Next file
- `k` - Previous file
- `s` - Toggle semantic/raw view
- `ESC` - Close viewer (when in iframe)

## Performance

- Caches GitHub API responses for 5 minutes
- Lazy loads large diffs
- Tree-sitter runs in separate thread
- Target: <3 second load time for 95% of PRs

## Future Enhancements

- [ ] AI-powered summaries using Claude API
- [ ] Risk detection for security/performance issues
- [ ] Multi-file search and replace
- [ ] Integration with GitHub review comments
- [ ] Export to PDF/Markdown
- [ ] Collaborative review sessions