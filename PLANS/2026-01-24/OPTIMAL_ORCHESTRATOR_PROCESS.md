# Optimal Process for Using Agent Orchestrator (v1)

This document synthesizes:
- `tools/optimal-agent-orcestration-system/work2` (tier system + P/A/R + queueing math)
- `epic-survivors-architecture` (real high-throughput history + harness reality)
- `tools/start-finishing-guide` (finish-first discipline)
- this repo (`claude-orchestrator`) (what we can automate in the UI/server)

Goal: define a **single “best default workflow”** for you (the user) that the orchestrator should actively support (and eventually enforce with guardrails).

---

## 0) Definitions (shared language)

### WIP and Q (the only two numbers that matter day-to-day)
- `WIP`: active projects you are currently moving forward (not “installed”, not “available”, but actively producing PRs).
- `Q`: review queue depth, **segregated by tier** (not a single global number).

**Defaults**
- `WIP_max = 5` (Start Finishing “five projects rule”)
- Tiered queues (from `work2/DAILY_REFERENCE_CARD.md` + `work2/MASTER_SYNTHESIS_PLAN.md`):
  - `Q1 ≤ 1` (Tier 1: primary focus)
  - `Q2 ≤ 2` (Tier 2: gap fillers)
  - `Q3 ≤ 5` (Tier 3: batch review)
  - `Q4 ≤ 1` (Tier 4: dedicated review)

Practical interpretation:
- The “**queue > 3**” guardrail applies to **Tier 1+2** (the interactive queues). Tier 3/4 have their own caps.
- Track both:
  - `Q12 = Q1 + Q2` (interactive review pressure)
  - `Q_total = Q1 + Q2 + Q3 + Q4` (overall load), but keep it **segregated**.

### The 4 Tiers (where orchestration decisions live)
From `work2/DAILY_REFERENCE_CARD.md`:
- Tier 1: Primary focus (deep work; you interrupt for this)
- Tier 2: Gap filler (while Tier 1 agent runs)
- Tier 3: Set-and-forget (batch review at end of day)
- Tier 4: Overnight (long-run; dedicated review next day)

### P/A/R
From `work2/DASHBOARD_SPEC.md`:
- `P` = prompt time (human time)
- `A` = agent time (agent run time)
- `R` = review time (human verification + merge)

Orchestrator’s job is to:
- make `P` smaller (templates, skills, reuse)
- make `A` predictable (stable commands, ports, reliable terminals)
- make `R` short and safe (diff viewer + tests + risk-based verification)

---

## 1) The Optimal Daily Workflow (what the UI should make effortless)

### 1. Morning “10 minute check-in” (Dashboard should be the default landing)
Checklist (from Start Finishing + work2):
- [ ] `Q12` (Tier 1+2 review pressure). If `Q12 > 3`: **no Tier 1/2 launches** (review first).
- [ ] `Q3` and `Q4`: respect their own caps (Tier 3 batch + Tier 4 dedicated).
- [ ] `WIP` (active projects). If `WIP > WIP_max`: freeze new projects; finish/kill.
- [ ] Pick 1 Tier 1 focus block (90–120 min).
- [ ] Pick up to 2 Tier 2 gap fillers (same project if possible).
- [ ] Pick Tier 3 batch candidates (non-conflicting, small, safe).
- [ ] Pick at most 1 Tier 4 overnight candidate (tests required).

**Orchestrator UI needs**
- A single “Queue” view that merges:
  - PR list (open PRs you created)
  - worktrees tagged “ready for review”
  - stalled sessions needing input
- A WIP counter (“Active projects last 24h”) + configurable caps.
- A tier-segregated queue view:
  - `Q1/Q2` (don’t let this explode; blocks launches)
  - `Q3` (batch review later; allow more)
  - `Q4` (one at a time; schedule review)

### 2. Launch phase (8:00–8:30)
Goal: start background work *before* you enter deep work.

Rules:
- If `Q > Q_max`: skip launch; review first.
- Prefer Tier 3 tasks that touch disjoint files/modules from your Tier 1 work.
- Prefer same repo/domain to reduce context switching.

