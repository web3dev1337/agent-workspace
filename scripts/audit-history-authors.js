#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function parseArgs(argv) {
  const args = {
    jsonOut: '',
    mdOut: '',
    mailmapOut: '',
    maxRows: 200
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = String(argv[index] || '').trim();
    const next = String(argv[index + 1] || '').trim();
    if ((token === '--json' || token === '--json-out') && next) {
      args.jsonOut = next;
      index += 1;
      continue;
    }
    if ((token === '--md' || token === '--md-out') && next) {
      args.mdOut = next;
      index += 1;
      continue;
    }
    if ((token === '--mailmap' || token === '--mailmap-out') && next) {
      args.mailmapOut = next;
      index += 1;
      continue;
    }
    if ((token === '--max-rows' || token === '--maxRows') && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) {
        args.maxRows = Math.round(parsed);
      }
      index += 1;
    }
  }

  return args;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeName(name) {
  return String(name || '').trim();
}

function classifyEmail(email) {
  const value = normalizeEmail(email);
  if (!value) return 'empty';
  if (value.endsWith('@users.noreply.github.com')) return 'noreply';
  if (value.endsWith('@example.com') || value.endsWith('@example.org') || value.endsWith('@example.net')) return 'example';
  if (value.includes('localhost') || value.includes('localdomain')) return 'local';
  return 'custom';
}

function ensureParentDir(filePath) {
  const parent = path.dirname(filePath);
  if (!fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true });
  }
}

function toSortedRows(emailMap) {
  return Array.from(emailMap.values()).sort((left, right) => {
    if (right.totalCount !== left.totalCount) return right.totalCount - left.totalCount;
    return left.email.localeCompare(right.email);
  });
}

function buildMarkdown(report, maxRows) {
  const rows = report.rows.slice(0, maxRows);
  const lines = [];
  lines.push('# Git history author/committer email audit');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Commits scanned: ${report.commitsScanned}`);
  lines.push(`Unique emails: ${report.uniqueEmails}`);
  lines.push(`Custom/non-noreply emails: ${report.customEmails}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Noreply emails: ${report.classCounts.noreply || 0}`);
  lines.push(`- Custom emails: ${report.classCounts.custom || 0}`);
  lines.push(`- Example emails: ${report.classCounts.example || 0}`);
  lines.push(`- Local emails: ${report.classCounts.local || 0}`);
  lines.push(`- Empty emails: ${report.classCounts.empty || 0}`);
  lines.push('');
  lines.push('## Top emails');
  lines.push('');
  lines.push('| Email | Class | Total | Author | Committer | Names |');
  lines.push('|---|---:|---:|---:|---:|---|');

  for (const row of rows) {
    lines.push(`| ${row.email || '(empty)'} | ${row.classification} | ${row.totalCount} | ${row.authorCount} | ${row.committerCount} | ${row.names.join(', ')} |`);
  }

  lines.push('');
  lines.push('## Suggested `.mailmap` entries (custom only)');
  lines.push('');
  if (!report.mailmapSuggestions.length) {
    lines.push('- None (no custom emails found).');
  } else {
    lines.push('```text');
    for (const line of report.mailmapSuggestions) {
      lines.push(line);
    }
    lines.push('```');
  }

  return `${lines.join('\n')}\n`;
}

function buildMailmap(report) {
  if (!report.mailmapSuggestions.length) return '';
  return `${report.mailmapSuggestions.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv);
  const output = execFileSync('git', ['log', '--all', '--format=%aN%x09%aE%x09%cN%x09%cE'], {
    encoding: 'utf8'
  });

  const lines = String(output || '').split(/\r?\n/).filter(Boolean);
  const emailMap = new Map();

  for (const line of lines) {
    const [authorNameRaw, authorEmailRaw, committerNameRaw, committerEmailRaw] = line.split('\t');
    const authorName = normalizeName(authorNameRaw);
    const authorEmail = normalizeEmail(authorEmailRaw);
    const committerName = normalizeName(committerNameRaw);
    const committerEmail = normalizeEmail(committerEmailRaw);

    const authorRow = emailMap.get(authorEmail) || {
      email: authorEmail,
      classification: classifyEmail(authorEmail),
      authorCount: 0,
      committerCount: 0,
      totalCount: 0,
      names: new Set()
    };
    authorRow.authorCount += 1;
    authorRow.totalCount += 1;
    if (authorName) authorRow.names.add(authorName);
    emailMap.set(authorEmail, authorRow);

    const committerRow = emailMap.get(committerEmail) || {
      email: committerEmail,
      classification: classifyEmail(committerEmail),
      authorCount: 0,
      committerCount: 0,
      totalCount: 0,
      names: new Set()
    };
    committerRow.committerCount += 1;
    committerRow.totalCount += 1;
    if (committerName) committerRow.names.add(committerName);
    emailMap.set(committerEmail, committerRow);
  }

  const rows = toSortedRows(emailMap).map((row) => ({
    ...row,
    names: Array.from(row.names).sort((left, right) => left.localeCompare(right))
  }));

  const classCounts = rows.reduce((accumulator, row) => {
    const key = row.classification || 'unknown';
    accumulator[key] = Number(accumulator[key] || 0) + 1;
    return accumulator;
  }, {});

  const mailmapSuggestions = rows
    .filter((row) => row.classification === 'custom' && row.email)
    .flatMap((row) => {
      if (!row.names.length) return [];
      const preferredName = row.names[0];
      return [`${preferredName} <REPLACE_WITH_NOREPLY_EMAIL> ${preferredName} <${row.email}>`];
    });

  const report = {
    generatedAt: new Date().toISOString(),
    commitsScanned: lines.length,
    uniqueEmails: rows.length,
    customEmails: Number(classCounts.custom || 0),
    classCounts,
    rows,
    mailmapSuggestions
  };

  if (args.jsonOut) {
    const jsonPath = path.resolve(args.jsonOut);
    ensureParentDir(jsonPath);
    fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  const markdown = buildMarkdown(report, args.maxRows);
  if (args.mdOut) {
    const mdPath = path.resolve(args.mdOut);
    ensureParentDir(mdPath);
    fs.writeFileSync(mdPath, markdown);
  }

  if (args.mailmapOut) {
    const mailmap = buildMailmap(report);
    const mailmapPath = path.resolve(args.mailmapOut);
    ensureParentDir(mailmapPath);
    fs.writeFileSync(mailmapPath, mailmap);
  }

  const summary = [
    'History author audit',
    `- commits scanned: ${report.commitsScanned}`,
    `- unique emails: ${report.uniqueEmails}`,
    `- custom/non-noreply emails: ${report.customEmails}`,
    `- noreply emails: ${report.classCounts.noreply || 0}`
  ];
  process.stdout.write(`${summary.join('\n')}\n`);
  if (args.jsonOut) process.stdout.write(`- wrote json: ${path.resolve(args.jsonOut)}\n`);
  if (args.mdOut) process.stdout.write(`- wrote markdown: ${path.resolve(args.mdOut)}\n`);
  if (args.mailmapOut) process.stdout.write(`- wrote mailmap template: ${path.resolve(args.mailmapOut)}\n`);
}

main();
