const SUBMIT_DELAY_MS = 400;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Agent CLIs treat a single "text\r" chunk as a bracketed paste — the text
 * lands in the composer but is never submitted. Text and Enter must be
 * separate writes, which is the same rule the spawn and pager paths follow.
 */
async function submitText(sessionManager, sessionId, text, { delayMs = SUBMIT_DELAY_MS } = {}) {
  const wrote = sessionManager?.writeToSession?.(sessionId, text);
  if (wrote === false) return false;
  await sleep(delayMs);
  return sessionManager?.writeToSession?.(sessionId, '\r') !== false;
}

/**
 * Decide whether a pending permission prompt is safe to approve without a human.
 *
 * Fails closed on every ambiguity: no allow-pattern match, any deny-pattern
 * match, or an unreadable prompt all mean "ask the human".
 */
function classifyPermissionPrompt(tail, safety) {
  const window = String(tail || '').slice(-1200);

  for (const pattern of safety?.permissionDenyPatterns || []) {
    if (pattern.test(window)) {
      return { safe: false, reason: `matched deny pattern ${pattern}` };
    }
  }

  const allowed = (safety?.permissionAllowPatterns || []).find((pattern) => pattern.test(window));
  if (!allowed) {
    return { safe: false, reason: 'no allow pattern matched — treating as unknown' };
  }

  return { safe: true, reason: `matched allow pattern ${allowed}` };
}

/**
 * Usage-limit banners carry their own reset time. Parsing it is what turns
 * "blocked for hours" into something that resumes itself.
 */
function parseResetTime(tail, now = new Date()) {
  const match = String(tail || '').match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = (match[3] || '').toLowerCase();
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (!Number.isFinite(hour) || hour > 23) return null;

  const resetAt = new Date(now);
  resetAt.setHours(hour, minute, 0, 0);
  if (resetAt <= now) resetAt.setDate(resetAt.getDate() + 1);
  return resetAt;
}

function buildProblemBrief(finding, signal) {
  const tail = String(signal?.tail || '').split('\n').slice(-25).join('\n');
  return [
    `[JARVIS] ${finding.label} on ${finding.worktreeId || finding.sessionId}.`,
    finding.advice,
    finding.branch ? `Branch: ${finding.branch}` : '',
    finding.ticketTitle ? `Task: ${finding.ticketTitle}` : '',
    finding.tier ? `Tier: T${finding.tier}` : '',
    `Session: ${finding.sessionId} (${finding.status}, quiet ${finding.quietSeconds}s)`,
    '',
    'Last output:',
    tail,
    '',
    'Diagnose and fix it yourself using the orchestrator API. Do not ask me unless you are genuinely blocked on a decision only I can make.'
  ].filter(Boolean).join('\n');
}

