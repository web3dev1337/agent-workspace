// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn show_notification(title: String, body: String) -> Result<(), String> {
    println!("Notification: {} - {}", title, body);
    Ok(())
}

#[tauri::command]
fn toggle_devtools(window: tauri::WebviewWindow) {
    // Simple devtools toggle
    window.open_devtools();
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Window is created automatically from tauri.conf.json
            println!("Claude Orchestrator starting...");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![show_notification, toggle_devtools])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}