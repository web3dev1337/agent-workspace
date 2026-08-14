# Evidence + Review Workflows + Process Layer v2 (2026-07-15)

Synthesis of the `optimal-agent-orcestration-system` research (tier system, P-A-R math, review-chain math, risk-based verification) + a 6-scout code audit of this repo. This is the implementation plan for branch `feature/review-inbox-and-tier-workflows`.

## What already exists (don't rebuild)

The Jan-Feb 2026 process layer is mature and mostly HIDDEN, not missing:
- `taskRecordService` (tier/risk/pFail/verify/deps/review outcomes/timers) + Queue panel (`showQueuePanel`, app.js:26380+) + Review Console + conveyors + 42 `queue-*` commands + `processStatusService` (WIP + B/W/Q/X + per-tier caps + launch gating) + `processAdvisorService` + `processTelemetryService` + `prReviewAutomationService` (single-role reviewer spawn) + prompt artifacts + dependency graph.
- Hidden via `ui.visibility` defaults (commits 8abc8aa2..858a2bcc, Feb-Mar 2026). The queue header button is additionally hidden by a HARDCODED `style="display:none"` in index.html (~line 81) despite `header.queue: true`.
- Two abandoned branches (PR #804 open/conflicting; #806 stacked into it) built `latestReview*` persistence + terminal review buttons. docs/REVIEW_SYSTEM_DOCUMENTATION.md documents that UNMERGED code. Decision: adopt field naming ideas, implement fresh (single-review model doesn't fit chains; 5 months of drift; untested).

## Confirmed bugs found (fix in this PR)

1. `prReviewAutomationService._spawnReviewerForPr` calls `startAgentWithConfig(sessionId, {provider, skipPermissions:true, mode:'fresh'})` but the API requires `{agentId, mode, flags:['skipPermissions']}` → validation always fails → **auto-reviewer spawn has never worked**. Correct pattern lives in `batchLaunchService.js:181` (also: prompt then `\r` as separate writes, not `prompt+'\n'`).
2. `pr-review-automation` socket event has zero client listeners (dead telemetry).
3. Queue button: visibility flag true but inline `display:none` wins.

## Research → design constants (from FINAL_ARTICLE et al.)

- Review chains: p_chain = Πp_i (30% → 9% → 2.7%); sweet spot 2-3 reviewers; more only for high-risk/security. Chains raise fan-out capacity ~60%.
- Risk: `impact = 0.25*live + 0.20*users + 0.20*(1-rollback_ease) + 0.20*breaks_other + 0.15*money`; `p_fail = 0.30*complexity + 0.25*testsPenalty + 0.20*novel + 0.15*(chain?0.3:1.0) + 0.10*(1-specQuality)`; `risk = 0.6*impact + 0.4*p_fail`; bands: <0.2 AUTO_MERGE / 0.2-0.4 QUICK_CHECK / 0.4-0.6 BASIC_VERIFY / >0.6 FULL_REVIEW.
- Low-testability domains (games/UI): tests are weak evidence (p_auto_catch≈30%) → screenshots/app-ran proof must be FIRST-CLASS evidence.
- Context tax: 5-15 min/switch; batch by repo/type. ρ ≤ 0.85. Caps: WIP≤5, T1≤1/T2≤2/T3≤5/T4≤1 (already in processStatusService).
- Cache: >~1h old prompt = cold cache → reprompt in FRESH window with handoff notes (ledger pattern).
- All research %s are priors, not measurements — telemetry exists to calibrate them.

## New feature 1 — Evidence system (centerpiece)

The 7 things a human needs at a glance per finished task: tests ran+passed · app actually ran · review-chain verdicts+fixes · screenshots/video · data/balance proof · diff stats · standards used.

**Sources, merged by new `server/evidenceService.js`:**
1. Fenced ```agent-evidence JSON blocks in PR body + PR comments (primary; travels with the PR, cross-machine, reviewers append their own blocks as comments).
2. `.agent-evidence.json` + `.agent-evidence/` media dir in the worktree (local supplement; primary for worktree/session tasks with no PR yet).
3. Direct API: `PUT /api/process/evidence/:taskId`.
Server-computed: `diffStats` aggregated from `pullRequestService` per-file additions/deletions (never trust agent-supplied numbers for PRs).

**Task record field `evidence`** (normalized in taskRecordService, pattern: normalizeReviewChecklist):
```json
{ "schema": 1, "updatedAt": "ISO", "summary": "...",
  "tests": {"ran":true,"command":"npm test","passed":47,"failed":0,"output":"tail","at":"ISO"},
  "appRun": {"ran":true,"method":"puppeteer|server-smoke|studio|manual","url":"","notes":"","at":"ISO"},
  "media": [{"type":"image","path":".agent-evidence/feature.png","caption":""}],
  "data": [{"metric":"dps","before":120,"after":90,"note":"autoplay 3 runs"}],
  "reviews": [{"role":"security","agentId":"codex","model":"gpt-5.5","verdict":"approved","summary":"","findings":2,"fixed":2,"at":"ISO"}],
  "standards": ["CLAUDE.md"],
  "handoff": {"notes":"for successor agent"},
  "diffStats": {"files":12,"additions":340,"deletions":80} }
```

**UI**: evidence card in Queue `renderDetail` via new `client/queue-evidence.js` — badge row (🧪 47✅ · ▶️ ran · 🛡️✅ · 📸3 · 📊2 · 12 files +340/−80) + expandable sections + media lightbox (`GET /api/process/evidence/:taskId/media/:idx`, path-validated streaming). Evidence completeness indicator drives review-readiness.

**Protocol**: `docs/agents/EVIDENCE_PROTOCOL.md` — how agents self-report (JSON schema + fenced-block examples + media conventions + handoff notes + how an implementer agent can run its OWN review chain). Referenced/injected by launch prompts (batchLaunch prefix, workflow templates).

## New feature 2 — Review workflows (data-driven chains)

`config/review-workflows.json`: named workflows (stages[] with role/agentId/model/effort/promptTemplate), role prompt templates ({{prNumber}} {{owner}} {{repo}} {{standards}} …), riskDefaults (low→standard 1-stage, high→hardened 2-stage, critical→full-gate 3-stage). New `server/reviewWorkflowService.js`: sequential stage runner on top of the fixed spawn machinery — spawn stage reviewer → detect its GitHub review + agent-evidence comment → record into `evidence.reviews[]` → next stage → done → notify. Queue detail gets workflow picker + "Run review workflow" + per-stage status chips. Per-role model: claude `--model <m>` (extend buildClaudeCommand), codex `-m <m> -c model_reasoning_effort=<e>`. Research note: reviewer model strength should scale with risk (cheap reviewer for low-risk, strong for security/high-risk) — encode in the default config, keep data-driven.

## New feature 3 — Review Hub surfacing + visibility presets

- Remove hardcoded display:none from queue button; label "Review".
- `ui.visibilityPreset`: `simple` (today's defaults) | `power` (workflow modes, tier filters, PRs, review route, activity, diff, process banner, dashboard process cards, commander controls ON). Server: preset maps + `POST /api/user-settings/visibility-preset`. Settings panel: preset switch section (finally a UI for this — none exists today).

## New feature 4 — Cache freshness + fresh-window reprompt

promptAge from `promptSentAt`; >55 min → queue detail + reprompt actions warn "cache cold — use fresh window"; "Reprompt (fresh)" action spawns fresh-mode session seeded with `evidence.handoff.notes` + prompt artifact.

## New feature 5 — Context-switch telemetry (local-only)

`server/contextSwitchTelemetryService.js` → JSONL `~/.orchestrator/telemetry/context-switches.jsonl`; `POST /api/process/telemetry/context-switch` + summary endpoint (switches/day, est. cost via 10-min default, top thrash pairs); client emit on focus-worktree / workspace switch / workflow-mode change / review start-end; surfaced in dashboard Process section + advisor rule. Whole-computer monitoring = future note only.

## New feature 6 — Commander fixes

`/clear` slash-command passthrough fix + second-commander feasibility (pending scout-commander report; implement smallest sound fix).

## New feature 7 — Plugins made real

Example plugin `plugins/youtube-transcript/` (yt-dlp subtitle fetch route + registered command; graceful "install yt-dlp" recommendation when missing); `commander.tools` slot renderer in commander panel free real estate; plugin admin list + reload in Settings; document `client.slots` in plugins/README.md (currently undocumented).

## New feature 8 — Play buttons revival (stretch)

Uncomment/modernize Start Server block (app.js:4537-4555) behind existing `terminal.serverLaunchMenu`/`startServerDev` flags; wire `getDynamicLaunchOptions()` (cascaded gameModes/commonFlags); implement `{{gameMode}}`/`{{commonFlags}}` substitution the docs promise but code never had.

## Commit plan (each pushed; priority order if interrupted)

1. docs: this plan + ai-memory update
2. fix: reviewer spawn config bug + two-step prompt (+tests)
3. feat: evidence field in task records (+tests)
4. feat: evidenceService + APIs + diffStats (+tests)
5. feat: queue evidence card UI
6. feat: review workflows config + service + queue actions (+tests)
7. docs: EVIDENCE_PROTOCOL.md + prompt injection
8. feat: visibility presets + review hub surfacing
9. feat: cache-freshness + fresh reprompt
10. feat: context-switch telemetry
11. fix/feat: commander (/clear, layout, maybe multi)
12. feat: plugins (example + slot renderer + admin + docs)
13. feat: play buttons (stretch)
14. docs: CODEBASE_DOCUMENTATION.md + PR

Out of scope (documented, future): whole-computer context monitor; Bayesian per-bucket p tracking (telemetry fields land now, math later); triage 3-bucket Trello pipeline (spec exists, big); multi-commander full implementation if seam is large; heavy queue renames (Feb-21 report's full consolidation).
