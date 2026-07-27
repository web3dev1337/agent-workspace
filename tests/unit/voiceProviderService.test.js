const fs = require('fs');
const os = require('os');
const path = require('path');

const { VoiceProviderService, DEFAULT_CONFIG_PATH } = require('../../server/voice/voiceProviderService');

// A speech service stand-in whose backend availability the tests control.
const fakeSpeech = (available = {}) => ({
  applied: [],
  detectBackends() {
    return [
      { id: 'browser', available: true },
      { id: 'piper', available: available.piper === true },
      { id: 'espeak', available: available.espeak === true }
    ];
  },
  setActiveEngine(engine, opts) { this.applied.push({ engine, ...opts }); return engine; }
});

const service = (over = {}) => {
  const s = new VoiceProviderService({ logger: { warn() {}, error() {} } });
  if (over.env) process.env.AGENT_WORKSPACE_DIR = over.env;
  return s;
};

// A hermetic service whose provider set is fixed, so resolution assertions
// don't depend on which real model servers (kokoro/piper HTTP) happen to be up
// on the machine running the tests.
const tmpDirs = [];
const controlledService = (providers, actives = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-ctl-'));
  tmpDirs.push(dir);
  fs.writeFileSync(path.join(dir, 'voice-providers.json'), JSON.stringify({
    activeTts: actives.tts || 'auto', activeStt: actives.stt || 'auto', activeDuplex: actives.duplex || 'none',
    providers
  }));
  process.env.AGENT_WORKSPACE_DIR = dir;
  return new VoiceProviderService({ logger: { warn() {}, error() {} } });
};

// Two TTS providers whose availability the fake speech service controls.
const TTS_SET = [
  { id: 'browser', kind: 'tts', engine: 'browser', quality: 2 },
  { id: 'piper', kind: 'tts', engine: 'piper', quality: 3 }
];

afterEach(() => {
  delete process.env.AGENT_WORKSPACE_DIR;
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
});

describe('VoiceProviderService', () => {
  test('loads the shipped registry with tts/stt/duplex providers', () => {
    const cfg = service().load();
    expect(cfg.providers.length).toBeGreaterThan(0);
    expect(service().list('tts').length).toBeGreaterThan(0);
    expect(service().list('stt').length).toBeGreaterThan(0);
    expect(service().list('duplex').length).toBeGreaterThan(0);
    expect(cfg.source).toBe(DEFAULT_CONFIG_PATH);
  });

  test('a provider whose model is absent reports unavailable, never throws', async () => {
    const s = service();
    const health = await s.checkAvailability(s.get('personaplex'));
    expect(health.available).toBe(false);
    expect(health.reason).toMatch(/no server/);
    expect(health.install).toBeTruthy();
  });

  test('browser TTS is always available (no local requirement)', async () => {
    const s = service();
    expect((await s.checkAvailability(s.get('browser'))).available).toBe(true);
  });

  test('TTS health defers to the speech service so they never disagree', async () => {
    const s = service();
    s.init({ speechService: fakeSpeech({ piper: true }) });
    expect((await s.checkAvailability(s.get('piper'))).available).toBe(true);

    const s2 = service();
    s2.init({ speechService: fakeSpeech({ piper: false }) });
    expect((await s2.checkAvailability(s2.get('piper'))).available).toBe(false);
  });

  test('auto resolves to the highest-quality AVAILABLE provider', async () => {
    const s = controlledService(TTS_SET);
    s.init({ speechService: fakeSpeech({ piper: true }) });
    // piper (quality 3) beats browser (quality 2) when it is available.
    expect((await s.resolveActive('tts'))?.id).toBe('piper');

    const s2 = controlledService(TTS_SET);
    s2.init({ speechService: fakeSpeech({ piper: false }) });
    // With piper unavailable it falls back to browser rather than nothing.
    expect((await s2.resolveActive('tts'))?.id).toBe('browser');
  });

  test('a pin to an unavailable provider falls back to auto, never silently mutes', async () => {
    // Pin a nonexistent provider; only browser+piper exist and piper is down.
    const s = controlledService(TTS_SET, { tts: 'no-such-model' });
    s.init({ speechService: fakeSpeech({ piper: false }) });
    const resolved = await s.resolveActive('tts');
    expect(resolved?.id).toBe('browser'); // fell back to the best available
  });

  test('duplex defaults to none (off) until a model is explicitly chosen', async () => {
    const s = service();
    expect(s.activeKey('duplex')).toBe('none');
    expect(await s.resolveActive('duplex')).toBeNull();
  });

  test('setActive persists to the override and applies TTS immediately', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-set-'));
    const s = service({ env: dir });
    const speech = fakeSpeech({ piper: true });
    s.init({ speechService: speech });

    s.setActive('tts', 'browser');
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'voice-providers.json'), 'utf8'));
    expect(written.activeTts).toBe('browser');
    await new Promise((r) => setTimeout(r, 5)); // applyActiveTts is async
    expect(speech.applied.some((a) => a.engine === 'browser')).toBe(true);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('setActive rejects an unknown id and a cross-capability id', () => {
    const s = service({ env: fs.mkdtempSync(path.join(os.tmpdir(), 'vp-rej-')) });
    expect(() => s.setActive('tts', 'not-a-provider')).toThrow(/Unknown voice provider/);
    expect(() => s.setActive('tts', 'personaplex')).toThrow(/is a duplex, not a tts/);
    expect(() => s.setActive('bogus', 'auto')).toThrow(/Unknown capability/);
  });

  test('getStatus reports selected + resolved per capability', async () => {
    const s = controlledService(TTS_SET);
    s.init({ speechService: fakeSpeech({ piper: true }) });
    const status = await s.getStatus();
    expect(status.active.tts.resolved).toBe('piper');
    expect(status.active.duplex.selected).toBe('none');
    expect(status.providers.every((p) => 'available' in p)).toBe(true);
  });
});
