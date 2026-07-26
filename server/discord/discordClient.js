const API_BASE = 'https://discord.com/api/v10';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_PAGE = 100;

/**
 * Minimal Discord REST client.
 *
 * Deliberately not a gateway client. Reading with `?after=<cursor>` means a
 * missed message is not a thing that can happen — there is no connection state
 * to lose, and a restart after three days is just a longer page-through. That
 * trades a few seconds of latency for removing an entire class of bug.
 */
class DiscordClient {
  constructor({ token = '', fetchImpl = null, logger = console } = {}) {
    this.token = String(token || process.env.DISCORD_BOT_TOKEN || '').trim();
    this.fetch = fetchImpl || globalThis.fetch;
    this.logger = logger;
    this.rateLimitedUntil = 0;
  }

  isConfigured() {
    return Boolean(this.token) && typeof this.fetch === 'function';
  }

  async request(pathname, { method = 'GET', body = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (!this.isConfigured()) {
      return { ok: false, status: 0, error: 'Discord bot token is not configured (DISCORD_BOT_TOKEN)' };
    }
    if (Date.now() < this.rateLimitedUntil) {
      return { ok: false, status: 429, error: 'rate limited', retryAfterMs: this.rateLimitedUntil - Date.now() };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.fetch(`${API_BASE}${pathname}`, {
        method,
        headers: {
          Authorization: `Bot ${this.token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'AgentWorkspace (https://github.com/web3dev1337/agent-workspace, 1.0)'
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });

      if (response.status === 429) {
        const retryAfter = Number(response.headers?.get?.('retry-after') || 5);
        this.rateLimitedUntil = Date.now() + retryAfter * 1000;
        return { ok: false, status: 429, error: 'rate limited', retryAfterMs: retryAfter * 1000 };
      }

      const text = await response.text();
      const data = text ? JSON.parse(text) : null;
      if (!response.ok) {
        return { ok: false, status: response.status, error: data?.message || `HTTP ${response.status}` };
      }
      return { ok: true, status: response.status, data };
    } catch (error) {
      return { ok: false, status: 0, error: error.name === 'AbortError' ? 'timed out' : error.message };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Page forward from a cursor. Discord returns newest-first even with `after`,
   * so pages are reversed into chronological order — work items should be
   * created in the order the conversation actually happened.
   *
   * With no cursor (first-sight backfill) there is nothing to page forward from,
   * so a single newest-first page is taken and trimmed to the most recent N.
   * Trimming the oldest N instead would silently skip the newest messages —
   * exactly the ones a backfill is meant to catch.
   */
  async fetchMessagesAfter(channelId, afterId, { maxMessages = 400 } = {}) {
    const collected = [];
    let cursor = afterId;

    while (collected.length < maxMessages) {
      const query = new URLSearchParams({ limit: String(MAX_PAGE) });
      if (cursor) query.set('after', cursor);

      const result = await this.request(`/channels/${channelId}/messages?${query}`);
      if (!result.ok) return { ok: false, error: result.error, status: result.status, messages: collected };

      const page = Array.isArray(result.data) ? result.data.slice().reverse() : [];
      if (!page.length) break;

      collected.push(...page);
      cursor = page[page.length - 1].id;
      if (page.length < MAX_PAGE) break;
    }

    // Forward paging keeps the oldest N after the cursor; a backfill keeps the
    // most recent N (the tail of the chronological list).
    const messages = afterId ? collected.slice(0, maxMessages) : collected.slice(-maxMessages);
    return { ok: true, messages, cursor: messages.length ? messages[messages.length - 1].id : (cursor || afterId) };
  }

  async getLatestMessageId(channelId) {
    const result = await this.request(`/channels/${channelId}/messages?limit=1`);
    if (!result.ok) return { ok: false, error: result.error };
    const latest = Array.isArray(result.data) ? result.data[0] : null;
    return { ok: true, id: latest?.id || null };
  }

  async getChannel(channelId) {
    const result = await this.request(`/channels/${channelId}`);
    return result.ok ? { ok: true, channel: result.data } : { ok: false, error: result.error };
  }

  async postMessage(channelId, content, { replyToMessageId = null } = {}) {
    const body = { content: String(content || '').slice(0, 1900) };
    if (replyToMessageId) {
      body.message_reference = { message_id: replyToMessageId, fail_if_not_exists: false };
    }
    const result = await this.request(`/channels/${channelId}/messages`, { method: 'POST', body });
    return result.ok ? { ok: true, message: result.data } : { ok: false, error: result.error };
  }
}

function messagePermalink({ guildId, channelId, messageId }) {
  return `https://discord.com/channels/${guildId || '@me'}/${channelId}/${messageId}`;
}

module.exports = { DiscordClient, messagePermalink, API_BASE };
