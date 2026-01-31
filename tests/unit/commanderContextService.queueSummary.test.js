const commanderContextService = require('../../server/commanderContextService').CommanderContextService.getInstance();

describe('CommanderContextService queueSummary', () => {
  test('stores bounded queueSummary items and filters missing ids', () => {
    try {
      commanderContextService.setContext({
        queueSummary: [
          { id: 'pr:a/b#1', title: 'One', tier: 1, claimedBy: 'me' },
          { id: '', title: 'Nope' },
          { title: 'No id either' }
        ]
      }, { source: 'test' });

      const snap = commanderContextService.getSnapshot();
      expect(Array.isArray(snap.context.queueSummary)).toBe(true);
      expect(snap.context.queueSummary.length).toBe(1);
      expect(snap.context.queueSummary[0]).toMatchObject({ id: 'pr:a/b#1', title: 'One', claimedBy: 'me' });
    } finally {
      commanderContextService.setContext({}, { source: 'test-reset' });
    }
  });
});
