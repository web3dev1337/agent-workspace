#!/usr/bin/env node
/* eslint-disable no-console */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {
    scope: 'all', // all | recent | added
    sinceDays: 7,
    out: null,
    format: null, // markdown | json
    actionableOnly: false
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scope') {
      args.scope = String(argv[++i] || '').trim() || 'all';
      continue;
    }
    if (a.startsWith('--scope=')) {
      args.scope = a.split('=').slice(1).join('=').trim() || 'all';
      continue;
    }
    if (a === '--since-days') {
      args.sinceDays = Number(argv[++i] || 7);
      continue;
    }
    if (a.startsWith('--since-days=')) {
      args.sinceDays = Number(a.split('=').slice(1).join('=') || 7);
      continue;
    }
    if (a === '--out') {
      args.out = String(argv[++i] || '').trim() || null;
      continue;
    }
    if (a.startsWith('--out=')) {
      args.out = a.split('=').slice(1).join('=').trim() || null;
      continue;
    }
    if (a === '--output') {
      args.out = String(argv[++i] || '').trim() || null;
      continue;
    }
    if (a.startsWith('--output=')) {
      args.out = a.split('=').slice(1).join('=').trim() || null;
      continue;
    }
    if (a === '--format') {
      args.format = String(argv[++i] || '').trim().toLowerCase() || null;
      continue;
    }
    if (a.startsWith('--format=')) {
      args.format = a.split('=').slice(1).join('=').trim().toLowerCase() || null;
      continue;
    }
    if (a === '--json') {
      args.format = 'json';
      continue;
    }
    if (a === '--actionable-only') {
      args.actionableOnly = true;
      continue;
    }
  }

  if (!['all', 'recent', 'added'].includes(args.scope)) {
    throw new Error(`Invalid --scope: ${args.scope} (expected all|recent|added)`);
  }
  if (!Number.isFinite(args.sinceDays) || args.sinceDays <= 0) {
    throw new Error(`Invalid --since-days: ${args.sinceDays}`);
  }
  if (args.format && !['markdown', 'md', 'json'].includes(args.format)) {
    throw new Error(`Invalid --format: ${args.format} (expected markdown|json)`);
  }

  return args;
}

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function listMarkdownFiles({ scope, sinceDays }) {
  if (scope === 'all') {
    const out = sh("git ls-files -- '*.md'");
    return out.split('\n').map(s => s.trim()).filter(Boolean);
  }

  const since = `${sinceDays} days ago`;
  const base = scope === 'added'
    ? `git log --since="${since}" --diff-filter=A --name-only --pretty=format: -- "*.md"`
    : `git log --since="${since}" --name-only --pretty=format: -- "*.md"`;
  const out = sh(base);
  return Array.from(new Set(out.split('\n').map(s => s.trim()).filter(Boolean))).sort();
}

