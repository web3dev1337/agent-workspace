const express = require('express');

const passthrough = (req, res, next) => next();

/**
 * Ambient Discord watching: read the conversation, track the work, publish
 * status back. Anything that writes into a channel is policy-`write`.
 */
function createDiscordWatchRoutes({ discordWatchService, logger = console, requireRead = passthrough, requireWrite = passthrough } = {}) {
  const router = express.Router();

  const handle = (label, handler) => async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      logger.error(`Discord watch: ${label} failed`, { error: error.message, stack: error.stack });
      res.status(400).json({ ok: false, error: error.message });
    }
  };

  router.get('/status', requireRead, handle('status', (req, res) => {
    res.json({ ok: true, status: discordWatchService.getStatus() });
  }));

  router.get('/items', requireRead, handle('list items', (req, res) => {
    const items = discordWatchService.getItems({
      status: req.query.status,
      assignee: req.query.assignee,
      channelId: req.query.channelId,
      limit: req.query.limit
    });
    res.json({ ok: true, count: items.length, items });
  }));

  /**
   * Asked for, nobody started. The list that otherwise only exists in scrollback.
   */
  router.get('/untracked', requireRead, handle('untracked', (req, res) => {
    const items = discordWatchService.getUntracked();
    res.json({ ok: true, count: items.length, items });
  }));

  router.post('/poll', requireWrite, handle('poll', async (req, res) => {
    res.json({ ok: true, ...(await discordWatchService.poll()) });
  }));

  router.post('/start', requireWrite, handle('start', (req, res) => {
    res.json({ ok: true, ...discordWatchService.start() });
  }));

  router.post('/stop', requireWrite, handle('stop', (req, res) => {
    res.json({ ok: true, ...discordWatchService.stop() });
  }));

  router.post('/reload-config', requireWrite, handle('reload config', (req, res) => {
    const config = discordWatchService.reloadConfig();
    res.json({ ok: true, source: config.source, enabled: config.enabled, channels: config.channels });
  }));

  router.get('/channels', requireRead, handle('list channels', (req, res) => {
    res.json({ ok: true, channels: discordWatchService.getChannels() });
  }));

  router.post('/channels', requireWrite, handle('add channel', (req, res) => {
    res.json({ ok: true, channels: discordWatchService.addChannel(req.body?.channelId) });
  }));

  router.delete('/channels/:channelId', requireWrite, handle('remove channel', (req, res) => {
    res.json({ ok: true, channels: discordWatchService.removeChannel(req.params.channelId) });
  }));

  router.post('/items/:id/link', requireWrite, handle('link session', async (req, res) => {
    const item = await discordWatchService.linkSession(req.params.id, req.body?.sessionId, {
      announce: req.body?.announce !== false
    });
    res.json({ ok: true, item });
  }));

  router.post('/items/:id/status', requireWrite, handle('publish status', async (req, res) => {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ ok: false, error: 'text is required' });
    return res.json({ ok: true, ...(await discordWatchService.publishStatus(req.params.id, text)) });
  }));

  return router;
}

module.exports = { createDiscordWatchRoutes };
