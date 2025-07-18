import { useEffect, useState, useCallback } from 'react';
import io from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_WS_URL || 'http://localhost:7655';

export const useWebSocket = (diffType, owner, repo, id) => {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [activeViewers, setActiveViewers] = useState(1);
  const [remoteCursors, setRemoteCursors] = useState(new Map());

  useEffect(() => {
    if (!diffType || !owner || !repo || !id) return;

    // Connect to WebSocket server
    const newSocket = io(SOCKET_URL, {
      transports: ['websocket'],
      autoConnect: true
    });

    newSocket.on('connect', () => {
      console.log('WebSocket connected');
      setConnected(true);
      
      // Join diff room
      newSocket.emit('join-diff', { type: diffType, owner, repo, id });
    });

    newSocket.on('disconnect', () => {
      console.log('WebSocket disconnected');
      setConnected(false);
    });

    // Handle diff updates
    newSocket.on('diff-update', (data) => {
      console.log('Diff update received:', data);
      if (data.type === 'refresh') {
        // Trigger a refresh of diff data
        window.dispatchEvent(new CustomEvent('diff-refresh'));
      }
    });

    // Handle analysis progress
    newSocket.on('analysis-status', (data) => {
      console.log('Analysis status:', data);
      window.dispatchEvent(new CustomEvent('analysis-progress', { detail: data }));
    });

    // Handle remote cursors
    newSocket.on('remote-cursor', ({ userId, file, line, column }) => {
      setRemoteCursors(prev => {
        const updated = new Map(prev);
        updated.set(userId, { file, line, column });
        return updated;
      });
    });

    // Handle remote file selection
    newSocket.on('remote-file-selection', ({ userId, path }) => {
      window.dispatchEvent(new CustomEvent('remote-file-select', { 
        detail: { userId, path } 
      }));
    });

    // Handle user disconnection
    newSocket.on('user-disconnected', ({ userId }) => {
      setRemoteCursors(prev => {
        const updated = new Map(prev);
        updated.delete(userId);
        return updated;
      });
    });

    // Update active viewer count
    newSocket.on('viewer-count', (count) => {
      setActiveViewers(count);
    });

    setSocket(newSocket);

    // Cleanup
    return () => {
      newSocket.close();
    };
  }, [diffType, owner, repo, id]);

  // Send cursor position
  const sendCursorPosition = useCallback((file, line, column) => {
    if (socket && connected) {
      socket.emit('cursor-position', { file, line, column });
    }
  }, [socket, connected]);

  // Send file selection
  const sendFileSelection = useCallback((path) => {
    if (socket && connected) {
      socket.emit('file-selected', { path });
    }
  }, [socket, connected]);

  // Request diff refresh
  const requestRefresh = useCallback(() => {
    if (socket && connected) {
      socket.emit('refresh-diff', { type: diffType, owner, repo, id });
    }
  }, [socket, connected, diffType, owner, repo, id]);

  return {
    connected,
    activeViewers,
    remoteCursors,
    sendCursorPosition,
    sendFileSelection,
    requestRefresh
  };
};