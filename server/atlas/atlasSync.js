const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const store = require('./atlasStore');
const { kebab } = require('./atlasSchema');

const GIT_TIMEOUT_MS = 60_000;

const REGISTRY_README = `# Repo Atlas — private registry

Your judgement about your repos: what each one is worth reading for, scored per
topic, plus who each entry may be shared with.

One file per repo under \`entries/\` so two machines curating different repos
never produce a merge conflict.

**Keep this repository private.** It describes repos your collaborators may not
have access to. Compiled bundles — the subsets you actually share — are produced
with \`atlas publish <audience>\` and go somewhere else entirely.
`;

const REGISTRY_GITIGNORE = `# Machine-local: what this particular computer happens to have cloned.
discovery.json
bundles/
subscriptions/
*.migrated
`;

function git(args, { cwd, timeout = GIT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: String(stdout || '').trim(),
        stderr: String(stderr || '').trim(),
        error: error ? error.message : null
      });
    });
  });
}

function isGitRepo(dir) {
  return fs.existsSync(path.join(dir, '.git'));
}

async function ensureRepo(dir, remote) {
  fs.mkdirSync(dir, { recursive: true });

  if (!isGitRepo(dir)) {
    const init = await git(['init', '-b', 'main'], { cwd: dir });
    if (!init.ok) return { ok: false, error: `git init failed: ${init.stderr || init.error}` };
  }

  if (remote) {
    const current = await git(['remote', 'get-url', 'origin'], { cwd: dir });
    if (!current.ok) {
      const added = await git(['remote', 'add', 'origin', remote], { cwd: dir });
      if (!added.ok) return { ok: false, error: `could not add remote: ${added.stderr || added.error}` };
    } else if (current.stdout !== remote) {
      await git(['remote', 'set-url', 'origin', remote], { cwd: dir });
    }
  }

  return { ok: true };
}

function seedRepoFiles(dir) {
  const readme = path.join(dir, 'README.md');
  if (!fs.existsSync(readme)) fs.writeFileSync(readme, REGISTRY_README, 'utf8');
  const ignore = path.join(dir, '.gitignore');
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, REGISTRY_GITIGNORE, 'utf8');
  fs.mkdirSync(path.join(dir, 'entries'), { recursive: true });
}

async function hasChanges(dir) {
  const status = await git(['status', '--porcelain'], { cwd: dir });
  return status.ok && status.stdout.length > 0;
}

async function commitAll(dir, message) {
  await git(['add', '-A'], { cwd: dir });
  if (!(await hasChanges(dir))) return { committed: false };
  const commit = await git(['commit', '-m', message], { cwd: dir });
  return { committed: commit.ok, error: commit.ok ? null : (commit.stderr || commit.error) };
}

/**
 * Pull, merge, push — the whole point of which is that the atlas survives you
 * moving between machines, and survives the machine.
 *
 * Rebase is deliberate: per-entry files make conflicts rare, and when one does
 * happen it is a single small JSON file you can read, not a merge commit in the
 * middle of a registry blob.
 */
async function syncRegistry({ remote = '', message = '' } = {}) {
  const dir = store.registryDir();
  const config = store.loadConfig();
  const target = remote || config.remote;

  if (!target) {
    return { ok: false, error: 'No registry remote configured — run `atlas remote set <git-url>` first' };
  }

  const prepared = await ensureRepo(dir, target);
  if (!prepared.ok) return { ok: false, error: prepared.error };
  seedRepoFiles(dir);

  const steps = [];

  const localCommit = await commitAll(dir, message || `atlas: sync from ${require('os').hostname()}`);
  steps.push({ step: 'commit-local', ...localCommit });
  // A failed commit (identity unset, rejecting hook, disk full) must stop the
  // sync here — carrying on used to surface as a baffling "push failed: src
  // refspec HEAD does not match any" that pointed at entirely the wrong thing.
  if (localCommit.error) {
    return { ok: false, dir, steps, error: `local commit failed: ${localCommit.error}` };
  }

  const fetched = await git(['fetch', 'origin'], { cwd: dir });
  steps.push({ step: 'fetch', ok: fetched.ok, detail: fetched.stderr || null });
  if (!fetched.ok) {
    return { ok: false, dir, steps, error: `could not reach the registry remote: ${fetched.stderr || fetched.error}` };
  }

  const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir })).stdout || 'main';
  const remoteExists = (await git(['rev-parse', '--verify', `origin/${branch}`], { cwd: dir })).ok;

  if (remoteExists) {
    const pulled = await git(['pull', '--rebase', 'origin', branch], { cwd: dir });
    steps.push({ step: 'pull', ok: pulled.ok, detail: pulled.stderr || pulled.stdout || null });
    if (!pulled.ok) {
      await git(['rebase', '--abort'], { cwd: dir });
      return {
        ok: false,
        error: 'Registry pull conflicted. Resolve it by hand in the registry directory, then sync again.',
        dir,
        steps
      };
    }
  }

  const pushed = await git(['push', '-u', 'origin', branch], { cwd: dir });
  steps.push({ step: 'push', ok: pushed.ok, detail: pushed.stderr || null });

  return {
    ok: pushed.ok,
    dir,
    remote: target,
    branch,
    entryCount: Object.keys(store.loadEntries()).length,
    steps,
    error: pushed.ok ? null : `push failed: ${pushed.stderr || pushed.error}`
  };
}

