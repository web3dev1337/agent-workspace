# Debug Steps to Fix Empty Code Window

## The Problem
- Data is loading (3 files shown)
- But nothing displays in the code window
- The `analysis` property might be missing from the files

## Steps to Fix:

### 1. Rebuild the client with debug logging
```bash
cd /home/ab/HyFire2-work1/claude-orchestrator/diff-viewer/client
npm run build
```

### 2. Clear the cache to force re-analysis
```bash
cd /home/ab/HyFire2-work1/claude-orchestrator/diff-viewer
rm -f server/cache/diff-cache.db
```

### 3. Restart the server
Kill the current server (Ctrl+C) and restart:
```bash
npm run dev
```

### 4. Access the URL again
http://localhost:7655/pr/NeuralPixelGames/HyFire2/925

### 5. Check the browser console
Look for the debug messages:
- "🔍 First file structure:"
- "🔍 Has analysis?"

This will show if the `analysis` property is present.

## Alternative Quick Fix:
If the above doesn't work, you can force the viewer to show the standard diff by unchecking "Semantic View" in the bottom settings panel.