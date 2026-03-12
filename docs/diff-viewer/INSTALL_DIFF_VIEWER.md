# Installing the Advanced Diff Viewer

## Quick Start

```bash
cd diff-viewer
./start.sh
```

This will:
1. Check for .env file (create from template if missing)
2. Install all dependencies (if needed)
3. Start both backend (9462) and frontend (9464) servers

## Manual Installation

### 1. Install Dependencies

```bash
# Backend dependencies
cd diff-viewer
npm install

# Frontend dependencies
cd client
npm install
cd ..
```

### 2. Configuration

```bash
# Copy environment template
cp .env.example .env

# Edit with your tokens
nano .env
```

Required environment variables:
- `GITHUB_TOKEN`: Personal access token for GitHub API
- `CLAUDE_API_KEY`: (Optional) For AI summaries

### 3. Development Mode

```bash
# Terminal 1: Backend
cd diff-viewer
npm run dev

# Terminal 2: Frontend
cd diff-viewer/client
npm run dev
```

Access at:
- Frontend: http://localhost:9464
- Backend API: http://localhost:9462/api

## Production Deployment

### Option 1: Docker

```bash
cd diff-viewer
docker-compose up -d
```

### Option 2: Manual Build

```bash
cd diff-viewer
./build.sh

# Output in ./dist
cd dist
./start.sh
```

### Option 3: PM2

```bash
# Install PM2 globally
npm install -g pm2

# Start with PM2
cd diff-viewer
pm2 start ecosystem.config.js
```

## Features Configuration

### Enable AI Summaries

1. Get Claude API key from https://console.anthropic.com
2. Add to .env:
   ```
   CLAUDE_API_KEY=sk-ant-your-key-here
   ENABLE_AI_ANALYSIS=true
   ```

### Configure Caching

SQLite cache is automatic. To adjust:
- Cache location: `./cache/diffs.db`
- Default TTL: 5 minutes
- Cleanup: Automatic on startup

### WebSocket Configuration

Real-time features work automatically. For custom config:
```javascript
// In client code
const SOCKET_URL = 'ws://localhost:9462';
```

## Troubleshooting

### Port Already in Use
```bash
# Find process using port
lsof -i :9462
# Kill if needed
kill -9 <PID>
```

### GitHub API Rate Limits
- Add valid `GITHUB_TOKEN` to .env
- Check rate limit: `curl -H "Authorization: token YOUR_TOKEN" https://api.github.com/rate_limit`

### PDF Export Issues
- Requires Chromium/Chrome installed
- Docker image includes this automatically
- Manual install: `sudo apt-get install chromium-browser`

### Database Errors
```bash
# Reset cache database
rm -f cache/diffs.db
# Restart server
```

## Integration with Orchestrator

The diff viewer integrates automatically:
1. Orchestrator detects GitHub URLs in Claude output
2. Shows "Advanced Diff" button
3. Click opens diff viewer in new tab
4. Real-time updates via WebSocket

No additional configuration needed!