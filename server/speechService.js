const os = require('os');
const { spawn, spawnSync } = require('child_process');

const { augmentProcessEnv, getHiddenProcessOptions } = require('./utils/processUtils');

const MAX_SPOKEN_CHARS = 400;
const REPEAT_WINDOW_MS = 30_000;
const HISTORY_LIMIT = 50;

/**
 * Anything spoken aloud is short, plain, and free of shell metacharacters.
 * Terminal output is full of escape sequences and punctuation that no
 * synthesizer should try to read and no command line should ever receive.
 */
function sanitizeForSpeech(text) {
  return String(text || '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, ' ')
    .replace(/[`$\\|&;<>(){}[\]]/g, ' ')
    .replace(/[^\x20-\x7EÀ-ɏ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SPOKEN_CHARS);
}

function commandExists(command) {
  try {
    const probe = process.platform === 'win32' ? 'where.exe' : 'which';
    return spawnSync(probe, [command], { stdio: 'ignore', windowsHide: true }).status === 0;
  } catch {
    return false;
  }
}

/**
 * Speech output for the orchestrator.
 *
 * The default backend is the browser's own speech synthesis, reached by emitting
 * a socket event — it needs nothing installed, which is the difference between a
 * feature people use and a feature people mean to set up. Local backends take
 * over when they exist and are preferred.
 */
class SpeechService {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this.io = null;
    this.enabled = String(process.env.SPEECH_ENABLED || 'true').toLowerCase() !== 'false';
    this.preferredBackend = String(process.env.SPEECH_BACKEND || '').trim().toLowerCase();
    this.piperModel = String(process.env.PIPER_MODEL || '').trim();
    this.voice = String(process.env.SPEECH_VOICE || '').trim();
    this.history = [];
    this.lastSpokenAt = new Map();
    this.backendCache = null;
  }

  static getInstance(options = {}) {
    if (!SpeechService.instance) {
      SpeechService.instance = new SpeechService(options);
    }
    return SpeechService.instance;
  }

  setIO(io) {
    this.io = io;
    return this;
  }

  setEnabled(enabled) {
    this.enabled = enabled !== false;
    return this.enabled;
  }

  detectBackends({ force = false } = {}) {
    if (this.backendCache && !force) return this.backendCache;

    const backends = [
      { id: 'browser', label: 'Browser speech synthesis', available: true, local: false },
      { id: 'piper', label: 'Piper (local neural TTS)', available: commandExists('piper') && Boolean(this.piperModel), local: true },
      { id: 'say', label: 'macOS say', available: os.platform() === 'darwin' && commandExists('say'), local: true },
      { id: 'sapi', label: 'Windows SAPI', available: os.platform() === 'win32', local: true },
      { id: 'espeak', label: 'espeak-ng', available: commandExists('espeak-ng') || commandExists('espeak'), local: true }
    ];

    this.backendCache = backends;
    return backends;
  }

  resolveBackend() {
    const backends = this.detectBackends();
    if (this.preferredBackend) {
      const preferred = backends.find((b) => b.id === this.preferredBackend);
      if (preferred?.available) return preferred.id;
    }
    // Local synthesis is better than round-tripping through a browser tab that
    // may not be open, so it wins whenever it is actually installed.
    const local = backends.find((b) => b.local && b.available);
    return local ? local.id : 'browser';
  }

  setBackend(backendId) {
    const backend = this.detectBackends({ force: true }).find((b) => b.id === backendId);
    if (!backend) throw new Error(`Unknown speech backend "${backendId}"`);
    if (!backend.available) throw new Error(`Speech backend "${backendId}" is not available on this machine`);
    this.preferredBackend = backendId;
    return backendId;
  }

  isRepeat(text) {
    const last = this.lastSpokenAt.get(text);
    return Boolean(last && Date.now() - last < REPEAT_WINDOW_MS);
  }

  record(entry) {
    this.history.unshift(entry);
    if (this.history.length > HISTORY_LIMIT) this.history.length = HISTORY_LIMIT;
    return entry;
  }

  speakViaBrowser(text, priority) {
    if (!this.io) return { spoken: false, reason: 'no socket connection to a client' };
    this.io.emit('speech-speak', { text, priority, at: new Date().toISOString() });
    return { spoken: true };
  }

  spawnQuiet(command, args) {
    try {
      const child = spawn(command, args, {
        ...getHiddenProcessOptions({ stdio: 'ignore', detached: false }),
        env: augmentProcessEnv(process.env)
      });
      child.on('error', (error) => this.logger.warn?.('Speech backend failed', { command, error: error.message }));
      child.unref?.();
      return { spoken: true };
    } catch (error) {
      return { spoken: false, reason: error.message };
    }
  }

  /**
   * Piper emits raw PCM on stdout, so it is piped straight into a player
   * rather than through a shell — the text never touches a command line.
   */
  speakViaPiper(text) {
    const player = ['paplay', 'aplay'].find((candidate) => commandExists(candidate));
    if (!player) return { spoken: false, reason: 'piper is installed but no audio player was found' };

    const playerArgs = player === 'aplay'
      ? ['-q', '-r', '22050', '-f', 'S16_LE', '-t', 'raw', '-']
      : ['--raw', '--rate=22050', '--format=s16le', '--channels=1'];

    try {
      const env = augmentProcessEnv(process.env);
      const piper = spawn('piper', ['--model', this.piperModel, '--output-raw'], { stdio: ['pipe', 'pipe', 'ignore'], env });
      const playback = spawn(player, playerArgs, { stdio: ['pipe', 'ignore', 'ignore'], env });

      piper.on('error', (error) => this.logger.warn?.('Piper failed', { error: error.message }));
      playback.on('error', (error) => this.logger.warn?.('Audio playback failed', { player, error: error.message }));

      piper.stdout.pipe(playback.stdin);
      piper.stdin.end(`${text}\n`);
      return { spoken: true };
    } catch (error) {
      return { spoken: false, reason: error.message };
    }
  }

  speakLocally(backendId, text) {
    if (backendId === 'say') {
      return this.spawnQuiet('say', this.voice ? ['-v', this.voice, text] : [text]);
    }
    if (backendId === 'espeak') {
      const binary = commandExists('espeak-ng') ? 'espeak-ng' : 'espeak';
      return this.spawnQuiet(binary, [text]);
    }
    if (backendId === 'piper') return this.speakViaPiper(text);
    if (backendId === 'sapi') {
      // Text is already sanitized to printable ASCII with no shell metacharacters;
      // single quotes are doubled because PowerShell escapes them that way.
      const escaped = text.replace(/'/g, "''");
      return this.spawnQuiet('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('${escaped}')`
      ]);
    }
    return { spoken: false, reason: `no local handler for "${backendId}"` };
  }

  /**
   * Say something. Never throws — speech failing must not take down whatever
   * was trying to talk.
   */
  speak(rawText, { priority = 'normal', force = false } = {}) {
    const text = sanitizeForSpeech(rawText);
    if (!text) return { spoken: false, reason: 'nothing to say' };
    if (!this.enabled) return this.record({ text, at: new Date().toISOString(), spoken: false, reason: 'speech disabled' });
    if (!force && this.isRepeat(text)) {
      return this.record({ text, at: new Date().toISOString(), spoken: false, reason: 'just said that' });
    }

    const backend = this.resolveBackend();
    let result;
    try {
      result = backend === 'browser' ? this.speakViaBrowser(text, priority) : this.speakLocally(backend, text);
    } catch (error) {
      result = { spoken: false, reason: error.message };
    }

    if (result.spoken) this.lastSpokenAt.set(text, Date.now());
    return this.record({ text, backend, priority, at: new Date().toISOString(), ...result });
  }

  getStatus() {
    return {
      enabled: this.enabled,
      backend: this.resolveBackend(),
      preferredBackend: this.preferredBackend || null,
      backends: this.detectBackends(),
      // The browser backend only actually makes noise if a page is listening.
      connectedClients: Number(this.io?.engine?.clientsCount ?? 0),
      recent: this.history.slice(0, 10)
    };
  }
}

module.exports = SpeechService;
module.exports.SpeechService = SpeechService;
module.exports.sanitizeForSpeech = sanitizeForSpeech;
