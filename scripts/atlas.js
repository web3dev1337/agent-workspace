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
    const [rawKey, inlineValue] = token.slice(2).split('=');
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

  status() {
    const status = atlas.getStatus();
    out(`atlas dir     ${status.atlasDir}`);
    out(`registry      ${status.registryPath}`);
    out(`scan roots    ${status.scanRoots.join(', ')}`);
    out(`repos         ${status.entryCount} (${status.clonedCount} cloned locally)`);
    out(`highlights    ${status.highlightCount}`);
    out(`audiences     ${status.audiences.join(', ') || 'none configured'}`);
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
        entry.archived ? 'archived' : ''
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
    if (!id || !flags.topic) return fail('usage: atlas note <id> --topic <topic> [--quality 1-5] [--paths a,b] [--notes "..."]');
    const saved = atlas.addHighlight(id, {
      topic: flags.topic,
      quality: flags.quality === undefined ? null : Number(flags.quality),
      paths: listFlag(flags.paths),
      notes: flags.notes === true ? '' : String(flags.notes || '')
    });
    return out(`Recorded: ${saved.id} → ${(saved.highlights || []).map((h) => `${h.topic}:${h.quality ?? '?'}`).join(', ')}`);
  },

  avoid(positionals, flags) {
    const id = positionals[0];
    if (!id || !flags.topic) return fail('usage: atlas avoid <id> --topic <topic> --reason "..."');
    const saved = atlas.addAvoid(id, { topic: flags.topic, reason: flags.reason === true ? '' : flags.reason });
    return out(`Marked do-not-copy: ${saved.id} → ${(saved.avoid || []).map((a) => a.topic).join(', ')}`);
  },

  set(positionals, flags) {
    const id = positionals[0];
    if (!id) return fail('usage: atlas set <id> [--visibility public|team|private] [--groups a,b] [--kind ...] [--status ...] [--summary "..."]');

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
    if (flags.quality !== undefined) patch.quality = Number(flags.quality);

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
        outputPath: flags.out === true ? '' : String(flags.out || '')
      });
      return out(`Audience "${id}" saved. Tag repos into it with \`atlas set <id> --visibility team --groups ${id}\`.`);
    }
    return fail(`unknown audience action "${action}"`);
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

  atlas audience list | add <id> [--label "..."] [--out <path>]
  atlas compile <audience> [--dry-run] [--explain]
  atlas doctor
  atlas init [path] [--visibility ...] [--groups a,b]

filters:    --kind ${KINDS.join('|')}
            --status ${STATUSES.join('|')}
            --platform <p> --group <g> --language <l> --query <text>
            --min-quality N --no-forks --no-archived
values:     maturity ${MATURITIES.join('|')}   visibility ${VISIBILITIES.join('|')}

Sharing model: entries are private by default. \`visibility: public\` goes in every
bundle, \`team\` goes only to audiences listed in its groups, \`private\` never leaves
this machine. Compiled bundles are metadata distribution — GitHub permissions are
still the real access control.`);
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
