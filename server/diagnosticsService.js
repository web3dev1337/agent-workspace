const os = require('os');
const fs = require('fs');
const path = require('path');
const util = require('util');
const { execFile } = require('child_process');

const execFileAsync = util.promisify(execFile);

async function checkCommand(command, args, options = {}) {
  const timeout = Number(options.timeoutMs) || 2500;
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout,
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });
    const output = String(stdout || stderr || '').trim();
    const firstLine = output.split(/\r?\n/).find(Boolean) || '';
    return { ok: true, command, args, version: firstLine || null };
  } catch (error) {
    const code = error?.code || null;
    const message = String(error?.message || error || '').trim();
    return { ok: false, command, args, code, error: message };
  }
}

async function checkFirstAvailable(candidates) {
  for (const c of candidates) {
    const res = await checkCommand(c.command, c.args, c.options);
    if (res.ok) return res;
  }
  // Return the last attempt (or a synthetic failure).
  const last = candidates[candidates.length - 1];
  if (!last) return { ok: false, command: null, args: null, error: 'no candidates' };
  return await checkCommand(last.command, last.args, last.options);
}

function findTool(tools, id) {
  if (!Array.isArray(tools)) return null;
  return tools.find((tool) => String(tool?.id || '') === String(id || '')) || null;
}

function buildPlatformSmoke({ platform, tools }) {
  const shellToolId = platform === 'win32' ? 'powershell' : 'bash';
  const shellTool = findTool(tools, shellToolId);
  const gitTool = findTool(tools, 'git');
  const ghTool = findTool(tools, 'gh');
  const ghAuthTool = findTool(tools, 'ghAuth');

  const checks = {
    shell: {
      id: shellToolId,
      ok: !!shellTool?.ok,
      error: shellTool?.ok ? null : String(shellTool?.error || shellTool?.code || 'missing')
    },
    git: {
      ok: !!gitTool?.ok,
      error: gitTool?.ok ? null : String(gitTool?.error || gitTool?.code || 'missing')
    },
    gh: {
      ok: !!ghTool?.ok,
      error: ghTool?.ok ? null : String(ghTool?.error || ghTool?.code || 'missing')
    },
    ghAuth: {
      ok: !!ghAuthTool?.ok,
      error: ghAuthTool?.ok ? null : String(ghAuthTool?.error || ghAuthTool?.code || 'not authenticated')
    }
  };

  return {
    ok: checks.shell.ok && checks.git.ok,
    checks
  };
}

