use crate::error::impl_serialize_as_string;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use git2::Repository;
use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use thiserror::Error;
use tokio::task::spawn_blocking;

#[derive(Error, Debug)]
pub enum FileSystemError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Path not found: {0}")]
    NotFound(String),
    #[error("Invalid path: {0}")]
    InvalidPath(String),
    #[error("Search cancelled")]
    SearchCancelled,
}

impl_serialize_as_string!(FileSystemError);

/// Tracks the latest search generation so stale searches abort early.
#[derive(Clone)]
pub struct SearchGeneration(Arc<AtomicU64>);

impl SearchGeneration {
    pub fn new() -> Self {
        Self(Arc::new(AtomicU64::new(0)))
    }

    /// Increment and return the new generation ID.
    fn next(&self) -> u64 {
        self.0.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Return the current generation ID.
    fn current(&self) -> u64 {
        self.0.load(Ordering::SeqCst)
    }
}

/// Validate that a path is absolute and contains no `..` components.
fn validate_path(path: &str) -> Result<PathBuf, FileSystemError> {
    let p = PathBuf::from(path);
    if !p.is_absolute() {
        return Err(FileSystemError::InvalidPath(format!(
            "path must be absolute: {}",
            path
        )));
    }
    for component in p.components() {
        if let std::path::Component::ParentDir = component {
            return Err(FileSystemError::InvalidPath(format!(
                "path must not contain '..': {}",
                path
            )));
        }
    }
    Ok(p)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub is_symlink: bool,
    pub is_gitignored: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileEntry>>,
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

#[derive(Default, Clone)]
pub struct FileSystemManager;

impl FileSystemManager {
    pub fn new() -> Self {
        Self
    }

    pub fn read_directory(&self, path: &str) -> Result<Vec<FileEntry>, FileSystemError> {
        let path = validate_path(path)?;
        if !path.exists() {
            return Err(FileSystemError::NotFound(path.display().to_string()));
        }

        let repo = Repository::discover(&path).ok();

        let mut entries = Vec::new();
        let walker = WalkBuilder::new(&path)
            .max_depth(Some(1))
            .hidden(false)
            .git_ignore(false)
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

            let is_gitignored = repo
                .as_ref()
                .and_then(|r| r.status_should_ignore(entry_path).ok())
                .unwrap_or(false);

            entries.push(FileEntry {
                name,
                path: entry_path.display().to_string(),
                is_directory: metadata.is_dir(),
                is_symlink: metadata.is_symlink(),
                is_gitignored,
                children: None,
            });
        }

        // Sort: directories first, then alphabetically
        entries.sort_by(|a, b| match (a.is_directory, b.is_directory) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        });

        Ok(entries)
    }

    pub fn read_file(&self, path: &str) -> Result<String, FileSystemError> {
        let path = validate_path(path)?;
        if !path.exists() {
            return Err(FileSystemError::NotFound(path.display().to_string()));
        }
        Ok(fs::read_to_string(&path)?)
    }

    pub fn read_file_base64(&self, path: &str) -> Result<String, FileSystemError> {
        let path = validate_path(path)?;
        if !path.exists() {
            return Err(FileSystemError::NotFound(path.display().to_string()));
        }
        let bytes = fs::read(&path)?;
        Ok(STANDARD.encode(&bytes))
    }

    pub fn write_file(&self, path: &str, contents: &str) -> Result<(), FileSystemError> {
        validate_path(path)?;
        fs::write(path, contents)?;
        Ok(())
    }

