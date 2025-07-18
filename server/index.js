const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: ["http://localhost:8080", "tauri://localhost"],
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

// Session manager placeholder
const sessions = new Map();

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('subscribe', (data) => {
        socket.join('orchestrator');
        console.log('Client subscribed:', data);
    });

    socket.on('session:start', (data) => {
        const { sessionId } = data;
        console.log('Starting session:', sessionId);
        
        // Emit status update
        io.to('orchestrator').emit('terminal:status', {
            sessionId,
            status: 'running'
        });
        
        // Simulate terminal output
        setTimeout(() => {
            io.to('orchestrator').emit('terminal:output', {
                sessionId,
                output: `Starting ${sessionId}...\r\n`
            });
        }, 100);
    });

    socket.on('session:stop', (data) => {
        const { sessionId } = data;
        console.log('Stopping session:', sessionId);
        
        io.to('orchestrator').emit('terminal:status', {
            sessionId,
            status: 'stopped'
        });
    });

    socket.on('terminal:input', (data) => {
        const { sessionId, data: input } = data;
        console.log(`Input for ${sessionId}:`, input);
        
        // Echo back for now
        io.to('orchestrator').emit('terminal:output', {
            sessionId,
            output: input
        });
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
httpServer.listen(PORT, () => {
    console.log(`Claude Orchestrator server running on port ${PORT}`);
});