async function setRemote(remote) {
  const config = store.loadConfig();
  config.remote = String(remote || '').trim();
  store.saveConfig(config);
  if (config.remote) await ensureRepo(store.registryDir(), config.remote);
  return config.remote;
}

/**
 * Clone someone else's published bundle so their map shows up in your searches,
 * attributed to them and never overwriting your own notes.
 */
async function subscribe({ name, source }) {
  const key = kebab(name);
  if (!key) throw new Error('A subscription needs a name');
  const from = String(source || '').trim();
  if (!from) throw new Error('A subscription needs a path or git URL');

  if (!/^(https?:|git@|ssh:)/.test(from)) {
    const bundle = store.readJson(path.resolve(from), null);
    if (!bundle || !Array.isArray(bundle.entries)) {
      throw new Error(`${from} is not an atlas bundle`);
    }
    return { name: key, entryCount: bundle.entries.length, path: store.saveSubscription(key, bundle) };
  }

  const checkoutDir = path.join(store.subscriptionsDir(), '.repos', key);
  const prepared = await ensureRepo(checkoutDir, from);
  if (!prepared.ok) throw new Error(prepared.error);

  const fetched = await git(['fetch', 'origin'], { cwd: checkoutDir });
  if (!fetched.ok) throw new Error(`could not fetch ${from}: ${fetched.stderr}`);
  const branch = (await git(['rev-parse', '--abbrev-ref', 'origin/HEAD'], { cwd: checkoutDir })).stdout.replace('origin/', '') || 'main';
  await git(['checkout', '-B', branch, `origin/${branch}`], { cwd: checkoutDir });

  const candidates = fs.readdirSync(checkoutDir).filter((file) => /^atlas\..*\.json$/.test(file));
  if (!candidates.length) throw new Error(`no atlas bundle found in ${from}`);

  const bundle = store.readJson(path.join(checkoutDir, candidates[0]), null);
  if (!bundle || !Array.isArray(bundle.entries)) throw new Error(`${candidates[0]} is not an atlas bundle`);

  return { name: key, entryCount: bundle.entries.length, path: store.saveSubscription(key, bundle) };
}

/**
 * Write a compiled bundle into a repo the audience already has access to, and
 * commit it. GitHub permissions on that repo are the actual access control —
 * this just puts the file where they can see it.
 */
async function publishBundle({ audience, bundle, outputPath, outputRemote }) {
  if (!outputPath) {
    return { ok: false, error: `Audience "${audience}" has no outputPath — set one with \`atlas audience add ${audience} --out <path>\`` };
  }

  const target = path.resolve(outputPath);
  store.writeJson(target, bundle);

  const repoDir = outputRemote ? path.dirname(target) : null;
  if (!repoDir) return { ok: true, path: target, committed: false };

  const prepared = await ensureRepo(repoDir, outputRemote);
  if (!prepared.ok) return { ok: true, path: target, committed: false, warning: prepared.error };

  const committed = await commitAll(repoDir, `atlas: publish ${audience} bundle (${bundle.entryCount} repos)`);
  if (!committed.committed) return { ok: true, path: target, committed: false, detail: 'nothing changed' };

  const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoDir })).stdout || 'main';
  const pushed = await git(['push', 'origin', branch], { cwd: repoDir });

  return { ok: true, path: target, committed: true, pushed: pushed.ok, detail: pushed.ok ? null : pushed.stderr };
}

async function getSyncStatus() {
  const dir = store.registryDir();
  const config = store.loadConfig();

  if (!isGitRepo(dir)) {
    return { tracked: false, remote: config.remote || null, dir, hint: 'run `atlas sync` to start tracking the registry in git' };
  }

  const [branch, status, ahead] = await Promise.all([
    git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir }),
    git(['status', '--porcelain'], { cwd: dir }),
    git(['rev-list', '--count', '@{upstream}..HEAD'], { cwd: dir })
  ]);

  return {
    tracked: true,
    dir,
    remote: config.remote || null,
    branch: branch.stdout || null,
    dirty: status.stdout.length > 0,
    unpushed: ahead.ok ? Number(ahead.stdout) || 0 : null,
    subscriptions: store.loadSubscriptions().map((sub) => ({ name: sub.name, entries: sub.entries.length, generatedAt: sub.generatedAt }))
  };
}

module.exports = {
  git,
  isGitRepo,
  ensureRepo,
  seedRepoFiles,
  commitAll,
  syncRegistry,
  setRemote,
  subscribe,
  publishBundle,
  getSyncStatus
};
