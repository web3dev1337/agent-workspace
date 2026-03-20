const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/prompt-artifacts.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

const { getAgentWorkspaceDir } = require('./utils/pathUtils');
const DEFAULT_DIR = path.join(getAgentWorkspaceDir(), 'prompts');

const safeId = (id) => String(id || '')
  .trim()
  .replace(/[^a-zA-Z0-9._:-]/g, '-')
  .replace(/-+/g, '-')
  .slice(0, 120);

const sha256 = (text) => crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');

const formatPointerComment = ({ id, sha256: hash, visibility, repoLabel, relPath } = {}) => {
  const pid = safeId(id);
  const store = String(visibility || '').trim().toLowerCase();
  const storeLabel = store === 'encrypted' ? 'encrypted' : 'shared';
  const repo = String(repoLabel || '').trim();
  const rp = String(relPath || '').trim();
  const h = String(hash || '').trim();

  const lines = [
    'Prompt artifact pointer',
    `id: ${pid || '(missing)'}`,
    h ? `sha256: ${h}` : '',
    `store: ${storeLabel}`,
    repo ? `repo: ${repo}` : '',
    rp ? `path: ${rp}` : ''
  ].filter(Boolean);

  return lines.join('\n');
};

const resolveSafeRelativePath = (repoRoot, relPath) => {
  const root = path.resolve(String(repoRoot || ''));
  const rel = String(relPath || '').trim();
  if (!root) throw new Error('repoRoot is required');
  if (!rel) throw new Error('relPath is required');
  if (path.isAbsolute(rel)) throw new Error('relPath must be relative');
  const normalized = path.normalize(rel);
  if (normalized.startsWith('..') || normalized.includes(`..${path.sep}`)) {
    throw new Error('relPath must not traverse directories');
  }
  const full = path.resolve(root, normalized);
  if (!full.startsWith(root + path.sep) && full !== root) {
    throw new Error('relPath escapes repoRoot');
  }
  return full;
};

const encryptText = ({ text, passphrase }) => {
  const pw = String(passphrase || '');
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
};

const decryptText = ({ payload, passphrase }) => {
  const pw = String(passphrase || '');
  if (!pw) throw new Error('passphrase is required');
  const p = payload && typeof payload === 'object' ? payload : null;
  if (!p || p.v !== 1 || p.alg !== 'aes-256-gcm' || p.kdf !== 'scrypt') throw new Error('Invalid encrypted prompt payload');
  const salt = Buffer.from(String(p.salt || ''), 'base64');
  const iv = Buffer.from(String(p.iv || ''), 'base64');
  const tag = Buffer.from(String(p.tag || ''), 'base64');
  const ciphertext = Buffer.from(String(p.ciphertext || ''), 'base64');
  if (!salt.length || !iv.length || !tag.length || !ciphertext.length) throw new Error('Invalid encrypted prompt payload');
  const key = crypto.scryptSync(pw, salt, 32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
};

class PromptArtifactService {
  constructor({ dirPath } = {}) {
    this.dirPath = dirPath || DEFAULT_DIR;
  }

  static getInstance() {
    if (!PromptArtifactService.instance) {
      PromptArtifactService.instance = new PromptArtifactService();
    }
    return PromptArtifactService.instance;
  }

  getPath(id) {
    const sid = safeId(id);
    if (!sid) throw new Error('id is required');
    return path.join(this.dirPath, `${sid}.md`);
  }

  async ensureDir() {
    await fs.mkdir(this.dirPath, { recursive: true });
  }

  async list({ limit = 200 } = {}) {
    await this.ensureDir();
    const entries = await fs.readdir(this.dirPath).catch(() => []);
    const files = entries
      .filter((f) => f.endsWith('.md'))
      .slice(0, Math.max(0, Math.min(1000, Number(limit) || 200)));

    const results = [];
    for (const file of files) {
      const full = path.join(this.dirPath, file);
      try {
        // eslint-disable-next-line no-await-in-loop
        const stat = await fs.stat(full);
        results.push({
          id: file.replace(/\.md$/, ''),
          updatedAt: stat.mtime.toISOString(),
          size: stat.size
        });
      } catch {
        // ignore
      }
    }

    results.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    return results;
  }

  async read(id) {
    const filePath = this.getPath(id);
    if (!fsSync.existsSync(filePath)) return null;
    const text = await fs.readFile(filePath, 'utf8');
    return {
      id: safeId(id),
      text,
      sha256: sha256(text)
    };
  }

  async write(id, text) {
    await this.ensureDir();
    const filePath = this.getPath(id);
    const body = String(text || '');
    await fs.writeFile(filePath, body, 'utf8');
    return {
      id: safeId(id),
      sha256: sha256(body)
    };
  }

  async remove(id) {
    const filePath = this.getPath(id);
    if (!fsSync.existsSync(filePath)) return false;
    await fs.unlink(filePath);
    return true;
  }

  defaultRepoPromptPaths(id) {
    const sid = safeId(id);
    return {
      shared: path.join('.agent-workspace', 'prompts', `${sid}.md`),
      encrypted: path.join('.agent-workspace', 'prompts', `${sid}.enc.json`)
    };
  }

  async readFromRepo({ repoRoot, relPath, visibility = 'shared', passphrase } = {}) {
    const full = resolveSafeRelativePath(repoRoot, relPath);
    if (!fsSync.existsSync(full)) return null;
    if (visibility === 'encrypted') {
      const raw = await fs.readFile(full, 'utf8');
      const parsed = JSON.parse(raw);
      const text = decryptText({ payload: parsed, passphrase });
      return { text, sha256: sha256(text) };
    }
    const text = await fs.readFile(full, 'utf8');
    return { text, sha256: sha256(text) };
  }

  async writeToRepo({ repoRoot, relPath, visibility = 'shared', text, passphrase } = {}) {
    const full = resolveSafeRelativePath(repoRoot, relPath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    const body = String(text || '');
    if (visibility === 'encrypted') {
      const payload = encryptText({ text: body, passphrase });
      await fs.writeFile(full, JSON.stringify(payload, null, 2), 'utf8');
      return { sha256: sha256(body) };
    }
    await fs.writeFile(full, body, 'utf8');
    return { sha256: sha256(body) };
  }

  async promoteToRepo({ id, repoRoot, relPath, visibility = 'shared', passphrase } = {}) {
    const prompt = await this.read(id);
    if (!prompt) return null;
    const written = await this.writeToRepo({ repoRoot, relPath, visibility, text: prompt.text, passphrase });
    return { id: safeId(id), sha256: written.sha256 };
  }
}

module.exports = {
  PromptArtifactService,
  safeId,
  sha256,
  formatPointerComment,
  resolveSafeRelativePath,
  encryptText,
  decryptText
};
