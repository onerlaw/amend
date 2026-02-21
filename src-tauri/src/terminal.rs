use crate::error::impl_serialize_as_string;
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

        // Spawn reader thread
        let id_clone = id.clone();
        let app_handle_clone = app_handle.clone();

        thread::spawn(move || {
            let mut buffer = [0u8; 4096];
            let event_name = format!("terminal-output-{}", id_clone);
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(n) => {
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
        let mut sessions = self.sessions.lock();
        let mut session = sessions
            .remove(id)
            .ok_or_else(|| TerminalError::NotFound(id.to_string()))?;

        // Kill the child process and wait for it to exit
        let _ = session.child.kill();
        let _ = session.child.wait();

        Ok(())
    }
}

// Tauri commands
#[tauri::command]
pub fn create_terminal(
    app_handle: AppHandle,
    state: tauri::State<'_, TerminalManager>,
    cwd: Option<String>,
) -> Result<String, TerminalError> {
    state.create_terminal(&app_handle, cwd)
}

#[tauri::command]
pub fn write_to_terminal(
    state: tauri::State<'_, TerminalManager>,
    id: String,
    data: String,
) -> Result<(), TerminalError> {
    state.write_to_terminal(&id, &data)
}

#[tauri::command]
pub fn resize_terminal(
    state: tauri::State<'_, TerminalManager>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), TerminalError> {
    state.resize_terminal(&id, cols, rows)
}

#[tauri::command]
pub fn close_terminal(
    state: tauri::State<'_, TerminalManager>,
    id: String,
) -> Result<(), TerminalError> {
    state.close_terminal(&id)
}

#[tauri::command]
pub fn is_terminal_busy(id: String, state: tauri::State<'_, TerminalManager>) -> bool {
    let sessions = state.sessions.lock();
    let Some(session) = sessions.get(&id) else {
        return false;
    };
    let Some(pid) = session.shell_pid else {
        return false;
    };
    std::process::Command::new("pgrep")
        .args(["-P", &pid.to_string()])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}
