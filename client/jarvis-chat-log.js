/**
 * Jarvis conversation log — a persistent chat transcript for the voice layer.
 *
 * The push-to-talk flow was fire-and-forget: the utterance and the reply both
 * vanished after a toast. This panel keeps the whole exchange visible like a
 * chat window: what was heard, what lane handled it, what Jarvis said, and how
 * long each step took. Other scripts feed it via window.jarvisChatLog.add().
 */
(function initJarvisChatLog() {
  const state = { open: localStorage.getItem('jarvisChatLogOpen') !== 'false', lastUserAt: 0 };

  const root = document.createElement('div');
  root.id = 'jarvis-chat-log';
  root.innerHTML = `
    <div class="jcl-header">
      <span>JARVIS LOG</span>
      <button class="jcl-toggle" title="collapse">–</button>
    </div>
    <div class="jcl-messages"></div>
    <form class="jcl-inputrow">
      <input class="jcl-input" type="text" placeholder="Type to JARVIS… (same brain as voice)" autocomplete="off" />
      <button class="jcl-send" type="submit">Send</button>
    </form>
  `;
  const style = document.createElement('style');
  style.textContent = `
    /* Hidden while orphaned; becomes a normal section once adopted into the Alt+J panel. */
    #jarvis-chat-log { display: none; }
    .jarvis-panel #jarvis-chat-log { max-height: 18rem;
      background: #10151d; border: 1px solid #2a3444; border-radius: 0.6rem;
      display: flex; flex-direction: column; font: 0.85rem/1.45 system-ui, sans-serif; color: #fff;
      margin: 0.5rem 0; }
    #jarvis-chat-log .jcl-header { display: flex; justify-content: space-between; align-items: center;
      padding: 0.45rem 0.75rem; color: #5cc8ff; letter-spacing: 0.08em; font-size: 0.75rem;
      border-bottom: 1px solid #2a3444; cursor: default; }
    #jarvis-chat-log .jcl-toggle { background: none; border: none; color: #9fb0c3; cursor: pointer;
      font-size: 1rem; line-height: 1; padding: 0 0.25rem; }
    #jarvis-chat-log .jcl-messages { overflow-y: auto; padding: 0.6rem; display: flex;
      flex-direction: column; gap: 0.45rem; }
    #jarvis-chat-log .jcl-msg { padding: 0.4rem 0.65rem; border-radius: 0.55rem; max-width: 92%;
      white-space: pre-wrap; word-break: break-word; }
    #jarvis-chat-log .jcl-me { background: #1d3a55; align-self: flex-end; }
    #jarvis-chat-log .jcl-jarvis { background: #1b2430; border: 1px solid #2a3444; align-self: flex-start; }
    #jarvis-chat-log .jcl-status { color: #9fb0c3; font-size: 0.75rem; align-self: center;
      background: none; padding: 0.1rem 0; }
    #jarvis-chat-log .jcl-meta { display: block; margin-top: 0.2rem; font-size: 0.7rem; color: #9fb0c3; }
    #jarvis-chat-log .jcl-inputrow { display: flex; gap: 0.4rem; padding: 0.5rem; border-top: 1px solid #2a3444; }
    #jarvis-chat-log .jcl-input { flex: 1; background: #0d1117; border: 1px solid #2a3444; border-radius: 0.45rem;
      color: #fff; padding: 0.4rem 0.6rem; font: inherit; }
    #jarvis-chat-log .jcl-send { background: #5cc8ff; color: #00131f; border: none; border-radius: 0.45rem;
      padding: 0.4rem 0.8rem; font-weight: 700; cursor: pointer; }
    #jarvis-chat-log.jcl-collapsed .jcl-messages, #jarvis-chat-log.jcl-collapsed .jcl-inputrow { display: none; }
    #jarvis-chat-log.jcl-collapsed { max-height: none; width: auto; }
  `;
  document.head.appendChild(style);
  document.body.appendChild(root);

  const messagesEl = root.querySelector('.jcl-messages');
  const toggleBtn = root.querySelector('.jcl-toggle');

  function applyOpen() {
    root.classList.toggle('jcl-collapsed', !state.open);
    toggleBtn.textContent = state.open ? '–' : '+';
    toggleBtn.title = state.open ? 'collapse' : 'expand';
  }
  toggleBtn.addEventListener('click', () => {
    state.open = !state.open;
    localStorage.setItem('jarvisChatLogOpen', String(state.open));
    applyOpen();
  });
  applyOpen();

  let lastStatusEl = null;
  function add(role, text, meta = '') {
    const clean = String(text || '').trim();
    if (!clean) return;
    // Statuses replace the previous status instead of stacking.
    if (role === 'status' && lastStatusEl?.isConnected) lastStatusEl.remove();
    const el = document.createElement('div');
    el.className = `jcl-msg jcl-${role === 'me' ? 'me' : role === 'status' ? 'status' : 'jarvis'}`;
    el.textContent = clean;
    if (meta) {
      const metaEl = document.createElement('span');
      metaEl.className = 'jcl-meta';
      metaEl.textContent = meta;
      el.appendChild(metaEl);
    }
    messagesEl.appendChild(el);
    lastStatusEl = role === 'status' ? el : null;
    if (role === 'me') state.lastUserAt = Date.now();
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // Jarvis replies arrive as socket speech events regardless of which lane
  // produced them, so listening here catches everything that gets spoken.
  const seen = new Set();
  function noteReply(text, source, via) {
    const clean = String(text || '').trim();
    if (!clean) return;
    // speech-speak and speech-audio can both fire for one reply; dedupe briefly.
    const key = clean.slice(0, 80);
    if (seen.has(key)) return;
    seen.add(key);
    setTimeout(() => seen.delete(key), 5000);
    // Only meaningful when this reply follows the user's OWN recent utterance;
    // replies triggered elsewhere (API tests, the manager) get no timer.
    const dt = state.lastUserAt ? (Date.now() - state.lastUserAt) / 1000 : null;
    const latency = dt !== null && dt < 60 ? `answered in ${dt.toFixed(1)}s` : '';
    const tags = [source, via, latency].filter(Boolean).join(' · ');
    add('jarvis', clean, tags);
  }

  function bind(socket) {
    if (!socket?.on) return false;
    socket.on('speech-speak', (p) => noteReply(p?.text, p?.source, 'browser voice'));
    socket.on('speech-audio', (p) => noteReply(p?.text, p?.source, 'kokoro'));
    return true;
  }
  // The shared socket is created by app.js on init; poll briefly until it exists.
  let bindTries = 0;
  const bindTimer = setInterval(() => {
    if (bind(window.orchestrator?.socket || window.socket) || ++bindTries > 240) clearInterval(bindTimer);
  }, 500);

  // The Alt+J panel mounts lazily on first open — adopt the log into it as a
  // section the moment it appears, so the transcript lives inside the panel
  // instead of floating over it. Messages keep accumulating while orphaned.
  const adoptTimer = setInterval(() => {
    const sections = document.querySelector('.jarvis-panel .jarvis-sections');
    if (sections && root.parentElement !== sections) {
      sections.insertBefore(root, sections.firstChild);
      clearInterval(adoptTimer);
    }
  }, 700);

  // Typed input goes through the exact same ladder as speech.
  const form = root.querySelector('.jcl-inputrow');
  const input = root.querySelector('.jcl-input');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    add('me', text, 'typed');
    state.lastUserAt = Date.now();
    add('status', 'thinking…');
    try {
      const r = await fetch('/api/voice/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: text })
      });
      const d = await r.json();
      if (d.success) add('status', `✓ ${d.method || 'done'}`);
      else add('status', `✗ ${d.error || 'not recognized'}`);
      // The spoken reply arrives via the speech socket events and is logged there.
    } catch (err) {
      add('status', `✗ ${err.message}`);
    }
  });

  window.jarvisChatLog = { add };
})();
