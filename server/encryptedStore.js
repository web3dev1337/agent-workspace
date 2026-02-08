const crypto = require('crypto');

const DEFAULT_SECRET_ENV = 'ORCHESTRATOR_SHARED_CONFIG_PASSPHRASE';

function resolvePassphrase(passphrase, { envKey = DEFAULT_SECRET_ENV } = {}) {
  const direct = String(passphrase || '').trim();
  if (direct) return direct;
  const fromEnv = String(process.env[envKey] || '').trim();
  return fromEnv;
}

function encryptText({ text, passphrase, envKey = DEFAULT_SECRET_ENV } = {}) {
  const pw = resolvePassphrase(passphrase, { envKey });
  if (!pw) throw new Error('passphrase is required');

  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(pw, salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(text || ''), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    v: 1,
    alg: 'aes-256-gcm',
    kdf: 'scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64')
  };
}

function decryptText({ payload, passphrase, envKey = DEFAULT_SECRET_ENV } = {}) {
  const pw = resolvePassphrase(passphrase, { envKey });
  if (!pw) throw new Error('passphrase is required');

  const p = payload && typeof payload === 'object' ? payload : null;
  if (!p || p.v !== 1 || p.alg !== 'aes-256-gcm' || p.kdf !== 'scrypt') {
    throw new Error('Invalid encrypted payload');
  }

  const salt = Buffer.from(String(p.salt || ''), 'base64');
  const iv = Buffer.from(String(p.iv || ''), 'base64');
  const tag = Buffer.from(String(p.tag || ''), 'base64');
  const ciphertext = Buffer.from(String(p.ciphertext || ''), 'base64');
  if (!salt.length || !iv.length || !tag.length || !ciphertext.length) {
    throw new Error('Invalid encrypted payload');
  }

  const key = crypto.scryptSync(pw, salt, 32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

function encryptObject({ value, passphrase, envKey = DEFAULT_SECRET_ENV } = {}) {
  return encryptText({
    text: JSON.stringify(value == null ? {} : value),
    passphrase,
    envKey
  });
}

function decryptObject({ payload, passphrase, envKey = DEFAULT_SECRET_ENV } = {}) {
  const text = decryptText({ payload, passphrase, envKey });
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Invalid encrypted JSON payload');
  }
}

module.exports = {
  DEFAULT_SECRET_ENV,
  resolvePassphrase,
  encryptText,
  decryptText,
  encryptObject,
  decryptObject
};
