use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

const SESSION_TIMEOUT_MS: u64 = 300_000; // 5 minutes

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
    AgentActivity {
        timestamp: u64,
        agent: String,
        action: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_name: Option<String>,
    },
}

fn event_timestamp(event: &SessionEvent) -> u64 {
    match event {
        SessionEvent::CommandStart { timestamp, .. } => *timestamp,
        SessionEvent::CommandEnd { timestamp, .. } => *timestamp,
        SessionEvent::FileChanged { timestamp, .. } => *timestamp,
        SessionEvent::GitStatusChanged { timestamp, .. } => *timestamp,
        SessionEvent::TerminalOutput { timestamp, .. } => *timestamp,
        SessionEvent::AgentActivity { timestamp, .. } => *timestamp,
    }
}

// ── Session ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    #[serde(default)]
    pub terminal_id: Option<String>,
    pub started_at: u64,
    pub stopped_at: Option<u64>,
    pub events: Vec<SessionEvent>,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    #[serde(default)]
    pub terminal_id: Option<String>,
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

const WORKSPACE_KEY: &str = "__workspace__";

struct ActiveSessionInfo {
    session_id: String,
    last_event_time: u64,
}

pub struct SessionCapture {
    sessions: RwLock<HashMap<String, Session>>,
    data_dir: RwLock<Option<PathBuf>>,
    active_sessions: RwLock<HashMap<String, ActiveSessionInfo>>,
}

impl SessionCapture {
    pub fn new() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            data_dir: RwLock::new(None),
            active_sessions: RwLock::new(HashMap::new()),
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

    // ── Auto-session management ─────────────────────────────────────────

    pub fn record_auto_event(&self, event: SessionEvent, terminal_id: Option<String>) -> String {
        let ts = event_timestamp(&event);
        let key = terminal_id.clone().unwrap_or_else(|| WORKSPACE_KEY.into());

        let active_sessions = self.active_sessions.read().unwrap();
        let session_id = match active_sessions.get(&key) {
            Some(info)
                if info.last_event_time > 0
                    && ts.saturating_sub(info.last_event_time) < SESSION_TIMEOUT_MS =>
            {
                // Active session, within timeout — append
                info.session_id.clone()
            }
            Some(info) => {
                // Active session but timed out — close old, create new
                let old_id = info.session_id.clone();
                drop(active_sessions);
                self.close_session(&old_id);
                self.create_session(ts, terminal_id)
            }
            None => {
                drop(active_sessions);
                // No active session — create new
                self.create_session(ts, terminal_id)
            }
        };

        // Append event
        if let Some(session) = self.sessions.write().unwrap().get_mut(&session_id) {
            session.events.push(event);
        }

        // Update last_event_time
        if let Some(info) = self.active_sessions.write().unwrap().get_mut(&key) {
            info.last_event_time = ts;
        }

        session_id
    }

    fn create_session(&self, started_at: u64, terminal_id: Option<String>) -> String {
        let id = Uuid::new_v4().to_string();
        let key = terminal_id.clone().unwrap_or_else(|| WORKSPACE_KEY.into());
        let session = Session {
            id: id.clone(),
            terminal_id,
            started_at,
            stopped_at: None,
            events: Vec::new(),
            label: format!("Session {}", &id[..8]),
        };
        self.sessions.write().unwrap().insert(id.clone(), session);
        self.active_sessions.write().unwrap().insert(
            key,
            ActiveSessionInfo {
                session_id: id.clone(),
                last_event_time: started_at,
            },
        );
        id
    }

    fn close_session(&self, session_id: &str) {
        let now = now_millis();
        if let Some(session) = self.sessions.write().unwrap().get_mut(session_id) {
            session.stopped_at = Some(now);
        }
        let _ = self.save_session(session_id);

        // Remove from active_sessions map
        self.active_sessions
            .write()
            .unwrap()
            .retain(|_, info| info.session_id != session_id);
    }

    pub fn close_sessions_for_terminal(&self, terminal_id: &str) {
        let session_id = self
            .active_sessions
            .read()
            .unwrap()
            .get(terminal_id)
            .map(|info| info.session_id.clone());
        if let Some(id) = session_id {
            self.close_session(&id);
        }
    }

