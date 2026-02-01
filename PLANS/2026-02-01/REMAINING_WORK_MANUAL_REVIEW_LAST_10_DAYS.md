# Remaining work — manual review (last 10 days)

Generated: 2026-02-01

This is a **human-curated** follow-up to the automated scans.

Scope:
- All tracked `*.md` files **touched in the last 10 days** (64 files in this repo at time of generation).

Method:
- Read the highest-signal specs/plan docs from the last 10 days (Phase 4 commands, Discord integration, theming/skins, Review Console, post-ship issues).
- Then spot-check the set of docs the scanner flagged as “remaining markers” to separate:
  - **real unfinished implementation work**, vs
  - historical/roadmap “next steps”, vs
  - intentionally-unchecked process templates.

---

## Summary

### ✅ Explicit checklist items / tracked tasks

No remaining unchecked `[ ]` tasks were found in the Phase-2/Phase-3/Phase-4 shipped trackers.

### ⚠️ True “remaining work” (not checkboxes, but still requested)

These are the only items in the last-10-days markdown set that still represent real follow-up work (either optional, unbounded, or external):

1) **Skins / “Blue mode” is implemented, but the full “skin system” refactor is not complete**
   - Source: `PLANS/2026-01-31/THEMING_SKINS_BLUE_MODE_PLAN.md`
   - What’s done:
     - `Skin` selector exists in Settings.
     - `skin-blue` exists using the requested primary `#0f67fd`.
     - `UI_COLOR_AUDIT.md` exists and documents the current palette usage.
   - Still remaining (to reach “beautiful, robust skins across the whole app”):
     - Migrate remaining hard-coded CSS colors/gradients to tokens where appropriate.
     - Decide what *should* remain semantic colors (status colors) vs what should be skin-tinted (selected states).
     - Do a visual/UX pass for consistency (Queue/Tasks/Review Console overlays).

2) **Phase 4 “Full UI Control” is shipped for the core review workflow, but there are still optional/future items**
   - Source: `PLANS/2026-01-31/FULL_UI_CONTROL_VIA_COMMANDS_GAP_ANALYSIS.md`
   - Shipped (core): semantic command registry, voice rule+LLM fallback, commander execute surface, Queue actions, Review Console controls, history/resume (Claude+Codex).
   - Still remaining (explicitly described as optional/future in the doc):
     - Auto-generate Voice rule patterns from command aliases (drift reduction).
     - Provider plug-in interface abstraction (Claude/Codex/future) to avoid provider branching over time.
     - Commander “typed freeform → LLM parse → {command, params}” flow (beyond explicit commands).

3) **Discord bot: orchestrator-side integration is shipped; bot-repo changes are optional/external**
   - Source: `PLANS/2026-01-31/DISCORD_BOT_INTEGRATION_PLAN.md`
   - Shipped (in this repo): Services workspace + `/api/discord/*` endpoints + status/ensure/process controls + commander/voice commands.
   - External optional work (outside this repo):
     - Update `~/GitHub/tools/discord-task-bot` to call `/api/discord/*` endpoints directly (instead of or in addition to `send-to-session`).

---

## Docs that look “remaining” but are not current actionable work

These docs contain “Next steps / What’s not done yet” sections, but they are drafts/roadmaps not tied to the current shipping Phase 2/3/4 work:
- `WORKSPACE_ANALYSIS.md` (draft workspace system roadmap; dated 2025-09-27)
- `REVISED_WORKSPACE_PLAN.md` (multi-workspace system plan; partially inconsistent with current repo direction)
- `ADVANCED_DIFF_VIEWER_PLAN.md` (historical diff-viewer roadmap)

---

## Notes (recently fixed that affected real usage)

Even if a doc line previously claimed this was fixed, in real usage Review Console could still show empty sections depending on `gh` output format:
- Review Console PR details parsing was hardened and now surfaces warnings when GitHub calls fail.
- Fix shipped in: PR #545 (see `PLANS/2026-01-25/POST_SHIP_ISSUES.md`).

