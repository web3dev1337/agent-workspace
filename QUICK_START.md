# Claude Orchestrator - Quick Start

## 🚀 Just Two Commands You Need to Know:

### 1. For Your Normal Work:
```bash
cd ~/claude-orchestrator
npm run prod
```
**This runs your production Orchestrator on ports 3000/2080**

### 2. For Claude to Modify Orchestrator:
```bash
cd ~/claude-orchestrator-dev
npm run dev
# OR just: npm run dev:all (since .env already has dev ports)
```
**This runs a dev copy on ports 4000/2081 that Claude can modify without affecting your work**

---

## That's it!

- Both commands do the same thing (run the Orchestrator)
- They just use different ports so they don't conflict
- You can run both at the same time if needed

## First Time Setup for Dev (one-time only):
```bash
cd ~
git clone https://github.com/web3dev1337/claude-orchestrator.git claude-orchestrator-dev
cd claude-orchestrator-dev
npm install
npm rebuild node-pty
```

Then create `.env` file with:
```
PORT=4000
CLIENT_PORT=2081
WORKTREE_BASE_PATH=/home/ab
WORKTREE_COUNT=8
```