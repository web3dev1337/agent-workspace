#!/usr/bin/env node
/**
 * atlas — query and curate the Repo Atlas from anywhere.
 *
 * Runs standalone: no orchestrator server, no network unless you ask it to scan
 * GitHub. Symlink it onto your PATH so every agent session can use it:
 *   ln -s <repo>/scripts/atlas.js ~/.local/bin/atlas
 */

const path = require('path');

const RepoAtlasService = require('../server/repoAtlasService');
const { KINDS, STATUSES, MATURITIES, VISIBILITIES, listCanonicalTopics } = require('../server/atlas/atlasSchema');
const { formatDecisions } = require('../server/atlas/atlasCompiler');

const atlas = RepoAtlasService.getInstance();

// `atlas list | head` closes stdout early; that is a normal end, not a crash.
process.stdout.on('error', (error) => {
  if (error?.code === 'EPIPE') process.exit(0);
  throw error;
});

function parseArgs(argv) {
  const positionals = [];
  const flags = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    // Split on the FIRST '=' only, so a value containing '=' survives
    // (e.g. --notes="a = b" or --evidence="x == y").
    const body = token.slice(2);
    const eq = body.indexOf('=');
    const rawKey = eq === -1 ? body : body.slice(0, eq);
    const inlineValue = eq === -1 ? undefined : body.slice(eq + 1);
    const key = rawKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (inlineValue !== undefined) {
      flags[key] = inlineValue;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    i += 1;
  }

  return { positionals, flags };
}

const listFlag = (value) => String(value === true ? '' : value || '')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);

// A value-less `--quality` (parsed as `true`) or a non-number must not be
// silently coerced to a score — Number(true) is 1, the worst rating.
// Returns null for "not given", a number, or a QUALITY_INVALID sentinel.
const QUALITY_INVALID = Symbol('quality-invalid');
const qualityFlag = (value) => {
  if (value === undefined) return null;
  if (value === true) return QUALITY_INVALID;
  const num = Number(value);
  return Number.isFinite(num) ? num : QUALITY_INVALID;
};

// A value-less `--topic` parses as boolean `true`, which passes a truthiness
// usage check and would be recorded as the literal topic "true". Only a
// non-empty string counts as a given topic.
const topicFlag = (value) => (typeof value === 'string' && value.trim() ? value : null);

const out = (text) => process.stdout.write(`${text}\n`);
const fail = (message) => {
  process.stderr.write(`atlas: ${message}\n`);
  process.exitCode = 1;
};

function printJson(value) {
  out(JSON.stringify(value, null, 2));
}

