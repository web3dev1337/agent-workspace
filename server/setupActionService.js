const crypto = require('crypto');
const { spawn } = require('child_process');

const setupActionRuns = new Map();
const latestRunByActionId = new Map();
const MAX_OUTPUT_LINES = 180;

function getSetupActions(platform = process.platform) {
  if (platform !== 'win32') {
    return [];
  }

  return [
    {
      id: 'install-git',
      title: 'Install Git',
      description: 'Required for repository and worktree operations.',
      command: 'winget install --id Git.Git --exact --source winget --accept-source-agreements --accept-package-agreements',
      docsUrl: 'https://git-scm.com/download/win',
      required: true,
      runSupported: true
    },
    {
      id: 'configure-git-identity',
      title: 'Configure Git identity',
      description: 'Optional but strongly recommended so commits use the correct author name and email.',
      command: 'git config --global user.name "Your Name"\ngit config --global user.email "you@example.com"',
      docsUrl: 'https://git-scm.com/book/en/v2/Getting-Started-First-Time-Git-Setup',
      required: false,
      optional: true,
      runSupported: false
    },
    {
      id: 'install-node',
      title: 'Install Node.js LTS',
      description: 'Needed to install CLI tools like Claude Code and Codex.',
      command: 'winget install --id OpenJS.NodeJS.LTS --exact --source winget --accept-source-agreements --accept-package-agreements',
      docsUrl: 'https://nodejs.org/en/download',
      required: false,
      runSupported: true
    },
    {
      id: 'install-gh',
      title: 'Install GitHub CLI',
      description: 'Recommended for PR and repository workflows.',
      command: 'winget install --id GitHub.cli --exact --source winget --accept-source-agreements --accept-package-agreements',
      docsUrl: 'https://cli.github.com/',
      required: false,
      optional: true,
      runSupported: true
    },
    {
      id: 'gh-login',
      title: 'Login GitHub CLI',
      description: 'Authenticate GitHub CLI for PR and repo APIs.',
      command: 'gh auth login --hostname github.com --git-protocol https --web --clipboard',
      docsUrl: 'https://cli.github.com/manual/gh_auth_login',
      required: false,
      optional: true,
      runSupported: true
    },
    {
      id: 'install-claude',
      title: 'Install Claude Code CLI',
      description: 'Install the Claude command used by agent sessions.',
      command: 'Set-ExecutionPolicy Bypass -Scope Process -Force; irm https://claude.ai/install.ps1 | iex',
      docsUrl: 'https://docs.claude.com/en/docs/claude-code/setup',
      required: false,
      optional: true,
      runSupported: true
    },
    {
      id: 'install-codex',
      title: 'Install Codex CLI',
      description: 'Install the Codex command used by agent sessions.',
      command: 'npm install -g @openai/codex',
      docsUrl: 'https://developers.openai.com/codex/cli',
      required: false,
      runSupported: true
    }
  ];
}

function getSetupActionById(actionId, platform = process.platform) {
  const id = String(actionId || '').trim();
  if (!id) return null;
  return getSetupActions(platform).find((action) => action.id === id) || null;
}

function createRunId(actionId) {
  return `setup-${String(actionId || 'action')}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

function getRunSummary(run) {
  if (!run) return null;
  return {
    runId: run.runId,
    actionId: run.actionId,
    title: run.title,
    command: run.command,
    status: run.status,
    startedAt: run.startedAt,
    endedAt: run.endedAt || null,
    pid: Number.isFinite(run.pid) ? run.pid : null,
    exitCode: Number.isInteger(run.exitCode) ? run.exitCode : null,
    error: run.error || null,
    output: Array.isArray(run.output) ? run.output.slice(-25) : [],
    updatedAt: run.updatedAt || run.startedAt
  };
}

function appendRunOutput(run, chunk, stream = 'stdout') {
  if (!run) return;
  const text = String(chunk || '');
  if (!text) return;
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean);
  if (!lines.length) return;
  const at = new Date().toISOString();
  lines.forEach((line) => {
    run.output.push({ at, stream, line: String(line).slice(0, 1600) });
  });
  if (run.output.length > MAX_OUTPUT_LINES) {
    run.output.splice(0, run.output.length - MAX_OUTPUT_LINES);
  }
  run.updatedAt = at;
}

function launchPowerShellCommand(action) {
  const runId = createRunId(action.id);
  const run = {
    runId,
    actionId: action.id,
    title: action.title,
    command: action.command,
    status: 'running',
    startedAt: new Date().toISOString(),
    endedAt: null,
    pid: null,
    exitCode: null,
    error: null,
    output: [],
    updatedAt: null
  };
  run.updatedAt = run.startedAt;

  setupActionRuns.set(runId, run);
  latestRunByActionId.set(action.id, runId);

  try {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', String(action.command || '')],
      {
        detached: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );
    run.pid = Number.isFinite(child?.pid) ? child.pid : null;
    run.updatedAt = new Date().toISOString();

    child.stdout.on('data', (chunk) => appendRunOutput(run, chunk, 'stdout'));
    child.stderr.on('data', (chunk) => appendRunOutput(run, chunk, 'stderr'));

    child.on('error', (error) => {
      run.status = 'failed';
      run.error = String(error?.message || error || 'Failed to launch setup action');
      run.endedAt = new Date().toISOString();
      run.updatedAt = run.endedAt;
    });

    child.on('close', (code) => {
      run.exitCode = Number.isInteger(code) ? code : null;
      run.status = code === 0 ? 'success' : 'failed';
      if (code !== 0 && !run.error) {
        run.error = `Setup action exited with code ${String(code)}`;
      }
      run.endedAt = new Date().toISOString();
      run.updatedAt = run.endedAt;
    });
  } catch (error) {
    run.status = 'failed';
    run.error = String(error?.message || error || 'Failed to launch setup action');
    run.endedAt = new Date().toISOString();
    run.updatedAt = run.endedAt;
  }

  return run;
}

function getSetupActionRun(runId) {
  const key = String(runId || '').trim();
  if (!key) return null;
  return getRunSummary(setupActionRuns.get(key));
}

function getLatestSetupActionRun(actionId) {
  const id = String(actionId || '').trim();
  if (!id) return null;
  const runId = latestRunByActionId.get(id);
  if (!runId) return null;
  return getRunSummary(setupActionRuns.get(runId));
}

function runSetupAction(actionId, platform = process.platform) {
  if (platform !== 'win32') {
    const err = new Error('Setup actions are currently implemented for Windows only.');
    err.code = 'unsupported_platform';
    throw err;
  }

  const action = getSetupActionById(actionId, platform);
  if (!action) {
    const err = new Error(`Unknown setup action: ${String(actionId || '')}`);
    err.code = 'unknown_action';
    throw err;
  }

  if (!action.runSupported || !action.command) {
    const err = new Error(`Action "${action.id}" cannot be launched from the app.`);
    err.code = 'not_runnable';
    throw err;
  }

  const latestRun = getLatestSetupActionRun(action.id);
  if (latestRun && latestRun.status === 'running') {
    return {
      id: action.id,
      title: action.title,
      started: true,
      alreadyRunning: true,
      run: latestRun,
      message: `${action.title} is already running.`
    };
  }

  const run = launchPowerShellCommand(action);
  const runSummary = getRunSummary(run);

  return {
    id: action.id,
    title: action.title,
    started: true,
    alreadyRunning: false,
    run: runSummary,
    message: `Started ${action.title}. Progress updates are now tracked in onboarding.`
  };
}

module.exports = {
  getSetupActions,
  getSetupActionById,
  runSetupAction,
  getSetupActionRun,
  getLatestSetupActionRun
};
