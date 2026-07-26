const TAIL_CHARS = 4000;
const SUPERVISED_TYPES = new Set(['claude', 'codex']);

function stripControlSequences(text) {
  return String(text || '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[()][A-Za-z0-9]/g, '');
}

function lastNonEmptyLines(text, count) {
  const lines = String(text || '').split('\n');
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < count; i -= 1) {
    const line = lines[i].replace(/\r/g, '').trim();
    if (line) out.push(line);
  }
  return out;
}

/**
 * How many times the most-repeated line appears in the tail. A high count is
 * the cheapest reliable "this agent is looping" signal there is.
 */
function maxLineRepeat(text, { window = 40, minLength = 12 } = {}) {
  const counts = new Map();
  let max = 0;
  for (const line of lastNonEmptyLines(text, window)) {
    if (line.length < minLength) continue;
    const next = (counts.get(line) || 0) + 1;
    counts.set(line, next);
    if (next > max) max = next;
  }
  return max;
}

/**
 * Tracks per-session buffer growth so "quiet for N seconds" is measurable
 * without touching the PTY or asking the agent anything.
 */
class QuietTracker {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.state = new Map();
  }

  observe(sessionId, bufferLength) {
    const at = this.now();
    const previous = this.state.get(sessionId);

    if (!previous) {
      this.state.set(sessionId, { bufferLength, lastGrowthAt: at, firstSeenAt: at });
      return 0;
    }
    if (bufferLength !== previous.bufferLength) {
      previous.bufferLength = bufferLength;
      previous.lastGrowthAt = at;
      return 0;
    }
    return Math.max(0, Math.round((at - previous.lastGrowthAt) / 1000));
  }

  forget(sessionId) {
    this.state.delete(sessionId);
  }

  prune(liveSessionIds) {
    const live = new Set(liveSessionIds);
    for (const id of [...this.state.keys()]) {
      if (!live.has(id)) this.state.delete(id);
    }
  }
}

function listSupervisedSessions(sessionManager) {
  const out = [];
  const addMap = (map) => {
    if (!(map instanceof Map)) return;
    for (const [id, session] of map.entries()) {
      if (!id || !session) continue;
      if (!SUPERVISED_TYPES.has(String(session.type || '').toLowerCase())) continue;
      if (out.some((existing) => existing.id === id)) continue;
      out.push({ id, session });
    }
  };

  addMap(sessionManager?.sessions);
  const byWorkspace = sessionManager?.workspaceSessionMaps;
  if (byWorkspace instanceof Map) {
    for (const map of byWorkspace.values()) addMap(map);
  }
  return out;
}

async function countCommits(gitHelper, cwd, range) {
  try {
    const { stdout } = await gitHelper.execGit(['rev-list', '--count', range], { cwd, timeout: 5000 });
    const count = Number(String(stdout || '').trim());
    return Number.isFinite(count) ? count : null;
  } catch {
    return null;
  }
}

/**
 * How much work has not left this machine.
 *
 * With an upstream that is `@{upstream}..HEAD`. Without one — a branch that was
 * never pushed at all — every commit since the default branch counts, which is
 * the case that most deserves a nudge.
 */
async function countUnpushedCommits(gitHelper, cwd) {
  const againstUpstream = await countCommits(gitHelper, cwd, '@{upstream}..HEAD');
  if (againstUpstream !== null) return { ahead: againstUpstream, hasUpstream: true };

  const defaultBranch = await gitHelper.getDefaultBranch?.(cwd).catch(() => null);
  if (!defaultBranch) return { ahead: null, hasUpstream: false };

  const againstDefault = await countCommits(gitHelper, cwd, `${defaultBranch}..HEAD`);
  return { ahead: againstDefault, hasUpstream: false };
}

/**
 * Git state is the expensive signal, so it is only collected for sessions that
 * have gone quiet — a busy agent's working tree is a moving target anyway.
 */
