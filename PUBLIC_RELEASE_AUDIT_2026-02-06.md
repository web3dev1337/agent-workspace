# Public Release Security & Privacy Audit (2026-02-06)

Scope: `claude-orchestrator-dev` repo contents **and full git history**, assuming this repository may become public on GitHub and/or be distributed as Windows installers.

This audit is intended to be:
- **Repeatable** (commands included)
- **Non-destructive** (no history rewrite performed here)
- **Actionable** (clear mitigation options)

If you want the actual destructive cleanup (history rewrite / squashed-repo release), follow:
- `PLANS/2026-02-05/HISTORY_REWRITE_PRIVACY_EMAILS_PLAN.md`

---

## Summary (what matters)

### ✅ Secrets
- **Git history secret scan**: `gitleaks` scanned **1,246 commits** → **no leaks found**.
- Additional “common token” regex checks (filenames only) → **no hits**.

### ⚠️ Privacy (git metadata)
- **Git history includes author/committer emails**, including at least one personal email address (non-noreply).
- This is not in the working tree; it’s in **commit metadata** and will be public if the full history is public.

### ⚠️ Git history contains non-public artifacts (even if removed from HEAD)
Found in history:
- `diff-viewer/cache/diffs.db` (largest blob in history, ~3.9MB)
- `test-results/.last-run.json` and `test-results/` directory

These are not necessarily “secrets”, but they are **derived artifacts** and/or **local test noise** that you probably don’t want permanently public.

### ✅ Network safety defaults (current HEAD)
- Orchestrator binds to **loopback by default** (`127.0.0.1`).
- Orchestrator refuses LAN binding without `AUTH_TOKEN` unless explicitly overridden.
- Diff viewer binds to **loopback by default** and keeps **CORS disabled by default**.

---

## What was checked (repeatable)

### 1) Automated secret scan (git history)

Run:
- `gitleaks detect --source . --log-opts="--all" --redact --report-path /tmp/gitleaks.json --exit-code 0`

Result:
- **No leaks found**.

Notes:
- Depending on gitleaks version, the JSON report may be `[]` (array) when no leaks are found.

### 2) Large / suspicious blobs in history

Run:
- `git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | awk '$1=="blob"{print $3"\t"$4}' | sort -nr | head -n 30`

Top item found:
- `diff-viewer/cache/diffs.db` (~3.9MB)

### 3) “Never commit” artifacts in history (targeted)

Run:
- `git rev-list --objects --all | rg -i '(diffs\\.db|test-results)' | head`
- `git log --all --oneline -- diff-viewer/cache/diffs.db | head`
- `git log --all --oneline -- test-results/.last-run.json | head`

Result:
- These artifacts exist in history. Removing them **requires** history rewrite or a new squashed public repo.

### 4) Git history PII (author/committer metadata)

Run:
- `git log --all --format='%ae%n%ce' | tr '[:upper:]' '[:lower:]' | sed '/^$/d' | sort | uniq -c | sort -nr | head`

Result:
- Includes a personal email (non-noreply).

Important:
- **Do not** commit the raw email list into the repo (that re-leaks it into HEAD).

---

## Risk assessment (public repo)

### Critical (must address if you want “clean public history”)

1) **History contains derived/local artifacts**
- `diff-viewer/cache/diffs.db`
- `test-results/.last-run.json` (+ directory)

Mitigation options:
- **Option A (recommended): publish a new repo** with a single squashed commit
- **Option B: rewrite history** (force push), removing those paths

References:
- `PLANS/2026-02-05/HISTORY_REWRITE_PRIVACY_EMAILS_PLAN.md`

### High (privacy / reputation)

2) **Personal emails in commit metadata**
- If full history is public, those emails are public.

Mitigation options:
- Rewrite history to replace author/committer emails
- OR publish a squashed repo (no history) and switch future commits to GitHub noreply

### Medium (security posture if misconfigured)

3) **Local-control endpoints become dangerous if exposed to LAN**

The orchestrator is intentionally powerful (it controls terminals and can run commands).
This is fine when local-only, but becomes serious if LAN binding is enabled without auth.

Current mitigation in code:
- requires `AUTH_TOKEN` for non-loopback binding unless explicitly overridden

Recommendation:
- Keep the default loopback-only binding
- Treat LAN mode as an advanced feature that always requires `AUTH_TOKEN`

---

## Code-level “security hygiene” notes

These are not known CVEs; they’re “hardening points” to keep the codebase safe as it goes public.

1) **Avoid shell interpolation where possible**
- Prefer `execFile()` / `spawn()` with args arrays instead of `exec()` with string commands.
- This reduces command injection risk and improves Windows compatibility.

Places to pay attention to:
- `server/gitUpdateService.js` uses `exec()` and interpolates a branch name into a shell string.
- `server/index.js` contains a `reveal-in-explorer` handler that shells out to open Explorer.

2) **Tauri window eval**
- `src-tauri/src/main.rs` calls `window.eval(...)` for a small amount of JS injection into the webview.
- It appears to be internal-only; keep it that way (never pass untrusted user input into that JS string).

3) **Docs contain “fingerprints”**
- Some docs contain real repo names/URLs and home-folder paths.
- This is not “secret” by default, but decide what should remain public.

---

## Recommendations (pragmatic)

### If the goal is “public GitHub repo + sellable Windows installer”

1) Pick a public strategy:
- **Open-core** (public core + private Pro plugins/modules) is the most realistic way to monetize without adding a SaaS surface.

2) Make the public history clean (choose one):
- **New squashed public repo** (simplest/safest)
- **History rewrite** (hard mode, preserves blame)

3) Add standard public-facing files:
- `SECURITY.md` (vuln reporting + threat model summary)
- `CONTRIBUTING.md` (optional)

4) Keep LAN mode safe:
- loopback-only default
- require `AUTH_TOKEN` for LAN
- document that LAN mode gives near-full machine control (by design)

---

## Appendix: one-line “audit script” commands

Secrets (history):
- `gitleaks detect --source . --log-opts="--all" --redact`

Big blobs in history:
- `git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | awk '$1=="blob"{print $3"\t"$4}' | sort -nr | head`

Email metadata:
- `git log --all --format='%ae%n%ce' | tr '[:upper:]' '[:lower:]' | sed '/^$/d' | sort | uniq -c | sort -nr | head`

