(function() {
  const panel = document.getElementById('recommendations-panel');
  const list = document.getElementById('recommendations-list');
  const badge = document.getElementById('recommendations-badge');
  let items = [];

  async function load() {
    try {
      const res = await fetch('/api/recommendations');
      const data = await res.json();
      items = data.items || [];
      updateBadge();
      render();
    } catch (e) {
      console.warn('Failed to load recommendations', e);
    }
  }

  function updateBadge() {
    const pending = items.filter(i => i.status === 'pending').length;
    if (pending > 0) {
      badge.textContent = pending;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }

  function render() {
    const pending = items.filter(i => i.status === 'pending');
    if (pending.length === 0) {
      list.innerHTML = '<div class="notification-empty">No pending recommendations</div>';
      return;
    }

    list.innerHTML = pending.map(item => `
      <div class="notification-item" data-id="${item.id}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <div style="flex:1;min-width:0">
            <strong style="color:var(--text-primary)">${esc(item.package)}</strong>
            <span style="color:var(--text-muted);font-size:0.8em;margin-left:4px">${esc(item.category)}</span>
            <div style="color:var(--text-secondary);font-size:0.85em;margin-top:2px">${esc(item.reason)}</div>
            <code style="display:block;font-size:0.8em;margin-top:4px;padding:4px 6px;background:var(--bg-tertiary);border-radius:4px;cursor:pointer;user-select:all"
              title="Click to copy"
              onclick="navigator.clipboard.writeText(this.textContent)">${esc(item.installCmd)}</code>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
            <button class="icon-button" title="Mark installed" onclick="window.recommendationsUI.markInstalled('${item.id}')" style="font-size:14px">✅</button>
            <button class="icon-button" title="Dismiss" onclick="window.recommendationsUI.dismiss('${item.id}')" style="font-size:14px">✕</button>
          </div>
        </div>
      </div>
    `).join('');
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  function toggle() {
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) load();
  }

  async function markInstalled(id) {
    try {
      await fetch(`/api/recommendations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'installed' })
      });
      await load();
    } catch (e) {
      console.warn('Failed to update recommendation', e);
    }
  }

  async function dismiss(id) {
    try {
      await fetch(`/api/recommendations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'dismissed' })
      });
      await load();
    } catch (e) {
      console.warn('Failed to dismiss recommendation', e);
    }
  }

  async function dismissAll() {
    const pending = items.filter(i => i.status === 'pending');
    for (const item of pending) {
      await fetch(`/api/recommendations/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'dismissed' })
      });
    }
    await load();
  }

  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && !e.target.closest('#recommendations-toggle')) {
      panel.classList.add('hidden');
    }
  });

  window.recommendationsUI = { toggle, load, markInstalled, dismiss, dismissAll };

  load();
  setInterval(load, 60000);
})();
