require('dotenv').config();
const express = require('express');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const BASE_PORT = parseInt(process.env.CLIENT_PORT || '9471', 10);
const SERVER_PORT = process.env.ORCHESTRATOR_PORT || 9470;

// Proxy socket.io requests to the backend server
app.use('/socket.io', createProxyMiddleware({
    target: `http://localhost:${SERVER_PORT}`,
    ws: true,
    changeOrigin: true
}));

// Proxy API requests to the backend server
app.use('/api', createProxyMiddleware({
    target: `http://localhost:${SERVER_PORT}`,
    changeOrigin: true
    // Remove pathRewrite to preserve default behavior
}));

// Serve static files from client directory
app.use(express.static(__dirname));

// Catch all routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

let port = Number.isFinite(BASE_PORT) ? BASE_PORT : 9471;
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
