const fs = require('fs');
const os = require('os');
const path = require('path');

function normalizeCredentialValue(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function parseKeyValueFile(contents) {
  const out = {};
  const lines = String(contents || '').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

function loadTrelloCredentialsFromEnv(env = process.env) {
  const apiKey = normalizeCredentialValue(env.TRELLO_API_KEY || env.TRELLO_KEY);
  const token = normalizeCredentialValue(env.TRELLO_TOKEN || env.TRELLO_API_TOKEN);
  if (!apiKey || !token) return null;
  return { apiKey, token, source: 'env' };
}

function loadTrelloCredentialsFromFile(filePath) {
  try {
    if (!filePath) return null;
    if (!fs.existsSync(filePath)) return null;
    const contents = fs.readFileSync(filePath, 'utf8');
    const kv = parseKeyValueFile(contents);
    const apiKey = normalizeCredentialValue(kv.TRELLO_API_KEY || kv.API_KEY || kv.KEY);
    const token = normalizeCredentialValue(kv.TRELLO_TOKEN || kv.TOKEN);
    if (!apiKey || !token) return null;
    return { apiKey, token, source: filePath };
  } catch {
    return null;
  }
}

function loadTrelloCredentials(options = {}) {
  const fromEnv = loadTrelloCredentialsFromEnv(options.env || process.env);
  if (fromEnv) return fromEnv;

  const defaultCredPath = path.join(os.homedir(), '.trello-credentials');
  const filePath = options.filePath || defaultCredPath;
  return loadTrelloCredentialsFromFile(filePath);
}

module.exports = {
  loadTrelloCredentials,
  loadTrelloCredentialsFromEnv,
  loadTrelloCredentialsFromFile,
  parseKeyValueFile
};

