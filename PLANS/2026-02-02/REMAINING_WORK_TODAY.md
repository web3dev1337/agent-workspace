# Remaining work (as of 2026-02-02)

Date: 2026-02-02  
Scope: “optional/future” items that are still real work and should be treated as the **current remaining backlog**.

This is intentionally short, concrete, and actionable. It supersedes “nothing left” interpretations that only count checkboxes.

---

## 1) Skins / “Blue mode” (make it truly beautiful + consistent)

Status:
- ✅ Skin selector exists (Settings → Skin).
- ✅ Blue skin uses requested primary `#0f67fd` and works in light + dark.
- ✅ Skin intensity shipped (Settings → Skin intensity; persisted via `ui.skinIntensity`).
- ✅ Additional skins shipped (Purple/Emerald/Amber + High Contrast).
- ✅ Theme gallery shipped (clickable swatches in Settings).
- ✅ Color audit exists (`PLANS/2026-01-31/UI_COLOR_AUDIT.md`).
- ✅ Started tokenizing a few hard-coded accents (YOLO highlight + warning accents) to respect skins.

Remaining work:
- Convert remaining hard-coded UI colors/gradients to token-driven styling where appropriate (don’t touch status semantic colors unless intentional).
- Decide + document which UI surfaces are “accent tinted” vs neutral across skins:
  - selected rows/tiles, active tabs, focused buttons, modals/overlays
  - Queue/Tasks/Review Console overlays

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
- ✅ Voice exact-match aliases are auto-generated from command metadata (prevents drift).
- ✅ Selection helper supports repo-aware PR number targeting (`select pr 492 in zoo-game`) via shared command surface.

Remaining work:
- Provider plugin interface (Claude/Codex/future) to keep the architecture clean:
  - `listSessions`, `resume`, `searchHistory`, `getTranscript`, etc.
- Commander “typed freeform → LLM parse → {command, params}” flow (same prompt logic as voice, but typed).

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
- Review Console layout polish: if any panels still feel cramped/“micro”, capture screenshot + viewport size (the console is intended to be single-screen with the diff dominating).
- Workspace cleanup UX: confirm the dashboard 🧹 button is enough; add a detail view of removed entries if needed.

---

## 5) Ticket move semantics (post-merge → “For Test” and other workflows)

Status:
- ✅ PR merge automation exists (can move/comment when enabled in settings).
- ✅ Orchestrator already stores per-board automation settings in `ui.tasks.automations.trello.onPrMerged`.
- ✅ Board Conventions now supports `forTestListId` (Tasks → Board Settings → Conventions).
- ✅ PR merge automation can now target `done` / `for_test` / `none` (Settings → PR Merge Automation).

Remaining work:
- (done) “For Test” is now available as a Review Console header chip when configured.
- Optional: add a richer “Move ticket…” picker that surfaces board list names more prominently (still provider-agnostic).
