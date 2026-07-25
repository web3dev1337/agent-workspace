const fs = require('fs');
const path = require('path');

const { getAgentWorkspaceDir } = require('../utils/pathUtils');

const RUNGS = ['observe', 'notify', 'nudge', 'act'];
const SEVERITIES = ['info', 'warn', 'critical'];
const AUTONOMY_LEVELS = ['off', 'observe', 'assist', 'autopilot'];

// How far each autonomy level is allowed to climb the ladder.
const AUTONOMY_CEILING = {
  off: null,
  observe: 'observe',
  assist: 'nudge',
  autopilot: 'act'
};

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

function normalizeCondition(raw) {
  const id = String(raw?.id || '').trim();
  if (!id) return null;

  const when = raw?.when || {};
  const rung = RUNGS.includes(raw?.rung) ? raw.rung : 'observe';

  return {
    id,
    label: String(raw?.label || id),
    severity: SEVERITIES.includes(raw?.severity) ? raw.severity : 'info',
    rung,
    cooldownSeconds: Math.max(0, Number(raw?.cooldownSeconds) || 0),
    advice: String(raw?.advice || ''),
    nudgeText: String(raw?.nudgeText || '').trim(),
    actHandler: String(raw?.actHandler || '').trim(),
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
  const raw = readJson(override) || readJson(DEFAULT_RULES_PATH) || {};
  const source = readJson(override) ? override : DEFAULT_RULES_PATH;

  const safety = raw.safety || {};
  return {
    source,
    autonomy: AUTONOMY_LEVELS.includes(raw.autonomy) ? raw.autonomy : 'observe',
    tickSeconds: Math.max(5, Number(raw.tickSeconds) || 30),
    maxFindingsRetained: Math.max(20, Number(raw.maxFindingsRetained) || 500),
    safety: {
      allowedActHandlers: Array.isArray(safety.allowedActHandlers) ? safety.allowedActHandlers.map(String) : [],
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

function rungIndex(rung) {
  const index = RUNGS.indexOf(rung);
  return index === -1 ? 0 : index;
}

/**
 * The rung a finding may actually reach, given how much autonomy it has been
 * granted. Findings above the ceiling are recorded, not acted on.
 */
function effectiveRung(conditionRung, autonomy) {
  const ceiling = AUTONOMY_CEILING[autonomy];
  if (!ceiling) return null;
  return rungIndex(conditionRung) <= rungIndex(ceiling) ? conditionRung : ceiling;
}

function buildFinding(condition, signal, autonomy) {
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
    status: signal.status,
    quietSeconds: signal.quietSeconds,
    advice: condition.advice,
    requestedRung: condition.rung,
    rung: effectiveRung(condition.rung, autonomy),
    suppressedByAutonomy: rungIndex(condition.rung) > rungIndex(AUTONOMY_CEILING[autonomy] || 'observe'),
    nudgeText: condition.nudgeText,
    actHandler: condition.actHandler,
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
      findings.push(buildFinding(condition, signal, rules.autonomy));
      break;
    }
  }
  return findings;
}

module.exports = {
  RUNGS,
  SEVERITIES,
  AUTONOMY_LEVELS,
  AUTONOMY_CEILING,
  DEFAULT_RULES_PATH,
  overrideRulesPath,
  loadRules,
  normalizeCondition,
  matches,
  effectiveRung,
  evaluate
};
