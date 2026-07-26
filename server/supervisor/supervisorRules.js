const fs = require('fs');
const path = require('path');

const { getAgentWorkspaceDir } = require('../utils/pathUtils');
const { normalizeInterruptionPolicy } = require('./supervisorUrgency');

const SEVERITIES = ['info', 'warn', 'critical'];
const AUTONOMY_LEVELS = ['off', 'observe', 'assist', 'autopilot'];

// What each autonomy level is allowed to *do about* a finding. Interrupting a
// human is governed separately by the interruption policy — autonomy is about
// how much the supervisor may fix, not how much it may say.
const AUTONOMY_CAPABILITIES = {
  off: { resolve: false, delegate: false },
  observe: { resolve: false, delegate: false },
  assist: { resolve: true, delegate: false },
  autopilot: { resolve: true, delegate: true }
};

const DELEGATE_HANDLERS = new Set(['delegate-to-commander']);

const DEFAULT_RULES_PATH = path.join(__dirname, '..', '..', 'config', 'supervisor-rules.json');

function overrideRulesPath() {
  return path.join(getAgentWorkspaceDir(), 'supervisor-rules.json');
}

function compilePatterns(patterns) {
  const out = [];
  for (const pattern of Array.isArray(patterns) ? patterns : []) {
    try {
      out.push(new RegExp(String(pattern)));
    } catch {
      // A bad pattern must not take the whole supervisor down with it.
    }
  }
  return out;
}

function normalizeResolve(raw) {
  const handler = String(raw?.handler || '').trim();
  if (!handler) return null;
  return {
    handler,
    text: String(raw?.text || '').trim(),
    delegate: DELEGATE_HANDLERS.has(handler)
  };
}

