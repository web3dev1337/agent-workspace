const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const { augmentProcessEnv, getHiddenProcessOptions } = require('./utils/processUtils');

const MAX_SPOKEN_CHARS = 400;
const REPEAT_WINDOW_MS = 30_000;
const HISTORY_LIMIT = 50;

// Where `piper` voices land after `piper.download_voices` or a manual fetch —
// checked when PIPER_MODEL is unset so the local voice works out of the box.
const PIPER_VOICE_DIRS = [
  path.join(os.homedir(), '.local', 'share', 'piper-voices'),
  path.join(os.homedir(), '.local', 'share', 'piper')
];

function discoverPiperModel() {
  for (const dir of PIPER_VOICE_DIRS) {
    try {
      const onnx = fs.readdirSync(dir).find((f) => f.endsWith('.onnx'));
      if (onnx) return path.join(dir, onnx);
    } catch {
      // Directory absent — try the next.
    }
  }
  return '';
}

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
    this.piperModel = String(process.env.PIPER_MODEL || '').trim() || discoverPiperModel();
    // Piper models declare their sample rate in the companion .onnx.json.
    this.piperSampleRate = 22050;
    try {
      if (this.piperModel && fs.existsSync(`${this.piperModel}.json`)) {
        const cfg = JSON.parse(fs.readFileSync(`${this.piperModel}.json`, 'utf8'));
        this.piperSampleRate = Number(cfg?.audio?.sample_rate) || 22050;
      }
    } catch { /* keep the default */ }
    this.voice = String(process.env.SPEECH_VOICE || '').trim();
    // A generic local TTS CLI (kokoro-tts, chatterbox, …): reads text on stdin,
    // writes raw s16le PCM on stdout. Set by the provider registry when one of
    // those is the active engine; empty otherwise.
    this.cliEngine = String(process.env.SPEECH_CLI_ENGINE || '').trim();
    // Warm neural TTS HTTP servers (model kept loaded, POST /synthesize -> WAV).
    // piper: fast (~0.2s), decent. kokoro: natural (~2s CPU), the nicer voice.
    this.piperHttpUrl = String(process.env.PIPER_HTTP_URL || 'http://127.0.0.1:5959').replace(/\/$/, '');
    this.kokoroHttpUrl = String(process.env.KOKORO_HTTP_URL || 'http://127.0.0.1:5732').replace(/\/$/, '');
    this.history = [];
    this.lastSpokenAt = new Map();
    this.backendCache = null;
    // Backends the provider registry has actually health-checked (its server
    // probe is async and lives there) — sync detection below can trust these.
    this.verifiedBackends = new Set();
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

    // The warm HTTP servers can't be probed synchronously here, so they count
    // as available only on an explicit opt-in signal: the env var was set, or
    // the provider registry health-checked the server (verifiedBackends). The
    // old `Boolean(this.kokoroHttpUrl)` was ALWAYS true (the URL has a
    // default), which reported kokoro available on every machine and made a
    // dead kokoro selectable — with no fallback, that was total silence.
    const backends = [
      { id: 'browser', label: 'Browser speech synthesis', available: true, local: false },
      {
        id: 'piper',
        label: 'Piper (local neural TTS)',
        available: (commandExists('piper') && Boolean(this.piperModel))
          || Boolean(process.env.PIPER_HTTP_URL)
          || this.verifiedBackends.has('piper'),
        local: true
      },
      {
        id: 'kokoro',
        label: 'Kokoro (local neural, natural)',
        available: Boolean(process.env.KOKORO_HTTP_URL)
          || this.verifiedBackends.has('kokoro')
          || (Boolean(this.cliEngine) && commandExists(this.cliEngine)),
        local: true
      },
      { id: 'say', label: 'macOS say', available: os.platform() === 'darwin' && commandExists('say'), local: true },
      { id: 'sapi', label: 'Windows SAPI', available: os.platform() === 'win32', local: true },
      { id: 'espeak', label: 'espeak-ng', available: commandExists('espeak-ng') || commandExists('espeak'), local: true }
    ];

    this.backendCache = backends;
    return backends;
  }

  resolveBackend() {
    // 'none' is an explicit "voice off" from the provider registry, not a
    // backend to fall back from.
    if (this.preferredBackend === 'none') return 'none';
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

  /**
   * Apply a voice-provider registry choice. Unlike setBackend this never throws
   * and re-detects afterward — the registry is the source of truth for which
   * model speaks, and a generic-CLI engine (kokoro/chatterbox) changes what is
   * available. `engine` is the provider's engine; `command` its CLI binary.
   */
  setActiveEngine(engine, { command = '', verified = false } = {}) {
    if (engine === 'none') {
      // The registry chose "voice off" — that must actually silence TTS, not
      // leave whatever backend was previously active still speaking.
      this.preferredBackend = 'none';
      this.backendCache = null;
      return 'none';
    }
    const map = { browser: 'browser', piper: 'piper', espeak: 'espeak', say: 'say', sapi: 'sapi', kokoro: 'kokoro' };
    const backend = map[engine] || 'browser';
    if (backend === 'kokoro' && command) this.cliEngine = command;
    // The registry health-checks its providers (including HTTP-server
    // reachability) before applying one — remember that so the sync
    // availability detection above doesn't veto a probe that already passed.
    if (verified) this.verifiedBackends.add(backend);
    this.preferredBackend = backend;
    this.backendCache = null;
    return this.resolveBackend();
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
    this.io.emit('speech-speak', { text, priority, source: this.currentSource || '', at: new Date().toISOString() });
    return { spoken: true };
  }

  /** Wrap raw s16le mono PCM in a minimal WAV container for browser playback. */
  pcmToWav(pcm, sampleRate = 22050) {
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);       // PCM chunk size
    header.writeUInt16LE(1, 20);        // format = PCM
    header.writeUInt16LE(1, 22);        // mono
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28); // byte rate (16-bit mono)
    header.writeUInt16LE(2, 32);        // block align
    header.writeUInt16LE(16, 34);       // bits per sample
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
  }

  /**
   * Synthesize with piper and STREAM the audio to the browser to play, instead
   * of server-side paplay. On WSL, server-side PulseAudio (WSLg) often doesn't
   * reach the user's speakers, but browser audio always does — so this is the
   * reliable way to hear a local neural voice.
   *
   * Returns {spoken:true} optimistically and does the synth in the background
   * (like the spawn path), emitting `speech-audio` when the WAV is ready.
   */
  speakViaNeuralBrowser(engine, text, priority) {
    if (!this.io) return { spoken: false, reason: 'no socket connection to a client' };
    const httpUrl = engine === 'kokoro' ? this.kokoroHttpUrl : this.piperHttpUrl;
    // Only piper has a local spawn fallback; kokoro is HTTP-only.
    this.synthAndEmit(text, priority, httpUrl, engine !== 'kokoro')
      .catch((error) => this.logger.warn?.(`${engine} synth failed`, { error: error.message }));
    return { spoken: true };
  }

  emitAudio(wavBuffer, priority, text = '') {
    if (!wavBuffer?.length) return;
    this.io?.emit('speech-audio', { wav: wavBuffer.toString('base64'), priority, text, source: this.currentSource || '', at: new Date().toISOString() });
  }

  async synthAndEmit(text, priority, httpUrl = this.piperHttpUrl, allowSpawnFallback = true) {
    // Fast path: a warm HTTP TTS server keeps the model loaded, so synth is
    // ~0.2s (piper) / ~2s (kokoro) instead of a multi-second cold start.
    if (httpUrl) {
      try {
        const resp = await fetch(`${httpUrl}/synthesize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
          signal: AbortSignal.timeout(20000)
        });
        if (resp.ok) {
          this.emitAudio(Buffer.from(await resp.arrayBuffer()), priority, text);
          return;
        }
      } catch {
        // Server down/unreachable — fall through to the next option.
      }
    }

    // Fallback: spawn piper once (cold, slower) and wrap its raw PCM as WAV.
    if (allowSpawnFallback && this.piperModel && commandExists('piper')) {
      const pcm = await new Promise((resolve) => {
        try {
          const env = augmentProcessEnv(process.env);
          const piper = spawn('piper', ['--model', this.piperModel, '--output-raw'], { stdio: ['pipe', 'pipe', 'ignore'], env });
          const chunks = [];
          piper.stdout.on('data', (d) => chunks.push(d));
          piper.on('error', () => resolve(Buffer.alloc(0)));
          piper.on('close', () => resolve(Buffer.concat(chunks)));
          piper.stdin.end(`${text}\n`);
        } catch {
          resolve(Buffer.alloc(0));
        }
      });
      if (pcm.length) {
        this.emitAudio(this.pcmToWav(pcm, this.piperSampleRate || 22050), priority, text);
        return;
      }
    }

    // Neural synthesis failed outright (server down, spawn produced nothing).
    // Never go silent — hand the text to the browser's own speech synthesis so
    // the utterance is still heard, and leave a trace of why.
    this.logger.warn?.('Neural TTS failed — falling back to browser speech', { httpUrl });
    this.io?.emit('speech-speak', { text, priority, source: this.currentSource || '', at: new Date().toISOString() });
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

  /**
   * A generic local neural TTS CLI (kokoro-tts, chatterbox, …). Same contract
   * as piper: text in on stdin, raw s16le PCM out on stdout, piped to a player
   * so the text never touches a shell.
   */
  speakViaCli(engine, text) {
    if (!engine) return { spoken: false, reason: 'no local CLI TTS engine configured' };
    const player = ['paplay', 'aplay'].find((candidate) => commandExists(candidate));
    if (!player) return { spoken: false, reason: `${engine} is installed but no audio player was found` };

    const playerArgs = player === 'aplay'
      ? ['-q', '-r', '24000', '-f', 'S16_LE', '-t', 'raw', '-']
      : ['--raw', '--rate=24000', '--format=s16le', '--channels=1'];

    try {
      const env = augmentProcessEnv(process.env);
      const tts = spawn(engine, ['--output-raw'], { stdio: ['pipe', 'pipe', 'ignore'], env });
      const playback = spawn(player, playerArgs, { stdio: ['pipe', 'ignore', 'ignore'], env });
      tts.on('error', (error) => this.logger.warn?.(`${engine} failed`, { error: error.message }));
      playback.on('error', (error) => this.logger.warn?.('Audio playback failed', { player, error: error.message }));
      tts.stdout.pipe(playback.stdin);
      tts.stdin.end(`${text}\n`);
      return { spoken: true };
    } catch (error) {
      return { spoken: false, reason: error.message };
    }
  }

  speakLocally(backendId, text, priority) {
    if (backendId === 'say') {
      return this.spawnQuiet('say', this.voice ? ['-v', this.voice, text] : [text]);
    }
    if (backendId === 'espeak') {
      const binary = commandExists('espeak-ng') ? 'espeak-ng' : 'espeak';
      return this.spawnQuiet(binary, [text]);
    }
    // On WSL, server-side PulseAudio usually can't reach the speakers, so when a
    // browser is connected, stream the neural audio there (reliably audible).
    const hasClient = Number(this.io?.engine?.clientsCount ?? 0) > 0;
    if (backendId === 'piper') {
      return hasClient ? this.speakViaNeuralBrowser('piper', text, priority) : this.speakViaPiper(text);
    }
    if (backendId === 'kokoro') {
      // kokoro is a warm HTTP neural server streamed to the browser.
      if (hasClient) return this.speakViaNeuralBrowser('kokoro', text, priority);
      return this.speakViaCli(this.cliEngine, text); // headless fallback if a CLI engine is set
    }
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
  speak(rawText, { priority = 'normal', force = false, source = '' } = {}) {
    this.currentSource = source;
    const text = sanitizeForSpeech(rawText);
    if (!text) return { spoken: false, reason: 'nothing to say' };
    if (!this.enabled) return this.record({ text, at: new Date().toISOString(), spoken: false, reason: 'speech disabled' });
    if (!force && this.isRepeat(text)) {
      return this.record({ text, at: new Date().toISOString(), spoken: false, reason: 'just said that' });
    }

    const backend = this.resolveBackend();
    if (backend === 'none') {
      return this.record({ text, backend, at: new Date().toISOString(), spoken: false, reason: 'tts provider set to none' });
    }
    let result;
    try {
      result = backend === 'browser' ? this.speakViaBrowser(text, priority) : this.speakLocally(backend, text, priority);
    } catch (error) {
      result = { spoken: false, reason: error.message };
    }

    if (result.spoken) {
      const now = Date.now();
      // Entries older than the repeat window are dead weight — prune them so
      // this dedup map can't grow unbounded over a long-lived server.
      for (const [key, at] of this.lastSpokenAt) {
        if (now - at >= REPEAT_WINDOW_MS) this.lastSpokenAt.delete(key);
      }
      this.lastSpokenAt.set(text, now);
    }
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
