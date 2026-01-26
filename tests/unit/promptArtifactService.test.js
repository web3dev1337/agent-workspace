const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  PromptArtifactService,
  safeId,
  sha256,
  formatPointerComment,
  encryptText,
  decryptText,
  resolveSafeRelativePath
} = require('../../server/promptArtifactService');

describe('PromptArtifactService', () => {
  test('safeId sanitizes', () => {
    expect(safeId('pr:web3dev1337/repo#1')).toBe('pr:web3dev1337-repo-1');
  });

  test('write/read roundtrip returns sha256', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-prompts-'));
    const svc = new PromptArtifactService({ dirPath: tmp });

    const id = 'task:abc/123';
    const text = 'hello world';
    const written = await svc.write(id, text);
    expect(written.id).toBe(safeId(id));
    expect(written.sha256).toBe(sha256(text));

    const read = await svc.read(id);
    expect(read.text).toBe(text);
    expect(read.sha256).toBe(sha256(text));
  });

  test('encrypt/decrypt roundtrip', () => {
    const payload = encryptText({ text: 'secret prompt', passphrase: 'pw' });
    const text = decryptText({ payload, passphrase: 'pw' });
    expect(text).toBe('secret prompt');
  });

  test('resolveSafeRelativePath rejects traversal', () => {
    const repoRoot = '/tmp/repo-root';
    expect(() => resolveSafeRelativePath(repoRoot, '../x')).toThrow();
    expect(() => resolveSafeRelativePath(repoRoot, '/abs/path')).toThrow();
  });

  test('shared/encrypted repo write/read', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-repo-'));
    const svc = new PromptArtifactService({ dirPath: fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-prompts-')) });
    const id = 'task:shared';
    const defaults = svc.defaultRepoPromptPaths(id);

    await svc.writeToRepo({ repoRoot, relPath: defaults.shared, visibility: 'shared', text: 'hello' });
    const shared = await svc.readFromRepo({ repoRoot, relPath: defaults.shared, visibility: 'shared' });
    expect(shared.text).toBe('hello');
    expect(shared.sha256).toBe(sha256('hello'));

    await svc.writeToRepo({ repoRoot, relPath: defaults.encrypted, visibility: 'encrypted', text: 'topsecret', passphrase: 'pw' });
    const enc = await svc.readFromRepo({ repoRoot, relPath: defaults.encrypted, visibility: 'encrypted', passphrase: 'pw' });
    expect(enc.text).toBe('topsecret');
    expect(enc.sha256).toBe(sha256('topsecret'));
  });

  test('formatPointerComment produces compact pointer', () => {
    const text = formatPointerComment({
      id: 'trello:abc123',
      sha256: 'deadbeef',
      visibility: 'encrypted',
      repoLabel: 'zoo-game',
      relPath: '.orchestrator/prompts/trello-abc123.enc.json'
    });
    expect(text).toContain('Prompt artifact pointer');
    expect(text).toContain('id: trello:abc123');
    expect(text).toContain('sha256: deadbeef');
    expect(text).toContain('store: encrypted');
    expect(text).toContain('repo: zoo-game');
    expect(text).toContain('path: .orchestrator/prompts/trello-abc123.enc.json');
  });
});
