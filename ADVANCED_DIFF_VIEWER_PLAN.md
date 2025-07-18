# Advanced Git Diff Viewer for Claude Orchestrator
## Implementation Plan

### Executive Summary
Integrate an advanced git diff viewer into Claude Orchestrator that provides semantic understanding of code changes, especially for AI-generated code reviews. The viewer will launch from detected GitHub PR/commit links and provide a superior review experience compared to GitHub's standard diff view.

### Problem Statement
- **GitHub's limitations**: Line-based Myers diff shows too much noise (whitespace, formatting, moved code)
- **AI-generated code challenges**: Often contains duplications, subtle bugs, and massive changes
- **Review efficiency**: Traditional diffs make reviewers process 25-30% more lines than necessary
- **Context loss**: Hard to understand why changes were made, especially with AI-generated code

### Solution Overview
Build a local diff viewer that:
1. **Semantic diff engine**: AST-based understanding of code changes
2. **AI-powered analysis**: Summaries, risk detection, and explanations
3. **Smart filtering**: Collapse trivial changes, highlight important ones
4. **Integrated workflow**: Launch from Claude terminal GitHub links

## Architecture

### Core Components

```
┌─────────────────────────────────────────────────────────────────┐
│                     Claude Orchestrator UI                       │
├─────────────────────────────────────────────────────────────────┤
│  GitHub Link Detection → "View Diff" Button → Launch Viewer     │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Diff Viewer Service                           │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐    │
│  │ GitHub API  │  │ Diff Engine  │  │  AI Analyzer       │    │
│  │ Integration │  │ Orchestrator │  │  (Claude API)      │    │
│  └─────────────┘  └──────────────┘  └────────────────────┘    │
│         │                 │                    │                │
│         ▼                 ▼                    ▼                │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐    │
│  │ PR/Commit   │  │ AST Parser   │  │ Pattern Detection  │    │
│  │ Fetcher     │  │ (Tree-sitter)│  │ (Security, Perf)  │    │
│  └─────────────┘  └──────────────┘  └────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Diff Viewer UI (SPA)                         │
├─────────────────────────────────────────────────────────────────┤
│  File Tree │ Summary Panel │ Interactive Diff View │ AI Chat   │
└─────────────────────────────────────────────────────────────────┘
```

### Technical Stack
- **Backend**: Node.js/Express (consistent with orchestrator)
- **Diff Engine**: Tree-sitter for AST parsing, custom diff algorithms
- **Frontend**: React SPA with Monaco Editor for diff viewing
- **AI Integration**: Claude API for summaries and analysis
- **Storage**: Local SQLite for caching diffs and review progress

## Implementation Phases

### Phase 1: MVP (1 week)
**Goal**: Basic semantic diff viewer integrated with orchestrator

**Features**:
- ✅ Detect GitHub PR/commit URLs in Claude terminals
- ✅ Add "Advanced Diff" button next to GitHub links
- ✅ Fetch PR/commit data via GitHub API
- ✅ Basic AST diff for JavaScript/TypeScript
- ✅ Side-by-side diff view with syntax highlighting
- ✅ Collapse whitespace-only changes

**Success Metrics**:
- Reduce displayed lines by 20% vs GitHub
- Load diff in <3 seconds
- Handle PRs up to 1000 lines

### Phase 2: Smart Diff Engine (1 week)
**Goal**: Advanced diff capabilities for all file types

**Features**:
- ✅ Support Python, Go, Ruby via Tree-sitter
- ✅ Detect moved/refactored code blocks
- ✅ Token-level diff for minified files
- ✅ JSON/YAML semantic comparison
- ✅ Binary file metadata diffs
- ✅ Inline edit highlighting

**Success Metrics**:
- Reduce displayed lines by 30% vs GitHub
- Correctly identify 90% of moved code
- Handle minified files without showing entire line changes

### Phase 3: AI Integration (1 week)
**Goal**: AI-powered insights and summaries

**Features**:
- ✅ Per-file change summaries
- ✅ PR-level executive summary
- ✅ Risk detection (security, performance)
- ✅ Duplication detection across codebase
- ✅ "Explain this change" on-demand
- ✅ AI confidence scores

**Success Metrics**:
- AI summaries rated helpful 80% of time
- False positive rate <15% for risk detection
- Identify 90% of duplicate code patterns

### Phase 4: Review Workflow (1 week)
**Goal**: Complete review experience

**Features**:
- ✅ Mark files/hunks as reviewed
- ✅ Track review progress across sessions
- ✅ Show only new changes since last review
- ✅ Keyboard navigation (j/k for files, etc)
- ✅ Comment integration with GitHub
- ✅ Export review notes

**Success Metrics**:
- Reduce re-reading by 90%
- Complete reviews 40% faster than GitHub
- Zero lost review progress

### Phase 5: Advanced Features (2 weeks)
**Goal**: Polish and power features

**Features**:
- ✅ Multi-PR comparison view
- ✅ Historical blame integration
- ✅ Test coverage diff overlay
- ✅ Performance profiling hints
- ✅ Custom ignore patterns
- ✅ Team review collaboration

