const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const PORT = process.env.DIFF_VIEWER_PORT || 7655;

// Initialize WebSocket
const WebSocketManager = require('./websocket');
const wsManager = new WebSocketManager(server);

// Make WebSocket manager available to routes
app.locals.wsManager = wsManager;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from client build
app.use(express.static(path.join(__dirname, '../client/dist')));

// API Routes
app.use('/api/github', require('./api/github'));
app.use('/api/diff', require('./api/diff'));
app.use('/api/export', require('./api/export'));
app.use('/api/review', require('./api/review'));
app.use('/api/settings', require('./api/settings'));

// Optional AI route - only load if Anthropic SDK is available
try {
  require('@anthropic-ai/sdk');
  app.use('/api/ai', require('./api/ai-summary'));
  console.log('✅ AI summaries enabled');
} catch (error) {
  console.log('⚠️  AI summaries disabled (install @anthropic-ai/sdk to enable)');
  app.use('/api/ai', (req, res) => {
    res.status(503).json({ 
      error: 'AI summaries not available',
      message: 'Install @anthropic-ai/sdk to enable this feature'
    });
  });
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Catch-all route for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`🔍 Diff Viewer running on http://localhost:${PORT}`);
  console.log(`📊 API available at http://localhost:${PORT}/api`);
  console.log(`🔌 WebSocket ready for real-time updates`);
});
