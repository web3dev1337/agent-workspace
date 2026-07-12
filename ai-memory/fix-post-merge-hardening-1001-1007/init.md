# Post-merge hardening for SmolSmolStar PRs #1001-#1007

User request: review all 7 PRs, fix the nits found in review, merge with credit,
add the tests the PR descriptions referenced but didn't commit, then release.

Fixes in this branch (sources reviewed + merged already on main):
- #1001: surface undelivered forwarded slash commands (Commander PTY not running)
- #1003: resizeSession no-op skip gets a 60s re-assert cooldown (silent OS resize failure)
- #1005: badge resolves env overrides (ANTHROPIC_MODEL, ANTHROPIC_DEFAULT_*_MODEL aliases incl fable,
  CLAUDE_CODE_EFFORT_LEVEL, ~/.claude/.env), tooltip discloses scope, non-claude/codex agents hidden,
  ultra/ultra-code effort tinted, mobile max-width, focus refresh
- #1006: startup sessions rebroadcast skipped if workspace switched mid-init
- #1007: banner regex ignores upgrade-notice version arrows; commit the missing launch-queue tests
- #1004: add missing tests for claudeProjectFolderName + latest-conversation fallback
