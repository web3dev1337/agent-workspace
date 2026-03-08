# Claude Orchestrator (Gas Town GUI) - Gap Analysis & Implementation Plan

**Generated:** 2026-01-17
**Current Branch:** `feat/phase1-stability-fixes`
**Analysis:** Gap analysis vs official Gas Town (steveyegge/gastown)

> NOTE (2026-01-30): This is a historical gap-analysis snapshot. It has been reconciled to reflect what is shipped vs what is
> manual or future work, so it no longer contains open checkboxes that look like “unshipped work”.

---

## Executive Summary

| Category | Status | Priority |
|----------|--------|----------|
| **Security** | 🟡 Manual verification (keys/history) | P0 Immediate |
| **Hardcoded Paths** | 🟢 Addressed in-repo | P0 Before Deploy |
| **Test Coverage** | 🟡 ~44% line coverage overall | P1 Critical |
| **Feature Parity** | 🟡 15-20% of Gas Town | P2 Roadmap |
| **Version Compatibility** | 🟢 OK (0.1.1 vs 0.2.6) | P3 Upgrade |

---

## Phase 0: CRITICAL SECURITY FIXES (Do First!)

### 0.1 🔴 REVOKE EXPOSED API KEY IMMEDIATELY

**File:** `.env` line 9
```
ANTHROPIC_API_KEY=sk-ant-api03-Dzw_...
```

**Actions (manual / owner):**
1. Go to https://console.anthropic.com → API Keys → revoke the leaked key (if it still exists).
2. Generate a replacement key and rotate any machines/services that used the old key.
3. Verify `.env` is not present in git history (see below).
4. Verify `.env` is ignored by git (`.gitignore`).
5. Verify `.env.example` exists and contains placeholders only.

**Git History Cleanup:**
```bash
# Remove .env from ALL git history
git filter-branch --force --index-filter \
  'git rm --cached --ignore-unmatch .env' \
  --prune-empty --tag-name-filter cat -- --all

# Force push (coordinate with team!)
git push origin --force --all
```

---

## Phase 1: Deployment Blockers (P0)

### 1.1 Remove Hardcoded Paths

| File | Line | Issue | Fix |
|------|------|-------|-----|
| `server/gitHelper.js` | n/a | HOME handling can break git safe.directory → “unknown” branch | Fixed (no longer overrides HOME) |
| `server/index.js` | n/a | Hardcoded user paths for build-production | Fixed (derive from session `cwd`) |
| `server/greenfieldService.js` | n/a | Hardcoded GitHub-root defaults | Fixed (configurable via `GREENFIELD_GITHUB_ROOT`/`GITHUB_ROOT`) |
| `client/*` | n/a | Hardcoded dev port mapping 2080/2081→3000/4000 | Fixed (use same-origin; dev server proxies `/api`) |

**Estimated Effort:** 4-6 hours

### 1.2 Configuration System

Create a setup wizard or first-run configuration:

```javascript
// config/userConfig.js
module.exports = {
  githubUsername: process.env.GITHUB_USERNAME || null,
  projectPaths: {
    games: process.env.GAMES_PATH || '~/GitHub/games',
    tools: process.env.TOOLS_PATH || '~/GitHub/tools',
    websites: process.env.WEBSITES_PATH || '~/GitHub/websites',
  },
  ports: {
    production: parseInt(process.env.PORT) || 3000,
    development: parseInt(process.env.DEV_PORT) || 4000,
  }
};
```

**Estimated Effort:** 2-4 hours

---

## Phase 2: Test Coverage (P1)

### Current State
- **Coverage:** 35% (9/26 services tested)
- **Missing CI/CD:** No GitHub Actions workflow
- **Critical Gaps:** SessionManager, Socket.IO, API endpoints

### 2.1 TIER 1: Critical Tests (Week 1-2)

| Test | File | Priority | Effort |
|------|------|----------|--------|
| SessionManager | `tests/unit/sessionManager.test.js` | CRITICAL | 2-3 days |
| SessionRecoveryService | `tests/unit/sessionRecoveryService.test.js` | CRITICAL | 1 day |
| Socket.IO Events | `tests/integration/socketio-events.test.js` | CRITICAL | 2-3 days |
| API Endpoints | `tests/integration/api-endpoints.test.js` | HIGH | 1-2 days |
| CI/CD Workflow | `.github/workflows/test.yml` | HIGH | 1 day |

**SessionManager Tests to Add:**
```javascript
describe('SessionManager', () => {
  test('creates new claude session');
  test('creates new server session');
  test('handles terminal input');
  test('handles terminal resize');
  test('restarts session');
  test('cleanups on session end');
  test('timeouts inactive sessions');
  test('recovers from process crash');
});
```

**Socket.IO Tests to Add:**
```javascript
describe('WebSocket Events', () => {
  test('terminal-input sends data to session');
  test('terminal-resize resizes terminal');
  test('restart-session restarts session');
  test('start-claude starts claude session');
  test('concurrent events handled correctly');
  test('disconnected clients cleanup');
});
```

**Estimated Effort:** ~2 weeks

### 2.2 TIER 2: High Priority Tests (Week 3-4)

| Test | File | Effort |
|------|------|--------|
| VoiceCommandService | `tests/unit/voiceCommandService.test.js` | 1-2 days |
| GitHelper | `tests/unit/gitHelper.test.js` | 2 days |
| AgentManager | `tests/unit/agentManager.test.js` | 1 day |
| CommandRegistry | `tests/unit/commandRegistry.test.js` | 1 day |

**Estimated Effort:** ~2 weeks

### 2.3 CI/CD Pipeline

