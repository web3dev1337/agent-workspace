const winston = require('winston');
const { parsePrTaskId } = require('./taskDependencyService');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/pr-merge-automation.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

const extractTrelloShortLinks = (text) => {
  const body = String(text || '');
  if (!body) return [];

  const results = new Set();

  const direct = body.matchAll(/https?:\/\/trello\.com\/c\/([a-zA-Z0-9]+)(?:\/|\b)/g);
  for (const m of direct) {
    if (m && m[1]) results.add(String(m[1]));
  }

  const tagged = body.matchAll(/\btrello:([a-zA-Z0-9]+)\b/g);
  for (const m of tagged) {
    if (m && m[1]) results.add(String(m[1]));
  }

  return Array.from(results);
};

const pickDoneListId = (lists) => {
  const arr = Array.isArray(lists) ? lists : [];
  const norm = (s) => String(s || '').trim().toLowerCase();

  const scored = arr
    .map((l) => ({ id: l?.id || '', name: norm(l?.name || '') }))
    .filter((l) => !!l.id && !!l.name);

  const firstMatch = (re) => scored.find((l) => re.test(l.name))?.id || null;

  // Prefer explicit "merged/shipped/released" lists, then generic done/complete.
  return (
    firstMatch(/\b(merged|shipped|released)\b/) ||
    firstMatch(/\b(done|complete|completed)\b/) ||
    null
  );
};

class PrMergeAutomationService {
  constructor({ taskRecordService, pullRequestService, taskTicketingService, userSettingsService } = {}) {
    this.taskRecordService = taskRecordService;
    this.pullRequestService = pullRequestService;
    this.taskTicketingService = taskTicketingService;
    this.userSettingsService = userSettingsService;
    this.intervalId = null;
    this.lastRunAt = null;
  }

  static getInstance(deps = {}) {
    if (!PrMergeAutomationService.instance) {
      PrMergeAutomationService.instance = new PrMergeAutomationService(deps);
    }
    return PrMergeAutomationService.instance;
  }

  getConfig() {
    const cfg = this.userSettingsService?.settings?.global?.ui?.tasks?.automations?.trello?.onPrMerged || {};
    return {
      enabled: !!cfg.enabled,
      pollEnabled: cfg.pollEnabled !== false,
      webhookEnabled: !!cfg.webhookEnabled,
      comment: cfg.comment !== false,
      moveToDoneList: cfg.moveToDoneList !== false,
      closeIfNoDoneList: !!cfg.closeIfNoDoneList,
      pollMs: Math.max(10_000, Math.min(10 * 60_000, Number(cfg.pollMs) || 60_000))
    };
  }

  listCandidatePrRecords({ limit = 60 } = {}) {
    const list = typeof this.taskRecordService?.list === 'function' ? this.taskRecordService.list() : [];
    const items = (Array.isArray(list) ? list : [])
      .filter((r) => r && typeof r.id === 'string' && r.id.startsWith('pr:'))
      .filter((r) => !r.ticketMovedAt && !r.ticketClosedAt) // not yet processed
      .sort((a, b) => (Date.parse(b.updatedAt || '') || 0) - (Date.parse(a.updatedAt || '') || 0))
      .slice(0, Math.max(1, Math.min(400, Number(limit) || 60)));
    return items;
  }

  async ensureProviderConfigured(providerId) {
    try {
      const provider = this.taskTicketingService.getProvider(providerId);
      return provider;
    } catch (e) {
      logger.debug('Ticket provider not configured; skipping automations', { providerId, error: e?.message || String(e) });
      return null;
    }
  }

