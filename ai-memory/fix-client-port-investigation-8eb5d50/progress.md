# Progress

- [x] Investigate client/dev-server.js proxy configuration
- [x] Identify root cause: http-proxy-middleware v3 + Express mount path stripping
- [x] Identify all broken routes: /socket.io, /api/*, /bootstrap/*, /health
- [x] Fix dev-server.js to use pathFilter instead of Express mount paths
- [x] Verify all routes work on client port 2082
- [x] Commit and create PR
