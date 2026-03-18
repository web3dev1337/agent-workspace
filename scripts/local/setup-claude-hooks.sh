#!/bin/bash

# Setup Claude hooks in each worktree to notify orchestrator when Claude is ready.
# This helper targets an older local HyFire2-workN layout and is kept as a local-only tool.

ORCHESTRATOR_PORT=${ORCHESTRATOR_PORT:-3000}
WORKTREE_BASE="${WORKTREE_BASE_PATH:-$HOME}"

for i in {1..8}; do
  WORKTREE_DIR="$WORKTREE_BASE/HyFire2-work$i"
  CLAUDE_DIR="$WORKTREE_DIR/.claude"

  if [ -d "$WORKTREE_DIR" ]; then
    echo "Setting up hooks for work$i..."
    mkdir -p "$CLAUDE_DIR"

    cat > "$CLAUDE_DIR/settings.json" << EOF
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Claude ready work$i' && curl -s -X POST http://localhost:$ORCHESTRATOR_PORT/api/claude-ready -H 'Content-Type: application/json' -d '{\\\"worktree\\\": \\\"work$i\\\", \\\"sessionId\\\": \\\"work$i-claude\\\"}' || true"
          }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Notification sent' || true"
          }
        ]
      }
    ]
  }
}
EOF

    echo "Created $CLAUDE_DIR/settings.json"
  fi
done

echo "Claude hooks setup complete"
