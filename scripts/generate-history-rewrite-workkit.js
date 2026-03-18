#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

function parseArgs(argv) {
  const args = {
    outDir: '',
    noreplyEmail: '',
    repoUrl: ''
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = String(argv[index] || '').trim();
    const next = String(argv[index + 1] || '').trim();

    if ((token === '--out' || token === '--out-dir') && next) {
      args.outDir = next;
      index += 1;
      continue;
    }

    if ((token === '--noreply' || token === '--noreply-email') && next) {
      args.noreplyEmail = next;
      index += 1;
      continue;
    }

    if ((token === '--repo' || token === '--repo-url') && next) {
      args.repoUrl = next;
      index += 1;
    }
  }

  return args;
}

function run(command, commandArgs, options = {}) {
  return execFileSync(command, commandArgs, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  });
}

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function resolveDefaultOutDir() {
  const dateStamp = new Date().toISOString().slice(0, 10);
  return path.join(os.tmpdir(), `history-rewrite-workkit-${dateStamp}`);
}

function writeExecutable(filePath, content) {
  fs.writeFileSync(filePath, content, { mode: 0o755 });
}

function buildRunScript() {
  return `#!/usr/bin/env bash
set -euo pipefail

if ! command -v git >/dev/null 2>&1; then
  echo "git not found" >&2
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Run this script inside a fresh rewrite clone" >&2
  exit 1
fi

if ! command -v git-filter-repo >/dev/null 2>&1; then
  echo "git-filter-repo not found. Install it first." >&2
  exit 1
fi

REMOVE_PATHS_FILE="\${REMOVE_PATHS_FILE:-./paths-to-remove.txt}"
MAILMAP_FILE="\${MAILMAP_FILE:-./mailmap.private.txt}"

if [ ! -f "$REMOVE_PATHS_FILE" ]; then
  echo "Missing remove-paths file: $REMOVE_PATHS_FILE" >&2
  exit 1
fi

if [ ! -f "$MAILMAP_FILE" ]; then
  echo "Missing mailmap file: $MAILMAP_FILE" >&2
  exit 1
fi

ARGS=(--mailmap "$MAILMAP_FILE" --invert-paths)
while IFS= read -r line || [ -n "$line" ]; do
  clean_line="\${line%%#*}"
  clean_line="\$(echo \"$clean_line\" | xargs)"
  if [ -z "$clean_line" ]; then
    continue
  fi
  ARGS+=(--path "$clean_line")
done < "$REMOVE_PATHS_FILE"

echo "Running git filter-repo with \${#ARGS[@]} arguments"
git filter-repo --force "\${ARGS[@]}"

echo "Rewrite complete. Validate before any force-push."
`;
}

