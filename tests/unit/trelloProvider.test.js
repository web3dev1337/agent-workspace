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

  test('getBoardSnapshot groups cards by list and sorts by pos', async () => {
    const provider = new TrelloTaskProvider({ cache: null, logger: { warn: jest.fn() } });
    provider.getCredentials = () => ({ apiKey: 'k', token: 't', source: 'test' });

    provider.listLists = jest.fn().mockResolvedValue([
      { id: 'l2', name: 'B', pos: 20 },
      { id: 'l1', name: 'A', pos: 10 }
    ]);

    provider.listBoardCards = jest.fn().mockResolvedValue([
      { id: 'c2', idList: 'l1', name: 'c2', pos: 20 },
      { id: 'c1', idList: 'l1', name: 'c1', pos: 10 },
      { id: 'c3', idList: 'l2', name: 'c3', pos: 5 }
    ]);

    const snap = await provider.getBoardSnapshot({ boardId: 'b1', refresh: false });

    expect(snap.lists.map(l => l.id)).toEqual(['l1', 'l2']);
    expect(snap.cardsByList.l1.map(c => c.id)).toEqual(['c1', 'c2']);
    expect(snap.cardsByList.l2.map(c => c.id)).toEqual(['c3']);
  });
});
