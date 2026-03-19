const { getSetupActionById } = require('../../server/setupActionService');

describe('setupActionService macOS npm installs', () => {
  test('Codex CLI install falls back to a user prefix when global npm is not writable', () => {
    const action = getSetupActionById('install-codex', 'darwin');

    expect(action).toBeTruthy();
    expect(action.title).toBe('Codex CLI');
    expect(action.command).toContain('PACKAGE="@openai/codex"');
    expect(action.command).toContain('BIN="codex"');
    expect(action.command).toContain('USER_PREFIX="$HOME/.local"');
    expect(action.command).toContain('npm install -g --prefix "$USER_PREFIX" "$PACKAGE"');
  });

  test('Claude Code CLI install falls back to a user prefix when global npm is not writable', () => {
    const action = getSetupActionById('install-claude', 'darwin');

    expect(action).toBeTruthy();
    expect(action.title).toBe('Claude Code CLI');
    expect(action.command).toContain('PACKAGE="@anthropic-ai/claude-code"');
    expect(action.command).toContain('BIN="claude"');
    expect(action.command).toContain('USER_PREFIX="$HOME/.local"');
    expect(action.command).toContain('npm install -g --prefix "$USER_PREFIX" "$PACKAGE"');
  });
});

