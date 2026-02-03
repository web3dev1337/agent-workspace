const os = require('os');
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