function scanMarkdown(filePath, content) {
  const unchecked = [];
  const todoFixme = [];
  const remainingSections = [];

  const lines = content.split('\n');
  let inCodeBlock = false;

  const headingRe = /^(#{1,6})\s+(.*)$/;
  const remainingHeadingRe = /(what'?s\s+left|what\s+is\s+left|remaining|still\s+missing|open\s+items|next(\s+steps)?|to\s+do)\b/i;
  const bulletRe = /^\s*[-*]\s+(.+)$/;
  const numberedRe = /^\s*\d+[.)]\s+(.+)$/;

  let activeSection = null;
  const flushSection = () => {
    if (activeSection && activeSection.items.length) remainingSections.push(activeSection);
    activeSection = null;
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNo = idx + 1;
    const line = lines[idx];
    const trimmed = String(line || '').trim();

    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    const m = line.match(/^\s*[-*]\s+\[ \]\s+(.*)$/);
    if (m) {
      unchecked.push({ line: lineNo, text: (m[1] || '').trim() });
    }

    if (/\bTODO\b|\bFIXME\b/i.test(line)) {
      todoFixme.push({ line: lineNo, text: line.trim() });
    }

    if (inCodeBlock) continue;

    const headingMatch = headingRe.exec(line);
    if (headingMatch) {
      flushSection();
      const level = headingMatch[1].length;
      const headingText = String(headingMatch[2] || '').trim();
      if (remainingHeadingRe.test(headingText)) {
        activeSection = {
          line: lineNo,
          level,
          heading: headingText,
          items: []
        };
      }
      continue;
    }

    if (activeSection) {
      const bullet = bulletRe.exec(line);
      const numbered = numberedRe.exec(line);
      const itemText = bullet ? bullet[1] : (numbered ? numbered[1] : null);
      if (itemText) {
        const asText = String(itemText || '').trim();
        // Don't double-count explicit checkbox items: those are tracked separately.
        if (!/^\[ \]\s+/i.test(asText) && !/^\[x\]\s+/i.test(asText)) {
          activeSection.items.push({ line: lineNo, text: asText });
        }
      }
    }
  }

  flushSection();

  const isTemplate =
    /\/CHECKLIST\.md$/i.test(filePath) ||
    /\/CHECKLISTS?\//i.test(filePath) ||
    /\/OPTIMAL_ORCHESTRATOR_PROCESS\.md$/i.test(filePath);
  const isNonBacklogDoc =
    /^ai-memory\//i.test(filePath) ||
    /^scripts\/README\.md$/i.test(filePath) ||
    /^WINDOWS_.*GUIDE\.md$/i.test(filePath) ||
    /^PUBLIC_RELEASE_AUDIT_.*\.md$/i.test(filePath);
  const isGeneratedScan =
    /\/REMAINING_WORK_.*(SCAN|FULL)\.md$/i.test(filePath) ||
    /\/REMAINING_MARKDOWNS_.*SCAN\.md$/i.test(filePath) ||
    /\/REMAINING_WORK_FROM_.*\.md$/i.test(filePath);
  const isPlanish = /^PLANS\//.test(filePath);
  const isLikelyTemplate = isTemplate || isNonBacklogDoc || (/COWORKER_SETUP_GUIDE\.md$/i.test(filePath) && isPlanish);
  let classification = 'doc/backlog';
  if (isLikelyTemplate) classification = 'template/guide';
  if (isGeneratedScan) classification = 'generated-scan';

  return {
    filePath,
    unchecked,
    todoFixme,
    remainingSections,
    remainingCount: unchecked.length + todoFixme.length + remainingSections.reduce((acc, s) => acc + (s?.items?.length || 0), 0),
    classification
  };
}

function mdEscape(s) {
  return String(s || '').replace(/`/g, '\\`');
}

function resolveOutputFormat(args, outPath) {
  const requested = String(args?.format || '').trim().toLowerCase();
  if (requested === 'json') return 'json';
  if (requested === 'markdown' || requested === 'md') return 'markdown';
  if (outPath && /\.json$/i.test(String(outPath))) return 'json';
  return 'markdown';
}

function buildSummary(files) {
  const scanned = files.length;
  const withRemaining = files.filter(f => f.remainingCount > 0);
  const withoutRemaining = files.filter(f => f.remainingCount === 0);
  return {
    scanned,
    withRemaining: withRemaining.length,
    withoutRemaining: withoutRemaining.length
  };
}

function filterScansForActionable(files) {
  return (Array.isArray(files) ? files : []).filter((scan) => {
    if (!scan || scan.classification !== 'doc/backlog') return false;
    const explicitCount = Number(scan?.unchecked?.length || 0) + Number(scan?.todoFixme?.length || 0);
    return explicitCount > 0;
  });
}

function renderJsonReport({ scope, sinceDays, files, actionableOnly = false }) {
  const summary = buildSummary(files);
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    scope,
    sinceDays: Number(sinceDays),
    actionableOnly: actionableOnly === true,
    summary,
    filesWithRemaining: files
      .filter(f => f.remainingCount > 0)
      .sort((a, b) => b.remainingCount - a.remainingCount || a.filePath.localeCompare(b.filePath)),
    filesWithoutRemaining: files
      .filter(f => f.remainingCount === 0)
      .map(f => f.filePath)
      .sort((a, b) => a.localeCompare(b))
  }, null, 2);
}

