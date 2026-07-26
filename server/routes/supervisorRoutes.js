const express = require('express');

const passthrough = (req, res, next) => next();

/**
 * REST surface for the fleet supervisor. Reads are policy-`read`; anything that
 * changes how much autonomy the loop has, or makes it act, is policy-`write`.
 */
function createSupervisorRoutes({ supervisorService, logger = console, requireRead = passthrough, requireWrite = passthrough } = {}) {
  const router = express.Router();

  const handle = (label, handler) => async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      logger.error(`Supervisor: ${label} failed`, { error: error.message, stack: error.stack });
      res.status(400).json({ ok: false, error: error.message });
    }
  };

  router.get('/status', requireRead, handle('status', (req, res) => {
    res.json({ ok: true, status: supervisorService.getStatus() });
  }));

  router.get('/findings', requireRead, handle('findings', (req, res) => {
    const findings = supervisorService.getFindings({
      limit: req.query.limit,
      severity: req.query.severity,
      sessionId: req.query.sessionId
    });
    res.json({ ok: true, count: findings.length, findings });
  }));

  router.get('/briefing', requireRead, handle('briefing', (req, res) => {
    res.json({ ok: true, briefing: supervisorService.getBriefing({ limit: req.query.limit }) });
  }));

  router.post('/tick', requireWrite, handle('tick', async (req, res) => {
    const result = await supervisorService.tick({ dryRun: req.body?.dryRun === true });
    res.json({ ok: !result.error, ...result });
  }));

  router.post('/start', requireWrite, handle('start', (req, res) => {
    res.json({ ok: true, ...supervisorService.start() });
  }));

  router.post('/stop', requireWrite, handle('stop', (req, res) => {
    res.json({ ok: true, ...supervisorService.stop() });
  }));

  router.post('/autonomy', requireWrite, handle('set autonomy', (req, res) => {
    const level = supervisorService.setAutonomy(String(req.body?.level || '').trim().toLowerCase());
    res.json({ ok: true, autonomy: level, status: supervisorService.getStatus() });
  }));

  router.post('/reload-rules', requireWrite, handle('reload rules', (req, res) => {
    const rules = supervisorService.reloadRules();
    res.json({ ok: true, source: rules.source, conditionCount: rules.conditions.length, autonomy: rules.autonomy });
  }));

  router.get('/digest', requireRead, handle('digest', (req, res) => {
    res.json({ ok: true, pending: supervisorService.digest.pending(), budget: supervisorService.budget.getState() });
  }));

  /**
   * Deliver the batch now — "catch me up" — instead of waiting for the timer.
   */
  router.post('/digest/deliver', requireWrite, handle('deliver digest', (req, res) => {
    res.json({ ok: true, delivered: supervisorService.deliverDigest() });
  }));

  router.post('/interruption-policy', requireWrite, handle('set interruption policy', (req, res) => {
    res.json({ ok: true, interruption: supervisorService.setInterruptionPolicy(req.body || {}) });
  }));

  return router;
}

module.exports = { createSupervisorRoutes };
