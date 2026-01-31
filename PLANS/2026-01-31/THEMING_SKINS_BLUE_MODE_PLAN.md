# Theming / Skins Plan (incl. “Blue Mode”)

Date: 2026-01-31

## Goal

Add a robust “skin” system so the Orchestrator can support:
- Existing Light / Dark modes
- A new **Blue skin** (requested primary `#0f67fd` with white text where appropriate)
- Future skins (e.g. Purple, Emerald, Amber) without touching lots of per-component CSS

This is specifically to make the UI feel more “designed”/cohesive, while staying readable on
gray-ish backgrounds and working in both light and dark.

## Current State (what we have today)

We already have a token-based CSS approach in `client/styles.css`:
- Dark is the default tokens under `:root`
- Light overrides under `body.light-theme`

Key tokens (already present):
- `--bg-primary`, `--bg-secondary`, `--bg-tertiary`
- `--text-primary`, `--text-secondary`, `--text-tertiary`
- `--border-color`
- `--accent-primary`, `--accent-success`, `--accent-warning`, `--accent-danger`
- `--status-idle`, `--status-waiting`, `--status-busy`, `--status-error`

## Problem

Even though many surfaces use tokens, there are still lots of **hard-coded colors** in CSS
(and some component-specific gradients), which prevents “skins” from being consistent.

Example sources of hard-coded colors:
- `client/styles.css` has many literal hex colors (alerts, pills, gradients, buttons, badges).
- `client/styles/tabs.css` includes hard-coded colors (e.g. animation midpoints).

Until these are migrated to tokens, any “Blue mode” will be partial / inconsistent.

## Proposed Architecture

Separate two concepts:

1) **Mode**: “dark” vs “light” (affects backgrounds + text contrast)
2) **Skin**: “default” vs “blue” vs “purple” … (affects accents + selected surfaces)

Implementation proposal:
- Keep `body.light-theme` for now, but migrate toward:
  - `body[data-mode="dark"|"light"]`
  - `body[data-skin="default"|"blue"|...]`
- Persist both via user settings:
  - `ui.theme.mode` (default: `dark`)
  - `ui.theme.skin` (default: `default`)
- Allow optional “skin-intensity” later:
  - `ui.theme.skinIntensity` (0–100)

### Token layers

Base tokens:
- neutrals: `--bg-*`, `--text-*`, `--border-color`, `--bg-hover`

Skin tokens:
- accents: `--accent-primary` (and optionally a small set of derived accents)
- “selected row / selected tile / active tab” backgrounds

Component tokens (as needed):
- `--chip-bg`, `--chip-text`, `--pill-bg`, `--pill-border`, `--focus-ring`
- `--gradient-primary` etc (avoid hard-coded gradients)

## “Blue Mode” Palette (initial)

We want the requested blue to show clearly on gray-ish backgrounds and remain readable.

Primary:
- `--accent-primary: #0f67fd`

Derived (dark mode suggested defaults; can be adjusted after visual pass):
- `--accent-primary-2: #2b7cff` (hover)
- `--accent-primary-3: #0b56d8` (active/pressed)
- `--focus-ring: rgba(15, 103, 253, 0.35)`

Text-on-primary:
- Use white `#ffffff` for labels on primary buttons/selected tiles.

Light mode “Blue skin” should not just reuse the dark palette:
- keep light backgrounds from light mode
- only adjust accent + selected/active backgrounds

## Design Requirements / Guardrails

- Avoid “low contrast blue-on-blue” in light mode (easy to make unreadable).
- Ensure primary actions remain obvious in both modes.
- Status colors (idle/waiting/busy/error) must remain distinct and consistent:
  - waiting = green-ish, busy = orange-ish, error = red-ish, idle = neutral
  - the skin should NOT change status semantics (but can change shades if needed)

## Implementation Checklist (Phase 1: make skins possible)

1) Add `ui.theme.mode` + `ui.theme.skin` settings, with a Settings UI selector.
2) Apply attributes/classes on `body` at startup + on change.
3) Add CSS blocks:
   - `body[data-mode="light"] { ... }` (mirrors `body.light-theme`)
   - `body[data-skin="blue"] { --accent-primary: #0f67fd; ... }`
4) Audit + migrate hard-coded colors to tokens:
   - Replace literal blues used for “primary” with `--accent-primary`
   - Replace literal danger/success/warn with `--accent-*`
   - Replace component gradients with tokenized gradients
5) Quick visual QA pass across:
   - Header buttons, sidebar items, modals, panels
   - Queue/Tasks/Review Console overlays
   - Status dots + tier badges + branch label chips

## Implementation Checklist (Phase 2: make it “beautiful”)

- Identify all remaining “ad-hoc” colors and introduce tokens where needed.
- Ensure consistent spacing + elevation (shadows/borders) per mode.
- Add 1–2 additional skins (optional) to validate the architecture:
  - e.g. Purple and Emerald

## Testing / QA

Manual:
- Toggle mode/skin, confirm persistence after refresh.
- Validate in both modes:
  - selected/active states are readable
  - hover/active states remain visible
  - text contrast on primary buttons is acceptable

Automated (optional):
- Add a small UI smoke test that toggles theme settings and asserts the `body` attributes update.

