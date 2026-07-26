const express = require('express');

const passthrough = (req, res, next) => next();

/**
 * `/api/app-server/*` — structured Codex control and the realtime voice bridge.
 *
 * Answering an approval is a `write`: it authorizes an agent to do something.
 */
function createAppServerRoutes({ appServerService, logger = console, requireRead = passthrough, requireWrite = passthrough } = {}) {
  const router = express.Router();

  const handle = (label, handler) => async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      logger.error(`App-server: ${label} failed`, { error: error.message });
      res.status(400).json({ ok: false, error: error.message });
    }
  };

  router.get('/status', requireRead, handle('status', (req, res) => {
    res.json({ ok: true, status: appServerService.getStatus() });
  }));

  router.post('/start', requireWrite, handle('start', async (req, res) => {
    if (req.body?.enable === true) appServerService.setEnabled(true);
    res.json({ ok: true, ...(await appServerService.start()) });
  }));

  router.post('/stop', requireWrite, handle('stop', (req, res) => {
    res.json({ ok: true, ...appServerService.stop() });
  }));

  router.get('/threads', requireRead, handle('list threads', async (req, res) => {
    res.json({ ok: true, threads: await appServerService.listThreads() });
  }));

  router.get('/signals', requireRead, handle('signals', (req, res) => {
    res.json({ ok: true, signals: appServerService.signals.listThreads() });
  }));

  router.post('/threads', requireWrite, handle('start thread', async (req, res) => {
    res.json({ ok: true, thread: await appServerService.startThread(req.body || {}) });
  }));

  router.post('/threads/:threadId/turn', requireWrite, handle('start turn', async (req, res) => {
    res.json({ ok: true, turn: await appServerService.startTurn(req.params.threadId, req.body?.input) });
  }));

  router.post('/threads/:threadId/interrupt', requireWrite, handle('interrupt turn', async (req, res) => {
    res.json({ ok: true, result: await appServerService.interruptTurn(req.params.threadId) });
  }));

  /**
   * Approvals answered over the wire, with the actual command in hand — rather
   * than typing a keystroke at whatever prompt happens to be on screen.
   */
  router.get('/approvals', requireRead, handle('list approvals', (req, res) => {
    res.json({ ok: true, approvals: appServerService.listPendingApprovals() });
  }));

  router.post('/approvals/:requestId', requireWrite, handle('answer approval', (req, res) => {
    const approved = req.body?.approved === true;
    res.json({ ok: true, ...appServerService.answerApproval(req.params.requestId, approved, { note: req.body?.note || '' }) });
  }));

  // ---- Realtime voice ----------------------------------------------------

  router.get('/realtime/voices', requireRead, handle('list voices', async (req, res) => {
    res.json({ ok: true, voices: await appServerService.listVoices() });
  }));

  router.post('/realtime/:threadId/start', requireWrite, handle('start realtime', async (req, res) => {
    const result = await appServerService.startRealtime(req.params.threadId, {
      transport: req.body?.transport || 'websocket',
      sdp: req.body?.sdp || '',
      voice: req.body?.voice || ''
    });
    res.json({ ok: true, realtime: result });
  }));

  router.post('/realtime/:threadId/stop', requireWrite, handle('stop realtime', async (req, res) => {
    res.json({ ok: true, result: await appServerService.stopRealtime(req.params.threadId) });
  }));

  router.post('/realtime/:threadId/text', requireWrite, handle('send realtime text', async (req, res) => {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ ok: false, error: 'text is required' });
    return res.json({ ok: true, result: await appServerService.sendRealtimeText(req.params.threadId, text) });
  }));

  router.post('/realtime/:threadId/audio', requireWrite, handle('send realtime audio', async (req, res) => {
    const audio = String(req.body?.audio || '');
    if (!audio) return res.status(400).json({ ok: false, error: 'audio (base64) is required' });
    return res.json({ ok: true, sent: await appServerService.sendRealtimeAudio(req.params.threadId, audio) });
  }));

  router.get('/realtime/transcripts', requireRead, handle('transcripts', (req, res) => {
    res.json({
      ok: true,
      transcripts: appServerService.getTranscripts({ threadId: req.query.threadId, limit: req.query.limit })
    });
  }));

  return router;
}

module.exports = { createAppServerRoutes };
