require('dotenv').config();
const express = require('express');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const BASE_PORT = parseInt(process.env.CLIENT_PORT || '2080', 10);
const SERVER_PORT = process.env.ORCHESTRATOR_PORT || 3000;

// Proxy socket.io requests to the backend server (with WebSocket support).
// Use pathFilter instead of Express mount path to avoid path stripping.
// When mounted via app.use('/socket.io', proxy), Express strips the prefix
// from req.url, so the proxy forwards /?EIO=4 instead of /socket.io/?EIO=4.
const socketProxy = createProxyMiddleware({
    target: `http://localhost:${SERVER_PORT}`,
    pathFilter: '/socket.io',
    ws: true,
    changeOrigin: true
});
app.use(socketProxy);

// Proxy API, bootstrap, health, and replay-viewer requests to the backend server.
// These are all server-rendered routes that don't exist as static files.
app.use(createProxyMiddleware({
    target: `http://localhost:${SERVER_PORT}`,
    pathFilter: ['/api', '/bootstrap', '/health', '/replay-viewer'],
    changeOrigin: true
}));

// Serve static files from client directory
app.use(express.static(__dirname));

// Catch all routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

let port = Number.isFinite(BASE_PORT) ? BASE_PORT : 2080;
const MAX_PORT_ATTEMPTS = 20;
let attempts = 0;

const startServer = () => {
    const server = app.listen(port, () => {
        console.log(`Client dev server running on http://localhost:${port}`);
    });

    server.on('error', (err) => {
        if (err && err.code === 'EADDRINUSE' && attempts < MAX_PORT_ATTEMPTS) {
            attempts += 1;
            port += 1;
            console.warn(`Port ${port - 1} in use, trying ${port}...`);
            server.close(() => startServer());
            return;
        }
        throw err;
    });
};

startServer();
