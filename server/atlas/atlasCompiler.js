const { SCHEMA_VERSION, LOCAL_ONLY_FIELDS, kebab } = require('./atlasSchema');
const { sealEntry } = require('./atlasEncryption');

const PUBLIC_AUDIENCE = 'public';

/**
 * Decide whether one entry belongs in one audience's bundle.
 *
 * `private` is a hard kill switch — it wins over any group membership, so the
 * safe thing to do when unsure about an entry is mark it private and move on.
 *
 * `encrypted` goes in every bundle, same as `public` — the point is that
 * access is gated by the repo key, not by which audience compiled the
 * bundle, so there is no reason to also restrict it by group.
 */
function decide(entry, audience) {
  const audienceId = kebab(audience);
  const visibility = entry?.visibility || 'private';
  const groups = entry?.groups || [];

  if (visibility === 'private') {
    return { include: false, reason: 'visibility: private (never shared)' };
  }
  if (visibility === 'encrypted') {
    return { include: true, reason: 'visibility: encrypted (repo-key gated, not audience-gated)' };
  }
  if (visibility === 'public') {
    return { include: true, reason: 'visibility: public' };
  }
  if (audienceId === PUBLIC_AUDIENCE) {
    return { include: false, reason: 'public bundle takes public entries only' };
  }
  if (groups.includes(audienceId)) {
    return { include: true, reason: `group match: ${audienceId}` };
  }
  return { include: false, reason: `not in groups [${groups.join(', ') || 'none'}]` };
}

function stripFields(entry, fields) {
  const next = { ...entry };
  for (const field of fields) {
    if (field === 'paths') {
      next.highlights = (next.highlights || []).map((h) => ({ ...h, paths: [] }));
      continue;
    }
    if (field === 'notes') {
      next.highlights = (next.highlights || []).map((h) => ({ ...h, notes: '' }));
      next.avoid = (next.avoid || []).map((a) => ({ ...a, reason: '' }));
      continue;
    }
    if (Array.isArray(next[field])) next[field] = [];
    else if (typeof next[field] === 'string') next[field] = '';
    else delete next[field];
  }
  return next;
}

function redactForAudience(entry, audience) {
  const audienceId = kebab(audience);
  const override = entry?.groupOverrides?.[audienceId] || {};
  const redactions = [...new Set([...(entry.redact || []), ...(override.redact || [])])];

  let next = { ...entry };
  if (override.summary !== undefined) next.summary = override.summary;
  if (override.highlights !== undefined) next.highlights = override.highlights;

  if (redactions.length) next = stripFields(next, redactions);

  for (const field of LOCAL_ONLY_FIELDS) delete next[field];
  delete next.groupOverrides;
  delete next.redact;
  delete next.sources;

  return { entry: next, redactions };
}

/**
 * Produce the artifact you actually hand to a teammate.
 *
 * This is metadata distribution, not access control — GitHub permissions remain
 * the enforcement boundary. The compiler's job is to make accidental oversharing
 * structurally hard, and to show its working via `decisions`.
 */
function compileBundle(entries, { audience, label = '', description = '', repoKeys = new Map() } = {}) {
  const audienceId = kebab(audience);
  if (!audienceId) throw new Error('compileBundle requires an audience');

  const decisions = [];
  const included = [];

  for (const entry of entries) {
    const verdict = decide(entry, audienceId);
    if (!verdict.include) {
      decisions.push({ id: entry.id, included: false, reason: verdict.reason, redactions: [] });
      continue;
    }
    const { entry: redacted, redactions } = redactForAudience(entry, audienceId);

    if (redacted.visibility === 'encrypted') {
      // Already ciphertext (e.g. relayed from a subscription without ever
      // being decrypted locally) — nothing left to seal, and re-sealing
      // would encrypt the empty plaintext view instead of the real payload,
      // silently discarding it. Pass the ciphertext through unchanged.
      if (redacted.encrypted) {
        included.push(redacted);
        decisions.push({ id: entry.id, included: true, reason: 'visibility: encrypted (already sealed, relayed as-is)', redactions: ['encrypted'] });
        continue;
      }
      const key = repoKeys.get(redacted.repo) || repoKeys.get(redacted.id);
      // No key resolved (repo not cloned here, or key generation was never
      // run) — never fall back to shipping it plaintext. Exclude it, same as
      // the `private` kill switch: unsure means don't share.
      if (!key) {
        decisions.push({
          id: entry.id,
          included: false,
          reason: 'visibility: encrypted but no repo key available (run `atlas key generate`)',
          redactions: []
        });
        continue;
      }
      const sealed = sealEntry(redacted, key);
      included.push(sealed);
      decisions.push({ id: entry.id, included: true, reason: verdict.reason, redactions: ['encrypted'] });
      continue;
    }

    included.push(redacted);
    decisions.push({ id: entry.id, included: true, reason: verdict.reason, redactions });
  }

  included.sort((a, b) => a.id.localeCompare(b.id));

  return {
    bundle: {
      schemaVersion: SCHEMA_VERSION,
      audience: audienceId,
      label: label || audienceId,
      description,
      generatedAt: new Date().toISOString(),
      entryCount: included.length,
      entries: included
    },
    decisions,
    counts: {
      total: entries.length,
      included: included.length,
      excluded: decisions.filter((d) => !d.included).length,
      redacted: decisions.filter((d) => d.included && d.redactions.length).length
    }
  };
}

function formatDecisions(decisions, { onlyExcluded = false } = {}) {
  const rows = onlyExcluded ? decisions.filter((d) => !d.included) : decisions;
  return rows
    .map((d) => {
      const mark = d.included ? '+' : '-';
      const redaction = d.redactions.length ? `  (redacted: ${d.redactions.join(', ')})` : '';
      return `${mark} ${d.id.padEnd(32)} ${d.reason}${redaction}`;
    })
    .join('\n');
}

module.exports = {
  PUBLIC_AUDIENCE,
  decide,
  redactForAudience,
  compileBundle,
  formatDecisions
};
