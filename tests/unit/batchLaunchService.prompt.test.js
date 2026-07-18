const { BatchLaunchService } = require('../../server/batchLaunchService');
const { buildEvidencePromptSnippet } = require('../../server/evidencePromptSnippet');
const { parseEvidenceBlocks } = require('../../server/evidenceService');

const makeService = (settings = {}) => new BatchLaunchService({
  userSettingsService: { getAllSettings: () => settings }
});

describe('BatchLaunchService prompt evidence snippet', () => {
  const card = { name: 'Fix spawn bug', desc: 'The spawner double-fires.' };

  test('appends the evidence protocol by default', () => {
    const prompt = makeService()._buildPrompt({ card, cardUrl: 'https://trello.com/c/x', cardShortId: 'x' });
    expect(prompt).toContain('EVIDENCE PROTOCOL');
    expect(prompt).toContain('```agent-evidence');
    expect(prompt).toContain('The spawner double-fires.');
  });

  test('can be disabled via settings', () => {
    const prompt = makeService({
      global: { ui: { tasks: { evidencePromptEnabled: false } } }
    })._buildPrompt({ card, cardUrl: '', cardShortId: '' });
    expect(prompt).not.toContain('EVIDENCE PROTOCOL');
  });

  test('snippet example block round-trips through the evidence parser', () => {
    const blocks = parseEvidenceBlocks(buildEvidencePromptSnippet());
    expect(blocks).toHaveLength(1);
    expect(blocks[0].tests.command).toBe('npm test');
  });
});
