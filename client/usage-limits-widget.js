// Header widget showing Claude/Codex/Grok plan-limit usage with reset countdowns.
// Data: GET /api/usage/limits (Claude via status-line tap file, Codex via the
// official app-server helper). Renders nothing until data is available.
//
// Color logic:
// - Usage severity (running out): % turns yellow/orange/red as a window fills.
// - Weekly pace severity (use-it-or-lose-it): the countdown turns yellow/orange/
//   red when usage is far BEHIND the pace needed to spend the week's quota
//   before it resets. Only ~20% of the weekly quota can be spent per 5-hour
//   window, so the spendable remainder is capped by how many windows are left
//   (with a realism factor — nobody maxes every consecutive window).
const USAGE_SEVERITY_THRESHOLDS = { yellow: 70, orange: 85, red: 95 };
const WEEKLY_WINDOW_SECONDS = 7 * 24 * 3600;
const FIVE_HOUR_SECONDS = 5 * 3600;
const WEEKLY_MAX_PER_WINDOW = 0.20; // heuristic: max share of weekly quota per 5h window
const WINDOW_REALISM_FACTOR = 0.6;  // heuristic: realistic fraction of windows actually maxed
const PACE_LOSE_RED = 0.15;    // >=15% of quota mathematically/realistically unspendable
const PACE_LOSE_ORANGE = 0.05;
const PACE_DEFICIT_ORANGE = 0.35; // behind linear pace by 35+ points
const PACE_DEFICIT_YELLOW = 0.20;
const PACE_DEFICIT_MAX_SECONDS_LEFT = 2 * 24 * 3600; // only flag linear-pace deficit inside the last 2 days — plenty of runway before that

class UsageLimitsWidget {
  constructor() {
    this.el = document.getElementById('usage-limits-widget');
    this.refreshMs = 5 * 60 * 1000;
    this.tickMs = 60 * 1000;
    this.data = null;
    if (!this.el) return;
    this.fetchLimits();
    setInterval(() => this.fetchLimits(), this.refreshMs);
    // Re-render between fetches so countdowns stay current.
    setInterval(() => this.render(), this.tickMs);
  }

  async fetchLimits() {
    try {
      const res = await fetch('/api/usage/limits');
      if (!res.ok) return;
      this.data = await res.json();
      this.render();
    } catch {
      // Leave the last known render in place.
    }
  }

