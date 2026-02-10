const DEFAULT_MAX_SUMMARY_CHARS = 200;
const DEFAULT_MIN_REFRESH_MS = 4000;
const DEFAULT_TIMEOUT_MS = 4500;
const MAX_CONTEXT_CHARS = 2400;

class IntentHaikuService {
  constructor({ logger = console, sessionManager = null } = {}) {
    this.logger = logger;
    this.sessionManager = sessionManager;
    this.lastCommandBySession = new Map();
    this.intentSeedBySession = new Map();
    this.cacheBySession = new Map();
    this.inFlightBySession = new Map();

    this.maxSummaryChars = this.toInt(process.env.INTENT_HAIKU_MAX_CHARS, DEFAULT_MAX_SUMMARY_CHARS, 80, 320);
    this.minRefreshMs = this.toInt(process.env.INTENT_HAIKU_MIN_REFRESH_MS, DEFAULT_MIN_REFRESH_MS, 1000, 60000);
    this.requestTimeoutMs = this.toInt(process.env.INTENT_HAIKU_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1000, 20000);

    this.anthropicApiKey = String(process.env.ANTHROPIC_API_KEY || '').trim();
    this.model = String(
      process.env.INTENT_HAIKU_MODEL
      || process.env.CLAUDE_VOICE_MODEL
      || 'claude-3-haiku-20240307'
    ).trim();
    this.llmEnabled = !!this.anthropicApiKey && !this.isFalsey(process.env.INTENT_HAIKU_DISABLE_LLM);
  }

  static getInstance(options = {}) {
    if (!IntentHaikuService.instance) {
      IntentHaikuService.instance = new IntentHaikuService(options);
    } else {
      if (options.logger) IntentHaikuService.instance.logger = options.logger;
      if (options.sessionManager) IntentHaikuService.instance.sessionManager = options.sessionManager;
    }
    return IntentHaikuService.instance;
  }

  toInt(value, fallback, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
  }

  isFalsey(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return false;
    return raw === '0' || raw === 'false' || raw === 'no' || raw === 'off';
  }

  setSessionManager(sessionManager) {
    this.sessionManager = sessionManager || null;
  }

  noteCommand(sessionId, command) {
    const sid = String(sessionId || '').trim();
    const text = String(command || '').trim();
    if (!sid || !text) return;
    this.lastCommandBySession.set(sid, text.slice(0, 400));
    if (!this.intentSeedBySession.has(sid) && this.isLikelyIntentPrompt(text)) {
      this.intentSeedBySession.set(sid, text.slice(0, 800));
    }
  }

  isLikelyIntentPrompt(text) {
    const value = String(text || '').trim();
    if (!value) return false;
    if (value.startsWith('/')) return false;

    const wordCount = value.split(/\s+/).filter(Boolean).length;
    if (wordCount >= 8) return true;
    if (value.length >= 60 && wordCount >= 5) return true;
    if (/[.?!]/.test(value) && wordCount >= 5) return true;

    const lowered = value.toLowerCase();
    if (/(^|\s)(please|can you|need to|should|fix|implement|refactor|rename|update|change)\b/.test(lowered) && wordCount >= 4) {
      return true;
    }

    return false;
  }

  summarizeIntentSeed(seed) {
    const raw = String(seed || '').replace(/\s+/g, ' ').trim();
    if (!raw) return '';

    const noPrefix = raw.replace(/^(please|can you|could you|would you)\s+/i, '').trim();
    const sentence = noPrefix.split(/[.?!]/).map((part) => part.trim()).find(Boolean) || noPrefix;
    const clipped = sentence.length > 130 ? `${sentence.slice(0, 127).trim()}...` : sentence;
    return clipped;
  }

