require('dotenv').config();
const { defineConfig } = require('@playwright/test');

// E2E tests must not collide with the user's "main/master" instance (often on 3000).
// Default to a safe high port unless explicitly overridden.
const DEFAULT_TEST_SERVER_PORT = 4001;
const SERVER_PORT = Number.parseInt(process.env.ORCHESTRATOR_TEST_PORT || '', 10) || DEFAULT_TEST_SERVER_PORT;

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: `http://localhost:${SERVER_PORT}`,
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
    command: `ORCHESTRATOR_PORT=${SERVER_PORT} npm run dev:server`,
    url: `http://localhost:${SERVER_PORT}`,
    timeout: 60000,
    reuseExistingServer: false,
  },
  outputDir: 'test-results',
});
