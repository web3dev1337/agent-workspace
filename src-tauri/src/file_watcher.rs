use notify::{Watcher, RecursiveMode, Event, Config, RecommendedWatcher};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use tokio::sync::mpsc;
use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEvent {
    pub path: String,
    pub event_type: String,
    pub timestamp: u64,
}

pub struct FileWatcherManager {
    watchers: Arc<Mutex<HashMap<String, RecommendedWatcher>>>,
    event_tx: mpsc::UnboundedSender<FileEvent>,
}

impl FileWatcherManager {
    pub fn new(event_tx: mpsc::UnboundedSender<FileEvent>) -> Self {
        Self {
            watchers: Arc::new(Mutex::new(HashMap::new())),
            event_tx,
        }
    }

    pub fn watch_directory(&self, path: String) -> Result<()> {
        let event_tx = self.event_tx.clone();
        
        // Create a channel for the watcher
        let (tx, rx) = std::sync::mpsc::channel();
        
        // Create the watcher
        let mut watcher = RecommendedWatcher::new(
            tx,
            Config::default(),
        )?;
        
        // Start watching the path
        watcher.watch(PathBuf::from(&path).as_path(), RecursiveMode::Recursive)?;
        
        // Spawn a thread to handle events
        let path_clone = path.clone();
        std::thread::spawn(move || {
            for res in rx {
                match res {
                    Ok(event) => {
                        let file_event = FileEvent {
                            path: event.paths.first()
                                .map(|p| p.to_string_lossy().to_string())
                                .unwrap_or_else(|| path_clone.clone()),
                            event_type: format!("{:?}", event.kind),
                            timestamp: std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap()
                                .as_secs(),
                        };
                        let _ = event_tx.send(file_event);
                    }
                    Err(e) => eprintln!("Watch error: {:?}", e),
                }
            }
        });
        
        // Store the watcher
        self.watchers.lock().unwrap().insert(path, watcher);
        
        Ok(())
    }

    pub fn unwatch_directory(&self, path: &str) -> Result<()> {
        let mut watchers = self.watchers.lock().unwrap();
        if watchers.remove(path).is_some() {
            Ok(())
        } else {
            Err(anyhow::anyhow!("Watcher not found for path: {}", path))
        }
    }

    pub fn list_watched_paths(&self) -> Vec<String> {
        self.watchers.lock().unwrap().keys().cloned().collect()
    }

    pub fn is_watching(&self, path: &str) -> bool {
        self.watchers.lock().unwrap().contains_key(path)
    }
}