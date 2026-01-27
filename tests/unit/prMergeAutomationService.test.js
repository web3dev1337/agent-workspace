const { PrMergeAutomationService, extractTrelloShortLinks, pickDoneListId } = require('../../server/prMergeAutomationService');

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

describe('PrMergeAutomationService webhook flow', () => {
  test('processMergedPullRequest moves + comments on linked Trello card', async () => {
    const records = new Map();
    const taskRecordService = {
      get: (id) => records.get(id) || null,
      upsert: async (id, patch) => {
        const prev = records.get(id) || { id };
        records.set(id, { ...prev, ...(patch || {}), id });
        return records.get(id);
      }
    };

    const calls = [];
    const provider = {
      getCard: async ({ cardId }) => ({
        id: cardId,
        idBoard: 'board1',
        url: `https://trello.com/c/${cardId}`,
        labels: [{ id: 'lbl0', name: 'Keep' }]
      }),
      listLists: async () => ([
        { id: 'l1', name: 'To Do' },
        { id: 'l2', name: 'Merged' }
      ]),
      listBoardLabels: async () => ([
        { id: 'lbl0', name: 'Keep', color: 'blue' },
        { id: 'lbl1', name: 'Merged', color: 'green' },
        { id: 'lbl2', name: 'Shipped', color: 'purple' }
      ]),
      updateCard: async ({ cardId, fields }) => {
        calls.push({ type: 'updateCard', cardId, fields });
        return { id: cardId };
      },
      addComment: async ({ cardId, text }) => {
        calls.push({ type: 'addComment', cardId, text });
        return { id: 'c1' };
      }
    };

    const taskTicketingService = {
      getProvider: () => provider
    };

    const userSettingsService = {
      settings: {
        global: {
          ui: {
            tasks: {
              boardConventions: {
                'trello:board1': {
                  doneListId: 'l1',
                  mergedLabelNames: 'Merged, Shipped'
                }
              },
              automations: {
                trello: {
                  onPrMerged: {
                    enabled: true,
                    webhookEnabled: true,
                    pollEnabled: false,
                    comment: true,
                    moveToDoneList: true,
                    closeIfNoDoneList: false,
                    pollMs: 60_000
                  }
                }
              }
            }
          }
        }
      }
    };

    const svc = new PrMergeAutomationService({ taskRecordService, taskTicketingService, userSettingsService });

    const result = await svc.processMergedPullRequest({
      owner: 'acme',
      repo: 'demo',
      number: 123,
      body: 'Implements thing. Trello: https://trello.com/c/AbC123/something',
      mergedAt: '2026-01-27T00:00:00.000Z',
      url: 'https://github.com/acme/demo/pull/123'
    });

    expect(result.skipped).toBeFalsy();
    expect(result.cardRef).toBe('AbC123');
    expect(calls.some((c) => c.type === 'updateCard' && c.fields?.idList === 'l1')).toBe(true);
    expect(calls.some((c) => c.type === 'addComment' && String(c.text || '').includes('Merged'))).toBe(true);
    expect(calls.some((c) => c.type === 'updateCard'
      && Array.isArray(c.fields?.idLabels)
      && c.fields.idLabels.includes('lbl0')
      && c.fields.idLabels.includes('lbl1')
      && c.fields.idLabels.includes('lbl2'))).toBe(true);

    const rec = records.get('pr:acme/demo#123');
    expect(rec).toBeTruthy();
    expect(rec.prMergedAt).toBe('2026-01-27T00:00:00.000Z');
  });

  test('processMergedPullRequest uses board comment template placeholders', async () => {
    const records = new Map();
    records.set('pr:acme/demo#123', {
      id: 'pr:acme/demo#123',
      ticketProvider: 'trello',
      ticketCardId: 'AbC123',
      ticketCardUrl: 'https://trello.com/c/AbC123',
      reviewOutcome: 'approved',
      verifyMinutes: 12,
      notes: 'Ran tests',
      promptRef: 'pr:acme/demo#123'
    });

    const taskRecordService = {
      get: (id) => records.get(id) || null,
      upsert: async (id, patch) => {
        const prev = records.get(id) || { id };
        records.set(id, { ...prev, ...(patch || {}), id });
        return records.get(id);
      }
    };

    const calls = [];
    const provider = {
      getCard: async ({ cardId }) => ({ id: cardId, idBoard: 'board1', url: `https://trello.com/c/${cardId}` }),
      listLists: async () => ([{ id: 'l1', name: 'Merged' }]),
      updateCard: async ({ cardId, fields }) => {
        calls.push({ type: 'updateCard', cardId, fields });
        return { id: cardId };
      },
      addComment: async ({ cardId, text }) => {
        calls.push({ type: 'addComment', cardId, text });
        return { id: 'c1' };
      }
    };

    const taskTicketingService = { getProvider: () => provider };
    const userSettingsService = {
      settings: {
        global: {
          ui: {
            tasks: {
              boardConventions: {
                'trello:board1': {
                  doneListId: 'l1',
                  mergedCommentTemplate: 'Merged ✅\nPR: {prUrl}\nOutcome: {reviewOutcome}\nVerify: {verifyMinutes}m\nNotes: {notes}\nPrompt: {promptRef}'
                }
              },
              automations: {
                trello: {
                  onPrMerged: {
                    enabled: true,
                    webhookEnabled: true,
                    pollEnabled: false,
                    comment: true,
                    moveToDoneList: true,
                    closeIfNoDoneList: false,
                    pollMs: 60_000
                  }
                }
              }
            }
          }
        }
      }
    };

    const svc = new PrMergeAutomationService({ taskRecordService, taskTicketingService, userSettingsService });
    await svc.processMergedPullRequest({
      owner: 'acme',
      repo: 'demo',
      number: 123,
      body: 'Implements thing. Trello: https://trello.com/c/AbC123/something',
      mergedAt: '2026-01-27T00:00:00.000Z',
      url: 'https://github.com/acme/demo/pull/123'
    });

    const comment = calls.find((c) => c.type === 'addComment');
    expect(comment).toBeTruthy();
    expect(String(comment.text || '')).toContain('Outcome: approved');
    expect(String(comment.text || '')).toContain('Verify: 12m');
    expect(String(comment.text || '')).toContain('Notes: Ran tests');
  });
});
