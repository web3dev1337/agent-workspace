const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

const clampInt = (value, { min, max, fallback }) => {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const getNpmCommand = () => (process.platform === 'win32' ? 'npm.cmd' : 'npm');

const safeReadJsonFile = async (filePath) => {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const resolveAutoScript = (scripts) => {
  if (!scripts || typeof scripts !== 'object') return null;
  if (scripts['test:unit']) return 'test:unit';
  if (scripts.test) return 'test';
  if (scripts['test:ci']) return 'test:ci';
  return null;
};

const buildNpmCommandForScript = (script) => {
  const s = String(script || '').trim();
  if (!s) return null;
  if (s === 'test') return { command: getNpmCommand(), args: ['test'], label: 'npm test' };
  return { command: getNpmCommand(), args: ['run', s], label: `npm run ${s}` };
};

const detectTestCommandForWorktree = async (worktreePath, { script = 'auto' } = {}) => {
  const cwd = path.resolve(String(worktreePath || '').trim());
  if (!cwd) return null;

  const packageJsonPath = path.join(cwd, 'package.json');
  const pkg = await safeReadJsonFile(packageJsonPath);
  const scripts = pkg?.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : null;

  const normalized = String(script || '').trim();
  const desiredScript = normalized && normalized !== 'auto' ? normalized : resolveAutoScript(scripts);
  if (!desiredScript) return null;
  if (!scripts || !scripts[desiredScript]) return null;

  return buildNpmCommandForScript(desiredScript);
};

const makeRunId = () => `tests_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

class TestOrchestrationService {
  constructor({ sessionManager, workspaceManager, spawnImpl } = {}) {
    this.sessionManager = sessionManager;
    this.workspaceManager = workspaceManager;
    this.spawnImpl = spawnImpl || spawn;
    this.runs = new Map(); // runId -> run
  }

  static getInstance(deps = {}) {
    if (!TestOrchestrationService.instance) {
      TestOrchestrationService.instance = new TestOrchestrationService(deps);
    }
    return TestOrchestrationService.instance;
  }

  listRuns({ limit = 25 } = {}) {
    const max = clampInt(limit, { min: 1, max: 100, fallback: 25 });
    const runs = Array.from(this.runs.values())
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, max)
      .map(r => this.serializeRun(r, { includeResults: false }));
    return { ok: true, runs };
  }

  getRun(runId) {
    const id = String(runId || '').trim();
    if (!id) return null;
    const run = this.runs.get(id);
    return run ? this.serializeRun(run, { includeResults: true }) : null;
  }

  serializeRun(run, { includeResults = true } = {}) {
    const results = Array.isArray(run.results) ? run.results : [];
    const summary = results.reduce((acc, r) => {
      acc.total += 1;
      const status = String(r.status || 'unknown');
      if (status === 'passed') acc.passed += 1;
      else if (status === 'failed') acc.failed += 1;
      else if (status === 'unsupported') acc.unsupported += 1;
      else if (status === 'running') acc.running += 1;
      else if (status === 'queued') acc.queued += 1;
      else acc.other += 1;
      return acc;
    }, { total: 0, passed: 0, failed: 0, unsupported: 0, running: 0, queued: 0, other: 0 });

    return {
      ok: true,
      runId: run.runId,
      workspaceId: run.workspaceId || null,
      workspaceName: run.workspaceName || null,
      script: run.script,
      concurrency: run.concurrency,
      status: run.status,
      createdAt: run.createdAt,
      finishedAt: run.finishedAt || null,
      summary,
      results: includeResults ? results : undefined
    };
  }

  async startRun({ script = 'auto', concurrency = 2, existingOnly = true } = {}) {
    const activeWorkspace = this.workspaceManager?.getActiveWorkspace?.() || null;
    const workspaceId = activeWorkspace?.id || null;
    const workspaceName = activeWorkspace?.name || null;

    const maxConcurrency = clampInt(concurrency, { min: 1, max: 8, fallback: 2 });
    const desiredScript = String(script || '').trim() || 'auto';

    const worktrees = Array.isArray(this.sessionManager?.worktrees) ? this.sessionManager.worktrees : [];
    const unique = [];
    const seen = new Set();
    for (const wt of worktrees) {
      const p = String(wt?.path || '').trim();
      if (!p) continue;
      const key = `${wt?.id || ''}:${p}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push({ id: String(wt?.id || '').trim() || p, path: p });
    }

    const runId = makeRunId();
    const run = {
      runId,
      workspaceId,
      workspaceName,
      script: desiredScript,
      concurrency: maxConcurrency,
      status: 'running',
      createdAt: new Date().toISOString(),
      finishedAt: null,
      results: unique.map(t => ({
        worktreeId: t.id,
        worktreePath: t.path,
        command: null,
        status: 'queued',
        exitCode: null,
        durationMs: null,
        outputTail: '',
        startedAt: null,
        finishedAt: null
      }))
    };

    this.runs.set(runId, run);

    const queue = run.results.slice();
    let active = 0;
    let index = 0;
    const maxOutputChars = 12_000;

    const appendOutput = (result, chunk) => {
      const text = String(chunk || '');
      if (!text) return;
      result.outputTail = String(result.outputTail || '');
      result.outputTail = (result.outputTail + text).slice(-maxOutputChars);
    };

    const isExistingDir = async (p) => {
      try {
        const stat = await fs.stat(p);
        return stat.isDirectory();
      } catch {
        return false;
      }
    };

    const runOne = async (result) => {
      const started = Date.now();
      result.startedAt = new Date().toISOString();
      result.status = 'running';

      if (existingOnly) {
        const ok = await isExistingDir(result.worktreePath);
        if (!ok) {
          result.status = 'unsupported';
          result.exitCode = null;
          result.durationMs = Date.now() - started;
          result.finishedAt = new Date().toISOString();
          return;
        }
      }

      const cmd = await detectTestCommandForWorktree(result.worktreePath, { script: desiredScript });
      if (!cmd) {
        result.status = 'unsupported';
        result.exitCode = null;
        result.durationMs = Date.now() - started;
        result.finishedAt = new Date().toISOString();
        return;
      }

      result.command = cmd.label || `${cmd.command} ${(cmd.args || []).join(' ')}`.trim();

      await new Promise((resolve) => {
        let child = null;
        try {
          child = this.spawnImpl(cmd.command, Array.isArray(cmd.args) ? cmd.args : [], {
            cwd: result.worktreePath,
            env: { ...process.env },
            stdio: ['ignore', 'pipe', 'pipe']
          });
        } catch (error) {
          appendOutput(result, `\nSpawn failed: ${error.message}\n`);
          result.exitCode = 1;
          result.status = 'failed';
          result.durationMs = Date.now() - started;
          result.finishedAt = new Date().toISOString();
          resolve();
          return;
        }

        child.stdout?.on('data', (d) => appendOutput(result, d));
        child.stderr?.on('data', (d) => appendOutput(result, d));
        child.on('error', (error) => {
          appendOutput(result, `\nProcess error: ${error.message}\n`);
        });
        child.on('close', (code) => {
          result.exitCode = Number.isFinite(code) ? Number(code) : null;
          result.status = result.exitCode === 0 ? 'passed' : 'failed';
          result.durationMs = Date.now() - started;
          result.finishedAt = new Date().toISOString();
          resolve();
        });
      });
    };

    const pump = async () => {
      while (active < maxConcurrency && index < queue.length) {
        const next = queue[index];
        index += 1;
        active += 1;

        runOne(next)
          .catch((error) => {
            logger.warn('Test orchestration target failed', { runId, worktreePath: next.worktreePath, error: error.message });
            appendOutput(next, `\nUnhandled error: ${error.message}\n`);
            next.status = 'failed';
            next.exitCode = 1;
            next.finishedAt = new Date().toISOString();
          })
          .finally(() => {
            active -= 1;
            pump().catch(() => {});
          });
      }

      if (index >= queue.length && active === 0) {
        run.status = 'done';
        run.finishedAt = new Date().toISOString();
      }
    };

    pump().catch(() => {});

    return this.serializeRun(run, { includeResults: true });
  }
}

module.exports = {
  TestOrchestrationService,
  detectTestCommandForWorktree
};
