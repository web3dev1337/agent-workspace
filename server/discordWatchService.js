const fs = require('fs');
const path = require('path');

const { getAgentWorkspaceDir } = require('./utils/pathUtils');
const { DiscordClient } = require('./discord/discordClient');
const extractor = require('./discord/workExtractor');

const STATE_FILENAME = 'discord-watch.json';
const MAX_ITEMS = 500;

/**
 * Ambient Discord watching.
 *
 * Reads the whole conversation rather than waiting to be addressed, turns
 * assignments into tracked work with a priority, and publishes back what the
 * orchestrator already knows — so "did that get picked up?" and "is anyone's
 * agent actually on it?" stop being questions someone has to ask.
 *
 * Reading is cursor-based rather than gateway-based on purpose: with a persisted
 * `after` position there is no such thing as a message missed while the process
 * was down, which was the previous integration's worst failure mode.
 */
class DiscordWatchService {
  constructor({ logger = console, client = null } = {}) {
    this.logger = logger;
    this.config = extractor.loadConfig();
    this.client = client || new DiscordClient({ logger });
    this.taskRecordService = null;
    this.activityFeed = null;

    this.timer = null;
    this.running = false;
    this.polling = false;
    this.lastPollAt = null;
    this.lastError = null;
    this.stats = { messagesRead: 0, itemsCreated: 0, itemsUpdated: 0, statusesPublished: 0 };

    this.state = this.loadState();
  }

  static getInstance(options = {}) {
    if (!DiscordWatchService.instance) {
      DiscordWatchService.instance = new DiscordWatchService(options);
    }
    return DiscordWatchService.instance;
  }

  init({ taskRecordService, activityFeed } = {}) {
    this.taskRecordService = taskRecordService || this.taskRecordService;
    this.activityFeed = activityFeed || this.activityFeed;
    return this;
  }

