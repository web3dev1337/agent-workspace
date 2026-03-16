# Orchestrator Trello Priority Report

**Date**: 2026-03-16
**Board**: [Orchestrator](https://trello.com/b/kaJdhuNd/orchestrator)
**Open PRs**: 9 | **Priority cards**: 32 | **For Test**: 34 | **AB T3 Que**: 1

---

## Priority List (32 cards)

### Can Fully Implement (16 cards)

| # | Card | What I'd Do | Effort | Matching PR |
|---|------|-------------|--------|-------------|
| 1 | [Collapse of worktrees should be snappier](https://trello.com/c/gMiHPsQc) | Reduce CSS transition duration on sidebar collapse, use `transform` instead of width animation | Small | - |
| 2 | [Terminals don't adapt to screen size](https://trello.com/c/IJvEm9mh) | Fix xterm.js `fitAddon` resize handler — add/fix `ResizeObserver` to trigger fit on window resize, prevent input container overflow | Medium | Partial: [PR #843](https://github.com/web3dev1337/claude-orchestrator/pull/843) |
| 3 | [+ not center vertically](https://trello.com/c/2WGpFAgy) | Fix vertical alignment of the "+" tab button with `align-items: center` on the tab bar container | Small | - |
| 4 | [Expand for more columns, avoid vertical scroll](https://trello.com/c/aNdmMVZJ) | Make the Running Services/Ports grid use `auto-fill` with `minmax()` so it fills available width with more columns. Remove any `max-width` cap | Small | - |
| 5 | [Edge case when small](https://trello.com/c/HLJiXsyk) | Add min-width to sidebar, collapse tier filter buttons into dropdown at small widths | Small | - |
| 6 | [Hovering over star should show "Done"](https://trello.com/c/5qZlhyka) | Add `title="Done"` attribute or CSS tooltip on the star icon hover | Trivial | - |
| 7 | [Show/Hide and Sort by project](https://trello.com/c/d6koT174) | Add "Group by project" toggle to sidebar, sort function, ensure grid order matches sidebar order (left-to-right = top-to-bottom) | Medium | - |
| 8 | [CTRL+CLICK tier filter — no "show all" reset](https://trello.com/c/I8aoqgwc) | Fix the "All" button to properly reset all tier filters, or add a dedicated "Reset Filters" button | Small | - |
| 9 | [Change ORCHESTRATOR_NODE_PATH](https://trello.com/c/7oei6xT8) | Grep all references to `ORCHESTRATOR_NODE_PATH` across codebase and rename to a better name (e.g. `AGENT_WORKSPACE_NODE_PATH` or just `NODE_PATH`) | Small | - |
| 10 | ["Inactive Workspaces" not "ALL"](https://trello.com/c/4LkZUsIj) | Rename the "All Workspaces" label to "Inactive Workspaces" in the dashboard UI | Trivial | - |
| 11 | ["+Add Workspace" should say "Open Workspace"](https://trello.com/c/GwDL0fcL) | Rename button text from "+Add Workspace" to "Open Workspace" | Trivial | - |
| 12 | [CLI claude notification — remove it](https://trello.com/c/aYkw4OL5) | Find and remove the Claude CLI notification element in top-right corner | Small | - |
| 13 | [Dashboard: ports should be a grid, no scroll](https://trello.com/c/ErE70SzD) | Convert the ports/services panel from single-column scrollable list to multi-column grid that fits without scrolling (same approach as card #4) | Small | - |
| 14 | [No horizontal scroll, 100% width](https://trello.com/c/Sdflwhta) | Remove any `max-width` constraints, ensure containers fill 100% width, prevent horizontal scrollbar | Small | [PR #843](https://github.com/web3dev1337/claude-orchestrator/pull/843) |
| 15 | [Port fixes — client and server defaults](https://trello.com/c/XQ9jywRn) | Change default port configuration for both client and server | Small | [PR #840](https://github.com/web3dev1337/claude-orchestrator/pull/840) |
| 16 | [Default filter not showing all projects](https://trello.com/c/XMM1FYxG) | Change default filter state in Quick Work view to show all projects instead of filtering by T2 start tier | Small | - |

### Can Partially Implement — Need Minor Clarification (10 cards)

| # | Card | What I Think It Is | What's Missing |
|---|------|--------------------|----------------|
| 17 | [Commander didn't work?](https://trello.com/c/HgnOnvfv) | Commander Claude failed to launch or respond | No screenshot, no error details — need reproduction steps |
| 18 | [TRELLO — how do new users hook up](https://trello.com/c/ZCekFcOd) | Need a UI flow for new users to connect their Trello account/credentials | No spec on what the onboarding flow should look like |
| 19 | [This looks sus on Windows](https://trello.com/c/dFCqDPZG) | Ports panel shows system processes (svchost, lsass, wininit, Steam, uTorrent) — scary and confusing for users. "Agent Workspace (Legacy)" label is wrong. Need to: (a) filter to only show orchestrator-related services, (b) fix "Legacy" label | Can implement filtering, but need to confirm which processes to whitelist |
| 20 | [Orchestrator Setup title](https://trello.com/c/9r2XfNUP) | Rename "Orchestrator Setup" to "Agent Workspace Setup" throughout the onboarding flow | Can do, but need to check if "Orchestrator" branding is used elsewhere that should also change |
| 21 | [Button to take us to projects](https://trello.com/c/oUol1uXr) | Add a "Projects" navigation button somewhere (dashboard? sidebar?) that matches the existing Projects button | Need to know exact placement |
| 22 | [GH repos not shown that aren't already added](https://trello.com/c/Zy3a9DRa) | Projects/Quick Work UI only shows configured repos, not all repos in ~/GitHub. Need to discover and list available repos | Can implement with `fs.readdir` on GitHub folder, but need to decide: scan ~/GitHub? use `gh repo list`? both? |
| 23 | [Default to work9 if none created](https://trello.com/c/be1nrhyW) | When adding a repo with no existing worktrees, default worktree name should be work9 | Already seems to work from screenshot — need to confirm if there's a bug or just UX confusion |
| 24 | [Where Commander launches from](https://trello.com/c/E1dqqeoi) | Packaged app launches Claude from `AppData\Local\Agent Workspace\resources\backend>` instead of the orchestrator master directory. Gets EISDIR error on `lstat('C:')`. Need to fix the working directory for Commander in packaged mode | Can investigate Tauri config/launch logic, but the EISDIR error needs debugging |
| 25 | [Bad icon — "T" with dropdown](https://trello.com/c/koWs9p84) | Tiny yellow "T" icon — not clear if this is tray icon, tab icon, or something else | Need to know which UI element this refers to |
| 26 | [image.png (unnamed)](https://trello.com/c/RLVsP5Mv) | Screenshot shows Quick Work view with "Create work9" buttons and a tooltip. Not clear what the specific issue is beyond what other cards already cover | Overlaps with cards #22, #23, #16 — may be a duplicate |

### Cannot Implement — External Dependencies (6 cards)

| # | Card | Blocker |
|---|------|---------|
| 27 | [Microsoft Defender detecting the desktop app](https://trello.com/c/iruuUl2C) | Needs a **code signing certificate** ($300-600/year). Without it, Windows SmartScreen will always flag the app. Can't fix with code. |
| 28 | [Need to change the logo of app](https://trello.com/c/Ybx1WJ0h) | Needs a **new logo asset designed**. I can swap the file once provided, but can't design a logo. |
| 29 | [Really bad icon](https://trello.com/c/koWs9p84) | Same as above — needs design work for a new icon. |
| 30 | [GitHub login + repo discovery for new users](https://trello.com/c/jCdV4Pro) | Large onboarding feature — understand the intent (GitHub OAuth login, auto-discover repos, lazy-load into workspace wizard) but it's a **multi-session feature** that needs scoping first |
| 31 | ['master' — some will use main](https://trello.com/c/sMuUliam) | Need to make worktree detection flexible — support both `master/` and `main/` directory conventions. Medium effort but needs careful testing across all repo types. |
| 32 | [Repository root missing master directory](https://trello.com/c/8MWAuklR) | Related to #31 — repos without `master/` subdirectory fail to add. Same fix: flexible directory detection. |

---

## AB T3 Que (1 card)

| Card | What I'd Do | Effort |
|------|-------------|--------|
| [Review section as main terminal view](https://trello.com/c/K3WKxZ0w) | Screenshot shows the diff viewer with file tree + diff + terminal side-by-side. Add a "Review" button to each terminal card that opens this diff viewer for that worktree's active PR. Wire up the existing diff-viewer component as the primary review interface. | Medium-Large |

---

## For Test (34 cards) — Need Testing, Not Implementation

These cards are in "For Test" meaning they should be verified, not built. Key ones:

| Card | What to Test |
|------|-------------|
| [Dashboard back button does recovery flow](https://trello.com/c/SOq1hJz3) | "Return to workspace" should just navigate back, not trigger recovery/reconnect flow |
| [Same blue everywhere, need green](https://trello.com/c/gRs3Z7lQ) | UI color variety — too monochrome blue |
| [New tab bug — worktrees duplicate](https://trello.com/c/f39NI6yd) | Opening new tab causes worktree list duplication and terminal UI bugs |
| [Dashboard refreshing randomly](https://trello.com/c/DGDVbRUQ) | Dashboard auto-refreshes unexpectedly |
| [Kill button — does it send CTRL+C?](https://trello.com/c/Dv4C1732) | Verify kill button behavior |
| [Server shortcut hardcoded to hytopia?](https://trello.com/c/CXyF5CNh) | Check if server launch shortcut is project-agnostic |
| [Move Commander to top left](https://trello.com/c/empzIDVX) | Layout change for Commander panel |
| [Dashboard button next to tab](https://trello.com/c/7qps6eQu) | Add dashboard nav button to tab bar, remove duplicate |
| [Agent Workspace title to sidebar](https://trello.com/c/2zNj5HJI) | Move app title to sidebar |
| + 25 more UI polish cards (colors, icons, spacing, labels) | Various small tweaks |

---

## Open PRs (9)

| PR | Branch | Status | Matches Card? |
|----|--------|--------|---------------|
| [#848](https://github.com/web3dev1337/claude-orchestrator/pull/848) | `release/testing-v0.1.1-rc.1` | Test release candidate — possibly stale | - |
| [#843](https://github.com/web3dev1337/claude-orchestrator/pull/843) | `fix/ultrawide-layout` | Removes max-width cap for ultrawide | Cards #14, #4 |
| [#840](https://github.com/web3dev1337/claude-orchestrator/pull/840) | `fix/client-port-investigation` | Centralize port defaults | Card #15 |
| [#831](https://github.com/web3dev1337/claude-orchestrator/pull/831) | `fix/ui-workspace-screen` | Workspace UI polish | Multiple For Test cards |
| [#804](https://github.com/web3dev1337/claude-orchestrator/pull/804) | `feature/universal-pr-review` | Agent-agnostic PR review | AB T3 review card |
| [#796](https://github.com/web3dev1337/claude-orchestrator/pull/796) | `fix/windows-onboarding-clean-main` | Windows onboarding fixes | Cards #20, #24 |
| [#791](https://github.com/web3dev1337/claude-orchestrator/pull/791) | `fix/windows-updater-plugin-config-startup` | Prevent updater panic on Windows | Card #27 area |
| [#788](https://github.com/web3dev1337/claude-orchestrator/pull/788) | `feature/server-only-file-watching` | File watching user setting | - |
| [#785](https://github.com/web3dev1337/claude-orchestrator/pull/785) | `docs/post-rewrite-local-recovery` | Documentation only | - |

---

## Recommended Execution Order

### Batch 1 — Trivial label/text changes (can do in one PR, ~30 min)
- Card #6: Star hover tooltip
- Card #10: "Inactive Workspaces" label
- Card #11: "Open Workspace" button text
- Card #9: Rename ORCHESTRATOR_NODE_PATH
- Card #20: "Agent Workspace Setup" title

### Batch 2 — Layout/grid fixes (one PR, ~1-2 hours)
- Card #3: Center "+" button
- Card #4: Expand ports grid columns
- Card #13: Ports as grid not list
- Card #5: Sidebar min-width
- Card #12: Remove CLI notification

### Batch 3 — Filter/sort improvements (one PR, ~2-3 hours)
- Card #8: Fix "All" tier filter reset
- Card #16: Default filter shows all projects
- Card #7: Sort/group by project

### Batch 4 — Merge existing PRs
- Review and merge PR #843 (ultrawide layout — covers cards #14, #4)
- Review and merge PR #840 (port fixes — covers card #15)

### Batch 5 — Windows/packaging fixes (~3-4 hours)
- Card #19: Filter system processes from ports panel
- Card #24: Fix Commander launch directory in packaged app
- Cards #31, #32: Support both master/ and main/ directory conventions

### Needs External Input
- Cards #27, #28, #29: Code signing cert + logo design
- Card #30: GitHub onboarding feature needs scoping session
