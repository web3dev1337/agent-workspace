# History rewrite plan (remove privacy leaks + author emails)

Date: 2026-02-05

Goal: if we make this repo public on GitHub, remove sensitive/irrelevant artifacts from **git history** and optionally rewrite author/committer emails.

Important: **Do not run this casually**. It is destructive (commit SHAs change) and requires a force push. This doc is the “exact steps” plan; execution should happen in a dedicated maintenance window.

---

## What we’re trying to remove from history

### A) Derived artifacts that should never have been committed

Remove these paths from all history (exact list may grow):
- `diff-viewer/cache/` (especially `diff-viewer/cache/diffs.db`)
- `test-results/.last-run.json`
- `config.json.pre-workspace-backup`
- any other generated caches / local machine artifacts

### B) PII-like “developer fingerprints” in docs

Examples:
- absolute paths (`/home/<user>/...`, `C:\\Users\\<user>\\...`, `/mnt/c/Users/<user>/...`)
- internal project names / private repo references

These are not “secrets”, but if you want a clean public repo, you’ll want them removed from history too.

### C) Author/committer emails in git metadata

Git history contains author/committer fields. Making the repo public makes those emails visible.

We should:
- rewrite them to GitHub `@users.noreply.github.com`, or
- rewrite them to a brand identity, or
- accept them (common for OSS), or
- publish a new squashed repo with no history.

This plan assumes we want to **rewrite** them.

---

## Safest alternative (no history rewrite)

If you don’t need to keep history:
- Create a new public repo from a clean working tree (single squashed commit).

Pros: simplest, avoids history leaks entirely.
Cons: loses blame/history/PR linkage.

---

## Operational plan (history rewrite)

### 0) Freeze merges and notify collaborators

- Pause new PR merges.
- Tell everyone they will need to **re-clone** or hard-reset their local branches after the rewrite.

### 1) Make an immutable backup (mirror clone)

On a safe machine/location:
- Create a mirror clone of the current repo.
- Archive it (so you can recover anything later).

Example:
- `git clone --mirror <repo-url> claude-orchestrator.mirror.git`
- `tar -czf claude-orchestrator.mirror.git.tgz claude-orchestrator.mirror.git`

### 2) Prepare tooling

Use one of:
- `git filter-repo` (recommended)
- BFG Repo-Cleaner (less flexible)

Non-destructive prep helper now available:
- `npm run audit:history-authors`
- Optional outputs:
  - `node scripts/audit-history-authors.js --json /tmp/history-authors.json --md /tmp/history-authors.md --mailmap /tmp/history-authors.mailmap`
- This does not rewrite history; it only audits author/committer email usage and generates a private mailmap starter file.
- Tool bootstrap helper:
  - `npm run setup:history-rewrite-tools`
  - Optional auto-install attempt:
    - `npm run setup:history-rewrite-tools -- --apply`
  - Supports `--only git-filter-repo` / `--only gitleaks` when you need one specific dependency.
- One-command prep pipeline:
  - `npm run prep:history-rewrite:pipeline`
  - Optional strict maintenance-window gate in one run:
    - `npm run prep:history-rewrite:pipeline -- --strict`
  - Optional auto-tool bootstrap attempt:
    - `npm run prep:history-rewrite:pipeline -- --apply-tools`
  - Optional persisted report artifacts:
    - `npm run prep:history-rewrite:pipeline -- --report-dir /tmp/history-rewrite-reports`
    - writes:
      - `prep-report.json`
      - `prep-report.md`
      - per-step JSON files (`setup-tools.json`, `prepare-workkit.json`, `readiness-check.json`)
  - Pipeline runs:
    - dependency bootstrap check
    - workkit generation
    - readiness preflight check
- Post-rewrite verification helper:
  - Strict: `npm run check:history-rewrite-result`
  - Advisory: `npm run check:history-rewrite-result:advisory`
  - Checks:
    - custom author/committer emails are removed (or explicitly allowed)
    - blocked history paths are absent across `git log --all --name-only`
- Mailmap finalizer helper:
  - `npm run prep:history-rewrite:mailmap-finalize -- --workkit-dir /tmp/history-rewrite-workkit`
  - Optional explicit target:
    - `npm run prep:history-rewrite:mailmap-finalize -- --workkit-dir /tmp/history-rewrite-workkit --target-email <id+user@users.noreply.github.com>`
  - Replaces `REPLACE_WITH_NOREPLY_EMAIL` placeholders in `mailmap.private.txt` with a real noreply email (default from global git config).
- Guarded execution helper (maintenance window):
  - Plan only (safe/default):
    - `npm run history-rewrite:execute:plan -- --workkit-dir /tmp/history-rewrite-workkit --clone-dir /path/to/fresh-rewrite-clone`
  - Execute rewrite in clone (still no push unless requested):
    - `npm run history-rewrite:execute:plan -- --workkit-dir /tmp/history-rewrite-workkit --clone-dir /path/to/fresh-rewrite-clone --execute --confirm I_UNDERSTAND_HISTORY_REWRITE`
  - Optional force-push (double-confirmed):
    - add `--push --confirm-push PUSH_REWRITTEN_HISTORY`
  - Safety gates:
    - refuses execution if mailmap has placeholders
    - refuses execution if clone is dirty
    - runs strict post-rewrite verification before any push (unless explicitly skipped)
