use crate::error::impl_serialize_as_string;
use git2::{DiffOptions, Repository, Signature};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;
use tokio::task::spawn_blocking;

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

#[derive(Error, Debug)]
pub enum SnapshotError {
    #[error("Git error: {0}")]
    Git(#[from] git2::Error),
    #[error("Snapshot not found: {0}")]
    NotFound(String),
    #[error("Repository not found at: {0}")]
    NotARepo(String),
    #[error("Task failed: {0}")]
    TaskJoin(String),
    #[error("Snapshot error: {0}")]
    Other(String),
}

impl_serialize_as_string!(SnapshotError);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub id: String,
    pub label: String,
    pub timestamp: u64,
    pub commit_sha: String,
    pub repo_path: String,
    pub changed_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotFileDiff {
    pub path: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotDiff {
    pub old_content: String,
    pub new_content: String,
    pub is_binary: bool,
}

// ---------------------------------------------------------------------------
// Ref helpers
// ---------------------------------------------------------------------------

const SNAPSHOT_REF_PREFIX: &str = "refs/amend/snapshots/";

fn snapshot_ref(id: &str) -> String {
    format!("{}{}", SNAPSHOT_REF_PREFIX, id)
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ---------------------------------------------------------------------------
// Core logic (sync, runs inside spawn_blocking)
// ---------------------------------------------------------------------------

fn create_snapshot_sync(repo_path: &str, label: &str) -> Result<Snapshot, SnapshotError> {
    let repo = Repository::discover(repo_path)
        .map_err(|_| SnapshotError::NotARepo(repo_path.to_string()))?;

    let workdir = repo
        .workdir()
        .ok_or_else(|| SnapshotError::Other("Bare repository".into()))?
        .to_path_buf();

    // Build a temporary in-memory index containing ALL working-tree files
    let mut index = repo.index()?;

    // Add all tracked changes (updates + deletions)
    index.add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)?;

    // Also pick up untracked files by walking the workdir
    add_untracked_files(&repo, &workdir, &mut index)?;

    let tree_oid = index.write_tree()?;
    let tree = repo.find_tree(tree_oid)?;

    // Parent = HEAD (if it exists)
    let head_commit = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let parents: Vec<&git2::Commit> = head_commit.iter().collect();

    let sig = Signature::now("Amend Snapshot", "snapshot@amend.dev")?;
    let timestamp = now_millis();
    let id = timestamp.to_string();

    // Commit message stores the label for later retrieval
    let message = format!("snapshot: {}", label);
    let commit_oid = repo.commit(None, &sig, &sig, &message, &tree, &parents)?;

    // Write the ref
    let refname = snapshot_ref(&id);
    repo.reference(&refname, commit_oid, true, "create snapshot")?;

    // Determine changed files vs HEAD
    let changed_files = changed_files_in_tree(&repo, head_commit.as_ref(), &tree)?;

    Ok(Snapshot {
        id,
        label: label.to_string(),
        timestamp,
        commit_sha: commit_oid.to_string(),
        repo_path: workdir.to_string_lossy().to_string(),
        changed_files,
    })
}

/// Walk untracked files and add them to the index so they appear in the snapshot.
fn add_untracked_files(
    repo: &Repository,
    workdir: &Path,
    index: &mut git2::Index,
) -> Result<(), SnapshotError> {
    let statuses = repo.statuses(Some(
        git2::StatusOptions::new()
            .include_untracked(true)
            .recurse_untracked_dirs(true),
    ))?;

    for entry in statuses.iter() {
        let status = entry.status();
        if status.contains(git2::Status::WT_NEW) {
            if let Some(path) = entry.path() {
                let full = workdir.join(path);
                if full.is_file() {
                    index.add_path(Path::new(path))?;
                }
            }
        }
    }

    Ok(())
}

/// Return the list of file paths that differ between a parent commit (or empty tree) and a tree.
fn changed_files_in_tree(
    repo: &Repository,
    parent: Option<&git2::Commit>,
    tree: &git2::Tree,
) -> Result<Vec<String>, SnapshotError> {
    let parent_tree = parent.map(|c| c.tree()).transpose()?;

    let diff = repo.diff_tree_to_tree(
        parent_tree.as_ref(),
        Some(tree),
        Some(DiffOptions::new().include_untracked(true)),
    )?;

    let mut files = Vec::new();
    for delta in diff.deltas() {
        if let Some(p) = delta.new_file().path() {
            files.push(p.to_string_lossy().to_string());
        } else if let Some(p) = delta.old_file().path() {
            files.push(p.to_string_lossy().to_string());
        }
    }
    Ok(files)
}

fn list_snapshots_sync(repo_path: &str) -> Result<Vec<Snapshot>, SnapshotError> {
    let repo = Repository::discover(repo_path)
        .map_err(|_| SnapshotError::NotARepo(repo_path.to_string()))?;

    let workdir = repo
        .workdir()
        .ok_or_else(|| SnapshotError::Other("Bare repository".into()))?
        .to_string_lossy()
        .to_string();

    let mut snapshots = Vec::new();

    repo.references_glob(&format!("{}*", SNAPSHOT_REF_PREFIX))?
        .filter_map(|r| r.ok())
        .for_each(|reference| {
            if let Some(name) = reference.name() {
                let id = name.strip_prefix(SNAPSHOT_REF_PREFIX).unwrap_or(name);
                if let Ok(commit) = reference.peel_to_commit() {
                    let message = commit.message().unwrap_or("");
                    let label = message.strip_prefix("snapshot: ").unwrap_or(message);
                    let timestamp: u64 = id.parse().unwrap_or(0);

                    // Get changed files for this snapshot
                    let parent = commit.parent(0).ok();
                    let tree = commit.tree().ok();
                    let changed_files = tree
                        .as_ref()
                        .and_then(|t| changed_files_in_tree(&repo, parent.as_ref(), t).ok())
                        .unwrap_or_default();

                    snapshots.push(Snapshot {
                        id: id.to_string(),
                        label: label.to_string(),
                        timestamp,
                        commit_sha: commit.id().to_string(),
                        repo_path: workdir.clone(),
                        changed_files,
                    });
                }
            }
        });

    // Sort by timestamp descending (newest first)
    snapshots.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(snapshots)
}

fn restore_snapshot_sync(repo_path: &str, snapshot_id: &str) -> Result<(), SnapshotError> {
    let repo = Repository::discover(repo_path)
        .map_err(|_| SnapshotError::NotARepo(repo_path.to_string()))?;

    let refname = snapshot_ref(snapshot_id);
    let reference = repo
        .find_reference(&refname)
        .map_err(|_| SnapshotError::NotFound(snapshot_id.to_string()))?;

    let commit = reference.peel_to_commit()?;
    let tree = commit.tree()?;

    // Checkout the snapshot tree into the working directory without moving HEAD
    repo.checkout_tree(
        tree.as_object(),
        Some(
            git2::build::CheckoutBuilder::new()
                .force()
                .remove_untracked(true),
        ),
    )?;

    // Reset the index to match the snapshot tree so `git status` shows clean vs snapshot
    // but do NOT move HEAD — that stays on the user's branch.
    let mut index = repo.index()?;
    index.read_tree(&tree)?;
    index.write()?;

    Ok(())
}

fn delete_snapshot_sync(repo_path: &str, snapshot_id: &str) -> Result<(), SnapshotError> {
    let repo = Repository::discover(repo_path)
        .map_err(|_| SnapshotError::NotARepo(repo_path.to_string()))?;

    let refname = snapshot_ref(snapshot_id);
    let mut reference = repo
        .find_reference(&refname)
        .map_err(|_| SnapshotError::NotFound(snapshot_id.to_string()))?;

    reference.delete()?;
    Ok(())
}

fn diff_snapshot_sync(
    repo_path: &str,
    snapshot_id: &str,
) -> Result<Vec<SnapshotFileDiff>, SnapshotError> {
    let repo = Repository::discover(repo_path)
        .map_err(|_| SnapshotError::NotARepo(repo_path.to_string()))?;

    let refname = snapshot_ref(snapshot_id);
    let reference = repo
        .find_reference(&refname)
        .map_err(|_| SnapshotError::NotFound(snapshot_id.to_string()))?;

    let snapshot_commit = reference.peel_to_commit()?;
    let snapshot_tree = snapshot_commit.tree()?;

    // Compare snapshot tree to current working directory
    let diff = repo.diff_tree_to_workdir_with_index(
        Some(&snapshot_tree),
        Some(
            DiffOptions::new()
                .include_untracked(true)
                .recurse_untracked_dirs(true),
        ),
    )?;

    let mut file_diffs = Vec::new();
    for delta in diff.deltas() {
        let path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        let status = match delta.status() {
            git2::Delta::Added => "added",
            git2::Delta::Deleted => "deleted",
            git2::Delta::Modified => "modified",
            git2::Delta::Renamed => "modified",
            git2::Delta::Copied => "added",
            _ => "modified",
        };

        file_diffs.push(SnapshotFileDiff {
            path,
            status: status.to_string(),
        });
    }

    Ok(file_diffs)
}

fn get_snapshot_file_diff_sync(
    repo_path: &str,
    snapshot_id: &str,
    file_path: &str,
) -> Result<SnapshotDiff, SnapshotError> {
    let repo = Repository::discover(repo_path)
        .map_err(|_| SnapshotError::NotARepo(repo_path.to_string()))?;

    let workdir = repo
        .workdir()
        .ok_or_else(|| SnapshotError::Other("Bare repository".into()))?
        .to_path_buf();

    let refname = snapshot_ref(snapshot_id);
    let reference = repo
        .find_reference(&refname)
        .map_err(|_| SnapshotError::NotFound(snapshot_id.to_string()))?;

    let snapshot_commit = reference.peel_to_commit()?;
    let snapshot_tree = snapshot_commit.tree()?;

    // Get snapshot version of the file
    let (old_content, old_is_binary) = match snapshot_tree.get_path(Path::new(file_path)) {
        Ok(entry) => {
            let obj = entry.to_object(&repo)?;
            if let Some(blob) = obj.as_blob() {
                if blob.is_binary() {
                    (String::new(), true)
                } else {
                    (String::from_utf8_lossy(blob.content()).to_string(), false)
                }
            } else {
                (String::new(), false)
            }
        }
        Err(_) => (String::new(), false),
    };

    // Get current working tree version
    let full_path = workdir.join(file_path);
    let (new_content, new_is_binary) = if full_path.exists() {
        match std::fs::read(&full_path) {
            Ok(bytes) => {
                // Simple binary detection: check for null bytes in first 8KB
                let check_len = bytes.len().min(8192);
                if bytes[..check_len].contains(&0) {
                    (String::new(), true)
                } else {
                    (String::from_utf8_lossy(&bytes).to_string(), false)
                }
            }
            Err(_) => (String::new(), false),
        }
    } else {
        (String::new(), false)
    };

    Ok(SnapshotDiff {
        old_content,
        new_content,
        is_binary: old_is_binary || new_is_binary,
    })
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn create_snapshot(repo_path: String, label: String) -> Result<Snapshot, SnapshotError> {
    spawn_blocking(move || create_snapshot_sync(&repo_path, &label))
        .await
        .map_err(|e| SnapshotError::TaskJoin(e.to_string()))?
}

#[tauri::command]
pub async fn list_snapshots(repo_path: String) -> Result<Vec<Snapshot>, SnapshotError> {
    spawn_blocking(move || list_snapshots_sync(&repo_path))
        .await
        .map_err(|e| SnapshotError::TaskJoin(e.to_string()))?
}

#[tauri::command]
pub async fn restore_snapshot(repo_path: String, snapshot_id: String) -> Result<(), SnapshotError> {
    spawn_blocking(move || restore_snapshot_sync(&repo_path, &snapshot_id))
        .await
        .map_err(|e| SnapshotError::TaskJoin(e.to_string()))?
}

#[tauri::command]
pub async fn delete_snapshot(repo_path: String, snapshot_id: String) -> Result<(), SnapshotError> {
    spawn_blocking(move || delete_snapshot_sync(&repo_path, &snapshot_id))
        .await
        .map_err(|e| SnapshotError::TaskJoin(e.to_string()))?
}

#[tauri::command]
pub async fn diff_snapshot(
    repo_path: String,
    snapshot_id: String,
) -> Result<Vec<SnapshotFileDiff>, SnapshotError> {
    spawn_blocking(move || diff_snapshot_sync(&repo_path, &snapshot_id))
        .await
        .map_err(|e| SnapshotError::TaskJoin(e.to_string()))?
}

#[tauri::command]
pub async fn get_snapshot_file_diff(
    repo_path: String,
    snapshot_id: String,
    file_path: String,
) -> Result<SnapshotDiff, SnapshotError> {
    spawn_blocking(move || get_snapshot_file_diff_sync(&repo_path, &snapshot_id, &file_path))
        .await
        .map_err(|e| SnapshotError::TaskJoin(e.to_string()))?
}
