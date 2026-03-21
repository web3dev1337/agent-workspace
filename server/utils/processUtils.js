const fs = require('fs');
const os = require('os');
const path = require('path');

const CREATE_NO_WINDOW = 0x08000000;
const BROKEN_NODE_PTY_START_PROCESS_CALL = 'conptyNative.startProcess(file, cols, rows, debug, this._generatePipeName(), conptyInheritCursor, this._useConptyDll)';
const FIXED_NODE_PTY_START_PROCESS_CALL = 'conptyNative.startProcess(file, cols, rows, debug, this._generatePipeName(), conptyInheritCursor)';
const BROKEN_NODE_PTY_CONNECT_CALL = 'conptyNative.connect(pty, commandLine, cwd, env, this._useConptyDll, function (c) { return _this._$onProcessExit(c); })';
const FIXED_NODE_PTY_CONNECT_CALL = 'conptyNative.connect(pty, commandLine, cwd, env, function (c) { return _this._$onProcessExit(c); })';

function isWindows(platform = process.platform) {
  return platform === 'win32';
}

function getHiddenProcessOptions(options = {}, platform = process.platform) {
  const next = { ...options };
  if (!isWindows(platform)) return next;
  if (next.windowsHide === undefined) next.windowsHide = true;
  if (next.creationFlags === undefined) next.creationFlags = CREATE_NO_WINDOW;
  return next;
}

