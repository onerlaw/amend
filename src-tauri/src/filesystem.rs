use crate::error::impl_serialize_as_string;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use git2::Repository;
use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum FileSystemError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Path not found: {0}")]
    NotFound(String),
    #[error("Invalid path: {0}")]
    InvalidPath(String),
}

impl_serialize_as_string!(FileSystemError);

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

#[derive(Default)]
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
            .git_ignore(false)
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
pub fn read_file_base64(
    state: tauri::State<'_, FileSystemManager>,
    path: String,
) -> Result<String, FileSystemError> {
    state.read_file_base64(&path)
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
pub fn search_files(
    state: tauri::State<'_, FileSystemManager>,
    root_path: String,
    query: String,
    search_content: bool,
) -> Result<Vec<SearchResult>, FileSystemError> {
    state.search_files(&root_path, &query, search_content)
}

#[tauri::command]
pub fn rename_entry(
    state: tauri::State<'_, FileSystemManager>,
    old_path: String,
    new_path: String,
) -> Result<(), FileSystemError> {
    state.rename_entry(&old_path, &new_path)
}

#[tauri::command]
pub fn delete_file(
    state: tauri::State<'_, FileSystemManager>,
    path: String,
) -> Result<(), FileSystemError> {
    state.delete_file(&path)
}

#[tauri::command]
pub fn delete_directory(
    state: tauri::State<'_, FileSystemManager>,
    path: String,
) -> Result<(), FileSystemError> {
    state.delete_directory(&path)
}

#[tauri::command]
pub fn reveal_in_file_manager(path: String) -> Result<(), FileSystemError> {
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
}

#[tauri::command]
pub fn copy_entry(
    state: tauri::State<'_, FileSystemManager>,
    src: String,
    dest: String,
) -> Result<(), FileSystemError> {
    state.copy_entry(&src, &dest)
}

#[tauri::command]
pub fn move_entry(
    state: tauri::State<'_, FileSystemManager>,
    src: String,
    dest: String,
) -> Result<(), FileSystemError> {
    state.move_entry(&src, &dest)
}

#[tauri::command]
pub fn get_clipboard_file_paths() -> Vec<String> {
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
}