- Full private execution prep workkit:
  - `npm run prep:history-rewrite`
  - Optional custom output directory:
    - `node scripts/generate-history-rewrite-workkit.js --out-dir /tmp/history-rewrite-workkit`
  - Generated artifacts include:
    - `history-authors.json` / `history-authors.md` (audit evidence)
    - `mailmap.private.txt` (fill in noreply targets)
    - `paths-to-remove.txt` (history removal path list)
    - `run-filter-repo.sh` + `history-rewrite-runbook.md` (execution helpers)
  - This is still non-destructive; no rewrite commands are executed automatically.
- Rewrite readiness gate:
  - Advisory mode: `npm run check:history-rewrite-readiness -- --workkit-dir /tmp/history-rewrite-workkit`
  - Strict gate mode: `npm run check:history-rewrite-readiness:strict -- --workkit-dir /tmp/history-rewrite-workkit`
  - Strict mode fails fast when required prerequisites are missing (repo identity, clean worktree, filter-repo, gitleaks, workkit files).

### 3) Rewrite: remove files/directories from all history

In a fresh clone:
- Remove the known-bad paths from history.

Example (conceptual):
- `git filter-repo --path diff-viewer/cache --invert-paths`
- `git filter-repo --path test-results/.last-run.json --invert-paths`

Repeat for each path (or combine multiple `--path` flags).

### 4) Rewrite: author/committer emails

Do **not** commit the actual email list into the repo (that leaks it again).

Approach options:

Option A: `.mailmap` + filter-repo mailmap pass
- Create a private mailmap file mapping old emails → new noreply email(s).
- Apply via filter-repo.

Option B: filter-repo `--commit-callback`
- Replace `commit.author_email` / `commit.committer_email` programmatically.

Recommended output format:
- `Full Name <12345678+username@users.noreply.github.com>`

### 5) Post-rewrite validation

Run:
- `gitleaks detect --log-opts="--all" --redact`
- targeted ripgrep searches for:
  - `/home/`
  - `C:\\Users\\`
  - `/mnt/c/Users/`
  - known private repo names (if any)

Also verify:
- `git log` shows rewritten emails
- removed files no longer exist in any commit

### 6) Force push rewritten history

- Force push branches and tags.
- Ensure the default branch is correct.

### 7) Aftercare

Everyone must:
- delete old clones, or
- hard-reset to the new history, or
- re-clone.

Also update:
- `git config user.email` locally to a noreply email
- GitHub setting: “Keep my email address private”

---

## What this does NOT remove

- Emails/usernames in **GitHub Issues/PR comments** (those live on GitHub, not in git history).
- Anything copied/pasted into external places (CI logs, Slack, etc.).

---

## Checklist for “OK to go public”

- [ ] History rewritten OR new squashed public repo created
- [x] Secrets scan passes (history)
- [x] No tracked caches/DBs
- [x] Default bind host is loopback; LAN requires auth token
- [x] Docs don’t contain personal paths/usernames

Status notes (2026-02-06):
- History scan now passes via `npm run audit:public-release:history` (uses `.gitleaksignore` for two known fixture fingerprints from historical test data).
- Public docs path hygiene + tracked-artifact checks are automated by `scripts/public-release-audit.js`.
- Remaining destructive item is intentional: rewrite history (or publish a new squashed repo) to remove historical metadata/artifacts.

Status notes (2026-02-08):
- Added `scripts/audit-history-authors.js` and `npm run audit:history-authors` so rewrite inputs can be prepared safely before any destructive history operation.
- Added `scripts/generate-history-rewrite-workkit.js` and `npm run prep:history-rewrite` to produce a private rewrite runbook + command kit for a controlled maintenance-window execution.
- Added `scripts/check-history-rewrite-readiness.js` and `npm run check:history-rewrite-readiness` to enforce a non-destructive preflight gate before any rewrite maintenance window.
- Added `scripts/setup-history-rewrite-tools.js` and `npm run setup:history-rewrite-tools` for cross-platform dependency bootstrap guidance (`git-filter-repo`, `gitleaks`).
- Added `scripts/run-history-rewrite-prep.js` and `npm run prep:history-rewrite:pipeline` for one-command non-destructive prep orchestration.
- Added `scripts/verify-history-rewrite-result.js` and `npm run check:history-rewrite-result` for post-rewrite pass/fail verification.
- Added `scripts/finalize-history-rewrite-mailmap.js` and `npm run prep:history-rewrite:mailmap-finalize` to convert placeholder mailmap entries to a concrete noreply mapping.
- Added `scripts/execute-history-rewrite.js` and `npm run history-rewrite:execute:plan` as a guarded maintenance-window rewrite executor (plan by default; explicit confirm required for execution/push).
