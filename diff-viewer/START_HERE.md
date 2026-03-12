# 🚀 Advanced Diff Viewer - Quick Start

## To Run the Diff Viewer:

### Option 1: Use the startup script (Recommended)
```bash
cd /path/to/claude-orchestrator/diff-viewer
chmod +x start-diff-viewer.sh
./start-diff-viewer.sh
```

### Option 2: Manual steps
```bash
# 1. Build the client (first time only)
cd client
npm install
npm run build
cd ..

# 2. Start the server
npm install
npm run dev
```

## Access the Viewer:

Open your browser to: **http://localhost:9462**

⚠️ **IMPORTANT**: The server runs on port **9462**, not 9464!

### URL format:
- http://localhost:9462/pr/OWNER/REPO/PR_NUMBER

## Features Working:

✅ **GitClear-style semantic diff** - 30% noise reduction
✅ **Refactoring detection** - Finds renames, extractions
✅ **Duplication detection** - Warns about copy-paste
✅ **Review state tracking** - Never lose your place
✅ **Keyboard navigation** - j/k, Space, Shift+J/K
✅ **Progressive disclosure** - Hide noise by default

## Keyboard Shortcuts:

- `j` / `k` - Next/previous file
- `Shift+J` / `Shift+K` - Next/previous unreviewed
- `Space` - Toggle reviewed
- `Enter` - Mark reviewed & next
- `?` - Show help

## Troubleshooting:

If you see 500 errors, make sure:
1. You've built the client (`npm run build` in client folder)
2. You're accessing on port 9462 (not 9464)
3. The server is running (`npm run dev` in main folder)
4. Auth is configured:
   - Preferred: `gh auth status` shows you're logged in (diff viewer falls back to `gh api`)
   - Optional: set `GITHUB_TOKEN` in `.env` for Octokit auth
