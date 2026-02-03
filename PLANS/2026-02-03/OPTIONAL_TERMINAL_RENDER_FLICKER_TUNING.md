# Optional: Terminal Rendering / Flicker Tuning Notes

Date: 2026-02-03

This is a **future tuning** note (not shipped by default) for reducing perceived flicker/jank in the xterm.js terminals.

Scope: UI rendering performance only — **not** session status-dot logic (StatusDetector) and **not** workflow tier logic.

## Current state

- Terminal creation/config lives in `client/terminal.js`.
- We currently use xterm.js with the `canvas` renderer and `cursorBlink: true`.

## Potential improvements (trade-offs)

### 1) Disable cursor blinking (reduce constant repaints)

- Change `cursorBlink: true` → `false`
- Why: blink repaints every ~500ms; on some machines that looks like “flicker”.
- Trade-off: less “alive” cursor; but usually worth it for stability.

### 2) Try WebGL renderer (GPU accelerated)

- Change `rendererType: 'canvas'` → `'webgl'` (or `'auto'` if supported by your xterm version)
- Why: WebGL can reduce CPU-bound redraw cost and improve scroll performance.
- Trade-off:
  - Some GPUs/driver combos fail or look worse.
  - Needs a fallback path (`canvas`) if WebGL init fails.

### 3) Reduce scroll animation + smooth scrolling

- Add:
  - `smoothScrollDuration: 0`
  - `fastScrollModifier: 'alt'` (optional)
- Why: animated scrolling can stutter on high-throughput terminals.
- Trade-off: less “smooth” feel; but more “snappy”.

### 4) Lower scrollback buffer (memory + layout pressure)

- Change `scrollback: 5000` → `2000` (or `1000`)
- Why: less memory, less surface area for reflow.
- Trade-off: less history.

## Recommended way to ship (when we do)

If/when we implement these:

1. Add them behind a user setting (e.g. `ui.terminals.renderPreset = default|stable|performance`).
2. Default preset stays conservative (`canvas`, `cursorBlink: false` might be OK as the new default).
3. Implement WebGL with fallback:
   - Try WebGL first.
   - On init error, fallback to `canvas`.
4. Add a quick “Reload terminals” action or instruction so changes apply cleanly.

