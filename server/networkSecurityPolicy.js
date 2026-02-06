function normalizeHost(input) {
  const host = String(input || '').trim();
  return host || '127.0.0.1';
}

function isLoopbackHost(host) {
  const h = String(host || '').trim().toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

function isBindAllHost(host) {
  const h = String(host || '').trim().toLowerCase();
  return h === '0.0.0.0' || h === '::';
}

function parseBooleanFlag(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return false;
  return ['1', 'true', 'yes'].includes(raw);
}

function evaluateBindSecurity({ host, authToken, allowInsecureLanNoAuth } = {}) {
  const normalizedHost = normalizeHost(host);
  const hasAuthToken = String(authToken || '').trim().length > 0;
  const allowInsecureLan = parseBooleanFlag(allowInsecureLanNoAuth);
  const loopback = isLoopbackHost(normalizedHost);
  const allowStart = loopback || hasAuthToken || allowInsecureLan;

  return {
    host: normalizedHost,
    hasAuthToken,
    allowInsecureLan,
    isLoopback: loopback,
    isBindAll: isBindAllHost(normalizedHost),
    allowStart
  };
}

module.exports = {
  normalizeHost,
  isLoopbackHost,
  isBindAllHost,
  parseBooleanFlag,
  evaluateBindSecurity
};
