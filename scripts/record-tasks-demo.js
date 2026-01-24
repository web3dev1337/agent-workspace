#!/usr/bin/env node
/**
 * Records a human-readable demo video of the ✅ Tasks panel.
 *
 * - Uses a large viewport (1920x1080) so it looks "full screen" in the video.
 * - Waits between steps so the recording is easy to follow.
 * - Works even when Trello isn't configured (shows the config hint).
 *
 * Output: test-results/tasks-demo-video/*.webm
 */

console.log('[demo] record-tasks-demo starting…');

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function findFreePort(startPort) {
  const net = require('net');

  for (let port = startPort; port < startPort + 50; port += 1) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await new Promise((resolve) => {
      const srv = net.createServer();
      srv.once('error', () => resolve(false));
      srv.listen(port, '0.0.0.0', () => {
        srv.close(() => resolve(true));
      });
    });
    if (ok) return port;
  }

  throw new Error(`Could not find a free port near ${startPort}`);
}

async function waitForServerReady(baseUrl, timeoutMs = 60_000) {
  const http = require('http');
  const startedAt = Date.now();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Server did not become ready within ${timeoutMs}ms at ${baseUrl}`);
    }

    try {
      await new Promise((resolve, reject) => {
        const req = http.get(baseUrl, (res) => {
          res.resume();
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
            resolve();
          } else {
            reject(new Error(`Bad status: ${res.statusCode}`));
          }
        });
        req.on('error', reject);
        req.setTimeout(1500, () => req.destroy(new Error('timeout')));
      });
      return;
    } catch {
      await sleep(500);
    }
  }
}

async function tryOpenAnyWorkspace(page) {
  await page.waitForFunction(() => window.orchestrator?.socket?.connected === true, { timeout: 20000 });

  const openWorkspaceBtn = page.getByRole('button', { name: 'Open Workspace' }).first();
  const canOpen = (await openWorkspaceBtn.count()) > 0 && (await openWorkspaceBtn.isVisible().catch(() => false));
  if (!canOpen) return false;

  await openWorkspaceBtn.click();

  const recoverySkipBtn = page.locator('#recovery-skip');
  if (await recoverySkipBtn.isVisible().catch(() => false)) {
    await recoverySkipBtn.click();
  }

  await page.waitForSelector('.sidebar:not(.hidden)', { timeout: 30000 });
  await page.evaluate(() => window.orchestrator?.hideDashboard?.()).catch(() => {});
  return true;
}

async function openTasksPanel(page) {
  // Wait for the app to boot enough that the global orchestrator methods exist.
  await page.waitForFunction(() => typeof window.orchestrator?.showTasksPanel === 'function', { timeout: 30000 });

  // Try to open a workspace so the header button is visible; if not possible, fall back to calling the method directly.
  await tryOpenAnyWorkspace(page).catch(() => false);

  const tasksBtn = page.locator('#tasks-btn');
  if (await tasksBtn.isVisible().catch(() => false)) {
    await tasksBtn.click();
  } else {
    await page.evaluate(() => window.orchestrator.showTasksPanel());
  }

  await page.waitForSelector('#tasks-panel', { timeout: 15000 });
}

function startServer(serverPort) {
  const env = {
    ...process.env,
    AUTO_START_DIFF_VIEWER: 'false',
    ORCHESTRATOR_PORT: String(serverPort)
  };

  const logPath = path.join(__dirname, '..', 'logs', `demo-tasks-${serverPort}.log`);
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });

  const child = spawn('npm', ['run', 'dev:server'], {
    cwd: path.join(__dirname, '..'),
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', (d) => logStream.write(d));
  child.stderr.on('data', (d) => logStream.write(d));
  child.on('close', () => logStream.end());

  return child;
}

async function main() {
  const outDir = path.join(__dirname, '..', 'test-results', 'tasks-demo-video');
  fs.mkdirSync(outDir, { recursive: true });

  const preferredPort = Number.parseInt(process.env.ORCHESTRATOR_TEST_PORT || '4010', 10);
  const serverPort = await findFreePort(preferredPort);
  const baseUrl = `http://localhost:${serverPort}`;

  console.log(`[demo] Starting server on ${baseUrl}…`);
  const server = startServer(serverPort);

  let videoPath = null;
  try {
    await waitForServerReady(baseUrl);
    console.log('[demo] Server ready, launching browser…');

    const browser = await chromium.launch({
      headless: true,
      args: [`--window-size=1920,1080`]
    });

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      recordVideo: { dir: outDir, size: { width: 1920, height: 1080 } }
    });

    const page = await context.newPage();
    const recordedVideo = page.video();

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await openTasksPanel(page);

    // Give the UI a moment to settle (makes the video readable).
    await sleep(800);

    await sleep(800);

    // Wait until providers load (or config hint is shown).
    await Promise.race([
      page.waitForFunction(() => {
        const sel = document.querySelector('#tasks-provider');
        return sel && sel.options && sel.options.length >= 1;
      }, { timeout: 10000 }),
      page.locator('#tasks-panel .tasks-config-hint').waitFor({ state: 'visible', timeout: 10000 })
    ]);
    await sleep(1000);

    // If configured, select first board/list/card to show details.
    const hintVisible = await page.locator('#tasks-panel .tasks-config-hint').isVisible().catch(() => false);
    if (!hintVisible) {
      // Board: wait for options beyond placeholder.
      await page.waitForFunction(() => {
        const sel = document.querySelector('#tasks-board');
        return sel && sel.options && sel.options.length > 1;
      }, { timeout: 15000 });
      await sleep(600);

      await page.selectOption('#tasks-board', { index: 1 }).catch(() => null);
      await sleep(900);

      await page.waitForFunction(() => {
        const sel = document.querySelector('#tasks-list');
        return sel && sel.options && sel.options.length > 1;
      }, { timeout: 15000 });
      await sleep(600);

      await page.selectOption('#tasks-list', { index: 1 }).catch(() => null);
      await sleep(900);

      // Cards: wait for at least one card row (or no cards message).
      await Promise.race([
        page.locator('#tasks-cards .task-card-row').first().waitFor({ state: 'visible', timeout: 15000 }),
        page.locator('#tasks-cards .no-ports').waitFor({ state: 'visible', timeout: 15000 })
      ]);
      await sleep(600);

      const firstCard = page.locator('#tasks-cards .task-card-row').first();
      if (await firstCard.isVisible().catch(() => false)) {
        await firstCard.click();
        await page.waitForSelector('#tasks-detail .tasks-detail-header', { timeout: 15000 });
        await sleep(1500);
      }
    } else {
      // Let the config hint stay on screen long enough to read.
      await sleep(2500);
    }

    // Close modal (shows we can exit cleanly).
    await page.keyboard.press('Escape').catch(() => null);
    await sleep(600);

    // Close to flush video.
    await context.close();
    videoPath = recordedVideo ? await recordedVideo.path() : null;
    await browser.close();
  } finally {
    server.kill('SIGTERM');
  }

  if (!videoPath) {
    throw new Error('No video produced.');
  }

  console.log(`\nDemo video saved: ${videoPath}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
