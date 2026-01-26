const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const node = process.execPath;
const pick = path.join(__dirname, 'pick-free-port.js');

const picked = spawnSync(node, [pick], {
  env: { ...process.env, PORT_START: process.env.ORCHESTRATOR_TEST_PORT || '4001' },
  encoding: 'utf8'
});

if (picked.status !== 0) {
  process.exit(picked.status || 1);
}

const port = String(picked.stdout || '').trim();
if (!port) {
  console.error('Failed to pick a safe E2E port');
  process.exit(1);
}

// Run e2e against an isolated HOME so we don't read/write the user's real ~/.orchestrator.
const e2eHome = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-e2e-home-'));
const originalHome = process.env.HOME || os.homedir();
const orchestratorDir = path.join(e2eHome, '.orchestrator');
const workspacesDir = path.join(orchestratorDir, 'workspaces');
fs.mkdirSync(workspacesDir, { recursive: true });

// Seed a minimal "empty" workspace so the dashboard always has an "Open Workspace" button.
const seededWorkspace = {
  id: 'test-workspace',
  name: 'Test Workspace',
  type: 'website',
  icon: '🧪',
  empty: true,
  terminals: { pairs: 2, defaultVisible: [1, 2], layout: 'dynamic' },
  worktrees: { enabled: false, count: 0, namingPattern: 'work{n}', autoCreate: false },
  shortcuts: [],
  quickLinks: [],
  notifications: { enabled: false, background: false, types: {}, priority: 'normal' },
  lastAccess: new Date().toISOString()
};
fs.writeFileSync(path.join(workspacesDir, `${seededWorkspace.id}.json`), JSON.stringify(seededWorkspace, null, 2));

const passthroughArgs = process.argv.slice(2);
const result = spawnSync('npx', ['playwright', 'test', ...passthroughArgs], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ORCHESTRATOR_TEST_PORT: port,
    HOME: e2eHome,
    USERPROFILE: e2eHome,
    // Keep Playwright browsers cache pointing at the user's real install location
    // so we don't need to re-download browsers into the temp HOME.
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(originalHome, '.cache', 'ms-playwright')
  }
});

process.exit(result.status || 0);
