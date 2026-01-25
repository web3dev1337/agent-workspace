require('dotenv').config();
const { defineConfig } = require('@playwright/test');

const DEFAULT_DIFF_VIEWER_PORT = 7655;
const DIFF_VIEWER_PORT = Number.parseInt(process.env.DIFF_VIEWER_TEST_PORT || '', 10) || DEFAULT_DIFF_VIEWER_PORT;

module.exports = defineConfig({
  testDir: './tests/e2e-diff-viewer',
  timeout: 45000,
  retries: 1,
  use: {
    baseURL: `http://localhost:${DIFF_VIEWER_PORT}`,
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
      `DIFF_VIEWER_PORT=${DIFF_VIEWER_PORT}`,
      'bash -lc',
      '"cd diff-viewer && ./start-diff-viewer.sh"'
    ].join(' '),
    url: `http://localhost:${DIFF_VIEWER_PORT}/api/health`,
    timeout: 180000,
    reuseExistingServer: false,
  },
  outputDir: 'test-results',
});

