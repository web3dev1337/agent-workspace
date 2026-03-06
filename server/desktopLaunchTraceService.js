const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({
      filename: 'logs/desktop-launch.log',
      maxsize: 10485760,
      maxFiles: 5
    })
  ]
});

function clampString(value, maxLength = 600) {
  const text = String(value || '');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 16))}...[truncated]`;
}

function sanitizePayload(value, { depth = 0, seen = new WeakSet() } = {}) {
  if (value == null) return value;
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return clampString(value);
  if (typeof value === 'function') return `[function:${value.name || 'anonymous'}]`;
  if (depth >= 4) return '[depth-limit]';

  if (Array.isArray(value)) {
    const items = value.slice(0, 20).map((item) => sanitizePayload(item, { depth: depth + 1, seen }));
    if (value.length > 20) items.push(`[+${value.length - 20} more]`);
    return items;
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    const out = {};
    const keys = Object.keys(value).slice(0, 25);
    keys.forEach((key) => {
      out[key] = sanitizePayload(value[key], { depth: depth + 1, seen });
    });
    if (Object.keys(value).length > keys.length) {
      out.__truncatedKeys = Object.keys(value).length - keys.length;
    }
    seen.delete(value);
    return out;
  }

  return clampString(String(value));
}

function logDesktopLaunch(event, payload = {}) {
  const name = String(event || '').trim() || 'event';
  const safePayload = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? sanitizePayload(payload)
    : { value: sanitizePayload(payload) };

  try {
    logger.info(name, {
      event: name,
      ...safePayload
    });
  } catch {
    // Best-effort trace logging should never interrupt app startup.
  }
}

module.exports = {
  logDesktopLaunch,
  sanitizePayload
};
