# Production Update — 2026-08-15

Production `master/` checkout updated from a stale feature branch to latest GitHub main.

## What changed
- Now on `main` at `3ea40167` (PR #1028, tip of https://github.com/web3dev1337/agent-workspace/commits/main). Was ~640 commits behind.
- No `npm install` needed — dependencies identical between old and new code.
- Server restart deferred via nodemon SIGSTOP so live sessions survived the file swap; go-live restart triggered by detached script (result appended at the bottom of this file).

## Findings
1. **Wrong-window game commits**: this checkout was on `feature/mobile-worktree-sidebar-controls`, which carries 12 commits of a "bullet-inferno" canvas game (wrong-session paste). Parked on that branch, NOT sent to main. Branch can be deleted or the game rescued elsewhere later.
2. **CORS fix preserved**: the uncommitted `server/index.js` tweak allowing `http://172.*` origins (WSL2/LAN + phone access) is NOT in main — PR #998 (`fix/cors-wsl2-origin`) has a better-scoped RFC1918 version and is still open. The tweak was re-applied on top of main so LAN access keeps working. Backup: `~/prod-local-tweaks-backup-20260815.patch`. TODO: merge PR #998, then drop the local tweak.
3. **git stash silently broken**: a 0-byte `.git/index.lock` from an April 8 crash made `git stash` exit 1 with no output. Stale lock removed; gotcha logged to `~/.claude/CLAUDE.md` and pushed.
4. **`work-fix-batch-launch` worktree** held the `main` branch; its HEAD was detached (at the same commit, uncommitted changes untouched) so `main` could be checked out in `master/`.
5. **Junk files** `=0.35`, `=4.0`, `=4.48.1` in repo root (artifacts of an unquoted `pip install pkg>=x`) left in place — delete if unwanted.
6. Also uncommitted and preserved: a small `diff-viewer/client/package-lock.json` change.

## After restart
- Web UI: Ctrl+F5 at the usual orchestrator URL (port 3000).
- Commander Claude session died with the restart — relaunch from the Commander panel.
- Open PRs worth landing: #998 (CORS), #1027 (tmux session persistence — would make future restarts non-lethal to sessions).

## Restart result
(appended by go-live script)
- 08:57:11: SUCCESS — server restarted on new code, new pid 51472, port 3000 listening.
