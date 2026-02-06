const fs = require('fs');
const path = require('path');

const readUtf8 = (p) => fs.readFileSync(p, 'utf8');

const extractCommanderActionsFromRegistry = (src) => {
  const actions = new Set();
  const re = /io\.emit\(\s*['"]commander-action['"]\s*,\s*\{[^}]*\baction:\s*['"]([^'"]+)['"][^}]*\}\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const action = String(m[1] || '').trim();
    if (action) actions.add(action);
  }
  return actions;
};

const extractCasesFromHandleCommanderAction = (src) => {
  const fnIndex = src.indexOf('handleCommanderAction(action, params)');
  if (fnIndex < 0) throw new Error('handleCommanderAction(action, params) not found in client/app.js');

  // Don’t do brace matching: the function contains template literals (${...})
  // which include braces and break naive counting.
  // Support both LF and CRLF checkouts.
  const after = src.slice(fnIndex);
  const nextFnMatch = after.match(/\r?\n\r?\n\s{2}handleSessionExit\(/);
  if (!nextFnMatch || typeof nextFnMatch.index !== 'number') {
    throw new Error('Could not find handleSessionExit() after handleCommanderAction()');
  }
  const nextFn = fnIndex + nextFnMatch.index;
  const body = src.slice(fnIndex, nextFn);
  const cases = new Set();
  const re = /\bcase\s+['"]([^'"]+)['"]\s*:/g;
  let m;
  while ((m = re.exec(body))) {
    const value = String(m[1] || '').trim();
    if (value) cases.add(value);
  }
  return cases;
};

describe('Commander action coverage', () => {
  it('client handleCommanderAction covers all actions emitted by server/commandRegistry.js', () => {
    const registryPath = path.join(__dirname, '..', '..', 'server', 'commandRegistry.js');
    const clientPath = path.join(__dirname, '..', '..', 'client', 'app.js');

    const registrySrc = readUtf8(registryPath);
    const clientSrc = readUtf8(clientPath);

    const registryActions = extractCommanderActionsFromRegistry(registrySrc);
    const handledActions = extractCasesFromHandleCommanderAction(clientSrc);

    const missing = Array.from(registryActions).filter((a) => !handledActions.has(a)).sort();
    expect(missing).toEqual([]);
  });
});
