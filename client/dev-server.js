const express = require('express');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = 2080;

// Proxy socket.io requests to the backend server
app.use('/socket.io', createProxyMiddleware({
    target: 'http://localhost:3000',
    ws: true,
    changeOrigin: true
}));

// Proxy API requests to the backend server
app.use('/api', createProxyMiddleware({
    target: 'http://localhost:3000',
    changeOrigin: true
    // Remove pathRewrite to preserve default behavior
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