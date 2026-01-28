const winston = require('winston');
const { pickDoneListId } = require('./prMergeAutomationService');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/ticket-move.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

const normalizeProviderId = (value) => {
  const v = String(value || '').trim().toLowerCase();
  return v || 'trello';
};

const parseTrelloCardId = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('trello:')) return raw.slice('trello:'.length).trim();
  try {
    const u = new URL(raw);
    const m = u.pathname.match(/\/c\/([a-zA-Z0-9]+)(?:\/|$)/);
    if (m && m[1]) return String(m[1]).trim();
  } catch {
    // ignore
  }
  return '';
};

class TaskTicketMoveService {
  constructor({ taskRecordService, taskTicketingService, userSettingsService } = {}) {
    this.taskRecordService = taskRecordService;
    this.taskTicketingService = taskTicketingService;
    this.userSettingsService = userSettingsService;
  }

  static getInstance(deps) {
    if (!TaskTicketMoveService.instance) {
      TaskTicketMoveService.instance = new TaskTicketMoveService(deps);
    }
    return TaskTicketMoveService.instance;
  }

  getBoardConventions(providerId, boardId) {
    const pid = normalizeProviderId(providerId);
    const bid = String(boardId || '').trim();
    if (!bid) return {};
    const key = `${pid}:${bid}`;
    const current = this.userSettingsService?.settings?.global?.ui?.tasks?.boardConventions;
    const conv = current && typeof current === 'object' && !Array.isArray(current) ? current[key] : null;
    return conv && typeof conv === 'object' && !Array.isArray(conv) ? conv : {};
  }

  async moveTicketForTaskRecord(taskId, { listId = '' } = {}) {
    const id = String(taskId || '').trim();
    if (!id) throw new Error('taskId is required');

    const existing = this.taskRecordService?.get ? this.taskRecordService.get(id) : null;
    if (!existing) throw new Error('Task record not found');

    const providerId = normalizeProviderId(existing?.ticketProvider || 'trello');
    const cardId = String(existing?.ticketCardId || '').trim() || parseTrelloCardId(existing?.ticketCardUrl || '');
    if (!cardId) throw new Error('No ticketCardId set for this task');

    const provider = this.taskTicketingService.getProvider(providerId);

    let card;
    try {
      card = await provider.getCard({ cardId, refresh: true });
    } catch (e) {
      logger.warn('Failed to load card for move', { taskId: id, providerId, cardId, error: e?.message || String(e) });
      throw new Error('Failed to load ticket card');
    }

    const boardId = String(existing?.ticketBoardId || card?.idBoard || '').trim();
    if (!boardId) throw new Error('Ticket board id not available');

    let targetListId = String(listId || '').trim();
    let lists = [];
    try {
      lists = await provider.listLists({ boardId, refresh: true });
    } catch (e) {
      logger.debug('Failed to list board lists', { boardId, providerId, error: e?.message || String(e) });
      lists = [];
    }

    const listIds = new Set((Array.isArray(lists) ? lists : []).map(l => String(l?.id || '').trim()).filter(Boolean));
    if (targetListId && !listIds.has(targetListId)) {
      throw new Error('Invalid listId for this board');
    }

    if (!targetListId) {
      const conv = this.getBoardConventions(providerId, boardId);
      const configuredDoneListId = String(conv?.doneListId || '').trim();
      targetListId = (configuredDoneListId && listIds.has(configuredDoneListId))
        ? configuredDoneListId
        : pickDoneListId(lists);
    }

    if (!targetListId) throw new Error('No Done list found (configure board conventions or provide listId)');

    try {
      await provider.updateCard({ cardId, fields: { idList: targetListId, pos: 'top' } });
    } catch (e) {
      logger.warn('Failed to move card', { taskId: id, providerId, cardId, targetListId, error: e?.message || String(e) });
      throw new Error('Failed to move ticket card');
    }

    const nowIso = new Date().toISOString();
    const next = await this.taskRecordService.upsert(id, {
      ticketProvider: providerId,
      ticketCardId: cardId,
      ticketCardUrl: String(existing?.ticketCardUrl || card?.url || '').trim() || undefined,
      ticketBoardId: boardId,
      ticketMovedAt: nowIso,
      ticketMoveTargetListId: targetListId
    });

    return {
      ok: true,
      taskId: id,
      providerId,
      cardId,
      boardId,
      targetListId,
      record: next
    };
  }
}

module.exports = { TaskTicketMoveService };

