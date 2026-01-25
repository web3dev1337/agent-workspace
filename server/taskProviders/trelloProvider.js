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

  _invalidateCacheKeys(keys) {
    if (!this.cache || !Array.isArray(keys)) return;
    for (const key of keys) {
      if (!key) continue;
      this.cache.delete(key);
    }
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

  async listBoardCards({ boardId, refresh = false, q = '', updatedSince = null } = {}) {
    if (!boardId) throw new Error('boardId is required');
    const url = this._buildUrl(`/boards/${encodeURIComponent(boardId)}/cards`, {
      fields: 'name,url,dateLastActivity,closed,idList,idBoard,pos,labels',
      filter: 'open'
    });

    try {
      const cacheKey = `trello:cards:board:${boardId}:open`;
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
    } catch (error) {
      // Some boards (or some Trello accounts) can fail on the board-wide cards endpoint
      // while list-level card reads still work. Fall back to aggregating per-list cards.
      this.logger?.warn?.('Trello board cards failed; falling back to per-list aggregation', {
        boardId,
        statusCode: error?.statusCode,
        message: error?.message
      });

      const lists = await this.listLists({ boardId, refresh });
      const listIds = (Array.isArray(lists) ? lists : [])
        .map(l => l?.id)
        .filter(Boolean);

      const concurrency = 4;
      const results = [];
      let idx = 0;

      const worker = async () => {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const current = idx;
          idx += 1;
          if (current >= listIds.length) return;

          const listId = listIds[current];
          try {
            // Reuse list-level caching and filters.
            // eslint-disable-next-line no-await-in-loop
            const cards = await this.listCards({ listId, refresh, q, updatedSince });
            if (Array.isArray(cards)) results.push(...cards);
          } catch (e) {
            this.logger?.warn?.('Trello list cards failed during board aggregation', {
              boardId,
              listId,
              message: e?.message
            });
          }
        }
      };

      const workers = Array.from({ length: Math.min(concurrency, listIds.length) }, () => worker());
      await Promise.all(workers);

      // Deduplicate by card id (defensive).
      const seen = new Set();
      const deduped = [];
      for (const c of results) {
        const id = c?.id;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        deduped.push(c);
      }

      deduped.sort((a, b) => {
        const at = a?.dateLastActivity ? Date.parse(a.dateLastActivity) : 0;
        const bt = b?.dateLastActivity ? Date.parse(b.dateLastActivity) : 0;
        return bt - at;
      });

      return deduped;
    }
  }

  async getCard({ cardId, refresh = false } = {}) {
    if (!cardId) throw new Error('cardId is required');
    const url = this._buildUrl(`/cards/${encodeURIComponent(cardId)}`, {
      fields: 'name,desc,url,dateLastActivity,closed,idList,idBoard,labels',
      members: 'true',
      member_fields: 'fullName,username',
      checklists: 'all',
      actions: 'commentCard',
      actions_limit: '100',
      actions_fields: 'data,date,idMemberCreator,type',
      action_memberCreator: 'true',
      action_memberCreator_fields: 'fullName,username'
    });
    const cacheKey = `trello:card:${cardId}`;
    return this._getCached(cacheKey, url, { ttlMs: 20_000, force: refresh });
  }

  async addComment({ cardId, text } = {}) {
    if (!cardId) throw new Error('cardId is required');
    if (!text || !String(text).trim()) throw new Error('text is required');

    // Trello allows passing `text` as a query param, but long text and special
    // chars can cause issues. Send text in the request body (form-encoded),
    // keeping auth (key/token) on the URL.
    const url = this._buildUrl(`/cards/${encodeURIComponent(cardId)}/actions/comments`);
    const body = new URLSearchParams({ text: String(text) }).toString();

    // POST returns the created action (JSON).
    const action = await requestJson(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    });
    this._invalidateCacheKeys([`trello:card:${cardId}`]);
    return action;
  }

  async updateCard({ cardId, fields = {} } = {}) {
    if (!cardId) throw new Error('cardId is required');
    if (!fields || typeof fields !== 'object') throw new Error('fields must be an object');

    const allowed = ['name', 'desc', 'due', 'idList', 'idMembers', 'closed'];
    const params = {};
    for (const key of allowed) {
      if (fields[key] === undefined) continue;
      params[key] = fields[key];
    }

    // Trello accepts updates via query params.
    const url = this._buildUrl(`/cards/${encodeURIComponent(cardId)}`, params);
    const card = await requestJson(url, { method: 'PUT' });

    // Invalidate common caches. (List/board caches are short TTL; client refreshes after writes anyway.)
    this._invalidateCacheKeys([`trello:card:${cardId}`]);
    return card;
  }

  async getBoardSnapshot({ boardId, refresh = false, q = '', updatedSince = null } = {}) {
    if (!boardId) throw new Error('boardId is required');

    const cacheKey = `trello:snapshot:${boardId}:${q || ''}:${updatedSince || ''}`;
    const ttlMs = 15_000;

    const compute = async () => {
      const [lists, cards] = await Promise.all([
        this.listLists({ boardId, refresh }),
        this.listBoardCards({ boardId, refresh, q, updatedSince })
      ]);

      const listArr = Array.isArray(lists) ? lists : [];
      const cardArr = Array.isArray(cards) ? cards : [];

      listArr.sort((a, b) => (a?.pos ?? 0) - (b?.pos ?? 0));

      const cardsByList = {};
      for (const c of cardArr) {
        const idList = c?.idList;
        if (!idList) continue;
        if (!cardsByList[idList]) cardsByList[idList] = [];
        cardsByList[idList].push(c);
      }

      for (const [idList, arr] of Object.entries(cardsByList)) {
        arr.sort((a, b) => (a?.pos ?? 0) - (b?.pos ?? 0));
        cardsByList[idList] = arr;
      }

      return { lists: listArr, cardsByList };
    };

    if (!this.cache) {
      return compute();
    }

    return this.cache.getOrCompute(cacheKey, compute, { ttlMs, force: refresh });
  }
}

module.exports = { TrelloTaskProvider };
