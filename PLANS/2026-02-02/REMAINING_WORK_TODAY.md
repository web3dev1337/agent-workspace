# Remaining work (as of 2026-02-02)

Date: 2026-02-02  
Scope: “optional/future” items that are still real work and should be treated as the **current remaining backlog**.

This is intentionally short, concrete, and actionable. It supersedes “nothing left” interpretations that only count checkboxes.

---

## 1) Skins / “Blue mode” (make it truly beautiful + consistent)

Status:
- ✅ Skin selector exists (Settings → Skin).
- ✅ Blue skin uses requested primary `#0f67fd` and works in light + dark.
- ✅ Color audit exists (`PLANS/2026-01-31/UI_COLOR_AUDIT.md`).
- ✅ Started tokenizing a few hard-coded accents (YOLO highlight + warning accents) to respect skins.

Remaining work:
- Convert remaining hard-coded UI colors/gradients to token-driven styling where appropriate (don’t touch status semantic colors unless intentional).
- Decide + document which UI surfaces are “accent tinted” vs neutral across skins:
  - selected rows/tiles, active tabs, focused buttons, modals/overlays
  - Queue/Tasks/Review Console overlays
- Add 1–2 additional skins as validation of the architecture (e.g. Purple/Emerald) and QA light+dark readability.
- Optional: add “skin intensity” (0–100) so Blue can be subtle or bold.

Primary sources:
- `PLANS/2026-01-31/THEMING_SKINS_BLUE_MODE_PLAN.md`
- `PLANS/2026-01-31/UI_COLOR_AUDIT.md`

---

## 2) Phase 4 command surface (finish “full UI control” beyond the core review workflow)

Status:
- ✅ CommandRegistry is the single source of truth for commands.
- ✅ Voice = rules first, then LLM fallback using registry capabilities.
- ✅ Commander execute + capabilities shipped.
- ✅ Queue + Review Console core control surface shipped.

Remaining work:
- Auto-generate Voice “exact match” aliases from command metadata (reduces drift; avoids manual rule edits).
- Provider plugin interface (Claude/Codex/future) to keep the architecture clean:
  - `listSessions`, `resume`, `searchHistory`, `getTranscript`, etc.
- Commander “typed freeform → LLM parse → {command, params}” flow (same prompt logic as voice, but typed).
- Expand selection helpers so voice can do “select PR 492 in zoo-game” (repo alias + PR number) without requiring full URL.

Primary source:
- `PLANS/2026-01-31/FULL_UI_CONTROL_VIA_COMMANDS_GAP_ANALYSIS.md`

---

## 3) Discord bot (orchestrator side is shipped; optional external work remains)

Status:
- ✅ Orchestrator-managed Services workspace + `/api/discord/*` endpoints shipped.
- ✅ Dashboard controls + Commander/Voice commands shipped.

Remaining (optional/external):
- Update `~/GitHub/tools/discord-task-bot` to call `/api/discord/status|ensure-services|process-queue` directly (instead of relying on generic `send-to-session`), if desired.
- Add any additional bot hardening you want (rate limits, channel allowlist UX, richer status reporting).

Primary source:
- `PLANS/2026-01-31/DISCORD_BOT_INTEGRATION_PLAN.md`

---

## 4) Quality-of-life follow-ups (only if you still see them)

These are “investigate if reproducible” items (not confirmed open work if you can’t reproduce):
- Terminal flicker: verify remaining cases are not status-dot logic vs layout/fit.
- Workspaces/worktrees/sessions drift: ensure “remove/close” semantics are consistent and de-duped:
  - Closing/removing a worktree should remove **both** Agent + Server terminals together (no orphan server tiles).
  - Worktree list/sidebar should not show stale entries after close/remove (no caching/out-of-sync state).
  - Identify source-of-truth per UI surface (workspace config `terminals[]` vs runtime `sessions`) and unify.
- Review Console layout polish: if any panels still feel cramped/“micro”, capture screenshot + viewport size.
- Workspace cleanup UX: confirm the dashboard 🧹 button is enough; add a detail view of removed entries if needed.

---

## 5) Ticket move semantics (post-merge → “For Test” and other workflows)

Status:
- ✅ PR merge automation exists (can move/comment when enabled in settings).
- ✅ Orchestrator already stores per-board automation settings in `ui.tasks.automations.trello.onPrMerged`.
- ✅ Board Conventions now supports `forTestListId` (Tasks → Board Settings → Conventions).
- ✅ PR merge automation can now target `done` / `for_test` / `none` (Settings → PR Merge Automation).

Remaining work:
- Optional: make “Move ticket” controls more discoverable (e.g. a header chip for “🧪 For Test” when configured).
- Optional: add a richer “Move ticket…” picker that surfaces board list names more prominently (still provider-agnostic).
