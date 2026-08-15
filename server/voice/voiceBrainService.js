/**
 * The voice brain — what makes talking to JARVIS more than a phrasebook.
 *
 * An utterance is routed through three lanes, fastest first:
 *
 *   1. COMMAND  — a semantic command in the registry ("open the queue",
 *      "focus work one"). Matched by voiceCommandService, run instantly. Zero
 *      tokens, near-zero latency. Phrases ARE good; they stay the fast path.
 *
 *   2. FACT     — a question answerable from live orchestrator state ("how many
 *      agents are working?", "what needs me?", "anything from Discord?"). Answered
 *      straight from a context snapshot — an API shortcut, no LLM turn — so it
 *      comes back as fast as a command. This is the "full visibility" lane.
 *
 *   3. AGENT    — anything else ("spin up a reviewer for PR 12 and tell me when
 *      it's done"). Handed to the Commander, a full agent with the entire
 *      orchestrator API, so voice can ask for *anything*, not just listed verbs.
 *
 * Every lane speaks its result back. The brain is the extension of Commander the
 * voice layer needed: fast where a shortcut exists, an agent where it doesn't.
 */
class VoiceBrainService {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this.deps = {};
    // Reply captures poll ONE shared Commander buffer, so they must run one
    // at a time — two interleaved polling loops would each take the newest
    // tail and speak one utterance's answer for the other.
    this.captureChain = Promise.resolve();
  }

  static getInstance(options = {}) {
    if (!VoiceBrainService.instance) {
      VoiceBrainService.instance = new VoiceBrainService(options);
    }
    return VoiceBrainService.instance;
  }

  /** All spoken phrases are DATA (config/voice-responses.json + user overlay). */
  responses() {
    if (!this._responses || Date.now() - (this._responsesAt || 0) > 30_000) {
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      let merged = {};
      for (const f of [path.join(__dirname, '..', '..', 'config', 'voice-responses.json'),
                       path.join(os.homedir(), '.orchestrator', 'voice-responses.json')]) {
        try { Object.assign(merged, JSON.parse(fs.readFileSync(f, 'utf8'))); } catch { /* optional */ }
      }
      this._responses = merged;
      this._responsesAt = Date.now();
    }
    return this._responses;
  }

  say(key, fills = {}, fallback = '') {
    let s = this.responses()[key] || fallback;
    for (const [k, v] of Object.entries(fills)) s = s.split(`{${k}}`).join(String(v));
    return s;
  }

  init(deps = {}) {
    this.deps = { ...this.deps, ...deps };
    // The voice command service forwards its unmatched utterances here.
    if (this.deps.voiceCommandService?.setBrain) this.deps.voiceCommandService.setBrain(this);
    return this;
  }

  /**
   * A compact, live snapshot of everything the brain can see — the same
   * visibility the Commander has, assembled from the services directly so a
   * fact answer never needs a round trip.
   */
  buildContext() {
    const d = this.deps;
    const ctx = { sessions: [], workspace: null, queue: [], supervisor: null, discord: [], capabilities: 0 };

    try {
      const snap = d.commanderContextService?.getSnapshot?.({
        workspaceManager: d.workspaceManager,
        commanderService: d.commanderService,
        commandRegistry: d.commandRegistry
      }) || {};
      ctx.sessions = snap.computed?.sessions || [];
      ctx.workspace = snap.computed?.activeWorkspace?.name || null;
      ctx.workspaces = (snap.computed?.workspaces || []).map((w) => w?.name || w?.id).filter(Boolean);
      ctx.queue = snap.context?.queueSummary || [];
      ctx.capabilities = snap.computed?.capabilitiesSummary?.commandCount || 0;
    } catch (error) {
      this.logger.warn?.('voice brain: context snapshot failed', { error: error.message });
    }

    try { ctx.supervisor = d.supervisorService?.getBriefing?.({ limit: 5 }) || null; } catch { /* optional */ }
    try { ctx.discord = d.discordWatchService?.getUntracked?.() || []; } catch { /* optional */ }

    return ctx;
  }

  countSessions(sessions) {
    const tally = { busy: 0, waiting: 0, idle: 0, total: 0 };
    for (const s of Array.isArray(sessions) ? sessions : []) {
      const status = String(s?.status || '').toLowerCase();
      if (!s?.sessionId && !s?.id) continue;
      tally.total += 1;
      if (status === 'busy') tally.busy += 1;
      else if (status === 'waiting') tally.waiting += 1;
      else tally.idle += 1;
    }
    return tally;
  }

  /**
   * Answer a question straight from the snapshot. Returns the spoken answer, or
   * null if this isn't a question the state can answer — in which case the
   * utterance falls through to the agent.
   */
  answerFromContext(transcript, ctx = this.buildContext()) {
    const t = String(transcript || '').toLowerCase().trim();
    if (!t) return null;

    // A dismissal ("never mind", "forget it", "actually never mind") is a quick
    // ack, not a Commander job. This MUST run before the action/negation guard
    // below — "never mind" starts with "never", so the guard would otherwise
    // swallow it as a negated action and send it to the Commander.
    if (/^(ok(ay)?|actually|uh+|um+|well|hmm|so|yeah|nah|no)?[\s,]*(never ?mind|forget it|forget about it)\b/.test(t)) {
      return this.say('dismissed', {}, 'Okay, forget it.');
    }

    // An action request ("open the queue", "start a reviewer") is never a fact
    // to read back — it belongs to the command lane or the agent. Only answer
    // questions here, so the fact lane can't hijack a thing you asked it to DO.
    // Negations ("don't open the queue") aren't facts either.
    if (/^(open|show|hide|close|focus|switch|go to|goto|start|stop|run|create|make|spawn|launch|kill|delete|remove|add|set|move|approve|reject|merge|push|pull|commit|clear|refresh|reload|new)\b/.test(t)
        || /^(don'?t|do not|never)\b/.test(t)) {
      return null;
    }

    // Thanks / acknowledgement — a quick reply, never a Commander job.
    if (/^(thanks|thank you|thankyou|cheers|ta|much appreciated|nice one|good (job|work|stuff)|awesome|great|cool|ok|okay|kk|got it|sounds good|perfect|no worries)\b/.test(t)) {
      return this.say('thanks', {}, "You're welcome.");
    }

    // What needs me / what's wrong / status of the fleet
    if (/(needs?|need)\s+(me|my|your)|attention|anything (wrong|broken|stuck|urgent)|what.*(should i|do i need)/.test(t)) {
      return ctx.supervisor?.spoken || this.say('nothingNeedsYou', {}, 'Nothing needs you right now.');
    }

    // How many agents / sessions working / how the fleet is doing
    if (/(how many|number of).*(agent|session|running|working|busy)|what.*(agents|sessions).*(doing|status)|\bfleet\b|how('?s| is| are)\b.*\b(agents?|sessions?)\b|are (they|the agents) (busy|working)/.test(t)) {
      const c = this.countSessions(ctx.sessions);
      if (!c.total) return this.say('noSessions', {}, 'No agent sessions are open right now.');
      const parts = [];
      if (c.busy) parts.push(`${c.busy} working`);
      if (c.waiting) parts.push(`${c.waiting} waiting on input`);
      if (c.idle) parts.push(`${c.idle} idle`);
      return `You have ${c.total} agent${c.total === 1 ? '' : 's'}: ${parts.join(', ')}.`;
    }

    // The queue / what's next
    if (/\bqueue\b|what.*(next|to do|on the list)|what.*work.*(left|remaining)/.test(t)) {
      const q = Array.isArray(ctx.queue) ? ctx.queue : [];
      if (!q.length) return this.say('queueEmpty', {}, 'The queue is empty.');
      const top = q.slice(0, 3).map((x) => String(x?.title || x?.id || '').trim()).filter(Boolean);
      return `${q.length} item${q.length === 1 ? '' : 's'} in the queue. Top: ${top.join('; ')}.`;
    }

    // Discord / what was asked for
    if (/\b(discord|chat)\b|asked (for|me)|anyone (need|ask)|untracked/.test(t)) {
      const items = Array.isArray(ctx.discord) ? ctx.discord : [];
      if (!items.length) return this.say('nothingFromChat', {}, 'Nothing outstanding from chat.');
      const first = items[0];
      return `${items.length} thing${items.length === 1 ? '' : 's'} asked for but not started. Most urgent: ${String(first?.summary || first?.text || '').slice(0, 120)}.`;
    }

    // Which workspaces exist / which one is open
    if (/what\s+workspaces|which workspaces|list.*workspaces|workspaces (are|do)/.test(t)) {
      const names = Array.isArray(ctx.workspaces) ? ctx.workspaces : [];
      if (!names.length) return this.say('noWorkspaces', {}, 'No workspaces are configured.');
      const shown = names.slice(0, 6).join(', ');
      const more = names.length > 6 ? `, and ${names.length - 6} more` : '';
      return `${names.length} workspaces: ${shown}${more}. Active: ${ctx.workspace || 'none'}.`;
    }
    if (/what.*(workspace|project).*(in|on|open)|which workspace|where am i/.test(t)) {
      return ctx.workspace ? `You're in the ${ctx.workspace} workspace.` : 'No workspace is open right now.';
    }

    // Identity — instant, not a job for the Commander agent.
    if (/what.?s? your name|who are you|what are you|your name|introduce yourself|are you (an? )?(ai|bot|robot|real|human|person)/.test(t)) {
      return this.say('identity', {}, 'I am JARVIS, your fleet supervisor.');
    }

    // What can you do (not bare "help me" — that's a real request, let it flow on)
    if (/what can you do|what commands|what.*(you|can i) (say|ask)|how do (i|you) work/.test(t)) {
      return `I can run about ${ctx.capabilities || 'a set of'} orchestrator commands directly, answer questions about your fleet, and hand anything else to the Commander to work on.`;
    }

    // Greetings / presence checks — LAST, and only when it's actually a greeting,
    // not "hey <request>" (which should hit the command/agent lane). A request
    // verb anywhere in the utterance disqualifies it as a pure greeting.
    const hasRequestVerb = /\b(show|open|tell|give|create|start|stop|switch|run|make|find|set|pull|bring|list|check|fix|build|write|add|do)\b/.test(t);
    if (!hasRequestVerb
        && (/^(hi|hey|hello|yo|howdy|greetings|good (morning|afternoon|evening))\b|are you (there|awake|up|listening|around)|can you hear me|you (there|up)/.test(t))) {
      // A greeting gets a greeting — status only when asked for. If the
      // config routes greetings to the LLM, fall through to the chat lane.
      if (this.responses().greetingLane === 'llm') return null;
      return this.say('greeting', {}, 'Yes, I am here.');
    }

    return null;
  }

  /**
   * Pull the Commander's actual reply out of its PTY buffer and reduce it to
   * something speakable. Claude Code renders a full-screen TUI, so this strips
   * ANSI + box-drawing + chrome and keeps the last few lines of real prose.
   */
  extractAssistantReply(fullText, beforeText = '') {
    let text = String(fullText || '');
    // Only the output produced AFTER the request was sent. When the rolling
    // buffer has scrolled (prefix no longer matches), fall back to the tail
    // rather than re-reading the whole buffer as if it were new output.
    if (beforeText && text.startsWith(beforeText)) text = text.slice(beforeText.length);
    else if (beforeText) text = text.split('\n').slice(-40).join('\n');

    const cleaned = text
      .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '') // OSC sequences
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')       // CSI (colour/cursor)
      .replace(/\x1b[()][AB0]/g, '')                    // charset selects
      .replace(/[│┃─━╭╮╰╯├┤┬┴┼█▀▄▌▐░▒▓·]/g, ' ')        // box-drawing/blocks
      .replace(/\r/g, '\n');

    const noise = /^(>|\?|·|✢|✳|✻|✽|\*|╭|╰|\||\s*esc |\s*⏵|\s*⎿|\s*⧉|tokens|context|auto-|\/|shift\+|ctrl\+|\d+ tokens|✔|✳️)/i;
    const lines = cleaned.split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length >= 12 && /[a-z]{4,}/i.test(l) && !noise.test(l))
      // Drop obvious UI/status strings that slip through. Match whole
      // status phrases, not bare words like "working" that appear in real prose.
      .filter((l) => !/dangerously|skip permissions|welcome to claude|bypassing permissions|esc to interrupt|press up|for shortcuts/i.test(l))
      // Claude Code spinner statuses: "✢ still thinking with low effort",
      // "Drizzling… (9s · thinking)", "thought for 1s" — spinner fragments can
      // merge with counters into one garbled line, so match the phrases
      // anywhere in the line, not just whole-line shapes.
      .filter((l) => !/^\W*(still\s+)?\w+ing(\s+(on\s+it|with\s+\w+\s+effort))?[.…\s]*$/i.test(l))
      .filter((l) => !/(thinking|working)\s+with\s+\w+\s+effort|thought\s+for\s+\d|\btokens\b|\d+s\s*·|interrupt\b/i.test(l));

    // Claude Code prefixes real assistant text with a "⏺" bullet while the
    // spinner uses an ever-changing random gerund ("Drizzling…", "Moseying…")
    // that no blocklist can enumerate. When bullet lines exist, they ARE the
    // answer — everything else is chrome.
    const bulletLines = cleaned.split('\n')
      .map((l) => l.trim())
      .filter((l) => /^[⏺●]\s*\S/.test(l))
      .map((l) => l.replace(/^[⏺●]\s*/, ''))
      // Tool-call headers render as bullets too ("Bash(gh pr view …)") — those
      // are chrome, not the answer.
      .filter((l) => !/^\w+\([^)]*\)?/.test(l) || /\s[a-z]{3,}\s/.test(l.replace(/\([^)]*\)/g, '')))
      .filter((l) => l.length >= 4 && /[a-z]{3,}/i.test(l));
    if (bulletLines.length) return bulletLines.slice(-2).join(' ').slice(0, 360);

    if (!lines.length) return null;
    // The final assistant answer is at the tail; take the last couple of prose lines.
    return lines.slice(-2).join(' ').slice(0, 360);
  }

  async captureCommanderReply(beforeText, { maxWaitMs = 45000, settleMs = 2500, pollMs = 1000 } = {}) {
    const cs = this.deps.commanderService;
    if (!cs?.getRecentOutput) return null;

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const startedAt = Date.now();
    let last = '';
    let lastChangeAt = Date.now();

    while (Date.now() - startedAt < maxWaitMs) {
      await sleep(pollMs);
      const now = cs.getRecentOutput(150) || '';
      if (now !== last) { last = now; lastChangeAt = Date.now(); }
      else if (last && Date.now() - lastChangeAt >= settleMs) break; // output settled
    }
    return this.extractAssistantReply(last, beforeText);
  }

  speak(text, { priority = 'normal', source = '' } = {}) {
    if (!text) return { spoken: false };
    try {
      return this.deps.speechService?.speak?.(text, { priority, source }) || { spoken: false };
    } catch (error) {
      this.logger.warn?.('voice brain: speak failed', { error: error.message });
      return { spoken: false, reason: error.message };
    }
  }

  /**
   * The unmatched-utterance entry point voiceCommandService calls: try a fast
   * fact answer, otherwise hand the whole thing to the Commander agent. Either
   * way, speak.
   */
  async handleUnmatched(transcript) {
    const ctx = this.buildContext();
    let taskEntities = null;

    // Confirm-first: a pending destructive action waits for a yes/no before
    // anything else is interpreted.
    const pendingOutcome = await this.resolvePendingConfirmation(transcript);
    if (pendingOutcome) return pendingOutcome;

    const fact = this.answerFromContext(transcript, ctx);
    if (fact) {
      this.speak(fact, { source: 'fact' });
      return { handled: true, route: 'fact', spoken: fact };
    }

    // A single stray word ("uh", "hmm") isn't a request — don't wake the
    // Commander for it.
    if (String(transcript || '').trim().split(/\s+/).filter(Boolean).length <= 1) {
      const miss = this.say('notCaught', {}, 'Sorry, I did not catch that.');
      this.speak(miss);
      return { handled: false, route: 'unclear', spoken: miss };
    }

    // Tier 2: the ~100ms grammar-constrained classifier. When it speaks with
    // confidence, it routes; when it is down or unsure, the older heuristics
    // below still work.
    const t2 = this.deps.tier2IntentService;
    if (t2?.classify) {
      let cls = null;
      try {
        cls = await t2.classify(transcript, this.tier2Snapshot(ctx));
      } catch (error) {
        this.logger.warn?.('voice brain: tier2 classify threw', { error: error.message });
      }
      if (cls && cls.confidence >= (t2.confidenceThreshold ?? 0.6)) {
        const routed = await this.routeClassified(transcript, cls, ctx);
        if (routed && !routed.fallthrough) return routed;
        if (routed?.fallthrough) taskEntities = routed.entities;
      }
    }

    // Chat lane: conversation belongs to the LOCAL model — instant, free, and
    // no Claude session woken up for "how's it going". Only utterances with an
    // action verb (do/change something) earn the Commander handoff below.
    const wantsAction = /\b(launch|run|open|start|stop|kill|restart|create|make|build|send|write|merge|review|deploy|switch|focus|add|remove|delete|spin|queue|commit|push|fix|test|install|update|move|execute|approve|cancel)\b/i
      .test(String(transcript || ''));
    if (!wantsAction) {
      const chat = await this.chatLocally(transcript, ctx);
      if (chat) {
        this.speak(chat, { source: 'tier3-chat' });
        return { handled: true, route: 'local-chat', spoken: chat };
      }
      // Local model unavailable — fall through to the Commander rather than
      // going silent.
    }

    // Agent lane: the Commander has the whole API and can do anything — which
    // is exactly why a destructive-sounding request must not reach it without
    // a spoken yes, even when tier 2 was down or unsure.
    if (this.isDestructive(transcript)) {
      return this.requestConfirmation(transcript, { intent: 'task' });
    }
    const forwarder = this.deps.commanderForwarder;
    if (typeof forwarder === 'function') {
      const entities = taskEntities;
      const entityLine = entities
        ? `\nResolved entities: project=${entities.project || '-'} person=${entities.person || '-'} worktree=${entities.worktree || '-'} agent=${entities.agent || '-'}`
        : '';
      const brief = `[voice] ${String(transcript || '').trim()}${entityLine}\n\nAnswer or act using the orchestrator API (GET /api/commander/context, /capabilities, POST /execute). Keep your reply to one or two sentences of plain prose so it can be read aloud.`;
      const before = this.deps.commanderService?.getRecentOutput?.(150) || '';
      let delivered = false;
      try { delivered = (await forwarder(brief)) !== false; } catch (error) {
        this.logger.warn?.('voice brain: commander forward failed', { error: error.message });
      }

      if (!delivered) {
        const miss = this.say('noCommander', {}, 'No Commander is running to take that.');
        this.speak(miss);
        return { handled: false, route: 'commander', spoken: miss };
      }

      // Immediate ack, then speak the Commander's actual reply once it settles —
      // in the background, so the request returns now and the answer arrives when
      // the agent is done. This is the two-way loop.
      this.speak(this.say('onIt', {}, 'On it.'));
      this.captureChain = this.captureChain
        .then(() => this.captureCommanderReply(before))
        .then((reply) => { if (reply) this.speak(reply, { priority: 'high' }); })
        .catch((error) => this.logger.warn?.('voice brain: reply capture failed', { error: error.message }));

      return { handled: true, route: 'commander', spoken: this.say('onIt', {}, 'On it.') };
    }

    const miss = "I couldn't do that myself and there's no Commander running to hand it to.";
    this.speak(miss);
    return { handled: false, route: 'none', spoken: miss };
  }

  tier2Snapshot(ctx) {
    const sessions = Array.isArray(ctx?.sessions) ? ctx.sessions : [];
    const worktrees = sessions
      .map((s) => `${s.worktreeId || s.id || 'unknown'} (${s.status || 'active'})`)
      .slice(0, 12)
      .join(', ');
    return {
      workspace: ctx?.workspace?.name || ctx?.workspace || 'none',
      worktrees: worktrees || 'none',
      sessions: sessions.length
    };
  }

  feedbackPolicy() {
    if (!this._feedbackPolicy) {
      try {
        const path = require('path');
        const fs = require('fs');
        this._feedbackPolicy = JSON.parse(
          fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'voice-tiers.json'), 'utf8'));
      } catch {
        this._feedbackPolicy = {};
      }
    }
    return this._feedbackPolicy;
  }

  isDestructive(transcript) {
    const pattern = this.feedbackPolicy()?.destructivePattern
      || '\\b(kill|kil|remove|delete|deploy|merge|force push|drop|wipe|shut ?down|destroy|nuke|terminate)\\b|\\b(stop|close)\\b.*\\b(all|every|claudes?|agents?|sessions?|server|everything)\\b';
    return new RegExp(pattern, 'i').test(String(transcript || ''));
  }

  /** Route a confident tier-2 classification to the right lane. */
  async routeClassified(transcript, cls, ctx) {
    const vcs = this.deps.voiceCommandService;

    if (cls.intent === 'command') {
      // Destructive-sounding commands wait for a spoken yes.
      if (this.isDestructive(transcript)) return this.requestConfirmation(transcript, cls);
      return this.executeClassifiedCommand(transcript, cls);
    }

    if (cls.intent === 'query') {
      const q = this.deps.voiceQueryService;
      if (q?.answer) {
        try {
          const answer = await q.answer(transcript, cls, ctx);
          if (answer) {
            this.speak(answer, { source: 'query' });
            return { handled: true, route: 'query', spoken: answer };
          }
        } catch (error) {
          this.logger.warn?.('voice brain: query lane failed', { error: error.message });
        }
      }
      // Deterministic fetchers had nothing — let the local brain answer with
      // the live context in its prompt.
      const chat = await this.chatLocally(transcript, ctx);
      if (chat) {
        this.speak(chat, { source: 'tier3-chat' });
        return { handled: true, route: 'query-chat', spoken: chat };
      }
      return null;
    }

    if (cls.intent === 'chat') {
      const chat = await this.chatLocally(transcript, ctx);
      if (chat) {
        this.speak(chat);
        return { handled: true, route: 'local-chat', spoken: chat };
      }
      return null;
    }

    // task: fall through to the Commander lane, handing the resolved entities
    // back by VALUE — instance state here would leak onto the next unrelated
    // utterance (and race across concurrent ones).
    if (cls.intent === 'task') {
      if (this.isDestructive(transcript)) return this.requestConfirmation(transcript, cls);
      return { fallthrough: true, entities: cls };
    }
    return null;
  }

  async executeClassifiedCommand(transcript, cls) {
    const vcs = this.deps.voiceCommandService;
    // Confirmed legacy-matcher commands carry their exact exec payload.
    if (cls?.exec?.command) {
      try {
        await vcs.executeCommand(cls.exec.command, cls.exec.params || {});
        const say = this.confirmCommand(cls.exec.command);
        return { handled: true, route: 'command', command: cls.exec.command, spoken: say };
      } catch (error) {
        this.logger.warn?.('voice brain: confirmed command failed', { error: error.message });
        const say = 'That command failed.';
        this.speak(say);
        return { handled: false, route: 'command', spoken: say };
      }
    }
    const paramMap = {
      'focus-worktree': { worktreeId: cls.worktree || cls.params },
      'set-workflow-mode': { mode: cls.params }
    };

    if (cls.action === 'catch-me-up') {
      const digest = this.spokenDigest();
      this.speak(digest);
      return { handled: true, route: 'command', command: 'catch-me-up', spoken: digest };
    }
    if (cls.action === 'send-prompt' || cls.action === 'launch-agent') {
      // These need the full orchestrator API — Commander executes, but the
      // brief is STRUCTURED so nothing is re-derived from mumbled speech.
      const reg = this.deps.voiceRegistryService;
      const defaults = reg?.defaults?.() || {};
      const agent = cls.agent || defaults.launchAgent || 'claude';
      const brief = [
        `[voice:${cls.action}] ${String(transcript || '').trim()}`,
        `Resolved: project=${cls.project || 'unknown'} product=${cls.product || '-'} worktree=${cls.worktree || 'unspecified'} agent=${agent}`,
        cls.params ? `Message/goal: ${cls.params}` : '',
        cls.action === 'send-prompt'
          ? 'Send this message to that session via POST /api/commander/send-to-session (text first, then \\r separately). Reply in one short sentence confirming.'
          : `Launch a new ${agent} agent for that project/worktree via the orchestrator API. Reply in one short sentence confirming.`
      ].filter(Boolean).join('\n');
      return this.forwardBrief(brief, cls.action === 'send-prompt' ? this.say('sendingOver', {}, 'Sending that over.') : this.say('spinningUp', {}, 'Spinning that up.'));
    }

    if (!vcs?.executeCommand) return null;
    try {
      await vcs.executeCommand(cls.action, paramMap[cls.action] || {});
      const say = this.confirmCommand(cls.action);
      return { handled: true, route: 'command', command: cls.action, spoken: say };
    } catch (error) {
      this.logger.warn?.('voice brain: classified command failed', { command: cls.action, error: error.message });
      return null;
    }
  }

  /** A deterministic spoken digest of live state, for catch-me-up. */
  spokenDigest() {
    const ctx = this.buildContext();
    const sessions = Array.isArray(ctx.sessions) ? ctx.sessions : [];
    const busy = sessions.filter((s) => !/idle/i.test(s.status || '')).length;
    const queue = Array.isArray(ctx.queue) ? ctx.queue.length : 0;
    const discord = Array.isArray(ctx.discord) ? ctx.discord.length : 0;
    const parts = [`${sessions.length} session${sessions.length === 1 ? '' : 's'}, ${busy} busy`];
    if (queue) parts.push(`${queue} in the queue`);
    if (discord) parts.push(`${discord} Discord items`);
    return `Here's where we are: ${parts.join(', ')}.`;
  }

  forwardBrief(brief, ack) {
    const forwarder = this.deps.commanderForwarder;
    if (typeof forwarder !== 'function') return null;
    const before = this.deps.commanderService?.getRecentOutput?.(150) || '';
    return Promise.resolve(forwarder(brief)).then((delivered) => {
      if (delivered === false) {
        const miss = this.say('noCommander', {}, 'No Commander is running to take that.');
        this.speak(miss);
        return { handled: false, route: 'commander', spoken: miss };
      }
      this.speak(ack);
      this.captureChain = this.captureChain
        .then(() => this.captureCommanderReply(before))
        .then((reply) => { if (reply) this.speak(reply, { priority: 'high' }); })
        .catch((error) => this.logger.warn?.('voice brain: reply capture failed', { error: error.message }));
      return { handled: true, route: 'commander', spoken: ack };
    }).catch((error) => {
      this.logger.warn?.('voice brain: forward failed', { error: error.message });
      return null;
    });
  }

  requestConfirmation(transcript, cls) {
    this.pendingConfirmation = { transcript, cls, at: Date.now() };
    const say = this.say('confirmDestructive', { transcript: String(transcript || '').trim() }, `Confirm: ${transcript}?`);
    this.speak(say);
    return { handled: true, route: 'confirm', spoken: say };
  }

  async resolvePendingConfirmation(transcript) {
    const pending = this.pendingConfirmation;
    if (!pending) return null;
    // A confirmation is only live for a short window.
    if (Date.now() - pending.at > 30_000) {
      this.pendingConfirmation = null;
      return null;
    }
    const low = String(transcript || '').trim().toLowerCase();
    if (/^(yes|yeah|yep|confirm|do it|go ahead|affirmative)\b/.test(low)) {
      this.pendingConfirmation = null;
      const { transcript: original, cls } = pending;
      if (cls?.intent === 'command') return this.executeClassifiedCommand(original, cls);
      // Destructive task: hand to Commander now that it is confirmed.
      return this.forwardBrief(
        `[voice:confirmed] ${original}\n\nThe operator confirmed this destructive request out loud. Execute it via the orchestrator API and reply in one short sentence.`,
        this.say('confirmedOnIt', {}, 'Confirmed — on it.')
      );
    }
    if (/^(no|nope|cancel|stop|never ?mind|abort)\b/.test(low)) {
      this.pendingConfirmation = null;
      const say = this.say('cancelled', {}, 'Cancelled.');
      this.speak(say);
      return { handled: true, route: 'confirm-cancelled', spoken: say };
    }
    // Anything else falls through to normal handling and drops the pending ask.
    this.pendingConfirmation = null;
    return null;
  }

  /**
   * Answer conversationally with the local Ollama model. This is the brain's
   * own voice for anything that isn't a command, a fact, or a task — fast and
   * entirely on-GPU. Returns null when Ollama is unreachable so the caller can
   * fall back to the Commander.
   */
  /**
   * The chat brain's standing knowledge: the Commander playbook plus voice
   * framing. Loaded once — a static prefix keeps the local server's prompt
   * cache warm, so only the utterance itself is new tokens each turn.
   */
  chatSystemPrompt(ctx = {}) {
    if (!this._chatDoc) {
      this._chatDoc = '';
      try {
        const fs = require('fs');
        const path = require('path');
        const docPath = path.join(__dirname, '..', '..', 'docs', 'COMMANDER_CLAUDE.md');
        this._chatDoc = fs.readFileSync(docPath, 'utf8').slice(0, 20000);
      } catch { /* doc optional — framing below still applies */ }
    }
    const sessions = Array.isArray(ctx.sessions) ? ctx.sessions : [];
    const sessionLines = sessions.slice(0, 10)
      .map((s) => `  - ${s.sessionId || s.id}: ${s.status || 'active'}${s.branch ? ` (${s.branch})` : ''}`).join('\n') || '  none';
    const workspaces = (ctx.workspaces || []).join(', ') || 'none';
    const queue = (Array.isArray(ctx.queue) ? ctx.queue : []).slice(0, 5)
      .map((q) => q?.title || q?.id).filter(Boolean).join('; ') || 'empty';
    const liveBlock = `LIVE STATE RIGHT NOW:\n- workspaces: ${workspaces}\n- active workspace: ${ctx.workspace || 'none'}\n- sessions:\n${sessionLines}\n- queue: ${queue}`;
    return 'You are JARVIS, the spoken voice interface of the Claude Orchestrator. '
      + 'You are talking OUT LOUD with the operator, so reply in one or two short '
      + 'conversational sentences of plain prose — no markdown, no lists, no code. '
      + 'You know the system intimately; the reference below describes the Commander '
      + 'API and orchestrator you front. Use your TOOLS for live data and safe actions; '
      + 'bigger jobs are handled by the Commander lane.\n\n'
      + `${liveBlock}\n\n`
      + 'TOOLS: when you need data or to act, reply with ONLY a tool call on one line: '
      + '<tool>{"name":"...","args":{...}}</tool> and nothing else. Available tools: '
      + 'list_sessions{}, queue{}, prs{person?,project?}, run_command{command,params}. '
      + `run_command accepts: ${this.safeCommands().slice(0, 40).join(', ')}. `
      + '(focus-worktree wants {worktreeId}, set-workflow-mode wants {mode}.) '
      + 'You will get the result back and can then answer in speech. Use a tool instead of saying you cannot check something.\n\n'
      + (this._chatDoc ? `--- ORCHESTRATOR REFERENCE ---\n${this._chatDoc}` : '');
  }

  async runVoiceTool(call, ctx) {
    const name = String(call?.name || '');
    const args = call?.args || {};
    try {
      if (name === 'list_sessions') {
        const s = (Array.isArray(ctx.sessions) ? ctx.sessions : [])
          .map((x) => `${x.sessionId || x.id}: ${x.status || 'active'}`).join('; ');
        return s || 'no sessions';
      }
      if (name === 'queue') {
        const q = (Array.isArray(ctx.queue) ? ctx.queue : []).map((x) => x?.title || x?.id).filter(Boolean);
        return q.length ? q.join('; ') : 'queue is empty';
      }
      if (name === 'prs') {
        const answer = await this.deps.voiceQueryService?.answer?.('open prs', { person: args.person || '', project: args.project || '' }, ctx);
        return answer || 'no PR data available';
      }
      if (name === 'run_command') {
        const cmd = String(args.command || '');
        // Every registry command EXCEPT destructive-sounding ones. Derived
        // live, so new commands become voice-runnable without code changes.
        if (!this.safeCommands().includes(cmd)) return `command ${cmd} is not allowed from the chat lane`;
        await this.deps.voiceCommandService?.executeCommand?.(cmd, args.params || {});
        return `done: ${cmd}`;
      }
      return `unknown tool ${name}`;
    } catch (error) {
      return `tool failed: ${error.message}`;
    }
  }

  safeCommands() {
    const all = (this.deps.voiceCommandService?.getVoiceCommands?.() || []).map((c) => c.command);
    const destructive = new RegExp(this.feedbackPolicy()?.destructivePattern
      || 'kill|remove|delete|stop|deploy|merge|wipe|drop', 'i');
    return [...new Set(all)].filter((c) => c && !destructive.test(c.replace(/-/g, ' ')));
  }

  parseToolCall(text) {
    const m = String(text || '').match(/<tool>\s*({[\s\S]*?})\s*<\/tool>/);
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch { return null; }
  }

  async chatLocally(transcript, ctx = {}) {
    // Rolling conversation memory: the last few exchanges ride along so
    // "what about the second one?" makes sense. Resets after 10 idle minutes —
    // a fresh conversation deserves a fresh head.
    if (!this._chatHistory || Date.now() - (this._chatLastAt || 0) > 10 * 60_000) this._chatHistory = [];
    this._chatLastAt = Date.now();
    const messages = [
      { role: 'system', content: this.chatSystemPrompt(ctx) },
      ...this._chatHistory.slice(-8),
      { role: 'user', content: String(transcript || '').trim() }
    ];
    const reply = await this.chatWithTools(messages, ctx, 0);
    if (reply) {
      this._chatHistory.push(
        { role: 'user', content: String(transcript || '').trim() },
        { role: 'assistant', content: reply }
      );
      this._chatHistory = this._chatHistory.slice(-16);
    }
    return reply;
  }

  async chatWithTools(messages, ctx, depth) {
    const reply = await this.chatCompletion(messages);
    if (!reply) return null;
    const call = this.parseToolCall(reply);
    // One tool round max — voice needs answers, not agent loops.
    if (call && depth < 1) {
      const result = await this.runVoiceTool(call, ctx);
      this.logger.info?.('voice tool used', { tool: call.name, result: String(result).slice(0, 120) });
      return this.chatWithTools([...messages,
        { role: 'assistant', content: reply },
        { role: 'user', content: `TOOL RESULT: ${result}\nNow answer in one or two spoken sentences (no tool calls).` }
      ], ctx, depth + 1);
    }
    // Never speak a raw tool call.
    return call ? null : reply;
  }

  async chatCompletion(messages) {
    this._chatBreaker = this._chatBreaker || {};
    const tripped = (k) => this._chatBreaker[k] && Date.now() - this._chatBreaker[k] < 60_000;
    const trip = (k) => { this._chatBreaker[k] = Date.now(); };
    const openaiUrl = String(process.env.VOICE_CHAT_URL || 'http://127.0.0.1:18866/v1').replace(/\/$/, '');
    if (!tripped('openai')) {
      try {
        const resp = await fetch(`${openaiUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: process.env.VOICE_CHAT_MODEL || 'local', messages, max_tokens: 160 }),
          signal: AbortSignal.timeout(9000)
        });
        if (resp.ok) {
          const data = await resp.json();
          const text = String(data?.choices?.[0]?.message?.content || '').trim();
          if (text) return text.slice(0, 360);
        } else trip('openai');
      } catch { trip('openai'); }
    }

    const url = String(process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');
    const model = String(process.env.OLLAMA_MODEL || 'llama3.1:8b');
    if (tripped('ollama')) return null;
    try {
      const resp = await fetch(`${url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, stream: false, keep_alive: '30m', messages, options: { num_predict: 160 } }),
        signal: AbortSignal.timeout(15000)
      });
      if (!resp.ok) { trip('ollama'); return null; }
      const data = await resp.json();
      const text = String(data?.message?.content || '').trim();
      return text ? text.slice(0, 360) : null;
    } catch {
      // Timeouts/aborts are exactly what the breaker exists for.
      trip('ollama');
      return null;
    }
  }

  /** A short spoken confirmation after a command lane hit. */
  confirmCommand(command) {
    const label = String(command || '').replace(/[-_]/g, ' ').trim();
    const say = label ? this.say('commandDone', { label }, `Done — ${label}.`) : 'Done.';
    this.speak(say);
    return say;
  }
}

module.exports = VoiceBrainService;
module.exports.VoiceBrainService = VoiceBrainService;
