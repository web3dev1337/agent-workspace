# Codex desktop parity research + implementation brief (2026-02-06)

Goal: preserve the orchestrator’s existing multi-workspace power, while adding a simpler “projects + chats” workflow layer similar to the Codex app UX.

---

## 1) Product direction to preserve

- Keep current strengths:
  - multi-workspace monitoring
  - agent/server terminal visibility
  - queue/review/tier workflows
  - Claude + Codex in one product
- Add a higher-level UX layer for easier adoption:
  - left nav: projects + chats
  - “new chat” that maps to launching a new worktree/session
  - repeatable scheduled jobs (“cron skills”)

---

## 2) Research scope (must-do)

- Research Codex app behavior from official sources first:
  - OpenAI docs, release notes, product pages, official announcements
- Capture concrete UX and workflow details:
  - navigation model
  - project/chat lifecycle
  - session persistence + resume
  - task automation/scheduling model
  - command discoverability (buttons, palette, hotkeys)
- Build a feature parity matrix:
  - `Codex UX capability`
  - `Current orchestrator equivalent`
  - `Gap`
  - `Recommended implementation`
  - `Priority`
  - `Complexity`

---

## 3) Required output documents

1. `PLANS/2026-02-06/CODEX_PARITY_GAP_ANALYSIS.md`
   - side-by-side feature matrix
   - screenshots/interaction notes (where allowed)
   - proposed parity/non-parity decisions

2. `PLANS/2026-02-06/CODEX_PARITY_IMPLEMENTATION_PLAN.md`
   - phased build plan
   - API and UI changes
   - migration notes
   - testing plan

3. `PLANS/2026-02-06/CODEX_PARITY_PR_BREAKDOWN.md`
   - PR-by-PR sequence (small mergeable slices)
   - rollout order with dependency graph

---

## 4) Implementation tracks to evaluate

### Track A: Project + chat shell
- Add a new top-level “Projects/Chats” view.
- Map project -> workspace.
- Map chat -> worktree/session pair(s).
- Keep current workspace UI as “Advanced” mode.

### Track B: Chat-to-worktree lifecycle
- “New chat” should create/select worktree + session, then open prompt surface.
- Closing chat should follow explicit lifecycle policy:
  - close process only
  - remove from workspace
  - retain/archive metadata

### Track C: Scheduled jobs (“cron skills”)
- Build on existing scheduler service.
- Add job templates:
  - run commander action
  - run queue review routine
  - run health/diagnostic checks
- Add safety controls:
  - per-job enable/disable
  - dry run
  - audit log + last run status

### Track D: Unified command surface
- Ensure voice + commander + UI automation share the same command registry.
- Add dynamic command catalog endpoint for:
  - LLM voice fallback
  - commander context hints
  - future third-provider support

---

## 5) Constraints and quality bar

- No regressions to existing tier/review workflows.
- Windows + Linux/WSL behavior must remain supported.
- Keep local-first posture and existing security defaults.
- Do not hardcode provider-specific assumptions (future provider expansion remains possible).

---

## 6) Acceptance criteria for this initiative

- New user can complete core flow from one screen:
  1) pick project
  2) create/open chat
  3) run/review work
  4) schedule repeatable automation
- Existing advanced users can still use current workspace/terminal/review surfaces unchanged.
- Command coverage is fully discoverable and shared across voice/commander/UI.
- Documentation includes clear “Simple mode vs Advanced mode” usage.

---

## 7) Immediate next execution order

1. Complete Codex parity research docs (Section 3).
2. Decide MVP scope for first parity release.
3. Implement Track D first (command catalog unification), then Track A/B, then Track C polish.
4. Ship in incremental PRs with tests per slice.

