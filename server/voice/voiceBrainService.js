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
  }

  static getInstance(options = {}) {
    if (!VoiceBrainService.instance) {
      VoiceBrainService.instance = new VoiceBrainService(options);
    }
    return VoiceBrainService.instance;
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
      return 'Okay, forget it.';
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
      return "You're welcome.";
    }

    // What needs me / what's wrong / status of the fleet
    if (/(needs?|need)\s+(me|my|your)|attention|anything (wrong|broken|stuck|urgent)|what.*(should i|do i need)/.test(t)) {
      return ctx.supervisor?.spoken || 'Nothing needs you right now. Everything else was handled.';
    }

    // How many agents / sessions working
    if (/(how many|number of).*(agent|session|running|working|busy)|what.*(agents|sessions).*(doing|status)|fleet status|are (they|the agents) (busy|working)/.test(t)) {
      const c = this.countSessions(ctx.sessions);
      if (!c.total) return 'No agent sessions are open right now.';
      const parts = [];
      if (c.busy) parts.push(`${c.busy} working`);
      if (c.waiting) parts.push(`${c.waiting} waiting on input`);
      if (c.idle) parts.push(`${c.idle} idle`);
      return `You have ${c.total} agent${c.total === 1 ? '' : 's'}: ${parts.join(', ')}.`;
    }

    // The queue / what's next
    if (/\bqueue\b|what.*(next|to do|on the list)|what.*work.*(left|remaining)/.test(t)) {
      const q = Array.isArray(ctx.queue) ? ctx.queue : [];
      if (!q.length) return 'The queue is empty.';
      const top = q.slice(0, 3).map((x) => String(x?.title || x?.id || '').trim()).filter(Boolean);
      return `${q.length} item${q.length === 1 ? '' : 's'} in the queue. Top: ${top.join('; ')}.`;
    }

    // Discord / what was asked for
    if (/\b(discord|chat)\b|asked (for|me)|anyone (need|ask)|untracked/.test(t)) {
      const items = Array.isArray(ctx.discord) ? ctx.discord : [];
      if (!items.length) return 'Nothing outstanding from chat.';
      const first = items[0];
      return `${items.length} thing${items.length === 1 ? '' : 's'} asked for but not started. Most urgent: ${String(first?.summary || first?.text || '').slice(0, 120)}.`;
    }

    // Which workspace
    if (/what.*(workspace|project).*(in|on|open)|which workspace|where am i/.test(t)) {
      return ctx.workspace ? `You're in the ${ctx.workspace} workspace.` : 'No workspace is open right now.';
    }

    // Identity — instant, not a job for the Commander agent.
    if (/what.?s? your name|who are you|what are you|your name|introduce yourself|are you (an? )?(ai|bot|robot|real|human|person)/.test(t)) {
      return "I'm JARVIS, your fleet supervisor. I keep an eye on your agents, answer questions about what's going on, run commands, and hand bigger jobs to the Commander.";
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
      const c = this.countSessions(ctx.sessions);
      return c.total
        ? `Yes, I'm here. ${c.busy} agent${c.busy === 1 ? '' : 's'} working right now. What do you need?`
        : "Yes, I'm here and listening. What do you need?";
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
    // Only the output produced AFTER the request was sent.
    if (beforeText && text.startsWith(beforeText)) text = text.slice(beforeText.length);

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
      .filter((l) => !/dangerously|skip permissions|welcome to claude|bypassing permissions|esc to interrupt|press up|for shortcuts|^\s*(thinking|working|processing)[.…\s]*$/i.test(l));

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

  speak(text, { priority = 'normal' } = {}) {
    if (!text) return { spoken: false };
    try {
      return this.deps.speechService?.speak?.(text, { priority }) || { spoken: false };
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
    const fact = this.answerFromContext(transcript, ctx);
    if (fact) {
      this.speak(fact);
      return { handled: true, route: 'fact', spoken: fact };
    }

    // A single stray word ("uh", "hmm") isn't a request — don't wake the
    // Commander for it.
    if (String(transcript || '').trim().split(/\s+/).filter(Boolean).length <= 1) {
      const miss = "Sorry, I didn't catch that.";
      this.speak(miss);
      return { handled: false, route: 'unclear', spoken: miss };
    }

    // Agent lane: the Commander has the whole API and can do anything.
    const forwarder = this.deps.commanderForwarder;
    if (typeof forwarder === 'function') {
      const brief = `[voice] ${String(transcript || '').trim()}\n\nAnswer or act using the orchestrator API (GET /api/commander/context, /capabilities, POST /execute). Keep your reply to one or two sentences of plain prose so it can be read aloud.`;
      const before = this.deps.commanderService?.getRecentOutput?.(150) || '';
      let delivered = false;
      try { delivered = (await forwarder(brief)) !== false; } catch (error) {
        this.logger.warn?.('voice brain: commander forward failed', { error: error.message });
      }

      if (!delivered) {
        const miss = 'No Commander is running to take that.';
        this.speak(miss);
        return { handled: false, route: 'commander', spoken: miss };
      }

      // Immediate ack, then speak the Commander's actual reply once it settles —
      // in the background, so the request returns now and the answer arrives when
      // the agent is done. This is the two-way loop.
      this.speak('On it.');
      this.captureCommanderReply(before)
        .then((reply) => { if (reply) this.speak(reply, { priority: 'high' }); })
        .catch((error) => this.logger.warn?.('voice brain: reply capture failed', { error: error.message }));

      return { handled: true, route: 'commander', spoken: 'On it.' };
    }

    const miss = "I couldn't do that myself and there's no Commander running to hand it to.";
    this.speak(miss);
    return { handled: false, route: 'none', spoken: miss };
  }

  /** A short spoken confirmation after a command lane hit. */
  confirmCommand(command) {
    const label = String(command || '').replace(/[-_]/g, ' ').trim();
    const say = label ? `Done — ${label}.` : 'Done.';
    this.speak(say);
    return say;
  }
}

module.exports = VoiceBrainService;
module.exports.VoiceBrainService = VoiceBrainService;
