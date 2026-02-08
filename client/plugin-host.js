class OrchestratorPluginHost {
  constructor({ endpoint = '/api/plugins/client-surface' } = {}) {
    this.endpoint = endpoint;
    this.lastLoadedAt = null;
    this.slots = new Map();
    this.listeners = new Map();
  }

  static getInstance(options = {}) {
    if (!OrchestratorPluginHost.instance) {
      OrchestratorPluginHost.instance = new OrchestratorPluginHost(options);
    }
    return OrchestratorPluginHost.instance;
  }

  on(eventName, handler) {
    const event = String(eventName || '').trim();
    if (!event || typeof handler !== 'function') return () => {};
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    const set = this.listeners.get(event);
    set.add(handler);
    return () => {
      set.delete(handler);
      if (set.size === 0) this.listeners.delete(event);
    };
  }

  emit(eventName, payload) {
    const event = String(eventName || '').trim();
    if (!event) return;
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;
    for (const fn of set) {
      try { fn(payload); } catch {}
    }
  }

  async refresh({ slot = '', force = false } = {}) {
    if (!force && this.lastLoadedAt && this.slots.size > 0 && !slot) {
      return this.snapshot();
    }
    const slotFilter = String(slot || '').trim().toLowerCase();
    const url = slotFilter
      ? `${this.endpoint}?slot=${encodeURIComponent(slotFilter)}`
      : this.endpoint;
    const res = await fetch(url).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) throw new Error(data?.error || 'Failed to load plugin client surface');

    if (!slotFilter) {
      this.slots.clear();
    } else {
      this.slots.set(slotFilter, []);
    }
    const incoming = Array.isArray(data?.slots) ? data.slots : [];
    for (const item of incoming) {
      const slotName = String(item?.slot || '').trim().toLowerCase();
      if (!slotName) continue;
      if (!this.slots.has(slotName)) this.slots.set(slotName, []);
      this.slots.get(slotName).push(item);
    }
    const slotsToSort = slotFilter ? [slotFilter] : [...this.slots.keys()];
    for (const key of slotsToSort) {
      const value = [...(this.slots.get(key) || [])];
      value.sort((a, b) => {
        const ao = Number.isFinite(Number(a?.order)) ? Number(a.order) : 0;
        const bo = Number.isFinite(Number(b?.order)) ? Number(b.order) : 0;
        if (ao !== bo) return ao - bo;
        return String(a?.id || '').localeCompare(String(b?.id || ''));
      });
      this.slots.set(key, value);
    }
    this.lastLoadedAt = new Date().toISOString();
    this.emit('surface-updated', { slot: slotFilter || null, count: incoming.length });
    return this.snapshot();
  }

  snapshot() {
    const out = {};
    for (const [key, list] of this.slots.entries()) out[key] = [...list];
    return {
      loadedAt: this.lastLoadedAt,
      slots: out
    };
  }

  getSlotItems(slotName) {
    const key = String(slotName || '').trim().toLowerCase();
    if (!key) return [];
    return [...(this.slots.get(key) || [])];
  }

  async runAction(item, { orchestrator = null } = {}) {
    const action = item?.action && typeof item.action === 'object' ? item.action : null;
    if (!action) return { ok: false, error: 'Missing plugin action' };
    const type = String(action.type || '').trim().toLowerCase();

    if (type === 'open_url') {
      const url = String(action.url || '').trim();
      if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'Invalid URL' };
      window.open(url, '_blank', 'noopener');
      return { ok: true };
    }

    if (type === 'open_route') {
      const route = String(action.route || '').trim();
      if (!route || !route.startsWith('/')) return { ok: false, error: 'Invalid route' };
      window.open(route, '_blank', 'noopener');
      return { ok: true };
    }

    if (type === 'copy_text') {
      const text = String(action.text || '');
      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          return { ok: true };
        }
      } catch {}
      try { window.prompt('Copy text:', text); } catch {}
      return { ok: true };
    }

    if (type === 'commander_action') {
      const actionName = String(action.commanderAction || '').trim();
      if (!actionName) return { ok: false, error: 'Missing commanderAction' };
      const payload = action.payload && typeof action.payload === 'object' ? action.payload : {};
      if (orchestrator && typeof orchestrator.handleCommanderAction === 'function') {
        orchestrator.handleCommanderAction(actionName, payload);
      } else {
        this.emit('commander-action', { action: actionName, payload });
      }
      return { ok: true };
    }

    return { ok: false, error: `Unsupported action type: ${type}` };
  }
}

window.OrchestratorPluginHost = OrchestratorPluginHost;
window.orchestratorPluginHost = OrchestratorPluginHost.getInstance();
