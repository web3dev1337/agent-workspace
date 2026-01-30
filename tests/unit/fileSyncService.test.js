const fs = require('fs');
const os = require('os');
const path = require('path');

const { FileSyncService, resolveSafeRelativePath } = require('../../server/fileSyncService');

describe('FileSyncService', () => {
  test('resolveSafeRelativePath rejects traversal', () => {
    expect(() => resolveSafeRelativePath('/tmp/root', '../evil.txt')).toThrow(/traverse|escapes/i);
    expect(() => resolveSafeRelativePath('/tmp/root', '/abs.txt')).toThrow(/relative/i);
  });

  test('syncFile copies file to targets (no overwrite)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-sync-'));
    const src = path.join(dir, 'src');
    const a = path.join(dir, 'a');
    const b = path.join(dir, 'b');
    fs.mkdirSync(src, { recursive: true });
    fs.mkdirSync(a, { recursive: true });
    fs.mkdirSync(b, { recursive: true });

    fs.mkdirSync(path.join(src, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(src, 'nested', 'x.txt'), 'hello', 'utf8');

    const svc = new FileSyncService();
    const out1 = await svc.syncFile({
      sourceRoot: src,
      relativePath: 'nested/x.txt',
      targets: [a, b],
      overwrite: false
    });
    expect(out1.results.filter(r => r.status === 'written')).toHaveLength(2);
    expect(fs.readFileSync(path.join(a, 'nested', 'x.txt'), 'utf8')).toBe('hello');

    fs.writeFileSync(path.join(b, 'nested', 'x.txt'), 'changed', 'utf8');
    const out2 = await svc.syncFile({
      sourceRoot: src,
      relativePath: 'nested/x.txt',
      targets: [b],
      overwrite: false
    });
    expect(out2.results[0].status).toBe('exists');
    expect(fs.readFileSync(path.join(b, 'nested', 'x.txt'), 'utf8')).toBe('changed');
  });
});

