// File watcher adapter for Rust backend
class RustFileWatcherAdapter {
    constructor() {
        this.watchedPaths = new Set();
        this.eventCallbacks = [];
        
        // Listen for file events from Rust
        if (window.__TAURI__) {
            window.__TAURI__.event.listen('file-event', (event) => {
                const fileEvent = event.payload;
                // Notify all callbacks
                this.eventCallbacks.forEach(callback => {
                    callback(fileEvent);
                });
            });
        }
    }

    async watchDirectory(path) {
        if (!window.__TAURI__) {
            throw new Error('Tauri API not available');
        }
        
        try {
            await window.__TAURI__.invoke('watch_directory', { path });
            this.watchedPaths.add(path);
            console.log(`Watching directory: ${path}`);
        } catch (error) {
            console.error('Failed to watch directory:', error);
            throw error;
        }
    }

    async unwatchDirectory(path) {
        if (!window.__TAURI__) {
            throw new Error('Tauri API not available');
        }
        
        try {
            await window.__TAURI__.invoke('unwatch_directory', { path });
            this.watchedPaths.delete(path);
            console.log(`Stopped watching directory: ${path}`);
        } catch (error) {
            console.error('Failed to unwatch directory:', error);
            throw error;
        }
    }

    async getWatchedPaths() {
        if (!window.__TAURI__) {
            return Array.from(this.watchedPaths);
        }
        
        try {
            return await window.__TAURI__.invoke('list_watched_paths');
        } catch (error) {
            console.error('Failed to list watched paths:', error);
            return [];
        }
    }

    onFileEvent(callback) {
        this.eventCallbacks.push(callback);
        
        // Return unsubscribe function
        return () => {
            const index = this.eventCallbacks.indexOf(callback);
            if (index > -1) {
                this.eventCallbacks.splice(index, 1);
            }
        };
    }

    // Utility method to filter events
    createFilteredListener(pathFilter, eventTypeFilter) {
        return (callback) => {
            return this.onFileEvent((event) => {
                const pathMatch = !pathFilter || event.path.includes(pathFilter);
                const typeMatch = !eventTypeFilter || event.event_type.includes(eventTypeFilter);
                
                if (pathMatch && typeMatch) {
                    callback(event);
                }
            });
        };
    }
}

// Export for use
window.RustFileWatcherAdapter = RustFileWatcherAdapter;