function buildRunbook({
  generatedAt,
  repoUrl,
  outDir,
  removePathsFileName,
  mailmapTemplateFileName,
  runScriptFileName,
  suggestedNoreply
}) {
  const lines = [];
  lines.push('# History rewrite execution runbook (private workkit)');
  lines.push('');
  lines.push(`Generated: ${generatedAt}`);
  lines.push('');
  lines.push('This runbook is non-destructive by itself. It prepares files and commands for a separate maintenance window.');
  lines.push('');
  lines.push('## Files generated in this workkit');
  lines.push('');
  lines.push(`- \`${removePathsFileName}\` - path filters to remove from history`);
  lines.push(`- \`${mailmapTemplateFileName}\` - mailmap template (replace placeholders)`);
  lines.push(`- \`${runScriptFileName}\` - helper script for filter-repo pass (manual execution)`);
  lines.push('- `history-authors.json` + `history-authors.md` - audit evidence');
  lines.push('');
  lines.push('## Preconditions');
  lines.push('');
  lines.push('- Freeze merges and notify collaborators.');
  lines.push('- Create immutable mirror backup before rewriting.');
  lines.push('- Use a fresh clone for rewrite work.');
  lines.push('- Keep this directory private (contains author-email mapping input).');
  lines.push('');
  lines.push('## Suggested identity target');
  lines.push('');
  lines.push(`- Suggested noreply email: \`${suggestedNoreply}\``);
  lines.push('');
  lines.push('## Commands');
  lines.push('');
  lines.push('### 1) Mirror backup');
  lines.push('');
  lines.push('```bash');
  lines.push(`git clone --mirror "${repoUrl || '<repo-url>'}" agent-workspace.mirror.git`);
  lines.push('tar -czf agent-workspace.mirror.git.tgz agent-workspace.mirror.git');
  lines.push('```');
  lines.push('');
  lines.push('### 2) Fresh rewrite clone');
  lines.push('');
  lines.push('```bash');
  lines.push(`git clone "${repoUrl || '<repo-url>'}" agent-workspace-rewrite`);
  lines.push('cd agent-workspace-rewrite');
  lines.push('git filter-repo --version');
  lines.push('```');
  lines.push('');
  lines.push('### 3) Copy workkit files into rewrite clone');
  lines.push('');
  lines.push('```bash');
  lines.push(`# Run this from rewrite clone root`);
  lines.push(`cp "${outDir}/${removePathsFileName}" ./paths-to-remove.txt`);
  lines.push(`cp "${outDir}/${mailmapTemplateFileName}" ./mailmap.private.txt`);
  lines.push(`cp "${outDir}/${runScriptFileName}" ./run-filter-repo.sh`);
  lines.push('chmod +x ./run-filter-repo.sh');
  lines.push('```');
  lines.push('');
  lines.push('### 4) Replace placeholders then run');
  lines.push('');
  lines.push('```bash');
  lines.push(`# Edit mailmap.private.txt and replace REPLACE_WITH_NOREPLY_EMAIL`);
  lines.push('./run-filter-repo.sh');
  lines.push('```');
  lines.push('');
  lines.push('### 5) Validation checks');
  lines.push('');
  lines.push('```bash');
  lines.push('npm run audit:public-release:history');
  lines.push('git log --all --format="%aN <%aE> | %cN <%cE>" | rg -n "@" | head -n 50');
  lines.push('git log --all --name-only --pretty=format: | rg -n "diff-viewer/cache|test-results/.last-run.json|config.json.pre-workspace-backup" || true');
  lines.push('```');
  lines.push('');
  lines.push('### 6) Force-push (maintenance window only)');
  lines.push('');
  lines.push('```bash');
  lines.push('git push origin --force --all');
  lines.push('git push origin --force --tags');
  lines.push('```');
  lines.push('');
  lines.push('## Aftercare');
  lines.push('');
  lines.push('- Require fresh clones for collaborators.');
  lines.push('- Keep local git identity on noreply before new commits.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv);
  const repoRoot = run('git', ['rev-parse', '--show-toplevel']).trim();
  const repoUrl = args.repoUrl || run('git', ['remote', 'get-url', 'origin']).trim();
  const outDir = path.resolve(args.outDir || resolveDefaultOutDir());
  const suggestedNoreply = args.noreplyEmail || run('git', ['config', '--global', 'user.email']).trim() || 'REPLACE_WITH_NOREPLY_EMAIL';

  ensureDir(outDir);

  const auditScriptPath = path.join(repoRoot, 'scripts', 'audit-history-authors.js');
  const authorsJsonPath = path.join(outDir, 'history-authors.json');
  const authorsMdPath = path.join(outDir, 'history-authors.md');
  const mailmapTemplatePath = path.join(outDir, 'mailmap.private.txt');
  const removePathsPath = path.join(outDir, 'paths-to-remove.txt');
  const runScriptPath = path.join(outDir, 'run-filter-repo.sh');
  const runbookPath = path.join(outDir, 'history-rewrite-runbook.md');

  run('node', [auditScriptPath, '--json', authorsJsonPath, '--md', authorsMdPath, '--mailmap', mailmapTemplatePath], {
    cwd: repoRoot
  });

  const knownHistoryRemovalPaths = [
    'diff-viewer/cache',
    'test-results/.last-run.json',
    'config.json.pre-workspace-backup'
  ];

  const removePathsLines = [
    '# Paths to remove from git history',
    '# Keep this file private and review before executing rewrite',
    ...knownHistoryRemovalPaths
  ];
  fs.writeFileSync(removePathsPath, `${removePathsLines.join('\n')}\n`);

  writeExecutable(runScriptPath, buildRunScript());

  const runbook = buildRunbook({
    generatedAt: new Date().toISOString(),
    repoUrl,
    outDir,
    removePathsFileName: path.basename(removePathsPath),
    mailmapTemplateFileName: path.basename(mailmapTemplatePath),
    runScriptFileName: path.basename(runScriptPath),
    suggestedNoreply
  });
  fs.writeFileSync(runbookPath, runbook);

  process.stdout.write([
    'History rewrite workkit generated',
    `- outDir: ${outDir}`,
    `- authors audit json: ${authorsJsonPath}`,
    `- authors audit markdown: ${authorsMdPath}`,
    `- mailmap template: ${mailmapTemplatePath}`,
    `- removal paths: ${removePathsPath}`,
    `- run script: ${runScriptPath}`,
    `- runbook: ${runbookPath}`
  ].join('\n'));
  process.stdout.write('\n');
}

main();
