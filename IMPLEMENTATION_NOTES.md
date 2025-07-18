# Advanced Diff Viewer - Implementation Notes
## For Future Claude Sessions

### Current Status
- **Date**: 2025-07-15
- **Branch**: `feature/advanced-git-diff-viewer`
- **Phase**: Completed Phase 1 (MVP) - Frontend and Backend implemented

### What We're Building
An advanced git diff viewer integrated into Claude Orchestrator that provides:
- Semantic diffs (AST-based, not line-based)
- AI-powered summaries and risk detection
- One-click launch from GitHub PR/commit links in Claude terminals
- 30% fewer lines to review, 40% faster reviews

### Key Files Modified/Created
1. `ADVANCED_DIFF_VIEWER_PLAN.md` - Complete implementation plan
2. `client/app-new.js` - Added code review feature (lines ~1254-1510)
3. `client/styles-new.css` - Added review dropdown styles (lines ~734-810)
4. `server/statusDetector.js` - Fixed startup detection (lines ~97-106)

### Architecture Overview
```
Claude Terminal → Detects GitHub URL → Shows "Advanced Diff" button → 
Launches localhost:7655 → Fetches PR data → Shows semantic diff
```

### Next Steps for Implementation

#### Phase 1 MVP Checklist:
- [x] Create diff-viewer directory structure
- [x] Set up Express server on port 7655
- [x] Add GitHub API integration (use GITHUB_TOKEN env var)
- [x] Implement basic tree-sitter AST parser for JS/TS
- [x] Create React SPA with Monaco diff viewer
- [x] Add "Advanced Diff" button to detected GitHub links
- [ ] Test with real PRs from HyFire2 repo

#### What's Been Implemented:
1. **Server Side (diff-viewer/server/)**:
   - `index.js` - Express server with routes
   - `api/github.js` - GitHub API integration for fetching PR/commit data
   - `api/diff.js` - Diff analysis endpoints
   - `diff-engine/engine.js` - AST-based diff engine using tree-sitter
   - `diff-engine/ai-analyzer.js` - AI analysis stub (ready for Claude integration)

2. **Client Integration (app-new.js)**:
   - Updated `detectGitHubLinks()` to detect commit URLs
   - Updated `getGitHubButtons()` to add diff viewer button
   - Added `launchDiffViewer()` method to open diff viewer
   - Added CSS styling for diff viewer button

3. **Frontend (diff-viewer/client/)**:
   - React app with Vite build system
   - Monaco Editor integration for diff viewing
   - FileTree component for hierarchical navigation
   - DiffStats component showing change statistics
   - Keyboard shortcuts (j/k navigation, s for semantic toggle)
   - Dark theme matching orchestrator design

3. **Architecture Decisions**:
   - Using tree-sitter for AST parsing (JS, TS, Python supported)
   - In-memory caching for GitHub API responses (5 min TTL)
   - Semantic diff with change categorization (added/deleted/modified/moved)
   - Fallback to text-based diff for unsupported languages

#### Installation Instructions:
```bash
# Quick start with provided script
cd diff-viewer
./start.sh

# Or manual installation:
cd diff-viewer
npm install
cd client
npm install

# Start servers
# Terminal 1:
cd diff-viewer && npm run dev
# Terminal 2:
cd diff-viewer/client && npm run dev
```

#### GitHub Link Detection Update Needed:
In `client/app-new.js`, modify the `detectGitHubLinks` method to add diff viewer button:

```javascript
// Around line 872
detectGitHubLinks(sessionId, data) {
  const githubUrlPattern = /https:\/\/github\.com\/[^\s\)]+/g;
  const matches = data.match(githubUrlPattern);
  if (matches) {
    matches.forEach(url => {
      // Clean ANSI codes...
      
      // Add check for PR/commit URLs
      if (url.includes('/pull/') || url.includes('/commit/')) {
        // Store URL with diff viewer flag
        this.githubLinks.set(sessionId, {
          ...existing,
          diffViewerUrl: url
        });
      }
    });
  }
}
```

#### Environment Variables Needed:
```
GITHUB_TOKEN=ghp_xxxxx  # For API access
CLAUDE_API_KEY=sk-xxxx  # For AI summaries
DIFF_VIEWER_PORT=7655
```

### Technical Decisions Made:
1. **Port 7655** for diff viewer (orchestrator uses 3000)
2. **Tree-sitter** for AST parsing (most mature, 100+ languages)
3. **Monaco Editor** for diff UI (same as VS Code)
4. **Local SQLite** for caching diffs and progress
5. **Express + React** stack (consistent with orchestrator)

### Pain Points to Solve:
1. **Minified files**: Show token-level changes, not whole line
2. **Moved code**: Detect and show as moves, not add/delete
3. **AI noise**: Filter out formatting, focus on logic
4. **Review fatigue**: Track what's been reviewed

### Current Context Usage:
- Used ~80% of context so far
- Plan document is comprehensive
- Next session should start with Phase 1 implementation

### Critical Integration Points:
1. **GitHub Button**: Modify `getGitHubButtons()` in app-new.js
2. **Launch Logic**: Add `launchDiffViewer(url)` method
3. **Server Route**: `/api/diff/:owner/:repo/:pr`
4. **WebSocket**: For real-time diff updates

### Testing Strategy:
- Use HyFire2 repo PRs for testing
- Start with PR #925 (world restart mechanism)
- Test with both small and large diffs
- Verify AI summaries make sense

### Remember:
- This is a LOCAL tool, no cloud dependencies
- Security: Read-only GitHub access
- Performance: Must load in <3 seconds
- UX: Keyboard navigation is critical

---
### Completed in This Session:
- ✅ Full backend implementation with Express + GitHub API + Tree-sitter
- ✅ Complete React frontend with Monaco Editor
- ✅ File tree navigation with keyboard shortcuts
- ✅ Semantic vs raw diff toggle
- ✅ Responsive dark theme UI
- ✅ Created comprehensive README and startup script

**Next session priorities**:
1. Test with real HyFire2 PRs (need GitHub token in .env)
2. Fix any bugs found during testing
3. Consider implementing AI summaries (Phase 3)
4. Deploy production build