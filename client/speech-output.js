/**
 * Browser speech output.
 *
 * The zero-install half of the voice layer: the server emits `speech-speak` and
 * the page says it with the Web Speech API. This is why speech works on a fresh
 * clone with nothing set up — local backends (piper/say/SAPI) take over on the
 * server side when they exist, and this simply stops receiving events.
 */
(function initSpeechOutput() {
  const synth = window.speechSynthesis;

  const state = {
    enabled: localStorage.getItem('speechOutputEnabled') !== 'false',
    voiceName: localStorage.getItem('speechOutputVoice') || '',
    rate: Number(localStorage.getItem('speechOutputRate')) || 1.05,
    currentAudio: null,
    audioQueue: [],
    pendingGesture: null,
    gestureArmed: false
  };

  function pickVoice() {
    if (!synth) return null;
    const voices = synth.getVoices();
    if (!voices.length) return null;
    if (state.voiceName) {
      const chosen = voices.find((voice) => voice.name === state.voiceName);
      if (chosen) return chosen;
    }
    return voices.find((voice) => /en[-_]/i.test(voice.lang)) || voices[0];
  }

  function speak(text, { priority = 'normal' } = {}) {
    if (!synth || !state.enabled) return false;
    const clean = String(text || '').trim();
    if (!clean) return false;

    // A critical announcement should not queue behind a status readout.
    if (priority === 'high' && synth.speaking) synth.cancel();

    const utterance = new SpeechSynthesisUtterance(clean);
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = state.rate;
    synth.speak(utterance);
    return true;
  }

  // Autoplay is blocked until the page has seen a user gesture, and losing the
  // very first spoken reply to that policy is a silent failure. Hold the most
  // recent blocked clip and replay it on the first interaction.
  function armGestureRetry() {
    if (state.gestureArmed) return;
    state.gestureArmed = true;
    const retry = () => {
      state.gestureArmed = false;
      const pending = state.pendingGesture;
      state.pendingGesture = null;
      if (pending) playAudio(pending);
    };
    window.addEventListener('pointerdown', retry, { once: true, capture: true });
    window.addEventListener('keydown', retry, { once: true, capture: true });
  }

  function stopAudio() {
    state.audioQueue.length = 0;
    if (state.currentAudio) {
      state.currentAudio.pause();
      state.currentAudio = null;
    }
  }

  function startClip(payload) {
    const audio = new Audio(`data:audio/wav;base64,${payload.wav}`);
    state.currentAudio = audio;
    const advance = () => {
      if (state.currentAudio !== audio) return;
      state.currentAudio = null;
      const next = state.audioQueue.shift();
      if (next) startClip(next);
    };
    audio.addEventListener('ended', advance);
    audio.addEventListener('error', advance);
    audio.play().catch(() => {
      // Autoplay blocked — everything queued would fail the same way, so keep
      // only the newest utterance and replay it on the first user gesture.
      state.pendingGesture = state.audioQueue.pop() || payload;
      state.audioQueue.length = 0;
      if (state.currentAudio === audio) state.currentAudio = null;
      armGestureRetry();
    });
  }

  // Play server-synthesized neural audio (piper/kokoro) streamed as a WAV. On
  // WSL the server can't reach the speakers, so it hands the bytes to us — and
  // browser audio always reaches the user. A high-priority clip interrupts;
  // normal clips queue behind whatever is already playing instead of talking
  // over it.
  function playAudio(payload) {
    if (!payload?.wav || !state.enabled) return false;
    try {
      if (payload.priority === 'high') {
        stopAudio();
        if (synth?.speaking) synth.cancel();
        startClip(payload);
        return true;
      }
      if (state.currentAudio) {
        state.audioQueue.push(payload);
        // A stale backlog reads like a haunted radio — keep it short.
        if (state.audioQueue.length > 5) state.audioQueue.shift();
        return true;
      }
      startClip(payload);
      return true;
    } catch {
      return false;
    }
  }

  function attach(socket) {
    if (!socket || socket.__speechOutputAttached) return;
    socket.__speechOutputAttached = true;
    socket.on('speech-speak', (payload) => speak(payload?.text, { priority: payload?.priority }));
    socket.on('speech-audio', (payload) => playAudio(payload));
  }

  window.SpeechOutput = {
    speak,
    attach,
    isSupported: Boolean(synth),
    isEnabled: () => state.enabled,
    setEnabled(enabled) {
      state.enabled = enabled !== false;
      localStorage.setItem('speechOutputEnabled', String(state.enabled));
      if (!state.enabled) {
        if (synth?.speaking) synth.cancel();
        // Muting must silence the streamed neural audio too, not just Web Speech.
        stopAudio();
        state.pendingGesture = null;
      }
      return state.enabled;
    },
    setVoice(name) {
      state.voiceName = String(name || '');
      localStorage.setItem('speechOutputVoice', state.voiceName);
      return state.voiceName;
    },
    listVoices: () => (synth ? synth.getVoices().map((voice) => ({ name: voice.name, lang: voice.lang })) : [])
  };

  // The socket may connect before or after this file runs, so try both.
  if (window.socket) attach(window.socket);
  document.addEventListener('orchestrator-socket-ready', (event) => attach(event.detail?.socket || window.socket));
})();
