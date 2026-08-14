// Settings → Plugins: shows loaded/failed plugins and a reload button.
// Failed plugins were previously invisible — a bad manifest just vanished.
(function () {
  'use strict';

  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const render = async () => {
    const list = document.getElementById('plugins-admin-list');
    if (!list) return;
    try {
      const res = await fetch('/api/plugins');
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      const loaded = Array.isArray(data?.loaded) ? data.loaded : (Array.isArray(data?.plugins) ? data.plugins : []);
      const failed = Array.isArray(data?.failed) ? data.failed : [];

      const loadedHtml = loaded.length
        ? loaded.map((p) => `<div>✅ <strong>${esc(p.name || p.id || p.pluginId)}</strong> ${esc(p.version || '')} — ${esc(p.description || '')} <span style="opacity:0.7">(${Number(p.commandCount ?? p.commands ?? 0) || 0} cmds)</span></div>`).join('')
        : '<div>No plugins loaded.</div>';
      const failedHtml = failed.length
        ? failed.map((p) => `<div>❌ <strong>${esc(p.id || p.pluginId || '(unknown)')}</strong> — ${esc(p.error || 'failed to load')}</div>`).join('')
        : '';

      list.innerHTML = loadedHtml + failedHtml;
    } catch (e) {
      list.textContent = `Failed to load plugin status (${String(e?.message || e)})`;
    }
  };

  const init = () => {
    const reloadBtn = document.getElementById('plugins-reload-btn');
    if (!reloadBtn) return;

    reloadBtn.addEventListener('click', async () => {
      reloadBtn.disabled = true;
      reloadBtn.textContent = '🔄 Reloading…';
      try {
        await fetch('/api/plugins/reload', { method: 'POST' });
      } catch { /* status re-render below reports the outcome */ }
      await render();
      try { await window.orchestratorPluginHost?.refresh({ force: true }); } catch {}
      reloadBtn.textContent = '🔄 Reload plugins';
      reloadBtn.disabled = false;
    });

    render();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
