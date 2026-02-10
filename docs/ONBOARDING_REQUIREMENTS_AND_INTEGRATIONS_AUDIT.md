# Onboarding, Minimum Setup, and Integration Audit

Date: 2026-02-10
Scope: Minimum setup requirements, optional integrations, current onboarding/error handling, and user-friendliness gaps for both packaged Windows app installs and source/GitHub installs.

## 1) User Paths and Minimum Requirements

### Path A: Packaged Windows App (End User)
Goal: Run the app without cloning the repo.

Minimum expected setup:
- Install app package.
- Launch app.
- Have required backend resources bundled in app package.

Notes:
- Docs promise no Node requirement for packaged end users, but bootstrap fallback messaging still references `ORCHESTRATOR_NODE_PATH` and manual backend startup context.
- First-launch failures currently present a static bootstrap screen with limited recovery actions.

References:
- `WINDOWS_QUICK_START.md`
- `WINDOWS_BUILD_GUIDE.md`
- `src-tauri/src/main.rs`
- `src-tauri/bootstrap/index.html`

### Path B: Source Install (Developer)
Goal: Clone repo and run locally.

Minimum required tools/runtime:
- Node.js + npm.
- Git.
- Claude CLI for core terminal orchestration workflows.

Minimum runtime config:
- `ORCHESTRATOR_PORT` and `CLIENT_PORT`.
- Recommended auth/host safety config (`AUTH_TOKEN`, loopback host).

Notes:
- Node version guidance is inconsistent across docs (`16+`) vs `.nvmrc` (`24.9.0`).
- Client port guidance is inconsistent (`8080` in some docs vs `2080` in code/default quick start).

References:
- `package.json`
- `.nvmrc`
- `SETUP_INSTRUCTIONS.md`
- `DOCUMENTATION.md`
- `QUICK_START.md`
- `install.sh`
- `client/dev-server.js`
- `server/index.js`

### Path C: Native Dev Build (Tauri)
Goal: Build and run desktop app from source.

Minimum required tools/runtime:
- Node.js + npm.
- Rust toolchain.
- Platform-specific build dependencies (Windows MSVC/SDK, Linux GTK/WebKit deps).

References:
- `WINDOWS_BUILD_GUIDE.md`
- `SETUP_INSTRUCTIONS.md`
- `package.json`
- `src-tauri/src/main.rs`

## 2) Integration Matrix (Required vs Optional)

## Core Components
- Orchestrator server/client: required.
- Worktree/session orchestration and terminal controls: required.
- GitHub/Trello/Discord/Voice/Diff Viewer: optional by feature path.

## GitHub
Required for:
- GitHub repo listing in UI.
- Rich PR and metadata workflows.

Current configuration:
- `gh` CLI is primary for repo/PR operations.
- Some API fallback behavior exists for visibility/public info.

Current missing behavior:
- If `gh` is missing or unauthenticated, key flows fail or degrade.
- UI does show hints in some areas (for example repo picker and review warnings), but coverage is inconsistent.

References:
- `server/githubRepoService.js`
- `server/gitHelper.js`
- `server/worktreeMetadataService.js`
- `client/app.js`

## Trello
Required for:
- Task ticket provider flows.
- Trello-based task automations.

Current configuration:
- Env vars (`TRELLO_API_KEY`/`TRELLO_TOKEN`) or `~/.trello-credentials`.

Current missing behavior:
- If not configured, provider returns explicit errors and some UI hints are shown.
- Good baseline error semantics exist (`TRELLO_NOT_CONFIGURED`), but setup help is not centralized in onboarding.

References:
- `server/taskProviders/trelloProvider.js`
- `server/taskProviders/trelloCredentials.js`
- `server/taskTicketingService.js`
- `server/index.js`
- `client/app.js`

## Discord
Required for:
- Discord queue processing and services automation.

Current configuration:
- Env-driven controls for queue path, signing, auth, processor sessions, idempotency, rate limit, and dangerous-mode protections.

Current missing behavior:
- Failure modes are handled with structured HTTP errors, but setup expectations are advanced and not surfaced in first-run onboarding.

References:
- `server/discordIntegrationService.js`
- `server/index.js`
- `client/dashboard.js`

## Voice / LLM Parsing / Whisper
Required for:
- Voice features only.

Current configuration:
- Browser speech API path.
- Optional LLM parsing via Ollama/Anthropic.
- Optional local transcription via whisper backends.

Current missing behavior:
- Fallback logic exists (rule-based parsing, status messages), but user guidance on what to install next is scattered.

References:
- `server/voiceCommandService.js`
- `server/whisperService.js`
- `server/index.js`
- `client/voice-control.js`

## Diff Viewer
Required for:
- Embedded diff viewer experiences.

Current configuration:
- Separate diff-viewer service and build assets; auto-start integration.

Current missing behavior:
- Good runtime errors and retry/polling exist, but setup dependencies remain easy to miss for source installs.

