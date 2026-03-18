#!/usr/bin/env node

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { getHiddenProcessOptions } = require('../../server/utils/processUtils');
const { quotePowerShell } = require('../../server/utils/shellCommand');

const DEFAULT_HOST = String(process.env.VMCTL_HOST || 'vmwin').trim() || 'vmwin';
const DEFAULT_REMOTE_EXE = String(process.env.VMCTL_REMOTE_EXE || 'powershell.exe').trim() || 'powershell.exe';
const DEFAULT_CONNECT_TIMEOUT_MS = parseInteger(process.env.VMCTL_CONNECT_TIMEOUT_MS, 10);
const DEFAULT_SERVER_ALIVE_INTERVAL = parseInteger(process.env.VMCTL_SERVER_ALIVE_INTERVAL, 5);
const DEFAULT_SERVER_ALIVE_COUNT_MAX = parseInteger(process.env.VMCTL_SERVER_ALIVE_COUNT_MAX, 2);
const DEFAULT_TIMEOUT_MS = parseInteger(process.env.VMCTL_TIMEOUT_MS, 0);

function normalizeString(value) {
  return String(value || '').trim();
}

function parseInteger(raw, fallback) {
  const parsed = Number.parseInt(String(raw || '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseEnvAssignment(raw) {
  const text = normalizeString(raw);
  if (!text) return null;
  const equalsIndex = text.indexOf('=');
  if (equalsIndex <= 0) return null;
  const key = text.slice(0, equalsIndex).trim();
  const value = text.slice(equalsIndex + 1);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
  return { key, value };
}

function normalizeEnvObject(env = {}) {
  const out = {};
  if (!env || typeof env !== 'object') return out;

  for (const key of Object.keys(env).sort((a, b) => a.localeCompare(b))) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalizedKey)) continue;
    out[normalizedKey] = env[key] === undefined ? '' : String(env[key]);
  }

  return out;
}

function getSshCommand() {
  if (process.platform !== 'win32') return 'ssh';

  const systemRoot = normalizeString(process.env.SYSTEMROOT) || 'C:\\Windows';
  const candidate = path.win32.join(systemRoot, 'System32', 'OpenSSH', 'ssh.exe');
  if (fs.existsSync(candidate)) return candidate;

  return 'ssh';
}

function encodePowerShellCommand(command) {
  return Buffer.from(String(command || ''), 'utf16le').toString('base64');
}

function buildRemotePrelude({ cwd = '', env = {} } = {}) {
  const lines = [
    '$ErrorActionPreference = \'Stop\'',
    '$ProgressPreference = \'SilentlyContinue\'',
    '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '$OutputEncoding = [System.Text.UTF8Encoding]::new($false)'
  ];

  const normalizedCwd = normalizeString(cwd);
  if (normalizedCwd) {
    lines.push(`Set-Location -LiteralPath ${quotePowerShell(normalizedCwd)}`);
  }

  const normalizedEnv = normalizeEnvObject(env);
  for (const [key, value] of Object.entries(normalizedEnv)) {
    lines.push(`$env:${key} = ${quotePowerShell(value)}`);
  }

  return lines.join('\n');
}

function buildRemoteCommandScript(command, options = {}) {
  const body = String(command || '');
  const prelude = buildRemotePrelude(options);
  if (!body.trim()) return prelude;

  return [
    prelude,
    'try {',
    body.replace(/\r\n/g, '\n'),
    '} catch {',
    '  Write-Error $_',
    '  exit 1',
    '}',
    'if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }'
  ].join('\n');
}

function buildVmStatusScript() {
  return `
function Test-Tool([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

$tools = [ordered]@{
  powershell = Test-Tool 'powershell.exe'
  pwsh = Test-Tool 'pwsh'
  git = Test-Tool 'git'
  node = Test-Tool 'node'
  npm = Test-Tool 'npm'
  gh = Test-Tool 'gh'
  claude = Test-Tool 'claude'
  codex = Test-Tool 'codex'
}

$payload = [ordered]@{
  hostName = $env:COMPUTERNAME
  userName = $env:USERNAME
  domainName = $env:USERDOMAIN
  cwd = (Get-Location).Path
  home = $HOME
  psVersion = $PSVersionTable.PSVersion.ToString()
  psEdition = $PSVersionTable.PSEdition
  osVersion = [Environment]::OSVersion.VersionString
  timestamp = (Get-Date).ToString('o')
  tools = $tools
}

$payload | ConvertTo-Json -Depth 5 -Compress
`.trim();
}