function splitPathList(raw, platform = process.platform) {
  const delimiter = isWindows(platform) ? ';' : ':';
  return String(raw || '')
    .split(delimiter)
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

function joinPathList(entries, platform = process.platform) {
  const delimiter = isWindows(platform) ? ';' : ':';
  return Array.from(entries || []).filter(Boolean).join(delimiter);
}

function appendUniquePathEntry(entries, candidate) {
  const value = String(candidate || '').trim();
  if (!value) return;
  const exists = entries.some((entry) => entry.toLowerCase() === value.toLowerCase());
  if (!exists) entries.push(value);
}

function getCommonWindowsPathEntries(env = process.env) {
  const homeDir = String(env.USERPROFILE || env.HOME || os.homedir() || '').trim();
  const appData = String(env.APPDATA || path.join(homeDir, 'AppData', 'Roaming')).trim();
  const localAppData = String(env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local')).trim();
  const programFiles = String(env.ProgramFiles || 'C:\\Program Files').trim();
  const programFilesX86 = String(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)').trim();
  const systemRoot = String(env.SystemRoot || env.WINDIR || 'C:\\Windows').trim();
  const system32 = systemRoot ? path.join(systemRoot, 'System32') : '';

  return [
    systemRoot,
    system32,
    system32 ? path.join(system32, 'WindowsPowerShell', 'v1.0') : '',
    system32 ? path.join(system32, 'Wbem') : '',
    system32 ? path.join(system32, 'OpenSSH') : '',
    appData ? path.join(appData, 'npm') : '',
    localAppData ? path.join(localAppData, 'Microsoft', 'WinGet', 'Links') : '',
    localAppData ? path.join(localAppData, 'Programs', 'GitHub CLI') : '',
    programFiles ? path.join(programFiles, 'GitHub CLI') : '',
    programFilesX86 ? path.join(programFilesX86, 'GitHub CLI') : '',
    localAppData ? path.join(localAppData, 'Programs', 'nodejs') : '',
    programFiles ? path.join(programFiles, 'Git', 'cmd') : '',
    programFiles ? path.join(programFiles, 'Git', 'bin') : '',
    programFiles ? path.join(programFiles, 'nodejs') : '',
    programFilesX86 ? path.join(programFilesX86, 'Git', 'cmd') : '',
    programFilesX86 ? path.join(programFilesX86, 'Git', 'bin') : '',
    programFilesX86 ? path.join(programFilesX86, 'nodejs') : '',
    homeDir ? path.join(homeDir, '.cargo', 'bin') : '',
    homeDir ? path.join(homeDir, '.local', 'bin') : ''
  ].filter(Boolean);
}

function getCommonMacPathEntries(env = process.env) {
  const homeDir = String(env.HOME || os.homedir() || '').trim();
  const entries = [
    homeDir ? path.join(homeDir, '.homebrew', 'bin') : '',
    '/opt/homebrew/bin',
    '/usr/local/bin',
    homeDir ? path.join(homeDir, '.cargo', 'bin') : '',
    homeDir ? path.join(homeDir, '.local', 'bin') : ''
  ];
  // Add nvm node versions
  const nvmDir = homeDir ? path.join(homeDir, '.nvm', 'versions', 'node') : '';
  if (nvmDir) {
    try {
      const versions = require('fs').readdirSync(nvmDir);
      const sorted = versions.sort().reverse();
      for (const v of sorted) {
        entries.push(path.join(nvmDir, v, 'bin'));
      }
    } catch { /* nvm not installed */ }
  }
  return entries.filter(Boolean);
}

function augmentProcessEnv(env = process.env, platform = process.platform) {
  const next = { ...env };

  if (platform === 'darwin') {
    const basePathValue = next.PATH || process.env.PATH || '';
    const entries = splitPathList(basePathValue, platform);
    for (const candidate of getCommonMacPathEntries({ ...process.env, ...next })) {
      appendUniquePathEntry(entries, candidate);
    }
    next.PATH = joinPathList(entries, platform);
    return next;
  }

  if (!isWindows(platform)) return next;

  const basePathValue = next.Path || next.PATH || process.env.Path || process.env.PATH || '';
  const entries = splitPathList(basePathValue, platform);
  for (const candidate of getCommonWindowsPathEntries({ ...process.env, ...next })) {
    appendUniquePathEntry(entries, candidate);
  }

  const joined = joinPathList(entries, platform);
  next.Path = joined;
  next.PATH = joined;
  if (!next.HOME) {
    next.HOME = next.USERPROFILE || process.env.USERPROFILE || os.homedir();
  }
  return next;
}

function buildPowerShellArgs(command, {
  keepOpen = false,
  hideWindow = true,
  noLogo = true,
  noProfile = true,
  executionPolicyBypass = false,
  platform = process.platform
} = {}) {
  const args = [];
  if (noLogo) args.push('-NoLogo');
  if (noProfile) args.push('-NoProfile');
  if (executionPolicyBypass) args.push('-ExecutionPolicy', 'Bypass');
  if (isWindows(platform) && hideWindow) args.push('-WindowStyle', 'Hidden');
  if (keepOpen) args.push('-NoExit');
  if (command !== undefined && command !== null) {
    args.push('-Command', String(command));
  }
  return args;
}

function patchNodePtyStartProcessCompat(packageRoot) {
  const root = String(packageRoot || '').trim();
  if (!root) {
    return { status: 'missing-package-root' };
  }

  const agentPath = path.join(root, 'lib', 'windowsPtyAgent.js');
  if (!fs.existsSync(agentPath)) {
    return { status: 'missing-agent', agentPath };
  }

  const source = fs.readFileSync(agentPath, 'utf8');
  const startProcessAlreadyPatched = source.includes(FIXED_NODE_PTY_START_PROCESS_CALL);
  const connectAlreadyPatched = source.includes(FIXED_NODE_PTY_CONNECT_CALL);
  if (startProcessAlreadyPatched && connectAlreadyPatched) {
    return { status: 'already-patched', agentPath };
  }
  const hasBrokenStartProcess = source.includes(BROKEN_NODE_PTY_START_PROCESS_CALL);
  const hasBrokenConnect = source.includes(BROKEN_NODE_PTY_CONNECT_CALL);
  if (!hasBrokenStartProcess && !hasBrokenConnect) {
    return { status: 'unexpected-agent-shape', agentPath };
  }

  let patched = source;
  if (hasBrokenStartProcess) {
    patched = patched.replace(BROKEN_NODE_PTY_START_PROCESS_CALL, FIXED_NODE_PTY_START_PROCESS_CALL);
  }
  if (hasBrokenConnect) {
    patched = patched.replace(BROKEN_NODE_PTY_CONNECT_CALL, FIXED_NODE_PTY_CONNECT_CALL);
  }
  fs.writeFileSync(agentPath, patched, 'utf8');
  return { status: 'patched', agentPath };
}

module.exports = {
  BROKEN_NODE_PTY_CONNECT_CALL,
  BROKEN_NODE_PTY_START_PROCESS_CALL,
  CREATE_NO_WINDOW,
  FIXED_NODE_PTY_CONNECT_CALL,
  FIXED_NODE_PTY_START_PROCESS_CALL,
  isWindows,
  getHiddenProcessOptions,
  augmentProcessEnv,
  buildPowerShellArgs,
  patchNodePtyStartProcessCompat
};
