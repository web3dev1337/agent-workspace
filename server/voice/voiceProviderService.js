const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');

const { getAgentWorkspaceDir } = require('../utils/pathUtils');

const KINDS = ['tts', 'stt', 'duplex'];
const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', '..', 'config', 'voice-providers.json');

function overrideConfigPath() {
  return path.join(getAgentWorkspaceDir(), 'voice-providers.json');
}

function commandExists(command) {
  if (!command) return false;
  try {
    const probe = process.platform === 'win32' ? 'where.exe' : 'which';
    return spawnSync(probe, [command], { stdio: 'ignore', windowsHide: true }).status === 0;
  } catch {
    return false;
  }
}

function envSet(name) {
  if (!name) return false;
  const value = String(process.env[name] || '').trim().toLowerCase();
  return value !== '' && value !== 'false' && value !== '0';
}

/**
 * Reach a local model server (PersonaPlex/X-Talk) with a short timeout. Any
 * response at all — even a 404 — means something is listening, which is all we
 * need to know the provider is available.
 */
function serverReachable(endpoint, timeoutMs = 800) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL(endpoint); } catch { return resolve(false); }
    const req = http.request(
      { method: 'HEAD', hostname: url.hostname, port: url.port || 80, path: url.pathname || '/', timeout: timeoutMs },
      (res) => { res.resume(); resolve(true); }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The swappable voice-model registry.
 *
 * A model is DATA (`config/voice-providers.json`), so adding one is a config
 * entry, never code. This service loads that registry, health-checks each
 * provider (is the command / model server actually present?), and resolves the
 * ONE active provider per capability — where 'auto' means "the best-quality one
 * that passes its health check". Everything degrades: a provider whose model
 * isn't installed simply reports unavailable and is skipped.
 */
class VoiceProviderService {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this.config = null;
  }

  static getInstance(options = {}) {
    if (!VoiceProviderService.instance) {
      VoiceProviderService.instance = new VoiceProviderService(options);
    }
    return VoiceProviderService.instance;
  }

  init({ speechService } = {}) {
    this.speechService = speechService || this.speechService;
    return this;
  }

  /**
   * Push the resolved active TTS provider into the speech service so a swap
   * actually changes what speaks. No-op if speech isn't wired.
   */
  async applyActiveTts() {
    if (!this.speechService?.setActiveEngine) return null;
    const provider = await this.resolveActive('tts');
    if (provider) {
      // resolveActive just health-checked this provider (including any HTTP
      // model server), so the speech service can trust it as available.
      this.speechService.setActiveEngine(provider.engine, { command: provider.requires?.command || '', verified: true });
    } else if (this.activeKey('tts') === 'none') {
      // An explicit "none" must actually mute TTS — doing nothing here left
      // the previously active backend still speaking.
      this.speechService.setActiveEngine('none');
    }
    return provider;
  }

  configPath() {
    return readJson(overrideConfigPath()) ? overrideConfigPath() : DEFAULT_CONFIG_PATH;
  }

  load({ force = false } = {}) {
    if (this.config && !force) return this.config;
    const raw = readJson(this.configPath()) || {};
    const providers = (Array.isArray(raw.providers) ? raw.providers : [])
      .filter((p) => p && p.id && KINDS.includes(p.kind))
      .map((p) => ({
        id: String(p.id),
        kind: p.kind,
        label: String(p.label || p.id),
        engine: String(p.engine || p.id),
        local: p.local === true,
        quality: Number.isFinite(Number(p.quality)) ? Number(p.quality) : 3,
        requires: p.requires && typeof p.requires === 'object' ? p.requires : {},
        endpoint: String(p.endpoint || ''),
        transport: String(p.transport || ''),
        install: String(p.install || ''),
        notes: String(p.notes || '')
      }));

    this.config = {
      source: this.configPath(),
      activeTts: String(raw.activeTts || 'auto'),
      activeStt: String(raw.activeStt || 'auto'),
      activeDuplex: String(raw.activeDuplex || 'none'),
      providers
    };
    return this.config;
  }

  invalidate() {
    this.config = null;
  }

  list(kind = null) {
    const { providers } = this.load();
    return kind ? providers.filter((p) => p.kind === kind) : providers;
  }

  get(id) {
    return this.load().providers.find((p) => p.id === id) || null;
  }

  /**
   * Is this provider usable right now? A missing command / unset env / no model
   * server means "not available" — never an error.
   */
  async checkAvailability(provider) {
    if (!provider) return { available: false, reason: 'unknown provider' };
    const req = provider.requires || {};

    // TTS engines the speech service owns: defer to its real detection (which
    // includes piper voice-model auto-discovery) so the registry and the thing
    // that actually speaks never disagree.
    const nativeTts = { browser: 'browser', piper: 'piper', espeak: 'espeak', say: 'say', sapi: 'sapi' };
    if (provider.kind === 'tts' && nativeTts[provider.engine] && this.speechService?.detectBackends) {
      const backend = this.speechService.detectBackends({ force: true }).find((b) => b.id === nativeTts[provider.engine]);
      if (backend) {
        return backend.available
          ? { available: true }
          : { available: false, reason: `${provider.engine} not ready`, install: provider.install };
      }
    }

    if (req.command && !commandExists(req.command)) {
      return { available: false, reason: `command "${req.command}" not found`, install: provider.install };
    }
    if (req.env && !envSet(req.env)) {
      return { available: false, reason: `env ${req.env} not set` };
    }
    if (req.server) {
      const up = await serverReachable(provider.endpoint || req.server);
      if (!up) return { available: false, reason: `no server at ${provider.endpoint || req.server}`, install: provider.install };
    }
    // The browser TTS backend has no local requirement and is always usable.
    return { available: true };
  }

  async listWithHealth(kind = null) {
    const providers = this.list(kind);
    return Promise.all(providers.map(async (p) => ({ ...p, ...(await this.checkAvailability(p)) })));
  }

  activeKey(kind) {
    const cfg = this.load();
    return { tts: cfg.activeTts, stt: cfg.activeStt, duplex: cfg.activeDuplex }[kind];
  }

  /**
   * The active provider for a capability. 'none' -> null; 'auto' -> the highest
   * quality available one; an explicit id -> that provider if available, else
   * fall back to auto so a broken pin never silently disables voice.
   */
  async resolveActive(kind) {
    const key = this.activeKey(kind);
    if (key === 'none') return null;

    // A pin only needs its own health check — cheap, and avoids HTTP-probing
    // every other model server just to confirm the one you chose.
    if (key && key !== 'auto') {
      const pinned = this.get(key);
      if (pinned && pinned.kind === kind) {
        const health = await this.checkAvailability(pinned);
        if (health.available) return { ...pinned, ...health };
      }
      // pinned is gone/unavailable — fall back to auto rather than muting.
    }

    const withHealth = await this.listWithHealth(kind);
    return withHealth.filter((p) => p.available).sort((a, b) => b.quality - a.quality)[0] || null;
  }

  /**
   * Persist the active provider for a capability into the machine-local
   * override file, so it survives restarts without editing the shipped config.
   */
  setActive(kind, id) {
    if (!KINDS.includes(kind)) throw new Error(`Unknown capability "${kind}" (expected ${KINDS.join('|')})`);
    if (id !== 'auto' && id !== 'none') {
      const provider = this.get(id);
      if (!provider) throw new Error(`Unknown voice provider "${id}"`);
      if (provider.kind !== kind) throw new Error(`Provider "${id}" is a ${provider.kind}, not a ${kind}`);
    }

    const target = overrideConfigPath();
    const current = readJson(target) || readJson(DEFAULT_CONFIG_PATH) || {};
    const field = { tts: 'activeTts', stt: 'activeStt', duplex: 'activeDuplex' }[kind];
    current[field] = id;

    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, target);
    this.invalidate();
    // A TTS swap takes effect immediately.
    if (kind === 'tts') this.applyActiveTts().catch(() => {});
    return { kind, active: id };
  }

  async getStatus() {
    const [tts, stt, duplex] = await Promise.all([
      this.resolveActive('tts'),
      this.resolveActive('stt'),
      this.resolveActive('duplex')
    ]);
    return {
      source: this.load().source,
      active: {
        tts: { selected: this.activeKey('tts'), resolved: tts?.id || null, label: tts?.label || null },
        stt: { selected: this.activeKey('stt'), resolved: stt?.id || null, label: stt?.label || null },
        duplex: { selected: this.activeKey('duplex'), resolved: duplex?.id || null, label: duplex?.label || null }
      },
      providers: await this.listWithHealth()
    };
  }
}

module.exports = VoiceProviderService;
module.exports.VoiceProviderService = VoiceProviderService;
module.exports.KINDS = KINDS;
module.exports.DEFAULT_CONFIG_PATH = DEFAULT_CONFIG_PATH;
module.exports.overrideConfigPath = overrideConfigPath;
