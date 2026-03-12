require('dotenv').config();
const { defineConfig } = require('@playwright/test');

// This config validates the app works when served via the **client dev server**
// (e.g. http://localhost:9461), where `/api/*` must be proxied to
// the backend. This catches regressions where the UI hard-codes backend ports.

const DEFAULT_BACKEND_PORT = 9480;
const DEFAULT_CLIENT_PORT = 9481;

const BACKEND_PORT = Number.parseInt(process.env.ORCHESTRATOR_TEST_PORT || '', 10) || DEFAULT_BACKEND_PORT;
const CLIENT_PORT = Number.parseInt(process.env.CLIENT_TEST_PORT || '', 10) || DEFAULT_CLIENT_PORT;

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: `http://localhost:${CLIENT_PORT}`,
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  webServer: {
    command: [
      'AUTO_START_DIFF_VIEWER=false',
      `ORCHESTRATOR_PORT=${BACKEND_PORT}`,
      `CLIENT_PORT=${CLIENT_PORT}`,
      'concurrently -k -s first "npm run dev:server" "npm run dev:client"'
    ].join(' '),
    url: `http://localhost:${CLIENT_PORT}`,
    timeout: 120000,
    reuseExistingServer: false,
  },
  outputDir: 'test-results',
});
