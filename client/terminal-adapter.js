// Terminal adapter to use Rust backend instead of Node.js
class RustTerminalAdapter {
    constructor() {
        this.sessions = new Map();
        this.onDataCallbacks = new Map();
        
        // Listen for terminal output from Rust
        if (window.__TAURI__) {
            window.__TAURI__.event.listen('terminal-output', (event) => {
                const { session_id, data } = event.payload;
                const callback = this.onDataCallbacks.get(session_id);
                if (callback) {
                    callback(data);
                }
            });
        }
    }

    async createSession(sessionId) {
        if (!window.__TAURI__) {
            throw new Error('Tauri API not available');
        }
        
        try {
            const id = await window.__TAURI__.invoke('spawn_terminal', { 
                sessionId: sessionId || null 
            });
            this.sessions.set(id, { id, cols: 80, rows: 24 });
            return id;
        } catch (error) {
            console.error('Failed to spawn terminal:', error);
            throw error;
        }
    }

    async writeToSession(sessionId, data) {
        if (!window.__TAURI__) {
            throw new Error('Tauri API not available');
        }
        
        try {
            await window.__TAURI__.invoke('write_terminal', {
                sessionId,
                data
            });
        } catch (error) {
            console.error('Failed to write to terminal:', error);
            throw error;
        }
    }

    async resizeSession(sessionId, cols, rows) {
        if (!window.__TAURI__) {
            throw new Error('Tauri API not available');
        }
        
        try {
            await window.__TAURI__.invoke('resize_terminal', {
                sessionId,
                cols,
                rows
            });
            
            const session = this.sessions.get(sessionId);
            if (session) {
                session.cols = cols;
                session.rows = rows;
            }
        } catch (error) {
            console.error('Failed to resize terminal:', error);
            throw error;
        }
    }

    async killSession(sessionId) {
        if (!window.__TAURI__) {
            throw new Error('Tauri API not available');
        }
        
        try {
            await window.__TAURI__.invoke('kill_terminal', { sessionId });
            this.sessions.delete(sessionId);
            this.onDataCallbacks.delete(sessionId);
        } catch (error) {
            console.error('Failed to kill terminal:', error);
            throw error;
        }
    }

    onSessionData(sessionId, callback) {
        this.onDataCallbacks.set(sessionId, callback);
    }

    async listSessions() {
        if (!window.__TAURI__) {
            return Array.from(this.sessions.keys());
        }
        
        try {
            return await window.__TAURI__.invoke('list_terminals');
        } catch (error) {
            console.error('Failed to list terminals:', error);
            return [];
        }
    }
}

// Export for use in the app
window.RustTerminalAdapter = RustTerminalAdapter;