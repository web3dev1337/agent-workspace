const DEFAULT_INTERRUPTION = {
  threshold: 60,
  alwaysInterruptAbove: 90,
  maxPerHour: 2,
  minSecondsBetween: 900,
  digestIntervalMinutes: 120,
  quietHours: { enabled: false, startHour: 22, endHour: 7 },
  tierWeights: { 1: 1.5, 2: 1.15, 3: 0.6, 4: 0.35, none: 0.8 },
  severityBase: { info: 10, warn: 40, critical: 80 }
};

/**
 * `Number(null)` and `Number('')` are both 0, which `Number.isFinite` happily
 * accepts — so "not configured" silently becomes "zero" unless it is checked
 * explicitly. Every numeric option here goes through this.
 */
function numberOrNull(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function numberOr(value, fallback) {
  const num = numberOrNull(value);
  return num === null ? fallback : num;
}

function normalizeInterruptionPolicy(raw = {}) {
  const quiet = raw.quietHours || {};
  return {
    threshold: numberOr(raw.threshold, DEFAULT_INTERRUPTION.threshold),
    alwaysInterruptAbove: numberOr(raw.alwaysInterruptAbove, DEFAULT_INTERRUPTION.alwaysInterruptAbove),
    maxPerHour: Math.max(0, numberOr(raw.maxPerHour, DEFAULT_INTERRUPTION.maxPerHour)),
    minSecondsBetween: Math.max(0, numberOr(raw.minSecondsBetween, DEFAULT_INTERRUPTION.minSecondsBetween)),
    digestIntervalMinutes: Math.max(1, numberOr(raw.digestIntervalMinutes, DEFAULT_INTERRUPTION.digestIntervalMinutes)),
    quietHours: {
      enabled: quiet.enabled === true,
      startHour: numberOr(quiet.startHour, DEFAULT_INTERRUPTION.quietHours.startHour),
      endHour: numberOr(quiet.endHour, DEFAULT_INTERRUPTION.quietHours.endHour)
    },
    tierWeights: { ...DEFAULT_INTERRUPTION.tierWeights, ...(raw.tierWeights || {}) },
    severityBase: { ...DEFAULT_INTERRUPTION.severityBase, ...(raw.severityBase || {}) }
  };
}

/**
 * How much this finding deserves to cost you a context switch.
 *
 * The tier weight is what stops background work from ever pulling you out of
 * flow: the same stall on a T1 task you are actively working and a T3 task
 * running in the background are not the same event, and treating them the same
 * is how notification systems become noise you learn to ignore.
 *
 * Failed self-heals raise the score, because "I tried three times and it is
 * still stuck" is genuinely different information from "this just happened".
 */
function scoreUrgency(finding, { policy, attempts = 0, condition = {} } = {}) {
  const config = policy || DEFAULT_INTERRUPTION;
  const urgency = condition.urgency || {};

  const base = numberOr(urgency.base, config.severityBase[finding.severity] ?? 10);

  const tier = numberOrNull(finding.tier);
  const tierKey = tier === null ? 'none' : String(Math.round(tier));
  const tierWeight = numberOr(config.tierWeights[tierKey], numberOr(config.tierWeights.none, 1));

  let score = base * tierWeight;
  if (urgency.blocksWork) score += 20;

  // Every failed attempt to fix it adds weight; nothing else in the system
  // knows that a problem has resisted repair.
  score += Math.min(numberOr(attempts, 0), 5) * 12;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function isQuietHour(policy, date) {
  const quiet = policy?.quietHours;
  if (!quiet?.enabled) return false;
  const hour = date.getHours();
  const { startHour, endHour } = quiet;
  return startHour <= endHour
    ? hour >= startHour && hour < endHour
    : hour >= startHour || hour < endHour;
}

/**
 * Rate-limits how often the supervisor is allowed to break your concentration.
 *
 * Anything refused here is not dropped — it goes to the digest, which is the
 * whole trade: one batched interruption instead of twelve individual ones.
 */
class InterruptionBudget {
  constructor({ policy, now = () => Date.now() } = {}) {
    this.policy = normalizeInterruptionPolicy(policy);
    this.now = now;
    this.recent = [];
  }

  setPolicy(policy) {
    this.policy = normalizeInterruptionPolicy(policy);
  }

  prune() {
    const cutoff = this.now() - 3_600_000;
    this.recent = this.recent.filter((at) => at > cutoff);
  }

  evaluate(score) {
    this.prune();
    const { threshold, alwaysInterruptAbove, maxPerHour, minSecondsBetween } = this.policy;

    if (score < threshold) {
      return { allow: false, reason: `below interrupt threshold (${score} < ${threshold})` };
    }

    // A genuine emergency outranks quiet hours and the hourly budget. Everything
    // else respects them, which is what makes the budget trustworthy.
    const overrides = score >= alwaysInterruptAbove;
    if (overrides) return { allow: true, reason: `urgency ${score} overrides all limits` };

    if (isQuietHour(this.policy, new Date(this.now()))) {
      return { allow: false, reason: 'quiet hours' };
    }
    if (this.recent.length >= maxPerHour) {
      return { allow: false, reason: `hourly interruption budget spent (${maxPerHour}/hour)` };
    }
    const last = this.recent[this.recent.length - 1];
    if (last && (this.now() - last) / 1000 < minSecondsBetween) {
      return { allow: false, reason: `too soon after the last interruption (<${minSecondsBetween}s)` };
    }

    return { allow: true, reason: `urgency ${score} within budget` };
  }

  record() {
    this.recent.push(this.now());
    this.prune();
  }

  getState() {
    this.prune();
    return {
      usedThisHour: this.recent.length,
      maxPerHour: this.policy.maxPerHour,
      lastInterruptionAt: this.recent.length ? new Date(this.recent[this.recent.length - 1]).toISOString() : null,
      quietHoursActive: isQuietHour(this.policy, new Date(this.now())),
      policy: this.policy
    };
  }
}

/**
 * Everything that needed a human but did not earn an interruption. Delivered on
 * a timer or on demand ("what's happening?"), so the cost is one context switch
 * at a moment you chose.
 */
class DigestQueue {
  constructor({ now = () => Date.now(), maxEntries = 200 } = {}) {
    this.now = now;
    this.maxEntries = maxEntries;
    this.entries = new Map();
    this.lastDeliveredAt = now();
  }

  add(finding, { score, reason }) {
    const existing = this.entries.get(finding.id);
    if (existing) {
      existing.count += 1;
      existing.score = Math.max(existing.score, score);
      existing.lastSeenAt = new Date(this.now()).toISOString();
      return existing;
    }

    const entry = {
      id: finding.id,
      sessionId: finding.sessionId,
      where: finding.worktreeId || finding.sessionId,
      label: finding.label,
      severity: finding.severity,
      advice: finding.advice,
      tier: finding.tier,
      score,
      heldBecause: reason,
      count: 1,
      firstSeenAt: new Date(this.now()).toISOString(),
      lastSeenAt: new Date(this.now()).toISOString()
    };

    this.entries.set(finding.id, entry);
    if (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value);
    }
    return entry;
  }

  /**
   * A finding that self-healed after being queued should not still be waiting
   * to be mentioned — the whole point is to not report solved problems.
   */
  resolve(findingId) {
    return this.entries.delete(findingId);
  }

  pending() {
    return [...this.entries.values()].sort((a, b) => b.score - a.score);
  }

  isDue() {
    const intervalMs = 60_000 * (this.intervalMinutes || 120);
    return this.entries.size > 0 && this.now() - this.lastDeliveredAt >= intervalMs;
  }

  setInterval(minutes) {
    this.intervalMinutes = Math.max(1, Number(minutes) || 120);
  }

  drain() {
    const items = this.pending();
    this.entries.clear();
    this.lastDeliveredAt = this.now();
    return items;
  }
}

module.exports = {
  DEFAULT_INTERRUPTION,
  numberOrNull,
  normalizeInterruptionPolicy,
  scoreUrgency,
  isQuietHour,
  InterruptionBudget,
  DigestQueue
};