References:
- `server/diffViewerService.js`
- `server/index.js`
- `client/app.js`
- `diff-viewer/README.md`
- `INSTALL_DIFF_VIEWER.md`

## 3) Current Onboarding and Error-Handling Coverage

What exists today:
- Diagnostics service with first-run checks and repair hooks.
- Install wizard APIs and diagnostics endpoints.
- UI diagnostics panel in Settings.
- Multiple targeted runtime warnings/toasts across subsystems.

What works well:
- Many backend endpoints return structured errors.
- Some high-value UI contexts already include specific hints (for example review console warning about GitHub auth, Trello not configured hint).
- Security guardrails exist around host binding and auth-sensitive paths.

References:
- `server/diagnosticsService.js`
- `server/index.js`
- `client/index.html`
- `client/app.js`
- `SECURITY.md`

## 4) Key Gaps (What is Missing or Confusing)

1. First-run onboarding is not proactive.
- Diagnostics/wizard exists but is hidden in Settings and not launched automatically on first run.
- Users can proceed into advanced flows before prerequisites are validated.

References:
- `client/index.html`
- `client/app.js`
- `server/diagnosticsService.js`

2. Workspace/project creation is not setup-gated.
- Missing prerequisites can cause downstream failures after creation steps.

References:
- `client/workspace-wizard.js`
- `client/greenfield-wizard.js`
- `server/diagnosticsService.js`

3. Windows packaged first-launch failure UX is too static.
- Bootstrap page lacks action-oriented recovery (retry/open logs/open diagnostics/copy details).

References:
- `src-tauri/src/main.rs`
- `src-tauri/bootstrap/index.html`

4. Setup docs are inconsistent.
- Node minimum version vs pinned version mismatch.
- Client port mismatch across docs/code.
- Root `.env.example` does not capture all practically relevant env vars used by key flows.

References:
- `.nvmrc`
- `SETUP_INSTRUCTIONS.md`
- `QUICK_START.md`
- `.env.example`
- `client/dev-server.js`
- `server/index.js`

5. Integration guidance is fragmented.
- GitHub/Trello/Discord/Voice/Diff setup is spread across multiple docs and runtime hints.
- No single “Integration Health” onboarding view.

References:
- `DOCUMENTATION.md`
- `INSTALL_DIFF_VIEWER.md`
- `WINDOWS_QUICK_START.md`
- `client/app.js`
- `client/dashboard.js`

## 5) What Happens If GitHub Is Not Set Up?

Current behavior:
- Repo listing and some PR-dependent workflows fail/degrade when `gh` is unavailable or not authenticated.
- Some fallback/public-only metadata paths exist.
- UI sometimes shows actionable hints, but not everywhere.

User impact:
- Confusing partial functionality unless user discovers and runs `gh auth login`.

Recommendation:
- Add a first-class onboarding check for GitHub CLI/auth.
- Show one-click “Run check” and copy-paste command guidance in onboarding modal.
- In all GitHub-failure toasts, include an “Open Diagnostics” action.

References:
- `server/githubRepoService.js`
- `server/gitHelper.js`
- `server/worktreeMetadataService.js`
- `client/app.js`

## 6) Prioritized Improvements (User-Friendly Onboarding)

P0 (High impact, should do first):
- Auto-run first-run diagnostics on initial launch and block advanced actions on blocking failures.
- Add a guided onboarding modal with actionable steps and one-click repairs where safe.
- Gate workspace/project creation when diagnostics report blocking prerequisites.

P1:
- Add an “Integration Health” panel (GitHub, Trello, Discord, Voice, Diff Viewer) with status + fix steps.
- Normalize error-to-recovery UX: every setup-related failure toast should offer “Open Diagnostics”.

P2:
- Upgrade Windows bootstrap failure page with retry/open logs/copy diagnostics actions.
- Emit structured startup error codes from Tauri backend for clearer user messaging.

P3:
- Consolidate docs into a single canonical onboarding doc with clear profiles:
  - End user (packaged app)
  - Source user (web/server)
  - Native contributor (Tauri)
- Reconcile Node and port documentation inconsistencies.

## 7) Suggested Acceptance Criteria for a Better Onboarding Flow

- First launch automatically runs prerequisite checks and surfaces blocking issues before workspaces are created.
- Users can fix or bypass non-blocking issues with explicit tradeoff messaging.
- GitHub/Trello/Discord setup status is visible from one screen.
- Missing integration errors always include direct recovery actions.
- Windows bootstrap failures include immediate recovery actions (retry, open logs, copy details).
- Docs for minimum setup match actual runtime defaults and enforced behavior.

## 8) Quick Implementation Plan (Follow-up Work)

1. Wire first-run diagnostics modal into app startup and add persisted completion state.
2. Add setup gating hooks to workspace/project creation flows.
3. Implement integration health endpoint aggregation + UI panel.
4. Improve Tauri bootstrap error payloads and bootstrap UI actions.
5. Update and consolidate setup docs (`README.md`, `SETUP_INSTRUCTIONS.md`, `WINDOWS_QUICK_START.md`, `.env.example`).
