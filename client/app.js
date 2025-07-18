// Import Tauri API if available
const { invoke } = window.__TAURI__ || {};

class ClaudeOrchestrator {
    constructor() {
        this.socket = null;
        this.terminals = new Map();
        this.serverUrl = 'http://localhost:3000';
        this.init();
    }

    async init() {
        this.setupUI();
        this.setupEventListeners();
        
        // Auto-connect if in Tauri
        if (window.__TAURI__) {
            await this.connectToServer();
        }
    }

    setupUI() {
        // Create terminal containers for Claude sessions (8)
        const claudeContainer = document.getElementById('claude-terminals');
        for (let i = 1; i <= 8; i++) {
            claudeContainer.appendChild(this.createTerminalContainer(`claude-${i}`, `Claude ${i}`));
        }

        // Create terminal containers for Server sessions (8)
        const serverContainer = document.getElementById('server-terminals');
        for (let i = 1; i <= 8; i++) {
            serverContainer.appendChild(this.createTerminalContainer(`server-${i}`, `Server ${i}`));
        }
    }

    createTerminalContainer(id, title) {
        const container = document.createElement('div');
        container.className = 'terminal-container';
        container.id = `container-${id}`;
        
        container.innerHTML = `
            <div class="terminal-header">
                <div class="terminal-title">
                    <span class="terminal-status" id="status-${id}"></span>
                    <span>${title}</span>
                    <span class="branch-name" id="branch-${id}"></span>
                </div>
                <div class="terminal-actions">
                    <button onclick="orchestrator.startSession('${id}')">Start</button>
                    <button onclick="orchestrator.stopSession('${id}')">Stop</button>
                    <button onclick="orchestrator.clearTerminal('${id}')">Clear</button>
                </div>
            </div>
            <div class="terminal-content" id="terminal-${id}"></div>
        `;
        
        return container;
    }

    setupEventListeners() {
        document.getElementById('connect-btn').addEventListener('click', () => this.connectToServer());
        document.getElementById('start-all-claude').addEventListener('click', () => this.startAllClaude());
        document.getElementById('stop-all-claude').addEventListener('click', () => this.stopAllClaude());
        document.getElementById('start-all-servers').addEventListener('click', () => this.startAllServers());
        document.getElementById('stop-all-servers').addEventListener('click', () => this.stopAllServers());

        // Listen for Tauri events if available
        if (window.__TAURI__) {
            this.setupTauriListeners();
        }
    }

    async setupTauriListeners() {
        const { listen } = await import('@tauri-apps/api/event');
        
        // Listen for native notifications
        await listen('notification', (event) => {
            this.showNotification(event.payload);
        });

        // Listen for global hotkeys
        await listen('hotkey', (event) => {
            this.handleHotkey(event.payload);
        });
    }

