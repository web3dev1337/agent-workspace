const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { augmentProcessEnv, getHiddenProcessOptions } = require('./utils/processUtils');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

function execQuiet(command, args, options = {}) {
  const timeout = Number(options.timeout) || 3000;
  const maxBuffer = options.maxBuffer || 1024 * 1024;
  return new Promise((resolve, reject) => {
    const cmdStr = String(command || '').trim();
    const argsArr = Array.isArray(args) ? args : [];
    let spawnCmd = cmdStr;
    let spawnArgs = argsArr;
    if (IS_WIN && /\.(cmd|bat)$/i.test(cmdStr)) {
      spawnCmd = 'cmd.exe';
      spawnArgs = ['/d', '/c', cmdStr, ...argsArr];
    }
    const child = spawn(spawnCmd, spawnArgs, {
      ...getHiddenProcessOptions({
        stdio: ['ignore', 'pipe', 'pipe'],
        env: augmentProcessEnv(process.env)
      })
    });
    let stdout = '';
    let stderr = '';
    let killed = false;
    const timer = setTimeout(() => { killed = true; child.kill(); }, timeout);
    child.stdout.on('data', (d) => {
      stdout += d;
      if (stdout.length > maxBuffer) { killed = true; child.kill(); }
    });
    child.stderr.on('data', (d) => {
      stderr += d;
      if (stderr.length > maxBuffer) { killed = true; child.kill(); }
    });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) return reject(Object.assign(new Error('TIMEOUT'), { code: 'ETIMEDOUT' }));
      if (code !== 0) return reject(Object.assign(new Error(stderr || `Exit code ${code}`), { code: 'EXIT', exitCode: code }));
      resolve({ stdout, stderr });
    });
  });
}

const setupActionRuns = new Map();
const latestRunByActionId = new Map();
const MAX_OUTPUT_LINES = 180;
const MAX_RUNS_RETAINED = 50;

function pruneOldRuns() {
  if (setupActionRuns.size <= MAX_RUNS_RETAINED) return;
  const toDelete = Array.from(setupActionRuns.keys()).slice(0, setupActionRuns.size - MAX_RUNS_RETAINED);
  for (const key of toDelete) {
    setupActionRuns.delete(key);
  }
}
const GH_LOGIN_CODE_PATTERN = /\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/i;
const GH_LOGIN_URL_PATTERN = /https:\/\/github\.com\/login\/device(?:\S*)?/i;
const GH_LOGIN_HINT_PATTERN = /one[-\s]?time code|login\/device|authenticate in your web browser|copied to your clipboard|open this url/i;

