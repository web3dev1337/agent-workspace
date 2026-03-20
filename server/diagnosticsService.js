const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { augmentProcessEnv, getHiddenProcessOptions } = require('./utils/processUtils');
const { getAgentWorkspaceDir, getProjectsRoot } = require('./utils/pathUtils');

const IS_WIN = process.platform === 'win32';

function execQuiet(command, args, options = {}) {
  const timeout = Number(options.timeout) || 2500;
  const maxBuffer = options.maxBuffer || 1024 * 1024;
  return new Promise((resolve, reject) => {
    const cmdStr = String(command || '').trim();
    const argsArr = Array.isArray(args) ? args : [];
    // On Windows, route .cmd/.bat through cmd.exe directly to avoid retry flashing
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

async function checkCommand(command, args, options = {}) {
  const timeout = Number(options.timeoutMs) || 2500;
  try {
    const result = await execQuiet(command, args, { timeout, maxBuffer: 1024 * 1024 });

    const { stdout, stderr } = result || {};
    const output = String(stdout || stderr || '').trim();
    const firstLine = output.split(/\r?\n/).find(Boolean) || '';
    return {
      ok: true,
      command,
      args,
      version: firstLine || null,
      output: output || null
    };
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

function uniqueCommandCandidates(candidates = []) {
  const seen = new Set();
  const out = [];
  for (const candidate of candidates) {
    const command = String(candidate?.command || '').trim();
    if (!command) continue;
    const args = Array.isArray(candidate?.args) ? candidate.args : [];
    const key = `${command}::${JSON.stringify(args)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ command, args, options: candidate?.options });
  }
  return out;
}

async function checkNpmGlobalPackage(npmCommand, packageName) {
  const npm = String(npmCommand || '').trim();
  const pkg = String(packageName || '').trim();
  if (!npm || !pkg) {
    return { ok: false, error: 'Missing npm command or package name' };
  }

  const res = await checkCommand(npm, ['list', '-g', pkg, '--depth=0'], { timeoutMs: 7000 });
  const combined = String(res?.output || res?.version || '').trim();
  const pkgPattern = new RegExp(`${pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}@([^\\s]+)`, 'i');
  const versionMatch = combined.match(pkgPattern);
  if (!res.ok || !versionMatch?.[1]) {
    return {
      ok: false,
      command: npm,
      args: ['list', '-g', pkg, '--depth=0'],
      error: String(res?.error || `Package ${pkg} not found in npm global list`)
    };
  }

  return {
    ok: true,
    command: `npm-global:${pkg}`,
    args: ['list', '-g', pkg, '--depth=0'],
    version: `${pkg}@${versionMatch[1]} (npm global)`
  };
}

async function checkGitIdentity(gitCommand, gitInstalled) {
  const command = String(gitCommand || 'git').trim() || 'git';
  if (!gitInstalled) {
    return {
      ok: false,
      command,
      args: ['config', '--global', '--get', 'user.name'],
      error: 'Git is not installed'
    };
  }

  const nameCheck = await checkCommand(command, ['config', '--global', '--get', 'user.name']);
  const emailCheck = await checkCommand(command, ['config', '--global', '--get', 'user.email']);
  const name = String(nameCheck?.version || '').trim();
  const email = String(emailCheck?.version || '').trim();

  if (name && email) {
    return {
      ok: true,
      command,
      args: ['config', '--global', '--get', 'user.name,user.email'],
      version: `${name} <${email}>`
    };
  }

  const missing = [];
  if (!name) missing.push('user.name');
  if (!email) missing.push('user.email');

  return {
    ok: false,
    command,
    args: ['config', '--global', '--get', 'user.name,user.email'],
    error: `Missing global Git setting(s): ${missing.join(', ')}`
  };
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

function getMacBrewPrefixes() {
  const home = os.homedir();
  return [
    path.join(home, '.homebrew', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin'
  ];
}

function getMacNvmNodeBins() {
  const nvmDir = path.join(os.homedir(), '.nvm', 'versions', 'node');
  try {
    const versions = fs.readdirSync(nvmDir);
    return versions.sort().reverse().map((v) => path.join(nvmDir, v, 'bin'));
  } catch { return []; }
}

function macCandidates(binary) {
  if (process.platform !== 'darwin') return [];
  const prefixes = [...getMacNvmNodeBins(), ...getMacBrewPrefixes()];
  return prefixes.map((p) => ({ command: path.join(p, binary), args: ['--version'] }));
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

  if (platform === 'darwin') {
    const brewCandidates = uniqueCommandCandidates([
      { command: 'brew', args: ['--version'] },
      ...macCandidates('brew')
    ]);
    tools.push({
      id: 'brew',
      name: 'Homebrew',
      ...(await checkFirstAvailable(brewCandidates))
    });
  }

  const isBundledNode = String(process.execPath || '').includes('.app/Contents/Resources/');
  const nodeCandidates = uniqueCommandCandidates([
    { command: 'node', args: ['--version'] },
    { command: platform === 'win32' ? 'node.exe' : 'node', args: ['--version'] },
    ...macCandidates('node'),
    platform === 'win32' ? { command: path.join(process.env.ProgramFiles || '', 'nodejs', 'node.exe'), args: ['--version'] } : null,
    platform === 'win32' ? { command: path.join(process.env['ProgramFiles(x86)'] || '', 'nodejs', 'node.exe'), args: ['--version'] } : null,
    platform === 'win32' ? { command: path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs', 'node.exe'), args: ['--version'] } : null,
    isBundledNode ? null : { command: process.execPath || 'node', args: ['--version'] }
  ]);
  const nodeCheck = await checkFirstAvailable(nodeCandidates);
  const nodeCommand = String(nodeCheck?.command || '').trim();
  const nodeDir = nodeCommand ? path.dirname(nodeCommand) : '';

  const npmCandidates = uniqueCommandCandidates([
    { command: platform === 'win32' ? 'npm.cmd' : 'npm', args: ['--version'] },
    platform === 'win32' ? { command: 'npm', args: ['--version'] } : null,
    ...macCandidates('npm'),
    platform === 'win32' && nodeDir ? { command: path.join(nodeDir, 'npm.cmd'), args: ['--version'] } : null,
    platform === 'win32' ? { command: path.join(process.env.ProgramFiles || '', 'nodejs', 'npm.cmd'), args: ['--version'] } : null,
    platform === 'win32' ? { command: path.join(process.env['ProgramFiles(x86)'] || '', 'nodejs', 'npm.cmd'), args: ['--version'] } : null,
    platform === 'win32' ? { command: path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs', 'npm.cmd'), args: ['--version'] } : null
  ]);
  const npmCheck = await checkFirstAvailable(npmCandidates);

  tools.push({
    id: 'node',
    name: 'Node.js',
    ...nodeCheck
  });

  tools.push({
    id: 'npm',
    name: 'npm',
    ...npmCheck
  });

  const gitCandidates = uniqueCommandCandidates([
    { command: 'git', args: ['--version'] },
    ...macCandidates('git'),
    platform === 'win32' ? { command: 'git.exe', args: ['--version'] } : null,
    platform === 'win32' ? { command: path.join(process.env.ProgramFiles || '', 'Git', 'cmd', 'git.exe'), args: ['--version'] } : null,
    platform === 'win32' ? { command: path.join(process.env.ProgramFiles || '', 'Git', 'bin', 'git.exe'), args: ['--version'] } : null,
    platform === 'win32' ? { command: path.join(process.env['ProgramFiles(x86)'] || '', 'Git', 'cmd', 'git.exe'), args: ['--version'] } : null,
    platform === 'win32' ? { command: path.join(process.env['ProgramFiles(x86)'] || '', 'Git', 'bin', 'git.exe'), args: ['--version'] } : null,
    platform === 'win32' ? { command: path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'cmd', 'git.exe'), args: ['--version'] } : null
  ]);

  tools.push({
    id: 'git',
    name: 'Git',
    ...(await checkFirstAvailable(gitCandidates))
  });
  const gitTool = tools[tools.length - 1];
  tools.push({
    id: 'gitIdentity',
    name: 'Git identity',
    ...(await checkGitIdentity(gitTool?.command, !!gitTool?.ok))
  });

  const ghCandidates = uniqueCommandCandidates([
    { command: 'gh', args: ['--version'] },
    ...macCandidates('gh'),
    platform === 'win32' ? { command: 'gh.exe', args: ['--version'] } : null,
    platform === 'win32' ? { command: path.join(process.env.ProgramFiles || '', 'GitHub CLI', 'gh.exe'), args: ['--version'] } : null,
    platform === 'win32' ? { command: path.join(process.env['ProgramFiles(x86)'] || '', 'GitHub CLI', 'gh.exe'), args: ['--version'] } : null,
    platform === 'win32' ? { command: path.join(process.env.LOCALAPPDATA || '', 'Programs', 'GitHub CLI', 'gh.exe'), args: ['--version'] } : null
  ]);
  const ghCheck = await checkFirstAvailable(ghCandidates);
  tools.push({
    id: 'gh',
    name: 'GitHub CLI',
    ...ghCheck
  });
  // Auth status is the most common root cause of "0 files/commits" in PR tooling on Windows.
  // We keep it lightweight: first line of `gh auth status` is enough to spot "not logged in".
  const ghAuthCheck = ghCheck?.ok
    ? await checkCommand(String(ghCheck.command || 'gh'), ['auth', 'status'])
    : {
        ok: false,
        command: String(ghCheck?.command || 'gh'),
        args: ['auth', 'status'],
        error: 'GitHub CLI is not installed'
      };
  tools.push({
    id: 'ghAuth',
    name: 'GitHub CLI auth',
    ...ghAuthCheck
  });

  const claudeCandidates = uniqueCommandCandidates([
    { command: 'claude', args: ['--version'] },
    platform === 'win32' ? { command: 'claude.cmd', args: ['--version'] } : null,
    platform === 'win32' ? { command: 'claude.exe', args: ['--version'] } : null,
    platform === 'win32' ? { command: path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'), args: ['--version'] } : null,
    platform === 'win32' ? { command: path.join(process.env.APPDATA || '', 'npm', 'claude'), args: ['--version'] } : null,
    platform === 'win32' ? { command: path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'claude.exe'), args: ['--version'] } : null,
    platform === 'win32' ? { command: path.join(process.env.USERPROFILE || '', '.local', 'bin', 'claude.exe'), args: ['--version'] } : null,
    platform === 'win32' ? { command: path.join(process.env.USERPROFILE || '', '.claude', 'local', 'claude.exe'), args: ['--version'] } : null,
    platform === 'win32' ? { command: path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Claude', 'claude.exe'), args: ['--version'] } : null
  ]);
  tools.push({
    id: 'claude',
    name: 'Claude Code',
    ...(await checkFirstAvailable(claudeCandidates))
  });

  const codexCandidates = uniqueCommandCandidates([
    { command: 'codex', args: ['--version'] },
    platform === 'win32' ? { command: 'codex.cmd', args: ['--version'] } : null,
    platform === 'win32' ? { command: 'codex.exe', args: ['--version'] } : null,
    platform === 'win32' ? { command: path.join(process.env.APPDATA || '', 'npm', 'codex.cmd'), args: ['--version'] } : null,
    platform === 'win32' ? { command: path.join(process.env.APPDATA || '', 'npm', 'codex'), args: ['--version'] } : null,
    platform === 'win32' ? { command: path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'codex.exe'), args: ['--version'] } : null,
    platform === 'win32' ? { command: path.join(process.env.USERPROFILE || '', '.local', 'bin', 'codex.exe'), args: ['--version'] } : null
  ]);
  let codexCheck = await checkFirstAvailable(codexCandidates);
  if (!codexCheck?.ok && npmCheck?.ok) {
    const npmPackageCheck = await checkNpmGlobalPackage(String(npmCheck.command || '').trim(), '@openai/codex');
    if (npmPackageCheck?.ok) {
      codexCheck = npmPackageCheck;
    }
  }
  tools.push({
    id: 'codex',
    name: 'Codex CLI',
    ...codexCheck
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

function toInstallWizardStep({
  check,
  title,
  help = '',
  defaultCommand = null,
  details = null
} = {}) {
  const status = String(check?.status || 'unknown').trim().toLowerCase();
  const severity = String(check?.severity || 'warning').trim().toLowerCase();
  const repairActions = Array.isArray(check?.repairActions) ? check.repairActions : [];
  const safeAction = repairActions.find((action) => String(action?.kind || '').trim().toLowerCase() === 'safe') || null;
  const manualAction = repairActions.find((action) => String(action?.kind || '').trim().toLowerCase() === 'manual') || null;
  const command = defaultCommand || String(manualAction?.command || '').trim() || null;

  return {
    id: String(check?.id || '').trim(),
    title: String(title || check?.name || '').trim(),
    status,
    severity,
    blocking: severity === 'blocking',
    message: String(check?.message || '').trim() || null,
    details: details || check?.details || null,
    help: String(help || '').trim() || null,
    autoFixActionId: safeAction ? String(safeAction.id || '').trim() : null,
    command
  };
}

function buildInstallWizardReport(firstRunDiagnostics, baseDiagnostics) {
  const firstRun = (firstRunDiagnostics && typeof firstRunDiagnostics === 'object') ? firstRunDiagnostics : {};
  const base = (baseDiagnostics && typeof baseDiagnostics === 'object') ? baseDiagnostics : {};
  const checks = Array.isArray(firstRun?.checks) ? firstRun.checks : [];
  const byId = new Map(checks.map((check) => [String(check?.id || '').trim(), check]));
  const platform = String(base?.platform || firstRun?.platform || process.platform || '').trim();

  const shellId = platform === 'win32' ? 'powershell' : 'bash';
  const shellCheck = {
    id: 'shell-runtime',
    name: shellId === 'powershell' ? 'PowerShell runtime' : 'bash runtime',
    status: base?.platformSmoke?.checks?.shell?.ok ? 'pass' : 'fail',
    severity: 'blocking',
    message: base?.platformSmoke?.checks?.shell?.ok ? `${shellId} is available` : `${shellId} is missing`,
    details: base?.platformSmoke?.checks?.shell?.error || null,
    repairActions: []
  };

  const steps = [
    toInstallWizardStep({
      check: shellCheck,
      title: shellId === 'powershell' ? 'PowerShell runtime' : 'Shell runtime',
      help: shellId === 'powershell'
        ? 'Commander relies on PowerShell for reliable session execution on Windows.'
        : 'Shell runtime is required for terminal session commands.'
    }),
    toInstallWizardStep({
      check: byId.get('git-installed'),
      title: 'Install Git',
      help: 'Git is required for all worktree and PR workflows.'
    }),
    toInstallWizardStep({
      check: byId.get('gh-installed'),
      title: 'Install GitHub CLI',
      help: 'Review Console PR data, merge, and review actions require gh.'
    }),
    toInstallWizardStep({
      check: byId.get('gh-auth'),
      title: 'Authenticate GitHub CLI',
      help: 'Run login once, then verify before using review workflows.',
      defaultCommand: 'gh auth login && gh auth status'
    }),
    toInstallWizardStep({
      check: byId.get('node-pty-loaded'),
      title: 'Repair terminal runtime (node-pty)',
      help: 'If this fails, the terminal grid cannot attach PTYs reliably.'
    }),
    toInstallWizardStep({
      check: byId.get('agent-workspace-home'),
      title: 'Create ~/.agent-workspace',
      help: 'Stores workspace/session metadata and local settings.'
    }),
    toInstallWizardStep({
      check: byId.get('agent-workspace-workspaces'),
      title: 'Create ~/.agent-workspace/workspaces',
      help: 'Workspace definitions must be writable to persist tabs/worktrees.'
    }),
    toInstallWizardStep({
      check: byId.get('projects-root'),
      title: 'Create projects root',
      help: 'Repo discovery uses the configured projects directory.'
    }),
    toInstallWizardStep({
      check: byId.get('claude-cli'),
      title: 'Install Claude CLI',
      help: 'Required for Claude agent sessions.'
    }),
    toInstallWizardStep({
      check: byId.get('codex-cli'),
      title: 'Install Codex CLI',
      help: 'Required for Codex agent sessions.'
    })
  ].filter((step) => step.id);

  const blockingCount = steps.filter((step) => step.status === 'fail' && step.blocking).length;
  const warningCount = steps.filter((step) => step.status === 'fail' && !step.blocking).length;
  const actionable = steps.filter((step) => step.status === 'fail').map((step) => ({
    id: step.id,
    title: step.title,
    autoFixActionId: step.autoFixActionId,
    command: step.command
  }));

  const guidance = [];
  if (platform === 'win32') {
    guidance.push('Windows-first flow: run PowerShell as your default shell for Commander sessions.');
    guidance.push('If terminal startup fails after dependency updates, run: npm rebuild node-pty');
    guidance.push('After gh login, rerun post-install checks before using Review Console merge/review actions.');
  } else if (platform === 'darwin') {
    guidance.push('macOS flow: ensure Terminal can find bash, git, and gh before launching orchestrator.');
    guidance.push('If terminal startup fails after dependency updates, run: npm rebuild node-pty');
    guidance.push('After gh login, rerun the scan before using Review Console merge/review actions.');
  } else {
    guidance.push('Linux flow: ensure bash, git, and gh are in PATH before launching orchestrator.');
  }

  return {
    generatedAt: new Date().toISOString(),
    platform,
    summary: {
      ready: blockingCount === 0,
      blockingCount,
      warningCount,
      totalSteps: steps.length
    },
    steps,
    actionable,
    guidance
  };
}

async function collectFirstRunDiagnostics(options = {}) {
  const data = await collectDiagnostics();
  const homeDir = String(options.homeDir || data?.env?.homeDir || os.homedir() || '').trim();
  const rootDir = String(options.rootDir || path.resolve(__dirname, '..')).trim();
  const orchestratorDir = options.homeDir ? path.join(homeDir, '.agent-workspace') : getAgentWorkspaceDir();
  const workspacesDir = path.join(orchestratorDir, 'workspaces');
  const projectsRoot = options.homeDir ? path.join(orchestratorDir, 'projects') : getProjectsRoot();

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
    id: 'agent-workspace-home',
    name: 'Agent Workspace data directory',
    pass: fs.existsSync(orchestratorDir) && isWritableDirectory(orchestratorDir),
    severity: 'warning',
    passMessage: orchestratorDir,
    failMessage: `Missing or not writable: ${orchestratorDir}`,
    repairActions: [
      {
        id: 'ensure-agent-workspace-home',
        label: `Create ${orchestratorDir}`,
        kind: 'safe'
      }
    ]
  }));

  checks.push(createCheck({
    id: 'agent-workspace-workspaces',
    name: 'Workspace store directory',
    pass: fs.existsSync(workspacesDir) && isWritableDirectory(workspacesDir),
    severity: 'warning',
    passMessage: workspacesDir,
    failMessage: `Missing or not writable: ${workspacesDir}`,
    repairActions: [
      {
        id: 'ensure-workspaces-dir',
        label: `Create ${workspacesDir}`,
        kind: 'safe'
      }
    ]
  }));

  checks.push(createCheck({
    id: 'projects-root',
    name: 'Projects directory',
    pass: fs.existsSync(projectsRoot) && isWritableDirectory(projectsRoot),
    severity: 'warning',
    passMessage: projectsRoot,
    failMessage: `Projects root missing or not writable: ${projectsRoot}`,
    repairActions: [
      {
        id: 'ensure-projects-root',
        label: `Create ${projectsRoot}`,
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
      projectsRoot
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
  const orchestratorDir = homeDir ? path.join(resolvedHomeDir, '.agent-workspace') : getAgentWorkspaceDir();
  const workspacesDir = path.join(orchestratorDir, 'workspaces');
  const projectsRoot = homeDir ? path.join(orchestratorDir, 'projects') : getProjectsRoot();

  if (!actionId) {
    throw new Error('repair action is required');
  }

  if (actionId === 'ensure-agent-workspace-home') {
    fs.mkdirSync(orchestratorDir, { recursive: true });
    return { ok: true, action: actionId, message: `Created ${orchestratorDir}` };
  }

  if (actionId === 'ensure-workspaces-dir') {
    fs.mkdirSync(workspacesDir, { recursive: true });
    return { ok: true, action: actionId, message: `Created ${workspacesDir}` };
  }

  if (actionId === 'ensure-projects-root') {
    fs.mkdirSync(projectsRoot, { recursive: true });
    return { ok: true, action: actionId, message: `Created ${projectsRoot}` };
  }

  if (actionId === 'rebuild-node-pty') {
    const npmCmd = IS_WIN ? 'npm.cmd' : 'npm';
    const { stdout, stderr } = await execQuiet(npmCmd, ['rebuild', 'node-pty'], {
      timeout: 180000,
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

async function runFirstRunSafeRepairs({ rootDir, homeDir } = {}) {
  const diagnosticsBefore = await collectFirstRunDiagnostics({ rootDir, homeDir });
  const allActions = Array.isArray(diagnosticsBefore?.repairActions) ? diagnosticsBefore.repairActions : [];
  const safeActions = allActions.filter((action) => String(action?.kind || '').trim().toLowerCase() === 'safe');
  const manualActions = allActions.filter((action) => String(action?.kind || '').trim().toLowerCase() !== 'safe');
  const results = [];

  for (const action of safeActions) {
    const actionId = String(action?.id || '').trim();
    if (!actionId) continue;
    try {
      const result = await runFirstRunRepair({ action: actionId, rootDir, homeDir });
      results.push({
        action: actionId,
        ok: !!result?.ok,
        manual: !!result?.manual,
        message: String(result?.message || '').trim() || null
      });
    } catch (error) {
      results.push({
        action: actionId,
        ok: false,
        manual: false,
        message: String(error?.message || error || 'repair failed')
      });
    }
  }

  const diagnostics = await collectFirstRunDiagnostics({ rootDir, homeDir });
  const appliedCount = results.filter((result) => result.ok).length;
  const failedCount = results.filter((result) => !result.ok).length;

  return {
    ok: failedCount === 0,
    attemptedCount: safeActions.length,
    appliedCount,
    failedCount,
    skippedManualCount: manualActions.length,
    results,
    diagnostics
  };
}

async function collectInstallWizard({ rootDir, homeDir } = {}) {
  const [base, firstRun] = await Promise.all([
    collectDiagnostics(),
    collectFirstRunDiagnostics({ rootDir, homeDir })
  ]);
  return buildInstallWizardReport(firstRun, base);
}

module.exports = {
  collectDiagnostics,
  collectFirstRunDiagnostics,
  collectInstallWizard,
  runFirstRunRepair,
  runFirstRunSafeRepairs
};
