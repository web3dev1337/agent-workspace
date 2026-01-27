jest.mock('../../server/utils/httpJson', () => ({
  requestJson: jest.fn()
}));

const { requestJson } = require('../../server/utils/httpJson');
const { TrelloTaskProvider, parseTrelloDependenciesFromCard } = require('../../server/taskProviders/trelloProvider');

describe('TrelloTaskProvider', () => {
  beforeEach(() => {
    requestJson.mockReset();
  });

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

  test('parseTrelloDependenciesFromCard extracts Dependencies checklist items', () => {
    const card = {
      checklists: [
        { id: 'cl-other', name: 'Todo', checkItems: [{ id: 'x', name: 'nope', state: 'incomplete' }] },
        {
          id: 'cl-deps',
          name: 'Dependencies',
          checkItems: [
            { id: 'i1', name: 'https://trello.com/c/AbCdEf12/some-card', state: 'incomplete' },
            { id: 'i2', name: 'Blocked by https://example.com/thing', state: 'complete' }
          ]
        }
      ]
    };

    const deps = parseTrelloDependenciesFromCard(card);
    expect(deps.checklistId).toBe('cl-deps');
    expect(deps.items.map(i => i.id)).toEqual(['i1', 'i2']);
    expect(deps.items[0].shortLink).toBe('AbCdEf12');
    expect(deps.items[0].url).toBe('https://trello.com/c/AbCdEf12/some-card');
    expect(deps.items[1].state).toBe('complete');
  });

  test('parseTrelloDependenciesFromCard supports custom checklist name', () => {
    const card = {
      checklists: [
        {
          id: 'cl-custom',
          name: 'Blockers',
          checkItems: [{ id: 'i1', name: 'https://trello.com/c/AbCdEf12/some-card', state: 'incomplete' }]
        }
      ]
    };

    const depsDefault = parseTrelloDependenciesFromCard(card);
    expect(depsDefault.checklistId).toBeNull();
    expect(depsDefault.items).toEqual([]);

    const depsCustom = parseTrelloDependenciesFromCard(card, { checklistName: 'Blockers' });
    expect(depsCustom.checklistId).toBe('cl-custom');
    expect(depsCustom.items.map(i => i.id)).toEqual(['i1']);
  });

  test('listBoardLabels hits board labels endpoint with fields + limit', async () => {
    const provider = new TrelloTaskProvider({ cache: null, logger: { warn: jest.fn() } });
    provider.getCredentials = () => ({ apiKey: 'k', token: 't', source: 'test' });

    provider._getCached = jest.fn().mockResolvedValue([{ id: 'l1' }]);

    const labels = await provider.listBoardLabels({ boardId: 'b1', refresh: false });
    expect(labels).toEqual([{ id: 'l1' }]);
    expect(provider._getCached).toHaveBeenCalledTimes(1);

    const [, url] = provider._getCached.mock.calls[0];
    expect(url).toContain('/boards/b1/labels');
    expect(url).toContain('fields=name%2Ccolor');
    expect(url).toContain('limit=1000');
  });

  test('updateCard supports idLabels array updates', async () => {
    const provider = new TrelloTaskProvider({ cache: null, logger: { warn: jest.fn() } });
    provider.getCredentials = () => ({ apiKey: 'k', token: 't', source: 'test' });

    requestJson.mockResolvedValueOnce({ id: 'c1', idList: 'l1', idBoard: 'b1' });

    await provider.updateCard({ cardId: 'c1', fields: { idLabels: ['a', 'b'] } });
    expect(requestJson).toHaveBeenCalledTimes(1);

    const [, opts] = requestJson.mock.calls[0];
    expect(opts.method).toBe('PUT');
    expect(opts.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(String(opts.body)).toContain('idLabels=a%2Cb');
  });

  test('setCustomFieldItem sends JSON payload to Trello', async () => {
    const provider = new TrelloTaskProvider({ cache: null, logger: { warn: jest.fn() } });
    provider.getCredentials = () => ({ apiKey: 'k', token: 't', source: 'test' });

    requestJson.mockResolvedValueOnce({ ok: true });

    const payload = { value: { text: 'hello' } };
    await provider.setCustomFieldItem({ cardId: 'c1', customFieldId: 'cf1', payload });

    expect(requestJson).toHaveBeenCalledTimes(1);
    const [url, opts] = requestJson.mock.calls[0];
    expect(url).toContain('/card/c1/customField/cf1/item');
    expect(opts.method).toBe('PUT');
    expect(opts.headers['content-type']).toBe('application/json');
    expect(opts.body).toEqual(payload);
  });

  test('getMe hits /members/me with fields', async () => {
    const provider = new TrelloTaskProvider({ cache: null, logger: { warn: jest.fn() } });
    provider.getCredentials = () => ({ apiKey: 'k', token: 't', source: 'test' });

    provider._getCached = jest.fn().mockResolvedValue({ id: 'm1', username: 'me' });

    const me = await provider.getMe({ refresh: false });
    expect(me).toEqual({ id: 'm1', username: 'me' });
    expect(provider._getCached).toHaveBeenCalledTimes(1);
    const [, url] = provider._getCached.mock.calls[0];
    expect(url).toContain('/members/me');
    expect(url).toContain('fields=fullName%2Cusername%2CavatarUrl');
  });
});
