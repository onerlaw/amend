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
    #[error("Task failed: {0}")]
    TaskJoin(String),
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

/// Sensitive system directories that must never be targets of mutation operations.
const SENSITIVE_PREFIXES: &[&str] = &[
    "/etc",
    "/System",
    "/usr",
    "/bin",
    "/sbin",
    "/Library",
    "/var",
    "/private/etc",
    "/private/var",
    // Windows paths (for cross-platform safety)
    "C:\\Windows",
    "C:\\Program Files",
    "C:\\Program Files (x86)",
];

/// Check whether a path falls inside any sensitive system directory.
fn is_sensitive_path(p: &Path) -> bool {
    let path_str = p.to_string_lossy();
    for prefix in SENSITIVE_PREFIXES {
        if path_str.starts_with(prefix)
            && (path_str.len() == prefix.len()
                || path_str.as_bytes().get(prefix.len()) == Some(&b'/'))
        {
            return true;
        }
    }
    false
}

/// Validate a path for mutation operations (write, delete, copy, move, rename).
/// Canonicalizes the path to resolve symlinks and then verifies it does not
/// land inside a sensitive system directory.
fn validate_mutation_path(path: &str) -> Result<PathBuf, FileSystemError> {
    let p = validate_path(path)?;

    // First, check the literal path against sensitive prefixes
    if is_sensitive_path(&p) {
        return Err(FileSystemError::InvalidPath(format!(
            "refusing to mutate sensitive system path: {}",
            path
        )));
    }

    // Canonicalize to resolve symlinks and re-check. For paths that don't exist
    // yet (e.g. write to new file), canonicalize the parent directory.
    let canonical = if p.exists() {
        p.canonicalize()
            .map_err(|e| FileSystemError::InvalidPath(format!("failed to resolve path: {}", e)))?
    } else if let Some(parent) = p.parent() {
        if parent.exists() {
            let canonical_parent = parent.canonicalize().map_err(|e| {
                FileSystemError::InvalidPath(format!("failed to resolve parent directory: {}", e))
            })?;
            let file_name = p
                .file_name()
                .ok_or_else(|| FileSystemError::InvalidPath(format!("invalid path: {}", path)))?;
            canonical_parent.join(file_name)
        } else {
            // Parent doesn't exist either; literal path is fine since nothing to resolve
            p.clone()
        }
    } else {
        p.clone()
    };

    if is_sensitive_path(&canonical) {
        return Err(FileSystemError::InvalidPath(format!(
            "refusing to mutate sensitive system path (resolves to {}): {}",
            canonical.display(),
            path
        )));
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

/// Case-insensitive substring search at the byte level.
/// `needle` must already be lowercase ASCII. Avoids allocating a new
/// lowercased String for every line we scan.
#[inline]
fn contains_case_insensitive(haystack: &[u8], needle: &[u8]) -> bool {
    if needle.is_empty() {
        return true;
    }
    if haystack.len() < needle.len() {
        return false;
    }
    let limit = haystack.len() - needle.len();
    'outer: for i in 0..=limit {
        for j in 0..needle.len() {
            if haystack[i + j].to_ascii_lowercase() != needle[j] {
                continue 'outer;
            }
        }
        return true;
    }
    false
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
            .git_global(false)
            .git_exclude(false)
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

    pub fn get_file_size(&self, path: &str) -> Result<u64, FileSystemError> {
        let path = validate_path(path)?;
        if !path.exists() {
            return Err(FileSystemError::NotFound(path.display().to_string()));
        }
        let metadata = fs::metadata(&path)?;
        Ok(metadata.len())
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
        validate_mutation_path(path)?;
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
        let query_lower_bytes = query_lower.as_bytes();
        let mut filename_matches = Vec::new();
        let mut content_matches = Vec::new();
        const MAX_RESULTS: usize = 200;

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
                        if contains_case_insensitive(line.as_bytes(), query_lower_bytes) {
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
        validate_mutation_path(old_path)?;
        validate_mutation_path(new_path)?;
        let old = Path::new(old_path);
        if !old.exists() {
            return Err(FileSystemError::NotFound(old_path.to_string()));
        }
        fs::rename(old_path, new_path)?;
        Ok(())
    }

    pub fn delete_file(&self, path: &str) -> Result<(), FileSystemError> {
        validate_mutation_path(path)?;
        let p = Path::new(path);
        if !p.exists() {
            return Err(FileSystemError::NotFound(path.to_string()));
        }
        fs::remove_file(path)?;
        Ok(())
    }

    pub fn delete_directory(&self, path: &str) -> Result<(), FileSystemError> {
        validate_mutation_path(path)?;
        let p = Path::new(path);
        if !p.exists() {
            return Err(FileSystemError::NotFound(path.to_string()));
        }
        fs::remove_dir_all(path)?;
        Ok(())
    }

    pub fn copy_entry(&self, src: &str, dest: &str) -> Result<(), FileSystemError> {
        validate_mutation_path(src)?;
        validate_mutation_path(dest)?;
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

            // Use symlink_metadata to detect symlinks without following them
            let meta = fs::symlink_metadata(&src_path)?;
            if meta.is_symlink() {
                // Resolve the symlink target and verify it doesn't escape to a sensitive path
                let resolved = src_path.canonicalize().map_err(|e| {
                    FileSystemError::InvalidPath(format!(
                        "failed to resolve symlink {}: {}",
                        src_path.display(),
                        e
                    ))
                })?;
                if is_sensitive_path(&resolved) {
                    return Err(FileSystemError::InvalidPath(format!(
                        "symlink {} resolves to sensitive path {}",
                        src_path.display(),
                        resolved.display()
                    )));
                }
                // Copy the resolved target, not the symlink itself
                if resolved.is_dir() {
                    self.copy_dir_recursive(&resolved, &dest_path)?;
                } else {
                    fs::copy(&resolved, &dest_path)?;
                }
            } else if meta.is_dir() {
                self.copy_dir_recursive(&src_path, &dest_path)?;
            } else {
                fs::copy(&src_path, &dest_path)?;
            }
        }
        Ok(())
    }

    pub fn create_directory(&self, path: &str) -> Result<(), FileSystemError> {
        validate_mutation_path(path)?;
        fs::create_dir_all(path)?;
        Ok(())
    }

    pub fn move_entry(&self, src: &str, dest: &str) -> Result<(), FileSystemError> {
        validate_mutation_path(src)?;
        validate_mutation_path(dest)?;
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
        .map_err(|e| FileSystemError::TaskJoin(e.to_string()))?
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
    .map_err(|e| FileSystemError::TaskJoin(e.to_string()))?
}

#[tauri::command]
pub async fn read_file(
    state: tauri::State<'_, FileSystemManager>,
    path: String,
) -> Result<String, FileSystemError> {
    let mgr = state.inner().clone();
    spawn_blocking(move || mgr.read_file(&path))
        .await
        .map_err(|e| FileSystemError::TaskJoin(e.to_string()))?
}

#[tauri::command]
pub async fn read_file_base64(
    state: tauri::State<'_, FileSystemManager>,
    path: String,
) -> Result<String, FileSystemError> {
    let mgr = state.inner().clone();
    spawn_blocking(move || mgr.read_file_base64(&path))
        .await
        .map_err(|e| FileSystemError::TaskJoin(e.to_string()))?
}

#[tauri::command]
pub async fn get_file_size(
    state: tauri::State<'_, FileSystemManager>,
    path: String,
) -> Result<u64, FileSystemError> {
    let mgr = state.inner().clone();
    spawn_blocking(move || mgr.get_file_size(&path))
        .await
        .map_err(|e| FileSystemError::TaskJoin(e.to_string()))?
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
        .map_err(|e| FileSystemError::TaskJoin(e.to_string()))?
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
        .map_err(|e| FileSystemError::TaskJoin(e.to_string()))?
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
        .map_err(|e| FileSystemError::TaskJoin(e.to_string()))?
}

#[tauri::command]
pub async fn delete_file(
    state: tauri::State<'_, FileSystemManager>,
    path: String,
) -> Result<(), FileSystemError> {
    let mgr = state.inner().clone();
    spawn_blocking(move || mgr.delete_file(&path))
        .await
        .map_err(|e| FileSystemError::TaskJoin(e.to_string()))?
}

#[tauri::command]
pub async fn delete_directory(
    state: tauri::State<'_, FileSystemManager>,
    path: String,
) -> Result<(), FileSystemError> {
    let mgr = state.inner().clone();
    spawn_blocking(move || mgr.delete_directory(&path))
        .await
        .map_err(|e| FileSystemError::TaskJoin(e.to_string()))?
}

#[tauri::command]
pub async fn create_directory(
    state: tauri::State<'_, FileSystemManager>,
    path: String,
) -> Result<(), FileSystemError> {
    let mgr = state.inner().clone();
    spawn_blocking(move || mgr.create_directory(&path))
        .await
        .map_err(|e| FileSystemError::TaskJoin(e.to_string()))?
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
    .map_err(|e| FileSystemError::TaskJoin(e.to_string()))?
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
        .map_err(|e| FileSystemError::TaskJoin(e.to_string()))?
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
        .map_err(|e| FileSystemError::TaskJoin(e.to_string()))?
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
    .unwrap_or_default()
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

    mod validate_mutation_path_tests {
        use super::*;

        #[test]
        fn rejects_etc() {
            let result = validate_mutation_path("/etc/passwd");
            assert!(result.is_err());
            match result.unwrap_err() {
                FileSystemError::InvalidPath(msg) => {
                    assert!(msg.contains("sensitive system path"));
                }
                other => panic!("Expected InvalidPath, got {:?}", other),
            }
        }

        #[test]
        fn rejects_system() {
            assert!(validate_mutation_path("/System/Library/file").is_err());
        }

        #[test]
        fn rejects_usr() {
            assert!(validate_mutation_path("/usr/local/bin/tool").is_err());
        }

        #[test]
        fn rejects_bin() {
            assert!(validate_mutation_path("/bin/sh").is_err());
        }

        #[test]
        fn rejects_sbin() {
            assert!(validate_mutation_path("/sbin/mount").is_err());
        }

        #[test]
        fn rejects_library() {
            assert!(validate_mutation_path("/Library/Preferences/file").is_err());
        }

        #[test]
        fn rejects_var() {
            assert!(validate_mutation_path("/var/log/syslog").is_err());
        }

        #[test]
        fn rejects_private_etc() {
            assert!(validate_mutation_path("/private/etc/hosts").is_err());
        }

        #[test]
        fn accepts_user_home_path() {
            assert!(validate_mutation_path("/Users/dev/project/file.txt").is_ok());
        }

        #[test]
        fn accepts_tmp_path() {
            assert!(validate_mutation_path("/tmp/scratch/file.txt").is_ok());
        }

        #[test]
        fn does_not_false_positive_on_prefix_substring() {
            // "/etcetera" should NOT be blocked by "/etc" prefix
            assert!(validate_mutation_path("/etcetera/file.txt").is_ok());
        }

        #[test]
        fn rejects_exact_sensitive_dir() {
            assert!(validate_mutation_path("/etc").is_err());
        }

        #[test]
        fn still_rejects_traversal() {
            assert!(validate_mutation_path("/home/user/../etc/passwd").is_err());
        }

        #[test]
        fn still_rejects_relative() {
            assert!(validate_mutation_path("relative/path").is_err());
        }

        #[test]
        #[cfg(unix)]
        fn rejects_symlink_to_sensitive_path() {
            // Create a symlink inside a temp dir that points to /usr/bin
            let dir = tempfile::tempdir().expect("failed to create temp dir");
            let link = dir.path().join("escape_link");
            std::os::unix::fs::symlink("/usr/bin", &link).unwrap();

            let link_str = link.to_string_lossy().to_string();
            // The symlink itself exists, so canonicalize resolves it to /usr/bin
            let result = validate_mutation_path(&link_str);
            assert!(result.is_err(), "expected Err, got {:?}", result);
            let err_msg = format!("{}", result.unwrap_err());
            assert!(
                err_msg.contains("sensitive system path"),
                "unexpected error: {}",
                err_msg
            );
        }

        #[test]
        #[cfg(unix)]
        fn rejects_symlink_child_to_sensitive_path() {
            // Create a symlink inside a temp dir that points to /etc
            let dir = tempfile::tempdir().expect("failed to create temp dir");
            let link = dir.path().join("etc_link");
            std::os::unix::fs::symlink("/etc", &link).unwrap();

            // Try to write through the symlink to a child path
            let target = format!("{}/passwd", link.to_string_lossy());
            let result = validate_mutation_path(&target);
            assert!(result.is_err(), "expected Err, got {:?}", result);
        }

        #[test]
        #[cfg(unix)]
        fn accepts_symlink_to_safe_path() {
            // Use a directory under the user home to avoid macOS /tmp -> /private/var resolution
            let home = std::env::var("HOME").expect("HOME not set");
            let test_base = PathBuf::from(&home).join(".amend_test_symlink_safe");
            let _ = std::fs::remove_dir_all(&test_base);
            std::fs::create_dir_all(&test_base).unwrap();

            let safe_dir = test_base.join("safe_target");
            std::fs::create_dir(&safe_dir).unwrap();

            let link = test_base.join("safe_link");
            std::os::unix::fs::symlink(&safe_dir, &link).unwrap();

            let file_path = format!("{}/file.txt", link.to_string_lossy());
            let result = validate_mutation_path(&file_path);

            // Clean up before asserting
            let _ = std::fs::remove_dir_all(&test_base);

            assert!(result.is_ok(), "expected Ok, got {:?}", result);
        }
    }

    mod copy_dir_symlink_tests {
        use super::*;

        #[test]
        #[cfg(unix)]
        fn copy_dir_recursive_rejects_symlink_to_sensitive_path() {
            let mgr = FileSystemManager::new();
            let dir = tempfile::tempdir().expect("failed to create temp dir");
            let src = dir.path().join("src_dir");
            std::fs::create_dir(&src).unwrap();

            // Create a symlink inside src that points to /usr
            let link = src.join("usr_link");
            std::os::unix::fs::symlink("/usr", &link).unwrap();

            let dest = dir.path().join("dest_dir");
            let result = mgr.copy_dir_recursive(&src, &dest);
            assert!(result.is_err(), "expected Err, got {:?}", result);
            let err_msg = format!("{}", result.unwrap_err());
            assert!(
                err_msg.contains("sensitive path"),
                "unexpected error: {}",
                err_msg
            );
        }

        #[test]
        #[cfg(unix)]
        fn copy_dir_recursive_follows_safe_symlink() {
            let mgr = FileSystemManager::new();
            // Use a directory under user home to avoid macOS /tmp -> /private/var resolution
            let home = std::env::var("HOME").expect("HOME not set");
            let test_base = PathBuf::from(&home).join(".amend_test_copy_symlink");
            let _ = std::fs::remove_dir_all(&test_base);
            std::fs::create_dir_all(&test_base).unwrap();

            let src = test_base.join("src_dir");
            std::fs::create_dir(&src).unwrap();

            // Create a real file and a symlink to it (both safe)
            let real_file = src.join("real.txt");
            std::fs::write(&real_file, "hello").unwrap();

            let safe_target = test_base.join("safe_target");
            std::fs::create_dir(&safe_target).unwrap();
            std::fs::write(safe_target.join("data.txt"), "world").unwrap();

            let link = src.join("safe_link");
            std::os::unix::fs::symlink(&safe_target, &link).unwrap();

            let dest = test_base.join("dest_dir");
            let result = mgr.copy_dir_recursive(&src, &dest);

            // Verify before cleanup
            let link_data_exists = dest.join("safe_link").join("data.txt").exists();
            let real_exists = dest.join("real.txt").exists();

            // Clean up
            let _ = std::fs::remove_dir_all(&test_base);

            assert!(result.is_ok(), "expected Ok, got {:?}", result);
            assert!(link_data_exists, "linked content should be copied");
            assert!(real_exists, "real file should be copied");
        }
    }

    mod mutation_symlink_safety_tests {
        use super::*;

        #[test]
        #[cfg(unix)]
        fn write_file_rejects_symlink_to_sensitive_path() {
            let dir = tempfile::tempdir().expect("failed to create temp dir");
            let link = dir.path().join("etc_link");
            std::os::unix::fs::symlink("/etc", &link).unwrap();

            let mgr = FileSystemManager::new();
            let target = format!("{}/evil.conf", link.to_string_lossy());
            let result = mgr.write_file(&target, "malicious");
            assert!(result.is_err(), "expected Err, got {:?}", result);
            let err_msg = format!("{}", result.unwrap_err());
            assert!(
                err_msg.contains("sensitive system path"),
                "unexpected error: {}",
                err_msg
            );
        }

        #[test]
        #[cfg(unix)]
        fn delete_file_rejects_symlink_to_sensitive_path() {
            let dir = tempfile::tempdir().expect("failed to create temp dir");
            let link = dir.path().join("usr_link");
            std::os::unix::fs::symlink("/usr", &link).unwrap();

            let mgr = FileSystemManager::new();
            let target = format!("{}/bin/ls", link.to_string_lossy());
            let result = mgr.delete_file(&target);
            assert!(result.is_err(), "expected Err, got {:?}", result);
        }

        #[test]
        #[cfg(unix)]
        fn rename_entry_rejects_symlink_dest_to_sensitive_path() {
            let dir = tempfile::tempdir().expect("failed to create temp dir");
            let src = dir.path().join("safe.txt");
            std::fs::write(&src, "data").unwrap();

            let link = dir.path().join("etc_link");
            std::os::unix::fs::symlink("/etc", &link).unwrap();

            let mgr = FileSystemManager::new();
            let dest = format!("{}/injected.conf", link.to_string_lossy());
            let result = mgr.rename_entry(src.to_str().unwrap(), &dest);
            assert!(result.is_err(), "expected Err, got {:?}", result);
        }

        #[test]
        #[cfg(unix)]
        fn move_entry_rejects_symlink_dest_to_sensitive_path() {
            let dir = tempfile::tempdir().expect("failed to create temp dir");
            let src = dir.path().join("safe.txt");
            std::fs::write(&src, "data").unwrap();

            let link = dir.path().join("var_link");
            std::os::unix::fs::symlink("/var", &link).unwrap();

            let mgr = FileSystemManager::new();
            let dest = format!("{}/injected.log", link.to_string_lossy());
            let result = mgr.move_entry(src.to_str().unwrap(), &dest);
            assert!(result.is_err(), "expected Err, got {:?}", result);
        }
    }
}