    pub fn search_files(
        &self,
        root_path: &str,
        query: &str,
        search_content: bool,
        generation: &SearchGeneration,
        my_gen: u64,
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
            // Abort early if a newer search has been issued
            if generation.current() != my_gen {
                return Err(FileSystemError::SearchCancelled);
            }

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

            // Check content match if enabled (skip files >1MB for performance)
            if search_content && filename_matches.len() + content_matches.len() < MAX_RESULTS {
                if metadata.len() > 1_048_576 {
                    continue;
                }
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

    pub fn rename_entry(&self, old_path: &str, new_path: &str) -> Result<(), FileSystemError> {
        validate_path(old_path)?;
        validate_path(new_path)?;
        let old = Path::new(old_path);
        if !old.exists() {
            return Err(FileSystemError::NotFound(old_path.to_string()));
        }
        fs::rename(old_path, new_path)?;
        Ok(())
    }

    pub fn delete_file(&self, path: &str) -> Result<(), FileSystemError> {
        validate_path(path)?;
        let p = Path::new(path);
        if !p.exists() {
            return Err(FileSystemError::NotFound(path.to_string()));
        }
        fs::remove_file(path)?;
        Ok(())
    }

    pub fn delete_directory(&self, path: &str) -> Result<(), FileSystemError> {
        validate_path(path)?;
        let p = Path::new(path);
        if !p.exists() {
            return Err(FileSystemError::NotFound(path.to_string()));
        }
        fs::remove_dir_all(path)?;
        Ok(())
    }

    pub fn copy_entry(&self, src: &str, dest: &str) -> Result<(), FileSystemError> {
        validate_path(src)?;
        validate_path(dest)?;
        let src_path = Path::new(src);
        if !src_path.exists() {
            return Err(FileSystemError::NotFound(src.to_string()));
        }

        if src_path.is_dir() {
            self.copy_dir_recursive(src_path, Path::new(dest))?;
        } else {
            fs::copy(src, dest)?;
        }
        Ok(())
    }

    fn copy_dir_recursive(&self, src: &Path, dest: &Path) -> Result<(), FileSystemError> {
        fs::create_dir_all(dest)?;
        for entry in fs::read_dir(src)? {
            let entry = entry?;
            let src_path = entry.path();
            let dest_path = dest.join(entry.file_name());

            if src_path.is_dir() {
                self.copy_dir_recursive(&src_path, &dest_path)?;
            } else {
                fs::copy(&src_path, &dest_path)?;
            }
        }
        Ok(())
    }

    pub fn move_entry(&self, src: &str, dest: &str) -> Result<(), FileSystemError> {
        validate_path(src)?;
        validate_path(dest)?;
        let src_path = Path::new(src);
        if !src_path.exists() {
            return Err(FileSystemError::NotFound(src.to_string()));
        }
        fs::rename(src, dest)?;
        Ok(())
    }
}

// Tauri commands
#[tauri::command]
pub async fn read_directory(
    state: tauri::State<'_, FileSystemManager>,
    path: String,
) -> Result<Vec<FileEntry>, FileSystemError> {
    let mgr = state.inner().clone();
    spawn_blocking(move || mgr.read_directory(&path))
        .await
        .unwrap()
}

#[tauri::command]
pub async fn read_directories(
    state: tauri::State<'_, FileSystemManager>,
    paths: Vec<String>,
) -> Result<Vec<Vec<FileEntry>>, FileSystemError> {
    let mgr = state.inner().clone();
    spawn_blocking(move || {
        paths
            .iter()
            .map(|p| mgr.read_directory(p))
            .collect::<Result<Vec<_>, _>>()
    })
    .await
    .unwrap()
}

#[tauri::command]
pub async fn read_file(
    state: tauri::State<'_, FileSystemManager>,
    path: String,
) -> Result<String, FileSystemError> {
    let mgr = state.inner().clone();
    spawn_blocking(move || mgr.read_file(&path)).await.unwrap()
}

#[tauri::command]
pub async fn read_file_base64(
    state: tauri::State<'_, FileSystemManager>,
    path: String,
) -> Result<String, FileSystemError> {
    let mgr = state.inner().clone();
    spawn_blocking(move || mgr.read_file_base64(&path))
        .await
        .unwrap()
}

#[tauri::command]
pub async fn write_file(
    state: tauri::State<'_, FileSystemManager>,
    path: String,
    contents: String,
) -> Result<(), FileSystemError> {
    let mgr = state.inner().clone();
    spawn_blocking(move || mgr.write_file(&path, &contents))
        .await
        .unwrap()
}

#[tauri::command]
pub async fn search_files(
    state: tauri::State<'_, FileSystemManager>,
    generation: tauri::State<'_, SearchGeneration>,
    root_path: String,
    query: String,
    search_content: bool,
) -> Result<Vec<SearchResult>, FileSystemError> {
    let mgr = state.inner().clone();
    let gen = generation.inner().clone();
    let my_gen = gen.next();
    spawn_blocking(move || mgr.search_files(&root_path, &query, search_content, &gen, my_gen))
        .await
        .unwrap()
}

#[tauri::command]
pub async fn rename_entry(
    state: tauri::State<'_, FileSystemManager>,
    old_path: String,
    new_path: String,
) -> Result<(), FileSystemError> {
    let mgr = state.inner().clone();
    spawn_blocking(move || mgr.rename_entry(&old_path, &new_path))
        .await
        .unwrap()
}

#[tauri::command]
pub async fn delete_file(
    state: tauri::State<'_, FileSystemManager>,
    path: String,
) -> Result<(), FileSystemError> {
    let mgr = state.inner().clone();
    spawn_blocking(move || mgr.delete_file(&path))
        .await
        .unwrap()
}

#[tauri::command]
pub async fn delete_directory(
    state: tauri::State<'_, FileSystemManager>,
    path: String,
) -> Result<(), FileSystemError> {
    let mgr = state.inner().clone();
    spawn_blocking(move || mgr.delete_directory(&path))
        .await
        .unwrap()
}

#[tauri::command]
pub async fn reveal_in_file_manager(path: String) -> Result<(), FileSystemError> {
    spawn_blocking(move || {
        let p = Path::new(&path);
        if !p.exists() {
            return Err(FileSystemError::NotFound(path.clone()));
        }

        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open")
                .args(["-R", &path])
                .spawn()
                .map_err(FileSystemError::Io)?;
        }

        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("explorer")
                .args(["/select,", &path])
                .spawn()
                .map_err(FileSystemError::Io)?;
        }

        #[cfg(target_os = "linux")]
        {
            let parent = p.parent().unwrap_or(p);
            std::process::Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(FileSystemError::Io)?;
        }

        Ok(())
    })
    .await
    .unwrap()
}