  async processMergedPullRequest({ owner, repo, number, body, mergedAt, url } = {}) {
    const prOwner = String(owner || '').trim();
    const prRepo = String(repo || '').trim();
    const prNumber = Number(number);
    if (!prOwner || !prRepo || !Number.isFinite(prNumber) || prNumber <= 0) {
      return { skipped: true, reason: 'invalid_pr' };
    }

    const mergedIso = mergedAt ? new Date(mergedAt).toISOString() : new Date().toISOString();
    const id = `pr:${prOwner}/${prRepo}#${prNumber}`;

    const cfg = this.getConfig();
    if (!cfg.enabled || !cfg.webhookEnabled) {
      await this.taskRecordService.upsert(id, { prMergedAt: mergedIso });
      return { id, skipped: true, reason: cfg.enabled ? 'webhook_disabled' : 'automation_disabled' };
    }

    const prUrl = String(url || '').trim() || `${prOwner}/${prRepo}#${prNumber}`;

    // Try existing record ticket link; fallback to PR body parsing.
    const existing = typeof this.taskRecordService?.get === 'function' ? this.taskRecordService.get(id) : null;
    const providerId = String(existing?.ticketProvider || 'trello').trim().toLowerCase() || 'trello';
    let cardRef = String(existing?.ticketCardId || '').trim();
    let cardUrl = String(existing?.ticketCardUrl || '').trim();

    if (!cardRef) {
      const refs = extractTrelloShortLinks(String(body || ''));
      cardRef = refs[0] || '';
      if (cardRef) {
        cardUrl = cardUrl || `https://trello.com/c/${cardRef}`;
      }
    }

    await this.taskRecordService.upsert(id, {
      ticketProvider: providerId,
      ticketCardId: cardRef || undefined,
      ticketCardUrl: cardUrl || undefined,
      prMergedAt: mergedIso,
      prUrl
    });

    if (!cardRef) {
      return { id, skipped: true, reason: 'no_ticket_link' };
    }

    const provider = await this.ensureProviderConfigured(providerId);
    if (!provider) {
      return { id, skipped: true, reason: 'provider_not_configured' };
    }

    // Load card + lists (to find a "Done/Merged" list).
    let card;
    try {
      card = await provider.getCard({ cardId: cardRef, refresh: true });
    } catch (e) {
      logger.warn('Failed to load card', { id, providerId, cardRef, error: e?.message || String(e) });
      return { id, skipped: true, reason: 'card_lookup_failed' };
    }

    const boardId = String(card?.idBoard || '').trim();
    let targetListId = null;
    if (cfg.moveToDoneList && boardId) {
      try {
        const lists = await provider.listLists({ boardId, refresh: true });
        const key = `${providerId}:${boardId}`;
        const configured = this.userSettingsService?.settings?.global?.ui?.tasks?.boardConventions?.[key] || null;
        const configuredDoneListId = String(configured?.doneListId || '').trim();
        const listIds = new Set((Array.isArray(lists) ? lists : []).map(l => l?.id).filter(Boolean));
        targetListId = (configuredDoneListId && listIds.has(configuredDoneListId))
          ? configuredDoneListId
          : pickDoneListId(lists);
      } catch (e) {
        logger.debug('Failed to list board lists', { boardId, error: e?.message || String(e) });
      }
    }

    let moved = false;
    let closed = false;
    if (targetListId) {
      try {
        await provider.updateCard({ cardId: cardRef, fields: { idList: targetListId, pos: 'top' } });
        moved = true;
      } catch (e) {
        logger.warn('Failed to move card', { id, cardRef, targetListId, error: e?.message || String(e) });
      }
    } else if (cfg.closeIfNoDoneList) {
      try {
        await provider.updateCard({ cardId: cardRef, fields: { closed: true } });
        closed = true;
      } catch (e) {
        logger.warn('Failed to close card', { id, cardRef, error: e?.message || String(e) });
      }
    }

    if (cfg.comment) {
      try {
        const text = `Merged ✅\nPR: ${prUrl}`;
        await provider.addComment({ cardId: cardRef, text });
      } catch (e) {
        logger.debug('Failed to comment on card', { id, cardRef, error: e?.message || String(e) });
      }
    }

    await this.taskRecordService.upsert(id, {
      ticketProvider: providerId,
      ticketCardId: cardRef,
      ticketCardUrl: cardUrl || (card?.url ? String(card.url) : undefined),
      ticketBoardId: boardId || undefined,
      prMergedAt: mergedIso,
      ticketMovedAt: moved ? new Date().toISOString() : undefined,
      ticketMoveTargetListId: moved ? targetListId : undefined,
      ticketClosedAt: closed ? new Date().toISOString() : undefined
    });

    return { id, moved, closed, targetListId, cardRef, providerId };
  }

