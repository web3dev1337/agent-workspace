#!/bin/bash

# Build and run the diff viewer

echo "🔨 Building the diff viewer client..."
cd /home/<user>/HyFire2-work1/claude-orchestrator/diff-viewer/client

# Build the client
npm run build

# Check if build succeeded
if [ -d "dist" ]; then
    echo "✅ Client built successfully!"
    echo ""
    echo "📁 Contents of dist folder:"
    ls -la dist/
    echo ""
    echo "🚀 Now access the viewer at: http://localhost:7655"
    echo "⚠️  Make sure you're using port 7655, not 7656!"
else
    echo "❌ Build failed. Trying alternative approach..."
    
    # Try with npx vite build directly
    npx vite build
fi