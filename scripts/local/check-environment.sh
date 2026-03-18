#!/bin/bash

echo "Environment Check for Agent Workspace"
echo "====================================="

echo -n "Node.js: "
if command -v node >/dev/null 2>&1; then
  echo "OK $(node -v)"
else
  echo "Not found"
fi

echo -n "npm: "
if command -v npm >/dev/null 2>&1; then
  echo "OK $(npm -v)"
else
  echo "Not found"
fi

echo -n "bun: "
if command -v bun >/dev/null 2>&1; then
  echo "OK $(bun -v)"
elif [ -f "/snap/bin/bun" ]; then
  echo "Found in /snap/bin/bun but not in PATH"
  echo "Add to PATH: export PATH=/snap/bin:\$PATH"
else
  echo "Not found"
fi

echo -n "Claude CLI: "
if command -v claude >/dev/null 2>&1; then
  echo "Available"
else
  echo "Not found - install with: npm install -g @anthropic-ai/claude-cli"
fi

echo ""
echo "Worktree Check:"
WORKTREE_BASE="${WORKTREE_BASE_PATH:-$HOME}"
echo "  Base path: $WORKTREE_BASE"
for i in {1..8}; do
  path="$WORKTREE_BASE/HyFire2-work$i"
  if [ -d "$path" ]; then
    echo "OK work$i: $path"
  else
    echo "Missing work$i: $path"
  fi
done

echo ""
echo "Current PATH includes:"
echo "$PATH" | tr ':' '\n' | grep -E "(snap|bun|node)" || echo "  No special paths found"

echo ""
echo "Quick fixes:"
echo "  bun not in PATH: export PATH=/snap/bin:\$PATH"
echo "  Missing Claude CLI: npm install -g @anthropic-ai/claude-cli"
echo "  Missing worktrees: create git worktrees or update .env"
