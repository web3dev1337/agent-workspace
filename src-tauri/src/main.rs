// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, State, Emitter};
use tokio::sync::mpsc;
use std::sync::Arc;

mod terminal;
mod file_watcher;
use terminal::{TerminalManager, TerminalOutput};
use file_watcher::{FileWatcherManager, FileEvent};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn show_notification(title: String, body: String) -> Result<(), String> {
    println!("Notification: {} - {}", title, body);
    Ok(())
}

#[tauri::command]
fn toggle_devtools(window: tauri::WebviewWindow) {
    // Devtools are available in debug builds only
    #[cfg(debug_assertions)]
    {
        window.open_devtools();
    }
}

#[tauri::command]
async fn spawn_terminal(
    terminal_manager: State<'_, Arc<TerminalManager>>,
    session_id: Option<String>
) -> Result<String, String> {
    terminal_manager
        .spawn_terminal(session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn write_terminal(
    terminal_manager: State<'_, Arc<TerminalManager>>,
    session_id: String,
    data: String
) -> Result<(), String> {
    terminal_manager
        .write_to_terminal(&session_id, &data)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn resize_terminal(
    terminal_manager: State<'_, Arc<TerminalManager>>,
    session_id: String,
    cols: u16,
    rows: u16
) -> Result<(), String> {
    terminal_manager
        .resize_terminal(&session_id, cols, rows)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn kill_terminal(
    terminal_manager: State<'_, Arc<TerminalManager>>,
    session_id: String
) -> Result<(), String> {
    terminal_manager
        .kill_terminal(&session_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_terminals(
    terminal_manager: State<'_, Arc<TerminalManager>>
) -> Result<Vec<String>, String> {
    Ok(terminal_manager.list_terminals())
}

#[tauri::command]
async fn watch_directory(
    file_watcher: State<'_, Arc<FileWatcherManager>>,
    path: String
) -> Result<(), String> {
    file_watcher
        .watch_directory(path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn unwatch_directory(
    file_watcher: State<'_, Arc<FileWatcherManager>>,
    path: String
) -> Result<(), String> {
    file_watcher
        .unwatch_directory(&path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_watched_paths(
    file_watcher: State<'_, Arc<FileWatcherManager>>
) -> Result<Vec<String>, String> {
    Ok(file_watcher.list_watched_paths())
}

fn main() {
    // Create channels for terminal output and file events
    let (output_tx, mut output_rx) = mpsc::unbounded_channel::<TerminalOutput>();
    let (file_event_tx, mut file_event_rx) = mpsc::unbounded_channel::<FileEvent>();
    
    // Enable GPU acceleration
    std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "0");
    
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            println!("Claude Orchestrator starting...");
            
            // Create terminal manager
            let terminal_manager = Arc::new(TerminalManager::new(output_tx));
            app.manage(terminal_manager);
            
            // Create file watcher manager
            let file_watcher = Arc::new(FileWatcherManager::new(file_event_tx));
            app.manage(file_watcher);
            
            // Clone app handle for the output handlers
            let app_handle = app.handle().clone();
            let app_handle2 = app.handle().clone();
            
            // Spawn task to handle terminal output
            tauri::async_runtime::spawn(async move {
                while let Some(output) = output_rx.recv().await {
                    // Emit terminal output to frontend
                    app_handle.emit("terminal-output", output).unwrap();
                }
            });
            
            // Spawn task to handle file events
            tauri::async_runtime::spawn(async move {
                while let Some(event) = file_event_rx.recv().await {
                    // Emit file event to frontend
                    app_handle2.emit("file-event", event).unwrap();
                }
            });
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            show_notification,
            toggle_devtools,
            spawn_terminal,
            write_terminal,
            resize_terminal,
            kill_terminal,
            list_terminals,
            watch_directory,
            unwatch_directory,
            list_watched_paths
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}