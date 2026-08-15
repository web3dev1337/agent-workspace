// Header widget showing Claude/Codex plan-limit usage with reset countdowns.
// Data: GET /api/usage/limits (Claude via status-line tap file, Codex via the
// official app-server helper). Renders nothing until data is available.
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

  formatBucket(label, bucket) {
    if (!bucket || bucket.usedPercentage === null || bucket.usedPercentage === undefined) return null;
    const countdown = this.formatCountdown(bucket.resetsAt);
    return `${label} ${bucket.usedPercentage}%${countdown ? '·' + countdown : ''}`;
  }

  render() {
    if (!this.el || !this.data) return;
    const parts = [];
    const tips = [];
    const claude = this.data.claude || {};
    if (claude.available) {
      const buckets = [
        this.formatBucket('5h', claude.fiveHour),
        this.formatBucket('7d', claude.sevenDay)
      ].filter(Boolean);
      if (buckets.length) {
        parts.push(`CL ${buckets.join(' ')}${claude.stale ? '?' : ''}`);
        tips.push(`Claude plan usage${claude.stale ? ' (stale — open any Claude session to refresh)' : ''}:`);
        if (claude.fiveHour?.resetsAt) tips.push(`  5-hour window: ${claude.fiveHour.usedPercentage}% used, resets ${new Date(claude.fiveHour.resetsAt * 1000).toLocaleString()}`);
        if (claude.sevenDay?.resetsAt) tips.push(`  7-day window: ${claude.sevenDay.usedPercentage}% used, resets ${new Date(claude.sevenDay.resetsAt * 1000).toLocaleString()}`);
      }
    }
    const codex = this.data.codex || {};
    if (codex.available && Array.isArray(codex.windows) && codex.windows.length) {
      const multi = codex.windows.length > 1;
      const buckets = codex.windows
        .map(w => {
          const windowLabel = w.window === '1 week' ? 'wk' : w.window;
          const label = multi && w.bucket && w.bucket !== 'codex' ? `${w.bucket.replace(/^codex_/, '')} ${windowLabel}` : windowLabel;
          return this.formatBucket(label, w);
        })
        .filter(Boolean);
      if (buckets.length) {
        parts.push(`CX ${buckets.join(' ')}${codex.stale ? '?' : ''}`);
        tips.push('Codex plan usage:');
        for (const w of codex.windows) {
          if (w.resetsAt) tips.push(`  ${w.bucket || w.name} (${w.window}): ${w.usedPercentage}% used, resets ${new Date(w.resetsAt * 1000).toLocaleString()}`);
        }
      }
    }
    if (!parts.length) {
      this.el.style.display = 'none';
      return;
    }
    this.el.style.display = '';
    this.el.textContent = `⏱ ${parts.join(' · ')}`;
    this.el.title = tips.join('\n');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.usageLimitsWidget = new UsageLimitsWidget();
});
