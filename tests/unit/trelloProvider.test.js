const { TrelloTaskProvider } = require('../../server/taskProviders/trelloProvider');

describe('TrelloTaskProvider', () => {
  test('listBoardCards falls back to per-list aggregation when board endpoint fails', async () => {
    const provider = new TrelloTaskProvider({ cache: null, logger: { warn: jest.fn() } });

    provider.getCredentials = () => ({ apiKey: 'k', token: 't', source: 'test' });

    provider._getCached = jest.fn().mockRejectedValue(new Error('boom'));
    provider.listLists = jest.fn().mockResolvedValue([{ id: 'l1' }, { id: 'l2' }]);
    provider.listCards = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'c1', dateLastActivity: '2026-01-02T00:00:00Z' }])
      .mockResolvedValueOnce([{ id: 'c2', dateLastActivity: '2026-01-03T00:00:00Z' }]);

    const cards = await provider.listBoardCards({ boardId: 'b1', q: '', updatedSince: null });
    expect(cards.map(c => c.id)).toEqual(['c2', 'c1']);
    expect(provider.listLists).toHaveBeenCalled();
    expect(provider.listCards).toHaveBeenCalledTimes(2);
  });
});

