# Phase 2 Implementation Plan: Native Rust Features

## Overview
Phase 2 focuses on moving core functionality from Node.js to Rust for better performance, native integration, and reduced resource usage.

## 1. Terminal Management in Rust

### Current State
- Node.js backend manages terminals via node-pty
- WebSocket communication between frontend and backend
- Sessions handled in JavaScript

### Target State
- Rust-native PTY management using `portable-pty` crate
- Direct Tauri commands for terminal operations
- Better performance and lower latency

### Implementation Steps
1. Add dependencies to Cargo.toml:
   ```toml
   portable-pty = "0.8"
   tokio = { version = "1", features = ["full"] }
   futures = "0.3"
   ```

2. Create Rust terminal module:
   ```rust
   // src-tauri/src/terminal.rs
   use portable_pty::{CommandBuilder, PtySize, native_pty_system};
   use tauri::State;
   use std::sync::{Arc, Mutex};
   ```

3. Implement Tauri commands:
   - `spawn_terminal(session_id: String) -> Result<()>`
   - `write_terminal(session_id: String, data: String) -> Result<()>`
   - `resize_terminal(session_id: String, cols: u16, rows: u16) -> Result<()>`
   - `kill_terminal(session_id: String) -> Result<()>`

4. Stream output via Tauri events instead of WebSockets

## 2. Native File Watching

### Implementation
1. Add `notify` crate for cross-platform file watching:
   ```toml
   notify = "6.0"
   ```

2. Create file watcher module:
   ```rust
   // src-tauri/src/file_watcher.rs
   use notify::{Watcher, RecursiveMode, watcher};
   ```

3. Implement commands:
   - `watch_directory(path: String) -> Result<()>`
   - `unwatch_directory(path: String) -> Result<()>`

## 3. Auto-Update Functionality

### Tauri Updater Setup
1. Add updater feature to Cargo.toml:
   ```toml
   tauri = { version = "2", features = ["tray-icon", "updater"] }
   ```

2. Configure tauri.conf.json:
   ```json
   {
     "updater": {
       "active": true,
       "endpoints": [
         "https://github.com/web3dev1337/claude-orchestrator/releases/latest/download/latest.json"
       ],
       "dialog": true,
       "pubkey": "YOUR_PUBLIC_KEY"
     }
   }
   ```

3. Set up GitHub Actions for automatic releases
4. Implement update checking on app start

## 4. Direct WSL Integration

### Windows-Specific Features
1. Detect WSL distributions:
   ```rust
   #[cfg(target_os = "windows")]
   fn list_wsl_distros() -> Vec<String> {
       // Use wsl.exe -l -v
   }
   ```

2. Spawn terminals in specific WSL distros:
   ```rust
   #[cfg(target_os = "windows")]
   fn spawn_wsl_terminal(distro: String) -> Result<()> {
       // Use wsl.exe -d <distro>
   }
   ```

3. File path translation between Windows and WSL

## Benefits of Phase 2
- **Performance**: 50-70% reduction in memory usage
- **Latency**: Sub-millisecond terminal response times
- **Security**: Sandboxed Rust code vs Node.js runtime
- **Integration**: Native OS features without Node.js limitations
- **Distribution**: Single binary, no Node.js dependency

## Migration Strategy
1. Implement Rust features alongside existing Node.js
2. Add feature flags to toggle between implementations
3. Gradual migration with fallback options
4. Full cutover once stable

## Timeline Estimate
- Terminal Management: 2-3 weeks
- File Watching: 1 week
- Auto-updater: 1 week
- WSL Integration: 1-2 weeks
- Testing & Polish: 2 weeks

**Total: 6-8 weeks for full Phase 2**

## Next Steps
1. Set up development environment with Rust toolchain
2. Create feature branch for Phase 2
3. Start with terminal management as highest priority
4. Implement incrementally with tests