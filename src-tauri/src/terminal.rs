use crate::error::impl_serialize_as_string;
use crate::terminal_buffer::OutputBufferRegistry;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter, Manager};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum TerminalError {
    #[error("PTY error: {0}")]
    Pty(String),
    #[error("Terminal not found: {0}")]
    NotFound(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

impl_serialize_as_string!(TerminalError);

struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send>,
    shell_pid: Option<u32>,
}

pub struct TerminalManager {
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
}

/// Writes a .zshenv shell integration file that emits OSC 7 CWD sequences.
/// Returns the directory path on success, or None on failure (best-effort).
fn setup_shell_integration(app_handle: &AppHandle) -> Option<PathBuf> {
    let app_data = app_handle.path().app_data_dir().ok()?;
    let integration_dir = app_data.join("shell-integration").join("zsh");
    std::fs::create_dir_all(&integration_dir).ok()?;

    let zshenv_content = r#"# Restore original ZDOTDIR so user dotfiles load normally
if [[ -n "${_AMEND_ORIG_ZDOTDIR+x}" ]]; then
  ZDOTDIR="$_AMEND_ORIG_ZDOTDIR"
  unset _AMEND_ORIG_ZDOTDIR
else
  unset ZDOTDIR
fi
[[ -f "${ZDOTDIR:-$HOME}/.zshenv" ]] && source "${ZDOTDIR:-$HOME}/.zshenv"

# OSC 7 CWD reporting
autoload -Uz add-zsh-hook
_amend_report_cwd() { printf '\e]7;file://%s%s\e\\' "${HOST}" "${PWD}" }
add-zsh-hook precmd _amend_report_cwd
add-zsh-hook chpwd _amend_report_cwd
"#;

    std::fs::write(integration_dir.join(".zshenv"), zshenv_content).ok()?;
    Some(integration_dir)
}

/// Get the newest child PID of a given parent process.
fn get_child_pid(parent_pid: u32) -> Option<u32> {
    let output = std::process::Command::new("pgrep")
        .args(["-nP", &parent_pid.to_string()])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout.trim().lines().next()?.parse::<u32>().ok()
}

/// Get the current working directory of a process.
fn get_process_cwd(pid: u32) -> Option<String> {
    if cfg!(target_os = "linux") {
        std::fs::read_link(format!("/proc/{}/cwd", pid))
            .ok()
            .and_then(|p| p.to_str().map(String::from))
    } else {
        // macOS: use lsof
        let output = std::process::Command::new("lsof")
            .args(["-a", "-d", "cwd", "-p", &pid.to_string(), "-Fn"])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if let Some(path) = line.strip_prefix('n') {
                return Some(path.to_string());
            }
        }
        None
    }
}

