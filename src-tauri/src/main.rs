// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{AppHandle, Manager, WebviewWindow};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::menu::{Menu, MenuItem};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn show_notification(title: String, body: String) -> Result<(), String> {
    // In Tauri v2, notifications are handled differently
    // For now, we'll return OK and handle notifications in the frontend
    println!("Notification: {} - {}", title, body);
    Ok(())
}

#[tauri::command]
fn toggle_devtools(window: WebviewWindow) {
    // Toggle devtools
    if window.is_devtools_open() {
        window.close_devtools();
    } else {
        window.open_devtools();
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Create tray icon
            let tray = TrayIconBuilder::new()
                .tooltip("Claude Orchestrator")
                .on_tray_icon_event(|_app, event| {
                    match event {
                        TrayIconEvent::LeftClick { .. } => {
                            // Show main window on left click
                            println!("Tray icon clicked");
                        }
                        _ => {}
                    }
                })
                .build(app)?;
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![show_notification, toggle_devtools])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}