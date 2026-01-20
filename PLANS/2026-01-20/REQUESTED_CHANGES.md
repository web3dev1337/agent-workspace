# Requested Changes (2026-01-20)

This document captures (verbatim intent, condensed) all requested changes and issues described in the conversation so far. It’s meant to be the **source of truth** for what to fix, how to validate it, and what “done” means.

## Context / Constraints

- You are actively running another orchestrator instance from the separate worktree at `/home/ab/GitHub/tools/automation/claude-orchestrator/master` on **port 3000**.
- All local dev/testing work in this repo should **avoid port 3000**. Prefer running this repo on **4000+** (or **4001** for test servers).
- Keep work **modular** and **performance-aware**.
- Ship changes as a sequence of small PRs: **1 change → tests → commit → push → PR**.
- Keep a **rolling markdown log** so work can resume if context is lost.
- Repo name can remain `claude-orchestrator`, but UI/wording should move toward **Agent Orchestrator** where appropriate.

## A. Worktree Add / Worktree Modal UX

### A1) “Add worktree” resets terminals / startup overlay reappears
When adding a worktree from the bottom-left, existing terminals sometimes “reset” and the **startup overlay** (fresh session / choose Claude/Codex dropdown) reappears unexpectedly.

**Acceptance criteria**
- Adding a worktree does **not** re-show startup overlays for terminals that already had them dismissed.
- Adding a worktree does **not** “reset” terminals or lose their visual state.
- Existing terminals keep their sizing; no xterm layout regressions.

### A2) Worktree picker modal should be large and non-scroll “cards”
Current add-worktree modal is too small/thin and requires scrolling.

**Requested UX**
- Modal should be **large**, using most of the screen.
- Prefer **card-style grid**, not a thin list with scrollbars.
- Avoid scrolling where possible (or only scroll inside a specific subsection if unavoidable).
- Close button should be usable (not a tiny “micro X”).

### A3) Grouping + hierarchy in the worktree picker
Group projects by subtree under `~/GitHub` (examples: `websites`, `games`, etc), and within those by framework (examples: `hytopia`, `monogame`, etc).

Also support “ungrouped” buckets:
- Projects directly under `~/GitHub`
- Projects directly under `~/GitHub/websites` (not under a framework folder)
- Same idea for other categories

**Acceptance criteria**
- Worktree picker shows **groups** and **ungrouped sections**.
- Groups are stable and derived from folder structure (no manual curation required to “see” projects).

### A4) Sorting, recency filters, favorites
Desired controls (prefer **fast click** UI like radio buttons over dropdowns):
- Sort by **most recently edited** (default) and optionally **most recently created**.
- Filter by activity recency: show only edited in last **week / month / 2 months / 3 months / 6 months / 1 year**.
- Ability to mark items as **favorites** and show favorites at top.
- Optional toggle to hide items not touched in the last N months.

**Acceptance criteria**
- Favorites persist across sessions.
- Sorting/filtering is fast and does not degrade UI performance.

### A5) Worktree “quick launch” options
Current “quick launch” tends to pick the “oldest unused” worktree, which is useful, but you also want:
- Quick launch **most recent** worktree
- Launch **any specific** worktree from a selection UI

**Acceptance criteria**
- Oldest + most-recent quick launch options exist.
- “Choose any worktree” option exists.

### A6) Show branch/PR/merge status in the modal
For each worktree entry:
- Show branch name
- Show if a PR exists
- Show if the PR is merged
- Allow simple color coding for status

## B. PR Management UX

### B1) PR list view
Add a section/tab that lists PRs:
- Your PRs by default, newest → oldest
- Ability to include/exclude “others’ PRs”

**Acceptance criteria**
- PR list loads reliably and can be filtered quickly.

### B2) “Ready for review” tagging
You want a way to tag a worktree as ready for review (not only based on PR-created events).

## C. Status Indicators (green/orange/gray) correctness

There are status circles for agents/clients/servers but they are not accurate.

**Acceptance criteria**
- Status indicator definitions are documented (what signal drives each color).
- Status matches reality: running/busy/waiting/stopped, etc.

## D. Worktree list / Sidebar issues

### D1) Left sidebar worktree list updates “one behind”
Observed behavior: when adding worktrees, the new one sometimes doesn’t appear until the next worktree is added.

**Acceptance criteria**
- Adding worktree N immediately shows worktree N in sidebar (no off-by-one update lag).

### D2) Sidebar items should be thinner + less clutter
Requested changes:
- Make items more vertically compact so more fit.
- Remove redundant “client/server” sub-status; keep a single status indicator.
- Rename “Claude window” to **Agent** window (where not Claude-specific).

### D3) Unknown branch / “root unknown” fallbacks
Improve display when branch detection fails or when worktree is created at “root”.

