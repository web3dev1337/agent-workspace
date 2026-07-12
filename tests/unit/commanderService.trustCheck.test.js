/**
 * Unit tests for isCommanderCwdTrusted (reads Claude Code's per-project trust
 * record from ~/.claude.json) and for the immediate launch-queue flush when
 * the Commander cwd is already trusted (expectTrustPrompt: false).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_COMMANDER_CWD = process.env.COMMANDER_CWD;

function restoreEnv() {
  if (ORIGINAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIGINAL_HOME;
  if (ORIGINAL_COMMANDER_CWD === undefined) delete process.env.COMMANDER_CWD;
  else process.env.COMMANDER_CWD = ORIGINAL_COMMANDER_CWD;
}

function loadModuleWith({ home, commanderCwd }) {
  let mod;
  jest.isolateModules(() => {
    process.env.HOME = home;
    process.env.COMMANDER_CWD = commanderCwd;
    mod = require('../../server/commanderService');
  });
  return mod;
}

describe('isCommanderCwdTrusted', () => {
  let homeDir;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-trust-'));
  });

  afterEach(() => {
    restoreEnv();
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  function writeClaudeConfig(projects) {
    fs.writeFileSync(path.join(homeDir, '.claude.json'), JSON.stringify({ projects }));
  }

  it('returns true for a trusted cwd even when separators differ', () => {
    // Claude Code stores project keys with forward slashes; the cwd may use
    // native (backslash) separators on Windows.
    const projectDir = path.join(homeDir, 'commander');
    writeClaudeConfig({
      [projectDir.replace(/\\/g, '/')]: { hasTrustDialogAccepted: true }
    });

    const { isCommanderCwdTrusted } = loadModuleWith({ home: homeDir, commanderCwd: projectDir });
    expect(isCommanderCwdTrusted()).toBe(true);
  });

  it('returns false when the cwd is not in the projects list', () => {
    writeClaudeConfig({ '/some/other/project': { hasTrustDialogAccepted: true } });

    const { isCommanderCwdTrusted } = loadModuleWith({
      home: homeDir,
      commanderCwd: path.join(homeDir, 'commander')
    });
    expect(isCommanderCwdTrusted()).toBe(false);
  });

  it('returns false when the trust dialog was not accepted', () => {
    const projectDir = path.join(homeDir, 'commander');
    writeClaudeConfig({
      [projectDir.replace(/\\/g, '/')]: { hasTrustDialogAccepted: false }
    });

    const { isCommanderCwdTrusted } = loadModuleWith({ home: homeDir, commanderCwd: projectDir });
    expect(isCommanderCwdTrusted()).toBe(false);
  });

  it('returns false when ~/.claude.json does not exist', () => {
    const { isCommanderCwdTrusted } = loadModuleWith({
      home: homeDir,
      commanderCwd: path.join(homeDir, 'commander')
    });
    expect(isCommanderCwdTrusted()).toBe(false);
  });

  it('returns false when ~/.claude.json is malformed', () => {
    fs.writeFileSync(path.join(homeDir, '.claude.json'), 'not json {');

    const { isCommanderCwdTrusted } = loadModuleWith({
      home: homeDir,
      commanderCwd: path.join(homeDir, 'commander')
    });
    expect(isCommanderCwdTrusted()).toBe(false);
  });
});

describe('launch queue with a trusted cwd (expectTrustPrompt: false)', () => {
  const { CommanderService } = require('../../server/commanderService');
  let service;
  const newline = process.platform === 'win32' ? '\r\n' : '\n';

  beforeEach(() => {
    jest.useFakeTimers();
    CommanderService.instance = null;
    service = CommanderService.getInstance({ io: null, sessionManager: null });
  });

  afterEach(() => {
    if (service.session) {
      service.stop();
    }
    CommanderService.instance = null;
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('flushes queued input immediately on the banner, without the grace window', () => {
    const writes = [];
    service.session = {
      id: 'commander',
      pty: { write: (data) => writes.push(data), kill: jest.fn() }
    };
    service.claudeStarted = true;

    service.beginClaudeLaunch({ expectTrustPrompt: false });
    expect(service.sendInput('hello\n')).toBe(true);
    expect(writes).toEqual([]);

    service.handleClaudeLaunchOutput('Claude Code v2.1.201\nType a message');
    expect(writes).toEqual([`hello${newline}`]);
    expect(service.claudeLaunchState).toBeNull();
  });
});