/// Check if a process is still alive.
fn is_process_alive(pid: u32) -> bool {
    std::process::Command::new("ps")
        .args(["-p", &pid.to_string()])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

impl Default for TerminalManager {
    fn default() -> Self {
        Self::new()
    }
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn create_terminal(
        &self,
        app_handle: &AppHandle,
        cwd: Option<String>,
    ) -> Result<String, TerminalError> {
        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| TerminalError::Pty(e.to_string()))?;

        let shell = std::env::var("SHELL").unwrap_or_else(|_| {
            if cfg!(target_os = "windows") {
                "cmd.exe".to_string()
            } else {
                "/bin/bash".to_string()
            }
        });

        let is_zsh = shell.ends_with("/zsh") || shell == "zsh";
        let is_bash = shell.ends_with("/bash") || shell == "bash";

        let mut cmd = CommandBuilder::new(&shell);

        // Set terminal type
        cmd.env("TERM", "xterm-256color");

        // Set locale if not inherited
        if std::env::var("LANG").is_err() {
            cmd.env("LANG", "en_US.UTF-8");
        }
        if std::env::var("LC_ALL").is_err() {
            cmd.env("LC_ALL", "en_US.UTF-8");
        }

        // Shell integration: zsh uses ZDOTDIR override
        if is_zsh {
            if let Some(integration_dir) = setup_shell_integration(app_handle) {
                // Preserve original ZDOTDIR so our .zshenv can restore it
                if let Ok(orig) = std::env::var("ZDOTDIR") {
                    cmd.env("_AMEND_ORIG_ZDOTDIR", orig);
                }
                cmd.env("ZDOTDIR", integration_dir.to_string_lossy().as_ref());
            }
        }

        // Login shell (sources .zprofile/.bash_profile)
        if !cfg!(target_os = "windows") {
            cmd.arg("-l");
        }

        if let Some(dir) = cwd {
            cmd.cwd(dir);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| TerminalError::Pty(e.to_string()))?;

        let shell_pid = child.process_id();
        let id = uuid::Uuid::new_v4().to_string();
        let mut writer = pair
            .master
            .take_writer()
            .map_err(|e| TerminalError::Pty(e.to_string()))?;

        // Shell integration: bash uses stdin injection
        if is_bash {
            let bash_init = concat!(
                r#"PROMPT_COMMAND='printf "\e]7;file://%s%s\e\\" "${HOSTNAME}" "${PWD}"'"#,
                "; clear\n"
            );
            let _ = writer.write_all(bash_init.as_bytes());
            let _ = writer.flush();
        }

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| TerminalError::Pty(e.to_string()))?;

        let session = TerminalSession {
            master: pair.master,
            writer,
            child,
            shell_pid,
        };

        self.sessions.lock().insert(id.clone(), session);

        // Get the output buffer for this terminal
        let buffer_registry: tauri::State<'_, Arc<OutputBufferRegistry>> = app_handle.state();
        let buffer_registry = Arc::clone(buffer_registry.inner());
        let id_for_buffer = id.clone();

        // Spawn reader thread
        let id_clone = id.clone();
        let app_handle_clone = app_handle.clone();
        let rt = tokio::runtime::Handle::current();

        thread::spawn(move || {
            let output_buffer = rt.block_on(buffer_registry.get_or_create(&id_for_buffer));

            let mut buffer = [0u8; 4096];
            let event_name = format!("terminal-output-{}", id_clone);
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(n) => {
                        // Push raw bytes into ring buffer (strips ANSI, splits lines)
                        rt.block_on(async {
                            output_buffer.write().await.push(&buffer[..n]);
                        });

                        let encoded = STANDARD.encode(&buffer[..n]);
                        let _ = app_handle_clone.emit(&event_name, encoded);
                    }
                    Err(e) => {
                        eprintln!("Terminal reader error for {}: {}", id_clone, e);
                        break;
                    }
                }
            }
            let _ = app_handle_clone.emit(&format!("terminal-exit-{}", id_clone), ());
        });

        // Spawn CWD polling thread for child process detection
        if let Some(shell_pid) = shell_pid {
            let id_for_cwd = id.clone();
            let app_handle_for_cwd = app_handle.clone();
            thread::spawn(move || {
                let event_name = format!("terminal-cwd-{}", id_for_cwd);
                let busy_event_name = format!("terminal-busy-{}", id_for_cwd);
                let mut last_cwd: Option<String> = None;
                let mut last_busy: Option<bool> = None;

                loop {
                    thread::sleep(std::time::Duration::from_secs(2));

                    // Exit if shell is dead
                    if !is_process_alive(shell_pid) {
                        break;
                    }

                    let child_pid = get_child_pid(shell_pid);
                    let is_busy = child_pid
                        .map(|pid| get_child_pid(pid).is_some())
                        .unwrap_or(false);
                    if last_busy != Some(is_busy) {
                        last_busy = Some(is_busy);
                        let _ = app_handle_for_cwd.emit(&busy_event_name, is_busy);
                    }

                    if let Some(child_pid) = child_pid {
                        if let Some(cwd) = get_process_cwd(child_pid) {
                            if last_cwd.as_ref() != Some(&cwd) {
                                last_cwd = Some(cwd.clone());
                                let _ = app_handle_for_cwd.emit(&event_name, cwd);
                            }
                        }
                    } else {
                        // No child process — reset so next child is detected
                        last_cwd = None;
                    }
                }
            });
        }

        Ok(id)
    }

    pub fn write_to_terminal(&self, id: &str, data: &str) -> Result<(), TerminalError> {
        let mut sessions = self.sessions.lock();
        let session = sessions
            .get_mut(id)
            .ok_or_else(|| TerminalError::NotFound(id.to_string()))?;

        session.writer.write_all(data.as_bytes())?;
        session.writer.flush()?;
        Ok(())
    }

    pub fn resize_terminal(&self, id: &str, cols: u16, rows: u16) -> Result<(), TerminalError> {
        let sessions = self.sessions.lock();
        let session = sessions
            .get(id)
            .ok_or_else(|| TerminalError::NotFound(id.to_string()))?;

        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| TerminalError::Pty(e.to_string()))?;

        Ok(())
    }

    pub fn close_terminal(&self, id: &str) -> Result<(), TerminalError> {
        // Remove session from the map and drop the lock before kill/wait,
        // so write_to_terminal and resize_terminal aren't blocked.
        let mut session = {
            self.sessions
                .lock()
                .remove(id)
                .ok_or_else(|| TerminalError::NotFound(id.to_string()))?
        };

        // Kill the child process and wait for it to exit (lock is not held)
        let _ = session.child.kill();
        let _ = session.child.wait();

        Ok(())
    }

    /// Check if a terminal has an actively working child process.
    /// Returns true only when the shell's child has its own children
    /// (grandchildren of the shell), so idle interactive programs like
    /// `claude` at a prompt won't show as busy.
    pub fn is_busy(&self, id: &str) -> bool {
        // Extract PID under the lock, then release before spawning pgrep
        let pid = {
            let sessions = self.sessions.lock();
            let Some(session) = sessions.get(id) else {
                return false;
            };
            match session.shell_pid {
                Some(pid) => pid,
                None => return false,
            }
        };
        // Get the shell's direct child, then check if it has its own children
        let child_pid = match get_child_pid(pid) {
            Some(pid) => pid,
            None => return false,
        };
        get_child_pid(child_pid).is_some()
    }
}