function normalizeCondition(raw) {
  const id = String(raw?.id || '').trim();
  if (!id) return null;

  const when = raw?.when || {};
  const urgency = raw?.urgency || {};

  return {
    id,
    label: String(raw?.label || id),
    severity: SEVERITIES.includes(raw?.severity) ? raw.severity : 'info',
    cooldownSeconds: Math.max(0, Number(raw?.cooldownSeconds) || 0),
    // How many failed self-heals before this is allowed to reach a human at all.
    // A high number means "never bother me about this, just keep handling it".
    escalateAfterAttempts: Math.max(0, Number(raw?.escalateAfterAttempts ?? 2)),
    advice: String(raw?.advice || ''),
    resolve: normalizeResolve(raw?.resolve),
    urgency: {
      base: Number.isFinite(Number(urgency.base)) ? Number(urgency.base) : null,
      blocksWork: urgency.blocksWork === true
    },
    when: {
      status: (Array.isArray(when.status) ? when.status : []).map((s) => String(s).toLowerCase()),
      types: (Array.isArray(when.types) ? when.types : []).map((s) => String(s).toLowerCase()),
      tailMatches: compilePatterns(when.tailMatches),
      tailNotMatches: compilePatterns(when.tailNotMatches),
      minQuietSeconds: Number.isFinite(Number(when.minQuietSeconds)) ? Number(when.minQuietSeconds) : null,
      maxQuietSeconds: Number.isFinite(Number(when.maxQuietSeconds)) ? Number(when.maxQuietSeconds) : null,
      repeatedTailLine: Number.isFinite(Number(when.repeatedTailLine)) ? Number(when.repeatedTailLine) : null,
      agentPresent: typeof when.agentPresent === 'boolean' ? when.agentPresent : null,
      tiers: (Array.isArray(when.tiers) ? when.tiers : []).map(Number).filter(Number.isFinite),
      git: when.git && typeof when.git === 'object' ? {
        dirty: typeof when.git.dirty === 'boolean' ? when.git.dirty : null,
        aheadMin: Number.isFinite(Number(when.git.aheadMin)) ? Number(when.git.aheadMin) : null,
        aheadMax: Number.isFinite(Number(when.git.aheadMax)) ? Number(when.git.aheadMax) : null,
        hasUpstream: typeof when.git.hasUpstream === 'boolean' ? when.git.hasUpstream : null
      } : null
    }
  };
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Load the condition table. A machine-local override replaces the shipped
 * defaults wholesale — merging rule arrays produces surprises nobody wants
 * from something that types into terminals.
 */
function loadRules({ rulesPath = null } = {}) {
  const override = rulesPath || overrideRulesPath();
  const overrideRaw = readJson(override);
  const raw = overrideRaw || readJson(DEFAULT_RULES_PATH) || {};
  const source = overrideRaw ? override : DEFAULT_RULES_PATH;

  const safety = raw.safety || {};
  const envAutonomy = String(process.env.SUPERVISOR_AUTONOMY || '').trim().toLowerCase();
  const autonomy = AUTONOMY_LEVELS.includes(envAutonomy)
    ? envAutonomy
    : (AUTONOMY_LEVELS.includes(raw.autonomy) ? raw.autonomy : 'assist');

  return {
    source,
    autonomy,
    tickSeconds: Math.max(5, Number(raw.tickSeconds) || 30),
    maxFindingsRetained: Math.max(20, Number(raw.maxFindingsRetained) || 500),
    interruption: normalizeInterruptionPolicy(raw.interruption),
    safety: {
      allowedHandlers: Array.isArray(safety.allowedHandlers) ? safety.allowedHandlers.map(String) : [],
      permissionAllowPatterns: compilePatterns(safety.permissionAllowPatterns),
      permissionDenyPatterns: compilePatterns(safety.permissionDenyPatterns)
    },
    conditions: (Array.isArray(raw.conditions) ? raw.conditions : []).map(normalizeCondition).filter(Boolean)
  };
}

function gitMatches(rule, git) {
  if (!rule) return true;
  // A rule that asks about git cannot fire on a session we have no git read for.
  if (!git) return false;
  if (rule.dirty !== null && Boolean(git.dirty) !== rule.dirty) return false;
  if (rule.hasUpstream !== null && Boolean(git.hasUpstream) !== rule.hasUpstream) return false;
  if (rule.aheadMin !== null && !(Number(git.ahead || 0) >= rule.aheadMin)) return false;
  if (rule.aheadMax !== null && !(Number(git.ahead || 0) <= rule.aheadMax)) return false;
  return true;
}

function matches(condition, signal) {
  const when = condition.when;

  if (when.status.length && !when.status.includes(signal.status)) return false;
  if (when.types.length && !when.types.includes(signal.type)) return false;
  if (when.agentPresent !== null && Boolean(signal.agentPresent) !== when.agentPresent) return false;
  if (when.tiers.length && !when.tiers.includes(Number(signal.tier))) return false;
  if (when.minQuietSeconds !== null && signal.quietSeconds < when.minQuietSeconds) return false;
  if (when.maxQuietSeconds !== null && signal.quietSeconds > when.maxQuietSeconds) return false;
  if (when.repeatedTailLine !== null && Number(signal.repeatedLineCount || 0) < when.repeatedTailLine) return false;

  if (when.tailMatches.length && !when.tailMatches.some((re) => re.test(signal.tail))) return false;
  if (when.tailNotMatches.length && when.tailNotMatches.some((re) => re.test(signal.tail))) return false;

  if (!gitMatches(when.git, signal.git)) return false;

  return true;
}

function capabilities(autonomy) {
  return AUTONOMY_CAPABILITIES[autonomy] || AUTONOMY_CAPABILITIES.observe;
}

/**
 * What the supervisor intends to do about a finding, before the interruption
 * policy gets a say.
 *
 * The order matters and encodes the whole philosophy: try to fix it, then try
 * to have something smarter fix it, and only then consider spending a human's
 * attention. A condition that has not yet exhausted its repair attempts is not
 * eligible to interrupt at all.
 */
function planAction(condition, { autonomy, attempts = 0 }) {
  const can = capabilities(autonomy);
  const resolve = condition.resolve;
  const exhausted = attempts >= condition.escalateAfterAttempts;

  if (autonomy === 'off') return { intent: 'none', reason: 'autonomy off' };

  if (resolve && resolve.handler === 'observe') {
    return { intent: 'observe', reason: 'condition is informational only' };
  }

  if (resolve && !exhausted) {
    if (resolve.delegate) {
      if (can.delegate) return { intent: 'delegate', handler: resolve.handler, reason: 'handing the problem to the Commander' };
      if (can.resolve) return { intent: 'observe', reason: 'delegation needs autopilot' };
      return { intent: 'observe', reason: `autonomy "${autonomy}" may not act` };
    }
    if (can.resolve) {
      return { intent: 'resolve', handler: resolve.handler, text: resolve.text, reason: `self-heal attempt ${attempts + 1}` };
    }
    return { intent: 'observe', reason: `autonomy "${autonomy}" may not act` };
  }

  if (!resolve) {
    return exhausted || condition.escalateAfterAttempts === 0
      ? { intent: 'interrupt', reason: 'nothing can be done automatically' }
      : { intent: 'observe', reason: 'no resolve handler configured' };
  }

  return { intent: 'interrupt', reason: `self-heal failed ${attempts} time${attempts === 1 ? '' : 's'}` };
}

function buildFinding(condition, signal) {
  return {
    id: `${signal.sessionId}:${condition.id}`,
    conditionId: condition.id,
    label: condition.label,
    severity: condition.severity,
    sessionId: signal.sessionId,
    worktreeId: signal.worktreeId,
    repositoryName: signal.repositoryName,
    branch: signal.branch,
    tier: signal.tier,
    ticketTitle: signal.ticketTitle,
    status: signal.status,
    quietSeconds: signal.quietSeconds,
    advice: condition.advice,
    evidence: signal.lastLine,
    detectedAt: new Date().toISOString()
  };
}

/**
 * First matching condition wins per session — the table is ordered by urgency,
 * so a session at its usage limit is not also reported as merely "stalled".
 */
function evaluate(signals, rules) {
  const findings = [];
  if (rules.autonomy === 'off') return findings;

  for (const signal of signals) {
    for (const condition of rules.conditions) {
      if (!matches(condition, signal)) continue;
      findings.push(buildFinding(condition, signal));
      break;
    }
  }
  return findings;
}

module.exports = {
  SEVERITIES,
  AUTONOMY_LEVELS,
  AUTONOMY_CAPABILITIES,
  DEFAULT_RULES_PATH,
  overrideRulesPath,
  loadRules,
  normalizeCondition,
  matches,
  capabilities,
  planAction,
  evaluate
};
