use crate::error::impl_serialize_as_string;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter, Manager};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum LspError {
    #[error("LSP server not found: {0}")]
    NotFound(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Failed to spawn LSP server: {0}")]
    Spawn(String),
    #[error("Failed to resolve bundled resource: {0}")]
    Resource(String),
}

impl_serialize_as_string!(LspError);

struct LspSession {
    child: Child,
    stdin: std::process::ChildStdin,
}

pub struct LspManager {
    sessions: Arc<Mutex<HashMap<String, LspSession>>>,
}

impl Default for LspManager {
    fn default() -> Self {
        Self::new()
    }
}

impl LspManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn start_server(
        &self,
        app_handle: &AppHandle,
        server_id: &str,
        command: &str,
        args: &[String],
        root_path: Option<&str>,
    ) -> Result<(), LspError> {
        // Check if already running
        if self.sessions.lock().contains_key(server_id) {
            return Ok(());
        }

        let mut cmd = Command::new(command);
        cmd.args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(cwd) = root_path {
            cmd.current_dir(cwd);
        }

        let mut child = cmd.spawn().map_err(|e| LspError::Spawn(e.to_string()))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| LspError::Spawn("Failed to capture stdin".to_string()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| LspError::Spawn("Failed to capture stdout".to_string()))?;
        let stderr = child
            .stderr
            .take();

        let session = LspSession { child, stdin };
        self.sessions.lock().insert(server_id.to_string(), session);

        // Spawn stdout reader thread — parses Content-Length framed LSP messages
        let id_clone = server_id.to_string();
        let app_clone = app_handle.clone();
        thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                // Parse headers until empty line
                let mut content_length: Option<usize> = None;
                loop {
                    let mut header_line = String::new();
                    match reader.read_line(&mut header_line) {
                        Ok(0) => return, // EOF
                        Ok(_) => {
                            let trimmed = header_line.trim();
                            if trimmed.is_empty() {
                                break; // End of headers
                            }
                            if let Some(val) = trimmed.strip_prefix("Content-Length: ") {
                                if let Ok(len) = val.parse::<usize>() {
                                    content_length = Some(len);
                                }
                            }
                        }
                        Err(_) => return,
                    }
                }

                let Some(len) = content_length else {
                    continue;
                };

                // Read exactly `len` bytes of content
                let mut body = vec![0u8; len];
                if reader.read_exact(&mut body).is_err() {
                    break;
                }

                let json_str = String::from_utf8_lossy(&body).to_string();
                let event_name = format!("lsp-message-{}", id_clone);
                let _ = app_clone.emit(&event_name, &json_str);
            }

            let _ = app_clone.emit(&format!("lsp-exit-{}", id_clone), ());
        });

        // Spawn stderr reader thread — log to eprintln
        if let Some(stderr) = stderr {
            let id_for_stderr = server_id.to_string();
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    match line {
                        Ok(l) => eprintln!("[LSP {}] {}", id_for_stderr, l),
                        Err(_) => break,
                    }
                }
            });
        }

        Ok(())
    }

    pub fn send_message(&self, server_id: &str, json: &str) -> Result<(), LspError> {
        let mut sessions = self.sessions.lock();
        let session = sessions
            .get_mut(server_id)
            .ok_or_else(|| LspError::NotFound(server_id.to_string()))?;

        let msg = format!("Content-Length: {}\r\n\r\n{}", json.len(), json);
        session.stdin.write_all(msg.as_bytes())?;
        session.stdin.flush()?;
        Ok(())
    }

    pub fn stop_server(&self, server_id: &str) -> Result<(), LspError> {
        let mut sessions = self.sessions.lock();
        let mut session = sessions
            .remove(server_id)
            .ok_or_else(|| LspError::NotFound(server_id.to_string()))?;

        let _ = session.child.kill();
        let _ = session.child.wait();
        Ok(())
    }
}

