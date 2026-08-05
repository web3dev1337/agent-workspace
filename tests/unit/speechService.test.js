const { SpeechService, sanitizeForSpeech } = require('../../server/speechService');

function browserSpeech() {
  const emitted = [];
  const service = new SpeechService({ logger: { warn: () => {} } });
  service.preferredBackend = 'browser';
  service.setIO({ emit: (event, payload) => emitted.push({ event, payload }) });
  return { service, emitted };
}

describe('sanitizeForSpeech', () => {
  test('strips ANSI escapes so terminal output is readable aloud', () => {
    expect(sanitizeForSpeech('\x1b[32mBuild passed\x1b[0m')).toBe('Build passed');
  });

  test('removes shell metacharacters — spoken text can reach a command line', () => {
    const cleaned = sanitizeForSpeech('run `rm -rf /` && echo $(whoami); cat <file>');
    expect(cleaned).not.toMatch(/[`$\\|&;<>(){}[\]]/);
  });

  test('caps length so nothing monologues', () => {
    expect(sanitizeForSpeech('word '.repeat(500)).length).toBeLessThanOrEqual(400);
  });

  test('collapses whitespace and returns empty for nothing useful', () => {
    expect(sanitizeForSpeech('  hello \n\n  world  ')).toBe('hello world');
    expect(sanitizeForSpeech('\x00\x01')).toBe('');
  });
});

describe('SpeechService', () => {
  test('the browser backend needs nothing installed', () => {
    const { service, emitted } = browserSpeech();
    const result = service.speak('Work one is waiting on permission');

    expect(result.spoken).toBe(true);
    expect(emitted[0].event).toBe('speech-speak');
    expect(emitted[0].payload.text).toBe('Work one is waiting on permission');
  });

  test('the same message is not repeated back to back', () => {
    const { service, emitted } = browserSpeech();
    service.speak('same thing');
    const second = service.speak('same thing');

    expect(second.spoken).toBe(false);
    expect(second.reason).toMatch(/just said that/);
    expect(emitted).toHaveLength(1);
  });

  test('force overrides the repeat guard', () => {
    const { service, emitted } = browserSpeech();
    service.speak('same thing');
    expect(service.speak('same thing', { force: true }).spoken).toBe(true);
    expect(emitted).toHaveLength(2);
  });

  test('with no client connected it reports why rather than throwing', () => {
    const service = new SpeechService({ logger: { warn: () => {} } });
    service.preferredBackend = 'browser';
    const result = service.speak('anyone there');
    expect(result.spoken).toBe(false);
    expect(result.reason).toMatch(/no socket/);
  });

  test('disabling speech silences it without error', () => {
    const { service, emitted } = browserSpeech();
    service.setEnabled(false);
    expect(service.speak('quiet please').spoken).toBe(false);
    expect(emitted).toEqual([]);
  });

  test('empty input is a no-op', () => {
    const { service } = browserSpeech();
    expect(service.speak('   ').spoken).toBe(false);
  });

  test('an unavailable backend cannot be selected', () => {
    const service = new SpeechService();
    expect(() => service.setBackend('nonexistent')).toThrow(/Unknown speech backend/);
  });

  test('status reports the resolved backend, listeners and recent utterances', () => {
    const service = new SpeechService({ logger: { warn: () => {} } });
    service.preferredBackend = 'browser';
    service.setIO({ emit: () => {}, engine: { clientsCount: 2 } });
    service.speak('one');

    const status = service.getStatus();
    expect(status.backend).toBe('browser');
    expect(status.connectedClients).toBe(2);
    expect(status.recent[0].text).toBe('one');
  });

  test('kokoro is not "available" merely because its URL has a default', () => {
    const withoutEnv = { ...process.env };
    delete withoutEnv.KOKORO_HTTP_URL;
    const original = process.env;
    process.env = withoutEnv;
    try {
      const service = new SpeechService({ logger: { warn: () => {} } });
      service.cliEngine = '';
      const kokoro = service.detectBackends({ force: true }).find((b) => b.id === 'kokoro');
      // Before the fix this was unconditionally true (the URL always defaults),
      // so a dead kokoro was selectable and speech went permanently silent.
      expect(kokoro.available).toBe(false);
      expect(() => service.setBackend('kokoro')).toThrow(/not available/);
    } finally {
      process.env = original;
    }
  });

  test('a registry-verified engine counts as available for sync detection', () => {
    const service = new SpeechService({ logger: { warn: () => {} } });
    service.cliEngine = '';
    service.setActiveEngine('kokoro', { verified: true });
    const kokoro = service.detectBackends({ force: true }).find((b) => b.id === 'kokoro');
    expect(kokoro.available).toBe(true);
    expect(service.resolveBackend()).toBe('kokoro');
  });

  test('the "none" engine actually mutes TTS instead of leaving the old backend live', () => {
    const { service, emitted } = browserSpeech();
    expect(service.speak('audible').spoken).toBe(true);

    service.setActiveEngine('none');
    const result = service.speak('should be silent', { force: true });
    expect(result.spoken).toBe(false);
    expect(result.backend).toBe('none');
    expect(emitted).toHaveLength(1);
  });

  test('a failed neural synth falls back to browser speech instead of silence', async () => {
    const emitted = [];
    const service = new SpeechService({ logger: { warn: () => {} } });
    service.setIO({ emit: (event, payload) => emitted.push({ event, payload }) });
    service.piperModel = '';

    // Nothing listens on this port and there is no spawn fallback — before the
    // fix this returned silently while speak() had already reported success.
    await service.synthAndEmit('still audible', 'high', 'http://127.0.0.1:1', false);

    expect(emitted).toHaveLength(1);
    expect(emitted[0].event).toBe('speech-speak');
    expect(emitted[0].payload.text).toBe('still audible');
    expect(emitted[0].payload.priority).toBe('high');
  });

  test('priority survives the local neural path so a high clip can interrupt', () => {
    const service = new SpeechService({ logger: { warn: () => {} } });
    service.setIO({ emit: () => {}, engine: { clientsCount: 1 } });
    const seen = [];
    service.speakViaNeuralBrowser = (engine, text, priority) => {
      seen.push({ engine, priority });
      return { spoken: true };
    };
    service.speakLocally('kokoro', 'urgent thing', 'high');
    expect(seen).toEqual([{ engine: 'kokoro', priority: 'high' }]);
  });
});
