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
});