    async connectToServer() {
        if (this.socket && this.socket.connected) {
            console.log('Already connected');
            return;
        }

        this.socket = io(this.serverUrl, {
            transports: ['websocket'],
            reconnection: true
        });

        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.updateConnectionStatus(true);
            this.socket.emit('subscribe', { type: 'orchestrator' });
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            this.updateConnectionStatus(false);
        });

        this.socket.on('terminal:output', (data) => {
            this.handleTerminalOutput(data);
        });

        this.socket.on('terminal:status', (data) => {
            this.updateTerminalStatus(data);
        });

        this.socket.on('session:created', (data) => {
            this.createTerminal(data.sessionId);
        });

        this.socket.on('session:closed', (data) => {
            this.closeTerminal(data.sessionId);
        });

        this.socket.on('error', (error) => {
            console.error('Socket error:', error);
            this.showNotification({
                title: 'Connection Error',
                body: error.message || 'Failed to connect to server'
            });
        });
    }

    updateConnectionStatus(connected) {
        const status = document.getElementById('connection-status');
        status.textContent = connected ? 'Connected' : 'Disconnected';
        status.className = `status-indicator ${connected ? 'connected' : 'disconnected'}`;
    }

    createTerminal(sessionId) {
        if (this.terminals.has(sessionId)) {
            return;
        }

        const terminalElement = document.getElementById(`terminal-${sessionId}`);
        if (!terminalElement) {
            console.error(`Terminal element not found for ${sessionId}`);
            return;
        }

        const terminal = new Terminal({
            cursorBlink: true,
            fontSize: 14,
            fontFamily: 'Consolas, "Courier New", monospace',
            theme: {
                background: '#1e1e1e',
                foreground: '#cccccc'
            }
        });

        const fitAddon = new FitAddon.FitAddon();
        terminal.loadAddon(fitAddon);
        
        terminal.open(terminalElement);
        fitAddon.fit();

        // Handle terminal input
        terminal.onData((data) => {
            if (this.socket && this.socket.connected) {
                this.socket.emit('terminal:input', {
                    sessionId: sessionId,
                    data: data
                });
            }
        });

        // Store terminal instance
        this.terminals.set(sessionId, { terminal, fitAddon });

        // Handle resize
        const resizeObserver = new ResizeObserver(() => {
            fitAddon.fit();
        });
        resizeObserver.observe(terminalElement);
    }

    closeTerminal(sessionId) {
        const terminalData = this.terminals.get(sessionId);
        if (terminalData) {
            terminalData.terminal.dispose();
            this.terminals.delete(sessionId);
        }
    }

    handleTerminalOutput(data) {
        const { sessionId, output } = data;
        const terminalData = this.terminals.get(sessionId);
        
        if (terminalData) {
            terminalData.terminal.write(output);
        }
    }

    updateTerminalStatus(data) {
        const { sessionId, status, branch } = data;
        const statusElement = document.getElementById(`status-${sessionId}`);
        const branchElement = document.getElementById(`branch-${sessionId}`);
        
        if (statusElement) {
            statusElement.className = `terminal-status ${status}`;
        }
        
        if (branchElement && branch) {
            branchElement.textContent = `(${branch})`;
        }
    }

    startSession(sessionId) {
        if (this.socket && this.socket.connected) {
            this.socket.emit('session:start', { sessionId });
        }
    }

    stopSession(sessionId) {
        if (this.socket && this.socket.connected) {
            this.socket.emit('session:stop', { sessionId });
        }
    }

    clearTerminal(sessionId) {
        const terminalData = this.terminals.get(sessionId);
        if (terminalData) {
            terminalData.terminal.clear();
        }
    }

    startAllClaude() {
        for (let i = 1; i <= 8; i++) {
            this.startSession(`claude-${i}`);
        }
    }

    stopAllClaude() {
        for (let i = 1; i <= 8; i++) {
            this.stopSession(`claude-${i}`);
        }
    }

    startAllServers() {
        for (let i = 1; i <= 8; i++) {
            this.startSession(`server-${i}`);
        }
    }

    stopAllServers() {
        for (let i = 1; i <= 8; i++) {
            this.stopSession(`server-${i}`);
        }
    }

    async showNotification(notification) {
        if (window.__TAURI__) {
            // Use Tauri native notifications
            await invoke('show_notification', notification);
        } else if ('Notification' in window) {
            // Fallback to web notifications
            if (Notification.permission === 'granted') {
                new Notification(notification.title, {
                    body: notification.body,
                    icon: notification.icon
                });
            } else if (Notification.permission !== 'denied') {
                const permission = await Notification.requestPermission();
                if (permission === 'granted') {
                    new Notification(notification.title, {
                        body: notification.body,
                        icon: notification.icon
                    });
                }
            }
        }
    }

    handleHotkey(key) {
        console.log('Hotkey pressed:', key);
        // Implement hotkey actions
    }
}

// Initialize the orchestrator
const orchestrator = new ClaudeOrchestrator();
window.orchestrator = orchestrator;