const { ClaudeVersionChecker } = require('../../server/claudeVersionChecker');

describe('ClaudeVersionChecker.generateUpdateInstructions', () => {
  test('uses the required version fallback when version detection fails', () => {
    const info = ClaudeVersionChecker.generateUpdateInstructions({
      version: null,
      isCompatible: false,
      error: 'spawn claude ENOENT'
    });

    expect(info).toEqual({
      title: 'Claude CLI Update Required',
      message: 'Your Claude CLI version could not be detected (unknown). Version 1.0.24 or higher is required.',
      instructions: [
        'Run the following command to update:',
        '  claude update',
        '',
        'If that fails, try:',
        '  npm install -g @anthropic-ai/claude-cli@latest',
        '',
        'After updating, restart the orchestrator.'
      ]
    });
  });

  test('preserves the detected version when the installed CLI is too old', () => {
    const info = ClaudeVersionChecker.generateUpdateInstructions({
      version: '1.0.10',
      isCompatible: false,
      requiredVersion: '1.0.24'
    });

    expect(info.message).toBe('Your Claude CLI version (1.0.10) is outdated. Version 1.0.24 or higher is required.');
  });

  test('returns null when the installed CLI is compatible', () => {
    expect(ClaudeVersionChecker.generateUpdateInstructions({
      version: '1.0.24',
      isCompatible: true,
      requiredVersion: '1.0.24'
    })).toBeNull();
  });
});
