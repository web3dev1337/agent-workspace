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
      write: true,
      operations: {
        createCard: true,
        updateCard: true,
        addComment: true,
        moveCard: true,
        listBoardMembers: true,
        dependencies: true,
        addChecklistItem: true
      }
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
      fields: 'name,url,dateLastActivity,closed,prefs'
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

  async listBoardMembers({ boardId, refresh = false } = {}) {
    if (!boardId) throw new Error('boardId is required');
    const url = this._buildUrl(`/boards/${encodeURIComponent(boardId)}/members`, {
      fields: 'fullName,username,avatarUrl'
    });
    const cacheKey = `trello:members:${boardId}:all`;
    return this._getCached(cacheKey, url, { ttlMs: 60_000, force: refresh });
  }

  async getMe({ refresh = false } = {}) {
    const url = this._buildUrl('/members/me', {
      fields: 'fullName,username,avatarUrl'
    });
    const cacheKey = 'trello:me';
    return this._getCached(cacheKey, url, { ttlMs: 5 * 60_000, force: refresh });
  }

  async listBoardCustomFields({ boardId, refresh = false } = {}) {
    if (!boardId) throw new Error('boardId is required');
    const url = this._buildUrl(`/boards/${encodeURIComponent(boardId)}/customFields`, {
      fields: 'name,type,pos,options',
      filter: 'all'
    });
    const cacheKey = `trello:customFields:${boardId}:all`;
    return this._getCached(cacheKey, url, { ttlMs: 5 * 60_000, force: refresh });
  }

  async listBoardLabels({ boardId, refresh = false } = {}) {
    if (!boardId) throw new Error('boardId is required');
    const url = this._buildUrl(`/boards/${encodeURIComponent(boardId)}/labels`, {
      fields: 'name,color',
      limit: '1000'
    });
    const cacheKey = `trello:labels:${boardId}:all`;
    return this._getCached(cacheKey, url, { ttlMs: 5 * 60_000, force: refresh });
  }

  async listCards({ listId, refresh = false, q = '', updatedSince = null } = {}) {
    if (!listId) throw new Error('listId is required');
    const url = this._buildUrl(`/lists/${encodeURIComponent(listId)}/cards`, {
      fields: 'name,url,dateLastActivity,closed,idList,idBoard,pos,labels,idMembers,due',
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
      fields: 'name,url,dateLastActivity,closed,idList,idBoard,pos,labels,idMembers,due',
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
      fields: 'name,desc,url,dateLastActivity,closed,idList,idBoard,labels,due,dueComplete,cover,idAttachmentCover',
      members: 'true',
      member_fields: 'fullName,username,avatarUrl',
      attachments: 'true',
      attachment_fields: 'name,url,previews,bytes,date,mimeType,isUpload',
      checklists: 'all',
      customFieldItems: 'true',
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

    const allowed = ['name', 'desc', 'due', 'idList', 'idMembers', 'idLabels', 'closed', 'pos'];
    const params = {};
    for (const key of allowed) {
      if (fields[key] === undefined) continue;
      const val = fields[key];
      if (key === 'idMembers') {
        if (Array.isArray(val)) {
          params[key] = val.filter(Boolean).join(',');
        } else if (val === null) {
          params[key] = '';
        } else {
          params[key] = val;
        }
        continue;
      }

      if (key === 'idLabels') {
        if (Array.isArray(val)) {
          params[key] = val.filter(Boolean).join(',');
        } else if (val === null) {
          params[key] = '';
        } else {
          params[key] = val;
        }
        continue;
      }

      if (key === 'due') {
        // Trello clears due when it receives an empty value.
        // Prefer explicit empty body field over omitting query params.
        params[key] = val === null ? '' : val;
        continue;
      }

      params[key] = val === null ? '' : val;
    }

    // Trello accepts updates via query params, but empty fields (clears) are
    // easier/reliable via form body. Keep auth in URL; send fields in body.
    const url = this._buildUrl(`/cards/${encodeURIComponent(cardId)}`);
    const body = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
    const card = await requestJson(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    });

    // Invalidate common caches. (List/board caches are short TTL; client refreshes after writes anyway.)
    this._invalidateCacheKeys([
      `trello:card:${cardId}`,
      card?.idList ? `trello:cards:list:${card.idList}:open` : null,
      card?.idBoard ? `trello:cards:board:${card.idBoard}:open` : null,
      card?.idBoard ? `trello:lists:${card.idBoard}:open` : null
    ]);
    return card;
  }

  async createCard({ listId, name, desc = '', idMembers = null, idLabels = null, pos = null, due = null } = {}) {
    const list = String(listId || '').trim();
    const title = String(name || '').trim();
    if (!list) throw new Error('listId is required');
    if (!title) throw new Error('name is required');

    const params = { idList: list, name: title };

    const d = String(desc || '');
    if (d.trim()) params.desc = d;

    if (Array.isArray(idMembers)) params.idMembers = idMembers.filter(Boolean).join(',');
    if (Array.isArray(idLabels)) params.idLabels = idLabels.filter(Boolean).join(',');
    if (pos !== null && pos !== undefined && pos !== '') params.pos = pos;
    if (due !== null && due !== undefined && due !== '') params.due = due;
    if (due === null) params.due = ''; // Trello clears on empty string

    // Trello accepts create via query params, but sending as form body is more reliable for clears/encoding.
    const url = this._buildUrl('/cards');
    const body = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
    const card = await requestJson(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    });

    this._invalidateCacheKeys([
      `trello:cards:list:${list}:open`,
      card?.idBoard ? `trello:cards:board:${card.idBoard}:open` : null,
      card?.idBoard ? `trello:lists:${card.idBoard}:open` : null
    ]);

    return card;
  }

  async setCustomFieldItem({ cardId, customFieldId, payload } = {}) {
    if (!cardId) throw new Error('cardId is required');
    if (!customFieldId) throw new Error('customFieldId is required');
    if (!payload || typeof payload !== 'object') throw new Error('payload must be an object');

    const url = this._buildUrl(`/card/${encodeURIComponent(cardId)}/customField/${encodeURIComponent(customFieldId)}/item`);
    await requestJson(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: payload
    });

    this._invalidateCacheKeys([`trello:card:${cardId}`]);
    return true;
  }

  async getDependencies({ cardId, refresh = false, checklistName = null } = {}) {
    const card = await this.getCard({ cardId, refresh });
    return parseTrelloDependenciesFromCard(card, { checklistName });
  }

  async addDependency({ cardId, name, url, shortLink, checklistName = null } = {}) {
    if (!cardId) throw new Error('cardId is required');

    const normalized = normalizeDependencyInput({ name, url, shortLink });
    if (!normalized) throw new Error('Dependency url/shortLink is required');

    const card = await this.getCard({ cardId, refresh: true });
    const existing = parseTrelloDependenciesFromCard(card, { checklistName });

    let checklistId = existing.checklistId;
    if (!checklistId) {
      const resolvedChecklistName = String(checklistName || '').trim() || 'Dependencies';
      // Create the checklist on the card.
      const createUrl = this._buildUrl(`/cards/${encodeURIComponent(cardId)}/checklists`, { name: resolvedChecklistName });
      const created = await requestJson(createUrl, { method: 'POST' });
      checklistId = created?.id;
    }
    if (!checklistId) throw new Error('Failed to create/find dependency checklist');

    // Add a new check item to the checklist.
    const itemName = normalized.url || normalized.name;
    const addUrl = this._buildUrl(`/checklists/${encodeURIComponent(checklistId)}/checkItems`);
    const body = new URLSearchParams({ name: itemName }).toString();
    await requestJson(addUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    });

    this._invalidateCacheKeys([`trello:card:${cardId}`]);
    return true;
  }

  async removeDependency({ cardId, itemId, checklistName = null } = {}) {
    if (!cardId) throw new Error('cardId is required');
    if (!itemId) throw new Error('itemId is required');

    const card = await this.getCard({ cardId, refresh: true });
    const deps = parseTrelloDependenciesFromCard(card, { checklistName });
    const checklistId = deps.checklistId;
    const item = deps.items.find(i => i.id === itemId);
    if (!checklistId || !item) throw new Error('Dependency item not found');

    const delUrl = this._buildUrl(`/checklists/${encodeURIComponent(checklistId)}/checkItems/${encodeURIComponent(itemId)}`);
    await requestJson(delUrl, { method: 'DELETE' });
    this._invalidateCacheKeys([`trello:card:${cardId}`]);
    return true;
  }

  async setDependencyState({ cardId, itemId, state } = {}) {
    if (!cardId) throw new Error('cardId is required');
    if (!itemId) throw new Error('itemId is required');
    const next = state === 'complete' ? 'complete' : 'incomplete';

    const url = this._buildUrl(`/cards/${encodeURIComponent(cardId)}/checkItem/${encodeURIComponent(itemId)}`, {
      state: next
    });
    await requestJson(url, { method: 'PUT' });
    this._invalidateCacheKeys([`trello:card:${cardId}`]);
    return true;
  }

  async addChecklistItem({ cardId, checklistName, name } = {}) {
    if (!cardId) throw new Error('cardId is required');
    const itemName = String(name || '').trim();
    if (!itemName) throw new Error('name is required');
    const desired = String(checklistName || '').trim() || 'Checklist';

    const card = await this.getCard({ cardId, refresh: true });
    const checklists = Array.isArray(card?.checklists) ? card.checklists : [];
    const desiredNorm = desired.toLowerCase();
    const existing = checklists.find((c) => String(c?.name || '').trim().toLowerCase() === desiredNorm);

    let checklistId = existing?.id || null;
    if (!checklistId) {
      const createUrl = this._buildUrl(`/cards/${encodeURIComponent(cardId)}/checklists`, { name: desired });
      const created = await requestJson(createUrl, { method: 'POST' });
      checklistId = created?.id || null;
    }
    if (!checklistId) throw new Error('Failed to create/find checklist');

    const addUrl = this._buildUrl(`/checklists/${encodeURIComponent(checklistId)}/checkItems`);
    const body = new URLSearchParams({ name: itemName }).toString();
    await requestJson(addUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    });

    this._invalidateCacheKeys([`trello:card:${cardId}`]);
    return true;
  }

  // ==========================
  // Generic checklist CRUD (v1)
  // ==========================

  async createChecklist({ cardId, name } = {}) {
    if (!cardId) throw new Error('cardId is required');
    const title = String(name || '').trim();
    if (!title) throw new Error('name is required');
    const url = this._buildUrl(`/cards/${encodeURIComponent(cardId)}/checklists`, { name: title });
    return requestJson(url, { method: 'POST' });
  }

  async updateChecklist({ checklistId, name } = {}) {
    if (!checklistId) throw new Error('checklistId is required');
    const title = String(name || '').trim();
    if (!title) throw new Error('name is required');
    const url = this._buildUrl(`/checklists/${encodeURIComponent(checklistId)}`, { name: title });
    return requestJson(url, { method: 'PUT' });
  }

  async removeChecklist({ checklistId } = {}) {
    if (!checklistId) throw new Error('checklistId is required');
    const url = this._buildUrl(`/checklists/${encodeURIComponent(checklistId)}`);
    await requestJson(url, { method: 'DELETE' });
    return true;
  }

  async addCheckItem({ checklistId, name } = {}) {
    if (!checklistId) throw new Error('checklistId is required');
    const itemName = String(name || '').trim();
    if (!itemName) throw new Error('name is required');
    const url = this._buildUrl(`/checklists/${encodeURIComponent(checklistId)}/checkItems`);
    const body = new URLSearchParams({ name: itemName }).toString();
    await requestJson(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    });
    return true;
  }

  async updateCheckItem({ checklistId, itemId, name } = {}) {
    if (!checklistId) throw new Error('checklistId is required');
    if (!itemId) throw new Error('itemId is required');
    const itemName = String(name || '').trim();
    if (!itemName) throw new Error('name is required');
    const url = this._buildUrl(`/checklists/${encodeURIComponent(checklistId)}/checkItems/${encodeURIComponent(itemId)}`, { name: itemName });
    await requestJson(url, { method: 'PUT' });
    return true;
  }

  async removeCheckItem({ checklistId, itemId } = {}) {
    if (!checklistId) throw new Error('checklistId is required');
    if (!itemId) throw new Error('itemId is required');
    const url = this._buildUrl(`/checklists/${encodeURIComponent(checklistId)}/checkItems/${encodeURIComponent(itemId)}`);
    await requestJson(url, { method: 'DELETE' });
    return true;
  }

  async setCheckItemState({ cardId, itemId, state } = {}) {
    // Reuse Trello's card-scoped state toggle endpoint (works for any checklist item).
    return this.setDependencyState({ cardId, itemId, state });
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

function normalizeDependencyInput({ name, url, shortLink } = {}) {
  const rawUrl = String(url || '').trim();
  const rawShort = String(shortLink || '').trim();
  const rawName = String(name || '').trim();

  if (rawUrl) {
    const m = rawUrl.match(/trello\.com\/c\/([a-zA-Z0-9]+)/);
    if (m?.[1]) return { name: rawName || rawUrl, url: rawUrl, shortLink: m[1] };
    return { name: rawName || rawUrl, url: rawUrl, shortLink: null };
  }

  if (rawShort) {
    const u = `https://trello.com/c/${rawShort}`;
    return { name: rawName || u, url: u, shortLink: rawShort };
  }

  if (rawName) {
    const m = rawName.match(/trello\.com\/c\/([a-zA-Z0-9]+)/);
    if (m?.[1]) return { name: rawName, url: m[0], shortLink: m[1] };
  }

  return null;
}

function parseTrelloDependenciesFromCard(card, { checklistName = null } = {}) {
  const checklists = Array.isArray(card?.checklists) ? card.checklists : [];
  const desired = String(checklistName || '').trim().toLowerCase() || 'dependencies';
  const deps = checklists.find(c => String(c?.name || '').trim().toLowerCase() === desired);
  const checklistId = deps?.id || null;

  const items = Array.isArray(deps?.checkItems) ? deps.checkItems : [];
  const parsed = items.map(i => {
    const name = String(i?.name || '').trim();
    const id = i?.id || null;
    const state = i?.state || 'incomplete';
    const match = name.match(/https?:\/\/\S+/);
    const url = match ? match[0] : null;
    const shortMatch = name.match(/trello\.com\/c\/([a-zA-Z0-9]+)/);
    const shortLink = shortMatch?.[1] || null;
    return { id, name, url, shortLink, state };
  }).filter(i => !!i.id);

  return { checklistId, items: parsed };
}

module.exports = { TrelloTaskProvider, parseTrelloDependenciesFromCard };
