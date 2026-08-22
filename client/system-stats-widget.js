// Header button showing live CPU / RAM / VRAM usage, with a modal on click
// that breaks down what's actually using the GPU's VRAM.
// Data: GET /api/system/stats (header pill polls the cheap fields; the modal
// re-fetches with ?processes=1 for the slower per-process VRAM breakdown).
const SYSTEM_STATS_SEVERITY = { yellow: 70, orange: 85, red: 95 };

class SystemStatsWidget {
  constructor() {
    this.btn = document.getElementById('system-stats-btn');
    this.summaryEl = document.getElementById('system-stats-summary');
    this.pollMs = 8000;
    this.data = null;
    if (!this.btn) return;
    this.btn.addEventListener('click', () => this.openModal());
    this.fetchStats();
    setInterval(() => this.fetchStats(), this.pollMs);
  }

  async fetchStats({ processes = false, refresh = false } = {}) {
    try {
      const params = new URLSearchParams();
      if (processes) params.set('processes', '1');
      if (refresh) params.set('refresh', '1');
      const res = await fetch(`/api/system/stats${params.toString() ? `?${params}` : ''}`);
      if (!res.ok) return null;
      this.data = await res.json();
      this.render();
      return this.data;
    } catch {
      // Leave the last known render in place.
      return null;
    }
  }

  severity(pct) {
    if (!Number.isFinite(pct)) return null;
    if (pct >= SYSTEM_STATS_SEVERITY.red) return 'red';
    if (pct >= SYSTEM_STATS_SEVERITY.orange) return 'orange';
    if (pct >= SYSTEM_STATS_SEVERITY.yellow) return 'yellow';
    return null;
  }

  sevSpan(text, pct) {
    const sev = this.severity(pct);
    return sev ? `<span class="usage-sev-${sev}">${text}</span>` : text;
  }

  render() {
    if (!this.btn || !this.data) return;
    this.btn.style.display = '';
    const { cpu, ram, gpu } = this.data;
    const parts = [];
    if (Number.isFinite(cpu?.percent)) parts.push(`CPU ${this.sevSpan(`${cpu.percent}%`, cpu.percent)}`);
    if (Number.isFinite(ram?.percent)) parts.push(`RAM ${this.sevSpan(`${ram.percent}%`, ram.percent)}`);
    if (gpu?.available && Number.isFinite(gpu.percent)) parts.push(`VRAM ${this.sevSpan(`${gpu.percent}%`, gpu.percent)}`);
    this.summaryEl.innerHTML = parts.length ? ' ' + parts.join(' · ') : ' --';
    const tipLines = ['System usage:'];
    if (cpu) tipLines.push(`  CPU: ${cpu.percent ?? '?'}% across ${cpu.cores} cores`);
    if (ram) tipLines.push(`  RAM: ${ram.usedGB}GB / ${ram.totalGB}GB (${ram.percent}%)`);
    if (gpu?.available) tipLines.push(`  VRAM (${gpu.name}): ${gpu.usedGB}GB / ${gpu.totalGB}GB (${gpu.percent}%), GPU util ${gpu.utilization ?? '?'}%`);
    tipLines.push('Click for a breakdown of what\'s using the VRAM.');
    this.btn.title = tipLines.join('\n');
  }

