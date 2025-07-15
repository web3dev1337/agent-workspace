# Advanced Diff Viewer - Implementation Notes
## For Future Claude Sessions

### Current Status
- **Date**: 2025-07-15
- **Branch**: `feature/advanced-git-diff-viewer`
- **Phase**: Starting Phase 1 (MVP)

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
- [ ] Create React SPA with Monaco diff viewer
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

3. **Architecture Decisions**:
   - Using tree-sitter for AST parsing (JS, TS, Python supported)
   - In-memory caching for GitHub API responses (5 min TTL)
   - Semantic diff with change categorization (added/deleted/modified/moved)
   - Fallback to text-based diff for unsupported languages

#### Key Dependencies to Install:
```bash
cd diff-viewer
npm init -y
npm install express cors dotenv
npm install @octokit/rest  # GitHub API
npm install tree-sitter tree-sitter-javascript tree-sitter-typescript
npm install --save-dev @types/node typescript

# For client
npm install react react-dom monaco-editor
npm install --save-dev vite @vitejs/plugin-react
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
**For next session**: Start by creating the diff-viewer directory and implementing the Express server with GitHub API integration. The plan is solid, just execute Phase 1!