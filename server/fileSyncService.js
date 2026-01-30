const fs = require('fs').promises;
const path = require('path');

const resolveSafeRelativePath = (rootDir, relPath) => {
  const root = path.resolve(String(rootDir || ''));
  const rel = String(relPath || '').trim();
  if (!root) throw new Error('rootDir is required');
  if (!rel) throw new Error('relativePath is required');
  if (path.isAbsolute(rel)) throw new Error('relativePath must be relative');
  const normalized = path.normalize(rel);
  if (normalized.startsWith('..') || normalized.includes(`..${path.sep}`)) {
    throw new Error('relativePath must not traverse directories');
  }
  const full = path.resolve(root, normalized);
  if (!full.startsWith(root + path.sep) && full !== root) {
    throw new Error('relativePath escapes rootDir');
  }
  return full;
};

class FileSyncService {
  async syncFile({ sourceRoot, relativePath, targets, overwrite = false } = {}) {
    const srcRoot = path.resolve(String(sourceRoot || ''));
    const rel = String(relativePath || '').trim();
    if (!srcRoot) throw new Error('sourceRoot is required');
    if (!rel) throw new Error('relativePath is required');
    if (!Array.isArray(targets) || targets.length === 0) throw new Error('targets is required');

    const srcFull = resolveSafeRelativePath(srcRoot, rel);
    const srcStat = await fs.stat(srcFull);
    if (!srcStat.isFile()) throw new Error('source is not a file');

    const content = await fs.readFile(srcFull);

    const results = [];
    for (const t of targets) {
      const targetRoot = path.resolve(String(t || ''));
      if (!targetRoot) continue;
      const destFull = resolveSafeRelativePath(targetRoot, rel);
      await fs.mkdir(path.dirname(destFull), { recursive: true });
      try {
        const existing = await fs.stat(destFull);
        if (existing.isFile() && !overwrite) {
          results.push({ targetRoot, status: 'exists', path: destFull });
          continue;
        }
      } catch (error) {
        // ENOENT is expected for new files
        if (error?.code !== 'ENOENT') {
          results.push({ targetRoot, status: 'error', path: destFull, error: String(error?.message || error) });
          continue;
        }
      }

      try {
        await fs.writeFile(destFull, content);
        results.push({ targetRoot, status: 'written', path: destFull });
      } catch (error) {
        results.push({ targetRoot, status: 'error', path: destFull, error: String(error?.message || error) });
      }
    }

    return {
      sourceRoot: srcRoot,
      relativePath: rel,
      results
    };
  }
}

module.exports = { FileSyncService, resolveSafeRelativePath };

