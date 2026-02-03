const path = require('path');

function getShellKind({ platform = process.platform } = {}) {
  return platform === 'win32' ? 'powershell' : 'bash';
}

function quoteBash(value) {
  if (value === null || value === undefined) return "''";
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function quotePowerShell(value) {
  if (value === null || value === undefined) return "''";
  // PowerShell single-quote escaping = double the quote.
  return `'${String(value).replace(/'/g, "''")}'`;
}

function quoteForShell(value, shellKind) {
  return shellKind === 'powershell' ? quotePowerShell(value) : quoteBash(value);
}

function normalizeEnvPairs(env = {}) {
  const out = {};
  if (!env || typeof env !== 'object') return out;
  for (const [kRaw, vRaw] of Object.entries(env)) {
    const k = String(kRaw || '').trim();
    if (!k) continue;
    // Keep only valid-ish env keys
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue;
    out[k] = vRaw === undefined ? '' : String(vRaw);
  }
  return out;
}

function buildEnvPrefixBash(env = {}) {
  const pairs = normalizeEnvPairs(env);
  const parts = [];
  for (const [k, v] of Object.entries(pairs)) {
    parts.push(`${k}=${quoteBash(v)}`);
  }
  return parts.join(' ');
}

function buildEnvPrefixPowerShell(env = {}) {
  const pairs = normalizeEnvPairs(env);
  const parts = [];
  for (const [k, v] of Object.entries(pairs)) {
    parts.push(`$env:${k}=${quotePowerShell(v)}`);
  }
  return parts.join('; ');
}

function buildCdBash(cwd) {
  if (!cwd) return '';
  return `cd ${quoteBash(cwd)}`;
}

function buildCdPowerShell(cwd) {
  if (!cwd) return '';
  // LiteralPath avoids wildcard expansion.
  return `Set-Location -LiteralPath ${quotePowerShell(cwd)}`;
}

function buildEcho(shellKind, message) {
  const text = message === undefined ? '' : String(message);
  if (shellKind === 'powershell') {
    return `Write-Output ${quotePowerShell(text)}`;
  }
  return `echo ${quoteBash(text)}`;
}

function buildShellCommand({ shellKind = getShellKind(), cwd = null, env = null, command }) {
  const cmd = String(command || '').trim();
  if (!cmd) return '';

  if (shellKind === 'powershell') {
    const parts = [];
    if (cwd) parts.push(buildCdPowerShell(cwd));
    if (env) {
      const envPart = buildEnvPrefixPowerShell(env);
      if (envPart) parts.push(envPart);
    }
    parts.push(cmd);
    return parts.filter(Boolean).join('; ');
  }

  const cd = cwd ? buildCdBash(cwd) : '';
  const envPrefix = env ? buildEnvPrefixBash(env) : '';
  const cmdWithEnv = envPrefix ? `${envPrefix} ${cmd}` : cmd;
  if (!cd) return cmdWithEnv;
  return `${cd} && ${cmdWithEnv}`;
}

function parseEnvAssignments(raw) {
  const out = {};
  const s = String(raw || '').trim();
  if (!s) return out;

  // Very small parser: whitespace-separated KEY=VALUE pairs.
  // Values may be quoted with single/double quotes (we strip outer quotes only).
  const tokens = s.split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    const idx = t.indexOf('=');
    if (idx <= 0) continue;
    const key = t.slice(0, idx).trim();
    let value = t.slice(idx + 1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function resolveCwd(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    return path.resolve(s);
  } catch {
    return s;
  }
}

module.exports = {
  getShellKind,
  quoteBash,
  quotePowerShell,
  quoteForShell,
  buildEcho,
  buildShellCommand,
  parseEnvAssignments,
  resolveCwd
};

