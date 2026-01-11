#!/bin/bash
set -e
cd ~/.claude/hooks
cat | node dist/pre-compact-continuity.mjs