function buildRemoteExecArgs({
  remoteExe = DEFAULT_REMOTE_EXE,
  command,
  cwd = '',
  env = {},
  includeExecutionPolicy = true
} = {}) {
  const encoded = encodePowerShellCommand(buildRemoteCommandScript(command, { cwd, env }));
  const args = [
    normalizeString(remoteExe) || DEFAULT_REMOTE_EXE,
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive'
  ];

  if (includeExecutionPolicy) {
    args.push('-ExecutionPolicy', 'Bypass');
  }

  args.push('-EncodedCommand', encoded);
  return args;
}

function buildRemoteShellArgs({
  remoteExe = DEFAULT_REMOTE_EXE
} = {}) {
  return [
    normalizeString(remoteExe) || DEFAULT_REMOTE_EXE,
    '-NoLogo',
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-NoExit'
  ];
}

function buildSshArgs({
  host = DEFAULT_HOST,
  remoteArgs = [],
  connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
  serverAliveInterval = DEFAULT_SERVER_ALIVE_INTERVAL,
  serverAliveCountMax = DEFAULT_SERVER_ALIVE_COUNT_MAX,
  requestTty = false,
  batchMode = true
} = {}) {
  const args = [];
  if (batchMode) args.push('-o', 'BatchMode=yes');
  if (Number.isFinite(connectTimeoutMs) && connectTimeoutMs > 0) {
    args.push('-o', `ConnectTimeout=${connectTimeoutMs}`);
  }
  if (Number.isFinite(serverAliveInterval) && serverAliveInterval > 0) {
    args.push('-o', `ServerAliveInterval=${serverAliveInterval}`);
  }
  if (Number.isFinite(serverAliveCountMax) && serverAliveCountMax > 0) {
    args.push('-o', `ServerAliveCountMax=${serverAliveCountMax}`);
  }
  if (requestTty) args.push('-tt');

  args.push(normalizeString(host) || DEFAULT_HOST);
  for (const arg of remoteArgs || []) {
    if (arg === undefined || arg === null) continue;
    args.push(String(arg));
  }

  return args;
}

