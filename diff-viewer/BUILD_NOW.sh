#!/bin/bash

echo "🚀 QUICK BUILD SCRIPT"
echo "===================="
echo ""

# Navigate to client directory
cd /home/ab/HyFire2-work1/claude-orchestrator/diff-viewer/client

# Run the build
echo "Running: npm run build"
echo ""

# Execute build with output
npm run build 2>&1

echo ""
echo "Build complete! Check above for any errors."
echo ""
echo "If successful, access at: http://localhost:7655"