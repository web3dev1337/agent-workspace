const fs = require('fs');
const os = require('os');
const path = require('path');

const DiscordWatchService = require('../../server/discordWatchService');
const extractor = require('../../server/discord/workExtractor');
const { DiscordClient } = require('../../server/discord/discordClient');

const config = extractor.loadConfig({ configPath: extractor.DEFAULT_CONFIG_PATH });

const message = (overrides = {}) => ({
  id: '100',
  channel_id: 'chan1',
  content: 'hello world this is long enough',
  author: { id: '1001', username: 'ab', bot: false },
  timestamp: '2026-07-26T12:00:00Z',
  ...overrides
});

describe('workExtractor', () => {
  test('a mention plus a request is an assignment, even with no ticket', () => {
    const result = extractor.extractFromMessage(
      message({ content: '<@2002> can you fix the physics stutter on the boss fight' }),
      { config, memberNames: { 2002: 'sam' } }
    );

    expect(result.action).toBe('create');
    expect(result.kind).toBe('assignment');
    expect(result.assigneeIds).toEqual(['2002']);
    expect(result.assigneeNames).toEqual(['sam']);
    expect(result.confidence).toBe('high');
  });

  test('priority comes out of how people actually talk', () => {
    const urgent = extractor.extractFromMessage(message({ content: '<@2002> URGENT the build is broken on main' }), { config });
    const later = extractor.extractFromMessage(message({ content: '<@2002> when you get a chance please update the readme' }), { config });

    expect(urgent.priority).toBe('urgent');
    expect(urgent.tier).toBe(1);
    expect(later.priority).toBe('low');
    expect(later.tier).toBe(4);
  });

  test('a bug report is trackable even with nobody mentioned', () => {
    const result = extractor.extractFromMessage(message({ content: 'the save system is broken after the last merge' }), { config });
    expect(result.action).toBe('create');
    expect(result.kind).toBe('bug');
  });

  test('a plain question is not turned into a task', () => {
    const result = extractor.extractFromMessage(message({ content: 'what did we decide about the camera angle?' }), { config });
    expect(result.action).toBe('ignore');
  });

  test('claim, done and drop update existing work instead of creating more', () => {
    expect(extractor.extractFromMessage(message({ content: "on it, starting now" }), { config }).action).toBe('claim');
    expect(extractor.extractFromMessage(message({ content: 'done, merged to main' }), { config }).action).toBe('complete');
    expect(extractor.extractFromMessage(message({ content: 'nevermind, not needed anymore' }), { config }).action).toBe('drop');
  });

  test('bots, commands and one-word replies are ignored', () => {
    expect(extractor.extractFromMessage(message({ author: { id: 'b', bot: true }, content: 'please fix the thing' }), { config }).reason).toBe('bot');
    expect(extractor.extractFromMessage(message({ content: '!deploy production now' }), { config }).reason).toBe('ignored prefix');
    expect(extractor.extractFromMessage(message({ content: 'ok' }), { config }).reason).toBe('too short');
  });

  test('mentions are rendered as names so the text reads back sensibly', () => {
    const result = extractor.extractFromMessage(
      message({ content: '<@2002> please add the leaderboard' }),
      { config, memberNames: { 2002: 'sam' } }
    );
    expect(result.text).toBe('@sam please add the leaderboard');
  });

  test('a negated completion is not treated as done', () => {
    expect(extractor.extractFromMessage(message({ content: 'that bug is not done yet, still crashing' }), { config }).action).not.toBe('complete');
    expect(extractor.extractFromMessage(message({ content: "the payment flow isn't fixed, more work needed" }), { config }).action).not.toBe('complete');
    // A punctuation break resets the negation, so this is still a completion.
    expect(extractor.extractFromMessage(message({ content: 'not a problem, that one is done and merged' }), { config }).action).toBe('complete');
  });
});

