#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function parseArgs(argv) {
  const args = {
    workkitDir: '',
    mailmapPath: '',
    targetEmail: '',
    backup: true,
    dryRun: false
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = String(argv[index] || '').trim();
    const next = String(argv[index + 1] || '').trim();

    if ((token === '--workkit' || token === '--workkit-dir') && next) {
      args.workkitDir = next;
      index += 1;
      continue;
    }

    if ((token === '--mailmap' || token === '--mailmap-path') && next) {
      args.mailmapPath = next;
      index += 1;
      continue;
    }

    if ((token === '--target-email' || token === '--email') && next) {
      args.targetEmail = next;
      index += 1;
      continue;
    }

    if (token === '--no-backup') {
      args.backup = false;
      continue;
    }

    if (token === '--dry-run') {
      args.dryRun = true;
    }
  }

  return args;
}

function resolveDefaultTargetEmail() {
  try {
    return execFileSync('git', ['config', '--global', 'user.email'], { encoding: 'utf8' }).trim();
  } catch (_error) {
    return '';
  }
}

function isNoreplyEmail(email) {
  return String(email || '').trim().toLowerCase().endsWith('@users.noreply.github.com');
}

function resolveMailmapPath(args) {
  if (args.mailmapPath) return path.resolve(args.mailmapPath);
  if (args.workkitDir) return path.resolve(args.workkitDir, 'mailmap.private.txt');
  return '';
}

function finalizeMailmap(content, targetEmail) {
  const lines = content.split(/\r?\n/);
  let replacements = 0;

  const updated = lines.map((line) => {
    if (!line.includes('REPLACE_WITH_NOREPLY_EMAIL')) return line;
    replacements += 1;
    return line.replaceAll('REPLACE_WITH_NOREPLY_EMAIL', targetEmail);
  });

  return {
    content: `${updated.join('\n')}\n`,
    replacements
  };
}

function main() {
  const args = parseArgs(process.argv);
  const mailmapPath = resolveMailmapPath(args);
  const targetEmail = (args.targetEmail || resolveDefaultTargetEmail()).trim();

  if (!mailmapPath) {
    process.stderr.write('Missing mailmap path. Use --workkit-dir <dir> or --mailmap-path <path>.\n');
    process.exit(1);
  }

  if (!fs.existsSync(mailmapPath)) {
    process.stderr.write(`Mailmap file not found: ${mailmapPath}\n`);
    process.exit(1);
  }

  if (!targetEmail) {
    process.stderr.write('Missing target email. Provide --target-email or set git config --global user.email.\n');
    process.exit(1);
  }

  if (!isNoreplyEmail(targetEmail)) {
    process.stderr.write(`Target email is not a GitHub noreply address: ${targetEmail}\n`);
    process.stderr.write('Use a noreply address like <id+user@users.noreply.github.com>.\n');
    process.exit(1);
  }

  const original = fs.readFileSync(mailmapPath, 'utf8');
  const finalized = finalizeMailmap(original, targetEmail);

  process.stdout.write('History rewrite mailmap finalizer\n');
  process.stdout.write(`- mailmap: ${mailmapPath}\n`);
  process.stdout.write(`- targetEmail: ${targetEmail}\n`);
  process.stdout.write(`- replacements: ${finalized.replacements}\n`);

  if (finalized.replacements === 0) {
    process.stdout.write('- no placeholder tokens found\n');
    process.exit(0);
  }

  if (args.dryRun) {
    process.stdout.write('- dry-run enabled (no file changes)\n');
    process.exit(0);
  }

  if (args.backup) {
    const backupPath = `${mailmapPath}.bak`;
    fs.writeFileSync(backupPath, original);
    process.stdout.write(`- backup: ${backupPath}\n`);
  }

  fs.writeFileSync(mailmapPath, finalized.content);
  process.stdout.write('- mailmap finalized\n');
}

main();
