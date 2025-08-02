const express = require('express');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = 2080;

// Proxy socket.io requests to the backend server
// Get port from environment or use default
const BACKEND_PORT = process.env.PORT || 3001;

app.use('/socket.io', createProxyMiddleware({
    target: `http://localhost:${BACKEND_PORT}`,
    ws: true,
    changeOrigin: true
}));

// Serve static files from client directory
app.use(express.static(__dirname));

// Catch all routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Client dev server running on http://localhost:${PORT}`);
});