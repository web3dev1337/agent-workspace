// Queue Review Workflow block — pick a multi-agent review chain for a PR task,
// run it, and watch per-stage progress (role → agent/model → verdict).
// Backed by /api/process/review-workflows (config/review-workflows.json).
(function () {
  'use strict';

  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  let configCache = null;

  const fetchConfig = async () => {
    if (configCache) return configCache;
    const res = await fetch('/api/process/review-workflows');
    if (!res.ok) throw new Error('workflow config unavailable');
    configCache = await res.json();
    return configCache;
  };

  const STAGE_ICONS = {
    pending: '○',
    running: '◐',
    done: '●',
    failed: '✗',
    skipped: '⏭'
  };

  const VERDICT_ICONS = { approved: '✅', needs_fix: '🛑', commented: '💬', skipped: '⏭' };

  const RUN_LABELS = {
    running: 'Running',
    pending: 'Pending',
    blocked_fix: 'Blocked — changes requested',
    stalled: 'Stalled — stage timed out or could not spawn',
    complete: 'Complete',
    cancelled: 'Cancelled'
  };

  const renderStages = (run) => (run.stages || []).map((s, i) => {
    const icon = STAGE_ICONS[s.status] || '○';
    const verdict = s.verdict ? ` ${VERDICT_ICONS[s.verdict] || ''}` : '';
    const who = [s.agentId, s.model].filter(Boolean).join('/');
    const active = i === (run.stageIndex || 0) && run.status === 'running';
    return `<span class="wf-stage wf-stage-${esc(s.status || 'pending')}${active ? ' wf-stage-active' : ''}" title="${esc(`${s.role} — ${who}${s.effort ? ` (${s.effort})` : ''}: ${s.status}${s.verdict ? `, ${s.verdict}` : ''}`)}">${icon} ${esc(s.role)}${verdict}</span>`;
  }).join('<span class="wf-arrow">→</span>');

  const renderCard = (task, record) => {
    if (task.kind !== 'pr') return '';
    const run = record?.reviewWorkflow || null;

    const runHtml = run ? `
      <div class="wf-run">
        <div class="wf-stages">${renderStages(run)}</div>
        <div class="wf-status wf-status-${esc(run.status || '')}">${esc(RUN_LABELS[run.status] || run.status || '')}${run.workflowId ? ` · ${esc(run.workflowId)}` : ''}</div>
      </div>
    ` : '';

    const showStart = !run || ['complete', 'cancelled', 'blocked_fix', 'stalled'].includes(run.status);
    const controls = `
      <div class="wf-controls">
        ${showStart ? `
          <select id="queue-wf-select" class="tasks-select tasks-select-inline"><option value="">Loading workflows…</option></select>
          <button class="btn-secondary" id="queue-wf-start" type="button" title="Spawn the review chain — each stage posts an agent-evidence comment + GitHub review">▶ Run chain</button>
        ` : ''}
        ${run && (run.status === 'stalled') ? `<button class="btn-secondary" id="queue-wf-advance" type="button" title="Skip the stuck stage and continue">⏭ Skip stage</button>` : ''}
        ${run && ['running', 'pending', 'blocked_fix', 'stalled'].includes(run.status) ? `<button class="btn-secondary" id="queue-wf-cancel" type="button">✖ Cancel</button>` : ''}
      </div>
    `;

    return `
      <div class="tasks-detail-block wf-card" data-workflow-card="1">
        <div class="tasks-detail-block-title">Review workflow (agent chain)</div>
        ${runHtml}
        ${controls}
      </div>
    `;
  };

  const wire = (detailEl, task, record, { onChanged } = {}) => {
    const card = detailEl.querySelector('[data-workflow-card]');
    if (!card) return;

    const encId = encodeURIComponent(task.id);
    const select = card.querySelector('#queue-wf-select');
    const startBtn = card.querySelector('#queue-wf-start');
    const advanceBtn = card.querySelector('#queue-wf-advance');
    const cancelBtn = card.querySelector('#queue-wf-cancel');

    if (select) {
      fetchConfig().then((cfg) => {
        const risk = String(record?.changeRisk || record?.baseImpactRisk || '').toLowerCase();
        const defaultId = cfg.riskDefaults?.[risk] || 'standard';
        select.innerHTML = (cfg.workflows || []).map((w) => {
          const stages = (w.stages || []).map(s => s.role).join(' → ');
          return `<option value="${esc(w.id)}" ${w.id === defaultId ? 'selected' : ''}>${esc(w.label)} (${esc(stages)})</option>`;
        }).join('') || '<option value="">No workflows configured</option>';
      }).catch(() => {
        select.innerHTML = '<option value="">Config unavailable</option>';
      });
    }

    const post = async (action, body) => {
      const res = await fetch(`/api/process/review-workflows/${encId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `${action} failed`);
      return data;
    };

    if (startBtn) {
      startBtn.addEventListener('click', async () => {
        const workflowId = select?.value;
        if (!workflowId) return;
        startBtn.disabled = true;
        startBtn.textContent = '▶ Starting…';
        try {
          const data = await post('start', { workflowId });
          if (typeof onChanged === 'function') onChanged(data.run);
        } catch (e) {
          startBtn.textContent = `▶ ${e.message}`.slice(0, 40);
          startBtn.disabled = false;
        }
      });
    }

    if (advanceBtn) {
      advanceBtn.addEventListener('click', async () => {
        advanceBtn.disabled = true;
        try {
          const data = await post('advance');
          if (typeof onChanged === 'function') onChanged(data.run);
        } catch { advanceBtn.disabled = false; }
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', async () => {
        cancelBtn.disabled = true;
        try {
          const data = await post('cancel');
          if (typeof onChanged === 'function') onChanged(data.run);
        } catch { cancelBtn.disabled = false; }
      });
    }
  };

  window.QueueWorkflow = { renderCard, wire };
})();
