const { Server } = require('socket.io');
const { getCache } = require('./cache/database');

class WebSocketManager {
  constructor(server) {
    this.io = new Server(server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });
    
    this.dbCache = getCache();
    this.activeDiffs = new Map(); // Track active diff viewers
    this.setupHandlers();
  }

  setupHandlers() {
    this.io.on('connection', (socket) => {
      console.log('Client connected:', socket.id);

      // Join a diff room
      socket.on('join-diff', ({ type, owner, repo, id }) => {
        const room = `${type}:${owner}/${repo}/${id}`;
        socket.join(room);
        this.activeDiffs.set(socket.id, room);
        
        // Send current cache stats
        socket.emit('cache-stats', this.dbCache.getStats());
        
        console.log(`Client ${socket.id} joined room: ${room}`);
      });

      // Request diff refresh
      socket.on('refresh-diff', ({ type, owner, repo, id }) => {
        const room = `${type}:${owner}/${repo}/${id}`;
        
        // Notify all clients in room to refresh
        this.io.to(room).emit('diff-update', {
          type: 'refresh',
          message: 'Diff data updated, refreshing...'
        });
      });

      // Real-time diff analysis progress
      socket.on('analysis-progress', (data) => {
        const room = this.activeDiffs.get(socket.id);
        if (room) {
          socket.to(room).emit('analysis-status', data);
        }
      });

      // Share cursor position for collaborative viewing
      socket.on('cursor-position', ({ file, line, column }) => {
        const room = this.activeDiffs.get(socket.id);
        if (room) {
          socket.to(room).emit('remote-cursor', {
            userId: socket.id,
            file,
            line,
            column
          });
        }
      });

      // Share file selection
      socket.on('file-selected', ({ path }) => {
        const room = this.activeDiffs.get(socket.id);
        if (room) {
          socket.to(room).emit('remote-file-selection', {
            userId: socket.id,
            path
          });
        }
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        const room = this.activeDiffs.get(socket.id);
        if (room) {
          this.activeDiffs.delete(socket.id);
          // Notify others in room
          socket.to(room).emit('user-disconnected', {
            userId: socket.id
          });
        }
        console.log('Client disconnected:', socket.id);
      });
    });
  }

  // Broadcast diff update to all viewers
  broadcastDiffUpdate(type, owner, repo, id, updateData) {
    const room = `${type}:${owner}/${repo}/${id}`;
    this.io.to(room).emit('diff-update', updateData);
  }

  // Send analysis progress updates
  sendAnalysisProgress(type, owner, repo, id, progress) {
    const room = `${type}:${owner}/${repo}/${id}`;
    this.io.to(room).emit('analysis-progress', {
      progress,
      message: `Analyzing files... ${progress}%`
    });
  }

  // Get active viewer count for a diff
  getActiveViewers(type, owner, repo, id) {
    const room = `${type}:${owner}/${repo}/${id}`;
    const roomSockets = this.io.sockets.adapter.rooms.get(room);
    return roomSockets ? roomSockets.size : 0;
  }
}

module.exports = WebSocketManager;