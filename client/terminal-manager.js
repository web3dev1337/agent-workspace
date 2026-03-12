// Unified terminal manager with feature flag support
class TerminalManager {
    constructor(useRustBackend = false) {
        this.useRustBackend = useRustBackend && window.__TAURI__;
        this.adapter = null;
        this.terminals = new Map();
        
        this.initialize();
    }

    async initialize() {
        if (this.useRustBackend) {
            console.log('Using Rust terminal backend');
            this.adapter = new window.RustTerminalAdapter();
        } else {
            console.log('Using Node.js terminal backend (WebSocket)');
            // Existing WebSocket implementation
            this.initializeWebSocket();
        }
    }

    initializeWebSocket() {
        // Connect to Node.js backend
        this.socket = io(window.location.origin, {
            path: '/socket.io'
        });
        
        this.socket.on('connect', () => {
            console.log('Connected to terminal server');
        });

        this.socket.on('terminal-output', (data) => {
            const terminal = this.terminals.get(data.sessionId);
            if (terminal && terminal.onData) {
                terminal.onData(data.data);
            }
        });
    }

    async createTerminal(sessionId, onData) {
        if (this.useRustBackend) {
            const id = await this.adapter.createSession(sessionId);
            this.adapter.onSessionData(id, onData);
            this.terminals.set(id, { id, onData });
            return id;
        } else {
            // WebSocket implementation
            this.socket.emit('create-session', { sessionId });
            this.terminals.set(sessionId, { id: sessionId, onData });
            return sessionId;
        }
    }

    async writeToTerminal(sessionId, data) {
        if (this.useRustBackend) {
            await this.adapter.writeToSession(sessionId, data);
        } else {
            this.socket.emit('terminal-input', { sessionId, data });
        }
    }

    async resizeTerminal(sessionId, cols, rows) {
        if (this.useRustBackend) {
            await this.adapter.resizeSession(sessionId, cols, rows);
        } else {
            this.socket.emit('terminal-resize', { sessionId, cols, rows });
        }
    }

    async killTerminal(sessionId) {
        if (this.useRustBackend) {
            await this.adapter.killSession(sessionId);
        } else {
            this.socket.emit('kill-session', { sessionId });
        }
        this.terminals.delete(sessionId);
    }

    async listTerminals() {
        if (this.useRustBackend) {
            return await this.adapter.listSessions();
        } else {
            return Array.from(this.terminals.keys());
        }
    }

    // Feature detection
    static canUseRustBackend() {
        return window.__TAURI__ !== undefined;
    }

    // Get backend info
    getBackendInfo() {
        return {
            type: this.useRustBackend ? 'rust' : 'nodejs',
            available: {
                rust: TerminalManager.canUseRustBackend(),
                nodejs: true
            }
        };
    }
}

// Export for use
window.TerminalManager = TerminalManager;