  isMainlineBranch(branch) {
    const raw = String(branch || '').trim().toLowerCase();
    if (!raw) return true;
    const cleaned = raw
      .replace(/^refs\/heads\//, '')
      .replace(/^origin\//, '')
      .replace(/^remotes\/origin\//, '');
    return cleaned === 'main' || cleaned === 'master' || cleaned === 'trunk' || cleaned === 'default';
  }

  stripAnsi(value) {
    const raw = String(value || '');
    return raw
      .replace(/\u001B\[[0-9;?]*[A-Za-z]/g, '')
      .replace(/\u009B[0-9;?]*[A-Za-z]/g, '')
      .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '');
  }

  sanitizeText(value) {
    const cleaned = this.stripAnsi(value)
      .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ')
      .replace(/\s+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n');
    return cleaned.trim();
  }

  clampSummary(value) {
    let text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return 'Context is loading; likely orienting before the next step.';
    if (text.length <= this.maxSummaryChars) return text;
    const sliced = text.slice(0, this.maxSummaryChars - 1);
    const cut = sliced.lastIndexOf(' ');
    if (cut > 70) {
      text = `${sliced.slice(0, cut).trim()}...`;
    } else {
      text = `${sliced.trim()}...`;
    }
    return text;
  }

  extractOutputTail(buffer) {
    const cleaned = this.sanitizeText(buffer);
    if (!cleaned) return '';
    const tail = cleaned.length > MAX_CONTEXT_CHARS ? cleaned.slice(-MAX_CONTEXT_CHARS) : cleaned;
    const lines = tail
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => !!line && line !== '>' && line !== '$' && line !== '#');
    const clipped = lines.slice(-20).join('\n');
    return clipped.length > MAX_CONTEXT_CHARS ? clipped.slice(-MAX_CONTEXT_CHARS) : clipped;
  }

  getSessionRecord(sessionId) {
    if (!this.sessionManager) return null;
    if (typeof this.sessionManager.getSessionById === 'function') {
      return this.sessionManager.getSessionById(sessionId);
    }
    if (this.sessionManager.sessions && typeof this.sessionManager.sessions.get === 'function') {
      return this.sessionManager.sessions.get(sessionId) || null;
    }
    return null;
  }

  buildContext(sessionId, session) {
    const sid = String(sessionId || '').trim();
    const status = String(session?.status || '').trim().toLowerCase() || 'idle';
    const branch = String(session?.branch || '').trim();
    const type = String(session?.type || '').trim().toLowerCase();
    const lastCommand = String(this.lastCommandBySession.get(sid) || '').trim();
    const intentSeed = String(this.intentSeedBySession.get(sid) || '').trim();
    const outputTail = this.extractOutputTail(session?.buffer || '');
    return {
      sessionId: sid,
      status,
      branch,
      type,
      lastCommand,
      intentSeed,
      outputTail
    };
  }

  createFingerprint(context) {
    const status = String(context?.status || '');
    const branch = String(context?.branch || '');
    const type = String(context?.type || '');
    const command = String(context?.lastCommand || '');
    const intentSeed = String(context?.intentSeed || '').slice(0, 260);
    const output = String(context?.outputTail || '').slice(-1200);
    return `${type}|${status}|${branch}|${command}|${intentSeed}|${output}`;
  }

  detectTheme(context) {
    const status = String(context?.status || '').trim().toLowerCase();
    const haystack = `${String(context?.lastCommand || '')}\n${String(context?.outputTail || '')}`.toLowerCase();

    if (status === 'waiting') return 'waiting';
    if (/error|failed|failure|exception|traceback|cannot|unable|enoent|eacces/.test(haystack)) return 'debug';
    if (/jest|pytest|dotnet test|go test|cargo test|vitest|playwright|test suite|assert/.test(haystack)) return 'test';
    if (/npm run build|yarn build|pnpm build|webpack|vite build|tsc|compile|compiling/.test(haystack)) return 'build';
    if (/git\s+(status|add|commit|push|pull|fetch|merge|rebase|cherry-pick|checkout|switch)|pull request|pr #|compare\//.test(haystack)) return 'git';
    if (/npm install|pnpm install|yarn install|pip install|cargo add|go get/.test(haystack)) return 'deps';
    if (/review|diff|lint|format|refactor|implement|fix|patch|apply_patch/.test(haystack)) return 'code';
    return 'general';
  }

  buildHeuristicSummary(context) {
    const theme = this.detectTheme(context);
    const status = String(context?.status || '').trim().toLowerCase();
    const branch = String(context?.branch || '').trim();
    const lastCommand = String(context?.lastCommand || '').trim();
    const intentSeed = String(context?.intentSeed || '').trim();
    const outputTail = String(context?.outputTail || '').trim();
    const hasLiveSignal = !!lastCommand || !!outputTail;
    const branchHint = branch && branch !== 'unknown' ? `Branch ${branch}. ` : '';
    const commandHint = lastCommand ? `Last command: ${lastCommand}. ` : '';

    if (intentSeed) {
      const goal = this.summarizeIntentSeed(intentSeed);
      const goalText = goal ? `Goal: ${goal}. ` : '';
      if (status === 'waiting') return this.clampSummary(`${branchHint}${goalText}Waiting for your next instruction.`);
      if (status === 'busy') return this.clampSummary(`${branchHint}${goalText}Actively working through the requested task.`);
      return this.clampSummary(`${branchHint}${goalText}No recent terminal activity.`);
    }

    if (!hasLiveSignal) {
      if (status === 'busy') {
        return this.clampSummary(`${branchHint}Command started, but output is still quiet. Likely waiting for the first result.`);
      }
      if (branch && branch !== 'unknown' && !this.isMainlineBranch(branch)) {
        return this.clampSummary(`${branchHint}No recent terminal activity; likely paused between steps on this branch.`);
      }
      if (branch && branch !== 'unknown') {
        return this.clampSummary(`${branchHint}No recent terminal activity; likely waiting for your next prompt.`);
      }
      return this.clampSummary('No recent terminal activity; likely waiting for your next prompt.');
    }

    const byTheme = {
      waiting: 'Cursor is quiet; context is warm. Likely waiting for your next prompt.',
      debug: 'Red logs are active; clues are narrowing. Likely debugging a failing step.',
      test: 'Tests are rolling through recent changes. Likely validating the latest fix.',
      build: 'Build output is moving line by line. Likely compiling or packaging updates.',
      git: 'Git flow is active in this terminal. Likely preparing branch or PR state.',
      deps: 'Dependency install activity is visible. Likely wiring required packages.',
      code: 'Edits and review signals are in flight. Likely implementing the current request.',
      general: 'Terminal context has fresh activity. Likely progressing the assigned task.'
    };

    const base = byTheme[theme] || byTheme.general;
    return this.clampSummary(`${branchHint}${commandHint}${base}`);
  }

  async summarizeWithAnthropic(context) {
    if (!this.llmEnabled) return null;

    const payload = {
      model: this.model,
      max_tokens: 120,
      temperature: 0.2,
      messages: [{
        role: 'user',
        content: [
          'Return exactly one plain-text line, maximum 200 characters.',
          'Describe what this agent is likely trying to do right now.',
          'Tone should be concise and slightly poetic, but concrete.',
          'No markdown, no bullets, no quotes, no line breaks, no emojis.',
          '',
          `Session: ${context.sessionId}`,
          `Agent: ${context.type}`,
          `Status: ${context.status}`,
          `Branch: ${context.branch || '(unknown)'}`,
          `Initial prompt intent: ${context.intentSeed || '(none)'}`,
          `Last command: ${context.lastCommand || '(none)'}`,
          'Recent terminal output:',
          context.outputTail || '(none)'
        ].join('\n')
      }]
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.anthropicApiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Anthropic request failed (${response.status}): ${body.slice(0, 180)}`);
      }

      const data = await response.json();
      const chunks = Array.isArray(data?.content) ? data.content : [];
      const text = chunks
        .map((chunk) => String(chunk?.text || ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!text) return null;
      return this.clampSummary(text);
    } catch (error) {
      this.logger.warn?.('Intent haiku LLM generation failed; falling back to heuristic summary', {
        error: error.message
      });
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  async summarizeContext(sessionId, context, { force = false } = {}) {
    const sid = String(sessionId || '').trim();
    if (!sid) throw new Error('sessionId is required');

    const fingerprint = this.createFingerprint(context);
    const now = Date.now();
    const cached = this.cacheBySession.get(sid);
    if (!force && cached) {
      if (cached.fingerprint === fingerprint) {
        return {
          summary: cached.summary,
          source: cached.source,
          generatedAt: cached.generatedAt
        };
      }
      if ((now - cached.generatedAtMs) < this.minRefreshMs) {
        return {
          summary: cached.summary,
          source: cached.source,
          generatedAt: cached.generatedAt
        };
      }
    }

    if (!force) {
      const existing = this.inFlightBySession.get(sid);
      if (existing) return existing;
    }

    const task = (async () => {
      const fromLlm = await this.summarizeWithAnthropic(context);
      const summary = fromLlm || this.buildHeuristicSummary(context);
      const source = fromLlm ? 'anthropic-haiku' : 'heuristic';
      const generatedAt = new Date().toISOString();

      this.cacheBySession.set(sid, {
        fingerprint,
        summary,
        source,
        generatedAt,
        generatedAtMs: Date.now()
      });

      return { summary, source, generatedAt };
    })().catch((error) => {
      const fallback = this.buildHeuristicSummary(context);
      const generatedAt = new Date().toISOString();
      this.logger.warn?.('Intent haiku generation failed unexpectedly; returning heuristic fallback', {
        sessionId: sid,
        error: error.message
      });
      this.cacheBySession.set(sid, {
        fingerprint,
        summary: fallback,
        source: 'heuristic',
        generatedAt,
        generatedAtMs: Date.now()
      });
      return { summary: fallback, source: 'heuristic', generatedAt };
    }).finally(() => {
      this.inFlightBySession.delete(sid);
    });

    this.inFlightBySession.set(sid, task);
    return task;
  }

  async summarizeSession(sessionId, { force = false } = {}) {
    const sid = String(sessionId || '').trim();
    if (!sid) throw new Error('sessionId is required');

    const session = this.getSessionRecord(sid);
    if (!session) {
      const error = new Error(`Session not found: ${sid}`);
      error.code = 'SESSION_NOT_FOUND';
      throw error;
    }

    const type = String(session?.type || '').trim().toLowerCase();
    if (type !== 'claude' && type !== 'codex') {
      const error = new Error(`Unsupported session type for intent haiku: ${type || 'unknown'}`);
      error.code = 'UNSUPPORTED_SESSION_TYPE';
      throw error;
    }

    const context = this.buildContext(sid, session);
    return this.summarizeContext(sid, context, { force });
  }
}

module.exports = { IntentHaikuService };