describe('workExtractor loadConfig', () => {
  const withConfig = (obj, fn) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'disc-cfg-'));
    const file = path.join(dir, 'discord-watch.json');
    fs.writeFileSync(file, JSON.stringify(obj));
    try { return fn(extractor.loadConfig({ configPath: file })); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };

  test('a minimal override keeps the shipped pattern tables instead of wiping them', () => {
    withConfig({ enabled: true, channels: ['123'] }, (cfg) => {
      expect(cfg.enabled).toBe(true);
      expect(cfg.channels).toEqual(['123']);
      // These come from the defaults — a wholesale replace would have emptied them.
      expect(cfg.priority.length).toBeGreaterThan(0);
      expect(cfg.kinds.length).toBeGreaterThan(0);
      expect(cfg.donePatterns.length).toBeGreaterThan(0);
    });
  });

  test('a missing numeric field falls back to its default rather than NaN', () => {
    withConfig({ enabled: true, channels: ['123'] }, (cfg) => {
      expect(cfg.backfillMessages).toBe(50);
      expect(cfg.minLength).toBe(12);
    });
  });

  test('an explicit backfill of 0 (never look back) is preserved', () => {
    withConfig({ enabled: true, channels: ['123'], backfillMessages: 0 }, (cfg) => {
      expect(cfg.backfillMessages).toBe(0);
    });
  });

  test('an explicit null in an override falls back instead of silently becoming 0', () => {
    // Number(null) === 0, so a null minLength used to disable the
    // short-message spam filter entirely rather than defaulting to 12.
    withConfig({ enabled: true, channels: ['123'], minLength: null, backfillMessages: null }, (cfg) => {
      expect(cfg.minLength).toBe(12);
      expect(cfg.backfillMessages).toBe(50);
    });
  });

  test('an explicit tier of 0 is honored, not coerced to 3', () => {
    withConfig({
      enabled: true,
      channels: ['123'],
      priority: [{ level: 'now', tier: 0, patterns: ['\\bnow\\b'] }],
      defaultPriority: { level: 'normal', tier: 0 }
    }, (cfg) => {
      expect(cfg.priority[0].tier).toBe(0);
      expect(cfg.defaultPriority.tier).toBe(0);
    });
  });
});

describe('DiscordClient', () => {
  test('reports missing configuration rather than throwing', async () => {
    const client = new DiscordClient({ token: '' });
    expect(client.isConfigured()).toBe(false);
    expect((await client.request('/anything')).error).toMatch(/not configured/);
  });

  test('pages forward from the cursor and returns messages oldest-first', async () => {
    const pages = [
      [{ id: '3' }, { id: '2' }],
      []
    ];
    const seen = [];
    const client = new DiscordClient({
      token: 't',
      fetchImpl: async (url) => {
        seen.push(url);
        return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(pages.shift() || []) };
      }
    });

    const result = await client.fetchMessagesAfter('chan1', '1');
    expect(result.ok).toBe(true);
    expect(result.messages.map((m) => m.id)).toEqual(['2', '3']);
    expect(seen[0]).toContain('after=1');
  });

  test('a first-sight backfill keeps the most recent N, not the oldest N', async () => {
    // 150 messages, newest-first per page (ids 150..51, then 50..1).
    const all = Array.from({ length: 150 }, (_, i) => ({ id: String(150 - i) }));
    const pages = [all.slice(0, 100), all.slice(100), []];
    const client = new DiscordClient({
      token: 't',
      fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(pages.shift() || []) })
    });

    // No cursor => backfill. Want the 50 most recent (ids 101..150), chronological.
    const result = await client.fetchMessagesAfter('chan1', null, { maxMessages: 50 });
    expect(result.messages).toHaveLength(50);
    expect(result.messages[result.messages.length - 1].id).toBe('150');
    expect(result.messages[0].id).toBe('101');
  });

  test('a backfill larger than one page walks BACKWARD through history', async () => {
    // 150 messages, newest-first (ids 150..1), served in URL-aware pages.
    const all = Array.from({ length: 150 }, (_, i) => ({ id: String(150 - i) }));
    const seen = [];
    const client = new DiscordClient({
      token: 't',
      fetchImpl: async (url) => {
        seen.push(url);
        const before = new URL(url).searchParams.get('before');
        const start = before ? all.findIndex((m) => m.id === before) + 1 : 0;
        return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(all.slice(start, start + 100)) };
      }
    });

    const result = await client.fetchMessagesAfter('chan1', null, { maxMessages: 150 });
    // The old forward walk re-queried after the NEWEST message, got an empty
    // page, and silently capped every backfill at 100.
    expect(result.messages).toHaveLength(150);
    expect(result.messages[0].id).toBe('1');
    expect(result.messages[149].id).toBe('150');
    expect(seen[1]).toContain('before=51');
  });

  test('a 429 backs off instead of hammering', async () => {
    const client = new DiscordClient({
      token: 't',
      fetchImpl: async () => ({ ok: false, status: 429, headers: { get: () => '3' }, text: async () => '{}' })
    });

    expect((await client.request('/x')).status).toBe(429);
    const second = await client.request('/x');
    expect(second.error).toBe('rate limited');
    expect(second.retryAfterMs).toBeGreaterThan(0);
  });
});

