// UI Mode preset switch (Settings → UI Mode): Simple ↔ Power/Process.
// Self-contained: applies via /api/user-settings/visibility-preset and
// reloads so every gated element re-evaluates.
(function () {
  'use strict';

  const init = () => {
    const group = document.getElementById('visibility-preset-group');
    if (!group) return;

    const currentEl = document.getElementById('visibility-preset-current');

    const markCurrent = (preset) => {
      group.querySelectorAll('[data-visibility-preset]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.visibilityPreset === preset);
      });
      if (currentEl) currentEl.textContent = preset ? `Current: ${preset}` : '';
    };

    fetch('/api/user-settings/visibility-presets')
      .then(r => (r.ok ? r.json() : null))
      .then((data) => { if (data?.current) markCurrent(data.current); })
      .catch(() => {});

    group.querySelectorAll('[data-visibility-preset]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const preset = btn.dataset.visibilityPreset;
        btn.disabled = true;
        try {
          const res = await fetch('/api/user-settings/visibility-preset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ preset })
          });
          if (!res.ok) throw new Error('apply failed');
          window.location.reload();
        } catch {
          btn.disabled = false;
          if (currentEl) currentEl.textContent = 'Failed to apply preset';
        }
      });
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
