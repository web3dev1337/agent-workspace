#!/bin/bash
set -e
cd ~/.claude/hooks
cat | node dist/session-start-continuity.mjs
