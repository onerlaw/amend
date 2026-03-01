use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalMetadata {
    pub cwd: Option<String>,
    pub title: Option<String>,
    pub git_root: Option<String>,
    pub repo_name: Option<String>,
    pub main_repo_root: Option<String>,
    pub worktree_name: Option<String>,
}

pub struct TerminalMetadataStore {
    metadata: Arc<RwLock<HashMap<String, TerminalMetadata>>>,
}

impl TerminalMetadataStore {
    pub fn new() -> Self {
        Self {
            metadata: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn update(&self, id: &str, meta: TerminalMetadata) {
        self.metadata.write().await.insert(id.to_string(), meta);
    }

    pub async fn remove(&self, id: &str) {
        self.metadata.write().await.remove(id);
    }

    #[allow(dead_code)]
    pub async fn get(&self, id: &str) -> Option<TerminalMetadata> {
        self.metadata.read().await.get(id).cloned()
    }

    pub async fn all(&self) -> HashMap<String, TerminalMetadata> {
        self.metadata.read().await.clone()
    }
}

// Tauri commands

#[tauri::command]
pub async fn sync_terminal_metadata(
    id: String,
    metadata: TerminalMetadata,
    state: tauri::State<'_, TerminalMetadataStore>,
) -> Result<(), String> {
    state.update(&id, metadata).await;
    Ok(())
}

#[tauri::command]
pub async fn remove_terminal_metadata(
    id: String,
    state: tauri::State<'_, TerminalMetadataStore>,
) -> Result<(), String> {
    state.remove(&id).await;
    Ok(())
}
