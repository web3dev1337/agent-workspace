# Init — User Request (2026-07-15)

Voice-transcribed brain dump. Branch: `feature/review-inbox-and-tier-workflows` from origin/main @ affdc657.

## Core request
Make agent-workspace (fka claude-orchestrator) the best agent orchestrator. Many features were built pre-open-source, then hidden/toggled off (`ui.visibility`) and some were "spammed out by Codex" untested. Revive, harden, extend — guided by the research repo `web3dev1337/optimal-agent-orcestration-system` (tier 1-4 system, P-A-R cycle, context-switching math, ~38k-word article).

## Specific asks (verbatim-ish)
1. **Tier workflow**: T1 = active focus (don't wait on PAR cycle), T2 = standby gap-fillers ready when T1 blocks, T3 = batch-prompted background agents (prompt all at once → work for hours → batch review), T4 lowest. Batch context switching.
2. **Review dashboard**: after a T1 block, review all finished T3s in a dashboard that shows AT A GLANCE what a human needs to approve/merge:
   - (1) automated tests confirmation, (2) proof the app/game actually RAN (Roblox Studio / browser / MonoGame etc.), (3) agent-review chain results + whether fixes were applied per review, (4) screenshots/videos of the feature, (5) data evidence for balance-type changes (before/after, autoplay confirmation), (6) diff stats (files, LOC) + diff viewer link, (7) what standards were reviewed against (code-quality standards injected into implementer AND reviewers).
   - Actions: approve / reprompt / merge → auto-advance to next item. Re-reviewed items reappear at end; otherwise "pending".
3. **Agent chains/workflows**: implementer → 1-3 reviewer agents (security/performance/general roles) passing info back and forth, hardening before human review. Prompt libraries + workflows; per-role model/effort choice (e.g. Claude fable can't do security reviews, Codex/Opus can). Also: agent itself can orchestrate its own reviews via baked-in instructions/skill rather than hardcoding.
4. **Context management**: >1h wait = prompt cache likely expired → reprompt should happen in a FRESH window; agents leave notes for successor agents.
5. **Telemetry**: track context switching etc. Local-only unless opted in (optional cloud saves). Side-idea: opt-in whole-computer context-switch monitor (not just orchestrator).
6. **Play buttons**: parameterized run configs (game modes, cheat flags, server params) — used to be hardcoded to Hytopia, removed; cascaded config (gameModes/commonFlags) exists server-side.
7. **Plugins/tools**: e.g. paste YouTube link → transcribe workflow routed to right repo; modular buttons/workflows anyone can define. Plugin system exists (Codex batch, untested).
8. **Commander**: sometimes need a SECOND commander; `/clear` slash command doesn't work in commander terminal — fix.
9. **Layout**: spare screen real estate in commander/projects/tasks/ports area for new stuff.

## Constraints
- Use sonnet sub-agents for research/scouting, opus/fable for synthesis. Sub-agents must NOT create branches.
- Commit + push as you go (rug-pull protection). One PR.
- Running production instance lives in ~/GitHub/tools/automation/claude-orchestrator/claude-orchestrator-dev (ports 4000/2081) — this worktree (work1) is safe to edit.
