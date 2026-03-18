# Public Release Security & Privacy Audit (2026-02-04)

Scope: `claude-orchestrator-dev` repo contents + full git history, assuming the repo may be made public (GitHub).

## Summary

- ✅ **Secret scan (git history)**: `gitleaks` found **no leaked secrets** (1,229 commits scanned).
- ⚠️ **Privacy exposures** exist in tracked files (absolute paths, usernames, private project names).
- ❌ **Critical: tracked cache database** contains diff-viewer cached PR metadata (and likely derived content).
- ❌ **Critical: diff-viewer server enables permissive CORS** and binds to all interfaces by default.
- ⚠️ **High: orchestrator server binds to all interfaces by default** (`0.0.0.0`) unless overridden.
- ⚠️ **Git history metadata includes personal emails** (author/committer); expected, but public-facing.

This doc separates:
- **“Fixable with a normal PR”** (code/docs changes on `main`)
- **“Requires history rewrite or new repo”** (anything already committed to history that you want gone)

## What was checked

### 1) Automated secret scanning (history)
- `gitleaks detect --log-opts="--all" --redact` on the repo.

### 2) Manual “sensitive patterns” search (working tree)
- GitHub PAT prefixes, Anthropic key prefixes, private key PEM markers
- Tracked file types: `.env*`, `.npmrc`, `.netrc`, `*.pem`, `*.key`, `*.p12`, `*.db`, etc.

### 3) Privacy/PII search (tracked files)
- Absolute paths (`/home/<user>/…`, `C:\\Users\\<user>\\…`, `/mnt/c/Users/<user>/…`)
- Email addresses in repo contents (none found), and unique author/committer emails in git metadata
- “Internal / private” references in docs (project names, repo URLs, PR numbers)

## Findings (prioritized)

### Critical (must address before public release)

1) **Tracked diff-viewer cache database**
- File: `diff-viewer/cache/diffs.db`
- Type: SQLite DB (tracked in git).
- Contains cached PR metadata (at minimum `owner`, `repo`, `number`, `sha`) and stored “analysis/data” fields.
- This is **not appropriate to ship** and is also a **privacy risk** for any private repos it references.

Normal PR fix:
- Remove the file from git tracking.
- Add `diff-viewer/cache/` (or at least `diff-viewer/cache/*.db`) to `.gitignore`.

History impact:
- The DB content is already in git history. If you want it *gone* from a public repo, you must **rewrite history** (or publish a new repo with a squashed snapshot).

2) **Diff viewer network exposure + CORS**
- File: `diff-viewer/server/index.js`
- Issues:
  - `server.listen(PORT)` binds to all interfaces by default.
  - `app.use(cors())` enables permissive cross-origin reads.
- Risk:
  - Any website running in the user’s browser can potentially read data from the local diff viewer server
    (including private PR information fetched using `GITHUB_TOKEN`), because CORS is wide open.

Normal PR fix:
- Bind to loopback by default (e.g. `127.0.0.1`).
- Disable CORS by default, or restrict it to explicit allowed origins (and keep it off unless needed).

### High

3) **Orchestrator server binds to all interfaces by default**
- File: `server/index.js`
- Current default: `ORCHESTRATOR_HOST || HOST || '0.0.0.0'`
- Risk:
  - The orchestrator exposes powerful local-machine capabilities (process spawning, filesystem access, etc.).
  - If reachable on LAN without `AUTH_TOKEN`, this becomes “remote control” of the machine.

Normal PR fix:
- Default bind host to `127.0.0.1` (local-only).
- If the user explicitly binds to non-loopback, strongly warn or require `AUTH_TOKEN`.

### Medium (privacy / public-facing cleanliness)

4) **Absolute user paths and usernames in docs**
- Many tracked docs include `/home/<user>/...`, `/home/<user>/...`, and at least one Windows path `C:\\Users\\<user>\\...`.
- These are not “secrets”, but they are **personal identifiers** and confusing for new users.

Normal PR fix:
- Replace with `~`, `$HOME`, `%USERPROFILE%`, `%LOCALAPPDATA%`, or `<YOUR_USERNAME>`.

History impact:
- If you need these *removed from history*, you must rewrite history (or publish a squashed snapshot).

5) **Internal project names / URLs in docs**
- Example: hardcoded references like `NeuralPixelGames/HyFire2` in diff-viewer debug docs.
- Not inherently secret, but may reveal private projects and increases accidental leakage risk.

Normal PR fix:
- Replace with placeholders (`OWNER/REPO/PR_NUMBER`) or public examples (`octocat/Hello-World#1`).

### Low

6) **Tracked test artifact**
- File: `test-results/.last-run.json`
- Should not be tracked (Playwright output); `.gitignore` already ignores `test-results/` but this file is committed.

Normal PR fix:
- Remove it from git tracking.

## Git history metadata (emails)

Even when no secrets are committed, **author/committer emails** are part of git history and become public on GitHub.

Options if you want to minimize exposure:

1) **Accept it** (most open source projects do).
2) **Rewrite history to change author emails** (destructive; requires force push).
3) **Publish a new repo with a squashed snapshot** (keeps code, drops history).

## Recommended “public release” strategy

### If you want to keep full history public
- Do the normal PR fixes above **AND** run a history rewrite to remove:
  - `diff-viewer/cache/diffs.db`
  - any other internal/private docs you don’t want public
  - (optionally) rewrite author emails to GitHub noreply

### If you want the safest / simplest path
- Create a **new public repository** with a **single squashed commit** of the cleaned tree.
  - Pros: simplest, avoids history leaks.
  - Cons: you lose rich history/blame.

## Release checklist (minimum)

- [ ] Delete `diff-viewer/cache/diffs.db` from git tracking + ignore it going forward.
- [ ] Disable diff-viewer permissive CORS + bind diff-viewer to loopback by default.
- [ ] Bind orchestrator to loopback by default; warn/require `AUTH_TOKEN` for non-loopback.
- [ ] Remove `test-results/.last-run.json` from tracking.
- [ ] Replace `/home/<user>` + `C:\\Users\\<USER>` etc in docs with placeholders.
- [ ] Decide whether to (a) rewrite history or (b) publish a squashed snapshot repo.