## Key Innovations

### 1. Semantic Understanding
- **AST-based diff**: Understand code structure, not just text
- **Language-aware**: Different strategies per file type
- **Refactor detection**: Identify moved/renamed code

### 2. AI Augmentation
- **Smart summaries**: Natural language descriptions of changes
- **Risk scoring**: Proactive issue detection
- **Context provision**: Explain why changes might have been made

### 3. Efficiency Focus
- **Noise reduction**: Hide trivial changes by default
- **Progressive disclosure**: Expand details on demand
- **Keyboard-driven**: Fast navigation for power users

### 4. Integration Excellence
- **One-click launch**: From any GitHub link in Claude
- **Preserved context**: Know which Claude session made changes
- **Feedback loop**: Review results feed back to Claude

## Implementation Details

### GitHub Integration
```javascript
// Detect PR/commit links in terminal output
const detectGitHubLinks = (terminalContent) => {
  const patterns = {
    pr: /github\.com\/[^\/]+\/[^\/]+\/pull\/(\d+)/g,
    commit: /github\.com\/[^\/]+\/[^\/]+\/commit\/([a-f0-9]{40})/g,
    compare: /github\.com\/[^\/]+\/[^\/]+\/compare\/([^\s]+)/g
  };
  // Extract and validate links
};

// Add diff viewer button
const addDiffViewerButton = (link) => {
  return `<button onclick="launchDiffViewer('${link}')">
    🔍 Advanced Diff
  </button>`;
};
```

### Diff Engine Architecture
```javascript
// Orchestrate different diff strategies
class DiffOrchestrator {
  async analyzeDiff(files) {
    return Promise.all(files.map(async file => {
      const strategy = this.selectStrategy(file);
      const ast = await this.parseAST(file);
      const semanticDiff = await strategy.diff(ast);
      const aiAnalysis = await this.aiAnalyzer.analyze(semanticDiff);
      
      return {
        file,
        diff: semanticDiff,
        analysis: aiAnalysis,
        metrics: this.calculateMetrics(semanticDiff)
      };
    }));
  }
}
```

### AI Analysis Pipeline
```javascript
// Structured prompts for consistent AI analysis
const analyzeChanges = async (diff) => {
  const prompt = `
    Analyze this code diff for:
    1. Summary of logical changes (ignore formatting)
    2. Potential risks (security, performance, bugs)
    3. Code quality issues (duplication, complexity)
    
    Diff: ${diff}
    
    Output format:
    - Summary: <concise description>
    - Risks: [{ type, severity, description }]
    - Quality: { score, issues: [] }
  `;
  
  return await claudeAPI.analyze(prompt);
};
```

## Success Criteria

### Quantitative Metrics
- **Line reduction**: Show 30% fewer lines than GitHub
- **Review speed**: 40% faster reviews
- **Load time**: <3 seconds for 90% of PRs
- **Accuracy**: 90% correct detection of moved code
- **AI quality**: <15% false positive rate

### Qualitative Goals
- **"This is how GitHub should work"** - User feedback
- **Reduced cognitive load** when reviewing AI code
- **Confidence in review completeness**
- **Joy in the review process** (yes, really!)

## Risk Mitigation

### Technical Risks
- **Performance**: Cache aggressively, stream large diffs
- **Accuracy**: Extensive test suite for diff algorithms
- **API limits**: Local caching, rate limiting

### User Adoption
- **Gradual rollout**: Start with opt-in button
- **Preserve GitHub flow**: Don't break existing workflow
- **Clear value prop**: Show metrics on time saved

## Future Vision

### Near Term (3 months)
- Browser extension for GitHub integration
- Support for GitLab, Bitbucket
- Mobile responsive design

### Long Term (6+ months)
- Standalone SaaS offering
- IDE plugins (VS Code, JetBrains)
- Enterprise features (SSO, audit logs)
- AI model fine-tuning per codebase

## Next Steps

1. **Set up project structure**:
   ```bash
   claude-orchestrator/
   ├── diff-viewer/
   │   ├── server/
   │   │   ├── api/
   │   │   ├── diff-engine/
   │   │   └── ai-analyzer/
   │   ├── client/
   │   │   ├── components/
   │   │   └── views/
   │   └── shared/
   │       └── types/
   ```

2. **Install core dependencies**:
   - tree-sitter + language bindings
   - monaco-editor for diff view
   - GitHub API client
   - Express for API server

3. **Implement Phase 1 MVP**:
   - Week 1 sprint focused on core functionality
   - Daily progress updates
   - User testing with real PRs

4. **Iterate based on feedback**:
   - Measure actual metrics vs targets
   - Refine AI prompts for accuracy
   - Optimize performance bottlenecks

## Conclusion

This advanced diff viewer will transform how we review AI-generated code. By combining semantic understanding, AI insights, and UX excellence, we'll make code review not just faster, but more effective at catching real issues while ignoring noise.

The phased approach ensures we deliver value quickly while building toward a comprehensive solution. Starting with the orchestrator integration provides immediate value to your workflow, with a clear path to a standalone product.

Let's build the code review tool we've always wanted! 🚀