async function collectDiagnostics() {
  const platform = process.platform;
  const homeDir = process.env.HOME || os.homedir();

  let nodePty = { ok: true };
  try {
    require('node-pty');
  } catch (error) {
    nodePty = { ok: false, error: String(error?.message || error) };
  }

  const tools = [];

  tools.push({
    id: 'node',
    name: 'Node.js',
    ...(await checkCommand(process.execPath || 'node', ['--version']))
  });

  tools.push({
    id: 'npm',
    name: 'npm',
    ...(await checkCommand(platform === 'win32' ? 'npm.cmd' : 'npm', ['--version']))
  });

  tools.push({
    id: 'git',
    name: 'Git',
    ...(await checkCommand('git', ['--version']))
  });

  tools.push({
    id: 'gh',
    name: 'GitHub CLI',
    ...(await checkCommand('gh', ['--version']))
  });
  // Auth status is the most common root cause of "0 files/commits" in PR tooling on Windows.
  // We keep it lightweight: first line of `gh auth status` is enough to spot "not logged in".
  tools.push({
    id: 'ghAuth',
    name: 'GitHub CLI auth',
    ...(await checkCommand('gh', ['auth', 'status']))
  });

  tools.push({
    id: 'claude',
    name: 'Claude Code',
    ...(await checkCommand('claude', ['--version']))
  });

  tools.push({
    id: 'codex',
    name: 'Codex CLI',
    ...(await checkCommand('codex', ['--version']))
  });

  tools.push({
    id: 'ffmpeg',
    name: 'ffmpeg',
    ...(await checkCommand('ffmpeg', ['-version']))
  });

  tools.push({
    id: 'python',
    name: 'Python',
    ...(await checkFirstAvailable([
      { command: platform === 'win32' ? 'python' : 'python3', args: ['--version'] },
      { command: 'python', args: ['--version'] }
    ]))
  });

  if (platform === 'win32') {
    tools.push({
      id: 'powershell',
      name: 'PowerShell',
      ...(await checkCommand('powershell.exe', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()']))
    });
    tools.push({
      id: 'wsl',
      name: 'WSL',
      ...(await checkCommand('wsl.exe', ['-l', '-q'], { timeoutMs: 4000 }))
    });
    tools.push({
      id: 'bash',
      name: 'bash (if installed)',
      ...(await checkFirstAvailable([
        { command: 'bash.exe', args: ['--version'], options: { timeoutMs: 2000 } },
        { command: 'bash', args: ['--version'], options: { timeoutMs: 2000 } }
      ]))
    });
  } else {
    tools.push({
      id: 'bash',
      name: 'bash',
      ...(await checkCommand('bash', ['--version'], { timeoutMs: 2000 }))
    });
  }

  const platformSmoke = buildPlatformSmoke({ platform, tools });

  return {
    generatedAt: new Date().toISOString(),
    platform,
    nodePty,
    env: {
      HOME: process.env.HOME || null,
      USERPROFILE: process.env.USERPROFILE || null,
      homeDir
    },
    paths: {
      orchestratorDir: path.resolve(__dirname, '..')
    },
    tools,
    platformSmoke
  };
}

function findToolResult(data, id) {
  const list = Array.isArray(data?.tools) ? data.tools : [];
  return list.find((item) => String(item?.id || '') === String(id || '')) || null;
}

function createCheck({
  id,
  name,
  pass,
  severity = 'warning',
  passMessage = 'ok',
  failMessage = 'failed',
  details = null,
  repairActions = []
}) {
  return {
    id: String(id || '').trim(),
    name: String(name || '').trim(),
    severity: pass ? 'info' : String(severity || 'warning').trim().toLowerCase(),
    status: pass ? 'pass' : 'fail',
    message: pass ? String(passMessage || 'ok') : String(failMessage || 'failed'),
    details: details || null,
    repairActions: Array.isArray(repairActions) ? repairActions : []
  };
}

function isWritableDirectory(dirPath) {
  try {
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function collectRepairActions(checks) {
  const seen = new Set();
  const actions = [];
  for (const check of checks || []) {
    for (const action of Array.isArray(check?.repairActions) ? check.repairActions : []) {
      const id = String(action?.id || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      actions.push(action);
    }
  }
  return actions;
}

async function collectFirstRunDiagnostics(options = {}) {
  const data = await collectDiagnostics();
  const homeDir = String(options.homeDir || data?.env?.homeDir || os.homedir() || '').trim();
  const rootDir = String(options.rootDir || path.resolve(__dirname, '..')).trim();
  const orchestratorDir = path.join(homeDir, '.orchestrator');
  const workspacesDir = path.join(orchestratorDir, 'workspaces');
  const githubRoot = path.join(homeDir, 'GitHub');

  const git = findToolResult(data, 'git');
  const gh = findToolResult(data, 'gh');
  const ghAuth = findToolResult(data, 'ghAuth');
  const claude = findToolResult(data, 'claude');
  const codex = findToolResult(data, 'codex');

  const checks = [];

  checks.push(createCheck({
    id: 'git-installed',
    name: 'Git installed',
    pass: !!git?.ok,
    severity: 'blocking',
    passMessage: String(git?.version || 'Git available'),
    failMessage: 'Git is required for worktree and PR workflows',
    details: git?.error || null
  }));

  checks.push(createCheck({
    id: 'node-pty-loaded',
    name: 'node-pty available',
    pass: !!data?.nodePty?.ok,
    severity: 'blocking',
    passMessage: 'node-pty loaded successfully',
    failMessage: 'node-pty is missing or failed to load',
    details: data?.nodePty?.error || null,
    repairActions: [
      {
        id: 'rebuild-node-pty',
        label: 'Rebuild node-pty',
        kind: 'safe',
        command: 'npm rebuild node-pty'
      }
    ]
  }));

  checks.push(createCheck({
    id: 'orchestrator-home',
    name: 'Orchestrator data directory',
    pass: fs.existsSync(orchestratorDir) && isWritableDirectory(orchestratorDir),
    severity: 'warning',
    passMessage: orchestratorDir,
    failMessage: `Missing or not writable: ${orchestratorDir}`,
    repairActions: [
      {
        id: 'ensure-orchestrator-home',
        label: 'Create ~/.orchestrator',
        kind: 'safe'
      }
    ]
  }));

  checks.push(createCheck({
    id: 'orchestrator-workspaces',
    name: 'Workspace store directory',
    pass: fs.existsSync(workspacesDir) && isWritableDirectory(workspacesDir),
    severity: 'warning',
    passMessage: workspacesDir,
    failMessage: `Missing or not writable: ${workspacesDir}`,
    repairActions: [
      {
        id: 'ensure-workspaces-dir',
        label: 'Create ~/.orchestrator/workspaces',
        kind: 'safe'
      }
    ]
  }));

  checks.push(createCheck({
    id: 'repo-scan-root',
    name: 'Repo scan root (~/GitHub)',
    pass: fs.existsSync(githubRoot) && isWritableDirectory(githubRoot),
    severity: 'warning',
    passMessage: githubRoot,
    failMessage: `Repo root missing or not writable: ${githubRoot}`,
    repairActions: [
      {
        id: 'ensure-github-root',
        label: 'Create ~/GitHub',
        kind: 'safe'
      }
    ]
  }));

  checks.push(createCheck({
    id: 'gh-installed',
    name: 'GitHub CLI installed',
    pass: !!gh?.ok,
    severity: 'warning',
    passMessage: String(gh?.version || 'gh available'),
    failMessage: 'gh is not installed (PR/review features will be limited)',
    details: gh?.error || null
  }));

  checks.push(createCheck({
    id: 'gh-auth',
    name: 'GitHub CLI authentication',
    pass: !gh?.ok ? false : !!ghAuth?.ok,
    severity: 'warning',
    passMessage: 'gh auth is ready',
    failMessage: !gh?.ok ? 'gh not installed, cannot verify auth' : 'gh is not authenticated',
    details: ghAuth?.error || null,
    repairActions: [
      {
        id: 'gh-auth-login',
        label: 'Run gh auth login',
        kind: 'manual',
        command: 'gh auth login'
      }
    ]
  }));

  checks.push(createCheck({
    id: 'claude-cli',
    name: 'Claude CLI',
    pass: !!claude?.ok,
    severity: 'warning',
    passMessage: String(claude?.version || 'claude available'),
    failMessage: 'Claude CLI not found (Claude sessions unavailable)',
    details: claude?.error || null
  }));

  checks.push(createCheck({
    id: 'codex-cli',
    name: 'Codex CLI',
    pass: !!codex?.ok,
    severity: 'warning',
    passMessage: String(codex?.version || 'codex available'),
    failMessage: 'Codex CLI not found (Codex sessions unavailable)',
    details: codex?.error || null
  }));

  const blockingCount = checks.filter((check) => check.status === 'fail' && check.severity === 'blocking').length;
  const warningCount = checks.filter((check) => check.status === 'fail' && check.severity !== 'blocking').length;
  const repairActions = collectRepairActions(checks);

  return {
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    rootDir,
    paths: {
      homeDir,
      orchestratorDir,
      workspacesDir,
      githubRoot
    },
    summary: {
      ready: blockingCount === 0,
      blockingCount,
      warningCount,
      totalChecks: checks.length,
      repairableCount: repairActions.length
    },
    checks,
    repairActions
  };
}

async function runFirstRunRepair({ action, rootDir, homeDir } = {}) {
  const actionId = String(action || '').trim();
  const resolvedRoot = String(rootDir || path.resolve(__dirname, '..')).trim();
  const resolvedHomeDir = String(homeDir || os.homedir() || '').trim();
  const orchestratorDir = path.join(resolvedHomeDir, '.orchestrator');
  const workspacesDir = path.join(orchestratorDir, 'workspaces');
  const githubRoot = path.join(resolvedHomeDir, 'GitHub');

  if (!actionId) {
    throw new Error('repair action is required');
  }

  if (actionId === 'ensure-orchestrator-home') {
    fs.mkdirSync(orchestratorDir, { recursive: true });
    return { ok: true, action: actionId, message: `Created ${orchestratorDir}` };
  }

  if (actionId === 'ensure-workspaces-dir') {
    fs.mkdirSync(workspacesDir, { recursive: true });
    return { ok: true, action: actionId, message: `Created ${workspacesDir}` };
  }

  if (actionId === 'ensure-github-root') {
    fs.mkdirSync(githubRoot, { recursive: true });
    return { ok: true, action: actionId, message: `Created ${githubRoot}` };
  }

  if (actionId === 'rebuild-node-pty') {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const { stdout, stderr } = await execFileAsync(npmCmd, ['rebuild', 'node-pty'], {
      cwd: resolvedRoot,
      timeout: 180000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024
    });
    const output = String(stdout || stderr || '').trim();
    return { ok: true, action: actionId, message: 'Rebuilt node-pty', output };
  }

  if (actionId === 'gh-auth-login') {
    return {
      ok: false,
      manual: true,
      action: actionId,
      message: 'Interactive login required. Run `gh auth login` in a terminal.'
    };
  }

  throw new Error(`Unknown repair action: ${actionId}`);
}

module.exports = { collectDiagnostics, collectFirstRunDiagnostics, runFirstRunRepair };
