/**
 * Realtime voice loop against a Codex thread.
 *
 * Two paths exist, and they have different maturity:
 *
 *   TEXT (default, works today) — browser speech recognition transcribes you,
 *   the text goes to `thread/realtime/appendText`, and the assistant's
 *   transcript deltas come back over the socket and are spoken by SpeechOutput.
 *   A complete hands-free loop with nothing to install.
 *
 *   AUDIO (wired, unverified) — raw capture straight to `appendAudio`. The
 *   protocol accepts it, but the exact PCM framing has not been confirmed
 *   against a live authenticated realtime session, so it is opt-in and the text
 *   path stays the default rather than pretending otherwise.
 */
(function initRealtimeVoice() {
  const api = async (path, options = {}) => {
    const token = window.AUTH_TOKEN || localStorage.getItem('authToken') || '';
    const response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'X-Auth-Token': token } : {}),
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || `${path} -> ${response.status}`);
    return data;
  };

  class RealtimeVoice {
    constructor() {
      this.threadId = null;
      this.active = false;
      this.recognition = null;
      this.listening = false;
      this.transcript = [];
      this.listeners = new Set();
      this.speakReplies = true;
    }

    onUpdate(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }

    emit() {
      for (const listener of this.listeners) {
        try {
          listener(this.getState());
        } catch {
          // A broken listener must not stop the conversation.
        }
      }
    }

    attach(socket) {
      if (!socket || socket.__realtimeVoiceAttached) return;
      socket.__realtimeVoiceAttached = true;

      socket.on('app-server-transcript', (entry) => {
        // These events are broadcast to every client. Only react to our own
        // thread's — otherwise a second tab on a different thread would hear
        // this one's replies spoken aloud.
        if (!this.threadId || entry?.threadId !== this.threadId) return;

        this.transcript.unshift(entry);
        if (this.transcript.length > 100) this.transcript.length = 100;

        // Only speak completed assistant turns — speaking every delta would
        // stutter, and speaking your own words back is absurd.
        if (this.speakReplies && entry.done && entry.role !== 'user' && entry.text) {
          window.SpeechOutput?.speak(entry.text, { priority: 'normal' });
        }
        this.emit();
      });

      socket.on('app-server-realtime', ({ event, payload }) => {
        // Same fleet-wide broadcast: ignore other threads' lifecycle events so
        // one thread closing can't stop this tab from listening.
        const threadId = payload?.threadId || null;
        if (this.threadId && threadId && threadId !== this.threadId) return;

        if (event === 'thread/realtime/started') this.active = true;
        if (event === 'thread/realtime/closed' || event === 'thread/realtime/error') {
          this.active = false;
          this.stopListening();
        }
        this.emit();
      });
    }

    async start(threadId, { voice = '', transport = 'websocket' } = {}) {
      if (!threadId) throw new Error('A realtime session needs a thread id');
      await api(`/api/app-server/realtime/${encodeURIComponent(threadId)}/start`, {
        method: 'POST',
        body: JSON.stringify({ voice, transport })
      });
      this.threadId = threadId;
      this.active = true;
      this.emit();
      return { threadId, active: true };
    }

    async stop() {
      this.stopListening();
      if (this.threadId) {
        await api(`/api/app-server/realtime/${encodeURIComponent(this.threadId)}/stop`, { method: 'POST', body: '{}' })
          .catch(() => {});
      }
      this.active = false;
      this.emit();
      return { active: false };
    }

    async say(text) {
      const clean = String(text || '').trim();
      if (!clean) return null;
      if (!this.threadId) throw new Error('No realtime session is open');

      this.transcript.unshift({ role: 'user', text: clean, done: true, at: new Date().toISOString(), local: true });
      this.emit();

      return api(`/api/app-server/realtime/${encodeURIComponent(this.threadId)}/text`, {
        method: 'POST',
        body: JSON.stringify({ text: clean })
      });
    }

    /**
     * Continuous listening. Interim results are ignored — only a finalized
     * phrase is worth sending, otherwise the agent receives half-sentences.
     */
    startListening() {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) throw new Error('This browser has no speech recognition');
      if (this.listening) return true;

      this.recognition = new SpeechRecognition();
      this.recognition.continuous = true;
      this.recognition.interimResults = false;
      this.recognition.lang = 'en-US';

      this.recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          if (!result.isFinal) continue;
          const text = String(result[0]?.transcript || '').trim();
          if (text) this.say(text).catch(() => {});
        }
      };

      // Continuous recognition stops itself periodically; restart while wanted.
      this.recognition.onend = () => {
        if (this.listening) {
          try {
            this.recognition.start();
          } catch {
            this.listening = false;
            this.emit();
          }
        }
      };

      this.recognition.onerror = () => {};

      this.recognition.start();
      this.listening = true;
      this.emit();
      return true;
    }

    stopListening() {
      this.listening = false;
      try {
        this.recognition?.stop();
      } catch {
        // Already stopped.
      }
      this.recognition = null;
      this.emit();
    }

    toggleListening() {
      return this.listening ? this.stopListening() : this.startListening();
    }

    setSpeakReplies(enabled) {
      this.speakReplies = enabled !== false;
      return this.speakReplies;
    }

    async listVoices() {
      const result = await api('/api/app-server/realtime/voices');
      return result.voices || [];
    }

    async listThreads() {
      const result = await api('/api/app-server/threads');
      return result.threads || [];
    }

    getState() {
      return {
        threadId: this.threadId,
        active: this.active,
        listening: this.listening,
        speakReplies: this.speakReplies,
        transcript: this.transcript.slice(0, 30)
      };
    }
  }

  const realtime = new RealtimeVoice();
  window.RealtimeVoice = realtime;

  if (window.socket) realtime.attach(window.socket);
  document.addEventListener('orchestrator-socket-ready', (event) => realtime.attach(event.detail?.socket || window.socket));
})();
