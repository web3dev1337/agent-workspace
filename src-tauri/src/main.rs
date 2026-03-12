// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, State, Emitter};
use tokio::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::process::{Child, Command, Stdio};
use std::time::Duration;
use uuid::Uuid;
use tauri_plugin_updater::UpdaterExt;
use url::Url;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;
#[cfg(target_os = "windows")]
const DETACHED_PROCESS: u32 = 0x00000008;

mod terminal;
mod file_watcher;
use terminal::{TerminalManager, TerminalOutput};
use file_watcher::{FileWatcherManager, FileEvent};

struct BackendProcess {
    child: Mutex<Option<Child>>,
}

impl BackendProcess {
    fn new() -> Self {
        Self { child: Mutex::new(None) }
    }

    fn set_child(&self, child: Child) {
        if let Ok(mut guard) = self.child.lock() {
            *guard = Some(child);
        }
    }

    fn kill(&self) {
        let child = self.child.lock().ok().and_then(|mut guard| guard.take());
        if let Some(mut child) = child {
            let _ = child.kill();
        }
    }
}

fn env_truthy(name: &str) -> Option<bool> {
    let raw = std::env::var(name).ok()?;
    let v = raw.trim().to_lowercase();
    if v.is_empty() { return None; }
    Some(!matches!(v.as_str(), "0" | "false" | "no" | "off"))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AppUpdateStatus {
    configured: bool,
    available: bool,
    current_version: String,
    latest_version: Option<String>,
    notes: Option<String>,
    published_at: Option<String>,
    download_url: Option<String>,
    message: Option<String>,
}

fn default_update_status(app: &tauri::AppHandle) -> AppUpdateStatus {
    AppUpdateStatus {
        configured: false,
        available: false,
        current_version: app.package_info().version.to_string(),
        latest_version: None,
        notes: None,
        published_at: None,
        download_url: None,
        message: None,
    }
}

fn parse_updater_endpoints_from_env() -> Vec<Url> {
    let raw = std::env::var("ORCHESTRATOR_UPDATER_ENDPOINTS")
        .or_else(|_| std::env::var("TAURI_UPDATER_ENDPOINTS"))
        .unwrap_or_default();

    raw.split(['\n', '\r', ',', ';'])
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .filter_map(|v| Url::parse(v).ok())
        .collect::<Vec<_>>()
}

fn resolve_updater_pubkey(app: &tauri::AppHandle) -> Option<String> {
    let from_env = std::env::var("ORCHESTRATOR_UPDATER_PUBKEY")
        .or_else(|_| std::env::var("TAURI_UPDATER_PUBKEY"))
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    if from_env.is_some() {
        return from_env;
    }

    let mut candidates = Vec::new();

    if let Ok(path) = std::env::var("ORCHESTRATOR_UPDATER_PUBKEY_PATH") {
        let p = std::path::PathBuf::from(path.trim());
        if !path.trim().is_empty() {
            candidates.push(p);
        }
    }
    if let Ok(path) = std::env::var("TAURI_UPDATER_PUBKEY_PATH") {
        let p = std::path::PathBuf::from(path.trim());
        if !path.trim().is_empty() {
            candidates.push(p);
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("backend").join("updater.pubkey"));
        candidates.push(resource_dir.join("updater.pubkey"));
    }

    candidates.push(
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("updater.pubkey")
    );

    for path in candidates {
        let Ok(contents) = std::fs::read_to_string(&path) else {
            continue;
        };
        let trimmed = contents.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    None
}

fn build_runtime_updater(app: &tauri::AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    let enabled = env_truthy("ORCHESTRATOR_UPDATER_ENABLED")
        .or_else(|| env_truthy("TAURI_UPDATER_ENABLED"))
        .unwrap_or(false);
    if !enabled {
        return Err("Desktop updater is disabled (set ORCHESTRATOR_UPDATER_ENABLED=1).".to_string());
    }

    let endpoints = parse_updater_endpoints_from_env();
    if endpoints.is_empty() {
        return Err(
            "Desktop updater is not configured (set ORCHESTRATOR_UPDATER_ENDPOINTS to one or more update endpoint URLs).".to_string()
        );
    }

    let pubkey = resolve_updater_pubkey(app)
        .ok_or_else(|| "Desktop updater public key is missing (set ORCHESTRATOR_UPDATER_PUBKEY or ORCHESTRATOR_UPDATER_PUBKEY_PATH).".to_string())?;

    let updater_builder = app
        .updater_builder()
        .endpoints(endpoints)
        .map_err(|e| format!("Failed to configure updater endpoints: {}", e))?;

    updater_builder
        .pubkey(pubkey)
        .build()
        .map_err(|e| format!("Failed to initialize updater: {}", e))
}

fn should_spawn_backend() -> bool {
    if let Some(v) = env_truthy("TAURI_SPAWN_BACKEND") {
        return v;
    }
    // Default: spawn backend only in release builds.
    !cfg!(debug_assertions)
}

fn pick_free_port() -> Option<u16> {
    std::net::TcpListener::bind(("127.0.0.1", 0))
        .ok()
        .and_then(|listener| listener.local_addr().ok().map(|addr| addr.port()))
}

fn resolve_node_command(app: &tauri::AppHandle) -> std::ffi::OsString {
    if let Ok(p) = std::env::var("ORCHESTRATOR_NODE_PATH") {
        let trimmed = p.trim();
        if !trimmed.is_empty() && std::path::Path::new(trimmed).exists() {
            return trimmed.into();
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidates = if cfg!(target_os = "windows") {
            vec![
                resource_dir.join("backend").join("node").join("node.exe"),
                resource_dir.join("node").join("node.exe"),
                resource_dir.join("backend").join("node.exe"),
                resource_dir.join("node.exe"),
            ]
        } else {
            vec![
                resource_dir.join("backend").join("node").join("node"),
                resource_dir.join("node").join("node"),
                resource_dir.join("backend").join("node"),
                resource_dir.join("node"),
            ]
        };

        for c in candidates {
            if c.exists() {
                return c.into_os_string();
            }
        }
    }

    "node".into()
}

fn resolve_server_entry(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidates = [
            resource_dir.join("backend").join("server").join("index.js"),
            resource_dir.join("server").join("index.js"),
        ];
        for candidate in candidates {
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }

    // Dev fallback (repo checkout): src-tauri/.. contains server/
    let candidate = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("server")
        .join("index.js");
    if candidate.exists() {
        return Some(candidate);
    }

    None
}

fn has_diff_viewer_folder(app: &tauri::AppHandle) -> bool {
    if let Ok(resource_dir) = app.path().resource_dir() {
        if resource_dir.join("backend").join("diff-viewer").exists() {
            return true;
        }
        if resource_dir.join("diff-viewer").exists() {
            return true;
        }
    }

    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("diff-viewer")
        .exists()
}

async fn wait_for_port(port: u16, timeout: Duration) -> bool {
    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        if tokio::net::TcpStream::connect(("127.0.0.1", port)).await.is_ok() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
    false
}

async fn navigate_window(window: tauri::WebviewWindow, url: String) {
    let js = format!("window.location.replace({});", serde_json::to_string(&url).unwrap_or_else(|_| "\"/\"".to_string()));
    for _ in 0..60 {
        if window.eval(&js).is_ok() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
}

fn append_tauri_bootstrap_log(data_dir: &std::path::Path, message: &str) {
    let logs_dir = data_dir.join("logs");
    if std::fs::create_dir_all(&logs_dir).is_err() {
        return;
    }
    let log_path = logs_dir.join("tauri-bootstrap.log");
    let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
    else {
        return;
    };
    use std::io::Write;
    let _ = writeln!(file, "{}", message);
}

async fn show_bootstrap_error(
    window: tauri::WebviewWindow,
    title: &str,
    message: &str,
    details: Option<String>,
    hint_html: Option<String>,
) {
    let title_json = serde_json::to_string(title).unwrap_or_else(|_| "\"Failed to start\"".to_string());
    let message_json = serde_json::to_string(message)
        .unwrap_or_else(|_| "\"The backend did not start.\"".to_string());
    let details_json = details
        .map(|v| serde_json::to_string(&v).unwrap_or_else(|_| "null".to_string()))
        .unwrap_or_else(|| "null".to_string());
    let hint_json = hint_html
        .map(|v| serde_json::to_string(&v).unwrap_or_else(|_| "null".to_string()))
        .unwrap_or_else(|| "null".to_string());

    let js = format!(
        "window.__orchestrator_bootstrap_error && window.__orchestrator_bootstrap_error({}, {}, {}, {});",
        title_json, message_json, details_json, hint_json
    );
    for _ in 0..60 {
        if window.eval(&js).is_ok() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
}

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
    #[cfg(not(debug_assertions))]
    {
        let _ = window;
    }
}

#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    // In WSL, check for wslview first (it handles opening Windows browser from WSL)
    if cfg!(target_os = "linux") {
        // Check if we're in WSL
        if std::path::Path::new("/proc/sys/fs/binfmt_misc/WSLInterop").exists() {
            // Try wslview first (from wslu package)
            if let Ok(_) = std::process::Command::new("wslview").arg(&url).spawn() {
                return Ok(());
            }
            // Fallback to powershell.exe
            if let Ok(_) = std::process::Command::new("powershell.exe")
                .arg("-c")
                .arg(format!("Start-Process '{}'", url))
                .spawn() {
                return Ok(());
            }
        }
    }
    
    // Fallback to system open
    open::that(&url).map_err(|e| e.to_string())
}

#[tauri::command]
async fn check_app_update(app: tauri::AppHandle) -> Result<AppUpdateStatus, String> {
    let mut status = default_update_status(&app);

    let updater = match build_runtime_updater(&app) {
        Ok(v) => v,
        Err(message) => {
            status.message = Some(message);
            return Ok(status);
        }
    };

    status.configured = true;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("Failed to check updates: {}", e))?;

    if let Some(update) = update {
        status.available = true;
        status.latest_version = Some(update.version.clone());
        status.notes = update.body.clone();
        status.published_at = update.date.as_ref().map(|d| d.to_string());
        status.download_url = Some(update.download_url.to_string());
    } else {
        status.message = Some("No desktop app update available.".to_string());
    }

    Ok(status)
}

#[tauri::command]
async fn install_app_update(app: tauri::AppHandle) -> Result<AppUpdateStatus, String> {
    let mut status = default_update_status(&app);

    let updater = match build_runtime_updater(&app) {
        Ok(v) => v,
        Err(message) => {
            status.message = Some(message);
            return Ok(status);
        }
    };

    status.configured = true;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("Failed to check updates: {}", e))?;

    let Some(update) = update else {
        status.message = Some("No desktop app update available.".to_string());
        return Ok(status);
    };

    status.available = true;
    status.latest_version = Some(update.version.clone());
    status.notes = update.body.clone();
    status.published_at = update.date.as_ref().map(|d| d.to_string());
    status.download_url = Some(update.download_url.to_string());

    update
        .download_and_install(
            |_chunk_len, _content_len| {},
            || {},
        )
        .await
        .map_err(|e| format!("Failed to download/install update: {}", e))?;

    status.message = Some("Desktop update installed. Relaunch the app to use the new version.".to_string());
    Ok(status)
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            println!("Agent Workspace starting...");

            // Manage backend process (Tauri-spawned Node server)
            app.manage(BackendProcess::new());

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

            if should_spawn_backend() {
                let app_handle = app.handle().clone();
                let window = app.get_webview_window("main").or_else(|| {
                    app.webview_windows().values().next().cloned()
                });

                // Pick ephemeral port + per-launch auth token (local-only).
                let port = pick_free_port().unwrap_or(9470);
                let token = Uuid::new_v4().to_string();

                let node_cmd = resolve_node_command(&app_handle);
                let server_entry = resolve_server_entry(&app_handle);

                let data_dir = app_handle
                    .path()
                    .app_data_dir()
                    .unwrap_or_else(|_| {
                        std::env::current_dir()
                            .unwrap_or_else(|_| std::path::PathBuf::from("."))
                    });
                let _ = std::fs::create_dir_all(&data_dir);

                match server_entry {
                    None => {
                        let message = "Unable to locate the backend entrypoint (server/index.js).";
                        append_tauri_bootstrap_log(&data_dir, message);
                        if let Some(window) = window.clone() {
                            let hint = "Rebuild the app so backend resources are bundled. If you’re running a dev build, set <code>TAURI_SPAWN_BACKEND=true</code> and ensure <code>node</code> is on PATH (or set <code>ORCHESTRATOR_NODE_PATH</code>).".to_string();
                            tauri::async_runtime::spawn(async move {
                                show_bootstrap_error(
                                    window,
                                    "Backend missing",
                                    "The packaged backend could not be found, so the app can’t start.",
                                    Some(message.to_string()),
                                    Some(hint),
                                )
                                .await;
                            });
                        }
                    }
                    Some(entry) => {
                        let mut cmd = Command::new(node_cmd);
                        cmd.arg(entry);
                        cmd.current_dir(&data_dir);
                        cmd.stdin(Stdio::null());
                        // On Windows, null stdout/stderr to avoid console window flash.
                        // On other platforms, keep stderr for debugging.
                        #[cfg(target_os = "windows")]
                        {
                            cmd.stdout(Stdio::null());
                            cmd.stderr(Stdio::null());
                        }
                        #[cfg(not(target_os = "windows"))]
                        {
                            cmd.stdout(Stdio::null());
                            cmd.stderr(Stdio::inherit());
                        }
                        cmd.env("ORCHESTRATOR_HOST", "127.0.0.1");
                        cmd.env("ORCHESTRATOR_PORT", port.to_string());
                        cmd.env("AUTH_TOKEN", token.clone());
                        cmd.env("ORCHESTRATOR_DATA_DIR", data_dir.to_string_lossy().to_string());

                        // If we didn't bundle diff-viewer, disable auto-start so packaged builds don't fail noisily.
                        if !has_diff_viewer_folder(&app_handle) {
                            cmd.env("AUTO_START_DIFF_VIEWER", "false");
                        }

                        #[cfg(target_os = "windows")]
                        {
                            cmd.creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS);
                        }

                        match cmd.spawn() {
                            Err(err) => {
                                let details = format!(
                                    "Failed to spawn backend process.\n\nnode: {}\nentry: {}\ndata: {}\nport: {}\n\nerror: {}",
                                    cmd.get_program().to_string_lossy(),
                                    cmd.get_args()
                                        .next()
                                        .map(|v| v.to_string_lossy().to_string())
                                        .unwrap_or_else(|| "<missing entry>".to_string()),
                                    data_dir.to_string_lossy(),
                                    port,
                                    err
                                );
                                append_tauri_bootstrap_log(&data_dir, &details);
                                if let Some(window) = window.clone() {
                                    let hint = "If Node is missing, set <code>ORCHESTRATOR_NODE_PATH</code> (or bundle Node into the app resources). Then restart the app.".to_string();
                                    tauri::async_runtime::spawn(async move {
                                        show_bootstrap_error(
                                            window,
                                            "Failed to launch backend",
                                            "The local server process could not be started.",
                                            Some(details),
                                            Some(hint),
                                        )
                                        .await;
                                    });
                                }
                            }
                            Ok(child) => {
                                app_handle.state::<BackendProcess>().set_child(child);

                                if let Some(window) = window {
                                    let url = format!("http://127.0.0.1:{}/?token={}", port, token);
                                    let data_dir_for_wait = data_dir.clone();
                                    tauri::async_runtime::spawn(async move {
                                        if wait_for_port(port, Duration::from_secs(20)).await {
                                            navigate_window(window, url).await;
                                        } else {
                                            let details = format!(
                                                "Backend did not become ready within 20s.\n\nport: {}\ndata dir: {}\n\nCheck logs:\n- {}/logs/combined.log\n- {}/logs/error.log\n- {}/logs/tauri-bootstrap.log",
                                                port,
                                                data_dir_for_wait.to_string_lossy(),
                                                data_dir_for_wait.to_string_lossy(),
                                                data_dir_for_wait.to_string_lossy(),
                                                data_dir_for_wait.to_string_lossy()
                                            );
                                            append_tauri_bootstrap_log(&data_dir_for_wait, &details);
                                            show_bootstrap_error(
                                                window,
                                                "Backend did not become ready",
                                                "The local server started, but never opened its port.",
                                                Some(details),
                                                None,
                                            )
                                            .await;
                                        }
                                    });
                                }
                            }
                        }
                    }
                }
            }
            
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if let Some(proc_state) = window.app_handle().try_state::<BackendProcess>() {
                    proc_state.kill();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            show_notification,
            toggle_devtools,
            open_external,
            spawn_terminal,
            write_terminal,
            resize_terminal,
            kill_terminal,
            list_terminals,
            watch_directory,
            unwatch_directory,
            list_watched_paths,
            check_app_update,
            install_app_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
