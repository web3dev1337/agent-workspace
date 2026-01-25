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

const DEFAULT_DIR = path.join(os.homedir(), '.orchestrator', 'prompts');

const safeId = (id) => String(id || '')
  .trim()
  .replace(/[^a-zA-Z0-9._:-]/g, '-')
  .replace(/-+/g, '-')
  .slice(0, 120);

const sha256 = (text) => crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');

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
}

module.exports = { PromptArtifactService, safeId, sha256 };

