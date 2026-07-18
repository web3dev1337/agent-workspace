// Queue Evidence Card — renders the at-a-glance proof panel for a queue item:
// tests ran, app actually launched, agent review chain verdicts, screenshots,
// data/balance measurements, diff stats, standards used, handoff notes.
// Data source: task record `evidence` (see docs/agents/EVIDENCE_PROTOCOL.md).
(function () {
  'use strict';

  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  // Evidence originates from PR bodies/comments (semi-untrusted). Entity-escaping
  // alone doesn't stop a javascript:/data: URI from becoming a clickable link, so
  // only plain http(s) URLs are rendered as anchors; anything else stays text.
  const safeHttpUrl = (value) => {
    const s = String(value || '').trim();
    return /^https?:\/\//i.test(s) ? s : '';
  };

  const VERDICT_META = {
    approved: { icon: '✅', cls: 'ok' },
    needs_fix: { icon: '🛑', cls: 'bad' },
    commented: { icon: '💬', cls: 'warn' },
    skipped: { icon: '⏭', cls: 'muted' }
  };

  const timeAgo = (iso) => {
    const ms = Date.parse(String(iso || ''));
    if (!Number.isFinite(ms)) return '';
    const mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 48) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  };

  const badge = (cls, icon, label, title) =>
    `<span class="evidence-badge evidence-${cls}" title="${esc(title || label)}">${icon} ${esc(label)}</span>`;

  const buildBadges = (evidence) => {
    const badges = [];
    const tests = evidence.tests || null;
    if (tests?.ran) {
      const failed = Number(tests.failed) || 0;
      const passed = Number(tests.passed);
      const label = Number.isFinite(passed) ? `${passed}✓${failed ? ` ${failed}✗` : ''}` : (failed ? `${failed}✗` : 'ran');
      badges.push(badge(failed ? 'bad' : 'ok', '🧪', label, tests.command ? `Tests: ${tests.command}` : 'Tests ran'));
    } else {
      badges.push(badge('missing', '🧪', 'no tests', 'No automated test evidence'));
    }

    const appRun = evidence.appRun || null;
    if (appRun?.ran) {
      badges.push(badge('ok', '▶️', appRun.method || 'ran', appRun.notes || 'App/game was actually launched'));
    } else {
      badges.push(badge('missing', '▶️', 'not run', 'No proof the app/game was launched'));
    }

    const reviews = Array.isArray(evidence.reviews) ? evidence.reviews : [];
    if (reviews.length) {
      const approved = reviews.filter(r => r.verdict === 'approved').length;
      const cls = approved === reviews.length ? 'ok' : (reviews.some(r => r.verdict === 'needs_fix') ? 'bad' : 'warn');
      badges.push(badge(cls, '🧑‍⚖️', `${approved}/${reviews.length} reviews`, reviews.map(r => `${r.role || 'review'}: ${r.verdict || '?'}`).join(', ')));
    } else {
      badges.push(badge('missing', '🧑‍⚖️', 'no agent review', 'No agent review chain results'));
    }

    const media = Array.isArray(evidence.media) ? evidence.media : [];
    if (media.length) badges.push(badge('ok', '📸', String(media.length), `${media.length} screenshot(s)/video(s)`));

    const data = Array.isArray(evidence.data) ? evidence.data : [];
    if (data.length) badges.push(badge('ok', '📊', String(data.length), `${data.length} data measurement(s)`));

    const diff = evidence.diffStats || null;
    if (diff && (diff.files || diff.additions || diff.deletions)) {
      badges.push(badge('neutral', '📄', `${diff.files ?? '?'} files +${diff.additions ?? 0}/−${diff.deletions ?? 0}`, 'Diff size'));
    }

    return badges.join(' ');
  };

  const renderReviews = (reviews) => {
    if (!reviews.length) return '';
    const rows = reviews.map((r) => {
      const meta = VERDICT_META[r.verdict] || { icon: '•', cls: 'muted' };
      const who = [r.agentId, r.model, r.effort].filter(Boolean).join(' · ');
      const counts = (r.findings !== undefined || r.fixed !== undefined)
        ? ` — ${r.findings ?? 0} finding(s), ${r.fixed ?? 0} fixed`
        : '';
      const reviewUrl = safeHttpUrl(r.url);
      const link = reviewUrl ? ` <a href="${esc(reviewUrl)}" target="_blank" rel="noreferrer">↗</a>` : '';
      return `<div class="evidence-review-row evidence-${meta.cls}">
        <span class="evidence-review-verdict">${meta.icon}</span>
        <span class="evidence-review-role">${esc(r.role || 'review')}</span>
        <span class="evidence-review-meta">${esc(who)}${esc(counts)}${r.at ? ` · ${esc(timeAgo(r.at))}` : ''}${link}</span>
        ${r.summary ? `<div class="evidence-review-summary">${esc(r.summary)}</div>` : ''}
      </div>`;
    }).join('');
    return `<div class="evidence-section"><div class="evidence-section-title">Agent reviews</div>${rows}</div>`;
  };

  const renderData = (data) => {
    if (!data.length) return '';
    const rows = data.map((d) => `<tr>
      <td>${esc(d.metric)}</td>
      <td>${esc(d.before ?? '—')}</td>
      <td>${esc(d.after ?? '—')}</td>
      <td>${esc(d.note || '')}</td>
    </tr>`).join('');
    return `<div class="evidence-section"><div class="evidence-section-title">Data</div>
      <table class="evidence-data-table"><thead><tr><th>Metric</th><th>Before</th><th>After</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table>
    </div>`;
  };

  const renderMedia = (media, taskId) => {
    if (!media.length) return '';
    const encId = encodeURIComponent(taskId);
    const thumbs = media.map((m, idx) => {
      const src = `/api/process/evidence/${encId}/media/${idx}`;
      const isImage = m.type === 'image' || m.type === 'gif';
      const inner = isImage
        ? `<img src="${esc(src)}" alt="${esc(m.caption || `evidence ${idx + 1}`)}" loading="lazy" />`
        : `<div class="evidence-media-file">🎞 ${esc(m.caption || m.path || `media ${idx + 1}`)}</div>`;
      return `<button type="button" class="evidence-media-thumb" data-evidence-media-idx="${idx}" data-evidence-media-type="${esc(m.type || 'other')}" title="${esc(m.caption || m.path || '')}">${inner}</button>`;
    }).join('');
    return `<div class="evidence-section"><div class="evidence-section-title">Media</div><div class="evidence-media-grid">${thumbs}</div></div>`;
  };

  const renderCard = (task, record) => {
    const evidence = record && typeof record.evidence === 'object' && record.evidence ? record.evidence : null;
    const inner = evidence ? `
      <div class="evidence-badges">${buildBadges(evidence)}</div>
      ${evidence.summary ? `<div class="evidence-summary">${esc(evidence.summary)}</div>` : ''}
      ${evidence.tests?.ran && evidence.tests.command ? `<div class="evidence-line">🧪 <code>${esc(evidence.tests.command)}</code>${evidence.tests.at ? ` · ${esc(timeAgo(evidence.tests.at))}` : ''}</div>` : ''}
      ${evidence.appRun?.ran ? `<div class="evidence-line">▶️ ${esc(evidence.appRun.method || 'ran')}${evidence.appRun.url ? (safeHttpUrl(evidence.appRun.url) ? ` · <a href="${esc(safeHttpUrl(evidence.appRun.url))}" target="_blank" rel="noreferrer">${esc(evidence.appRun.url)}</a>` : ` · ${esc(evidence.appRun.url)}`) : ''}${evidence.appRun.notes ? ` — ${esc(evidence.appRun.notes)}` : ''}</div>` : ''}
      ${renderReviews(Array.isArray(evidence.reviews) ? evidence.reviews : [])}
      ${renderMedia(Array.isArray(evidence.media) ? evidence.media : [], task.id)}
      ${renderData(Array.isArray(evidence.data) ? evidence.data : [])}
      ${Array.isArray(evidence.standards) && evidence.standards.length ? `<div class="evidence-line evidence-muted">📐 Reviewed against: ${evidence.standards.map(esc).join(', ')}</div>` : ''}
      ${evidence.handoff?.notes ? `<div class="evidence-section"><div class="evidence-section-title">Handoff notes (for the next agent)</div><div class="evidence-handoff">${esc(evidence.handoff.notes)}</div></div>` : ''}
      <div class="evidence-line evidence-muted">Updated ${esc(timeAgo(evidence.updatedAt))}</div>
    ` : `
      <div class="evidence-empty">No evidence collected yet. Agents report via <code>agent-evidence</code> blocks in the PR body/comments or <code>.agent-evidence.json</code> in the worktree — see <code>docs/agents/EVIDENCE_PROTOCOL.md</code>.</div>
    `;

    return `
      <div class="tasks-detail-block evidence-card" data-evidence-card="1">
        <div class="tasks-detail-block-title">Evidence
          <button type="button" class="btn-secondary evidence-refresh-btn" id="queue-evidence-refresh" title="Re-collect evidence from PR comments + worktree">⟳ Refresh</button>
        </div>
        ${inner}
      </div>
    `;
  };

  const openLightbox = (src, type) => {
    const overlay = document.createElement('div');
    overlay.className = 'evidence-lightbox';
    overlay.innerHTML = type === 'video'
      ? `<video src="${esc(src)}" controls autoplay></video>`
      : `<img src="${esc(src)}" alt="evidence media" />`;
    // One shared close path so the document-level key listener is removed no
    // matter how the lightbox is dismissed (click previously leaked it).
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    };
    overlay.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
  };

  const wire = (detailEl, task, record, { onRefresh } = {}) => {
    const card = detailEl.querySelector('[data-evidence-card]');
    if (!card) return;

    const refreshBtn = card.querySelector('#queue-evidence-refresh');
    if (refreshBtn && typeof onRefresh === 'function') {
      refreshBtn.addEventListener('click', async () => {
        refreshBtn.disabled = true;
        refreshBtn.textContent = '⟳ Refreshing…';
        try {
          await onRefresh();
        } catch (e) {
          refreshBtn.textContent = '⟳ Refresh failed';
          refreshBtn.disabled = false;
          return;
        }
      });
    }

    const encId = encodeURIComponent(task.id);
    card.querySelectorAll('[data-evidence-media-idx]').forEach((thumb) => {
      thumb.addEventListener('click', () => {
        const idx = thumb.getAttribute('data-evidence-media-idx');
        const type = thumb.getAttribute('data-evidence-media-type');
        openLightbox(`/api/process/evidence/${encId}/media/${idx}`, type === 'video' ? 'video' : 'image');
      });
    });
  };

  window.QueueEvidence = { renderCard, wire };
})();
