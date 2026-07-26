const fs = require('fs');
const path = require('path');

const { getAgentWorkspaceDir } = require('../utils/pathUtils');
const { messagePermalink } = require('./discordClient');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', '..', 'config', 'discord-watch.json');

function overrideConfigPath() {
  return path.join(getAgentWorkspaceDir(), 'discord-watch.json');
}

function compile(patterns) {
  const out = [];
  for (const pattern of Array.isArray(patterns) ? patterns : []) {
    try {
      out.push(new RegExp(String(pattern), 'i'));
    } catch {
      // One bad pattern must not disable extraction entirely.
    }
  }
  return out;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function loadConfig({ configPath = null } = {}) {
  const override = configPath || overrideConfigPath();
  const raw = readJson(override) || readJson(DEFAULT_CONFIG_PATH) || {};
  const source = readJson(override) ? override : DEFAULT_CONFIG_PATH;

  return {
    source,
    enabled: raw.enabled === true,
    pollSeconds: Math.max(5, Number(raw.pollSeconds) || 15),
    channels: Array.isArray(raw.channels) ? raw.channels.map(String).filter(Boolean) : [],
    backfillMessages: Math.max(0, Number(raw.backfillMessages) ?? 50),
    publishStatus: raw.publishStatus !== false,
    priority: (Array.isArray(raw.priority) ? raw.priority : []).map((row) => ({
      level: String(row.level || 'normal'),
      tier: Number(row.tier) || 3,
      patterns: compile(row.patterns)
    })),
    defaultPriority: {
      level: String(raw.defaultPriority?.level || 'normal'),
      tier: Number(raw.defaultPriority?.tier) || 3
    },
    kinds: (Array.isArray(raw.kinds) ? raw.kinds : []).map((row) => ({
      kind: String(row.kind || 'fyi'),
      trackable: row.trackable === true,
      patterns: compile(row.patterns)
    })),
    claimPatterns: compile(raw.claimPatterns),
    donePatterns: compile(raw.donePatterns),
    dropPatterns: compile(raw.dropPatterns),
    ignoreBots: raw.ignoreBots !== false,
    ignorePrefixes: Array.isArray(raw.ignorePrefixes) ? raw.ignorePrefixes.map(String) : [],
    minLength: Math.max(0, Number(raw.minLength) ?? 12)
  };
}

const MENTION_RE = /<@!?(\d+)>/g;

function extractMentions(message) {
  const ids = new Set();
  for (const match of String(message?.content || '').matchAll(MENTION_RE)) ids.add(match[1]);
  for (const mention of Array.isArray(message?.mentions) ? message.mentions : []) {
    if (mention?.id) ids.add(String(mention.id));
  }
  return [...ids];
}

function cleanContent(message, mentionNames = {}) {
  return String(message?.content || '')
    .replace(MENTION_RE, (_, id) => `@${mentionNames[id] || 'someone'}`)
    .replace(/\s+/g, ' ')
    .trim();
}

function firstMatch(rows, text) {
  for (const row of rows) {
    if (row.patterns.some((re) => re.test(text))) return row;
  }
  return null;
}

function classifyPriority(text, config) {
  const hit = firstMatch(config.priority, text);
  return hit ? { level: hit.level, tier: hit.tier } : { ...config.defaultPriority };
}

function classifyKind(text, config) {
  const hit = firstMatch(config.kinds, text);
  return hit ? { kind: hit.kind, trackable: hit.trackable } : { kind: 'fyi', trackable: false };
}

function shouldIgnore(message, config) {
  if (config.ignoreBots && message?.author?.bot) return 'bot';
  const content = String(message?.content || '').trim();
  if (!content) return 'empty';
  if (content.length < config.minLength) return 'too short';
  if (config.ignorePrefixes.some((prefix) => content.startsWith(prefix))) return 'ignored prefix';
  return null;
}

/**
 * Decide what a single message means.
 *
 * Rules first, deliberately: most team chat is unambiguous, and a rule pass over
 * every message costs nothing. `classifier` is the seam for handing the genuinely
 * ambiguous middle to a model — batched, and only for messages that look like
 * work but did not match cleanly.
 */
function extractFromMessage(message, { config, guildId = '', memberNames = {} } = {}) {
  const ignored = shouldIgnore(message, config);
  if (ignored) return { action: 'ignore', reason: ignored, messageId: message?.id };

  const text = cleanContent(message, memberNames);
  const mentions = extractMentions(message);

  // A signal about existing work beats creating new work — "done" following an
  // assignment is a status change, not a new task.
  if (config.donePatterns.some((re) => re.test(text))) {
    return { action: 'complete', messageId: message.id, authorId: message.author?.id, text, mentions };
  }
  if (config.dropPatterns.some((re) => re.test(text))) {
    return { action: 'drop', messageId: message.id, authorId: message.author?.id, text, mentions };
  }
  if (config.claimPatterns.some((re) => re.test(text))) {
    return { action: 'claim', messageId: message.id, authorId: message.author?.id, text, mentions };
  }

  const kind = classifyKind(text, config);
  const priority = classifyPriority(text, config);

  // Directed at a person and phrased as a request: that is an assignment even
  // if nobody creates a ticket, and it is exactly the thing that gets lost today.
  const directed = mentions.length > 0;
  const trackable = kind.trackable || (directed && kind.kind !== 'question');

  if (!trackable) {
    return { action: 'ignore', reason: `not trackable (${kind.kind})`, messageId: message.id, kind: kind.kind };
  }

  return {
    action: 'create',
    messageId: message.id,
    channelId: message.channel_id,
    permalink: messagePermalink({ guildId, channelId: message.channel_id, messageId: message.id }),
    authorId: message.author?.id || null,
    authorName: message.author?.username || memberNames[message.author?.id] || 'someone',
    assigneeIds: mentions,
    assigneeNames: mentions.map((id) => memberNames[id] || id),
    text,
    summary: text.length > 140 ? `${text.slice(0, 137)}…` : text,
    kind: kind.kind,
    priority: priority.level,
    tier: priority.tier,
    createdAt: message.timestamp || new Date().toISOString(),
    confidence: directed && kind.trackable ? 'high' : 'medium'
  };
}

function extractBatch(messages, options) {
  const results = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    results.push(extractFromMessage(message, options));
  }
  return results;
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  overrideConfigPath,
  loadConfig,
  extractMentions,
  cleanContent,
  classifyPriority,
  classifyKind,
  shouldIgnore,
  extractFromMessage,
  extractBatch
};
