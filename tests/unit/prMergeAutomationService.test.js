const { extractTrelloShortLinks, pickDoneListId } = require('../../server/prMergeAutomationService');

describe('PrMergeAutomationService helpers', () => {
  test('extractTrelloShortLinks finds trello.com/c URLs and trello: tags', () => {
    const text = `
      This PR relates to https://trello.com/c/AbC123/99-something
      and also trello:ZZZ999 (fallback).
    `;
    const refs = extractTrelloShortLinks(text);
    expect(refs).toContain('AbC123');
    expect(refs).toContain('ZZZ999');
  });

  test('pickDoneListId prefers merged/shipped over done', () => {
    const lists = [
      { id: '1', name: 'In Progress' },
      { id: '2', name: 'Done' },
      { id: '3', name: 'Merged' }
    ];
    expect(pickDoneListId(lists)).toBe('3');
  });
});

