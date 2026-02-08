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
