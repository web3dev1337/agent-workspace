# Public Release Security & Privacy Audit (2026-02-05)

Scope: `claude-orchestrator-dev` repo contents **and full git history**, assuming the repo may be made public on GitHub.

This is an updated audit after the Windows/public-release hardening work (late Jan → early Feb 2026).

## Summary (what matters)

- ✅ **Secrets (history)**: `gitleaks` reports **no leaked secrets** (scanned **1,238 commits**).
- ✅ **Network safety defaults (current HEAD)**:
  - Orchestrator binds to **loopback by default** (`127.0.0.1`) and refuses LAN binding without `AUTH_TOKEN` unless explicitly overridden.
  - Diff viewer binds to **loopback by default** and keeps **CORS disabled by default**.
- ⚠️ **Git history still contains non-public artifacts** that were previously committed (even if removed from HEAD):
  - `diff-viewer/cache/diffs.db` (derived cache DB)
  - `test-results/.last-run.json` (test artifact)
- ⚠️ **Git history metadata contains personal author/committer emails** (7 unique emails; includes Gmail addresses).
- ⚠️ **Docs/skills include “internal project naming”** (e.g. `HyFire2`, repo URLs, and workflow examples). Not secrets, but decide if you want them public.

If you want a truly “clean public repo”, you must either:
- **rewrite history** (destructive; force push), or
- publish a **new squashed public repo** (safest/simplest).

## What was checked (repeatable)

### 1) Automated secret scan (git history)

Run:
- `gitleaks detect --source . --log-opts="--all" --redact`

Result:
- **no leaks found** (1,238 commits scanned).

### 2) “Should never be committed” artifact checks

Verified in current HEAD:
- `diff-viewer/cache/` is ignored (and not present)
- `test-results/` is ignored (local file exists but not tracked)
- `.env` and `user-settings.json` are ignored (local files exist but not tracked)

Verified in history:
- `diff-viewer/cache/diffs.db` existed in history (needs rewrite/squash to remove fully)
- `test-results/.last-run.json` existed in history (needs rewrite/squash to remove fully)

### 3) Git history PII (author/committer metadata)

Unique emails found in git metadata (author/committer):
- `143916802+archanon@users.noreply.github.com`
- `160291380+web3dev1337@users.noreply.github.com`
- `192667251+AnrokX@users.noreply.github.com`
- `Shrimpchicken8@gmail.com`
- `shrimpchicken8@gmail.com`
- `dev@example.com`
- `noreply@github.com`

This is normal for private repos, but if the repo becomes public those emails are visible.

## Risk assessment (public repo)

### Critical (must address if you want “clean public history”)

1) **History contains derived/private artifacts**
- Even though these are no longer tracked in HEAD, they remain accessible in git history:
  - `diff-viewer/cache/diffs.db`
  - `test-results/.last-run.json`

Mitigation options:
- Rewrite history (see `PLANS/2026-02-05/HISTORY_REWRITE_PRIVACY_EMAILS_PLAN.md`)
- OR publish a new public repo from a squashed snapshot

### High (privacy / reputation)

2) **Personal emails in git metadata**
- If you want to avoid exposing personal emails publicly, you must:
  - rewrite history to replace emails, or
  - publish a squashed repo (no history), and
  - set future commits to use GitHub noreply email.

### Medium (public-facing cleanliness)

3) **Internal project naming and example URLs in docs**
- The repo includes lots of realistic examples (`HyFire2`, other repo URLs, etc.).
- Not secrets by default, but these are “fingerprints”.

Mitigation options (non-destructive, normal PR):
- Replace examples with placeholders (`OWNER/REPO`, `~/Projects/MyGame`, etc.)
- Move private/internal workflow docs to a private companion repo

## Recommendations (pragmatic)

### Option A (recommended): New public repo with 1 squashed commit

Best when:
- you don’t need the private history
- you want the lowest-risk public release

Process:
- make a clean working tree (remove/placeholder internal docs you don’t want public)
- create a new repo and push a single commit
- keep the original private repo as the “development” repo if desired

### Option B: Keep full history public (hard mode)

Best when:
- you want preserved blame/history/PR linkage

Process:
- perform a controlled history rewrite:
  - remove historical artifacts (`diff-viewer/cache/diffs.db`, `test-results/.last-run.json`, etc.)
  - rewrite author/committer emails
  - force push
- follow the aftercare steps (everyone re-clones)

Exact steps are documented here:
- `PLANS/2026-02-05/HISTORY_REWRITE_PRIVACY_EMAILS_PLAN.md`

## Notes / “what this does not cover”

- GitHub Issues/PR comments are not in git history; history rewrite won’t remove them.
- If you publish binaries/installer releases, you should also:
  - sign them eventually (reduces SmartScreen friction)
  - make sure logs aren’t accidentally bundled

