const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

/**
 * Multi-agent PR review chains.
 *
 * A chain is a configured sequence of reviewers (codex, claude) that each
 * examine a PR headlessly and emit a machine-readable verdict. approved ->
 * next reviewer; needs_fix -> the chain stops and the feedback goes back to
 * whoever should fix it (the Commander orchestrates that part). Verdicts and
 * timestamps land on the PR's task record, so the queue UI and the voice
 * layer both see chain state.
 *
 * Reviewers run as child processes, one at a time — deliberate: reviews are
 * expensive, and a serial chain gives each reviewer the previous verdicts.
 * Config: config/review-chains.json.
 */
class ReviewChainService {
  constructor({ logger = console, taskRecordService = null, speechService = null, activityFeed = null } = {}) {
    this.logger = logger;
    this.taskRecordService = taskRecordService;
    this.speechService = speechService;
    this.activityFeed = activityFeed;
    this.running = new Map();
  }

  static getInstance(options = {}) {
    if (!ReviewChainService.instance) {
      ReviewChainService.instance = new ReviewChainService(options);
    }
    return ReviewChainService.instance;
  }

  chains() {
    try {
      return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'review-chains.json'), 'utf8'));
    } catch {
      return {
        default: [
          { agent: 'codex', mode: 'review' },
          { agent: 'claude', model: 'sonnet', mode: 'review' }
        ]
      };
    }
  }

  speak(text) {
    try { this.speechService?.speak?.(text); } catch { /* voice optional */ }
  }

  track(event, data) {
    try { this.activityFeed?.track?.(event, data); } catch { /* feed optional */ }
    this.logger.info?.(`review-chain: ${event}`, data);
  }

  reviewPrompt(pr, repo, step, priorVerdicts) {
    const prior = priorVerdicts.length
      ? `\nPrior reviewers in this chain said:\n${priorVerdicts.map((v) => `- ${v.agent}: ${v.verdict}${v.summary ? ` (${v.summary})` : ''}`).join('\n')}\n`
      : '';
    return [
      `You are reviewer #${priorVerdicts.length + 1} in a review chain for PR #${pr} on ${repo}.`,
      `Fetch the diff with: gh pr diff ${pr} --repo ${repo}   (and gh pr view ${pr} --repo ${repo} for context).`,
      'Review for real defects: correctness, regressions, security, broken contracts. Not style.',
      prior,
      'Your FINAL line must be exactly one of:',
      'VERDICT: approved',
      'VERDICT: needs_fix: <one-line summary of what must change>'
    ].join('\n');
  }

  runReviewer(step, prompt, cwd) {
    return new Promise((resolve) => {
      let cmd;
      let args;
      if (step.agent === 'codex') {
        // Config default model (sol/high floor) — deliberately no -m override.
        cmd = 'codex';
        args = ['exec', '-s', 'read-only', prompt];
      } else {
        // Reviewers are READ-ONLY by construction: a malicious PR diff must
        // not be able to steer the agent into writes or pushes. Only reading
        // tools and the gh pr read commands are allowed.
        cmd = 'claude';
        args = ['-p', prompt, '--model', step.model || 'sonnet',
          '--allowedTools', 'Read,Grep,Glob,Bash(gh pr diff:*),Bash(gh pr view:*),Bash(git log:*),Bash(git show:*)'];
      }
      const child = spawn(cmd, args, { cwd, env: process.env, timeout: 15 * 60_000 });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { out += d; });
      child.on('error', (error) => resolve({ ok: false, out: `spawn failed: ${error.message}` }));
      child.on('close', (code) => resolve({ ok: code === 0, out }));
    });
  }

  parseVerdict(output) {
    const m = String(output || '').match(/VERDICT:\s*(approved|needs_fix)\s*:?\s*(.*)/i);
    if (!m) return { verdict: 'unknown', summary: '' };
    return { verdict: m[1].toLowerCase(), summary: (m[2] || '').trim().slice(0, 200) };
  }

  /**
   * Run a chain for a PR. Non-blocking: returns a chain id immediately;
   * progress lands in task records, the activity feed, and the voice layer.
   */
  start({ pr, repo, repoPath, chain = 'default', implementerSessionId = null, commanderForwarder = null }) {
    const chainId = `chain:${repo}#${pr}:${Date.now()}`;
    if ([...this.running.values()].some((r) => r.repo === repo && r.pr === pr)) {
      return { started: false, reason: `a chain is already running for ${repo}#${pr}` };
    }
    const all = this.chains();
    const steps = (Object.prototype.hasOwnProperty.call(all, chain) && Array.isArray(all[chain]))
      ? all[chain] : all.default;
    const state = { pr, repo, chain, step: 0, verdicts: [], startedAt: new Date().toISOString() };
    this.running.set(chainId, state);
    const taskId = `pr:${repo}#${pr}`;

    const run = async () => {
      this.track('review-chain.started', { pr, repo, chain, steps: steps.length });
      this.speak(`Review chain started on PR ${pr}: ${steps.length} reviewer${steps.length > 1 ? 's' : ''}.`);
      await this.taskRecordService?.upsert?.(taskId, { reviewerSpawnedAt: state.startedAt, notes: `chain ${chain} running` });

      for (const [i, step] of steps.entries()) {
        state.step = i + 1;
        const prompt = this.reviewPrompt(pr, repo, step, state.verdicts);
        const result = await this.runReviewer(step, prompt, repoPath || process.cwd());
        const { verdict, summary } = this.parseVerdict(result.out);
        state.verdicts.push({ agent: step.agent, model: step.model, verdict, summary });
        this.track('review-chain.verdict', { pr, repo, step: i + 1, agent: step.agent, verdict, summary });

        if (verdict === 'needs_fix') {
          await this.taskRecordService?.upsert?.(taskId, {
            reviewOutcome: 'needs_fix',
            reviewedAt: new Date().toISOString(),
            notes: `${step.agent}: ${summary}`
          });
          this.speak(`Reviewer ${i + 1} wants changes on PR ${pr}: ${summary || 'see notes'}.`);
          // Route the fix: back to the implementer session when known, else
          // hand the whole situation to the Commander to orchestrate.
          const feedback = `PR #${pr} on ${repo} failed review chain step ${i + 1} (${step.agent}): ${summary}. Please fix and push.`;
          if (implementerSessionId && commanderForwarder) {
            await commanderForwarder(`[review-chain] Send this to session ${implementerSessionId} and confirm: ${feedback}`);
          } else if (commanderForwarder) {
            await commanderForwarder(`[review-chain] ${feedback} Decide whether to spawn a fixer or notify the author.`);
          }
          this.running.delete(chainId);
          return;
        }
        if (verdict === 'unknown') {
          this.track('review-chain.inconclusive', { pr, repo, step: i + 1, agent: step.agent, tail: result.out.slice(-300) });
          // Record honestly and continue — an inconclusive reviewer must not
          // silently pass as approval.
          state.verdicts[state.verdicts.length - 1].verdict = 'inconclusive';
        }
      }

      const clean = state.verdicts.every((v) => v.verdict === 'approved');
      await this.taskRecordService?.upsert?.(taskId, {
        reviewOutcome: clean ? 'approved' : 'commented',
        reviewedAt: new Date().toISOString(),
        notes: state.verdicts.map((v) => `${v.agent}:${v.verdict}`).join(', ')
      });
      this.speak(clean
        ? `PR ${pr} passed the full review chain.`
        : `PR ${pr} finished the chain with mixed verdicts — worth a look.`);
      this.running.delete(chainId);
    };

    run().catch((error) => {
      this.logger.error?.('review chain crashed', { chainId, error: error.message });
      this.running.delete(chainId);
    });
    return { started: true, chainId, steps: steps.length };
  }

  status() {
    return [...this.running.entries()].map(([id, s]) => ({ id, ...s }));
  }
}

module.exports = ReviewChainService;
