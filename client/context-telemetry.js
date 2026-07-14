// Local context-switch telemetry (fire-and-forget; nothing leaves the
// machine). app.js calls track() on worktree focus, workspace switch,
// workflow-mode change and review start/end. The Context Tax law: every
// switch costs ~5-15 min of refocus — measuring it is the first step to
// batching it away.
(function () {
  'use strict';

  const state = { lastByType: {} };

  const track = (type, to, meta) => {
    try {
      const from = state.lastByType[type] ?? null;
      if (from === to) return;
      state.lastByType[type] = to;
      fetch('/api/process/telemetry/context-switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, from, to, meta }),
        keepalive: true
      }).catch(() => {});
    } catch { /* telemetry must never break the UI */ }
  };

  window.ContextTelemetry = { track };
})();