function renderReport({ scope, sinceDays, files, actionableOnly = false }) {
  const stamp = new Date().toISOString().slice(0, 10);

  const withRemaining = files.filter(f => f.remainingCount > 0);
  const withoutRemaining = files.filter(f => f.remainingCount === 0);
  const summary = buildSummary(files);

  const lines = [];
  lines.push(`# Remaining work from markdowns (${scope})`);
  lines.push('');
  lines.push(`Generated (UTC): ${stamp}`);
  lines.push('');
  lines.push('Sort: files with remaining items first; files with no remaining items at the bottom.');
  lines.push('');
  lines.push('Detection:');
  lines.push('- Unchecked task list items: `- [ ] ...` (and `* [ ] ...`)');
  lines.push('- `TODO` / `FIXME` tokens (case-insensitive)');
  lines.push('- Heuristic “remaining” sections: headings like “What’s left / Remaining / Still missing / Next steps / To do”, followed by bullet/numbered items');
  lines.push('');
  if (scope !== 'all') {
    lines.push(`Scope: markdown files ${scope === 'added' ? 'added' : 'touched'} in the last ${sinceDays} days via git history.`);
    lines.push('');
  } else {
    lines.push('Scope: all tracked markdown files (`git ls-files \"*.md\"`).');
    lines.push('');
  }
  if (actionableOnly === true) {
    lines.push('Actionable filter: enabled (`doc/backlog` files with explicit markers only: unchecked and/or TODO/FIXME).');
    lines.push('');
  }

  lines.push('## Summary');
  lines.push(`- Scanned: ${summary.scanned}`);
  lines.push(`- With remaining markers: ${summary.withRemaining}`);
  lines.push(`- With no remaining markers: ${summary.withoutRemaining}`);
  lines.push('');

  lines.push('## Files with remaining items');
  if (withRemaining.length === 0) {
    lines.push('');
    lines.push('None.');
  } else {
    const sorted = withRemaining
      .slice()
      .sort((a, b) => b.remainingCount - a.remainingCount || a.filePath.localeCompare(b.filePath));
    for (const f of sorted) {
      lines.push('');
      lines.push(`### \`${mdEscape(f.filePath)}\``);
      lines.push('');
      lines.push(`- Remaining markers: ${f.remainingCount} (unchecked: ${f.unchecked.length}, TODO/FIXME: ${f.todoFixme.length})`);
      lines.push(`- Classification: ${f.classification}`);

      if (f.unchecked.length) {
        lines.push('');
        lines.push('**Unchecked**');
        for (const item of f.unchecked) {
          lines.push(`- ${f.filePath}:${item.line} — ${mdEscape(item.text)}`);
        }
      }

      if (f.todoFixme.length) {
        lines.push('');
        lines.push('**TODO/FIXME**');
        for (const item of f.todoFixme) {
          lines.push(`- ${f.filePath}:${item.line} — ${mdEscape(item.text)}`);
        }
      }

      if (Array.isArray(f.remainingSections) && f.remainingSections.some(s => s && Array.isArray(s.items) && s.items.length)) {
        lines.push('');
        lines.push('**Heuristic “Remaining” sections**');
        for (const section of f.remainingSections) {
          if (!section?.items?.length) continue;
          lines.push(`- ${f.filePath}:${section.line} — ${mdEscape(section.heading)}`);
          for (const item of section.items) {
            lines.push(`  - ${f.filePath}:${item.line} — ${mdEscape(item.text)}`);
          }
        }
      }
    }
  }

  lines.push('');
  lines.push('## Files with no remaining items');
  if (withoutRemaining.length === 0) {
    lines.push('');
    lines.push('None.');
  } else {
    for (const f of withoutRemaining.sort((a, b) => a.filePath.localeCompare(b.filePath))) {
      lines.push(`- \`${mdEscape(f.filePath)}\``);
    }
  }

  lines.push('');
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const repoRoot = sh('git rev-parse --show-toplevel').trim();
  process.chdir(repoRoot);

  const outPath = args.out ? path.resolve(args.out) : null;
  const outRel = outPath ? path.relative(repoRoot, outPath) : null;

  const mdFiles = listMarkdownFiles({ scope: args.scope, sinceDays: args.sinceDays })
    .filter((filePath) => {
      // Avoid self-referential scan reports (they contain literal "TODO/FIXME" tokens).
      if (/^PLANS\/.*\/REMAINING_WORK_.*\.md$/i.test(filePath)) return false;
      if (/^PLANS\/.*\/REMAINING_WORK_SCAN_.*\.md$/i.test(filePath)) return false;
      if (/^PLANS\/.*\/REMAINING_WORK_FROM_.*\.md$/i.test(filePath)) return false;
      // Also exclude the file we're writing in this run (if it's tracked already).
      if (outRel && filePath === outRel) return false;
      return true;
    });
  const scans = mdFiles
    .map((filePath) => {
      const abs = path.join(repoRoot, filePath);
      const content = fs.readFileSync(abs, 'utf8');
      return scanMarkdown(filePath, content);
    });
  const filesForReport = args.actionableOnly ? filterScansForActionable(scans) : scans;

  const format = resolveOutputFormat(args, outPath);
  const report = format === 'json'
    ? renderJsonReport({ scope: args.scope, sinceDays: args.sinceDays, files: filesForReport, actionableOnly: args.actionableOnly })
    : renderReport({ scope: args.scope, sinceDays: args.sinceDays, files: filesForReport, actionableOnly: args.actionableOnly });

  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, report, 'utf8');
    console.log(`Wrote ${outPath}`);
    return;
  }

  process.stdout.write(report);
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  scanMarkdown,
  renderReport,
  renderJsonReport,
  resolveOutputFormat,
  filterScansForActionable
};
