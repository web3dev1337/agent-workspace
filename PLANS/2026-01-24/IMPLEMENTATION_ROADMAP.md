# Implementation Roadmap: “Process Layer” for Agent Orchestrator (v1)

Source of truth for the target workflow: `PLANS/2026-01-24/OPTIMAL_ORCHESTRATOR_PROCESS.md`.

Principle: ship in small PRs; each PR is measurable and reversible.

---

## Phase 0: Data model + primitives (no new UI yet)

### PR 0.1 — Define “Task” abstraction (worktree/PR/session)
- Add server-side model for a “task” that can be:
  - a PR (GitHub PR number)
  - a worktree marked “ready for review”
  - a session needing input (status=waiting)
- Provide a single API response used by multiple UIs later.

### PR 0.2 — WIP + Queue metrics endpoints
- Compute:
  - `WIP`: active projects (configurable lookback window, default 24h)
  - `Q`: review queue depth (open PRs + ready-for-review + waiting-for-input)
- Endpoints:
  - `GET /api/process/status` → { wip, wipMax, q, qMax, launchAllowed, reasons[] }
  - `POST /api/process/settings` → { wipMax, qMax, lookbackHours }

---

## Phase 1: Make overload visible and prevent “accidental overload”

### PR 1.1 — Dashboard header: WIP/Q banner
- Always visible in dashboard and workspace header.
- Color-coded: OK / warning / blocked.

### PR 1.2 — Launch gating (soft-block → hard-block)
- Soft-block: banner + confirmation.
- Hard-block option in settings: block new agent launches if `Q > Q_max`.
- Gate applies to:
  - “Start Agent”
  - “Add worktree sessions”
  - “Quick Work start”

---

## Phase 2: Tier system in UI (decisions before launches)

### PR 2.1 — Tier tagging for tasks
- Tier tag for:
  - worktree (stored with worktree tags)
  - PR (stored in local tag store keyed by repo+prNumber)
- Minimal UI: tier selector (1/2/3/4) in PR list and sidebar row.

### PR 2.2 — Tier-aware queue view
- New Queue modal/panel:
  - group by tier
  - group by project/repo
  - sort by age
  - show “risk-based verification” hint (impact × p_fail × verify_time)

---

## Phase 3: Batch review mode (Tier 3 throughput)

### PR 3.1 — Batch Review mode (Tier 3)
- A “review conveyor belt”:
  - open next PR diff
  - show checkboxes (tests, manual verify)
  - merge / request changes / spawn fix

### PR 3.2 — Fix spawn workflow
- One click spawns a follow-up task for a PR that needs changes:
  - attaches to same repo/worktree when possible
  - creates a small “fix/…” branch

---

## Phase 4: Focus Mode (reduce context switching cost)

### PR 4.1 — Focus mode UI
- Pin a worktree.
- Hide (not destroy) other worktrees in sidebar/grid.
- Show queue banner only.

---

## Phase 5: Telemetry feedback loop (P/A/R + p)

### PR 5.1 — Telemetry ingestion (best-effort)
- Claude JSONL ingestion (already exists for conversation browser; reuse).
- Git + PR timing:
  - createdAt / mergedAt
  - last commit time
- Output:
  - simple P/A/R estimates per PR and per project

### PR 5.2 — Rework rate `p` dashboard
- Track how often PRs require changes (iterations).
- Surface “p is rising” warnings per project.

