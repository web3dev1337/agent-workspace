#!/bin/bash

echo "🔍 Environment Check for Claude Orchestrator"
echo "==========================================="

# Check Node.js
echo -n "Node.js: "
if command -v node &> /dev/null; then
    echo "✅ $(node -v)"
else
    echo "❌ Not found"
fi

# Check npm
echo -n "npm: "
if command -v npm &> /dev/null; then
    echo "✅ $(npm -v)"
else
    echo "❌ Not found"
fi

# Check bun
echo -n "bun: "
if command -v bun &> /dev/null; then
    echo "✅ $(bun -v)"
elif [ -f "/snap/bin/bun" ]; then
    echo "⚠️  Found in /snap/bin/bun but not in PATH"
    echo "   Add to PATH: export PATH=/snap/bin:\$PATH"
else
    echo "❌ Not found"
fi

# Check Claude CLI
echo -n "Claude CLI: "
if command -v claude &> /dev/null; then
    echo "✅ Available"
else
    echo "❌ Not found - install with: npm install -g @anthropic-ai/claude-cli"
fi

# Check worktrees
echo ""
echo "📁 Worktree Check:"
for i in {1..8}; do
    path="/home/<user>/HyFire2-work$i"
    if [ -d "$path" ]; then
        echo "✅ work$i: $path"
    else
        echo "❌ work$i: $path (missing)"
    fi
done

# Check PATH
echo ""
echo "🛤️  Current PATH includes:"
echo "$PATH" | tr ':' '\n' | grep -E "(snap|bun|node)" || echo "   No special paths found"

echo ""
echo "💡 Quick fixes:"
echo "   bun not in PATH: export PATH=/snap/bin:\$PATH"
echo "   Missing Claude CLI: npm install -g @anthropic-ai/claude-cli"
echo "   Missing worktrees: Create git worktrees or update .env"