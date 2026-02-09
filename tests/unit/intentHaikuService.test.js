const { IntentHaikuService } = require('../../server/intentHaikuService');

describe('IntentHaikuService', () => {
  test('clampSummary enforces max length with ellipsis', () => {
    const service = new IntentHaikuService({ logger: { warn: () => {} } });
    service.maxSummaryChars = 80;
    const out = service.clampSummary('a '.repeat(120));
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.endsWith('...')).toBe(true);
  });

  test('buildHeuristicSummary prefers waiting state signal', () => {
    const service = new IntentHaikuService({ logger: { warn: () => {} } });
    const summary = service.buildHeuristicSummary({
      status: 'waiting',
      branch: 'feat/intent-hints',
      lastCommand: 'npm test',
      outputTail: 'all green'
    });
    expect(summary.toLowerCase()).toContain('waiting');
    expect(summary).toContain('Branch feat/intent-hints.');
  });

  test('summarizeSession returns heuristic summary for agent sessions', async () => {
    const service = new IntentHaikuService({ logger: { warn: () => {} } });
    service.llmEnabled = false;
    service.setSessionManager({
      getSessionById: (sessionId) => {
        if (sessionId !== 'work1-claude') return null;
        return {
          type: 'claude',
          status: 'busy',
          branch: 'fix/status-lights',
          buffer: 'npm test\nFAIL some test suite\n'
        };
      }
    });
    service.noteCommand('work1-claude', 'npm test');

    const payload = await service.summarizeSession('work1-claude');
    expect(payload.source).toBe('heuristic');
    expect(payload.summary.length).toBeLessThanOrEqual(service.maxSummaryChars);
    expect(String(payload.summary).toLowerCase()).toContain('branch');
  });

  test('summarizeSession rejects unsupported session types', async () => {
    const service = new IntentHaikuService({ logger: { warn: () => {} } });
    service.setSessionManager({
      getSessionById: () => ({ type: 'server', status: 'busy', branch: 'main', buffer: '' })
    });
    await expect(service.summarizeSession('work1-server')).rejects.toMatchObject({
      code: 'UNSUPPORTED_SESSION_TYPE'
    });
  });
});