async function collectGitState(gitHelper, cwd) {
  if (!gitHelper || !cwd) return null;
  try {
    const status = await gitHelper.getStatus(cwd);
    if (!status) return null;
    const { ahead, hasUpstream } = await countUnpushedCommits(gitHelper, cwd);
    return {
      dirty: status.clean === false,
      changedFiles: Number(status.total || 0),
      ahead: ahead === null ? 0 : ahead,
      aheadKnown: ahead !== null,
      hasUpstream
    };
  } catch {
    return null;
  }
}

/**
 * Prefer facts over inference.
 *
 * When a structured source (the Codex app-server) knows a thread's state, it
 * replaces the scraped guess: `waiting` because the thread said it is waiting on
 * an approval beats `waiting` because a regex matched some prose. Quiet time
 * stays PTY-derived where the PTY is the thing actually being watched, and the
 * scraped tail is kept either way so tail-matching rules still work.
 */
function applyStructuredSignal(signal, structured) {
  if (!structured) return signal;

  return {
    ...signal,
    signalSource: structured.source || 'app-server',
    status: structured.status && structured.status !== 'unknown' ? structured.status : signal.status,
    quietSeconds: Number.isFinite(structured.quietSeconds) ? structured.quietSeconds : signal.quietSeconds,
    awaitingApproval: structured.awaitingApproval === true,
    awaitingUserInput: structured.awaitingUserInput === true,
    activeFlags: structured.activeFlags || [],
    tokenUsage: structured.tokenUsage || null,
    rateLimits: structured.rateLimits || null,
    lastTurnStatus: structured.lastTurnStatus || null,
    lastTurnError: structured.lastTurnError || null,
    structuredError: structured.lastError || null,
    threadId: structured.threadId || null
  };
}

async function gatherSignals({
  sessionManager,
  gitHelper,
  sessionRecoveryService,
  taskRecordService,
  quietTracker,
  structuredSource = null,
  gitQuietThresholdSeconds = 120
} = {}) {
  const supervised = listSupervisedSessions(sessionManager);
  quietTracker?.prune(supervised.map(({ id }) => id));

  const signals = [];
  for (const { id, session } of supervised) {
    const buffer = String(session.buffer || '');
    const quietSeconds = quietTracker ? quietTracker.observe(id, buffer.length) : 0;
    const tail = stripControlSequences(buffer.slice(-TAIL_CHARS));

    const workspaceId = String(session.workspace || '').trim();
    const recovery = workspaceId ? sessionRecoveryService?.getSession?.(workspaceId, id) : null;
    const agentPresent = recovery ? recovery.lastAgentActive !== false : true;

    const cwd = sessionManager?.getSessionCwd?.(session) || recovery?.lastCwd || null;
    const git = quietSeconds >= gitQuietThresholdSeconds
      ? await collectGitState(gitHelper, cwd)
      : null;

    const record = taskRecordService?.get?.(`session:${id}`) || null;

    const base = {
      sessionId: id,
      signalSource: 'pty',
      type: String(session.type || '').toLowerCase(),
      status: String(session.status || 'idle').toLowerCase(),
      agent: recovery?.lastAgent || (session.type === 'codex' ? 'codex' : null),
      agentPresent,
      workspaceId,
      worktreeId: session.worktreeId || null,
      repositoryName: session.repositoryName || null,
      branch: session.branch || null,
      cwd,
      quietSeconds,
      tail,
      lastLine: lastNonEmptyLines(tail, 1)[0] || '',
      repeatedLineCount: maxLineRepeat(tail),
      git,
      tier: Number(record?.tier) || null,
      ticketTitle: record?.ticketTitle || null
    };

    signals.push(applyStructuredSignal(base, structuredSource?.getSignalForSession?.(session) || null));
  }

  return signals;
}

module.exports = {
  TAIL_CHARS,
  SUPERVISED_TYPES,
  QuietTracker,
  stripControlSequences,
  lastNonEmptyLines,
  maxLineRepeat,
  listSupervisedSessions,
  applyStructuredSignal,
  countUnpushedCommits,
  collectGitState,
  gatherSignals
};
