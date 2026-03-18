#!/bin/bash

echo "🚀 Agent Workspace Installation"
echo "=================================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 16+ first."
    echo "   Visit: https://nodejs.org/"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 16 ]; then
    echo "❌ Node.js version 16+ required. Current version: $(node -v)"
    exit 1
fi

echo "✅ Node.js $(node -v) detected"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi

# Create necessary directories
echo ""
echo "📁 Creating directories..."
mkdir -p logs sessions

# Copy environment file if it doesn't exist
if [ ! -f .env ]; then
    echo ""
    echo "📝 Creating .env file..."
    cp .env.example .env
    echo "✅ Created .env file. Please edit it to configure your settings."
else
    echo "✅ .env file already exists"
fi

# Create systemd service file (optional)
echo ""
read -p "Would you like to create a systemd service? (y/N) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    cat > agent-workspace.service <<EOF
[Unit]
Description=Agent Workspace
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)
ExecStart=$(which node) server/index.js
Restart=on-failure
RestartSec=10
StandardOutput=append:$(pwd)/logs/systemd.log
StandardError=append:$(pwd)/logs/systemd.log
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
    
    echo "✅ Created systemd service file: agent-workspace.service"
    echo "   To install: sudo cp agent-workspace.service /etc/systemd/system/"
    echo "   To enable:  sudo systemctl enable agent-workspace"
    echo "   To start:   sudo systemctl start agent-workspace"
fi

# Display next steps
echo ""
echo "✨ Installation complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env file to configure your settings"
echo "2. Start the server:"
echo "   - Development: npm run dev"
echo "   - Production: npm start"
echo "3. Access the dashboard:"
echo "   - Local: http://localhost:3000"
echo "   - LAN: http://<your-ip>:3000"
echo ""
echo "For more information, see README.md"
