use ignore::WalkBuilder;
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum FileSystemError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Path not found: {0}")]
    NotFound(String),
    #[error("Watch error: {0}")]
    Watch(String),
}

impl Serialize for FileSystemError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub is_symlink: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileEntry>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileChangeEvent {
    pub path: String,
    pub kind: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub path: String,
    pub name: String,
    pub match_type: String,
    pub line_number: Option<u32>,
    pub line_content: Option<String>,
}

pub struct FileSystemManager {
    watchers: Arc<Mutex<HashMap<String, RecommendedWatcher>>>,
}

impl Default for FileSystemManager {
    fn default() -> Self {
        Self::new()
    }
}

impl FileSystemManager {
    pub fn new() -> Self {
        Self {
            watchers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn read_directory(&self, path: &str) -> Result<Vec<FileEntry>, FileSystemError> {
        let path = Path::new(path);
        if !path.exists() {
            return Err(FileSystemError::NotFound(path.display().to_string()));
        }

        let mut entries = Vec::new();
        let walker = WalkBuilder::new(path)
            .max_depth(Some(1))
            .hidden(false)
            .git_ignore(true)
            .build();

        for entry in walker.flatten() {
            let entry_path = entry.path();
            if entry_path == path {
                continue;
            }

            let metadata = entry_path.metadata()?;
            let name = entry_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();

            entries.push(FileEntry {
                name,
                path: entry_path.display().to_string(),
                is_directory: metadata.is_dir(),
                is_symlink: metadata.is_symlink(),
                children: None,
            });
        }

        // Sort: directories first, then alphabetically
        entries.sort_by(|a, b| {
            match (a.is_directory, b.is_directory) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
            }
        });

        Ok(entries)
    }

    pub fn read_file(&self, path: &str) -> Result<String, FileSystemError> {
        let path = Path::new(path);
        if !path.exists() {
            return Err(FileSystemError::NotFound(path.display().to_string()));
        }
        Ok(fs::read_to_string(path)?)
    }

    pub fn write_file(&self, path: &str, contents: &str) -> Result<(), FileSystemError> {
        fs::write(path, contents)?;
        Ok(())
    }

    pub fn watch_directory(
        &self,
        app_handle: &AppHandle,
        path: &str,
    ) -> Result<(), FileSystemError> {
        let path_string = path.to_string();
        let app_handle_clone = app_handle.clone();

        let mut watcher = RecommendedWatcher::new(
            move |res: Result<notify::Event, notify::Error>| {
                if let Ok(event) = res {
                    let kind = match event.kind {
                        notify::EventKind::Create(_) => "create",
                        notify::EventKind::Modify(_) => "modify",
                        notify::EventKind::Remove(_) => "remove",
                        _ => return,
                    };

                    for path in event.paths {
                        let change = FileChangeEvent {
                            path: path.display().to_string(),
                            kind: kind.to_string(),
                        };
                        let _ = app_handle_clone.emit("file-change", change);
                    }
                }
            },
            Config::default(),
        )
        .map_err(|e| FileSystemError::Watch(e.to_string()))?;

        watcher
            .watch(Path::new(path), RecursiveMode::Recursive)
            .map_err(|e| FileSystemError::Watch(e.to_string()))?;

        self.watchers.lock().insert(path_string, watcher);
        Ok(())
    }

    pub fn unwatch_directory(&self, path: &str) -> Result<(), FileSystemError> {
        self.watchers.lock().remove(path);
        Ok(())
    }

    pub fn search_files(
        &self,
        root_path: &str,
        query: &str,
        search_content: bool,
    ) -> Result<Vec<SearchResult>, FileSystemError> {
        let path = Path::new(root_path);
        if !path.exists() {
            return Err(FileSystemError::NotFound(path.display().to_string()));
        }

        let query_lower = query.to_lowercase();
        let mut filename_matches = Vec::new();
        let mut content_matches = Vec::new();
        const MAX_RESULTS: usize = 50;

        let walker = WalkBuilder::new(path)
            .hidden(false)
            .git_ignore(true)
            .build();

        for entry in walker.flatten() {
            if filename_matches.len() + content_matches.len() >= MAX_RESULTS {
                break;
            }

            let entry_path = entry.path();
            if entry_path == path {
                continue;
            }

            let metadata = match entry_path.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };

            if metadata.is_dir() {
                continue;
            }

            let name = entry_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();

            // Check filename match
            if name.to_lowercase().contains(&query_lower) {
                filename_matches.push(SearchResult {
                    path: entry_path.display().to_string(),
                    name: name.clone(),
                    match_type: "filename".to_string(),
                    line_number: None,
                    line_content: None,
                });
            }

            // Check content match if enabled
            if search_content && filename_matches.len() + content_matches.len() < MAX_RESULTS {
                if let Ok(content) = fs::read_to_string(entry_path) {
                    for (line_num, line) in content.lines().enumerate() {
                        if line.to_lowercase().contains(&query_lower) {
                            content_matches.push(SearchResult {
                                path: entry_path.display().to_string(),
                                name: name.clone(),
                                match_type: "content".to_string(),
                                line_number: Some((line_num + 1) as u32),
                                line_content: Some(line.trim().to_string()),
                            });

                            if filename_matches.len() + content_matches.len() >= MAX_RESULTS {
                                break;
                            }
                        }
                    }
                }
            }
        }

        // Return filename matches first, then content matches
        filename_matches.extend(content_matches);
        Ok(filename_matches)
    }
}

// Tauri commands
#[tauri::command]
pub fn read_directory(
    state: tauri::State<'_, FileSystemManager>,
    path: String,
) -> Result<Vec<FileEntry>, FileSystemError> {
    state.read_directory(&path)
}

#[tauri::command]
pub fn read_file(
    state: tauri::State<'_, FileSystemManager>,
    path: String,
) -> Result<String, FileSystemError> {
    state.read_file(&path)
}

#[tauri::command]
pub fn write_file(
    state: tauri::State<'_, FileSystemManager>,
    path: String,
    contents: String,
) -> Result<(), FileSystemError> {
    state.write_file(&path, &contents)
}

#[tauri::command]
pub fn watch_directory(
    app_handle: AppHandle,
    state: tauri::State<'_, FileSystemManager>,
    path: String,
) -> Result<(), FileSystemError> {
    state.watch_directory(&app_handle, &path)
}

#[tauri::command]
pub fn unwatch_directory(
    state: tauri::State<'_, FileSystemManager>,
    path: String,
) -> Result<(), FileSystemError> {
    state.unwatch_directory(&path)
}

#[tauri::command]
pub fn search_files(
    state: tauri::State<'_, FileSystemManager>,
    root_path: String,
    query: String,
    search_content: bool,
) -> Result<Vec<SearchResult>, FileSystemError> {
    state.search_files(&root_path, &query, search_content)
}
