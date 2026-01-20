require('dotenv').config();
const { defineConfig } = require('@playwright/test');

// Dev instance uses ports 4000 (server), 2081 (client), 7656 (diff-viewer)
const SERVER_PORT = process.env.ORCHESTRATOR_PORT || 4000;

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
