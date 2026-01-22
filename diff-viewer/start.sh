#!/bin/bash

echo "🚀 Starting Advanced Diff Viewer..."

# Check if .env exists
if [ ! -f .env ]; then
    echo "⚠️  No .env file found. Creating from .env.example..."
    cp .env.example .env
    echo "📝 Optional: add GITHUB_TOKEN to .env for Octokit auth (otherwise uses gh CLI)"
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing server dependencies..."
    npm install
fi

if [ ! -d "client/node_modules" ]; then
    echo "📦 Installing client dependencies..."
    cd client && npm install && cd ..
fi

# Start servers
echo "🔧 Starting backend server on port 7655..."
npm run dev &
BACKEND_PID=$!

echo "🎨 Starting frontend dev server on port 7656..."
cd client && npm run dev &
FRONTEND_PID=$!

echo ""
echo "✅ Diff Viewer is running!"
echo "   Backend:  http://localhost:7655"
echo "   Frontend: http://localhost:7656"
echo ""
echo "Press Ctrl+C to stop both servers"

# Wait for Ctrl+C
trap "kill $BACKEND_PID $FRONTEND_PID; exit" INT
wait
