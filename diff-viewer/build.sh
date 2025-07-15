#!/bin/bash

echo "🔨 Building Advanced Diff Viewer for production..."

# Build client
echo "📦 Building client..."
cd client
npm ci
npm run build
cd ..

# Prepare server
echo "📦 Preparing server..."
npm ci --only=production

# Create production directory
echo "📁 Creating production build..."
mkdir -p dist
cp -r server dist/
cp -r client/dist dist/client
cp package.json dist/
cp package-lock.json dist/
cp .env.example dist/

# Create start script
cat > dist/start.sh << 'EOF'
#!/bin/bash
NODE_ENV=production node server/index.js
EOF
chmod +x dist/start.sh

echo "✅ Production build complete!"
echo "📁 Output: ./dist"
echo ""
echo "To run in production:"
echo "  cd dist"
echo "  cp .env.example .env"
echo "  # Edit .env with your tokens"
echo "  ./start.sh"