const fs = require('fs');
const path = require('path');

function loadProjectsBoardUI() {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'projects-board.js'), 'utf8');
  const windowStub = {};
  new Function('window', src)(windowStub);
  return windowStub.ProjectsBoardUI;
}

function visibleNames(ui) {
  const byColumn = ui.buildFullColumnModel();
  const names = [];
  for (const list of byColumn.values()) {
    for (const project of list) names.push(project.name);
  }
  return names.sort();
}

function daysAgoIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe('ProjectsBoardUI recency filter', () => {
  let ProjectsBoardUI;

  beforeAll(() => {
    ProjectsBoardUI = loadProjectsBoardUI();
  });

  function buildUi() {
    const ui = new ProjectsBoardUI(null);
    ui.projects = [
      { key: 'tools/fresh-repo', name: 'fresh-repo', path: '/x/fresh-repo', type: 'node', category: 'tools' },
      { key: 'tools/stale-repo', name: 'stale-repo', path: '/x/stale-repo', type: 'node', category: 'tools' },
      { key: 'tools/local-only', name: 'local-only', path: '/x/local-only', type: 'node', category: 'tools' },
      { key: 'github:me/fresh-fork', name: 'fresh-fork', path: '', type: 'github-remote', category: 'GitHub — not cloned' },
      { key: 'github:me/never-pushed', name: 'never-pushed', path: '', type: 'github-remote', category: 'GitHub — not cloned' }
    ];
    ui.githubRepos = [
      { name: 'fresh-repo', nameWithOwner: 'me/fresh-repo', isFork: false, pushedAt: daysAgoIso(2) },
      { name: 'stale-repo', nameWithOwner: 'me/stale-repo', isFork: false, pushedAt: daysAgoIso(90) },
      { name: 'fresh-fork', nameWithOwner: 'me/fresh-fork', isFork: true, pushedAt: daysAgoIso(1) },
      { name: 'never-pushed', nameWithOwner: 'me/never-pushed', isFork: false, pushedAt: null }
    ];
    return ui;
  }

  test('recencyDays=0 shows everything', () => {
    const ui = buildUi();
    ui.recencyDays = 0;
    expect(visibleNames(ui)).toEqual(['fresh-fork', 'fresh-repo', 'local-only', 'never-pushed', 'stale-repo']);
  });

  test('recencyDays=7 hides repos with no push inside the window', () => {
    const ui = buildUi();
    ui.recencyDays = 7;
    expect(visibleNames(ui)).toEqual(['fresh-fork', 'fresh-repo', 'local-only']);
  });

  test('local-only repos without GitHub data stay visible under a recency filter', () => {
    const ui = buildUi();
    ui.recencyDays = 1;
    expect(visibleNames(ui)).toContain('local-only');
  });

  test('GitHub repos that were never pushed are hidden under a recency filter', () => {
    const ui = buildUi();
    ui.recencyDays = 30;
    expect(visibleNames(ui)).not.toContain('never-pushed');
  });

  test('hide forks combines with recency', () => {
    const ui = buildUi();
    ui.recencyDays = 7;
    ui.hideForks = true;
    expect(visibleNames(ui)).toEqual(['fresh-repo', 'local-only']);
  });

  test('hide forks alone still works via the shared meta map', () => {
    const ui = buildUi();
    ui.hideForks = true;
    expect(visibleNames(ui)).toEqual(['fresh-repo', 'local-only', 'never-pushed', 'stale-repo']);
  });

  test('formatPushAge renders compact ages', () => {
    const ui = buildUi();
    expect(ui.formatPushAge(Date.now() - 60 * 60 * 1000)).toBe('today');
    expect(ui.formatPushAge(Date.now() - 3 * 24 * 60 * 60 * 1000)).toBe('3d ago');
    expect(ui.formatPushAge(null)).toBe('');
  });
});
