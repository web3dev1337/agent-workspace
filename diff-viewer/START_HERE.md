# 🚀 Advanced Diff Viewer - Quick Start

## To Run the Diff Viewer:

### Option 1: Use the startup script (Recommended)
```bash
cd /home/<user>/HyFire2-work1/claude-orchestrator/diff-viewer
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

Open your browser to: **http://localhost:7655**

⚠️ **IMPORTANT**: The server runs on port **7655**, not 7656!

### Test URLs:
- http://localhost:7655/pr/facebook/react/27000
- http://localhost:7655/pr/microsoft/vscode/123456
- http://localhost:7655/pr/NeuralPixelGames/HyFire2/925

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
2. You're accessing on port 7655 (not 7656)
3. The server is running (`npm run dev` in main folder)