  statePath() {
    const dir = path.join(getAgentWorkspaceDir(), 'discord');
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // A missing state dir is recreated on the next write attempt.
    }
    return path.join(dir, STATE_FILENAME);
  }

  loadState() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.statePath(), 'utf8'));
      return {
        cursors: raw.cursors && typeof raw.cursors === 'object' ? raw.cursors : {},
        items: Array.isArray(raw.items) ? raw.items : [],
        memberNames: raw.memberNames && typeof raw.memberNames === 'object' ? raw.memberNames : {}
      };
    } catch {
      return { cursors: {}, items: [], memberNames: {} };
    }
  }

  saveState() {
    try {
      // Write-then-rename: a crash mid-write must not corrupt the cursor state,
      // or the "no missed messages" guarantee turns into duplicates or losses.
      const target = this.statePath();
      const tmp = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
      fs.renameSync(tmp, target);
    } catch (error) {
      this.logger.warn?.('Discord watch could not persist state', { error: error.message });
    }
  }

  reloadConfig() {
    this.config = extractor.loadConfig();
    if (this.running) this.restartTimer();
    return this.config;
  }

  getChannels() {
    return this.config.channels;
  }

  addChannel(channelId) {
    const id = String(channelId || '').trim();
    if (!/^\d+$/.test(id)) throw new Error('A Discord channel id is a numeric snowflake');
    if (!this.config.channels.includes(id)) this.config.channels.push(id);
    return this.config.channels;
  }

  removeChannel(channelId) {
    const id = String(channelId || '').trim();
    this.config.channels = this.config.channels.filter((existing) => existing !== id);
    delete this.state.cursors[id];
    this.saveState();
    return this.config.channels;
  }

  findItemByMessage(messageId) {
    return this.state.items.find((item) => item.messageId === messageId) || null;
  }

  /**
   * The most recent open item in a channel — what "on it" or "done" refers to
   * when nobody quotes the original message, which is almost always.
   */
  findOpenItem(channelId, { authorId = null } = {}) {
    return this.state.items.find((item) => (
      item.channelId === channelId
      && item.status !== 'done'
      && item.status !== 'dropped'
      && (!authorId || !item.assigneeIds?.length || item.assigneeIds.includes(authorId))
    )) || null;
  }

  recordItem(item) {
    this.state.items.unshift(item);
    if (this.state.items.length > MAX_ITEMS) this.state.items.length = MAX_ITEMS;
    this.stats.itemsCreated += 1;
    this.activityFeed?.track?.('discord.work-item', {
      id: item.id,
      kind: item.kind,
      priority: item.priority,
      assignees: item.assigneeNames
    });
    return item;
  }

  updateItem(item, patch) {
    Object.assign(item, patch, { updatedAt: new Date().toISOString() });
    this.stats.itemsUpdated += 1;
    return item;
  }

  applyExtraction(extraction, { channelId }) {
    if (extraction.action === 'ignore') return null;

    if (extraction.action === 'create') {
      if (this.findItemByMessage(extraction.messageId)) return null;
      return this.recordItem({
        id: `discord:${extraction.messageId}`,
        source: 'discord',
        channelId: extraction.channelId || channelId,
        messageId: extraction.messageId,
        permalink: extraction.permalink,
        authorId: extraction.authorId,
        authorName: extraction.authorName,
        assigneeIds: extraction.assigneeIds,
        assigneeNames: extraction.assigneeNames,
        text: extraction.text,
        summary: extraction.summary,
        kind: extraction.kind,
        priority: extraction.priority,
        tier: extraction.tier,
        confidence: extraction.confidence,
        status: 'new',
        claimedBy: null,
        sessionId: null,
        ticketUrl: null,
        prUrl: null,
        createdAt: extraction.createdAt,
        updatedAt: new Date().toISOString()
      });
    }

    const target = this.findOpenItem(channelId, { authorId: extraction.authorId });
    if (!target) return null;

    if (extraction.action === 'claim') {
      return this.updateItem(target, { status: 'claimed', claimedBy: extraction.authorId });
    }
    if (extraction.action === 'complete') {
      return this.updateItem(target, { status: 'done', completedBy: extraction.authorId });
    }
    if (extraction.action === 'drop') {
      return this.updateItem(target, { status: 'dropped' });
    }
    return null;
  }

  /**
   * Read one channel forward from wherever we left off.
   */
  async pollChannel(channelId) {
    const cursor = this.state.cursors[channelId] || null;

    // First sight of a channel: start from now (or a short backfill) rather than
    // ingesting years of history and inventing a hundred stale tasks.
    if (!cursor) {
      const latest = await this.client.getLatestMessageId(channelId);
      if (!latest.ok) return { channelId, ok: false, error: latest.error };
      if (!this.config.backfillMessages) {
        this.state.cursors[channelId] = latest.id;
        this.saveState();
        return { channelId, ok: true, messages: 0, seeded: true };
      }
    }

    const fetched = await this.client.fetchMessagesAfter(channelId, cursor, {
      maxMessages: cursor ? 400 : this.config.backfillMessages
    });
    if (!fetched.ok) return { channelId, ok: false, error: fetched.error };

    const created = [];
    const updated = [];
    for (const message of fetched.messages) {
      if (message.author?.username && message.author?.id) {
        this.state.memberNames[message.author.id] = message.author.username;
      }
      const extraction = extractor.extractFromMessage(message, {
        config: this.config,
        memberNames: this.state.memberNames
      });
      const result = this.applyExtraction(extraction, { channelId });
      if (!result) continue;
      (extraction.action === 'create' ? created : updated).push(result);
    }

    this.stats.messagesRead += fetched.messages.length;
    if (fetched.messages.length) {
      this.state.cursors[channelId] = fetched.messages[fetched.messages.length - 1].id;
    }
    this.saveState();

    return { channelId, ok: true, messages: fetched.messages.length, created: created.length, updated: updated.length, items: created };
  }

  async poll() {
    if (this.polling) return { skipped: 'already polling' };
    this.polling = true;

    try {
      const results = [];
      for (const channelId of this.config.channels) {
        results.push(await this.pollChannel(channelId));
      }
      this.lastPollAt = new Date().toISOString();
      this.lastError = results.find((r) => !r.ok)?.error || null;
      return { at: this.lastPollAt, channels: results };
    } catch (error) {
      this.lastError = error.message;
      this.logger.error?.('Discord watch poll failed', { error: error.message });
      return { error: error.message };
    } finally {
      this.polling = false;
    }
  }

  /**
   * Say back into the channel what the orchestrator already knows. Nobody types
   * a status update; the status is published from the system's own state.
   */
  async publishStatus(itemId, text) {
    const item = this.state.items.find((row) => row.id === itemId);
    if (!item) return { ok: false, error: `no work item "${itemId}"` };
    if (!this.config.publishStatus) return { ok: false, error: 'status publishing is disabled' };

    const posted = await this.client.postMessage(item.channelId, text, { replyToMessageId: item.messageId });
    if (posted.ok) this.stats.statusesPublished += 1;
    return posted;
  }

  /**
   * Bind a work item to the session that is actually doing it — this is what
   * makes "is their agent working on it" answerable.
   */
  async linkSession(itemId, sessionId, { announce = true } = {}) {
    const item = this.state.items.find((row) => row.id === itemId);
    if (!item) throw new Error(`No work item "${itemId}"`);

    this.updateItem(item, { status: 'in-progress', sessionId });
    this.saveState();

    try {
      this.taskRecordService?.upsert?.(`session:${sessionId}`, {
        tier: item.tier,
        ticketProvider: 'discord',
        ticketCardId: item.messageId,
        ticketCardUrl: item.permalink,
        ticketTitle: item.summary
      });
    } catch (error) {
      this.logger.warn?.('Could not write a task record for a Discord work item', { error: error.message });
    }

    if (announce) {
      await this.publishStatus(itemId, `🤖 picked up by \`${sessionId}\` — ${item.summary}`);
    }
    return item;
  }

  getItems({ status = '', assignee = '', channelId = '', limit = 50 } = {}) {
    const wantStatus = String(status || '').trim();
    const wantAssignee = String(assignee || '').trim();
    const wantChannel = String(channelId || '').trim();

    return this.state.items
      .filter((item) => (!wantStatus || item.status === wantStatus))
      .filter((item) => (!wantChannel || item.channelId === wantChannel))
      .filter((item) => (!wantAssignee
        || item.assigneeIds?.includes(wantAssignee)
        || item.assigneeNames?.includes(wantAssignee)))
      .slice(0, Math.max(1, Number(limit) || 50));
  }

  /**
   * What the team asked for that nobody has started — the list that currently
   * exists only in people's heads and scrollback.
   */
  getUntracked() {
    return this.state.items
      .filter((item) => item.status === 'new')
      .sort((a, b) => a.tier - b.tier || String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  restartTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.poll().catch((error) => this.logger.error?.('Discord poll threw', { error: error.message }));
    }, this.config.pollSeconds * 1000);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  start() {
    if (this.running) return { running: true, alreadyRunning: true };
    if (!this.config.enabled) return { running: false, reason: 'discord watch is disabled in config' };
    if (!this.client.isConfigured()) return { running: false, reason: 'DISCORD_BOT_TOKEN is not set' };
    if (!this.config.channels.length) return { running: false, reason: 'no channels configured' };

    this.running = true;
    this.restartTimer();
    return { running: true, pollSeconds: this.config.pollSeconds, channels: this.config.channels.length };
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const wasRunning = this.running;
    this.running = false;
    return { running: false, wasRunning };
  }

  getStatus() {
    return {
      running: this.running,
      enabled: this.config.enabled,
      configured: this.client.isConfigured(),
      configSource: this.config.source,
      pollSeconds: this.config.pollSeconds,
      publishStatus: this.config.publishStatus,
      channels: this.config.channels.map((id) => ({ id, cursor: this.state.cursors[id] || null })),
      stats: { ...this.stats },
      lastPollAt: this.lastPollAt,
      lastError: this.lastError,
      itemCounts: this.state.items.reduce((counts, item) => {
        counts[item.status] = (counts[item.status] || 0) + 1;
        return counts;
      }, {}),
      statePath: this.statePath()
    };
  }
}

module.exports = DiscordWatchService;
module.exports.DiscordWatchService = DiscordWatchService;
