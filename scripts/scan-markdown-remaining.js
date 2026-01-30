#!/usr/bin/env node
/* eslint-disable no-console */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {
    scope: 'all', // all | recent | added
    sinceDays: 7,
    out: null
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
  }

  if (!['all', 'recent', 'added'].includes(args.scope)) {
    throw new Error(`Invalid --scope: ${args.scope} (expected all|recent|added)`);
  }
  if (!Number.isFinite(args.sinceDays) || args.sinceDays <= 0) {
    throw new Error(`Invalid --since-days: ${args.sinceDays}`);
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

  const lines = content.split('\n');
  for (let idx = 0; idx < lines.length; idx++) {
    const lineNo = idx + 1;
    const line = lines[idx];

    const m = line.match(/^\s*[-*]\s+\[ \]\s+(.*)$/);
    if (m) {
      unchecked.push({ line: lineNo, text: (m[1] || '').trim() });
    }

    if (/\bTODO\b|\bFIXME\b/i.test(line)) {
      todoFixme.push({ line: lineNo, text: line.trim() });
    }
  }

  const isTemplate =
    /\/CHECKLIST\.md$/i.test(filePath) ||
    /\/CHECKLISTS?\//i.test(filePath) ||
    /\/OPTIMAL_ORCHESTRATOR_PROCESS\.md$/i.test(filePath);
  const isPlanish = /^PLANS\//.test(filePath);
  const isLikelyTemplate = isTemplate || (/COWORKER_SETUP_GUIDE\.md$/i.test(filePath) && isPlanish);

  return {
    filePath,
    unchecked,
    todoFixme,
    remainingCount: unchecked.length + todoFixme.length,
    classification: isLikelyTemplate ? 'template/guide' : 'doc/backlog'
  };
}

function mdEscape(s) {
  return String(s || '').replace(/`/g, '\\`');
}

function renderReport({ scope, sinceDays, files }) {
  const stamp = new Date().toISOString().slice(0, 10);

  const scanned = files.length;
  const withRemaining = files.filter(f => f.remainingCount > 0);
  const withoutRemaining = files.filter(f => f.remainingCount === 0);

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
  lines.push('');
  if (scope !== 'all') {
    lines.push(`Scope: markdown files ${scope === 'added' ? 'added' : 'touched'} in the last ${sinceDays} days via git history.`);
    lines.push('');
  } else {
    lines.push('Scope: all tracked markdown files (`git ls-files \"*.md\"`).');
    lines.push('');
  }

  lines.push('## Summary');
  lines.push(`- Scanned: ${scanned}`);
  lines.push(`- With remaining markers: ${withRemaining.length}`);
  lines.push(`- With no remaining markers: ${withoutRemaining.length}`);
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

  const report = renderReport({ scope: args.scope, sinceDays: args.sinceDays, files: scans });

  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, report, 'utf8');
    console.log(`Wrote ${outPath}`);
    return;
  }

  process.stdout.write(report);
}

main();
