#!/usr/bin/env node

const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const args = {
    apply: false,
    only: '',
    json: false
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = String(argv[index] || '').trim();
    const next = String(argv[index + 1] || '').trim();

    if (token === '--apply') {
      args.apply = true;
      continue;
    }

    if (token === '--json') {
      args.json = true;
      continue;
    }

    if ((token === '--only' || token === '--tool') && next) {
      args.only = next;
      index += 1;
    }
  }

  return args;
}

function hasCommand(command, checkArgs = ['--version']) {
  const result = spawnSync(command, checkArgs, { encoding: 'utf8' });
  return result.status === 0;
}

function runInstallStep(step) {
  const result = spawnSync(step.command, step.args, { stdio: 'inherit' });
  return result.status === 0;
}

function getInstallPlan(tool) {
  const plans = {
    'git-filter-repo': [],
    gitleaks: []
  };

  const isWindows = process.platform === 'win32';

  if (hasCommand('pipx')) {
    plans['git-filter-repo'].push({
      label: 'pipx install git-filter-repo',
      command: 'pipx',
      args: ['install', 'git-filter-repo'],
      auto: true
    });
  }

  if (hasCommand('python3')) {
    plans['git-filter-repo'].push({
      label: 'python3 -m pip install --user git-filter-repo',
      command: 'python3',
      args: ['-m', 'pip', 'install', '--user', 'git-filter-repo'],
      auto: true
    });
  }

  if (hasCommand('pip3')) {
    plans['git-filter-repo'].push({
      label: 'pip3 install --user git-filter-repo',
      command: 'pip3',
      args: ['install', '--user', 'git-filter-repo'],
      auto: true
    });
  }

  if (hasCommand('brew')) {
    plans['git-filter-repo'].push({
      label: 'brew install git-filter-repo',
      command: 'brew',
      args: ['install', 'git-filter-repo'],
      auto: true
    });

    plans.gitleaks.push({
      label: 'brew install gitleaks',
      command: 'brew',
      args: ['install', 'gitleaks'],
      auto: true
    });
  }

  if (isWindows && hasCommand('winget')) {
    plans.gitleaks.push({
      label: 'winget install --id Gitleaks.Gitleaks --exact --accept-source-agreements --accept-package-agreements',
      command: 'winget',
      args: ['install', '--id', 'Gitleaks.Gitleaks', '--exact', '--accept-source-agreements', '--accept-package-agreements'],
      auto: true
    });
  }

  if (isWindows && hasCommand('choco')) {
    plans.gitleaks.push({
      label: 'choco install gitleaks -y',
      command: 'choco',
      args: ['install', 'gitleaks', '-y'],
      auto: true
    });
  }

  if (hasCommand('go')) {
    plans.gitleaks.push({
      label: 'go install github.com/gitleaks/gitleaks/v8@latest',
      command: 'go',
      args: ['install', 'github.com/gitleaks/gitleaks/v8@latest'],
      auto: true
    });
  }

  return plans[tool] || [];
}

function checkToolStatus(tool) {
  if (tool === 'git-filter-repo') {
    return hasCommand('git-filter-repo', ['--help']);
  }
  if (tool === 'gitleaks') {
    return hasCommand('gitleaks', ['version']);
  }
  return false;
}

function toolsFromArgs(args) {
  const all = ['git-filter-repo', 'gitleaks'];
  if (!args.only) return all;
  if (args.only === 'git-filter-repo' || args.only === 'gitleaks') return [args.only];
  return all;
}

function main() {
  const args = parseArgs(process.argv);
  const tools = toolsFromArgs(args);
  const report = {
    apply: args.apply,
    platform: process.platform,
    tools: []
  };

  for (const tool of tools) {
    let installed = checkToolStatus(tool);
    const toolReport = {
      tool,
      installed,
      attempted: false,
      installedAfterApply: installed,
      commands: []
    };

    const installPlan = getInstallPlan(tool);
    toolReport.commands = installPlan.map((step) => step.label);

    if (!installed && args.apply) {
      for (const step of installPlan) {
        toolReport.attempted = true;
        const ok = runInstallStep(step);
        if (!ok) continue;
        installed = checkToolStatus(tool);
        if (installed) break;
      }
    }

    toolReport.installedAfterApply = installed;
    report.tools.push(toolReport);
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`History rewrite tool setup (${process.platform})\n`);
    for (const toolReport of report.tools) {
      const status = toolReport.installedAfterApply ? 'installed' : 'missing';
      process.stdout.write(`- ${toolReport.tool}: ${status}\n`);
      if (!toolReport.installedAfterApply) {
        if (!toolReport.commands.length) {
          process.stdout.write('  no automated install command available on this machine\n');
        } else {
          process.stdout.write('  suggested commands:\n');
          for (const command of toolReport.commands) {
            process.stdout.write(`    - ${command}\n`);
          }
        }
      }
    }
    if (!args.apply) {
      process.stdout.write('- run with --apply to attempt automatic installation\n');
    }
  }

  const missing = report.tools.filter((item) => !item.installedAfterApply);
  process.exitCode = missing.length === 0 ? 0 : 1;
}

main();
