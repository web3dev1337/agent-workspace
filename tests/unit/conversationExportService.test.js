const { sanitizeFilename, formatConversationAsMarkdown } = require('../../server/conversationExportService');

describe('conversationExportService', () => {
  test('sanitizeFilename removes unsafe characters', () => {
    expect(sanitizeFilename('hello/world')).toBe('hello_world');
    expect(sanitizeFilename('  a  b  ')).toBe('a_b');
    expect(sanitizeFilename('')).toBe('');
  });

  test('formatConversationAsMarkdown renders messages', () => {
    const md = formatConversationAsMarkdown({
      id: 'abc',
      project: 'proj',
      source: 'claude',
      messages: [
        { role: 'user', timestamp: '2026-01-30T00:00:00Z', content: 'hi' },
        { role: 'assistant', content: [{ type: 'text', text: 'hello' }] }
      ]
    });
    expect(md).toContain('# proj');
    expect(md).toContain('## Messages (2)');
    expect(md).toContain('### user (2026-01-30T00:00:00Z)');
    expect(md).toContain('hi');
    expect(md).toContain('### assistant');
    expect(md).toContain('hello');
  });
});