**Acceptance criteria**
- Fall back to folder name and/or path-derived label instead of “unknown”.

## E. Navigation: Dashboard vs Workspace Tabs

Current behavior: after you load the dashboard and enter a workspace, the app state makes it hard to return to the “tabs view” of active workspaces. You want:
- A **single-click** way to return to dashboard
- A way to return to the multi-workspace “tabs” view/state (one level above a single workspace)

**Acceptance criteria**
- You can navigate between dashboard and the tabbed workspace state without losing or corrupting state.

## F. Terminal reliability: tab switching breaks terminals

Switching between workspace tabs causes:
- Sidebar selection state to break (radio selection wrong)
- Startup overlays to reappear
- XTerm layout sizing issues (prompt/cwd column becomes too narrow; wraps)
- Sometimes terminal input is disabled; `Ctrl+C` lags; delayed recovery
- “Quick actions” bar appears as an empty thin strip at bottom

**Acceptance criteria**
- Switching tabs preserves terminal DOM + XTerm instance correctly.
- Terminal typing remains enabled across tab switches.
- Layout refits correctly without visual corruption.
- Remove or fix the empty “Quick actions” strip.

### F1) Remove “Yes / No” quick-response UX (YOLO-only)
There’s a bottom “Yes/No” UI intended to answer the AI. You’re now running in YOLO mode and want this removed because it’s no longer needed and can interfere with layout/state.

**Acceptance criteria**
- No “Yes / No” buttons or related quick-response UI.
- No “waiting for yes/no” behavior that blocks normal terminal usage.

### F2) Terminal sometimes jumps scroll to the very top
Observed: sometimes the terminal view/scroll position jumps all the way back to the top unexpectedly (may be related to prior quick-actions behavior, but not confirmed).

**Acceptance criteria**
- Terminal scroll position does not jump to the top unexpectedly during normal usage.
- If auto-scroll is enabled, new output scrolls predictably; if the user is manually scrolling, we don’t fight their scroll position.

## G. UI cleanup

- “Dynamic layout” control in header doesn’t do anything → hide/remove for now.
- ↻ tooltip should read **“Start Agent with Options”** (not “Start Claude with Options”).
- In the agent startup modal, **YOLO should be enabled by default**.
- Improve “micro X” close buttons (ports modal, conversation history modal).
- Keep existing UI/UX rule: **do not darken the background** when a modal opens.

## H. Ports/Services UI

- Remove the bottom-left “Services” list under worktrees (or reconsider it).
- Keep a consolidated **Ports / Services** panel (top right).
- Make it match the “large modal / card grid” design and avoid scrolling.
- Provide quick actions:
  - Open service URL
  - Copy URL (`http://localhost:PORT`)
  - Copy just the port

## I. Custom Buttons + Cascaded Config + Commands

### I1) Custom buttons not working / not wired to config
Custom buttons should come from config JSON and support per-domain and per-project commands:
- Websites: start/stop, open, etc.
- Games: start with flags (modes), dynamic port selection, etc.
- Writing: build/export, etc.

### I2) Hierarchy & where configs live
Use the cascaded config structure (global/category/framework/project/worktree). Configs should live in repos where it makes sense (framework-level configs at the framework folder, project-level under the project, etc).

### I3) Dynamic port selection
Avoid collisions when running multiple projects of different types. Need smarter logic than “worktree number → fixed port”.

**Acceptance criteria**
- Custom buttons render from discovered configs.
- Commands can interpolate computed values (ports, paths, flags).
- Port selection can avoid collisions and expose copy/open actions.

## J. “Claude Orchestrator” → “Agent Orchestrator” naming pass

Update UI copy where it’s not specifically Claude-related:
- “Claude” terminal pane → “Agent”
- “Claude + Server” pair naming → “Agent + Server”

Keep Claude-specific wording only when it truly is Claude-specific (Claude startup settings, Claude provider, etc).

## K. Codex/OpenCode detection + recovery improvements

- Detect whether an agent terminal is running Claude vs Codex vs OpenCode if feasible.
- “Z.ai within Claude” is acknowledged as harder; treat as stretch goal.
- Improve Codex start command: remove unnecessary hard-coded flags; rely on Codex defaults where appropriate.

## L. Document project folder structure as a Skill

Document your project structure conventions (e.g., `~/GitHub/games/hytopia/games/<Project>/master`, `work1..workN`, etc) into a reusable Skill markdown so it can be referenced later to create new projects consistently.

**Acceptance criteria**
- A skill document exists and explains conventions, naming, and worktree creation.

## M. “Products” quick links

You want “product” links that:
- Start the project from its `master` worktree (pull latest)
- Start the service
- Open the relevant page

Also consider a simple port “reservation” doc (markdown list) to avoid collisions.
