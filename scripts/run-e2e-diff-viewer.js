const { spawnSync } = require('child_process');
const path = require('path');

const node = process.execPath;
const pick = path.join(__dirname, 'pick-free-port.js');

const picked = spawnSync(node, [pick], {
  env: { ...process.env, PORT_START: process.env.DIFF_VIEWER_TEST_PORT || '7655' },
  encoding: 'utf8',
});

if (picked.status !== 0) {
  process.exit(picked.status || 1);
}

const port = String(picked.stdout || '').trim();
if (!port) {
  console.error('Failed to pick a diff-viewer E2E port');
  process.exit(1);
}

const passthroughArgs = process.argv.slice(2);
const result = spawnSync(
  'npx',
  ['playwright', 'test', '--config', 'playwright.diff-viewer.config.js', ...passthroughArgs],
  {
    stdio: 'inherit',
    env: { ...process.env, DIFF_VIEWER_TEST_PORT: port },
  }
);

process.exit(result.status || 0);

