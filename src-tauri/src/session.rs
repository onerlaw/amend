use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use uuid::Uuid;

// ── Event types ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SessionEvent {
    CommandStart {
        timestamp: u64,
        terminal_id: String,
        command: String,
        cwd: String,
    },
    CommandEnd {
        timestamp: u64,
        terminal_id: String,
        exit_code: Option<i32>,
        duration_ms: u64,
    },
    FileChanged {
        timestamp: u64,
        path: String,
        change_type: String,
    },
    GitStatusChanged {
        timestamp: u64,
        repo_path: String,
        staged_count: usize,
        unstaged_count: usize,
        untracked_count: usize,
    },
    TerminalOutput {
        timestamp: u64,
        terminal_id: String,
        line_count: usize,
        summary: String,
    },
}

// ── Session ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub terminal_id: String,
    pub started_at: u64,
    pub stopped_at: Option<u64>,
    pub events: Vec<SessionEvent>,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub terminal_id: String,
    pub started_at: u64,
    pub stopped_at: Option<u64>,
    pub label: String,
    pub event_count: usize,
}

impl Session {
    fn summary(&self) -> SessionSummary {
        SessionSummary {
            id: self.id.clone(),
            terminal_id: self.terminal_id.clone(),
            started_at: self.started_at,
            stopped_at: self.stopped_at,
            label: self.label.clone(),
            event_count: self.events.len(),
        }
    }
}

// ── SessionCapture (managed state) ──────────────────────────────────────

pub struct SessionCapture {
    sessions: RwLock<HashMap<String, Session>>,
    data_dir: RwLock<Option<PathBuf>>,
}

impl SessionCapture {
    pub fn new() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            data_dir: RwLock::new(None),
        }
    }

    /// Set the app data directory (called once at startup).
    pub fn set_data_dir(&self, dir: PathBuf) {
        let sessions_dir = dir.join("sessions");
        if !sessions_dir.exists() {
            let _ = fs::create_dir_all(&sessions_dir);
        }
        *self.data_dir.write().unwrap() = Some(dir);
    }

    fn sessions_dir(&self) -> Option<PathBuf> {
        self.data_dir
            .read()
            .unwrap()
            .as_ref()
            .map(|d| d.join("sessions"))
    }

    // ── Core operations ─────────────────────────────────────────────────

    pub fn start_session(&self, terminal_id: &str) -> String {
        let id = Uuid::new_v4().to_string();
        let now = now_millis();
        let session = Session {
            id: id.clone(),
            terminal_id: terminal_id.to_string(),
            started_at: now,
            stopped_at: None,
            events: Vec::new(),
            label: format!("Session {}", &id[..8]),
        };
        self.sessions.write().unwrap().insert(id.clone(), session);
        id
    }

    pub fn stop_session(&self, session_id: &str) {
        let now = now_millis();
        if let Some(session) = self.sessions.write().unwrap().get_mut(session_id) {
            session.stopped_at = Some(now);
        }
    }

    pub fn record_event(&self, session_id: &str, event: SessionEvent) {
        if let Some(session) = self.sessions.write().unwrap().get_mut(session_id) {
            session.events.push(event);
        }
    }

    pub fn get_session(&self, session_id: &str) -> Option<Session> {
        self.sessions.read().unwrap().get(session_id).cloned()
    }

    pub fn list_sessions(&self) -> Vec<SessionSummary> {
        let sessions = self.sessions.read().unwrap();
        let mut summaries: Vec<SessionSummary> = sessions.values().map(|s| s.summary()).collect();
        summaries.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        summaries
    }

    pub fn delete_session(&self, session_id: &str) {
        self.sessions.write().unwrap().remove(session_id);
        if let Some(dir) = self.sessions_dir() {
            let path = dir.join(format!("{}.json", session_id));
            let _ = fs::remove_file(path);
        }
    }

    // ── Integration hooks ───────────────────────────────────────────────

    pub fn record_command_start(
        &self,
        session_id: &str,
        terminal_id: &str,
        command: &str,
        cwd: &str,
    ) {
        self.record_event(
            session_id,
            SessionEvent::CommandStart {
                timestamp: now_millis(),
                terminal_id: terminal_id.to_string(),
                command: command.to_string(),
                cwd: cwd.to_string(),
            },
        );
    }

    pub fn record_file_change(&self, session_id: &str, path: &str, change_type: &str) {
        self.record_event(
            session_id,
            SessionEvent::FileChanged {
                timestamp: now_millis(),
                path: path.to_string(),
                change_type: change_type.to_string(),
            },
        );
    }

    // ── Persistence ─────────────────────────────────────────────────────

    pub fn save_session(&self, session_id: &str) -> Result<(), String> {
        let dir = self
            .sessions_dir()
            .ok_or_else(|| "Sessions directory not configured".to_string())?;

        let session = self
            .sessions
            .read()
            .unwrap()
            .get(session_id)
            .cloned()
            .ok_or_else(|| format!("Session {} not found", session_id))?;

        let path = dir.join(format!("{}.json", session_id));
        let json = serde_json::to_string_pretty(&session)
            .map_err(|e| format!("Failed to serialize session: {}", e))?;
        fs::write(path, json).map_err(|e| format!("Failed to write session file: {}", e))?;
        Ok(())
    }

    pub fn load_sessions(&self) -> Result<(), String> {
        let dir = match self.sessions_dir() {
            Some(d) if d.exists() => d,
            _ => return Ok(()),
        };

        let entries =
            fs::read_dir(&dir).map_err(|e| format!("Failed to read sessions dir: {}", e))?;

        let mut sessions = self.sessions.write().unwrap();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("json") {
                match fs::read_to_string(&path) {
                    Ok(json) => match serde_json::from_str::<Session>(&json) {
                        Ok(session) => {
                            sessions.insert(session.id.clone(), session);
                        }
                        Err(e) => {
                            eprintln!(
                                "[session] Failed to parse {}: {}",
                                path.display(),
                                e
                            );
                        }
                    },
                    Err(e) => {
                        eprintln!(
                            "[session] Failed to read {}: {}",
                            path.display(),
                            e
                        );
                    }
                }
            }
        }
        Ok(())
    }
}

// ── Tauri commands ──────────────────────────────────────────────────────

#[tauri::command]
pub fn start_session_recording(
    terminal_id: String,
    capture: State<'_, SessionCapture>,
) -> String {
    capture.start_session(&terminal_id)
}

#[tauri::command]
pub fn stop_session_recording(
    session_id: String,
    capture: State<'_, SessionCapture>,
) -> Result<(), String> {
    capture.stop_session(&session_id);
    capture.save_session(&session_id)?;
    Ok(())
}

#[tauri::command]
pub fn list_sessions(capture: State<'_, SessionCapture>) -> Vec<SessionSummary> {
    capture.list_sessions()
}

#[tauri::command]
pub fn get_session(
    session_id: String,
    capture: State<'_, SessionCapture>,
) -> Result<Session, String> {
    capture
        .get_session(&session_id)
        .ok_or_else(|| format!("Session {} not found", session_id))
}

#[tauri::command]
pub fn delete_session(
    session_id: String,
    capture: State<'_, SessionCapture>,
) -> Result<(), String> {
    capture.delete_session(&session_id);
    Ok(())
}

#[tauri::command]
pub fn record_session_event(
    session_id: String,
    event: SessionEvent,
    capture: State<'_, SessionCapture>,
) -> Result<(), String> {
    capture.record_event(&session_id, event);
    Ok(())
}

// ── Helpers ─────────────────────────────────────────────────────────────

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
