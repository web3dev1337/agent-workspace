const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/license.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

function stableStringify(value) {
  const seen = new WeakSet();

  const walk = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return null;
    seen.add(v);

    if (Array.isArray(v)) return v.map(walk);

    const out = {};
    for (const key of Object.keys(v).sort()) {
      out[key] = walk(v[key]);
    }
    return out;
  };

  return JSON.stringify(walk(value));
}

class LicenseService {
  constructor() {
    this.lastLoadedAt = 0;
    this.cached = null;
  }

  static getInstance() {
    if (!LicenseService.instance) {
      LicenseService.instance = new LicenseService();
    }
    return LicenseService.instance;
  }

  getDataDir() {
    const raw = String(process.env.ORCHESTRATOR_DATA_DIR || '').trim();
    if (!raw) return path.join(__dirname, '..');
    try {
      return path.resolve(raw);
    } catch {
      return raw;
    }
  }

  getLicensePath() {
    const override = String(process.env.ORCHESTRATOR_LICENSE_PATH || '').trim();
    if (override) return override;
    return path.join(this.getDataDir(), 'license.json');
  }

  readPublicKeyPem() {
    const fromEnv = String(process.env.ORCHESTRATOR_LICENSE_PUBLIC_KEY || '').trim();
    if (fromEnv) return fromEnv;

    const fromPath = String(process.env.ORCHESTRATOR_LICENSE_PUBLIC_KEY_PATH || '').trim();
    if (fromPath) {
      try {
        if (fs.existsSync(fromPath)) return fs.readFileSync(fromPath, 'utf8');
      } catch {}
    }

    const candidates = [
      path.join(this.getDataDir(), 'license-public-key.pem'),
      path.join(__dirname, '..', 'license-public-key.pem')
    ];
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
      } catch {}
    }

    return null;
  }

  verifyLicense({ license, signature }) {
    const allowUnsigned = (() => {
      const raw = String(process.env.ORCHESTRATOR_LICENSE_ALLOW_UNSIGNED || '').trim().toLowerCase();
      if (!raw) return false;
      return !['0', 'false', 'no', 'off'].includes(raw);
    })();

    if (!signature) {
      if (allowUnsigned) return { ok: true, reason: 'unsigned_allowed' };
      return { ok: false, reason: 'missing_signature' };
    }

    const publicKeyPem = this.readPublicKeyPem();
    if (!publicKeyPem) {
      return { ok: false, reason: 'missing_public_key' };
    }

    const algorithmRaw = String(process.env.ORCHESTRATOR_LICENSE_ALG || 'ed25519').trim().toLowerCase();
    const algorithm = algorithmRaw === 'rsa-sha256' ? 'sha256' : null;

    try {
      const payload = Buffer.from(stableStringify(license), 'utf8');
      const sig = Buffer.from(String(signature), 'base64');
      const ok = crypto.verify(algorithm, payload, publicKeyPem, sig);
      return { ok, reason: ok ? 'verified' : 'bad_signature' };
    } catch (error) {
      return { ok: false, reason: 'verify_error', error: error.message };
    }
  }

  loadFromDisk() {
    const licensePath = this.getLicensePath();
    try {
      if (!fs.existsSync(licensePath)) {
        this.cached = { ok: false, status: 'missing', license: null, source: licensePath };
        this.lastLoadedAt = Date.now();
        return this.cached;
      }

      const raw = fs.readFileSync(licensePath, 'utf8');
      const parsed = JSON.parse(raw);
      const license = parsed?.license || null;
      const signature = parsed?.signature || null;

      if (!license || typeof license !== 'object') {
        this.cached = { ok: false, status: 'invalid', reason: 'missing_license_payload', license: null, source: licensePath };
        this.lastLoadedAt = Date.now();
        return this.cached;
      }

      const verified = this.verifyLicense({ license, signature });
      const plan = String(license.plan || '').trim().toLowerCase() || 'free';
      const expiresAt = license.expiresAt ? String(license.expiresAt) : null;
      const now = Date.now();
      const expired = (() => {
        if (!expiresAt) return false;
        const t = Date.parse(expiresAt);
        if (!Number.isFinite(t)) return false;
        return t < now;
      })();

      const ok = verified.ok && !expired;
      this.cached = {
        ok,
        status: ok ? 'active' : (expired ? 'expired' : 'invalid'),
        plan,
        expiresAt,
        reason: verified.reason,
        license,
        source: licensePath
      };
      this.lastLoadedAt = Date.now();
      return this.cached;
    } catch (error) {
      logger.error('Failed to load license', { path: licensePath, error: error.message, stack: error.stack });
      this.cached = { ok: false, status: 'error', reason: 'read_error', error: error.message, license: null, source: licensePath };
      this.lastLoadedAt = Date.now();
      return this.cached;
    }
  }

  getStatus({ forceReload = false } = {}) {
    if (!this.cached || forceReload) {
      return this.loadFromDisk();
    }

    return this.cached;
  }

  getEntitlements() {
    const status = this.getStatus();
    const plan = status.ok ? String(status.plan || 'free') : 'free';

    const pro = ['pro', 'team', 'enterprise'].includes(plan);
    return {
      plan,
      pro
    };
  }

  saveLicenseFile(fileJson) {
    const licensePath = this.getLicensePath();
    try {
      const dir = path.dirname(licensePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(licensePath, JSON.stringify(fileJson, null, 2));
      logger.info('Saved license file', { path: licensePath });
      this.loadFromDisk();
      return { ok: true, path: licensePath };
    } catch (error) {
      logger.error('Failed to save license file', { path: licensePath, error: error.message, stack: error.stack });
      return { ok: false, path: licensePath, error: error.message };
    }
  }
}

module.exports = { LicenseService };

