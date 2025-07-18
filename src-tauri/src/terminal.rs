use portable_pty::{CommandBuilder, PtySize, native_pty_system};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::io::{Read, Write};
use tokio::sync::mpsc;
use uuid::Uuid;
use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalSize {
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalOutput {
    pub session_id: String,
    pub data: String,
}

pub struct Terminal {
    _id: String,
    pty: Box<dyn portable_pty::MasterPty + Send>,
    writer: Box<dyn std::io::Write + Send>,
}

pub struct TerminalManager {
    terminals: Arc<Mutex<HashMap<String, Terminal>>>,
    output_tx: mpsc::UnboundedSender<TerminalOutput>,
}

impl TerminalManager {
    pub fn new(output_tx: mpsc::UnboundedSender<TerminalOutput>) -> Self {
        Self {
            terminals: Arc::new(Mutex::new(HashMap::new())),
            output_tx,
        }
    }

    pub async fn spawn_terminal(&self, session_id: Option<String>) -> Result<String> {
        let session_id = session_id.unwrap_or_else(|| Uuid::new_v4().to_string());
        
        // Create a new PTY
        let pty_system = native_pty_system();
        let pty_pair = pty_system.openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        // Configure the command to run
        #[cfg(target_os = "windows")]
        let cmd = CommandBuilder::new("cmd.exe");
        
        #[cfg(not(target_os = "windows"))]
        let cmd = CommandBuilder::new(std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string()));

        // Spawn the child process
        let _child = pty_pair.slave.spawn_command(cmd)?;
        
        // Get writer for sending input
        let writer = pty_pair.master.take_writer()?;
        
        // Create terminal instance
        let terminal = Terminal {
            _id: session_id.clone(),
            pty: pty_pair.master,
            writer,
        };

        // Start reading output in a separate thread (portable-pty uses std::io)
        let mut reader = terminal.pty.try_clone_reader()?;
        let output_tx = self.output_tx.clone();
        let session_id_clone = session_id.clone();
        
        std::thread::spawn(move || {
            let mut buffer = vec![0u8; 4096];
            
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break, // EOF
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buffer[..n]).to_string();
                        let _ = output_tx.send(TerminalOutput {
                            session_id: session_id_clone.clone(),
                            data,
                        });
                    }
                    Err(e) => {
                        eprintln!("Error reading terminal output: {}", e);
                        break;
                    }
                }
            }
        });

        // Store terminal
        self.terminals.lock().unwrap().insert(session_id.clone(), terminal);
        
        Ok(session_id)
    }

    pub fn write_to_terminal(&self, session_id: &str, data: &str) -> Result<()> {
        let mut terminals = self.terminals.lock().unwrap();
        if let Some(terminal) = terminals.get_mut(session_id) {
            terminal.writer.write_all(data.as_bytes())?;
            terminal.writer.flush()?;
            Ok(())
        } else {
            Err(anyhow::anyhow!("Terminal not found"))
        }
    }

    pub fn resize_terminal(&self, session_id: &str, cols: u16, rows: u16) -> Result<()> {
        let terminals = self.terminals.lock().unwrap();
        if let Some(terminal) = terminals.get(session_id) {
            terminal.pty.resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })?;
            Ok(())
        } else {
            Err(anyhow::anyhow!("Terminal not found"))
        }
    }

    pub fn kill_terminal(&self, session_id: &str) -> Result<()> {
        let mut terminals = self.terminals.lock().unwrap();
        if terminals.remove(session_id).is_some() {
            Ok(())
        } else {
            Err(anyhow::anyhow!("Terminal not found"))
        }
    }

    pub fn list_terminals(&self) -> Vec<String> {
        self.terminals.lock().unwrap().keys().cloned().collect()
    }
}