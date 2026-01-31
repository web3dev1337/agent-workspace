#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function walk(dir, results = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, results);
    else results.push(full);
  }
  return results;
}

function inc(map, key, file) {
  const record = map.get(key) || { count: 0, files: new Map() };
  record.count += 1;
  record.files.set(file, (record.files.get(file) || 0) + 1);
  map.set(key, record);
}

function extractMatches(contents, filePath, map) {
  const hex = contents.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  for (const m of hex) inc(map, m.toLowerCase(), filePath);

  const rgb = contents.match(/\brgba?\([^)]*\)/g) || [];
  for (const m of rgb) inc(map, m.replace(/\s+/g, '').toLowerCase(), filePath);

  const hsl = contents.match(/\bhsla?\([^)]*\)/g) || [];
  for (const m of hsl) inc(map, m.replace(/\s+/g, '').toLowerCase(), filePath);

  const named = contents.match(/\b(white|black|transparent)\b/gi) || [];
  for (const m of named) inc(map, m.toLowerCase(), filePath);
}

function topFiles(filesMap, max = 6) {
  return [...filesMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([file, count]) => ({ file, count }));
}

function formatMarkdown(results, rootDir, counts) {
  const lines = [];
  lines.push('# UI Color Audit');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Scope');
  lines.push('');
  lines.push(`- Files scanned: ${counts.total} (css: ${counts.css}, js: ${counts.js}, html: ${counts.html})`);
  lines.push(`- Root: \`${rootDir}\``);
  lines.push('- Matches: hex (`#rgb/#rrggbb/#rrggbbaa`), `rgb()/rgba()`, `hsl()/hsla()`, and the named colors `white/black/transparent`.');
  lines.push('');
  lines.push('## Colors (sorted by frequency)');
  lines.push('');

  const sorted = [...results.entries()].sort((a, b) => {
    if (b[1].count !== a[1].count) return b[1].count - a[1].count;
    return a[0].localeCompare(b[0]);
  });

  for (const [color, info] of sorted) {
    lines.push(`- \`${color}\` — ${info.count}`);
    for (const { file, count } of topFiles(info.files)) {
      const rel = path.relative(rootDir, file);
      lines.push(`  - \`${rel}\`: ${count}`);
    }
  }

  lines.push('');
  lines.push('## Regenerate');
  lines.push('');
  lines.push('```bash');
  lines.push('node scripts/audit-ui-colors.js > PLANS/2026-01-31/UI_COLOR_AUDIT.md');
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const clientDir = path.join(repoRoot, 'client');

  if (!fs.existsSync(clientDir)) {
    console.error(`Missing client dir: ${clientDir}`);
    process.exit(1);
  }

  const files = walk(clientDir).filter((f) => (
    f.endsWith('.css') || f.endsWith('.js') || f.endsWith('.html')
  ));
  const map = new Map();

  for (const filePath of files) {
    const contents = fs.readFileSync(filePath, 'utf8');
    extractMatches(contents, filePath, map);
  }

  const counts = {
    total: files.length,
    css: files.filter((f) => f.endsWith('.css')).length,
    js: files.filter((f) => f.endsWith('.js')).length,
    html: files.filter((f) => f.endsWith('.html')).length,
  };
  process.stdout.write(formatMarkdown(map, repoRoot, counts));
}

main();
