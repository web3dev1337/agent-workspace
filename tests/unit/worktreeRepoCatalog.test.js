const fs = require('fs');
const path = require('path');

const APP_JS = path.join(__dirname, '..', '..', 'client', 'app.js');

// Pull a method out of the ClaudeOrchestrator class body and make it callable.
// Safe to brace-match here: the methods under test contain no template literals.
const extractMethod = (src, signature) => {
  const start = src.indexOf(`\n  ${signature}`);
  if (start < 0) throw new Error(`method not found in client/app.js: ${signature}`);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1).trim();
    }
  }
  throw new Error(`unbalanced braces for ${signature}`);
};

const readConst = (src, name) => {
  const m = src.match(new RegExp(`^const ${name} = (.+);$`, 'm'));
  if (!m) throw new Error(`const not found: ${name}`);
  return m[1];
};

const buildHarness = () => {
  const src = fs.readFileSync(APP_JS, 'utf8');

  const methods = [
    'getProjectsBoardColumnForProjectKey(projectKey, boardData = null) {',
    'getProjectsBoardColumnForRepo(repo, boardData = null) {',
    'filterReposForWorktreeMenus(repos, boardData = null) {',
    'readPersistedRepoCache(storageKey) {',
    'writePersistedRepoCache(storageKey, entry) {',
    'invalidateScannedReposCache() {',
    'normalizeProjectsBoardColumnId(value) {'
  ].map((sig) => extractMethod(src, sig)).join('\n\n');

  const factory = new Function(
    'PROJECTS_BOARD_UNCLASSIFIED_COLUMN',
    'SCANNED_REPOS_CACHE_STORAGE_KEY',
    'REPO_CACHE_PERSIST_MAX_AGE_MS',
    'localStorage',
    `return class Harness {
       normalizeProjectsBoardProjectKey(v) { return String(v || '').trim().replace(/^\\/+|\\/+$/g, ''); }
       getProjectsBoardMenuVisibilityPrefs() { return this.__prefs; }
       ${methods}
     };`
  );

  return {
    Harness: factory(
      readConst(src, 'PROJECTS_BOARD_UNCLASSIFIED_COLUMN').replace(/'/g, ''),
      'test-scanned-repos',
      Number(eval(readConst(src, 'REPO_CACHE_PERSIST_MAX_AGE_MS'))),
      global.localStorage
    ),
    src
  };
};

// minimal localStorage stub
beforeEach(() => {
  const store = new Map();
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };
});

const boardWith = (projectToColumn) => ({ board: { projectToColumn } });

describe('worktree repo catalog: board column classification', () => {
  const makeInstance = (prefs) => {
    const { Harness } = buildHarness();
    const inst = new Harness();
    inst.__prefs = prefs;
    inst.projectsBoardCache = { value: null, fetchedAt: 0 };
    return inst;
  };

  test('a repo that was never placed on the board is unclassified, not backlog', () => {
    const inst = makeInstance({ showBacklog: false, showArchived: false, showDone: false });
    const board = boardWith({ 'tools/filed-repo': 'active' });
    expect(inst.getProjectsBoardColumnForProjectKey('tools/never-filed', board)).toBe('unclassified');
  });

  test('untriaged repos stay visible even when every toggle is off', () => {
    const inst = makeInstance({ showBacklog: false, showArchived: false, showDone: false });
    const board = boardWith({ 'tools/archived-repo': 'archived' });
    const repos = [
      { name: 'never-filed', relativePath: 'tools/never-filed' },
      { name: 'archived-repo', relativePath: 'tools/archived-repo' }
    ];
    const visible = inst.filterReposForWorktreeMenus(repos, board).map((r) => r.name);
    expect(visible).toContain('never-filed');
    expect(visible).not.toContain('archived-repo');
  });

  test('explicitly backlogged repos are still hidden when showBacklog is off', () => {
    const inst = makeInstance({ showBacklog: false, showArchived: true, showDone: true });
    const board = boardWith({ 'tools/filed-backlog': 'backlog' });
    const repos = [{ name: 'filed-backlog', relativePath: 'tools/filed-backlog' }];
    expect(inst.filterReposForWorktreeMenus(repos, board)).toHaveLength(0);
  });

  test('an empty board (fresh install) hides nothing', () => {
    const inst = makeInstance({ showBacklog: false, showArchived: false, showDone: false });
    const repos = [
      { name: 'a', relativePath: 'tools/a' },
      { name: 'b', relativePath: 'games/b' }
    ];
    expect(inst.filterReposForWorktreeMenus(repos, boardWith({}))).toHaveLength(2);
  });
});

describe('worktree repo catalog: persisted cache', () => {
  const makeInstance = () => {
    const { Harness } = buildHarness();
    return new Harness();
  };

  test('round-trips a cache entry across a simulated reload', () => {
    const inst = makeInstance();
    const entry = { value: [{ name: 'repo-a' }], fetchedAt: Date.now(), key: ':500' };
    inst.writePersistedRepoCache('test-scanned-repos', entry);
    const restored = inst.readPersistedRepoCache('test-scanned-repos');
    expect(restored.value).toEqual(entry.value);
    expect(restored.key).toBe(':500');
  });

  test('rejects entries older than the max persist age', () => {
    const inst = makeInstance();
    const tooOld = Date.now() - (8 * 24 * 60 * 60 * 1000);
    inst.writePersistedRepoCache('test-scanned-repos', { value: [{ name: 'x' }], fetchedAt: tooOld });
    expect(inst.readPersistedRepoCache('test-scanned-repos')).toBeNull();
  });

  test('rejects future timestamps (clock skew)', () => {
    const inst = makeInstance();
    const future = Date.now() + (60 * 60 * 1000);
    inst.writePersistedRepoCache('test-scanned-repos', { value: [{ name: 'x' }], fetchedAt: future });
    expect(inst.readPersistedRepoCache('test-scanned-repos')).toBeNull();
  });

  test('survives corrupt or non-array payloads without throwing', () => {
    const inst = makeInstance();
    global.localStorage.setItem('test-scanned-repos', '{not json');
    expect(inst.readPersistedRepoCache('test-scanned-repos')).toBeNull();
    global.localStorage.setItem('test-scanned-repos', JSON.stringify({ value: 'nope', fetchedAt: Date.now() }));
    expect(inst.readPersistedRepoCache('test-scanned-repos')).toBeNull();
  });

  test('invalidate clears both memory and storage', () => {
    const inst = makeInstance();
    inst.writePersistedRepoCache('test-scanned-repos', { value: [{ name: 'x' }], fetchedAt: Date.now() });
    inst.invalidateScannedReposCache();
    expect(inst.scannedReposCache.value).toBeNull();
    expect(global.localStorage.getItem('test-scanned-repos')).toBeNull();
  });
});
