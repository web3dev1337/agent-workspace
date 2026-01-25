const { test, expect } = require('@playwright/test');

test('renders markdown + mermaid with a toggle', async ({ page }) => {
  await page.route('**/api/github/pr/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        pr: {
          number: 1,
          title: 'Test PR',
          state: 'open',
        },
        files: [
          {
            filename: 'README.md',
            path: 'README.md',
            status: 'modified',
            additions: 3,
            deletions: 1,
            patch: '@@ -1,3 +1,5 @@\n-# Hello\n+# Hello World\n+\n+```mermaid\n+graph TD\n+  A-->B\n+```\n',
            oldContent: '# Hello\n\nOld text.\n',
            newContent: '# Hello World\n\nNew text.\n\n```mermaid\ngraph TD\n  A-->B\n```\n',
          },
        ],
      }),
    });
  });

  await page.route('**/api/diff/pr/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        files: [
          {
            filename: 'README.md',
            path: 'README.md',
            status: 'modified',
            additions: 3,
            deletions: 1,
            patch: '@@ -1,3 +1,5 @@\n-# Hello\n+# Hello World\n',
            analysis: {},
          },
        ],
        stats: {},
        metadata: { analyzedAt: new Date().toISOString() },
      }),
    });
  });

  await page.goto('/pr/test/test/1');

  const toggle = page.getByTestId('toggle-markdown-render');
  await expect(toggle).toBeVisible();
  await toggle.check();

  await expect(page.getByTestId('markdown-side-by-side')).toBeVisible();
  await expect(page.getByTestId('markdown-changed')).toContainText('Hello World');

  // Mermaid should render into an SVG (best-effort). Wait briefly and assert at least one svg exists.
  await expect(page.locator('[data-testid=\"markdown-changed\"] svg')).toHaveCount(1, { timeout: 10000 });
});

