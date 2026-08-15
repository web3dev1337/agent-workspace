const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

/**
 * Tier 2 of the voice ladder: a ~100ms grammar-constrained intent classifier.
 *
 * A tiny local model (Bonsai-1.7B ternary via the prism llama.cpp build)
 * labels each transcript with ONE action from a closed enum — the JSON shape
 * and every enum are enforced by the server-side grammar, so the model's only
 * degree of freedom is choosing labels. Everything that code can do
 * deterministically (worktree numbers, registry aliases, homophones,
 * question-shape, lexical agent words) happens in the guard layer AFTER the
 * model, because regex beats a 1.7B every time.
 *
 * Calibration: prompt v14 reached 66/66 on the eval harness
 * (~/llm/tier2-calibration). Every transcript handled here is appended to
 * ~/.orchestrator/voice-transcripts.jsonl so the eval set keeps growing.
 */

const NUM_WORDS = {
  won: 1, one: 1, to: 2, too: 2, two: 2, three: 3, for: 4, four: 4,
  five: 5, six: 6, seven: 7, eight: 8, nine: 9
};

const PANEL_ACTIONS = ['open-queue', 'open-tasks', 'catch-me-up', 'show-all-worktrees'];

class Tier2IntentService {
  constructor({ logger = console, registry = null } = {}) {
    this.logger = logger;
    this.registry = registry;
    this.url = String(process.env.TIER2_LLM_URL || 'http://127.0.0.1:5742').replace(/\/$/, '');
    this.autostart = String(process.env.TIER2_AUTOSTART || 'true') !== 'false';
    this.modelPath = String(process.env.TIER2_MODEL || path.join(os.homedir(), 'AI-Models', 'Bonsai-1.7B.gguf'));
    this.serverBin = String(process.env.TIER2_LLAMA_BIN
      || path.join(os.homedir(), 'local-llm', 'prism-llama', 'build', 'bin', 'llama-server'));
    this.confidenceThreshold = Number(process.env.TIER2_CONFIDENCE || 0.6);
    this.child = null;
    this.transcriptLog = path.join(os.homedir(), '.orchestrator', 'voice-transcripts.jsonl');
    this.promptTemplate = this.loadPromptTemplate();
  }

  static getInstance(options = {}) {
    if (!Tier2IntentService.instance) {
      Tier2IntentService.instance = new Tier2IntentService(options);
    }
    return Tier2IntentService.instance;
  }

