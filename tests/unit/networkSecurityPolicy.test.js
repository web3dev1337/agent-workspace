const {
  normalizeHost,
  isLoopbackHost,
  isBindAllHost,
  parseBooleanFlag,
  evaluateBindSecurity
} = require('../../server/networkSecurityPolicy');

describe('networkSecurityPolicy', () => {
  test('normalizeHost defaults to loopback', () => {
    expect(normalizeHost(undefined)).toBe('127.0.0.1');
    expect(normalizeHost('')).toBe('127.0.0.1');
    expect(normalizeHost('  ')).toBe('127.0.0.1');
  });

  test('host classifiers detect loopback and bind-all hosts', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('0.0.0.0')).toBe(false);

    expect(isBindAllHost('0.0.0.0')).toBe(true);
    expect(isBindAllHost('::')).toBe(true);
    expect(isBindAllHost('127.0.0.1')).toBe(false);
  });

  test('boolean parser supports common truthy values', () => {
    expect(parseBooleanFlag('1')).toBe(true);
    expect(parseBooleanFlag('true')).toBe(true);
    expect(parseBooleanFlag('yes')).toBe(true);
    expect(parseBooleanFlag('0')).toBe(false);
    expect(parseBooleanFlag('')).toBe(false);
  });

  test('LAN binding without auth is blocked by default', () => {
    const policy = evaluateBindSecurity({
      host: '0.0.0.0',
      authToken: '',
      allowInsecureLanNoAuth: ''
    });
    expect(policy.allowStart).toBe(false);
  });

  test('LAN binding with auth token is allowed', () => {
    const policy = evaluateBindSecurity({
      host: '0.0.0.0',
      authToken: 'abc',
      allowInsecureLanNoAuth: ''
    });
    expect(policy.allowStart).toBe(true);
    expect(policy.hasAuthToken).toBe(true);
  });
});
