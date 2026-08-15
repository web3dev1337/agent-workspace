const { CommanderService } = require('../../server/commanderService');
const { SessionManager } = require('../../server/sessionManager');

// Claude Code's TUI positions text with cursor movements, so after control
// sequences are stripped the banner can arrive with no spaces at all. The
// matchers must work on both spaced and space-collapsed output.

describe('CommanderService.matchesClaudeReadyPrompt', () => {
  const matches = (text) => CommanderService.prototype.matchesClaudeReadyPrompt.call({}, text);

  test('matches the space-collapsed v2 banner (real 2.1.220 capture)', () => {
    expect(matches('▐▛███▜▌claudecodev2.1.220\n▝▜█████▛▘fable5withloweffort·claudemax')).toBe(true);
  });

  test('matches the classically spaced v2 banner', () => {
    expect(matches('claude code v2.0.14')).toBe(true);
  });

  test('matches the interactive permission-mode status line', () => {
    expect(matches('⏵⏵bypasspermissionson (shift+tabtocycle)')).toBe(true);
    expect(matches('⏵⏵ bypass permissions on (shift+tab to cycle)')).toBe(true);
  });

  test('does not match upgrade notices', () => {
    expect(matches('claude code v2.1.201 -> v2.1.205')).toBe(false);
    expect(matches('claudecodev2.1.201->v2.1.205')).toBe(false);
  });

  test('does not match unrelated output', () => {
    expect(matches('installing claude code version manager')).toBe(false);
    expect(matches('')).toBe(false);
  });

  test('matches the v1 welcome banner', () => {
    expect(matches('welcome to claude code — ? for shortcuts')).toBe(true);
  });
});

describe('trust prompt matchers survive space-collapsed TUI output', () => {
  const commanderMatch = (text) => CommanderService.prototype.matchesClaudeTrustPrompt.call({}, text);
  const sessionMatch = (text) => SessionManager.prototype.matchesClaudeTrustPrompt.call({}, text);

  const spaced = 'Quick safety check: do you trust this folder?';
  const collapsed = 'quicksafetycheck:doyoutrustthisfolder?';

  test.each([
    ['CommanderService', commanderMatch],
    ['SessionManager', sessionMatch]
  ])('%s matches spaced and collapsed prompts', (_name, match) => {
    expect(match(spaced)).toBe(true);
    expect(match(collapsed)).toBe(true);
    expect(match('quick safety check with no trust wording')).toBe(false);
    expect(match('do you trust this folder?')).toBe(false); // no safety-check header
  });
});
