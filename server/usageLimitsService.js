const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/usage-limits.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

// Claude values are tapped into this file by the user's Claude Code status
// line on every refresh, so they're fresh whenever any Claude session is open.
const CLAUDE_LIVE_FILE = path.join(os.homedir(), '.local', 'state', 'ai-usage-monitor', 'claude-live.json');
// Values older than this are shown as stale rather than hidden — a limit
// percentage from an hour ago still beats nothing.
const CLAUDE_STALE_AFTER_MS = 60 * 60 * 1000;

const CODEX_HELPER = process.env.CODEX_USAGE_HELPER
  || path.join(os.homedir(), '.codex', 'scripts', 'codex_usage.py');
// The Codex helper starts a local app-server round trip (~seconds), so cache.
const CODEX_CACHE_TTL_MS = 5 * 60 * 1000;
const CODEX_TIMEOUT_MS = 60 * 1000;

class UsageLimitsService {
  constructor() {
    this.codexCache = null; // { at, data }
    this.codexInFlight = null;
  }

  static getInstance() {
    if (!UsageLimitsService.instance) {
      UsageLimitsService.instance = new UsageLimitsService();
    }
    return UsageLimitsService.instance;
  }

  readClaudeLimits() {
    try {
      const raw = JSON.parse(fs.readFileSync(CLAUDE_LIVE_FILE, 'utf8'));
      const limits = raw?.rate_limits || {};
      const updatedAt = Number(raw?.updated_at) || null;
      const bucket = (b) => {
        if (!b || typeof b !== 'object') return null;
        const pct = Number(b.used_percentage);
        const resets = Number(b.resets_at);
        return {
          usedPercentage: Number.isFinite(pct) ? Math.round(pct) : null,
          resetsAt: Number.isFinite(resets) ? resets : null
        };
      };
      return {
        available: true,
        updatedAt,
        stale: updatedAt ? (Date.now() - updatedAt * 1000) > CLAUDE_STALE_AFTER_MS : true,
        fiveHour: bucket(limits.five_hour),
        sevenDay: bucket(limits.seven_day)
      };
    } catch {
      return { available: false };
    }
  }

  // Helper output lines look like:
  //   "  primary (1 week): 9% used; resets Thu 20 Aug 2026 13:32:22 AEST"
  // possibly for several buckets, preceded by bucket headers and (sometimes)
  // drift warnings. Parse defensively; anything unparseable is skipped.
  parseCodexOutput(text) {
    const windows = [];
    let bucket = null;
    for (const line of String(text || '').split('\n')) {
      const header = line.match(/^(\S+)\s+\[([^\]]+)\]\s*$/);
      if (header) {
        bucket = header[1];
        continue;
      }
      const m = line.match(/^\s*(\w+)\s*\(([^)]+)\):\s*(\d+)%\s*used;\s*resets\s+(.+?)\s*$/);
      if (!m) continue;
      const [, name, windowLabel, pct, resetText] = m;
      // The timezone abbreviation (AEST etc.) isn't parseable by Date, but the
      // helper runs on this machine, so the timestamp is in server-local time.
      const parsed = Date.parse(resetText.replace(/\s+[A-Z]{2,5}$/, ''));
      windows.push({
        bucket,
        name,
        window: windowLabel,
        usedPercentage: Number(pct),
        resetsAt: Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null
      });
    }
    return windows;
  }

  fetchCodexLimits() {
    if (this.codexInFlight) return this.codexInFlight;
    this.codexInFlight = new Promise((resolve) => {
      if (!fs.existsSync(CODEX_HELPER)) {
        resolve({ available: false, reason: 'helper-missing' });
        return;
      }
      execFile('python3', [CODEX_HELPER], { timeout: CODEX_TIMEOUT_MS, windowsHide: true }, (error, stdout, stderr) => {
        if (error) {
          logger.warn('codex usage helper failed', { error: error.message, stderr: String(stderr || '').slice(0, 500) });
          resolve({ available: false, reason: 'helper-failed' });
          return;
        }
        const windows = this.parseCodexOutput(`${stdout}\n${stderr}`);
        resolve({ available: windows.length > 0, updatedAt: Math.floor(Date.now() / 1000), windows });
      });
    }).then((data) => {
      if (data.available) this.codexCache = { at: Date.now(), data };
      return data;
    }).finally(() => {
      this.codexInFlight = null;
    });
    return this.codexInFlight;
  }

  async getLimits({ refresh = false } = {}) {
    const claude = this.readClaudeLimits();
    let codex;
    if (!refresh && this.codexCache && Date.now() - this.codexCache.at < CODEX_CACHE_TTL_MS) {
      codex = this.codexCache.data;
    } else {
      codex = await this.fetchCodexLimits();
      if (!codex.available && this.codexCache) {
        codex = { ...this.codexCache.data, stale: true };
      }
    }
    return { claude, codex };
  }
}

module.exports = { UsageLimitsService };