/// Resolve the path to the bundled Node.js sidecar binary.
fn resolve_bundled_node(app_handle: &AppHandle) -> Result<String, LspError> {
    // Tauri sidecars are resolved relative to the app's binary directory
    // with the target triple suffix. In dev mode, they live in src-tauri/bin/.
    let resource_dir = app_handle
        .path()
        .resource_dir()
        .map_err(|e| LspError::Resource(e.to_string()))?;

    // Tauri resolves sidecar binaries by appending the target triple.
    // The sidecar is registered as "bin/node", so we look for it in the resource dir.
    let node_path = resource_dir.join("bin").join(format!(
        "node-{}",
        current_target_triple()
    ));

    if node_path.exists() {
        return Ok(node_path.to_string_lossy().to_string());
    }

    // In development, check src-tauri/bin/
    let dev_path = std::env::current_dir()
        .unwrap_or_default()
        .join("bin")
        .join(format!("node-{}", current_target_triple()));

    if dev_path.exists() {
        return Ok(dev_path.to_string_lossy().to_string());
    }

    Err(LspError::Resource(format!(
        "Bundled Node.js not found at {:?} or {:?}",
        node_path, dev_path
    )))
}

/// Resolve the path to a bundled LSP server script inside resources.
fn resolve_lsp_resource(app_handle: &AppHandle, relative_path: &str) -> Result<String, LspError> {
    let resource_dir = app_handle
        .path()
        .resource_dir()
        .map_err(|e| LspError::Resource(e.to_string()))?;

    let path = resource_dir.join("resources").join(relative_path);
    if path.exists() {
        return Ok(path.to_string_lossy().to_string());
    }

    // In development, check src-tauri/resources/
    let dev_path = std::env::current_dir()
        .unwrap_or_default()
        .join("resources")
        .join(relative_path);

    if dev_path.exists() {
        return Ok(dev_path.to_string_lossy().to_string());
    }

    Err(LspError::Resource(format!(
        "LSP resource not found at {:?} or {:?}",
        path, dev_path
    )))
}

fn current_target_triple() -> &'static str {
    if cfg!(target_arch = "x86_64") && cfg!(target_os = "macos") {
        "x86_64-apple-darwin"
    } else if cfg!(target_arch = "aarch64") && cfg!(target_os = "macos") {
        "aarch64-apple-darwin"
    } else if cfg!(target_arch = "x86_64") && cfg!(target_os = "linux") {
        "x86_64-unknown-linux-gnu"
    } else if cfg!(target_arch = "aarch64") && cfg!(target_os = "linux") {
        "aarch64-unknown-linux-gnu"
    } else {
        "unknown"
    }
}

// --- Tauri commands ---

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartServerArgs {
    pub server_id: String,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub root_path: Option<String>,
    pub use_bundled_node: Option<bool>,
    pub server_script: Option<String>,
}

#[tauri::command]
pub fn lsp_start_server(
    app_handle: AppHandle,
    state: tauri::State<'_, LspManager>,
    params: StartServerArgs,
) -> Result<(), LspError> {
    let (command, args) = if params.use_bundled_node.unwrap_or(false) {
        let node_path = resolve_bundled_node(&app_handle)?;
        let script = params.server_script.ok_or_else(|| {
            LspError::Spawn("server_script is required when use_bundled_node is true".to_string())
        })?;
        let script_path = resolve_lsp_resource(&app_handle, &script)?;
        let mut all_args = vec![script_path];
        all_args.extend(params.args);
        (node_path, all_args)
    } else {
        let cmd = params.command.ok_or_else(|| {
            LspError::Spawn("command is required when use_bundled_node is false".to_string())
        })?;
        (cmd, params.args)
    };

    state.start_server(
        &app_handle,
        &params.server_id,
        &command,
        &args,
        params.root_path.as_deref(),
    )
}

#[tauri::command]
pub fn lsp_send_message(
    state: tauri::State<'_, LspManager>,
    server_id: String,
    message: String,
) -> Result<(), LspError> {
    state.send_message(&server_id, &message)
}

#[tauri::command]
pub fn lsp_stop_server(
    state: tauri::State<'_, LspManager>,
    server_id: String,
) -> Result<(), LspError> {
    state.stop_server(&server_id)
}