function runSshCommand({
  host = DEFAULT_HOST,
  remoteArgs = [],
  cwd = process.cwd(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
  serverAliveInterval = DEFAULT_SERVER_ALIVE_INTERVAL,
  serverAliveCountMax = DEFAULT_SERVER_ALIVE_COUNT_MAX,
  stream = true,
  requestTty = false,
  batchMode = true
} = {}) {
  return new Promise((resolve, reject) => {
    const sshCommand = getSshCommand();
    const child = spawn(sshCommand, buildSshArgs({
      host,
      remoteArgs,
      connectTimeoutMs,
      serverAliveInterval,
      serverAliveCountMax,
      requestTty,
      batchMode
    }), {
      cwd,
      stdio: requestTty ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      ...getHiddenProcessOptions({}, process.platform)
    });

    let stdout = '';
    let stderr = '';
    let finished = false;
    let timeout = null;

    const complete = (error, result) => {
      if (finished) return;
      finished = true;
      if (timeout) clearTimeout(timeout);
      if (error) reject(error);
      else resolve(result);
    };

    if (!requestTty && child.stdout) {
      child.stdout.on('data', (chunk) => {
        const text = String(chunk || '');
        stdout += text;
        if (stream) process.stdout.write(text);
      });
    }

    if (!requestTty && child.stderr) {
      child.stderr.on('data', (chunk) => {
        const text = String(chunk || '');
        stderr += text;
        if (stream) process.stderr.write(text);
      });
    }

    if (timeoutMs && timeoutMs > 0 && !requestTty) {
      timeout = setTimeout(() => {
        const error = new Error(`vmctl timed out after ${timeoutMs}ms`);
        error.code = 'ETIMEDOUT';
        try {
          child.kill('SIGTERM');
        } catch {
          // ignore kill errors and fall through to rejection
        }
        complete(error);
      }, timeoutMs);
    }

    child.on('error', (error) => {
      complete(error);
    });

    child.on('close', (code, signal) => {
      const result = {
        code: typeof code === 'number' ? code : 1,
        signal: signal || null,
        stdout,
        stderr,
        host,
        remoteArgs
      };

      if (code === 0) {
        complete(null, result);
        return;
      }

      const error = new Error(`ssh ${normalizeString(host) || DEFAULT_HOST} exited with code ${code === null ? 'null' : code}${signal ? ` (signal ${signal})` : ''}`);
      error.code = typeof code === 'number' ? code : 1;
      error.signal = signal || null;
      error.stdout = stdout;
      error.stderr = stderr;
      error.result = result;
      complete(error);
    });
  });
}

async function runRemotePowerShell({
  host = DEFAULT_HOST,
  remoteExe = DEFAULT_REMOTE_EXE,
  command,
  cwd = '',
  env = {},
  stream = true,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
  serverAliveInterval = DEFAULT_SERVER_ALIVE_INTERVAL,
  serverAliveCountMax = DEFAULT_SERVER_ALIVE_COUNT_MAX
} = {}) {
  const remoteArgs = buildRemoteExecArgs({ remoteExe, command, cwd, env });
  return runSshCommand({
    host,
    remoteArgs,
    stream,
    timeoutMs,
    connectTimeoutMs,
    serverAliveInterval,
    serverAliveCountMax
  });
}

async function runRemoteShell({
  host = DEFAULT_HOST,
  remoteExe = DEFAULT_REMOTE_EXE,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
  serverAliveInterval = DEFAULT_SERVER_ALIVE_INTERVAL,
  serverAliveCountMax = DEFAULT_SERVER_ALIVE_COUNT_MAX
} = {}) {
  const remoteArgs = buildRemoteShellArgs({ remoteExe });
  return runSshCommand({
    host,
    remoteArgs,
    timeoutMs,
    connectTimeoutMs,
    serverAliveInterval,
    serverAliveCountMax,
    requestTty: true,
    batchMode: true
  });
}

function formatStatusSummary(payload) {
  const status = payload && payload.status ? payload.status : {};
  const tools = status.tools && typeof status.tools === 'object' ? status.tools : {};
  const toolSummary = Object.keys(tools)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => `${key}=${tools[key] ? 'yes' : 'no'}`)
    .join(', ');

  const identityParts = [
    status.hostName ? `host ${status.hostName}` : null,
    status.userName ? `user ${status.userName}` : null,
    status.domainName ? `domain ${status.domainName}` : null
  ].filter(Boolean);

  const runtimeParts = [
    status.psVersion ? `PowerShell ${status.psVersion}` : null,
    status.psEdition ? status.psEdition : null,
    status.osVersion ? status.osVersion : null
  ].filter(Boolean);

  const contextParts = [
    status.cwd ? `cwd ${status.cwd}` : null,
    status.home ? `home ${status.home}` : null
  ].filter(Boolean);

  const lines = [
    `${normalizeString(payload.host) || DEFAULT_HOST} | ${normalizeString(payload.remoteExe) || DEFAULT_REMOTE_EXE}`,
    identityParts.length ? identityParts.join(' | ') : 'identity unavailable',
    runtimeParts.length ? runtimeParts.join(' | ') : 'runtime unavailable',
    contextParts.length ? contextParts.join(' | ') : 'context unavailable',
    toolSummary ? `tools: ${toolSummary}` : 'tools: unavailable'
  ];

  return lines.join('\n');
}