describe('DiscordWatchService', () => {
  let tmpDir;

  const harness = ({ messages = [], latestId = '9' } = {}) => {
    const posted = [];
    const client = {
      isConfigured: () => true,
      getLatestMessageId: async () => ({ ok: true, id: latestId }),
      fetchMessagesAfter: async () => ({ ok: true, messages }),
      postMessage: async (channelId, content, options) => {
        posted.push({ channelId, content, options });
        return { ok: true, message: { id: 'posted' } };
      }
    };

    const service = new DiscordWatchService({ logger: { warn: () => {}, error: () => {}, info: () => {} }, client });
    service.config = { ...extractor.loadConfig({ configPath: extractor.DEFAULT_CONFIG_PATH }), enabled: true, channels: ['chan1'] };
    service.init({ taskRecordService: { upsert: () => {} }, activityFeed: { track: () => {} } });
    return { service, posted };
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discord-watch-'));
    process.env.AGENT_WORKSPACE_DIR = tmpDir;
  });

  afterEach(() => {
    delete process.env.AGENT_WORKSPACE_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('a conversation becomes tracked work without anyone filing a ticket', async () => {
    const { service } = harness({
      messages: [
        message({ id: '10', content: '<@2002> please fix the crash on level three, its urgent' }),
        message({ id: '11', content: 'sounds good' })
      ]
    });

    const result = await service.poll();
    expect(result.channels[0].created).toBe(1);

    const [item] = service.getItems();
    expect(item.priority).toBe('urgent');
    expect(item.tier).toBe(1);
    expect(item.status).toBe('new');
    expect(item.permalink).toContain('/chan1/10');
  });

  test('the cursor advances so nothing is read twice', async () => {
    const { service } = harness({ messages: [message({ id: '10', content: '<@2002> please fix the crash on level three' })] });
    await service.poll();
    expect(service.state.cursors.chan1).toBe('10');

    service.client.fetchMessagesAfter = async () => ({ ok: true, messages: [] });
    await service.poll();
    expect(service.getItems()).toHaveLength(1);
  });

  test('a restart resumes from the stored cursor rather than replaying history', async () => {
    const { service } = harness({ messages: [message({ id: '10', content: '<@2002> please fix the crash on level three' })] });
    await service.poll();

    const revived = new DiscordWatchService({ logger: { warn: () => {} }, client: service.client });
    expect(revived.state.cursors.chan1).toBe('10');
    expect(revived.getItems()).toHaveLength(1);
  });

  test('a first-seen channel seeds from now instead of ingesting all history', async () => {
    const { service } = harness({ latestId: '500' });
    service.config.backfillMessages = 0;

    const result = await service.poll();
    expect(result.channels[0].seeded).toBe(true);
    expect(service.state.cursors.chan1).toBe('500');
    expect(service.getItems()).toEqual([]);
  });

  test('"on it" claims the open item rather than creating another', async () => {
    const { service } = harness({
      messages: [
        message({ id: '10', content: '<@2002> please fix the crash on level three' }),
        message({ id: '11', author: { id: '2002', username: 'sam' }, content: 'on it, taking this now' })
      ]
    });

    await service.poll();
    const items = service.getItems();
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe('claimed');
    expect(items[0].claimedBy).toBe('2002');
  });

  test('"done" closes the item so it stops showing as outstanding', async () => {
    const { service } = harness({
      messages: [
        message({ id: '10', content: '<@2002> please fix the crash on level three' }),
        message({ id: '11', author: { id: '2002', username: 'sam' }, content: 'done, that is shipped and merged' })
      ]
    });

    await service.poll();
    expect(service.getItems()[0].status).toBe('done');
    expect(service.getUntracked()).toEqual([]);
  });

  test('untracked work is ordered by priority — the list nobody currently has', async () => {
    const { service } = harness({
      messages: [
        message({ id: '10', content: '<@2002> when you get a chance please update the readme' }),
        message({ id: '11', content: '<@2002> URGENT production is down, please look now' })
      ]
    });

    await service.poll();
    expect(service.getUntracked().map((item) => item.priority)).toEqual(['urgent', 'low']);
  });

  test('linking a session announces it, which is what makes agent status visible', async () => {
    const { service, posted } = harness({
      messages: [message({ id: '10', content: '<@2002> please fix the crash on level three' })]
    });
    await service.poll();

    const item = await service.linkSession('discord:10', 'zoo-game-work1-claude');
    expect(item.status).toBe('in-progress');
    expect(item.sessionId).toBe('zoo-game-work1-claude');
    expect(posted[0].content).toContain('zoo-game-work1-claude');
    expect(posted[0].options.replyToMessageId).toBe('10');
  });

  test('linking writes a task record so the item gets the right tier', async () => {
    const records = [];
    const { service } = harness({ messages: [message({ id: '10', content: '<@2002> URGENT please fix the crash now' })] });
    service.init({ taskRecordService: { upsert: (id, patch) => records.push({ id, patch }) } });
    await service.poll();

    await service.linkSession('discord:10', 'work1-claude', { announce: false });
    expect(records[0].id).toBe('session:work1-claude');
    expect(records[0].patch.tier).toBe(1);
    expect(records[0].patch.ticketProvider).toBe('discord');
  });

  test('start refuses without a token, channels, or being enabled', () => {
    const { service } = harness();
    service.config.enabled = false;
    expect(service.start().reason).toMatch(/disabled/);

    service.config.enabled = true;
    service.config.channels = [];
    expect(service.start().reason).toMatch(/no channels/);
  });

  test('a Discord outage is reported, not thrown', async () => {
    const { service } = harness();
    service.client.fetchMessagesAfter = async () => ({ ok: false, error: 'HTTP 503' });
    service.state.cursors.chan1 = '1';

    const result = await service.poll();
    expect(result.channels[0].ok).toBe(false);
    expect(service.getStatus().lastError).toBe('HTTP 503');
  });

  test('guild-channel permalinks carry the real guild id, not the DM-only @me', async () => {
    const { service } = harness({ messages: [message({ id: '10', content: '<@2002> please fix the crash on level three' })] });
    let lookups = 0;
    service.client.getChannel = async () => { lookups += 1; return { ok: true, channel: { guild_id: 'g777' } }; };

    await service.poll();
    expect(service.getItems()[0].permalink).toContain('/channels/g777/chan1/10');
    expect(service.getItems()[0].permalink).not.toContain('@me');

    // The lookup is cached — a second poll must not re-fetch channel info.
    service.client.fetchMessagesAfter = async () => ({ ok: true, messages: [] });
    await service.poll();
    expect(lookups).toBe(1);
  });

  test('a failing task-record write is logged, not an unhandled rejection', async () => {
    const warnings = [];
    const { service } = harness({ messages: [message({ id: '10', content: '<@2002> please fix the crash on level three' })] });
    service.logger = { warn: (msg) => warnings.push(msg), error: () => {}, info: () => {} };
    service.init({ taskRecordService: { upsert: async () => { throw new Error('disk full'); } } });
    await service.poll();

    // Without the await, the rejection skipped the catch entirely.
    const item = await service.linkSession('discord:10', 'work1-claude', { announce: false });
    expect(item.status).toBe('in-progress');
    expect(warnings.some((w) => /task record/i.test(w))).toBe(true);
  });

  test('channels added or removed over the API survive a config reload', async () => {
    const { service } = harness();
    service.addChannel('424242424242');

    // reload-config rebuilds this.config from disk — the in-memory-only
    // version of addChannel lost the channel right here.
    service.reloadConfig();
    expect(service.getChannels()).toContain('424242424242');

    service.removeChannel('424242424242');
    service.reloadConfig();
    expect(service.getChannels()).not.toContain('424242424242');
  });
});
