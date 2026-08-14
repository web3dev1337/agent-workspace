const express = require('express');

const passthrough = (req, res, next) => next();

/**
 * REST surface for the swappable voice-model registry. Reads are policy-`read`;
 * changing the active provider is policy-`write`.
 */
function createVoiceProviderRoutes({ voiceProviderService, logger = console, requireRead = passthrough, requireWrite = passthrough } = {}) {
  const router = express.Router();

  const handle = (label, handler) => async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      logger.error(`Voice providers: ${label} failed`, { error: error.message });
      res.status(400).json({ ok: false, error: error.message });
    }
  };

  // Everything: active selections + every provider with a live health check.
  router.get('/', requireRead, handle('status', async (req, res) => {
    res.json({ ok: true, ...(await voiceProviderService.getStatus()) });
  }));

  // Just the providers for one capability (tts|stt|duplex), with health.
  router.get('/:kind', requireRead, handle('list by kind', async (req, res) => {
    const kind = String(req.params.kind || '').toLowerCase();
    if (!['tts', 'stt', 'duplex'].includes(kind)) {
      return res.status(400).json({ ok: false, error: `unknown capability "${kind}"` });
    }
    res.json({ ok: true, kind, providers: await voiceProviderService.listWithHealth(kind) });
  }));

  // Swap the active provider for a capability. id may be a provider id, 'auto', or 'none'.
  router.post('/:kind/active', requireWrite, handle('set active', async (req, res) => {
    const kind = String(req.params.kind || '').toLowerCase();
    const id = String(req.body?.id || '').trim();
    if (!id) return res.status(400).json({ ok: false, error: 'id is required' });
    const result = voiceProviderService.setActive(kind, id);
    res.json({ ok: true, ...result, resolved: (await voiceProviderService.resolveActive(kind))?.id || null });
  }));

  router.post('/reload', requireWrite, handle('reload', async (req, res) => {
    voiceProviderService.invalidate();
    res.json({ ok: true, ...(await voiceProviderService.getStatus()) });
  }));

  return router;
}

module.exports = { createVoiceProviderRoutes };