const commands = {
  async scan(_positionals, flags) {
    out('Scanning… (local git repos + gh repo list)');
    const result = await atlas.refresh({
      scanGitHub: flags.noGithub !== true && flags.github !== 'false',
      owner: flags.owner === true ? '' : String(flags.owner || ''),
      limit: Number(flags.limit) || 300
    });
    out(`roots      ${result.roots.join(', ')}`);
    out(`local      ${result.localCount}`);
    out(`github     ${result.githubAvailable ? result.githubCount : 'unavailable (is `gh` installed and authed?)'}`);
    out(`total      ${result.totalCount} repos on the map`);
    out('');
    out('Next: `atlas doctor` to see what needs curating, `atlas note <id> --topic X --quality N` to record what a repo is good at.');
  },

  async status() {
    const status = atlas.getStatus();
    out(`atlas dir     ${status.atlasDir}`);
    out(`registry      ${status.registryDir}`);
    out(`scan roots    ${status.scanRoots.join(', ')}`);
    out(`repos         ${status.entryCount} (${status.clonedCount} cloned locally, ${status.curatedCount} curated)`);
    out(`highlights    ${status.highlightCount}`);
    if (status.lockedCount) out(`locked        ${status.lockedCount} encrypted entries you can't read yet — try \`atlas key sync\``);
    out(`audiences     ${status.audiences.join(', ') || 'none configured'}`);
    out(`remote        ${status.remote || 'not configured — run `atlas remote set <git-url>`'}`);
    if (status.subscriptions.length) {
      out(`subscribed    ${status.subscriptions.map((s) => `${s.name} (${s.entryCount})`).join(', ')}`);
    }

    const git = await atlas.getSyncStatus();
    if (git.tracked) {
      const pending = [git.dirty ? 'uncommitted changes' : '', git.unpushed ? `${git.unpushed} unpushed` : '']
        .filter(Boolean).join(', ');
      out(`sync          ${git.branch}${pending ? ` — ${pending}` : ' — up to date'}`);
    } else {
      out('sync          not tracked in git yet');
    }
    if (!status.discovery) {
      out('discovery     never run — start with `atlas scan`');
    } else {
      out(`discovery     ${status.discovery.generatedAt}${status.discovery.stale ? ' (stale — rerun `atlas scan`)' : ''}`);
    }
  },

  list(_positionals, flags) {
    const entries = atlas.search({
      kind: flags.kind === true ? '' : flags.kind,
      platform: flags.platform === true ? '' : flags.platform,
      group: flags.group === true ? '' : flags.group,
      status: flags.status === true ? '' : flags.status,
      language: flags.language === true ? '' : flags.language,
      query: flags.query === true ? '' : flags.query,
      minQuality: flags.minQuality,
      includeForks: flags.noForks !== true,
      includeArchived: flags.noArchived !== true
    });

    if (flags.json) return printJson(entries);
    if (!entries.length) return out('No repos matched.');

    for (const entry of entries) {
      const marks = [
        entry.cloned ? 'local' : 'remote',
        entry.isFork ? 'fork' : '',
        entry.archived ? 'archived' : '',
        entry.visibility === 'encrypted' && entry.locked ? 'locked' : ''
      ].filter(Boolean).join('/');
      const highlights = (entry.highlights || []).map((h) => `${h.topic}:${h.quality ?? '?'}`).join(' ');
      out(`${entry.id.padEnd(34)} ${String(entry.kind || '').padEnd(10)} ${marks.padEnd(16)} ${highlights}`);
    }
    out('');
    out(`${entries.length} repos`);
    return undefined;
  },

  show(positionals, flags) {
    const id = positionals[0];
    if (!id) return fail('usage: atlas show <id>');
    const entry = atlas.getEntry(id);
    if (!entry) return fail(`no repo "${id}" on the map (try \`atlas list --query ${id}\`)`);
    return flags.json ? printJson(entry) : out(atlas.describe(id));
  },

  find(positionals, flags) {
    const topic = positionals[0];
    if (!topic) return fail('usage: atlas find <topic> [--min-quality N]');

    const hits = atlas.find(topic, {
      minQuality: flags.minQuality,
      includeAvoided: flags.includeAvoided === true
    });
    if (flags.json) return printJson(hits);
    if (!hits.length) {
      out(`Nothing recorded for "${topic}".`);
      out('Known topics: ' + atlas.topics().map((t) => t.topic).join(', '));
      return undefined;
    }

    for (const hit of hits) {
      const where = hit.cloned ? hit.localPath : (hit.remoteUrl || 'not cloned');
      out(`${String(hit.quality ?? '?')}/5  ${hit.id}${hit.stale ? ' ⚠old' : ''}`);
      if (hit.notes) out(`     ${hit.notes}`);
      if (hit.paths?.length) out(`     paths: ${hit.paths.join(', ')}`);
      if (hit.caveat) out(`     caveat: ${hit.caveat}`);
      out(`     ${where}`);
    }
    return undefined;
  },

  topics(_positionals, flags) {
    if (flags.vocabulary) {
      for (const topic of listCanonicalTopics()) out(`${topic.id.padEnd(20)} ${topic.label}`);
      return undefined;
    }
    const index = atlas.topics();
    if (flags.json) return printJson(index);
    if (!index.length) return out('No topics recorded yet. Use `atlas note <id> --topic X --quality N`.');
    for (const row of index) {
      out(`${row.topic.padEnd(20)} best ${row.best}/5   ${row.repos.join(', ')}`);
    }
    return undefined;
  },

  digest(_positionals, flags) {
    const text = atlas.digest({
      groupBy: flags.groupBy === true ? 'platform' : (flags.groupBy || 'platform'),
      maxPerBucket: Number(flags.max) || 8,
      onlyWithHighlights: flags.all !== true
    });
    out(text || 'Nothing to digest yet — record some highlights with `atlas note`.');
  },

  note(positionals, flags) {
    const id = positionals[0];
    const topic = topicFlag(flags.topic);
    if (!id || !topic) return fail('usage: atlas note <id> --topic <topic> [--quality 1-5] [--paths a,b] [--notes "..."]');
    const quality = qualityFlag(flags.quality);
    if (quality === QUALITY_INVALID) return fail('--quality needs a number 1-5');
    const saved = atlas.addHighlight(id, {
      topic,
      quality,
      paths: listFlag(flags.paths),
      notes: flags.notes === true ? '' : String(flags.notes || '')
    });
    return out(`Recorded: ${saved.id} → ${(saved.highlights || []).map((h) => `${h.topic}:${h.quality ?? '?'}`).join(', ')}`);
  },

  avoid(positionals, flags) {
    const id = positionals[0];
    const topic = topicFlag(flags.topic);
    if (!id || !topic) return fail('usage: atlas avoid <id> --topic <topic> --reason "..."');
    const saved = atlas.addAvoid(id, { topic, reason: flags.reason === true ? '' : flags.reason });
    return out(`Marked do-not-copy: ${saved.id} → ${(saved.avoid || []).map((a) => a.topic).join(', ')}`);
  },

  set(positionals, flags) {
    const id = positionals[0];
    if (!id) return fail('usage: atlas set <id> [--visibility public|team|private|encrypted] [--groups a,b] [--kind ...] [--status ...] [--summary "..."]');

    const patch = {};
    if (flags.visibility) patch.visibility = flags.visibility;
    if (flags.groups !== undefined) patch.groups = listFlag(flags.groups);
    if (flags.kind) patch.kind = flags.kind;
    if (flags.status) patch.status = flags.status;
    if (flags.maturity) patch.maturity = flags.maturity;
    if (flags.dimension) patch.dimension = flags.dimension;
    if (flags.summary) patch.summary = String(flags.summary);
    if (flags.platforms !== undefined) patch.platforms = listFlag(flags.platforms);
    if (flags.tags !== undefined) patch.tags = listFlag(flags.tags);
    if (flags.redact !== undefined) patch.redact = listFlag(flags.redact);
    if (flags.quality !== undefined) {
      const quality = qualityFlag(flags.quality);
      if (quality === QUALITY_INVALID) return fail('--quality needs a number 1-5');
      patch.quality = quality;
    }

    if (!Object.keys(patch).length) return fail('nothing to set');
    const saved = atlas.setEntry(id, patch);
    return out(`Updated ${saved.id}: ${Object.keys(patch).join(', ')}`);
  },

  audience(positionals, flags) {
    const action = positionals[0] || 'list';
    if (action === 'list') {
      const audiences = atlas.listAudiences();
      if (!audiences.length) return out('No audiences yet. Add one: `atlas audience add core-team --label "Core team"`');
      for (const audience of audiences) {
        out(`${audience.id.padEnd(20)} ${audience.label}${audience.outputPath ? `  → ${audience.outputPath}` : ''}`);
      }
      return undefined;
    }
    if (action === 'add') {
      const id = positionals[1];
      if (!id) return fail('usage: atlas audience add <id> [--label "..."] [--out <path>]');
      atlas.setAudience({
        id,
        label: flags.label === true ? '' : String(flags.label || ''),
        description: flags.description === true ? '' : String(flags.description || ''),
        outputPath: flags.out === true ? '' : String(flags.out || ''),
        outputRemote: flags.outRemote === true ? '' : String(flags.outRemote || '')
      });
      return out(`Audience "${id}" saved. Tag repos into it with \`atlas set <id> --visibility team --groups ${id}\`.`);
    }
    return fail(`unknown audience action "${action}"`);
  },

  async key(positionals, flags) {
    const action = positionals[0];

    if (action === 'generate') {
      const id = positionals[1];
      if (!id) return fail('usage: atlas key generate <id> [--rotate]');
      const result = atlas.generateRepoKey(id, { rotate: flags.rotate === true });
      if (!result.generated) {
        out(`"${id}" already has a repo key (${result.path}). Pass --rotate to replace it.`);
        return undefined;
      }
      out(`${result.rotated ? 'Rotated' : 'Generated'} the repo key for "${id}": ${result.path}`);
      out('Commit and push that file — anyone with access to this repo can now decrypt its atlas entry.');
      if (result.rotated) out('Anyone who cached the old key can still read bundles compiled before this rotation.');
      return undefined;
    }

    if (action === 'show') {
      const id = positionals[1];
      if (!id) return fail('usage: atlas key show <id>');
      const key = atlas.getRepoKey(id);
      if (!key) {
        out(`No key resolved for "${id}" yet. If it's yours: \`atlas key generate ${id}\`. If it was shared with you: \`atlas key sync\`.`);
        return undefined;
      }
      out(key);
      return undefined;
    }

    if (action === 'sync' || !action) {
      out('Resolving keys for anything you can currently decrypt (cache, local clones, `gh api` for repos you have access to)…');
      const result = await atlas.unlockEncrypted();
      out(`${result.unlocked}/${result.checked} unlocked${result.stillLocked.length ? `. Still locked: ${result.stillLocked.join(', ')}` : '.'}`);
      return undefined;
    }

    return fail(`unknown key action "${action}"`);
  },

  propose(positionals, flags) {
    const id = positionals[0];
    const topic = topicFlag(flags.topic);
    if (!id || !topic) {
      return fail('usage: atlas propose <repo-id> --topic <topic> [--quality 1-5] [--paths a,b] [--notes "..."] [--evidence "why"] [--avoid]');
    }
    const quality = qualityFlag(flags.quality);
    if (quality === QUALITY_INVALID) return fail('--quality needs a number 1-5');
    const proposal = atlas.proposeHighlight({
      repoId: id,
      topic,
      kind: flags.avoid === true ? 'avoid' : 'highlight',
      quality,
      paths: listFlag(flags.paths),
      notes: flags.notes === true ? '' : String(flags.notes || ''),
      evidence: flags.evidence === true ? '' : String(flags.evidence || ''),
      proposedBy: flags.by === true ? 'agent' : String(flags.by || 'agent')
    });
    out(`Proposed ${proposal.kind} ${proposal.repoId} ${proposal.topic}${proposal.quality ? `:${proposal.quality}` : ''} — waiting for review.`);
    return undefined;
  },

  proposals(positionals, flags) {
    const action = positionals[0] || 'list';

    if (action === 'list') {
      const list = atlas.listProposals({ status: flags.status === true ? 'pending' : (flags.status || 'pending') });
      if (flags.json) return printJson(list);
      if (!list.length) return out('No proposals waiting.');
      for (const p of list) {
        out(`${p.id}`);
        out(`   ${p.kind} ${p.quality ? `${p.quality}/5` : ''} by ${p.proposedBy}  ${p.proposedAt.slice(0, 16).replace('T', ' ')}`);
        if (p.notes) out(`   ${p.notes}`);
        if (p.evidence) out(`   evidence: ${p.evidence}`);
        if (p.paths?.length) out(`   paths: ${p.paths.join(', ')}`);
      }
      out('');
      out(`${list.length} waiting — \`atlas proposals approve <id>\` or \`reject <id>\``);
      return undefined;
    }

    if (action === 'approve' || action === 'reject') {
      const id = positionals[1];
      if (!id) return fail(`usage: atlas proposals ${action} <id> [--note "..."]`);
      const note = flags.note === true ? '' : String(flags.note || '');
      const result = action === 'approve' ? atlas.approveProposal(id, { note }) : atlas.rejectProposal(id, { note });
      if (!result.ok) return fail(result.error);
      return out(action === 'approve' ? `Approved and written to the registry: ${id}` : `Rejected: ${id}`);
    }

    if (action === 'clear') {
      return out(`Cleared decided proposals; ${atlas.clearDecidedProposals()} still waiting.`);
    }
    return fail(`unknown proposals action "${action}"`);
  },

  async remote(positionals, flags) {
    const action = positionals[0];
    if (action === 'set') {
      const url = positionals[1];
      if (!url) return fail('usage: atlas remote set <git-url>');
      await atlas.setRemote(url);
      out(`Registry remote set to ${url}.`);
      out('Run `atlas sync` to push your curated entries and pull anything from your other machines.');
      return undefined;
    }
    const status = await atlas.getSyncStatus();
    out(`remote  ${status.remote || 'not configured'}`);
    out(`dir     ${status.dir}`);
    if (status.tracked) out(`branch  ${status.branch}${status.dirty ? ' (dirty)' : ''}`);
    return undefined;
  },

  async sync(_positionals, flags) {
    out('Syncing registry…');
    const result = await atlas.sync({ message: flags.message === true ? '' : String(flags.message || '') });
    for (const step of result.steps || []) {
      out(`  ${step.step.padEnd(14)} ${step.ok === false ? 'failed' : 'ok'}${step.detail ? ` — ${String(step.detail).split('\n')[0]}` : ''}`);
    }
    if (!result.ok) return fail(result.error);
    out(`Synced ${result.entryCount} curated entries with ${result.remote} (${result.branch}).`);
    return undefined;
  },

  async publish(positionals, flags) {
    const audience = positionals[0];
    if (!audience) return fail('usage: atlas publish <audience> [--no-push]');

    const result = await atlas.publish(audience, { push: flags.noPush !== true });
    out(`${audience}: ${result.counts.included} shared / ${result.counts.excluded} withheld / ${result.counts.redacted} partly redacted`);
    if (result.published?.error) return fail(result.published.error);
    out(`wrote ${result.published.path}`);
    if (result.published.committed) out(result.published.pushed ? 'committed and pushed' : 'committed (push failed)');
    return undefined;
  },

  async subscribe(positionals, flags) {
    const action = positionals[0];
    if (action === 'list' || !action) {
      const subs = atlas.listSubscriptions();
      if (!subs.length) return out('No subscriptions. Add one: `atlas subscribe add <name> <path-or-git-url>`');
      for (const sub of subs) out(`${sub.name.padEnd(20)} ${sub.entryCount} repos   ${sub.generatedAt || ''}`);
      return undefined;
    }
    if (action === 'add') {
      const [, name, source] = positionals;
      if (!name || !source) return fail('usage: atlas subscribe add <name> <path-or-git-url>');
      const result = await atlas.subscribe({ name, source });
      return out(`Subscribed to ${result.name} — ${result.entryCount} repos now searchable (marked as theirs).`);
    }
    if (action === 'remove') {
      const name = positionals[1];
      if (!name) return fail('usage: atlas subscribe remove <name>');
      return out(atlas.unsubscribe(name) ? `Removed ${name}.` : `No subscription "${name}".`);
    }
    return fail(`unknown subscribe action "${action}"`);
  },

  compile(positionals, flags) {
    const audience = positionals[0];
    if (!audience) return fail('usage: atlas compile <audience> [--dry-run] [--explain]');

    const result = atlas.compile(audience, { write: flags.dryRun !== true });
    out(`${audience}: ${result.counts.included} shared / ${result.counts.excluded} withheld / ${result.counts.redacted} partly redacted`);
    if (flags.explain || flags.dryRun) {
      out('');
      out(formatDecisions(result.decisions, { onlyExcluded: flags.onlyExcluded === true }));
    }
    if (flags.dryRun) {
      out('');
      out('Dry run — nothing written.');
    } else {
      out('');
      for (const file of result.written) out(`wrote ${file}`);
    }
    return undefined;
  },

  doctor() {
    const report = atlas.validate();
    out(`${report.entryCount} repos, ${report.curatedCount} curated, ${report.withHighlights} with highlights`);

    if (report.errors.length) {
      out('');
      out('Errors:');
      for (const row of report.errors) out(`  ${row.id}: ${row.errors.join('; ')}`);
    }
    if (report.warnings.length) {
      out('');
      out(`Warnings (${report.warnings.length}):`);
      for (const row of report.warnings.slice(0, 20)) out(`  ${row.id}: ${row.warnings.join('; ')}`);
      if (report.warnings.length > 20) out(`  … and ${report.warnings.length - 20} more`);
    }
    if (!report.errors.length && !report.warnings.length) out('Everything checks out.');
  },

  init(positionals, flags) {
    const target = path.resolve(positionals[0] || process.cwd());
    const result = atlas.initManifest(target, {
      visibility: flags.visibility === true ? 'private' : (flags.visibility || 'private'),
      groups: listFlag(flags.groups)
    });
    out(`Wrote ${result.path}`);
    out('Fill in `summary`, `highlights` (topic + quality + paths) and `visibility`, then commit it.');
  },

  help() {
    out(`atlas — the map of every repo you own

  atlas scan [--no-github] [--owner X]     rebuild the map from disk + GitHub
  atlas status                             where things live, how fresh they are
  atlas list [filters] [--json]            list repos
  atlas show <id> [--json]                 everything known about one repo
  atlas find <topic> [--min-quality N]     who did this well? (the main query)
  atlas topics [--vocabulary]              topics in use / canonical vocabulary
  atlas digest [--group-by kind] [--max N] compact map to paste into a prompt

  atlas note <id> --topic X [--quality N] [--paths a,b] [--notes "..."]
  atlas avoid <id> --topic X --reason "..."
  atlas set <id> [--visibility ...] [--groups a,b] [--kind ...] [--summary "..."]

  atlas audience list | add <id> [--label "..."] [--out <path>] [--out-remote <git-url>]
  atlas compile <audience> [--dry-run] [--explain]

encrypted sharing (repo access, not audience membership, gates decryption):
  atlas set <id> --visibility encrypted   goes in every bundle, sealed to the repo's key
  atlas key generate <id> [--rotate]      create/rotate that repo's key — commit the file it writes
  atlas key show <id>                     print a key you already have
  atlas key sync                          fetch keys (via \`gh\`) for anything you now have repo access to

write-back (agents propose, you decide):
  atlas propose <id> --topic X [--quality N] [--notes "..."] [--evidence "why"] [--avoid]
  atlas proposals [list|approve <id>|reject <id>|clear] [--status all]

multi-machine:
  atlas remote set <git-url>               track the registry in a PRIVATE git repo
  atlas sync [--message "..."]             pull + merge + push your curated entries
  atlas publish <audience> [--no-push]     compile a bundle and commit it where that audience can read it
  atlas subscribe add <name> <path|url>    read someone else's published bundle
  atlas subscribe list | remove <name>
  atlas doctor
  atlas init [path] [--visibility ...] [--groups a,b]

filters:    --kind ${KINDS.join('|')}
            --status ${STATUSES.join('|')}
            --platform <p> --group <g> --language <l> --query <text>
            --min-quality N --no-forks --no-archived
values:     maturity ${MATURITIES.join('|')}   visibility ${VISIBILITIES.join('|')}

Sharing model: entries are private by default. \`visibility: public\` goes in every
bundle, \`team\` goes only to audiences listed in its groups, \`private\` never leaves
this machine, \`encrypted\` goes in every bundle too but sealed to that repo's own
key — decrypting it needs GitHub access to the repo it describes, not audience
membership. Compiled (non-encrypted) bundles are still metadata distribution —
GitHub permissions on wherever you publish them remain the real access control.
Encrypted entries add a second lock on top of that: even someone who can read the
bundle file itself cannot read a sealed entry without also having repo access.

Multi-machine: your registry (judgement, portable) lives in a PRIVATE git repo,
one file per repo so machines never conflict. Discovery (what this computer has
cloned) stays local and is never synced. Audience bundles are published into
whichever shared repo that audience already has access to.`);
  }
};

async function main() {
  const [, , rawCommand, ...rest] = process.argv;
  const command = rawCommand || 'help';
  const handler = commands[command];

  if (!handler) {
    fail(`unknown command "${command}" — try \`atlas help\``);
    return;
  }

  const { positionals, flags } = parseArgs(rest);
  try {
    await handler(positionals, flags);
  } catch (error) {
    fail(error?.message || String(error));
  }
}

main();