function buildHandlers({ sessionManager, gitHelper, agentManager, commanderSender, scheduleResume, logger = console }) {
  return {
    /**
     * Type an instruction into the session and let the agent fix its own problem.
     */
    nudge: async ({ finding, plan }) => {
      const text = plan.text || finding.advice;
      if (!text) return { performed: false, detail: 'no nudge text configured' };
      const submitted = await submitText(sessionManager, finding.sessionId, text);
      return { performed: submitted, detail: submitted ? 'nudged the session' : 'write failed' };
    },

    /**
     * Approve a permission prompt only when it is unambiguously safe.
     */
    'answer-permission': async ({ finding, signal, rules }) => {
      const verdict = classifyPermissionPrompt(signal?.tail, rules?.safety);
      if (!verdict.safe) {
        return { performed: false, escalate: true, detail: `refused to auto-answer: ${verdict.reason}` };
      }
      const submitted = await submitText(sessionManager, finding.sessionId, '1');
      return { performed: submitted, detail: submitted ? `approved (${verdict.reason})` : 'write failed' };
    },

    /**
     * Bring a dead agent terminal back up in the same worktree.
     */
    'relaunch-agent': async ({ finding, signal }) => {
      const agentId = signal?.agent || (signal?.type === 'codex' ? 'codex' : 'claude');
      let command = '';
      try {
        command = agentManager?.buildCommand?.(agentId, 'resume') || '';
      } catch {
        command = '';
      }
      if (!command) {
        return { performed: false, escalate: true, detail: `no resume command registered for agent "${agentId}"` };
      }
      const submitted = await submitText(sessionManager, finding.sessionId, command);
      return { performed: submitted, detail: submitted ? `relaunched ${agentId}` : 'write failed' };
    },

    /**
     * A usage limit is not a problem to report — it is a wait to schedule.
     */
    'schedule-resume': async ({ finding, signal }) => {
      const resetAt = parseResetTime(signal?.tail);
      if (!resetAt) {
        return { performed: true, detail: 'usage limit hit; no reset time in the banner, will retry on the next tick' };
      }
      try {
        scheduleResume?.({ sessionId: finding.sessionId, at: resetAt });
      } catch (error) {
        logger.warn?.('Could not schedule a resume', { error: error.message });
      }
      return { performed: true, detail: `resume queued for ${resetAt.toISOString()}`, resumeAt: resetAt.toISOString() };
    },

    'commit-and-push': async ({ finding }) => {
      const submitted = await submitText(
        sessionManager,
        finding.sessionId,
        'Commit your outstanding work with a descriptive message and push the branch.'
      );
      return { performed: submitted, detail: submitted ? 'asked the agent to commit and push' : 'write failed' };
    },

    /**
     * Outward-facing: creates a real PR. Opt-in only.
     */
    'open-pull-request': async ({ finding, signal }) => {
      if (!signal?.cwd || !signal?.branch) {
        return { performed: false, escalate: true, detail: 'no worktree path or branch to open a PR from' };
      }
      try {
        await gitHelper?.execGh?.(['pr', 'create', '--fill', '--head', signal.branch], { cwd: signal.cwd, timeout: 30_000 });
        return { performed: true, detail: `opened a PR for ${signal.branch}` };
      } catch (error) {
        return { performed: false, escalate: true, detail: `gh pr create failed: ${error.message}` };
      }
    },

    /**
     * The tier that exists so you do not have to be the next step.
     *
     * Rules are cheap and dumb; the Commander is a full agent with the whole
     * orchestrator API. When a rule cannot fix something, handing it a written
     * problem brief is strictly better than handing it to you — and it only
     * spends tokens when something is actually wrong.
     */
    'delegate-to-commander': async ({ finding, signal }) => {
      if (!commanderSender) {
        return { performed: false, escalate: true, detail: 'no Commander available to delegate to' };
      }
      try {
        const delivered = await commanderSender(buildProblemBrief(finding, signal));
        return delivered
          ? { performed: true, detail: 'handed the problem to the Commander' }
          : { performed: false, escalate: true, detail: 'Commander did not accept the brief' };
      } catch (error) {
        return { performed: false, escalate: true, detail: `delegation failed: ${error.message}` };
      }
    }
  };
}

/**
 * Carries out the planned intent for one finding.
 *
 * `interrupt` deliberately does not appear here — reaching a human is the
 * supervisor's decision to make with the interruption budget, not an action a
 * handler performs.
 */
function createExecutor({
  sessionManager,
  gitHelper,
  agentManager,
  commanderSender,
  scheduleResume,
  activityFeed,
  logger = console
} = {}) {
  const handlers = buildHandlers({ sessionManager, gitHelper, agentManager, commanderSender, scheduleResume, logger });

  const record = (finding, plan, result) => {
    try {
      activityFeed?.track?.('supervisor.action', {
        sessionId: finding.sessionId,
        conditionId: finding.conditionId,
        intent: plan.intent,
        handler: plan.handler || null,
        performed: result.performed,
        detail: result.detail
      });
    } catch (error) {
      logger.warn?.('Supervisor could not record activity', { error: error.message });
    }
  };

  return async function execute({ finding, plan, signal, rules }) {
    if (plan.intent === 'none' || plan.intent === 'observe') {
      return { performed: false, outcome: 'observed', detail: plan.reason };
    }

    const handlerId = plan.handler;
    if (!handlerId) return { performed: false, outcome: 'skipped', detail: 'no handler configured' };
    if (!(rules?.safety?.allowedHandlers || []).includes(handlerId)) {
      return { performed: false, outcome: 'blocked', detail: `handler "${handlerId}" is not in allowedHandlers` };
    }
    const handler = handlers[handlerId];
    if (!handler) return { performed: false, outcome: 'blocked', detail: `unknown handler "${handlerId}"` };

    const result = await handler({ finding, plan, signal, rules });
    record(finding, plan, result);

    if (!result.performed) {
      return {
        performed: false,
        outcome: result.escalate ? 'repair-failed' : 'skipped',
        detail: result.detail,
        escalate: result.escalate === true
      };
    }

    return {
      performed: true,
      outcome: plan.intent === 'delegate' ? 'delegated' : 'resolved',
      detail: result.detail,
      resumeAt: result.resumeAt
    };
  };
}

module.exports = {
  SUBMIT_DELAY_MS,
  submitText,
  classifyPermissionPrompt,
  parseResetTime,
  buildProblemBrief,
  buildHandlers,
  createExecutor
};
