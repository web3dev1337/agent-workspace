const fs = require('fs');
const os = require('os');
const path = require('path');

const { PromptArtifactService, safeId, sha256 } = require('../../server/promptArtifactService');

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
});