// Tauri commands
#[tauri::command]
pub async fn create_terminal(
    app_handle: AppHandle,
    state: tauri::State<'_, Arc<TerminalManager>>,
    cwd: Option<String>,
) -> Result<String, TerminalError> {
    state.create_terminal(&app_handle, cwd)
}

#[tauri::command]
pub async fn write_to_terminal(
    state: tauri::State<'_, Arc<TerminalManager>>,
    id: String,
    data: String,
) -> Result<(), TerminalError> {
    let mgr = state.inner().clone();
    tokio::task::spawn_blocking(move || mgr.write_to_terminal(&id, &data))
        .await
        .map_err(|e| TerminalError::Pty(e.to_string()))?
}

#[tauri::command]
pub async fn resize_terminal(
    state: tauri::State<'_, Arc<TerminalManager>>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), TerminalError> {
    let mgr = state.inner().clone();
    tokio::task::spawn_blocking(move || mgr.resize_terminal(&id, cols, rows))
        .await
        .map_err(|e| TerminalError::Pty(e.to_string()))?
}

#[tauri::command]
pub async fn close_terminal(
    state: tauri::State<'_, Arc<TerminalManager>>,
    buffer_registry: tauri::State<'_, Arc<OutputBufferRegistry>>,
    id: String,
) -> Result<(), TerminalError> {
    buffer_registry.remove(&id).await;
    state.close_terminal(&id)
}

#[tauri::command]
pub async fn is_terminal_busy(
    id: String,
    state: tauri::State<'_, Arc<TerminalManager>>,
) -> Result<bool, TerminalError> {
    let mgr = state.inner().clone();
    tokio::task::spawn_blocking(move || mgr.is_busy(&id))
        .await
        .map_err(|e| TerminalError::Pty(e.to_string()))
}