**Orchestrator UI needs**
- “Quick Work” modal must optimize for:
  - fastest selection (favorites + recency filters)
  - accurate “in use” vs “available” semantics (don’t block selection)
  - safe port assignment + copy/open actions

### 3. Deep work block (Tier 1)
During a Tier 1 block:
- only allow Tier 2 launches if you are truly waiting (agent busy)
- no new projects, no random switching

**Orchestrator UI needs**
- “Focus Mode”:
  - pin one workspace/worktree
  - collapse distractions (other worktrees/PRs) unless they become “waiting-for-review”
  - keep terminals stable (no resizing bugs)

### 4. Afternoon review (Tier 1/2)
Rules:
- Don’t review failing work (tests must pass or be explained).
- Use risk-based verification: impact × p_fail × verify_time.

**Orchestrator UI needs**
- PR inbox with filters (mine / include others / open/merged/closed).
- One-click “open in diff viewer” that auto-starts the diff viewer.
- “Review checklist” UI per PR (tests, run command, manual steps).

### 5. End-of-day batch review (Tier 3)
Goal: merge many small PRs in one sitting.

Rules:
- group by repo to minimize context load
- review smallest first to clear queue fast
- if a PR needs rework: either spawn a small fix PR (Tier 2/3) or kill it

**Orchestrator UI needs**
- “Batch Review” mode:
  - shows all Tier 3 candidates
  - opens diffs sequentially
  - quick actions: merge / request changes / spawn fix task / archive

### 6. Overnight (Tier 4)
Rules:
- Only Tier 4 if tests exist and can run headless.
- One Tier 4 at a time per repo.

**Orchestrator UI needs**
- “Overnight runner” preset:
  - start agent in YOLO
  - run test suite
  - leave a summary + checklist for morning review

---

## 2) What Epic Survivors Teaches the Orchestrator

### Reality: high throughput is possible if review stays cheap
Epic Survivors Oct 1–14, 2025 analysis shows:
- Tier 3 dominance (batch reviewable)
- throughput spikes collapse if queue isn’t cleared

Implication:
- Orchestrator must continuously surface “queue pressure” and stop launches before overload.

### Reality: harness matters (Claude Code vs Cursor)
Epic Survivors architecture repo explicitly used multiple harnesses (Cursor + Claude Code + Codex).

Implication:
- Orchestrator should treat “agent type/harness” as a first-class dimension:
  - launch commands differ
  - recovery differs
  - capabilities differ (CLI vs IDE)

---

## 3) What Start Finishing Adds (the missing discipline layer)

Orchestrator shouldn’t be “start more work faster”.
It should be “finish the right work with less friction”.

Non-negotiables to bake in:
- WIP guardrail (5 projects rule)
- focus blocks (3+ per week, protect them)
- “stuck types”:
  - Cascade → stop launching, clear queue
  - Logjam → kill/pause projects until WIP <= 5
  - Tarpit → re-spec or kill
  - Creative Red Zone → push the last 10%
- after-action flow:
  - CAT work
  - AAR
  - unlock audit (skills/infra/docs gained)

---

## 4) Orchestrator Feature Mapping (what exists vs what’s missing)

Already present in this repo (foundation we can build on):
- Multi-workspace tabs + session recovery
- Quick Work / Add Worktree workflows
- PR list panel
- Diff viewer auto-start + routes
- Cascaded config + per-project buttons + port registry
- “Ready for review” tagging

Missing “process layer” features:
1) WIP counter + queue gating (stop launches when overloaded)
2) Tier tagging + tier-aware queue views
3) Batch review mode (fast merge pipeline)
4) Focus Mode (reduce context switching)
5) Telemetry loop: P/A/R + rework rate `p` (feedback that drives behavior)

---

## 5) Implementation Principles (to keep this usable)

- The orchestrator must remain fast under load (many terminals, many worktrees).
- Guardrails must be overridable, but never invisible.
- Defaults should match your real behavior:
  - YOLO is on by default
  - “mine PRs” first
  - safe ports in dev (`4000+`), do not disturb `master/` instance

---

## 6) Next Deliverable

Translate this spec into a PR-by-PR roadmap:
- start with WIP/Q visibility + gating (fast to implement, huge ROI)
- then tier tagging and queue view
- then batch review mode
