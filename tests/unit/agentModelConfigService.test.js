const fs = require('fs');
const os = require('os');
const path = require('path');
const { AgentModelConfigService } = require('../../server/agentModelConfigService');

describe('AgentModelConfigService', () => {
  let homeDir;
  let worktreeDir;

  const writeFileInside = (baseDir, segments, content) => {
    const file = path.join(baseDir, ...segments);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return file;
  };

  const writeClaudeSettings = (baseDir, fileName, settings) =>
    writeFileInside(baseDir, ['.claude', fileName], JSON.stringify(settings));

  // processEnv defaults to {} so host machines with ANTHROPIC_*/CLAUDE_CODE_*
  // env vars set can't leak into these tests.
  const createService = (options = {}) =>
    new AgentModelConfigService({ homeDir, logger: { debug: () => {} }, processEnv: {}, ...options });

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-model-home-'));
    worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-model-worktree-'));
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(worktreeDir, { recursive: true, force: true });
  });

  test('falls back to user settings when the worktree has none', () => {
    writeClaudeSettings(homeDir, 'settings.json', { model: 'claude-fable-5[1m]', effortLevel: 'high' });

    const resolved = createService().resolveClaudeConfig(worktreeDir);

    expect(resolved.model).toBe('claude-fable-5[1m]');
    expect(resolved.effortLevel).toBe('high');
    expect(resolved.modelSource.label).toBe('user settings (global)');
    expect(resolved.effortSource.label).toBe('user settings (global)');
  });

  test('worktree local settings win over project and user settings', () => {
    writeClaudeSettings(homeDir, 'settings.json', { model: 'claude-fable-5[1m]', effortLevel: 'high' });
    writeClaudeSettings(worktreeDir, 'settings.json', { effortLevel: 'medium' });
    writeClaudeSettings(worktreeDir, 'settings.local.json', { effortLevel: 'xhigh' });

    const resolved = createService().resolveClaudeConfig(worktreeDir);

    expect(resolved.effortLevel).toBe('xhigh');
    expect(resolved.effortSource.label).toBe('local settings');
    // model is not set locally, so it still comes from the user layer
    expect(resolved.model).toBe('claude-fable-5[1m]');
    expect(resolved.modelSource.label).toBe('user settings (global)');
  });

  test('project settings win over user settings', () => {
    writeClaudeSettings(homeDir, 'settings.json', { model: 'claude-fable-5[1m]', effortLevel: 'high' });
    writeClaudeSettings(worktreeDir, 'settings.json', { model: 'claude-opus-4-8', effortLevel: 'low' });

    const resolved = createService().resolveClaudeConfig(worktreeDir);

    expect(resolved.model).toBe('claude-opus-4-8');
    expect(resolved.effortLevel).toBe('low');
    expect(resolved.modelSource.label).toBe('project settings');
  });

  test('ignores malformed settings files and keeps cascading', () => {
    writeClaudeSettings(homeDir, 'settings.json', { model: 'claude-fable-5[1m]', effortLevel: 'high' });
    writeFileInside(worktreeDir, ['.claude', 'settings.local.json'], '{not json');

    const resolved = createService().resolveClaudeConfig(worktreeDir);

    expect(resolved.model).toBe('claude-fable-5[1m]');
    expect(resolved.effortLevel).toBe('high');
  });

  test('returns nulls when no settings exist anywhere', () => {
    const resolved = createService().resolveClaudeConfig(worktreeDir);

    expect(resolved).toEqual({
      agent: 'claude',
      model: null,
      effortLevel: null,
      modelSource: null,
      effortSource: null
    });
  });

  test('handles a missing worktree directory by using user settings only', () => {
    writeClaudeSettings(homeDir, 'settings.json', { effortLevel: 'medium' });

    const resolved = createService().resolveClaudeConfig('');

    expect(resolved.effortLevel).toBe('medium');
    expect(resolved.model).toBeNull();
  });

  test('reads codex model and reasoning effort from top-level config.toml keys', () => {
    writeFileInside(homeDir, ['.codex', 'config.toml'], [
      'model = "gpt-5.3-codex"',
      'model_reasoning_effort = "XHIGH"',
      '',
      '[profiles.other]',
      'model = "ignored-model"'
    ].join('\n'));

    const resolved = createService().resolveCodexConfig();

    expect(resolved.model).toBe('gpt-5.3-codex');
    expect(resolved.effortLevel).toBe('xhigh');
    expect(resolved.modelSource.label).toBe('codex config (global)');
  });

  test('returns nulls when codex config is missing', () => {
    const resolved = createService().resolveCodexConfig();

    expect(resolved.model).toBeNull();
    expect(resolved.effortLevel).toBeNull();
  });

  test('caches file reads within the TTL window', () => {
    writeClaudeSettings(homeDir, 'settings.json', { effortLevel: 'high' });
    let reads = 0;
    const countingFs = {
      readFileSync: (...args) => {
        reads += 1;
        return fs.readFileSync(...args);
      }
    };
    const service = createService({ fsImpl: countingFs });

    service.resolveClaudeConfig(worktreeDir);
    const readsAfterFirst = reads;
    service.resolveClaudeConfig(worktreeDir);

    expect(readsAfterFirst).toBeGreaterThan(0);
    expect(reads).toBe(readsAfterFirst);
  });

  test('maps model aliases through ANTHROPIC_DEFAULT_*_MODEL env blocks', () => {
    writeClaudeSettings(homeDir, 'settings.json', {
      model: 'opus',
      env: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-4-8[1m]' }
    });

    const resolved = createService().resolveClaudeConfig(worktreeDir);

    expect(resolved.model).toBe('claude-opus-4-8[1m]');
    expect(resolved.modelSource.label).toBe('ANTHROPIC_DEFAULT_OPUS_MODEL via env block (user settings (global))');
  });

  test('maps the fable alias through ANTHROPIC_DEFAULT_FABLE_MODEL', () => {
    writeClaudeSettings(homeDir, 'settings.json', {
      model: 'fable',
      env: { ANTHROPIC_DEFAULT_FABLE_MODEL: 'claude-fable-5[1m]' }
    });

    const resolved = createService().resolveClaudeConfig(worktreeDir);

    expect(resolved.model).toBe('claude-fable-5[1m]');
  });

  test('leaves aliases untouched when no default env var resolves them', () => {
    writeClaudeSettings(homeDir, 'settings.json', { model: 'opus' });

    const resolved = createService().resolveClaudeConfig(worktreeDir);

    expect(resolved.model).toBe('opus');
    expect(resolved.modelSource.label).toBe('user settings (global)');
  });

  test('local settings env block beats the user settings env block for aliases', () => {
    writeClaudeSettings(homeDir, 'settings.json', {
      model: 'opus',
      env: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-4-6' }
    });
    writeClaudeSettings(worktreeDir, 'settings.local.json', {
      env: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-4-8[1m]' }
    });

    const resolved = createService().resolveClaudeConfig(worktreeDir);

    expect(resolved.model).toBe('claude-opus-4-8[1m]');
    expect(resolved.modelSource.label).toBe('ANTHROPIC_DEFAULT_OPUS_MODEL via env block (local settings)');
  });

  test('ANTHROPIC_MODEL env fills in when no model key is set', () => {
    writeClaudeSettings(homeDir, 'settings.json', {
      env: { ANTHROPIC_MODEL: 'claude-sonnet-5' }
    });

    const resolved = createService().resolveClaudeConfig(worktreeDir);

    expect(resolved.model).toBe('claude-sonnet-5');
    expect(resolved.modelSource.label).toBe('env block (user settings (global))');
  });

  test('model key wins over ANTHROPIC_MODEL env', () => {
    writeClaudeSettings(homeDir, 'settings.json', {
      model: 'claude-fable-5[1m]',
      env: { ANTHROPIC_MODEL: 'claude-sonnet-5' }
    });

    const resolved = createService().resolveClaudeConfig(worktreeDir);

    expect(resolved.model).toBe('claude-fable-5[1m]');
    expect(resolved.modelSource.label).toBe('user settings (global)');
  });

  test('CLAUDE_CODE_EFFORT_LEVEL overrides the effortLevel settings key', () => {
    writeClaudeSettings(homeDir, 'settings.json', {
      effortLevel: 'high',
      env: { CLAUDE_CODE_EFFORT_LEVEL: 'XHIGH' }
    });

    const resolved = createService().resolveClaudeConfig(worktreeDir);

    expect(resolved.effortLevel).toBe('xhigh');
    expect(resolved.effortSource.label).toBe('env block (user settings (global))');
  });

  test('reads env overrides from ~/.claude/.env (export syntax, quotes, comments)', () => {
    writeClaudeSettings(homeDir, 'settings.json', { effortLevel: 'high' });
    writeFileInside(homeDir, ['.claude', '.env'], [
      '# thinking budget',
      'MAX_THINKING_TOKENS=128000',
      'export CLAUDE_CODE_EFFORT_LEVEL="max"',
      ''
    ].join('\n'));

    const resolved = createService().resolveClaudeConfig(worktreeDir);

    expect(resolved.effortLevel).toBe('max');
    expect(resolved.effortSource.label).toBe('env file');
  });

  test('settings env blocks beat ~/.claude/.env which beats the server environment', () => {
    writeFileInside(homeDir, ['.claude', '.env'], 'CLAUDE_CODE_EFFORT_LEVEL=low\n');
    const resolved = createService({ processEnv: { CLAUDE_CODE_EFFORT_LEVEL: 'medium' } })
      .resolveClaudeConfig(worktreeDir);

    expect(resolved.effortLevel).toBe('low');
    expect(resolved.effortSource.label).toBe('env file');
  });

  test('falls back to the server environment for env overrides', () => {
    const resolved = createService({ processEnv: { CLAUDE_CODE_EFFORT_LEVEL: 'medium' } })
      .resolveClaudeConfig(worktreeDir);

    expect(resolved.effortLevel).toBe('medium');
    expect(resolved.effortSource.label).toBe('server environment');
    expect(resolved.effortSource.file).toBeNull();
  });

  const writeTranscript = (svc, cwd, jsonlLines) => {
    const encoded = svc.encodeClaudeProjectDir(path.resolve(cwd));
    const dir = path.join(homeDir, '.claude', 'projects', encoded);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'session-abc.jsonl');
    fs.writeFileSync(file, jsonlLines.join('\n') + '\n');
    return file;
  };

  test('encodeClaudeProjectDir replaces non-alphanumeric chars with dashes', () => {
    const svc = createService();
    expect(svc.encodeClaudeProjectDir('C:\\Users\\cuppy\\.agent-workspace\\work1'))
      .toBe('C--Users-cuppy--agent-workspace-work1');
  });

  test('reads the most recent real model from the transcript tail, skipping synthetic', () => {
    const svc = createService();
    const file = writeTranscript(svc, worktreeDir, [
      JSON.stringify({ type: 'assistant', message: { model: 'claude-fable-5' } }),
      JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-4-8' } }),
      JSON.stringify({ type: 'assistant', message: { model: '<synthetic>' } })
    ]);
    expect(svc.readLastModelFromTranscript(file)).toBe('claude-opus-4-8');
  });

  test('resolveClaudeConfig prefers the live transcript model over the configured default', () => {
    writeClaudeSettings(homeDir, 'settings.json', { model: 'claude-fable-5[1m]', effortLevel: 'high' });
    const svc = createService();
    writeTranscript(svc, worktreeDir, [
      JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-4-8' } })
    ]);

    const resolved = svc.resolveClaudeConfig(worktreeDir);
    expect(resolved.model).toBe('claude-opus-4-8'); // live session wins
    expect(resolved.modelSource.label).toBe('live session (transcript)');
    expect(resolved.effortLevel).toBe('high'); // effort still comes from config
  });

  test('resolveClaudeConfig keeps the configured model when there is no transcript', () => {
    writeClaudeSettings(homeDir, 'settings.json', { model: 'claude-fable-5[1m]', effortLevel: 'high' });

    const resolved = createService().resolveClaudeConfig(worktreeDir);
    expect(resolved.model).toBe('claude-fable-5[1m]');
    expect(resolved.modelSource.label).toBe('user settings (global)');
  });
});
