const express = require('express');

const passthrough = (req, res, next) => next();

/**
 * Speech output + the spoken fleet briefing.
 *
 * Speaking is a `write` action: it makes the machine do something in the room.
 */
function createSpeechRoutes({ speechService, supervisorService, logger = console, requireRead = passthrough, requireWrite = passthrough } = {}) {
  const router = express.Router();

  const handle = (label, handler) => async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      logger.error(`Speech: ${label} failed`, { error: error.message, stack: error.stack });
      res.status(400).json({ ok: false, error: error.message });
    }
  };

  router.get('/status', requireRead, handle('status', (req, res) => {
    res.json({ ok: true, status: speechService.getStatus() });
  }));

  router.post('/say', requireWrite, handle('say', (req, res) => {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ ok: false, error: 'text is required' });
    return res.json({
      ok: true,
      result: speechService.speak(text, {
        priority: req.body?.priority || 'normal',
        force: req.body?.force === true
      })
    });
  }));

  router.post('/backend', requireWrite, handle('set backend', (req, res) => {
    const backend = speechService.setBackend(String(req.body?.backend || '').trim().toLowerCase());
    res.json({ ok: true, backend, status: speechService.getStatus() });
  }));

  router.post('/enabled', requireWrite, handle('toggle', (req, res) => {
    res.json({ ok: true, enabled: speechService.setEnabled(req.body?.enabled !== false) });
  }));

  /**
   * "What's happening?" — the fleet summary, optionally spoken aloud.
   */
  router.post('/briefing', requireWrite, handle('briefing', (req, res) => {
    if (!supervisorService) return res.status(503).json({ ok: false, error: 'supervisor is not available' });
    const briefing = supervisorService.getBriefing({ limit: req.body?.limit });
    const spoken = req.body?.speak === false ? null : speechService.speak(briefing.spoken, { priority: 'high', force: true });
    return res.json({ ok: true, briefing, spoken });
  }));

  return router;
}

module.exports = { createSpeechRoutes };
