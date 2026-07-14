'use strict';

// Shared helpers for spawning a one-shot agent (reviewer/fixer/workflow stage)
// into an idle worktree terminal. Used by prReviewAutomationService and
// reviewWorkflowService so the launch mechanics live in exactly one place.
// Agent-agnostic: flags and init delays resolve from the agentManager
// registry (built-ins + ~/.agent-workspace/custom-agents.json), so any
// registered CLI agent works here — the maps below are only fallbacks.

const AGENT_INIT_DELAY_MS = { claude: 8_000, codex: 15_000 };
const FALLBACK_SPAWN_FLAGS = { claude: ['skipPermissions'], codex: ['yolo'] };
const PROMPT_SUBMIT_DELAY_MS = 500;

// Find an idle/exited agent terminal in the active workspace whose worktree
// is not in `usedWorktreeIds`. Returns { worktreeId, repoName } or null.
const findAvailableWorktree = ({ workspaceManager, sessionManager, usedWorktreeIds = new Set() } = {}) => {
  if (!workspaceManager) return null;

  const activeWs = workspaceManager.getActiveWorkspace?.();
  const wsId = activeWs?.id;
  if (!wsId) return null;

  const workspace = workspaceManager.getWorkspaceById?.(wsId);
  if (!workspace) return null;

  const terminals = workspace.terminals || [];
  for (const terminal of terminals) {
    const worktreeId = terminal.worktreeId || terminal.worktree;
    if (!worktreeId) continue;
    if (usedWorktreeIds.has(worktreeId)) continue;

    const repoName = terminal.repository?.name || terminal.repositoryName || '';
    const claudeSessionId = `${repoName}-${worktreeId}-claude`;
    const session = sessionManager?.getSessionById?.(claudeSessionId);
    if (!session || session.status === 'exited' || session.status === 'idle') {
      return { worktreeId, repoName };
    }
  }

  return null;
};

// Start an agent in a session and send the prompt after the agent has had
// time to initialize. The prompt text and the submitting "\r" are separate
// writes — a trailing "\n" inside the same write is treated as pasted text
// by agent CLIs, not as submit.
const spawnAgentInSession = ({
  sessionManager,
  sessionId,
  agentId = 'claude',
  model = null,
  effort = null,
  mode = 'fresh',
  prompt = ''
} = {}) => {
  if (!sessionManager || !sessionId) return false;

  const agentManager = sessionManager.agentManager || null;
  const registryFlags = typeof agentManager?.getSpawnFlags === 'function'
    ? agentManager.getSpawnFlags(agentId)
    : null;

  const config = {
    agentId,
    mode,
    flags: (registryFlags && registryFlags.length)
      ? registryFlags
      : (FALLBACK_SPAWN_FLAGS[agentId] || [])
  };
  if (model) config.model = model;
  if (effort) config.reasoning = effort;

  const started = sessionManager.startAgentWithConfig(sessionId, config);
  if (!started) return false;

  const initDelay = typeof agentManager?.getInitDelayMs === 'function'
    ? agentManager.getInitDelayMs(agentId)
    : (AGENT_INIT_DELAY_MS[agentId] || AGENT_INIT_DELAY_MS.claude);
  const initTimer = setTimeout(() => {
    sessionManager.writeToSession(sessionId, prompt);
    const submitTimer = setTimeout(() => sessionManager.writeToSession(sessionId, '\r'), PROMPT_SUBMIT_DELAY_MS);
    if (typeof submitTimer?.unref === 'function') submitTimer.unref();
  }, initDelay);
  if (typeof initTimer?.unref === 'function') initTimer.unref();

  return true;
};

module.exports = {
  findAvailableWorktree,
  spawnAgentInSession,
  AGENT_INIT_DELAY_MS
};
