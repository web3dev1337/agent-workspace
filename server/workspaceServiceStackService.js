const MAX_SERVICES = 64;
const MAX_ENV_VARS = 128;
const ALLOWED_RESTART_POLICIES = new Set(['never', 'on-failure', 'always']);
const ALLOWED_HEALTHCHECK_TYPES = new Set(['http', 'tcp', 'process']);

function normalizeServiceId(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!normalized) return '';
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(normalized)) return '';
  return normalized;
}

function normalizeEnv(envValue) {
  if (!envValue || typeof envValue !== 'object' || Array.isArray(envValue)) {
    return {};
  }
  const entries = Object.entries(envValue).slice(0, MAX_ENV_VARS);
  const out = {};
  for (const [rawKey, rawValue] of entries) {
    const key = String(rawKey || '').trim();
    if (!key) continue;
    out[key] = String(rawValue ?? '');
  }
  return out;
}

function normalizeHealthcheck(healthcheck) {
  if (healthcheck === undefined || healthcheck === null) return null;
  if (!healthcheck || typeof healthcheck !== 'object' || Array.isArray(healthcheck)) {
    throw new Error('service.healthcheck must be an object');
  }

  const type = String(healthcheck.type || '').trim().toLowerCase();
  if (!ALLOWED_HEALTHCHECK_TYPES.has(type)) {
    throw new Error(`Unsupported healthcheck type: ${healthcheck.type}`);
  }

  const intervalSecondsRaw = Number(healthcheck.intervalSeconds);
  const intervalSeconds = Number.isFinite(intervalSecondsRaw)
    ? Math.max(5, Math.min(3600, Math.trunc(intervalSecondsRaw)))
    : 30;

  if (type === 'http') {
    const url = String(healthcheck.url || '').trim();
    if (!/^https?:\/\//i.test(url)) throw new Error('HTTP healthcheck requires a valid http(s) url');
    return { type, url, intervalSeconds };
  }

  if (type === 'tcp') {
    const portRaw = Number(healthcheck.port);
    const port = Number.isInteger(portRaw) ? portRaw : 0;
    if (port < 1 || port > 65535) throw new Error('TCP healthcheck requires a valid port');
    const host = String(healthcheck.host || '127.0.0.1').trim() || '127.0.0.1';
    return { type, host, port, intervalSeconds };
  }

  const command = String(healthcheck.command || '').trim();
  if (!command) throw new Error('Process healthcheck requires a command');
  return { type, command, intervalSeconds };
}

function normalizeServiceDefinition(service, index = 0) {
  if (!service || typeof service !== 'object' || Array.isArray(service)) {
    throw new Error(`Service #${index + 1} must be an object`);
  }

  const name = String(service.name || '').trim();
  const command = String(service.command || '').trim();
  if (!name) throw new Error(`Service #${index + 1} is missing name`);
  if (!command) throw new Error(`Service "${name}" is missing command`);

  const derivedId = normalizeServiceId(service.id) || normalizeServiceId(name);
  if (!derivedId) throw new Error(`Service "${name}" has invalid id`);

  const restartPolicy = String(service.restartPolicy || 'never').trim().toLowerCase();
  if (!ALLOWED_RESTART_POLICIES.has(restartPolicy)) {
    throw new Error(`Service "${name}" has invalid restartPolicy: ${service.restartPolicy}`);
  }

  const cwd = String(service.cwd || '').trim();
  const shell = String(service.shell || '').trim();
  const orderRaw = Number(service.order);
  const order = Number.isFinite(orderRaw) ? Math.trunc(orderRaw) : 0;

  const normalized = {
    id: derivedId,
    name,
    command,
    enabled: service.enabled !== false,
    restartPolicy,
    order
  };

  if (cwd) normalized.cwd = cwd;
  if (shell) normalized.shell = shell;

  const env = normalizeEnv(service.env);
  if (Object.keys(env).length) normalized.env = env;

  const healthcheck = normalizeHealthcheck(service.healthcheck);
  if (healthcheck) normalized.healthcheck = healthcheck;

  return normalized;
}

function normalizeServiceManifest(input, { strict = true } = {}) {
  let manifestInput = input;
  if (Array.isArray(input)) {
    manifestInput = { services: input };
  }
  if (!manifestInput || typeof manifestInput !== 'object' || Array.isArray(manifestInput)) {
    if (!strict) return { manifestVersion: 1, services: [] };
    throw new Error('Service stack manifest must be an object');
  }

  const rawServices = manifestInput.services;
  if (rawServices !== undefined && !Array.isArray(rawServices)) {
    if (!strict) return { manifestVersion: 1, services: [] };
    throw new Error('Service stack manifest.services must be an array');
  }

  const services = [];
  const seenIds = new Set();
  const list = Array.isArray(rawServices) ? rawServices : [];

  for (let i = 0; i < list.length; i += 1) {
    try {
      const normalized = normalizeServiceDefinition(list[i], i);
      if (seenIds.has(normalized.id)) {
        throw new Error(`Duplicate service id: ${normalized.id}`);
      }
      seenIds.add(normalized.id);
      services.push(normalized);
    } catch (error) {
      if (strict) throw error;
    }
  }

  if (services.length > MAX_SERVICES) {
    if (strict) throw new Error(`Service stack cannot exceed ${MAX_SERVICES} services`);
    services.length = MAX_SERVICES;
  }

  services.sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name));
  return {
    manifestVersion: 1,
    services
  };
}

function getWorkspaceServiceManifest(workspace) {
  const source = workspace?.serviceStack || workspace?.services || { services: [] };
  return normalizeServiceManifest(source, { strict: false });
}

function mergeServiceManifests(baseManifest, overrideManifest) {
  const base = normalizeServiceManifest(baseManifest || { services: [] }, { strict: false });
  const override = normalizeServiceManifest(overrideManifest || { services: [] }, { strict: false });

  const byId = new Map();
  for (const service of base.services) {
    byId.set(service.id, service);
  }
  for (const service of override.services) {
    byId.set(service.id, service);
  }

  const services = Array.from(byId.values()).sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name));
  return {
    manifestVersion: 1,
    services
  };
}

module.exports = {
  MAX_SERVICES,
  normalizeServiceManifest,
  getWorkspaceServiceManifest,
  mergeServiceManifests
};
