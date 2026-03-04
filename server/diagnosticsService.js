const os = require('os');
const path = require('path');
const util = require('util');
const { execFile } = require('child_process');

const execFileAsync = util.promisify(execFile);

async function checkCommand(command, args, options = {}) {
  const timeout = Number(options.timeoutMs) || 2500;
  try {
    const runOptions = {
      timeout,
      windowsHide: true,
      maxBuffer: 1024 * 1024
    };

    const commandStr = String(command || '').trim();
    const argsArr = Array.isArray(args) ? args : [];
    let result;
    try {
      result = await execFileAsync(commandStr, argsArr, runOptions);
    } catch (error) {
      const isWindowsScript = process.platform === 'win32' && /\.(cmd|bat)$/i.test(commandStr);
      const shouldRetryWithCmd = isWindowsScript && (error?.code === 'EINVAL' || error?.code === 'ENOENT');
      if (!shouldRetryWithCmd) throw error;
      result = await execFileAsync('cmd.exe', ['/d', '/c', commandStr, ...argsArr], runOptions);
    }

    const { stdout, stderr } = result || {};
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

  const nodeCandidates = uniqueCommandCandidates([
    { command: 'node', args: ['--version'] },
    { command: platform === 'win32' ? 'node.exe' : 'node', args: ['--version'] },
    platform === 'win32' ? { command: path.join(process.env.ProgramFiles || '', 'nodejs', 'node.exe'), args: ['--version'] } : null,
    platform === 'win32' ? { command: path.join(process.env['ProgramFiles(x86)'] || '', 'nodejs', 'node.exe'), args: ['--version'] } : null,
    platform === 'win32' ? { command: path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs', 'node.exe'), args: ['--version'] } : null,
    { command: process.execPath || 'node', args: ['--version'] }
  ]);
  const nodeCheck = await checkFirstAvailable(nodeCandidates);
  const nodeCommand = String(nodeCheck?.command || '').trim();
  const nodeDir = nodeCommand ? path.dirname(nodeCommand) : '';

  const npmCandidates = uniqueCommandCandidates([
    { command: platform === 'win32' ? 'npm.cmd' : 'npm', args: ['--version'] },
    platform === 'win32' ? { command: 'npm', args: ['--version'] } : null,
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
    platform === 'win32' ? { command: path.join(process.env.USERPROFILE || '', '.local', 'bin', 'claude.exe'), args: ['--version'] } : null,
    // Some Windows installs can leave this renamed but still executable by full path.
    platform === 'win32' ? { command: path.join(process.env.USERPROFILE || '', '.local', 'bin', 'claude.exe.disabled'), args: ['--version'] } : null,
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
    platform === 'win32' ? { command: path.join(process.env.USERPROFILE || '', '.local', 'bin', 'codex.exe'), args: ['--version'] } : null,
    platform === 'win32' ? { command: path.join(process.env.USERPROFILE || '', '.local', 'bin', 'codex.exe.disabled'), args: ['--version'] } : null
  ]);
  tools.push({
    id: 'codex',
    name: 'Codex CLI',
    ...(await checkFirstAvailable(codexCandidates))
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
  }

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
    tools
  };
}

module.exports = { collectDiagnostics };