  escape(text) {
    return String(text).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  renderProcessesHtml(gpuProcesses) {
    if (!gpuProcesses) return '<div class="system-stats-loading">Loading VRAM breakdown…</div>';
    if (!gpuProcesses.available) {
      return `<div class="system-stats-empty">VRAM breakdown unavailable (${this.escape(gpuProcesses.reason || 'unknown')}).</div>`;
    }
    if (!gpuProcesses.processes?.length) {
      return '<div class="system-stats-empty">No process using more than 30MB of VRAM right now.</div>';
    }
    const rows = gpuProcesses.processes.map(p => `
      <div class="system-stats-process-row">
        <span class="system-stats-process-name">${this.escape(p.name)}</span>
        <span class="system-stats-process-pid">PID ${p.pid}</span>
        <span class="system-stats-process-mem">${p.usedGB}GB</span>
      </div>
      ${(p.identified || []).map(ip => `
      <div class="system-stats-process-row system-stats-process-subrow">
        <span class="system-stats-process-name">↳ ${this.escape(ip.label)}${ip.port ? ` :${ip.port}` : ''}</span>
        <span class="system-stats-process-pid">PID ${ip.pid}</span>
        <span class="system-stats-process-mem"></span>
      </div>`).join('')}`).join('');
    const sourceNote = gpuProcesses.source === 'windows-gpu-counters'
      ? 'Via Windows GPU performance counters (WSL2 can\'t see host process VRAM directly).'
      : 'Via nvidia-smi.';
    return `<div class="system-stats-process-list">${rows}</div><div class="system-stats-source-note">${this.escape(sourceNote)}</div>`;
  }

  renderModelsHtml(models) {
    if (!models) return '<div class="system-stats-loading">Loading…</div>';
    const ollamaModels = models.ollama?.models || [];
    const llamaCppServers = models.llamaCppServers || [];
    if (!ollamaModels.length && !llamaCppServers.length) {
      const reason = models.ollama?.available === false && models.ollama?.reason === 'not-installed'
        ? ''
        : ' right now';
      return `<div class="system-stats-empty">No local LLM${reason} loaded into VRAM.</div>`;
    }
    const unloadBtn = (source, name, pid) => `<button class="btn-secondary system-stats-unload-btn" data-action="unload-model" data-source="${this.escape(source)}" data-name="${this.escape(name || '')}" data-pid="${pid || ''}">Unload</button>`;
    const ollamaRows = ollamaModels.map(m => `
      <div class="system-stats-model-row">
        <div class="system-stats-model-info">
          <span class="system-stats-model-name">${this.escape(m.name)}</span>
          <span class="system-stats-model-detail">Ollama · ${this.escape(m.size || '?')} · until ${this.escape(m.until || '?')}</span>
        </div>
        ${unloadBtn('ollama', m.name)}
      </div>`).join('');
    const llamaRows = llamaCppServers.map(s => `
      <div class="system-stats-model-row">
        <div class="system-stats-model-info">
          <span class="system-stats-model-name">${this.escape(s.name)}</span>
          <span class="system-stats-model-detail">llama.cpp${s.port ? ` · port ${s.port}` : ''} · PID ${s.pid}</span>
        </div>
        ${unloadBtn('llama.cpp', null, s.pid)}
      </div>`).join('');
    return ollamaRows + llamaRows;
  }

  renderModalBody() {
    const { cpu, ram, gpu, gpuProcesses, models } = this.data || {};
    const bar = (label, pct, detail) => `
      <div class="system-stats-bar-row">
        <div class="system-stats-bar-label">${label} <span class="system-stats-bar-detail">${detail}</span></div>
        <div class="system-stats-bar-track"><div class="system-stats-bar-fill ${this.severity(pct) ? `sev-${this.severity(pct)}` : ''}" style="width:${Math.min(100, Math.max(0, pct || 0))}%"></div></div>
      </div>`;
    let html = '';
    if (cpu) html += bar('CPU', cpu.percent, `${cpu.percent ?? '?'}% · ${cpu.cores} cores`);
    if (ram) html += bar('RAM', ram.percent, `${ram.usedGB}GB / ${ram.totalGB}GB`);
    if (gpu?.available) {
      html += bar('VRAM', gpu.percent, `${gpu.usedGB}GB / ${gpu.totalGB}GB · ${this.escape(gpu.name)}`);
      html += `<h3 class="system-stats-section-title">Loaded models</h3>`;
      html += this.renderModelsHtml(models);
      html += `<h3 class="system-stats-section-title">What's using the VRAM</h3>`;
      html += this.renderProcessesHtml(gpuProcesses);
    } else if (gpu) {
      html += `<div class="system-stats-empty">No GPU detected (${this.escape(gpu.reason || 'unknown')}).</div>`;
    }
    return html;
  }

  async unloadModel(btn) {
    const source = btn.dataset.source;
    const name = btn.dataset.name || null;
    const pid = btn.dataset.pid ? Number(btn.dataset.pid) : null;
    const label = source === 'ollama' ? name : `PID ${pid}`;
    if (!confirm(`Unload ${label}? This stops it and frees its VRAM.`)) return;
    btn.disabled = true;
    btn.textContent = 'Unloading…';
    try {
      const res = await fetch('/api/system/models/unload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, name, pid })
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result.ok) {
        alert(`Unload failed: ${result.reason || res.status}`);
        btn.disabled = false;
        btn.textContent = 'Unload';
        return;
      }
      await this.fetchStats({ processes: true, refresh: true });
      const modal = document.getElementById('system-stats-modal');
      if (modal) modal.querySelector('.system-stats-body').innerHTML = this.renderModalBody();
    } catch (error) {
      alert(`Unload failed: ${error.message}`);
      btn.disabled = false;
      btn.textContent = 'Unload';
    }
  }

  async openModal() {
    const existing = document.getElementById('system-stats-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'system-stats-modal';
    modal.className = 'modal system-stats-modal';
    modal.innerHTML = `
      <div class="modal-content system-stats-content">
        <div class="ports-header">
          <h2>📊 CPU / RAM / VRAM</h2>
          <button class="close-btn" onclick="this.closest('.modal').remove()">×</button>
        </div>
        <div class="system-stats-body">${this.renderModalBody()}</div>
        <div class="ports-footer">
          <button class="btn-secondary" id="system-stats-refresh-btn">🔄 Refresh</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) { modal.remove(); return; }
      const unloadBtn = e.target.closest('[data-action="unload-model"]');
      if (unloadBtn) this.unloadModel(unloadBtn);
    });

    const refresh = async () => {
      const bodyEl = modal.querySelector('.system-stats-body');
      bodyEl.innerHTML = this.renderModalBody();
      await this.fetchStats({ processes: true, refresh: true });
      if (!document.body.contains(modal)) return;
      bodyEl.innerHTML = this.renderModalBody();
    };
    modal.querySelector('#system-stats-refresh-btn')?.addEventListener('click', refresh);
    // First open: the header poll never requested the process breakdown, so
    // fetch it now.
    await refresh();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.systemStatsWidget = new SystemStatsWidget();
});