  formatCountdown(resetsAtSeconds) {
    if (!resetsAtSeconds) return '';
    let secs = Math.floor(resetsAtSeconds - Date.now() / 1000);
    if (secs <= 0) return 'now';
    const days = Math.floor(secs / 86400);
    const hours = Math.floor((secs % 86400) / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    if (days > 0) return `${days}d${hours}h`;
    if (hours > 0) return `${hours}h${mins}m`;
    return `${mins}m`;
  }

  usageSeverity(pct) {
    if (!Number.isFinite(pct)) return null;
    if (pct >= USAGE_SEVERITY_THRESHOLDS.red) return 'red';
    if (pct >= USAGE_SEVERITY_THRESHOLDS.orange) return 'orange';
    if (pct >= USAGE_SEVERITY_THRESHOLDS.yellow) return 'yellow';
    return null;
  }

  // Use-it-or-lose-it pace check for weekly windows.
  paceSeverity(bucket, windowSeconds = WEEKLY_WINDOW_SECONDS) {
    if (!bucket || !Number.isFinite(bucket.usedPercentage) || !bucket.resetsAt) return null;
    const secsLeft = bucket.resetsAt - Date.now() / 1000;
    if (secsLeft <= 0 || secsLeft > windowSeconds) return null;
    const used = Math.min(Math.max(bucket.usedPercentage / 100, 0), 1);
    const remaining = 1 - used;
    if (remaining <= 0.05) return null; // nearly spent — nothing to lose

    // How much of the remainder is realistically spendable in the windows left.
    const windowsLeft = Math.ceil(secsLeft / FIVE_HOUR_SECONDS);
    const spendable = windowsLeft * WEEKLY_MAX_PER_WINDOW * WINDOW_REALISM_FACTOR;
    const lose = remaining - spendable;
    if (lose >= PACE_LOSE_RED) return 'red';
    if (lose >= PACE_LOSE_ORANGE) return 'orange';

    // Behind the linear pace needed to finish the quota by reset — only worth
    // flagging once reset is close; days out, being "behind" linear pace is normal.
    if (secsLeft > PACE_DEFICIT_MAX_SECONDS_LEFT) return null;
    const elapsedFrac = 1 - secsLeft / windowSeconds;
    const deficit = elapsedFrac - used;
    if (deficit >= PACE_DEFICIT_ORANGE) return 'orange';
    if (deficit >= PACE_DEFICIT_YELLOW) return 'yellow';
    return null;
  }

  sevSpan(text, severity) {
    if (!severity) return this.escape(text);
    return `<span class="usage-sev-${severity}">${this.escape(text)}</span>`;
  }

  escape(text) {
    return String(text).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // key: label pct% · countdown, with usage severity on the %, and pace
  // severity on the countdown for weekly windows.
  formatBucketHtml(label, bucket, { weekly = false, windowSeconds = WEEKLY_WINDOW_SECONDS } = {}) {
    if (!bucket || bucket.usedPercentage === null || bucket.usedPercentage === undefined) return null;
    const countdown = this.formatCountdown(bucket.resetsAt);
    const pctHtml = this.sevSpan(`${bucket.usedPercentage}%`, this.usageSeverity(bucket.usedPercentage));
    const countdownHtml = countdown
      ? '·' + this.sevSpan(countdown, weekly ? this.paceSeverity(bucket, windowSeconds) : null)
      : '';
    return `${this.escape(label)} ${pctHtml}${countdownHtml}`;
  }

  // seven_day_opus -> "Opus 7d", seven_day_fable -> "Fable 7d", other -> key
  labelForExtraBucket(key) {
    const m = String(key || '').match(/^seven_day_(.+)$/);
    if (m) {
      const model = m[1].replace(/_/g, ' ');
      return `${model.charAt(0).toUpperCase()}${model.slice(1)} 7d`;
    }
    return String(key || '').replace(/_/g, ' ');
  }

  // "1 week" -> 604800, "5 hours" -> 18000, etc. Unrecognized labels sort last.
  windowDurationSeconds(label) {
    const m = String(label || '').match(/^(\d+)\s*(hour|day|week|month)s?$/i);
    if (!m) return 0;
    const mult = { hour: 3600, day: 86400, week: 604800, month: 2592000 }[m[2].toLowerCase()] || 0;
    return Number(m[1]) * mult;
  }

  // Display order for every pill: the plan's own weekly bucket, then its
  // hourly bucket, then any extra model-specific bucket (e.g. "Spark") last.
  sortWindowsForDisplay(windows, defaultBucket) {
    return [...windows].sort((a, b) => {
      const aExtra = a.bucket && a.bucket !== defaultBucket ? 1 : 0;
      const bExtra = b.bucket && b.bucket !== defaultBucket ? 1 : 0;
      if (aExtra !== bExtra) return aExtra - bExtra;
      return this.windowDurationSeconds(b.window) - this.windowDurationSeconds(a.window);
    });
  }

  pill(bodyHtml, tipLines) {
    return `<span class="usage-pill" title="${this.escape(tipLines.join('\n'))}">${bodyHtml}</span>`;
  }

  renderClaudePill() {
    const claude = this.data.claude || {};
    if (!claude.available) return null;
    const buckets = [
      this.formatBucketHtml('7d', claude.sevenDay, { weekly: true }),
      this.formatBucketHtml('5h', claude.fiveHour)
    ];
    for (const extra of (Array.isArray(claude.extraBuckets) ? claude.extraBuckets : [])) {
      buckets.push(this.formatBucketHtml(this.labelForExtraBucket(extra.key), extra, { weekly: /seven_day/.test(extra.key) }));
    }
    const rendered = buckets.filter(Boolean);
    if (!rendered.length) return null;
    const tips = [`Claude plan usage${claude.model ? ` (${claude.model})` : ''}${claude.stale ? ' (stale — open any Claude session to refresh)' : ''}:`];
    if (claude.fiveHour?.resetsAt) tips.push(`  5-hour window: ${claude.fiveHour.usedPercentage}% used, resets ${new Date(claude.fiveHour.resetsAt * 1000).toLocaleString()}`);
    if (claude.sevenDay?.resetsAt) tips.push(`  7-day window: ${claude.sevenDay.usedPercentage}% used, resets ${new Date(claude.sevenDay.resetsAt * 1000).toLocaleString()}`);
    for (const extra of (Array.isArray(claude.extraBuckets) ? claude.extraBuckets : [])) {
      if (extra.resetsAt) tips.push(`  ${this.labelForExtraBucket(extra.key)}: ${extra.usedPercentage}% used, resets ${new Date(extra.resetsAt * 1000).toLocaleString()}`);
    }
    if (claude.sevenDay?.resetsAt && this.paceSeverity(claude.sevenDay)) {
      tips.push('  ⚠ weekly quota is going unused — countdown highlighted (use it or lose it)');
    }
    return this.pill(`Claude ${rendered.join('  ')}${claude.stale ? '?' : ''}`, tips);
  }

  renderCodexPill() {
    const codex = this.data.codex || {};
    if (!codex.available || !Array.isArray(codex.windows) || !codex.windows.length) return null;
    const sortedWindows = this.sortWindowsForDisplay(codex.windows, 'codex');
    const multi = sortedWindows.length > 1;
    const buckets = sortedWindows
      .map(w => {
        const windowLabel = w.window === '1 week' ? 'wk' : w.window;
        const label = multi && w.bucket && w.bucket !== 'codex' ? `${w.bucket.replace(/^codex_/, '')} ${windowLabel}` : windowLabel;
        return this.formatBucketHtml(label, w, { weekly: w.window === '1 week' });
      })
      .filter(Boolean);
    if (!buckets.length) return null;
    const tips = ['Codex plan usage:'];
    for (const w of sortedWindows) {
      if (w.resetsAt) tips.push(`  ${w.bucket || w.name} (${w.window}): ${w.usedPercentage}% used, resets ${new Date(w.resetsAt * 1000).toLocaleString()}`);
    }
    return this.pill(`Codex ${buckets.join('  ')}${codex.stale ? '?' : ''}`, tips);
  }

  renderGrokPill() {
    const grok = this.data.grok || {};
    if (!grok.available || !Array.isArray(grok.windows) || !grok.windows.length) return null;
    const sortedWindows = this.sortWindowsForDisplay(grok.windows, 'grok');
    const buckets = sortedWindows
      .map(w => this.formatBucketHtml(
        w.window === '1 week' ? 'wk' : (w.window === '1 month' ? 'mo' : w.window),
        w,
        { weekly: w.window === '1 week', windowSeconds: w.window === '1 month' ? 30 * 86400 : WEEKLY_WINDOW_SECONDS }
      ))
      .filter(Boolean);
    if (!buckets.length) return null;
    const tips = ['Grok plan usage:'];
    for (const w of sortedWindows) {
      if (w.resetsAt) tips.push(`  ${w.name} (${w.window}): ${w.usedPercentage}% used, resets ${new Date(w.resetsAt * 1000).toLocaleString()}`);
    }
    return this.pill(`Grok ${buckets.join('  ')}${grok.stale ? '?' : ''}`, tips);
  }

  render() {
    if (!this.el || !this.data) return;
    const pills = [this.renderClaudePill(), this.renderCodexPill(), this.renderGrokPill()].filter(Boolean);
    if (!pills.length) {
      this.el.style.display = 'none';
      return;
    }
    this.el.style.display = '';
    this.el.removeAttribute('title');
    this.el.innerHTML = pills.join('');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.usageLimitsWidget = new UsageLimitsWidget();
});