function parseArgs(argv = []) {
  const args = {
    help: false,
    json: false,
    quiet: false,
    host: DEFAULT_HOST,
    remoteExe: DEFAULT_REMOTE_EXE,
    connectTimeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
    serverAliveInterval: DEFAULT_SERVER_ALIVE_INTERVAL,
    serverAliveCountMax: DEFAULT_SERVER_ALIVE_COUNT_MAX,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    cwd: '',
    command: '',
    file: '',
    env: {},
    subcommand: 'info',
    trailing: []
  };

  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const raw = String(argv[index] || '');
    if (raw === '--') {
      positionals.push(...argv.slice(index + 1).map((value) => String(value || '')));
      break;
    }

    if (!raw.startsWith('--')) {
      positionals.push(raw);
      continue;
    }

    const key = raw.slice(2);
    if (!key) continue;

    if (key === 'help' || key === 'h') {
      args.help = true;
      continue;
    }

    if (key === 'json') {
      args.json = true;
      continue;
    }

    if (key === 'no-json') {
      args.json = false;
      continue;
    }

    if (key === 'quiet') {
      args.quiet = true;
      continue;
    }

    let nextValue = '';
    if (argv[index + 1] !== undefined) {
      nextValue = String(argv[index + 1] || '');
      index += 1;
    }

    switch (key) {
      case 'host':
        args.host = nextValue || args.host;
        break;
      case 'remote-exe':
      case 'exe':
        args.remoteExe = nextValue || args.remoteExe;
        break;
      case 'connect-timeout':
        args.connectTimeoutMs = parseInteger(nextValue, args.connectTimeoutMs);
        break;
      case 'server-alive-interval':
        args.serverAliveInterval = parseInteger(nextValue, args.serverAliveInterval);
        break;
      case 'server-alive-count-max':
        args.serverAliveCountMax = parseInteger(nextValue, args.serverAliveCountMax);
        break;
      case 'timeout':
        args.timeoutMs = parseInteger(nextValue, args.timeoutMs);
        break;
      case 'cwd':
        args.cwd = nextValue;
        break;
      case 'command':
        args.command = nextValue;
        break;
      case 'file':
        args.file = nextValue;
        break;
      case 'env': {
        const pair = parseEnvAssignment(nextValue);
        if (pair) {
          args.env[pair.key] = pair.value;
        }
        break;
      }
      default:
        break;
    }
  }

  const knownSubcommands = new Set(['info', 'status', 'exec', 'shell']);
  if (positionals.length > 0) {
    if (knownSubcommands.has(positionals[0])) {
      args.subcommand = positionals[0] === 'status' ? 'info' : positionals[0];
      args.trailing = positionals.slice(1);
    } else {
      args.subcommand = 'exec';
      args.trailing = positionals;
    }
  }

  if (args.subcommand === 'exec' && !args.command && !args.file && args.trailing.length > 0) {
    args.command = args.trailing.join(' ');
  }

  return args;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/vm/vmctl.js [command] [options]\n\nCommands:\n  info, status            Show a connection summary and tool inventory\n  exec                    Run a PowerShell command on the VM\n  shell                   Open an interactive PowerShell session on the VM\n\nOptions:\n  --host <alias>          SSH host alias or hostname (default: ${DEFAULT_HOST})\n  --remote-exe <name>     Remote PowerShell executable (default: ${DEFAULT_REMOTE_EXE})\n  --connect-timeout <ms>  SSH connect timeout in milliseconds (default: ${DEFAULT_CONNECT_TIMEOUT_MS})\n  --server-alive-interval <sec>  SSH keepalive interval (default: ${DEFAULT_SERVER_ALIVE_INTERVAL})\n  --server-alive-count-max <n>    SSH keepalive retry count (default: ${DEFAULT_SERVER_ALIVE_COUNT_MAX})\n  --timeout <ms>          Command timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS})\n  --cwd <path>            Remote working directory\n  --command <text>        Inline PowerShell command for exec\n  --file <path>           Read PowerShell command from a local file for exec\n  --env KEY=VALUE         Set a remote environment variable (repeatable)\n  --json                  Emit structured JSON for info/exec\n  --quiet                 Suppress local passthrough for exec\n  --help                  Show this help\n\nExamples:\n  node scripts/vm/vmctl.js info\n  node scripts/vm/vmctl.js exec --command \"Write-Output hello\"\n  node scripts/vm/vmctl.js exec --cwd \"C:\\\\Users\\\\administrator\" --command \"Get-Location\"\n  node scripts/vm/vmctl.js shell\n\nEnvironment:\n  VMCTL_HOST\n  VMCTL_REMOTE_EXE\n  VMCTL_CONNECT_TIMEOUT_MS\n  VMCTL_SERVER_ALIVE_INTERVAL\n  VMCTL_SERVER_ALIVE_COUNT_MAX\n  VMCTL_TIMEOUT_MS\n`);
}

