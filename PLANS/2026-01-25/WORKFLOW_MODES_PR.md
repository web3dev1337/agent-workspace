# Workflow Modes (PR)

## Goal
Add orchestrator workflow modes that make the Tier 1–4 system usable day-to-day:
- **Focus**: prioritize Tier 1 + Tier 2 work while hiding background tiers
- **Review**: surface items that are ready to review (and unblocked) and support fast navigation
- **Background**: show Tier 3 + Tier 4 work (long-running/background)

These are required so the UI becomes a workflow manager, not just a grid of terminals.

## PR
- https://github.com/web3dev1337/claude-orchestrator/pull/189

## UI
- Header control: `Focus | Review | Background`
- Persisted in user settings:
  - `userSettings.global.ui.workflow.mode = focus|review|background`

## Behavior (v1)
- Mode acts as a **second-layer filter** (like Agent/Servers view mode) and never modifies per-worktree hide/show toggles.
- Mode sets an allowed tier set:
  - Focus: allow {1,2}
  - Review: allow {1,2,3,4} (but Queue “Next” prioritizes unblocked + higher risk)
  - Background: allow {3,4}

## Queue conveyor (v1)
- Add `Next` / `Prev` buttons in Queue toolbar:
  - navigate the filtered list
  - `Next` prefers `dependencySummary.blocked === 0`

## Tests
- E2E: open Queue, click Next, ensure selection changes.
- Unit: user settings default + mode persistence (if applicable).

## Follow-ups (next PRs)
- Mode-specific sorting (overallRisk, verifyMinutes)
- Auto-show Tier 2 only while Tier 1 agents are busy (requires stronger agent↔task binding)
- Merge/request-changes actions from within Queue (GitHub API integration)
