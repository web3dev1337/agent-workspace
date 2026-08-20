const express = require('express');

const passthrough = (req, res, next) => next();

const asList = (value) => String(value === undefined || value === null ? '' : value)
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

/**
 * REST surface for the Repo Atlas. Reads are policy-`read`, curation is
 * policy-`write`, and compiling a shareable bundle is treated as a write
 * because it produces an artifact that leaves this machine.
 */
function createAtlasRoutes({ repoAtlasService, logger = console, requireRead = passthrough, requireWrite = passthrough } = {}) {
  const router = express.Router();

  const handle = (label, handler) => async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      logger.error(`Atlas: ${label} failed`, { error: error.message, stack: error.stack });
      res.status(400).json({ ok: false, error: error.message });
    }
  };

  router.get('/status', requireRead, handle('status', (req, res) => {
    res.json({ ok: true, status: repoAtlasService.getStatus() });
  }));

  router.get('/entries', requireRead, handle('list entries', (req, res) => {
    const entries = repoAtlasService.search({
      kind: req.query.kind,
      platform: req.query.platform,
      group: req.query.group,
      status: req.query.status,
      language: req.query.language,
      query: req.query.query || req.query.q,
      minQuality: req.query.minQuality,
      includeForks: req.query.includeForks !== 'false',
      includeArchived: req.query.includeArchived !== 'false'
    });
    res.json({ ok: true, count: entries.length, entries });
  }));

  router.get('/entries/:id', requireRead, handle('get entry', (req, res) => {
    const entry = repoAtlasService.getEntry(req.params.id);
    if (!entry) return res.status(404).json({ ok: false, error: `No atlas entry "${req.params.id}"` });
    return res.json({ ok: true, entry, description: repoAtlasService.describe(req.params.id) });
  }));

  router.get('/find', requireRead, handle('find', (req, res) => {
    const topic = req.query.topic || req.query.q;
    if (!topic) return res.status(400).json({ ok: false, error: 'topic is required' });
    const hits = repoAtlasService.find(topic, {
      minQuality: req.query.minQuality,
      includeAvoided: req.query.includeAvoided === 'true'
    });
    return res.json({ ok: true, topic, count: hits.length, hits });
  }));

  router.get('/topics', requireRead, handle('topics', (req, res) => {
    res.json({ ok: true, topics: repoAtlasService.topics() });
  }));

  router.get('/digest', requireRead, handle('digest', (req, res) => {
    const digest = repoAtlasService.digest({
      groupBy: req.query.groupBy || 'platform',
      maxPerBucket: Number(req.query.max) || 8,
      onlyWithHighlights: req.query.all !== 'true'
    });
    res.json({ ok: true, digest });
  }));

  router.get('/doctor', requireRead, handle('doctor', (req, res) => {
    res.json({ ok: true, report: repoAtlasService.validate() });
  }));

  router.post('/refresh', requireWrite, handle('refresh', async (req, res) => {
    const result = await repoAtlasService.refresh({
      scanLocal: req.body?.scanLocal !== false,
      scanGitHub: req.body?.scanGitHub !== false,
      owner: req.body?.owner || '',
      limit: Number(req.body?.limit) || 300
    });
    res.json({ ok: true, ...result });
  }));

  router.put('/entries/:id', requireWrite, handle('update entry', (req, res) => {
    const entry = repoAtlasService.setEntry(req.params.id, req.body || {});
    res.json({ ok: true, entry });
  }));

  router.delete('/entries/:id', requireWrite, handle('delete entry', (req, res) => {
    res.json({ ok: true, removed: repoAtlasService.removeEntry(req.params.id) });
  }));

  router.post('/entries/:id/highlights', requireWrite, handle('add highlight', (req, res) => {
    const entry = repoAtlasService.addHighlight(req.params.id, {
      topic: req.body?.topic,
      quality: req.body?.quality,
      paths: Array.isArray(req.body?.paths) ? req.body.paths : asList(req.body?.paths),
      notes: req.body?.notes || ''
    });
    res.json({ ok: true, entry });
  }));

  router.post('/entries/:id/avoid', requireWrite, handle('add avoid', (req, res) => {
    const entry = repoAtlasService.addAvoid(req.params.id, {
      topic: req.body?.topic,
      reason: req.body?.reason || ''
    });
    res.json({ ok: true, entry });
  }));

  router.get('/audiences', requireRead, handle('list audiences', (req, res) => {
    res.json({ ok: true, audiences: repoAtlasService.listAudiences() });
  }));

  router.post('/audiences', requireWrite, handle('save audience', (req, res) => {
    const audiences = repoAtlasService.setAudience({
      id: req.body?.id,
      label: req.body?.label || '',
      description: req.body?.description || '',
      outputPath: req.body?.outputPath || ''
    });
    res.json({ ok: true, audiences });
  }));

  /**
   * Write-back. Agents propose; the human decides. Proposing is a `read`-level
   * action because it changes nothing — approving is what writes.
   */
  router.get('/proposals', requireRead, handle('list proposals', (req, res) => {
    const list = repoAtlasService.listProposals({ status: req.query.status || 'pending', repoId: req.query.repoId });
    res.json({ ok: true, count: list.length, proposals: list, stats: repoAtlasService.getProposalStats() });
  }));

  router.post('/proposals', requireRead, handle('propose', (req, res) => {
    res.json({ ok: true, proposal: repoAtlasService.proposeHighlight(req.body || {}) });
  }));

  router.post('/proposals/:id/approve', requireWrite, handle('approve proposal', (req, res) => {
    const result = repoAtlasService.approveProposal(req.params.id, { note: req.body?.note || '' });
    if (!result.ok) return res.status(404).json(result);
    return res.json({ ok: true, ...result });
  }));

  router.post('/proposals/:id/reject', requireWrite, handle('reject proposal', (req, res) => {
    const result = repoAtlasService.rejectProposal(req.params.id, { note: req.body?.note || '' });
    if (!result.ok) return res.status(404).json(result);
    return res.json({ ok: true, ...result });
  }));

  router.delete('/proposals', requireWrite, handle('clear decided proposals', (req, res) => {
    res.json({ ok: true, remaining: repoAtlasService.clearDecidedProposals() });
  }));

  router.get('/sync', requireRead, handle('sync status', async (req, res) => {
    res.json({ ok: true, sync: await repoAtlasService.getSyncStatus() });
  }));

  router.post('/sync', requireWrite, handle('sync', async (req, res) => {
    const result = await repoAtlasService.sync({ message: req.body?.message || '' });
    res.json({ ok: result.ok, ...result });
  }));

  router.post('/remote', requireWrite, handle('set remote', async (req, res) => {
    res.json({ ok: true, remote: await repoAtlasService.setRemote(req.body?.remote || '') });
  }));

  router.post('/publish', requireWrite, handle('publish', async (req, res) => {
    const audience = req.body?.audience;
    if (!audience) return res.status(400).json({ ok: false, error: 'audience is required' });
    const result = await repoAtlasService.publish(audience, { push: req.body?.push !== false });
    return res.json({ ok: true, audience, counts: result.counts, published: result.published });
  }));

  router.get('/subscriptions', requireRead, handle('list subscriptions', (req, res) => {
    res.json({ ok: true, subscriptions: repoAtlasService.listSubscriptions() });
  }));

  router.post('/subscriptions', requireWrite, handle('subscribe', async (req, res) => {
    const result = await repoAtlasService.subscribe({ name: req.body?.name, source: req.body?.source });
    res.json({ ok: true, ...result });
  }));

  router.delete('/subscriptions/:name', requireWrite, handle('unsubscribe', (req, res) => {
    res.json({ ok: true, removed: repoAtlasService.unsubscribe(req.params.name) });
  }));

  router.post('/compile', requireWrite, handle('compile bundle', (req, res) => {
    const audience = req.body?.audience;
    if (!audience) return res.status(400).json({ ok: false, error: 'audience is required' });
    const dryRun = req.body?.dryRun === true;
    const result = repoAtlasService.compile(audience, { write: !dryRun });
    return res.json({
      ok: true,
      audience,
      dryRun,
      counts: result.counts,
      decisions: result.decisions,
      written: result.written,
      bundle: dryRun ? result.bundle : undefined
    });
  }));

  return router;
}

module.exports = { createAtlasRoutes };
