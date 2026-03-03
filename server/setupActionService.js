const { spawn } = require('child_process');

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
      runSupported: true
    },
    {
      id: 'gh-login',
      title: 'Login GitHub CLI',
      description: 'Authenticate GitHub CLI for PR and repo APIs.',
      command: 'gh auth login --hostname github.com --git-protocol https --web',
      docsUrl: 'https://cli.github.com/manual/gh_auth_login',
      required: false,
      runSupported: true
    },
    {
      id: 'install-claude',
      title: 'Install Claude Code CLI',
      description: 'Install the Claude command used by agent sessions.',
      command: 'npm install -g @anthropic-ai/claude-code',
      docsUrl: 'https://docs.anthropic.com/',
      required: false,
      runSupported: true
    },
    {
      id: 'install-codex',
      title: 'Install Codex CLI',
      description: 'Install the Codex command used by agent sessions.',
      command: 'npm install -g @openai/codex',
      docsUrl: 'https://platform.openai.com/docs/codex',
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

function openPowerShellWithCommand(command) {
  const child = spawn(
    'powershell.exe',
    ['-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', String(command || '')],
    {
      detached: true,
      windowsHide: false,
      stdio: 'ignore'
    }
  );
  child.unref();
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

  openPowerShellWithCommand(action.command);

  return {
    id: action.id,
    title: action.title,
    started: true,
    message: `Opened PowerShell to run: ${action.command}`
  };
}

module.exports = {
  getSetupActions,
  getSetupActionById,
  runSetupAction
};

