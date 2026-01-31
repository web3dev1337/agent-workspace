# Phase 4 — Full UI Control (Voice + Commander)

Date: 2026-01-31

## Goal

Make “everything you can do in the UI” executable via:
- **Voice** (rule match first, then LLM fallback), and
- **Commander Claude** (typed coordination),

…with both routed through the **same semantic command surface** (the Command Registry), and designed to support additional agent providers in the future.

## Non-negotiables

- **Single source of truth:** `server/commandRegistry.js` is authoritative for commands/capabilities.
- **No manual prompt maintenance:** new commands must automatically appear in:
  - `GET /api/commander/capabilities`
  - voice LLM fallback prompt (via registry-driven capabilities)
  - Commander bootstrap/help output (generated at runtime)
- **Context-aware parsing:** voice/Commander must be able to resolve “this PR / current item / next item” reliably.

## Where the detailed backlog/spec lives

See:
- `PLANS/2026-01-31/FULL_UI_CONTROL_VIA_COMMANDS_GAP_ANALYSIS.md`

This Phase 4 doc is intentionally short; the gap analysis doc is the implementation map.

## Status (as of 2026-01-31)

Shipped (merged to `main`):
- PR #496–#501 (Phase 4 foundations + Queue review lifecycle commands).

Next:
- Keep expanding command coverage until “everything clickable in the UI” is commandable (see the gap analysis doc).

Related:
- `PLANS/2026-01-31/DISCORD_BOT_INTEGRATION_PLAN.md`