  loadPromptTemplate() {
    // The calibrated prompt ships with the repo; {{REGISTRY}} and {{SNAPSHOT}}
    // are filled per utterance (static prefix first, so the llama.cpp prompt
    // cache only re-pays the tail).
    const file = path.join(__dirname, '..', '..', 'config', 'voice-tier2-prompt.txt');
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return '';
    }
  }

  commands() {
    return ['open-queue', 'open-tasks', 'focus-worktree', 'show-all-worktrees',
      'set-workflow-mode', 'catch-me-up', 'send-prompt', 'launch-agent'];
  }

  schema() {
    const enums = this.registry?.enums?.() || { people: [''], projects: [''] };
    return {
      type: 'object',
      properties: {
        action: { type: 'string', enum: [...this.commands(), 'query', 'chat', 'agent-work'] },
        params: { type: 'string' },
        person: { type: 'string', enum: enums.people },
        project: { type: 'string', enum: enums.projects },
        worktree: { type: 'string' },
        agent: { type: 'string', enum: ['claude', 'codex', ''] },
        confidence: { type: 'number' }
      },
      required: ['action', 'params', 'person', 'project', 'worktree', 'agent', 'confidence']
    };
  }

  async ensureServer() {
    if (await this.healthy()) return true;
    if (!this.autostart) return false;
    if (!fs.existsSync(this.modelPath) || !fs.existsSync(this.serverBin)) {
      this.logger.warn?.('tier2: model or llama binary missing', { model: this.modelPath, bin: this.serverBin });
      return false;
    }
    if (this.child) return this.waitHealthy(20_000);
    const port = new URL(this.url).port || '5742';
    this.child = spawn(this.serverBin,
      ['-m', this.modelPath, '-ngl', '99', '-c', '8192', '--host', '127.0.0.1', '--port', port],
      { env: { ...process.env, LD_LIBRARY_PATH: path.dirname(this.serverBin) }, stdio: 'ignore' });
    this.child.on('exit', () => { this.child = null; });
    this.logger.info?.('tier2: started Bonsai llama-server', { port });
    return this.waitHealthy(30_000);
  }

  async healthy() {
    try {
      const r = await fetch(`${this.url}/health`, { signal: AbortSignal.timeout(1500) });
      return r.ok;
    } catch {
      return false;
    }
  }

  async waitHealthy(ms) {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (await this.healthy()) return true;
      await new Promise((r) => setTimeout(r, 700));
    }
    return false;
  }

  buildPrompt(snapshot) {
    const registryBlock = this.registry?.promptBlock?.() || '';
    const snapshotLine = snapshot
      ? `LIVE STATE: workspace "${snapshot.workspace || 'none'}"; worktrees ${snapshot.worktrees || 'none'}; ${snapshot.sessions ?? 0} sessions active.`
      : '';
    return this.promptTemplate
      .replace('{{REGISTRY}}', registryBlock)
      .replace('{{SNAPSHOT}}', snapshotLine);
  }

  /**
   * Classify a transcript. Returns
   * { action, intent, params, person, project, product, worktree, agent, confidence }
   * or null when tier 2 is unavailable (caller falls through to tier 3).
   */
  async classify(transcript, snapshot = null) {
    const utt = String(transcript || '').trim();
    if (!utt) return null;
    if (!(await this.ensureServer())) return null;

    let parsed = null;
    const t0 = Date.now();
    try {
      const resp = await fetch(`${this.url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'tier2',
          messages: [
            { role: 'system', content: this.buildPrompt(snapshot) },
            { role: 'user', content: `Transcript: "${utt}"` }
          ],
          max_tokens: 90,
          temperature: 0,
          response_format: { type: 'json_schema', json_schema: { name: 'intent', schema: this.schema() } }
        }),
        signal: AbortSignal.timeout(10_000)
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
    } catch (error) {
      this.logger.warn?.('tier2: classify failed', { error: error.message });
      return null;
    }

    const result = this.applyGuards(utt, parsed);
    result.latencyMs = Date.now() - t0;
    this.harvest(utt, result);
    return result;
  }

  /** The deterministic layer — regex and registry beat model output. */
  applyGuards(utt, j) {
    const low = utt.toLowerCase();
    let action = String(j.action || '');
    let params = String(j.params || '');
    let person = String(j.person || '');
    let project = String(j.project || '');
    let worktree = String(j.worktree || '');
    let agent = String(j.agent || '');
    let product = null;

    // Worktree from the raw utterance (spoken numbers included).
    const wtMatch = low.match(/work\s*(?:tree)?\s*(\d|won|one|to|too|two|three|for|four|five|six|seven|eight|nine)\b/);
    if (wtMatch) {
      const tok = wtMatch[1];
      worktree = /\d/.test(tok) ? `work${tok}` : `work${NUM_WORDS[tok]}`;
    } else if (worktree) {
      const m = worktree.match(/(\d)/);
      const toks = (worktree.toLowerCase().match(/[a-z]+/g) || []).filter((t) => t in NUM_WORDS);
      worktree = m ? `work${m[1]}` : toks.length ? `work${NUM_WORDS[toks[toks.length - 1]]}` : '';
    }

    // Registry alias resolution is data, not inference.
    const resolved = this.registry?.resolve?.(utt) || {};
    if (resolved.person) person = resolved.person.name;
    if (resolved.project) project = resolved.project.name;
    if (resolved.product) { product = resolved.product.name; project = project || resolved.product.name; }

    // Agent choice is lexical.
    if (/\bcodex\b/.test(low)) agent = 'codex';
    else if (/\bclaude\b/.test(low)) agent = 'claude';

    // Question-shaped utterances are never panel/digest/work misroutes.
    if (/^\s*(what|whats|who|whos|did|does|is|are|how|when|any|which|wich)\b/.test(low)
        && [...PANEL_ACTIONS, 'agent-work'].includes(action)) {
      action = 'query';
    }
    // PR mentions without a work-verb are information requests.
    if (/\b(pr|prs|pull request|pull requests|review|ticket)s?\b/.test(low)
        && [...PANEL_ACTIONS.filter((a) => a !== 'show-all-worktrees'), 'agent-work'].includes(action)
        && !/\b(review|merge|fix|spin|launch|rerun|restart|kill|kil|tell|ask|add)\b/.test(low)) {
      action = 'query';
    }
    // Homophone: "cue" is the queue.
    if (/\bcue\b/.test(low) && action === 'open-tasks') action = 'open-queue';

    if (action === 'set-workflow-mode') {
      for (const mode of ['focus', 'review', 'background']) {
        if (params && (mode.startsWith(params.slice(0, 3).toLowerCase()) || mode.includes(params.toLowerCase().slice(0, 4)))) {
          params = mode;
          break;
        }
      }
    }
    if (action === 'focus-worktree' && worktree) params = worktree;

    const intent = this.commands().includes(action) ? 'command'
      : action === 'agent-work' ? 'task' : action;
    return {
      action, intent, params, person, project, product, worktree, agent,
      confidence: Number(j.confidence) || 0
    };
  }

  harvest(transcript, result) {
    try {
      fs.appendFileSync(this.transcriptLog,
        `${JSON.stringify({ at: new Date().toISOString(), transcript, result })}\n`);
    } catch { /* best-effort */ }
  }

  stop() {
    try { this.child?.kill(); } catch { /* already gone */ }
    this.child = null;
  }
}

module.exports = Tier2IntentService;
