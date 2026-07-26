const fs = require('fs');
const path = require('path');

const store = require('./atlasStore');
const { kebab, normalizeTopic } = require('./atlasSchema');

const PROPOSALS_FILENAME = 'proposals.json';
const MAX_PROPOSALS = 300;

function proposalsPath() {
  return path.join(store.atlasDir(), PROPOSALS_FILENAME);
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(proposalsPath(), 'utf8'));
    return Array.isArray(raw?.proposals) ? raw.proposals : [];
  } catch {
    return [];
  }
}

function save(proposals) {
  fs.mkdirSync(path.dirname(proposalsPath()), { recursive: true });
  fs.writeFileSync(proposalsPath(), `${JSON.stringify({ proposals }, null, 2)}\n`, 'utf8');
  return proposals;
}

function proposalId(repoId, topic) {
  return `${kebab(repoId)}:${normalizeTopic(topic)}`;
}

/**
 * Agents propose; you decide.
 *
 * The map is only worth trusting if its quality scores mean something, so an
 * agent that just finished work cannot write to it directly — it queues a
 * proposal with the evidence for the claim. Left to write freely, every repo
 * an agent touched would end up rated 5/5 and the whole thing would be noise.
 */
function propose({ repoId, topic, quality = null, paths = [], notes = '', evidence = '', proposedBy = 'agent', kind = 'highlight' } = {}) {
  const id = kebab(repoId);
  const normalizedTopic = normalizeTopic(topic);
  if (!id) throw new Error('A proposal needs a repo id');
  if (!normalizedTopic) throw new Error('A proposal needs a topic');
  if (kind !== 'highlight' && kind !== 'avoid') throw new Error(`Unknown proposal kind "${kind}"`);

  const proposals = load();
  const key = proposalId(id, normalizedTopic);
  const existing = proposals.find((p) => p.id === key && p.status === 'pending');

  const entry = {
    id: key,
    repoId: id,
    topic: normalizedTopic,
    kind,
    quality: quality === null || quality === undefined ? null : Math.min(5, Math.max(1, Math.round(Number(quality)))),
    paths: Array.isArray(paths) ? paths.filter(Boolean) : String(paths || '').split(',').map((p) => p.trim()).filter(Boolean),
    notes: String(notes || '').trim(),
    // Why the agent believes this — the thing that makes a proposal reviewable
    // in a couple of seconds instead of requiring you to go and look.
    evidence: String(evidence || '').trim(),
    proposedBy: String(proposedBy || 'agent'),
    status: 'pending',
    proposedAt: new Date().toISOString(),
    supersedes: existing ? existing.proposedAt : null
  };

  const remaining = proposals.filter((p) => !(p.id === key && p.status === 'pending'));
  remaining.unshift(entry);
  if (remaining.length > MAX_PROPOSALS) remaining.length = MAX_PROPOSALS;
  save(remaining);

  return entry;
}

function list({ status = 'pending', repoId = '' } = {}) {
  const wantStatus = String(status || '').trim();
  const wantRepo = kebab(repoId);
  return load()
    .filter((p) => (!wantStatus || wantStatus === 'all' || p.status === wantStatus))
    .filter((p) => (!wantRepo || p.repoId === wantRepo));
}

function decide(id, decision, { note = '' } = {}) {
  const proposals = load();
  const entry = proposals.find((p) => p.id === id && p.status === 'pending');
  if (!entry) return { ok: false, error: `no pending proposal "${id}"` };

  entry.status = decision;
  entry.decidedAt = new Date().toISOString();
  if (note) entry.decisionNote = note;
  save(proposals);

  return { ok: true, proposal: entry };
}

/**
 * Approving is what actually writes to the registry, via the same code path
 * manual curation uses — so an approved proposal is indistinguishable from a
 * note you wrote yourself, and syncs the same way.
 */
function approve(id, atlas, { note = '' } = {}) {
  const result = decide(id, 'approved', { note });
  if (!result.ok) return result;

  const { proposal } = result;
  const applied = proposal.kind === 'avoid'
    ? atlas.addAvoid(proposal.repoId, { topic: proposal.topic, reason: proposal.notes })
    : atlas.addHighlight(proposal.repoId, {
      topic: proposal.topic,
      quality: proposal.quality,
      paths: proposal.paths,
      notes: proposal.notes
    });

  return { ok: true, proposal, entry: applied };
}

function reject(id, { note = '' } = {}) {
  return decide(id, 'rejected', { note });
}

function clearDecided() {
  const remaining = load().filter((p) => p.status === 'pending');
  save(remaining);
  return remaining.length;
}

function getStats() {
  const all = load();
  return {
    pending: all.filter((p) => p.status === 'pending').length,
    approved: all.filter((p) => p.status === 'approved').length,
    rejected: all.filter((p) => p.status === 'rejected').length,
    path: proposalsPath()
  };
}

module.exports = {
  PROPOSALS_FILENAME,
  proposalsPath,
  propose,
  list,
  approve,
  reject,
  clearDecided,
  getStats
};
