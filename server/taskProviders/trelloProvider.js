const { requestJson } = require('../utils/httpJson');
const { loadTrelloCredentials } = require('./trelloCredentials');

class TrelloTaskProvider {
  constructor({ cache, logger } = {}) {
    this.id = 'trello';
    this.label = 'Trello';
    this.cache = cache;
    this.logger = logger;
  }

  getCapabilities() {
    return {
      read: true,
      write: false
    };
  }

  getCredentials() {
    return loadTrelloCredentials();
  }

  isConfigured() {
    return !!this.getCredentials();
  }

  _buildUrl(pathname, params = {}) {
    const creds = this.getCredentials();
    if (!creds) {
      const err = new Error('Trello is not configured (missing credentials)');
      err.code = 'TRELLO_NOT_CONFIGURED';
      throw err;
    }

    const url = new URL(`https://api.trello.com/1${pathname}`);
    url.searchParams.set('key', creds.apiKey);
    url.searchParams.set('token', creds.token);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, String(v));
    }
    return url.toString();
  }

  async _getCached(cacheKey, url, { ttlMs = 60_000, force = false } = {}) {
    if (!this.cache) return requestJson(url);
    return this.cache.getOrCompute(cacheKey, () => requestJson(url), { ttlMs, force });
  }

  async listBoards({ refresh = false } = {}) {
    const url = this._buildUrl('/members/me/boards', {
      filter: 'open',
      fields: 'name,url,dateLastActivity,closed'
    });
    const cacheKey = `trello:boards:me:open`;
    return this._getCached(cacheKey, url, { ttlMs: 5 * 60_000, force: refresh });
  }

  async listLists({ boardId, refresh = false } = {}) {
    if (!boardId) throw new Error('boardId is required');
    const url = this._buildUrl(`/boards/${encodeURIComponent(boardId)}/lists`, {
      filter: 'open',
      fields: 'name,closed,pos,idBoard'
    });
    const cacheKey = `trello:lists:${boardId}:open`;
    return this._getCached(cacheKey, url, { ttlMs: 60_000, force: refresh });
  }

  async listCards({ listId, refresh = false, q = '', updatedSince = null } = {}) {
    if (!listId) throw new Error('listId is required');
    const url = this._buildUrl(`/lists/${encodeURIComponent(listId)}/cards`, {
      fields: 'name,url,dateLastActivity,closed,idList,idBoard,pos,labels',
      filter: 'open'
    });
    const cacheKey = `trello:cards:list:${listId}:open`;
    const cards = await this._getCached(cacheKey, url, { ttlMs: 20_000, force: refresh });

    let filtered = Array.isArray(cards) ? cards : [];
    if (q) {
      const needle = String(q).toLowerCase();
      filtered = filtered.filter(c => String(c?.name || '').toLowerCase().includes(needle));
    }
    if (updatedSince) {
      const sinceMs = Date.parse(updatedSince);
      if (!Number.isNaN(sinceMs)) {
        filtered = filtered.filter(c => {
          const t = Date.parse(c?.dateLastActivity || '');
          return !Number.isNaN(t) && t >= sinceMs;
        });
      }
    }

    return filtered;
  }

  async getCard({ cardId, refresh = false } = {}) {
    if (!cardId) throw new Error('cardId is required');
    const url = this._buildUrl(`/cards/${encodeURIComponent(cardId)}`, {
      fields: 'name,desc,url,dateLastActivity,closed,idList,idBoard,labels',
      members: 'true',
      member_fields: 'fullName,username',
      checklists: 'all'
    });
    const cacheKey = `trello:card:${cardId}`;
    return this._getCached(cacheKey, url, { ttlMs: 20_000, force: refresh });
  }
}

module.exports = { TrelloTaskProvider };