  async processOnePrRecord(record) {
    const id = String(record?.id || '').trim();
    const pr = parsePrTaskId(id);
    if (!pr) return { id, skipped: true, reason: 'invalid_pr_id' };

    let prInfo;
    try {
      prInfo = await this.pullRequestService.getPullRequest(pr);
    } catch (e) {
      logger.warn('PR lookup failed', { id, error: e?.message || String(e) });
      return { id, skipped: true, reason: 'pr_lookup_failed' };
    }

    const state = String(prInfo?.state || '').trim().toLowerCase();
    const mergedAt = prInfo?.mergedAt || null;
    if (state !== 'merged') {
      return { id, skipped: true, reason: state ? `pr_${state}` : 'pr_unknown' };
    }

    const mergedIso = mergedAt ? new Date(mergedAt).toISOString() : new Date().toISOString();

    // Try existing record ticket link; fallback to PR body parsing.
    const providerId = String(record?.ticketProvider || 'trello').trim().toLowerCase() || 'trello';
    let cardRef = String(record?.ticketCardId || '').trim();
    let cardUrl = String(record?.ticketCardUrl || '').trim();

    if (!cardRef) {
      const body = String(prInfo?.body || '');
      const refs = extractTrelloShortLinks(body);
      cardRef = refs[0] || '';
      if (cardRef) {
        cardUrl = cardUrl || `https://trello.com/c/${cardRef}`;
        await this.taskRecordService.upsert(id, {
          ticketProvider: providerId,
          ticketCardId: cardRef,
          ticketCardUrl: cardUrl,
          prMergedAt: mergedIso
        });
      } else {
        await this.taskRecordService.upsert(id, { prMergedAt: mergedIso });
        return { id, skipped: true, reason: 'no_ticket_link' };
      }
    }

    const provider = await this.ensureProviderConfigured(providerId);
    if (!provider) {
      // Persist merge timestamp so we don't constantly re-check.
      await this.taskRecordService.upsert(id, { prMergedAt: mergedIso });
      return { id, skipped: true, reason: 'provider_not_configured' };
    }

    // Load card + lists (to find a "Done/Merged" list).
    let card;
    try {
      card = await provider.getCard({ cardId: cardRef, refresh: true });
    } catch (e) {
      logger.warn('Failed to load card', { id, providerId, cardRef, error: e?.message || String(e) });
      await this.taskRecordService.upsert(id, { prMergedAt: mergedIso });
      return { id, skipped: true, reason: 'card_lookup_failed' };
    }

    const boardId = String(card?.idBoard || '').trim();
    let targetListId = null;
    if (this.getConfig().moveToDoneList && boardId) {
      try {
        const lists = await provider.listLists({ boardId, refresh: true });
        const key = `${providerId}:${boardId}`;
        const configured = this.userSettingsService?.settings?.global?.ui?.tasks?.boardConventions?.[key] || null;
        const configuredDoneListId = String(configured?.doneListId || '').trim();
        const listIds = new Set((Array.isArray(lists) ? lists : []).map(l => l?.id).filter(Boolean));
        targetListId = (configuredDoneListId && listIds.has(configuredDoneListId))
          ? configuredDoneListId
          : pickDoneListId(lists);
      } catch (e) {
        logger.debug('Failed to list board lists', { boardId, error: e?.message || String(e) });
      }
    }

    let moved = false;
    let closed = false;
    if (targetListId) {
      try {
        await provider.updateCard({ cardId: cardRef, fields: { idList: targetListId, pos: 'top' } });
        moved = true;
      } catch (e) {
        logger.warn('Failed to move card', { id, cardRef, targetListId, error: e?.message || String(e) });
      }
    } else if (this.getConfig().closeIfNoDoneList) {
      try {
        await provider.updateCard({ cardId: cardRef, fields: { closed: true } });
        closed = true;
      } catch (e) {
        logger.warn('Failed to close card', { id, cardRef, error: e?.message || String(e) });
      }
    }

    if (this.getConfig().comment) {
      try {
        const prUrl = String(prInfo?.url || '').trim() || `${pr.owner}/${pr.repo}#${pr.number}`;
        const text = `Merged ✅\nPR: ${prUrl}`;
        await provider.addComment({ cardId: cardRef, text });
      } catch (e) {
        logger.debug('Failed to comment on card', { id, cardRef, error: e?.message || String(e) });
      }
    }

    await this.taskRecordService.upsert(id, {
      ticketProvider: providerId,
      ticketCardId: cardRef,
      ticketCardUrl: cardUrl || (card?.url ? String(card.url) : null),
      ticketBoardId: boardId || null,
      prMergedAt: mergedIso,
      ticketMovedAt: moved ? new Date().toISOString() : null,
      ticketMoveTargetListId: moved ? targetListId : null,
      ticketClosedAt: closed ? new Date().toISOString() : null
    });

    return { id, moved, closed, targetListId, cardRef, providerId };
  }

  async runOnce({ limit = 60 } = {}) {
    const cfg = this.getConfig();
    if (!cfg.enabled) {
      return { enabled: false, ran: false, processed: 0, moved: 0, closed: 0, skipped: 0 };
    }

    const candidates = this.listCandidatePrRecords({ limit });
    let moved = 0;
    let closed = 0;
    let skipped = 0;

    for (const rec of candidates) {
      // eslint-disable-next-line no-await-in-loop
      const res = await this.processOnePrRecord(rec);
      if (res?.moved) moved += 1;
      else if (res?.closed) closed += 1;
      else if (res?.skipped) skipped += 1;
    }

    this.lastRunAt = new Date().toISOString();
    return { enabled: true, ran: true, processed: candidates.length, moved, closed, skipped, lastRunAt: this.lastRunAt };
  }

  start() {
    const cfg = this.getConfig();
    if (!cfg.enabled || !cfg.pollEnabled) return false;
    if (this.intervalId) return true;
    const pollMs = cfg.pollMs;
    this.intervalId = setInterval(() => {
      this.runOnce({ limit: 60 }).catch((e) => {
        logger.debug('Automation run failed', { error: e?.message || String(e) });
      });
    }, pollMs);
    logger.info('PR merge automation started', { pollMs });
    return true;
  }

  stop() {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = null;
    return true;
  }
}

module.exports = { PrMergeAutomationService, extractTrelloShortLinks, pickDoneListId };
