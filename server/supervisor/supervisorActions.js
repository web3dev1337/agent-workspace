const SUBMIT_DELAY_MS = 400;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Agent CLIs treat a single "text\r" chunk as a bracketed paste — the text
 * lands in the composer but is never submitted. Text and Enter must be
 * separate writes, which is the same rule the spawn and pager paths follow.
 */
async function submitText(sessionManager, sessionId, text, { delayMs = SUBMIT_DELAY_MS } = {}) {
  const wrote = sessionManager?.writeToSession?.(sessionId, text);
  if (!wrote) return false;
  await sleep(delayMs);
  return Boolean(sessionManager?.writeToSession?.(sessionId, '\r'));
}

/**
 * Decide whether a pending permission prompt is safe to approve without a human.
 *
 * Fails closed on every ambiguity: no allow-pattern match, any deny-pattern
 * match, or an unreadable prompt all mean "ask the human".
 */
function classifyPermissionPrompt(tail, safety) {
  const text = String(tail || '');
  const window = text.slice(-1200);

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

function buildActHandlers({ sessionManager, gitHelper, agentManager, logger = console }) {
  return {
    /**
     * Approve a permission prompt only when it is unambiguously read-only.
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
     * Outward-facing: creates a real PR. No shipped rule selects this handler —
     * it exists for opt-in autopilot configurations.
     */
    'open-pull-request': async ({ finding, signal }) => {
      if (!signal?.cwd || !signal?.branch) {
        return { performed: false, escalate: true, detail: 'no worktree path or branch to open a PR from' };
      }
      try {
        await gitHelper?.execGh?.(['pr', 'create', '--fill', '--head', signal.branch], { cwd: signal.cwd, timeout: 30_000 });
        return { performed: true, detail: `opened a PR for ${signal.branch}` };
      } catch (error) {
        logger.warn('Supervisor could not open a pull request', { sessionId: finding.sessionId, error: error.message });
        return { performed: false, escalate: true, detail: `gh pr create failed: ${error.message}` };
      }
    }
  };
}

/**
 * Executes one finding at its effective rung.
 *
 * Rungs are cumulative in intent but not in effect: a `nudge` notifies and
 * types, an `act` notifies and runs its handler. `observe` deliberately does
 * nothing outward, which is what makes it safe to leave running for a week.
 */
function createExecutor({
  sessionManager,
  gitHelper,
  agentManager,
  activityFeed,
  notificationService,
  speechService,
  logger = console
} = {}) {
  const actHandlers = buildActHandlers({ sessionManager, gitHelper, agentManager, logger });

  const announce = (finding, detail) => {
    try {
      activityFeed?.track?.('supervisor.finding', {
        sessionId: finding.sessionId,
        conditionId: finding.conditionId,
        severity: finding.severity,
        label: finding.label,
        rung: finding.rung,
        detail
      });
    } catch (error) {
      logger.warn('Supervisor could not record activity', { error: error.message });
    }

    try {
      notificationService?.notify?.(
        finding.sessionId,
        finding.severity === 'critical' ? 'error' : 'warning',
        `${finding.label} — ${finding.worktreeId || finding.sessionId}`,
        { conditionId: finding.conditionId, advice: finding.advice }
      );
    } catch (error) {
      logger.warn('Supervisor could not send a notification', { error: error.message });
    }

    if (finding.severity === 'critical') {
      try {
        speechService?.speak?.(`${finding.label} on ${finding.worktreeId || finding.sessionId}`, { priority: 'high' });
      } catch (error) {
        logger.warn('Supervisor could not speak', { error: error.message });
      }
    }
  };

  return async function execute({ finding, signal, rules }) {
    if (!finding.rung || finding.rung === 'observe') {
      return { ...finding, performed: false, outcome: 'observed' };
    }

    announce(finding, finding.advice);

    if (finding.rung === 'notify') {
      return { ...finding, performed: true, outcome: 'notified' };
    }

    if (finding.rung === 'nudge') {
      const text = finding.nudgeText;
      if (!text) return { ...finding, performed: false, outcome: 'nudge-skipped', detail: 'no nudge text configured' };
      const submitted = await submitText(sessionManager, finding.sessionId, text);
      return { ...finding, performed: submitted, outcome: submitted ? 'nudged' : 'nudge-failed' };
    }

    const handlerId = finding.actHandler;
    if (!handlerId) {
      return { ...finding, performed: false, outcome: 'act-skipped', detail: 'no act handler configured' };
    }
    if (!(rules?.safety?.allowedActHandlers || []).includes(handlerId)) {
      return { ...finding, performed: false, outcome: 'act-blocked', detail: `handler "${handlerId}" is not in allowedActHandlers` };
    }
    const handler = actHandlers[handlerId];
    if (!handler) {
      return { ...finding, performed: false, outcome: 'act-blocked', detail: `unknown handler "${handlerId}"` };
    }

    const result = await handler({ finding, signal, rules });
    if (!result.performed && result.escalate) {
      announce({ ...finding, severity: 'critical' }, result.detail);
      return { ...finding, performed: false, outcome: 'escalated', detail: result.detail };
    }
    return { ...finding, performed: result.performed, outcome: result.performed ? 'acted' : 'act-failed', detail: result.detail };
  };
}

module.exports = {
  SUBMIT_DELAY_MS,
  submitText,
  classifyPermissionPrompt,
  buildActHandlers,
  createExecutor
};