#[tauri::command]
pub async fn copy_entry(
    state: tauri::State<'_, FileSystemManager>,
    src: String,
    dest: String,
) -> Result<(), FileSystemError> {
    let mgr = state.inner().clone();
    spawn_blocking(move || mgr.copy_entry(&src, &dest))
        .await
        .unwrap()
}

#[tauri::command]
pub async fn move_entry(
    state: tauri::State<'_, FileSystemManager>,
    src: String,
    dest: String,
) -> Result<(), FileSystemError> {
    let mgr = state.inner().clone();
    spawn_blocking(move || mgr.move_entry(&src, &dest))
        .await
        .unwrap()
}

#[tauri::command]
pub async fn get_clipboard_file_paths() -> Vec<String> {
    spawn_blocking(|| {
        #[cfg(target_os = "macos")]
        {
            let script = r#"
use framework "AppKit"
set pb to current application's NSPasteboard's generalPasteboard()
set urls to pb's readObjectsForClasses:{current application's NSURL} options:(missing value)
if urls is missing value then return ""
set paths to {}
repeat with u in urls
    if (u's isFileURL() as boolean) then
        set end of paths to (u's |path|() as text)
    end if
end repeat
set AppleScript's text item delimiters to linefeed
return paths as text
"#;
            match std::process::Command::new("osascript")
                .args(["-l", "AppleScript", "-e", script])
                .output()
            {
                Ok(output) => {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    stdout
                        .trim()
                        .lines()
                        .filter(|l| !l.is_empty())
                        .map(|l| l.to_string())
                        .collect()
                }
                Err(_) => Vec::new(),
            }
        }

        #[cfg(not(target_os = "macos"))]
        {
            Vec::new()
        }
    })
    .await
    .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    mod validate_path_tests {
        use super::*;

        #[test]
        fn accepts_absolute_path() {
            let result = validate_path("/home/user/project");
            assert!(result.is_ok());
            assert_eq!(result.unwrap(), PathBuf::from("/home/user/project"));
        }

        #[test]
        fn rejects_relative_path() {
            let result = validate_path("relative/path");
            assert!(result.is_err());
            match result.unwrap_err() {
                FileSystemError::InvalidPath(msg) => {
                    assert!(msg.contains("must be absolute"));
                }
                other => panic!("Expected InvalidPath, got {:?}", other),
            }
        }

        #[test]
        fn rejects_path_with_parent_traversal() {
            let result = validate_path("/home/user/../etc/passwd");
            assert!(result.is_err());
            match result.unwrap_err() {
                FileSystemError::InvalidPath(msg) => {
                    assert!(msg.contains("must not contain '..'"));
                }
                other => panic!("Expected InvalidPath, got {:?}", other),
            }
        }

        #[test]
        fn accepts_path_with_dots_in_names() {
            // ".hidden" is a normal component, not a parent dir reference
            let result = validate_path("/home/user/.hidden/file.txt");
            assert!(result.is_ok());
        }

        #[test]
        fn rejects_bare_relative_path() {
            let result = validate_path("file.txt");
            assert!(result.is_err());
        }

        #[test]
        fn accepts_root_path() {
            let result = validate_path("/");
            assert!(result.is_ok());
        }

        #[test]
        fn rejects_dot_dot_at_start() {
            let result = validate_path("/../etc");
            assert!(result.is_err());
        }

        #[test]
        fn accepts_path_with_current_dir_component() {
            // "." (current dir) is allowed, only ".." is blocked
            let result = validate_path("/home/./user");
            assert!(result.is_ok());
        }
    }
}
