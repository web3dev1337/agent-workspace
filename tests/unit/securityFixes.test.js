const fs = require('fs');
const os = require('os');
const path = require('path');

const AgentManager = require('../../server/agentManager');
const { resolveServerLaunchCommand } = require('../../server/serverLaunchCommandResolver');
const { EvidenceService } = require('../../server/evidenceService');
const { TaskRecordService } = require('../../server/taskRecordService');
const { isSafeModel, isSafeFlag, hasDangerousShell } = require('../../server/utils/shellSafety');

const writeAgents = (agents) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-sec-'));
  const p = path.join(tmp, 'custom-agents.json');
  fs.writeFileSync(p, JSON.stringify({ agents }));
  return p;
};

describe('shell-injection guards (Codex findings #1, #2)', () => {
  test('malicious model value is dropped, not interpolated into the command', () => {
    const mgr = new AgentManager({ customAgentsPath: null });
    const cmd = mgr.buildCommand('codex', 'fresh', {
      agentId: 'codex', flags: ['yolo'], model: 'x; touch /tmp/pwned'
    });
    expect(cmd).not.toContain('touch');
    expect(cmd).not.toContain(';');
  });

  test('custom agent with an injecting flag is rejected at load', () => {
    const mgr = new AgentManager({
      customAgentsPath: writeAgents({
        evil: { baseCommand: 'x', flags: { bad: { flag: '--f; rm -rf /' } } }
      })
    });
    expect(mgr.getAgent('evil')).toBeUndefined();
  });

  test('custom agent with an injecting modelFlag template is rejected at load', () => {
    const mgr = new AgentManager({
      customAgentsPath: writeAgents({
        evil: { baseCommand: 'x', modelFlag: '-m {model}; curl evil' }
      })
    });
    expect(mgr.getAgent('evil')).toBeUndefined();
  });

  test('serverLaunchCommandResolver drops shell metacharacters in config flags', async () => {
    const workspaceManager = {
      getActiveWorkspace: () => ({ id: 'ws1', type: 'hytopia-game' }),
      getWorkspaceById: () => ({ terminals: { pairs: [{ worktreeId: 'work1', repository: { name: 'g', type: 'hytopia-game' } }] } }),
      getCascadedConfigForWorktree: async () => ({
        serverCommand: 'hytopia start {{gameMode}} {{commonFlags}}',
        gameModes: { evil: { flag: '--mode=x; curl evil.example' } },
        commonFlags: { ok: { flag: '--safe' } }
      })
    };
    const result = await resolveServerLaunchCommand({
      workspaceManager, sessionId: 'g-work1-server', environment: 'evil',
      launchSettings: { flags: { ok: true } }
    });
    expect(result.command).not.toContain('curl');
    expect(result.command).not.toContain(';');
    expect(result.command).toContain('--safe');
    expect(hasDangerousShell(result.command)).toBe(false);
  });

  test('serverCommand template with metacharacters falls back to the safe default', async () => {
    const workspaceManager = {
      getActiveWorkspace: () => ({ id: 'ws1', type: 'website' }),
      getWorkspaceById: () => ({ terminals: { pairs: [{ worktreeId: 'work1', repository: { name: 'g', type: 'website' } }] } }),
      getCascadedConfigForWorktree: async () => ({ serverCommand: 'npm run dev; curl evil' })
    };
    const result = await resolveServerLaunchCommand({ workspaceManager, sessionId: 'g-work1-server', environment: 'development' });
    expect(result.command).toBe('npm run dev');
  });

  test('shellSafety validators', () => {
    expect(isSafeModel('claude-opus-4-8[1m]')).toBe(true);
    expect(isSafeModel('x; rm -rf /')).toBe(false);
    expect(isSafeFlag('--sandbox workspace-write')).toBe(true);
    expect(isSafeFlag('--x`whoami`')).toBe(false);
  });
});

describe('evidence media path safety (Codex findings #3, #4)', () => {
  const setup = async ({ registerWorktree = true } = {}) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-evsec-'));
    const worktree = path.join(tmp, 'repo', 'work1');
    fs.mkdirSync(path.join(worktree, '.agent-evidence'), { recursive: true });
    fs.writeFileSync(path.join(worktree, '.agent-evidence', 'shot.png'), 'png');
    // secret outside the worktree + a symlink to it from inside
    fs.writeFileSync(path.join(tmp, 'secret.png'), 'SECRET');
    fs.symlinkSync(path.join(tmp, 'secret.png'), path.join(worktree, '.agent-evidence', 'leak.png'));

    const taskRecordService = new TaskRecordService({ filePath: path.join(tmp, 'task-records.json') });
    const workspaceManager = {
      getActiveWorkspace: () => ({ id: 'ws1' }),
      getWorkspaceById: () => ({
        terminals: registerWorktree
          ? [{ repository: { path: path.join(tmp, 'repo') }, worktreeId: 'work1' }]
          : []
      })
    };
    const svc = new EvidenceService({ taskRecordService, workspaceManager });
    return { svc, taskRecordService, worktree, tmp };
  };

  test('a symlink escaping the worktree is rejected (no secret served)', async () => {
    const { svc, taskRecordService, worktree } = await setup();
    await taskRecordService.upsert('task:x', {
      evidence: { media: [{ type: 'image', path: '.agent-evidence/leak.png' }], worktreePath: worktree }
    });
    const result = svc.resolveMediaPath('task:x', 0);
    expect(result.error).toBeTruthy();
    expect([403, 404]).toContain(result.status);
  });

  test('a legitimate file inside the worktree still resolves', async () => {
    const { svc, taskRecordService, worktree } = await setup();
    await taskRecordService.upsert('task:x', {
      evidence: { media: [{ type: 'image', path: '.agent-evidence/shot.png' }], worktreePath: worktree }
    });
    const result = svc.resolveMediaPath('task:x', 0);
    expect(result.path).toBeTruthy();
    expect(fs.readFileSync(result.path, 'utf8')).toBe('png');
  });

  test('refresh() ignores an explicit worktreePath that is not a known worktree', async () => {
    const { svc, tmp } = await setup({ registerWorktree: false });
    const result = await svc.refresh('task:y', { worktreePath: path.join(tmp, 'repo', 'work1') });
    // not a registered worktree -> no trusted root persisted
    expect(result.evidence?.worktreePath).toBeUndefined();
  });

  test('refresh() accepts a worktreePath that IS a known workspace worktree', async () => {
    const { svc, worktree } = await setup({ registerWorktree: true });
    fs.writeFileSync(path.join(worktree, '.agent-evidence.json'), JSON.stringify({ summary: 'local' }));
    const result = await svc.refresh('task:z', { worktreePath: worktree });
    expect(result.updated).toBe(true);
    expect(result.evidence.summary).toBe('local');
  });
});