function stripAnsi(value) {
  return String(value || '').replace(/\u001b\[[0-9;]*m/g, '');
}

function getGhLoginDebugLogPath() {
  const customDataDir = String(process.env.ORCHESTRATOR_DATA_DIR || '').trim();
  if (customDataDir) {
    return path.join(customDataDir, 'logs', 'gh-login-debug.log');
  }
  return path.join(os.tmpdir(), 'orchestrator-gh-login-debug.log');
}

function appendGhLoginDebugLog(event, payload = {}) {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    event: String(event || '').trim() || 'event',
    ...(payload && typeof payload === 'object' ? payload : {})
  });
  const logPath = getGhLoginDebugLogPath();
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${line}\n`, 'utf8');
  } catch {
    // Best-effort debug logging; never block setup flow.
  }
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const out = [];
  values.forEach((value) => {
    const item = String(value || '').trim();
    if (!item || seen.has(item)) return;
    seen.add(item);
    out.push(item);
  });
  return out;
}

async function checkExecutable(command, args = ['--version']) {
  const commandStr = String(command || '').trim();
  if (!commandStr) return { ok: false, error: 'Missing command' };

  try {
    await execQuiet(commandStr, Array.isArray(args) ? args : [], { timeout: 3000 });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || error || 'Command check failed')
    };
  }
}

function getGitCommandCandidates(platform = process.platform) {
  if (platform !== 'win32') {
    return ['git'];
  }

  return uniqueStrings([
    'git',
    'git.exe',
    path.join(process.env.ProgramFiles || '', 'Git', 'cmd', 'git.exe'),
    path.join(process.env.ProgramFiles || '', 'Git', 'bin', 'git.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Git', 'cmd', 'git.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Git', 'bin', 'git.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'cmd', 'git.exe')
  ]);
}

async function resolveGitCommand(platform = process.platform) {
  const candidates = getGitCommandCandidates(platform);
  for (const command of candidates) {
    const check = await checkExecutable(command, ['--version']);
    if (check.ok) return command;
  }
  return '';
}

async function runGitCommand(command, args = []) {
  try {
    const result = await execQuiet(command, Array.isArray(args) ? args : [], { timeout: 9000 });
    return String(result?.stdout || result?.stderr || '');
  } catch (error) {
    const message = String(error?.message || error || 'Git command failed');
    const err = new Error(message);
    err.code = String(error?.code || 'git_command_failed');
    throw err;
  }
}

function firstNonEmptyLine(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean) || '';
}

function getMacSetupActions() {
  return [
    {
      id: 'install-homebrew',
      title: 'Homebrew',
      description: 'macOS package manager. Required to install other dependencies.',
      command: [
        'if command -v brew >/dev/null 2>&1; then echo "Homebrew is already installed."; brew --version; exit 0; fi',
        'echo "Installing Homebrew to ~/.homebrew (no sudo required)..."',
        'mkdir -p ~/.homebrew',
        'curl -fsSL https://github.com/Homebrew/brew/tarball/master | tar xz --strip-components 1 -C ~/.homebrew',
        'eval "$(~/.homebrew/bin/brew shellenv)"',
        'echo >> ~/.zprofile',
        'echo \'eval "$(~/.homebrew/bin/brew shellenv)"\' >> ~/.zprofile',
        'brew update --force --quiet',
        'echo "Homebrew installed successfully."',
        'brew --version'
      ].join('\n'),
      docsUrl: 'https://brew.sh/',
      required: true,
      runSupported: true
    },
    {
      id: 'install-git',
      title: 'Git Integration',
      description: 'Required for repository and worktree access.',
      command: 'brew install git',
      docsUrl: 'https://git-scm.com/download/mac',
      required: true,
      runSupported: true
    },
    {
      id: 'configure-git-identity',
      title: 'Git Identity',
      description: 'Set your name and email for accurate commits.',
      command: 'git config --global user.name "Your Name"\ngit config --global user.email "you@example.com"',
      docsUrl: 'https://git-scm.com/book/en/v2/Getting-Started-First-Time-Git-Setup',
      required: false,
      optional: true,
      runSupported: false
    },
    {
      id: 'install-node',
      title: 'Node.js LTS',
      description: 'Installs nvm (Node Version Manager) and Node.js 20 LTS.',
      command: [
        'if command -v node >/dev/null 2>&1; then echo "Node.js is already installed."; node --version; exit 0; fi',
        'echo "Installing nvm (Node Version Manager)..."',
        'export NVM_DIR="$HOME/.nvm"',
        'if [ ! -s "$NVM_DIR/nvm.sh" ]; then',
        '  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash',
        'fi',
        '. "$NVM_DIR/nvm.sh"',
        'echo "Installing Node.js 20 LTS..."',
        'nvm install 20',
        'nvm alias default 20',
        'echo "Node.js installed successfully."',
        'node --version',
        'npm --version'
      ].join('\n'),
      docsUrl: 'https://nodejs.org/en/download',
      required: false,
      runSupported: true
    },
    {
      id: 'install-gh',
      title: 'GitHub CLI',
      description: 'Optional. Install now, then continue to GitHub login in the next step.',
      command: 'brew install gh',
      docsUrl: 'https://cli.github.com/',
      required: false,
      optional: true,
      runSupported: true
    },
    {
      id: 'gh-login',
      title: 'GitHub Authentication',
      description: 'Optional after GitHub CLI install. Sign in to enable PR and repo actions.',
      command: [
        'export NO_COLOR=1',
        'export GH_PAGER=""',
        'if gh auth status --hostname github.com >/dev/null 2>&1; then',
        '  echo "GitHub CLI is already authenticated."',
        '  exit 0',
        'fi',
        'echo "Starting GitHub CLI web login..."',
        'echo "Expect a one-time code and https://github.com/login/device below."',
        'gh auth login --hostname github.com --git-protocol https --web --skip-ssh-key'
      ].join('\n'),
      docsUrl: 'https://cli.github.com/manual/gh_auth_login',
      required: false,
      optional: true,
      runSupported: true
    },
    {
      id: 'install-claude',
      title: 'Claude Code CLI',
      description: 'Primary AI agent powered by Anthropic.',
      command: 'npm install -g @anthropic-ai/claude-code',
      docsUrl: 'https://docs.claude.com/en/docs/claude-code/setup',
      required: false,
      optional: true,
      runSupported: true
    },
    {
      id: 'install-codex',
      title: 'Codex CLI',
      description: 'Alternative AI agent tool for development.',
      command: 'npm install -g @openai/codex',
      docsUrl: 'https://developers.openai.com/codex/cli',
      required: false,
      runSupported: true
    }
  ];
}

function getSetupActions(platform = process.platform) {
  if (platform === 'darwin') {
    return getMacSetupActions();
  }
  if (platform !== 'win32') {
    return [];
  }

  return [
    {
      id: 'install-git',
      title: 'Git Integration',
      description: 'Required for repository and worktree access.',
      command: 'winget install --id Git.Git --exact --source winget --accept-source-agreements --accept-package-agreements',
      docsUrl: 'https://git-scm.com/download/win',
      required: true,
      runSupported: true
    },
    {
      id: 'configure-git-identity',
      title: 'Git Identity',
      description: 'Set your name and email for accurate commits.',
      command: 'git config --global user.name "Your Name"\ngit config --global user.email "you@example.com"',
      docsUrl: 'https://git-scm.com/book/en/v2/Getting-Started-First-Time-Git-Setup',
      required: false,
      optional: true,
      runSupported: false
    },
    {
      id: 'install-node',
      title: 'Node.js LTS',
      description: 'Required core dependency for running agents.',
      command: 'winget install --id OpenJS.NodeJS.LTS --exact --source winget --accept-source-agreements --accept-package-agreements',
      docsUrl: 'https://nodejs.org/en/download',
      required: false,
      runSupported: true
    },
    {
      id: 'install-gh',
      title: 'GitHub CLI',
      description: 'Optional. Install now, then continue to GitHub login in the next step.',
      command: 'winget install --id GitHub.cli --exact --source winget --accept-source-agreements --accept-package-agreements',
      docsUrl: 'https://cli.github.com/',
      required: false,
      optional: true,
      runSupported: true
    },
    {
      id: 'gh-login',
      title: 'GitHub Authentication',
      description: 'Optional after GitHub CLI install. Sign in to enable PR and repo actions.',
      command: [
        "$ErrorActionPreference = 'Stop'",
        '$env:NO_COLOR = "1"',
        '$env:GH_PAGER = ""',
        '$gh = ""',
        '$cmd = Get-Command gh -ErrorAction SilentlyContinue',
        'if ($cmd -and $cmd.Source) { $gh = $cmd.Source }',
        'if (-not $gh) {',
        '  $candidates = @(',
        '    "$env:ProgramFiles\\GitHub CLI\\gh.exe",',
        '    "$env:ProgramFiles(x86)\\GitHub CLI\\gh.exe",',
        '    "$env:LOCALAPPDATA\\Programs\\GitHub CLI\\gh.exe"',
        '  )',
        '  foreach ($candidate in $candidates) {',
        '    if (Test-Path $candidate) { $gh = $candidate; break }',
        '  }',
        '}',
        'if (-not $gh) { throw "GitHub CLI executable not found. Install GitHub CLI first." }',
        '$prevErrorAction = $ErrorActionPreference',
        '$ErrorActionPreference = "Continue"',
        '& $gh auth status --hostname github.com *> $null',
        '$authStatusExitCode = $LASTEXITCODE',
        '$ErrorActionPreference = $prevErrorAction',
        'if ($authStatusExitCode -eq 0) { Write-Output "GitHub CLI is already authenticated."; exit 0 }',
        'Write-Output "Starting GitHub CLI web login..."',
        'Write-Output "Expect a one-time code and https://github.com/login/device below."',
        '& $gh auth login --hostname github.com --git-protocol https --web --skip-ssh-key',
        'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }'
      ].join('\n'),
      docsUrl: 'https://cli.github.com/manual/gh_auth_login',
      required: false,
      optional: true,
      runSupported: true
    },
    {
      id: 'install-claude',
      title: 'Claude Code CLI',
      description: 'Primary AI agent powered by Anthropic.',
      command: 'winget install --id Anthropic.ClaudeCode --exact --source winget --accept-source-agreements --accept-package-agreements',
      docsUrl: 'https://docs.claude.com/en/docs/claude-code/setup',
      required: false,
      optional: true,
      runSupported: true
    },
    {
      id: 'install-codex',
      title: 'Codex CLI',
      description: 'Alternative AI agent tool for development.',
      command: [
        "$ErrorActionPreference = 'Stop'",
        '$npm = ""',
        '$cmd = Get-Command npm -ErrorAction SilentlyContinue',
        'if ($cmd -and $cmd.Source) { $npm = $cmd.Source }',
        'if (-not $npm) {',
        '  $candidates = @(',
        '    "$env:ProgramFiles\\nodejs\\npm.cmd",',
        '    "$env:ProgramFiles(x86)\\nodejs\\npm.cmd",',
        '    "$env:LOCALAPPDATA\\Programs\\nodejs\\npm.cmd",',
        '    "$env:APPDATA\\npm\\npm.cmd"',
        '  )',
        '  foreach ($candidate in $candidates) {',
        '    if (Test-Path $candidate) { $npm = $candidate; break }',
        '  }',
        '}',
        'if (-not $npm) { throw "npm was not found. Install Node.js LTS first, then run this step again." }',
        '& $npm install -g @openai/codex',
        'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }'
      ].join('\n'),
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
    ghDeviceCode: run.ghDeviceCode || null,
    ghDeviceUrl: run.ghDeviceUrl || null,
    ghHasDeviceHint: !!run.ghHasDeviceHint,
    ghDebugLogPath: run.ghDebugLogPath || null,
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
    .map((line) => stripAnsi(line).trimEnd())
    .filter(Boolean);
  if (!lines.length) return;
  const at = new Date().toISOString();
  lines.forEach((line) => {
    const cleanLine = String(line || '').slice(0, 1600);
    run.output.push({ at, stream, line: cleanLine });
    if (run.actionId === 'gh-login') {
      const codeMatch = cleanLine.match(GH_LOGIN_CODE_PATTERN);
      const urlMatch = cleanLine.match(GH_LOGIN_URL_PATTERN);
      if (codeMatch?.[1]) run.ghDeviceCode = String(codeMatch[1]).toUpperCase();
      if (urlMatch?.[0]) run.ghDeviceUrl = String(urlMatch[0]).trim();
      if (GH_LOGIN_HINT_PATTERN.test(cleanLine)) run.ghHasDeviceHint = true;
      appendGhLoginDebugLog('output', {
        runId: run.runId,
        stream,
        line: cleanLine
      });
    }
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
    ghDeviceCode: null,
    ghDeviceUrl: null,
    ghHasDeviceHint: false,
    ghDebugLogPath: action.id === 'gh-login' ? getGhLoginDebugLogPath() : null,
    updatedAt: null
  };
  run.updatedAt = run.startedAt;
  if (action.id === 'gh-login') {
    appendGhLoginDebugLog('run_started', {
      runId: run.runId,
      title: run.title
    });
  }

  setupActionRuns.set(runId, run);
  latestRunByActionId.set(action.id, runId);
  pruneOldRuns();

  try {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', String(action.command || '')],
      getHiddenProcessOptions({
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: augmentProcessEnv(process.env)
      })
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
      if (action.id === 'gh-login') {
        appendGhLoginDebugLog('run_error', {
          runId: run.runId,
          error: run.error
        });
      }
    });

    child.on('close', (code) => {
      run.exitCode = Number.isInteger(code) ? code : null;
      run.status = code === 0 ? 'success' : 'failed';
      if (code !== 0 && !run.error) {
        run.error = `Setup action exited with code ${String(code)}`;
      }
      run.endedAt = new Date().toISOString();
      run.updatedAt = run.endedAt;
      if (action.id === 'gh-login') {
        appendGhLoginDebugLog('run_closed', {
          runId: run.runId,
          status: run.status,
          exitCode: run.exitCode,
          error: run.error || null,
          parsedCode: run.ghDeviceCode || null,
          parsedUrl: run.ghDeviceUrl || null,
          sawHint: !!run.ghHasDeviceHint
        });
      }
    });
  } catch (error) {
    run.status = 'failed';
    run.error = String(error?.message || error || 'Failed to launch setup action');
    run.endedAt = new Date().toISOString();
    run.updatedAt = run.endedAt;
    if (action.id === 'gh-login') {
      appendGhLoginDebugLog('run_launch_failed', {
        runId: run.runId,
        error: run.error
      });
    }
  }

  return run;
}

function launchShellCommand(action) {
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
    ghDeviceCode: null,
    ghDeviceUrl: null,
    ghHasDeviceHint: false,
    ghDebugLogPath: action.id === 'gh-login' ? getGhLoginDebugLogPath() : null,
    updatedAt: null
  };
  run.updatedAt = run.startedAt;
  if (action.id === 'gh-login') {
    appendGhLoginDebugLog('run_started', { runId: run.runId, title: run.title });
  }

  setupActionRuns.set(runId, run);
  latestRunByActionId.set(action.id, runId);
  pruneOldRuns();

  try {
    const homeBrewLocal = path.join(os.homedir(), '.homebrew', 'bin');
    const brewPrefix = process.arch === 'arm64' ? '/opt/homebrew/bin' : '/usr/local/bin';
    const pathEnv = `${homeBrewLocal}:${brewPrefix}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`;
    const npmGlobalBin = path.join(os.homedir(), '.npm-global', 'bin');
    const nPrefix = path.join(os.homedir(), '.nvm', 'versions', 'node');
    let fullPath = `${npmGlobalBin}:${homeBrewLocal}:${brewPrefix}:${pathEnv}`;
    try {
      const nvmVersions = fs.readdirSync(nPrefix);
      if (nvmVersions.length > 0) {
        const latest = nvmVersions.sort().pop();
        fullPath = `${path.join(nPrefix, latest, 'bin')}:${fullPath}`;
      }
    } catch { /* nvm not installed */ }

    const child = spawn(
      '/bin/bash',
      ['-l', '-c', String(action.command || '')],
      {
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PATH: fullPath,
          NONINTERACTIVE: '1',
          HOMEBREW_NO_AUTO_UPDATE: '1'
        }
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
      if (action.id === 'gh-login') {
        appendGhLoginDebugLog('run_closed', {
          runId: run.runId,
          status: run.status,
          exitCode: run.exitCode,
          error: run.error || null,
          parsedCode: run.ghDeviceCode || null,
          parsedUrl: run.ghDeviceUrl || null,
          sawHint: !!run.ghHasDeviceHint
        });
      }
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
  if (platform !== 'win32' && platform !== 'darwin') {
    const err = new Error('Setup actions are currently implemented for Windows and macOS only.');
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

  const run = platform === 'darwin' ? launchShellCommand(action) : launchPowerShellCommand(action);
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

async function configureGitIdentity({ name, email } = {}, platform = process.platform) {
  if (platform !== 'win32' && platform !== 'darwin') {
    const err = new Error('Git identity setup is currently implemented for Windows and macOS only.');
    err.code = 'unsupported_platform';
    throw err;
  }

  const normalizedName = String(name || '').trim();
  const normalizedEmail = String(email || '').trim();
  if (!normalizedName || !normalizedEmail) {
    const err = new Error('Both name and email are required.');
    err.code = 'invalid_input';
    throw err;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    const err = new Error('Enter a valid email address.');
    err.code = 'invalid_input';
    throw err;
  }

  const gitCommand = await resolveGitCommand(platform);
  if (!gitCommand) {
    const err = new Error('Git is not installed or not available on PATH.');
    err.code = 'missing_git';
    throw err;
  }

  await runGitCommand(gitCommand, ['config', '--global', 'user.name', normalizedName]);
  await runGitCommand(gitCommand, ['config', '--global', 'user.email', normalizedEmail]);

  const savedName = firstNonEmptyLine(await runGitCommand(gitCommand, ['config', '--global', '--get', 'user.name']));
  const savedEmail = firstNonEmptyLine(await runGitCommand(gitCommand, ['config', '--global', '--get', 'user.email']));

  if (!savedName || !savedEmail) {
    const err = new Error('Git identity was saved, but verification failed.');
    err.code = 'verify_failed';
    throw err;
  }

  return {
    id: 'configure-git-identity',
    title: 'Configure Git identity',
    ok: true,
    gitCommand,
    name: savedName,
    email: savedEmail,
    summary: `${savedName} <${savedEmail}>`,
    message: 'Git identity saved successfully.'
  };
}

module.exports = {
  getSetupActions,
  getSetupActionById,
  runSetupAction,
  getSetupActionRun,
  getLatestSetupActionRun,
  configureGitIdentity
};
