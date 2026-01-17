const { defineConfig } = require('@playwright/test');

// Dev instance uses ports 4000 (server), 2081 (client), 7656 (diff-viewer)
const SERVER_PORT = process.env.ORCHESTRATOR_PORT || process.env.PORT || 4000;
const CLIENT_PORT = process.env.CLIENT_PORT || 2081;

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
    command: 'npm run dev:server & npm run dev:client',
    url: `http://localhost:${CLIENT_PORT}`,
    timeout: 60000,
    reuseExistingServer: !process.env.CI,
  },
  outputDir: 'test-results',
});
