const { TaskTicketMoveService } = require('../../server/taskTicketMoveService');

describe('TaskTicketMoveService', () => {
  test('moves ticket to configured Done list when listId omitted', async () => {
    const records = new Map();
    records.set('pr:acme/demo#1', {
      ticketProvider: 'trello',
      ticketCardId: 'AbC123'
    });

    const taskRecordService = {
      get: (id) => records.get(id) || null,
      upsert: async (id, patch) => {
        const prev = records.get(id) || {};
        const next = { ...prev, ...(patch || {}) };
        records.set(id, next);
        return next;
      }
    };

    const calls = [];
    const provider = {
      getCard: async ({ cardId }) => ({ id: cardId, idBoard: 'board1', url: `https://trello.com/c/${cardId}` }),
      listLists: async () => ([{ id: 'l1', name: 'To Do' }, { id: 'lDone', name: 'Done' }]),
      updateCard: async ({ cardId, fields }) => {
        calls.push({ type: 'updateCard', cardId, fields });
        return { id: cardId };
      }
    };

    const taskTicketingService = { getProvider: () => provider };
    const userSettingsService = {
      settings: {
        global: {
          ui: {
            tasks: {
              boardConventions: {
                'trello:board1': { doneListId: 'lDone' }
              }
            }
          }
        }
      }
    };

    const svc = new TaskTicketMoveService({ taskRecordService, taskTicketingService, userSettingsService });
    const result = await svc.moveTicketForTaskRecord('pr:acme/demo#1');

    expect(result.ok).toBe(true);
    expect(result.targetListId).toBe('lDone');
    expect(calls.some((c) => c.type === 'updateCard' && c.fields?.idList === 'lDone')).toBe(true);
    const rec = records.get('pr:acme/demo#1');
    expect(rec.ticketMovedAt).toBeTruthy();
    expect(rec.ticketMoveTargetListId).toBe('lDone');
    expect(rec.ticketBoardId).toBe('board1');
  });

  test('moves ticket to explicit listId when provided', async () => {
    const records = new Map();
    records.set('pr:acme/demo#2', {
      ticketProvider: 'trello',
      ticketCardId: 'Zzz999'
    });

    const taskRecordService = {
      get: (id) => records.get(id) || null,
      upsert: async (id, patch) => {
        const prev = records.get(id) || {};
        const next = { ...prev, ...(patch || {}) };
        records.set(id, next);
        return next;
      }
    };

    const calls = [];
    const provider = {
      getCard: async ({ cardId }) => ({ id: cardId, idBoard: 'board2', url: `https://trello.com/c/${cardId}` }),
      listLists: async () => ([{ id: 'lA', name: 'In Progress' }, { id: 'lB', name: 'QA' }]),
      updateCard: async ({ cardId, fields }) => {
        calls.push({ type: 'updateCard', cardId, fields });
        return { id: cardId };
      }
    };

    const taskTicketingService = { getProvider: () => provider };
    const userSettingsService = { settings: { global: { ui: { tasks: { boardConventions: {} } } } } };

    const svc = new TaskTicketMoveService({ taskRecordService, taskTicketingService, userSettingsService });
    const result = await svc.moveTicketForTaskRecord('pr:acme/demo#2', { listId: 'lB' });

    expect(result.ok).toBe(true);
    expect(result.targetListId).toBe('lB');
    expect(calls.some((c) => c.type === 'updateCard' && c.fields?.idList === 'lB')).toBe(true);
  });
});

