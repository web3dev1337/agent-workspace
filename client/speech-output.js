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
    rate: Number(localStorage.getItem('speechOutputRate')) || 1.05
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

  function attach(socket) {
    if (!socket || socket.__speechOutputAttached) return;
    socket.__speechOutputAttached = true;
    socket.on('speech-speak', (payload) => speak(payload?.text, { priority: payload?.priority }));
  }

  window.SpeechOutput = {
    speak,
    attach,
    isSupported: Boolean(synth),
    isEnabled: () => state.enabled,
    setEnabled(enabled) {
      state.enabled = enabled !== false;
      localStorage.setItem('speechOutputEnabled', String(state.enabled));
      if (!state.enabled && synth?.speaking) synth.cancel();
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
