#!/bin/bash
# Install missing dependencies

echo "Installing missing dependencies..."

# Check if npm is available
if ! command -v npm &> /dev/null; then
    echo "npm is not installed. Please install Node.js/npm first."
    exit 1
fi

# Navigate to the diff-viewer directory
cd /home/<user>/HyFire2-work1/claude-orchestrator/diff-viewer

# Install specific missing packages
npm install diff@^5.1.0 js-yaml@^4.1.0 json-diff@^1.0.6

echo "Dependencies installed successfully!"
echo ""
echo "Now you can run the tests:"
echo "  node examples/test-minified.js"
echo "  node examples/test-json-yaml.js" 
echo "  node examples/test-binary.js"