Create `.github/workflows/test.yml`:
```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run test:unit
      - run: npm run test:e2e
      - run: npm run test:coverage
```

---

## Phase 3: Feature Parity with Gas Town (P2)

### Current Implementation: ~15-20%
### Target: Core features for production use

### Gas Town Command Coverage

| Command Group | Total | GUI Has | Gap |
|---------------|-------|---------|-----|
| Work Management | 11 | 1 (partial) | 10 |
| Agent Management | 11 | 2 (partial) | 9 |
| Communication | 6 | 0 | 6 |
| Services | 5 | 3 | 2 |
| Workspace | 6 | 4 | 2 |
| Configuration | 3 | 2 | 1 |
| Diagnostics | 9 | 1 | 8 |
| **TOTAL** | **51** | **13** | **38** |

### 3.1 Priority Features for MVP

Tracked as future work in `PLANS/2026-01-30/GASTOWN_PARITY_BACKLOG.md`.

### 3.2 Nice-to-Have Features (Post-MVP)

- Formula Editor & Molecule Workflows
- Mail System Integration
- Merge Queue UI
- Witness (Polecat Monitoring)
- Escalation System UI

---

## Phase 4: Version Management (P3)

### Current State
- **Installed:** gt 0.1.1 (Jan 3, 2025)
- **Latest:** gt 0.2.6 (Jan 12, 2026)
- **Gap:** 15 minor versions

### 4.1 Upgrade Plan

```bash
# Check current version
gt --version

# Check if stale
gt stale

# Upgrade (when convenient)
# Download latest from https://github.com/steveyegge/gastown/releases
```

### 4.2 Key Changes in 0.2.x

- Escalation system with severity levels
- `gt polecat identity` subcommand
- AGENTS.md fallback for polecat context
- `--debug` flag for `gt crew at`
- routes.jsonl corruption prevention
- Session lifecycle improvements

**Risk Level:** LOW - GUI operates independently of gt CLI

---

## Implementation Timeline

```
Week 1:  Phase 0 (Security) + Phase 1.1 (Hardcoded paths)
Week 2:  Phase 1.2 (Config) + Phase 2.1 start (Tests)
Week 3:  Phase 2.1 continue (SessionManager, Socket.IO tests)
Week 4:  Phase 2.1 complete + CI/CD
Week 5:  Phase 2.2 (High priority tests)
Week 6:  Phase 3A start (Convoy Dashboard)
Week 7:  Phase 3A continue (Sling Interface)
Week 8:  Phase 3B (Polecat Management)
Week 9:  Phase 3C (Monitoring)
Week 10: Phase 4 + Final polish
```

**Total Estimated Effort:** 230-330 hours over 10 weeks

---

## Quick Wins (Can Do Today)

1. (manual) **Revoke API key** (5 min) - CRITICAL
2. ✅ **Add .env to .gitignore** (shipped)
3. ✅ **Create .env.example** (shipped)
4. ✅ **Fix HOME handling in gitHelper** (shipped)
5. ✅ **Fix hardcoded build-production path** (shipped)
6. ✅ **Create CI workflow file** (shipped)

---

## Files to Modify

### Security Fixes
- [x] `.env` - Remove from repo
- [x] `.gitignore` - Add `.env`
- [x] `.env.example` - Create with placeholders

### Hardcoded Paths
✅ `server/gitHelper.js` - HOME handling no longer breaks git safe.directory (avoids stuck "unknown" branch)
✅ `server/index.js` - build-production now runs from the session's cwd (no hardcoded user paths)
✅ `server/greenfieldService.js` - default GitHub root configurable via `GREENFIELD_GITHUB_ROOT` / `GITHUB_ROOT`
✅ `client/*` - removed hardcoded dev-port mapping; always use same-origin (dev server proxies `/api`)
✅ `scripts/*` - no hardcoded `/home/<user>` paths remain

### New Test Files
✅ SessionManager tests exist: `tests/unit/sessionManager.*.test.js`
✅ SessionRecovery coverage exists (indirect + unit tests; expand as needed)
✅ VoiceCommandService tests exist: `tests/unit/voiceCommandService.test.js`
✅ Git helper tests exist: `tests/unit/gitHelper.env.test.js`
✅ UI/API/socket integration coverage exists via Playwright: `npm run test:e2e:safe`
✅ CI workflow: `.github/workflows/tests.yml`

---

## Success Criteria

### MVP (Deployable)
- No exposed secrets: repo no longer ships `.env`; manual key revoke/history scrub still required if a key was leaked.
- No hardcoded user-specific paths: addressed in-repo (no tracked `/home/<user>` strings; runtime uses `os.homedir()` / `os.tmpdir()`).
- CI/CD running tests on PRs: shipped (`.github/workflows/tests.yml`).
- Test coverage snapshot (2026-01-30): ~44% lines overall (`npm run test:coverage`).
- Installation works on fresh machine: manual verification required (follow `QUICK_START.md` + `COWORKER_SETUP_GUIDE.md`).

### Full Release
- 80%+ test coverage: future work.
- Convoy/Sling/Polecat features: future work (`PLANS/2026-01-30/GASTOWN_PARITY_BACKLOG.md`).
- Monitoring dashboard: future work (`PLANS/2026-01-30/GASTOWN_PARITY_BACKLOG.md`).
- gt 0.2.x compatibility verified: future work (manual verification).

---

## Known Limitations (Current State)

From the original docs:
> **Not Yet Implemented:**
> - Polecat management (spawn, kill, view logs)
> - Convoy management
> - Formula editor/creator
> - Agent configuration
> - Crew management
> - Rig removal/deletion
> - Work item editing

These align with our gap analysis findings.