async function readExecCommand(args) {
  if (args.file) {
    const resolved = path.resolve(process.cwd(), args.file);
    return fsp.readFile(resolved, 'utf8');
  }

  if (args.command) return args.command;
  return '';
}

async function runInfo(args) {
  const result = await runRemotePowerShell({
    host: args.host,
    remoteExe: args.remoteExe,
    command: buildVmStatusScript(),
    cwd: args.cwd,
    env: args.env,
    stream: false,
    timeoutMs: args.timeoutMs,
    connectTimeoutMs: args.connectTimeoutMs,
    serverAliveInterval: args.serverAliveInterval,
    serverAliveCountMax: args.serverAliveCountMax
  });

  const raw = String(result.stdout || '').trim();
  if (!raw) {
    throw new Error('VM status probe returned no output');
  }

  let status;
  try {
    status = JSON.parse(raw);
  } catch (error) {
    const wrapped = new Error(`Failed to parse VM status JSON: ${error.message}`);
    wrapped.stdout = result.stdout;
    wrapped.stderr = result.stderr;
    throw wrapped;
  }

  const payload = {
    transport: 'ssh',
    host: args.host,
    remoteExe: args.remoteExe,
    status
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return payload;
  }

  process.stdout.write(`${formatStatusSummary(payload)}\n`);
  return payload;
}

async function runExec(args) {
  const command = await readExecCommand(args);
  if (!command.trim()) {
    throw new Error('No remote PowerShell command supplied');
  }

  const result = await runRemotePowerShell({
    host: args.host,
    remoteExe: args.remoteExe,
    command,
    cwd: args.cwd,
    env: args.env,
    stream: !args.json && !args.quiet,
    timeoutMs: args.timeoutMs,
    connectTimeoutMs: args.connectTimeoutMs,
    serverAliveInterval: args.serverAliveInterval,
    serverAliveCountMax: args.serverAliveCountMax
  });

  const payload = {
    transport: 'ssh',
    host: args.host,
    remoteExe: args.remoteExe,
    cwd: args.cwd || '',
    command,
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }

  return payload;
}

async function runShell(args) {
  await runRemoteShell({
    host: args.host,
    remoteExe: args.remoteExe,
    timeoutMs: args.timeoutMs,
    connectTimeoutMs: args.connectTimeoutMs,
    serverAliveInterval: args.serverAliveInterval,
    serverAliveCountMax: args.serverAliveCountMax
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  try {
    if (args.subcommand === 'info') {
      await runInfo(args);
      return;
    }

    if (args.subcommand === 'exec') {
      await runExec(args);
      return;
    }

    if (args.subcommand === 'shell') {
      await runShell(args);
      return;
    }

    throw new Error(`Unknown command: ${args.subcommand}`);
  } catch (error) {
    process.stderr.write(`vmctl failed: ${error.message}\n`);
    if ((args.json || args.subcommand === 'info') && error.stdout) {
      process.stderr.write(`${String(error.stdout)}`);
    }
    if ((args.json || args.subcommand === 'info') && error.stderr) {
      process.stderr.write(`${String(error.stderr)}`);
    }
    process.exitCode = typeof error.code === 'number' ? error.code : 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_HOST,
  DEFAULT_REMOTE_EXE,
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_SERVER_ALIVE_INTERVAL,
  DEFAULT_SERVER_ALIVE_COUNT_MAX,
  DEFAULT_TIMEOUT_MS,
  encodePowerShellCommand,
  buildRemotePrelude,
  buildRemoteCommandScript,
  buildVmStatusScript,
  buildRemoteExecArgs,
  buildRemoteShellArgs,
  buildSshArgs,
  runSshCommand,
  runRemotePowerShell,
  runRemoteShell,
  formatStatusSummary,
  parseArgs,
  parseInteger,
  parseEnvAssignment,
  normalizeEnvObject,
  getSshCommand,
  readExecCommand,
  runInfo,
  runExec,
  runShell,
  printHelp
};