    pub fn get_active_session_id_for_terminal(&self, terminal_id: &str) -> Option<String> {
        self.active_sessions
            .read()
            .unwrap()
            .get(terminal_id)
            .map(|info| info.session_id.clone())
    }

    /// Called on startup: rebuild active_sessions from all open sessions.
    pub fn restore_active_session(&self) {
        let sessions = self.sessions.read().unwrap();
        let now = now_millis();

        // Collect all open sessions
        let open_sessions: Vec<(String, String, u64)> = sessions
            .values()
            .filter(|s| s.stopped_at.is_none())
            .map(|s| {
                let last_ts = s
                    .events
                    .last()
                    .map(|e| event_timestamp(e))
                    .unwrap_or(s.started_at);
                let key = s
                    .terminal_id
                    .clone()
                    .unwrap_or_else(|| WORKSPACE_KEY.into());
                (s.id.clone(), key, last_ts)
            })
            .collect();

        drop(sessions); // release read lock before writing

        for (id, key, last_ts) in open_sessions {
            if now.saturating_sub(last_ts) >= SESSION_TIMEOUT_MS {
                self.close_session(&id);
            } else {
                self.active_sessions.write().unwrap().insert(
                    key,
                    ActiveSessionInfo {
                        session_id: id,
                        last_event_time: last_ts,
                    },
                );
            }
        }
    }

    pub fn get_active_session_id(&self) -> Option<String> {
        // Return any active session (for backward compat)
        self.active_sessions
            .read()
            .unwrap()
            .values()
            .next()
            .map(|info| info.session_id.clone())
    }

    pub fn list_sessions_for_terminal(&self, terminal_id: Option<String>) -> Vec<SessionSummary> {
        let sessions = self.sessions.read().unwrap();
        let mut summaries: Vec<SessionSummary> = sessions
            .values()
            .filter(|s| match &terminal_id {
                Some(tid) => s.terminal_id.as_deref() == Some(tid.as_str()),
                None => true,
            })
            .map(|s| s.summary())
            .collect();
        summaries.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        summaries
    }

    // ── Core operations ─────────────────────────────────────────────────

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
        // Remove from active_sessions if present
        self.active_sessions
            .write()
            .unwrap()
            .retain(|_, info| info.session_id != session_id);
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
                            eprintln!("[session] Failed to parse {}: {}", path.display(), e);
                        }
                    },
                    Err(e) => {
                        eprintln!("[session] Failed to read {}: {}", path.display(), e);
                    }
                }
            }
        }
        Ok(())
    }
}

// ── Tauri commands ──────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionEventPayload {
    session_id: String,
    terminal_id: Option<String>,
}

#[tauri::command]
pub fn record_event(
    event: SessionEvent,
    terminal_id: Option<String>,
    capture: State<'_, SessionCapture>,
    app_handle: AppHandle,
) -> String {
    let session_id = capture.record_auto_event(event, terminal_id.clone());
    let _ = capture.save_session(&session_id);
    let _ = app_handle.emit(
        "session-event-recorded",
        SessionEventPayload {
            session_id: session_id.clone(),
            terminal_id,
        },
    );
    session_id
}

#[tauri::command]
pub fn get_active_session_id(capture: State<'_, SessionCapture>) -> Option<String> {
    capture.get_active_session_id()
}

#[tauri::command]
pub fn get_active_session_id_for_terminal(
    terminal_id: String,
    capture: State<'_, SessionCapture>,
) -> Option<String> {
    capture.get_active_session_id_for_terminal(&terminal_id)
}

#[tauri::command]
pub fn close_terminal_session(
    terminal_id: String,
    capture: State<'_, SessionCapture>,
) {
    capture.close_sessions_for_terminal(&terminal_id);
}

#[tauri::command]
pub fn list_sessions(capture: State<'_, SessionCapture>) -> Vec<SessionSummary> {
    capture.list_sessions()
}

#[tauri::command]
pub fn list_sessions_for_terminal(
    terminal_id: Option<String>,
    capture: State<'_, SessionCapture>,
) -> Vec<SessionSummary> {
    capture.list_sessions_for_terminal(terminal_id)
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

// ── Helpers ─────────────────────────────────────────────────────────────

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
