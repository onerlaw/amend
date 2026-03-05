use crate::error::impl_serialize_as_string;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use git2::{DiffOptions, Repository, StatusOptions};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;
use tokio::task::spawn_blocking;

#[derive(Error, Debug)]
pub enum GitError {
    #[error("Git error: {0}")]
    Git(#[from] git2::Error),
    #[error("Repository not found at: {0}")]
    NotARepo(String),
    #[error("Command failed: {0}")]
    CommandFailed(String),
    #[error("Invalid argument: {0}")]
    InvalidArgument(String),
    #[error("Task failed: {0}")]
    TaskJoin(String),
}

impl_serialize_as_string!(GitError);

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitFileStatus {
    pub path: String,
    pub status: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktree {
    pub path: String,
    pub branch: String,
    pub is_main: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentWorktree {
    pub id: String,
    pub path: String,
    pub branch: String,
    pub parent_branch: String,
    pub created_at: u64,
    pub status: String, // "active" | "completed" | "merging"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MergeStrategy {
    FastForward,
    Squash,
    CherryPick,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub staged: Vec<GitFileStatus>,
    pub unstaged: Vec<GitFileStatus>,
    pub untracked: Vec<String>,
    pub conflicted: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitDiff {
    pub old_path: String,
    pub new_path: String,
    pub old_content: String,
    pub new_content: String,
    pub is_binary: bool,
}

/// Run a git command in the given repo directory and return stdout on success.
fn run_git_command(repo_path: &str, args: &[&str]) -> Result<String, GitError> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo_path)
        .output()
        .map_err(|e| GitError::CommandFailed(e.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitError::CommandFailed(stderr.to_string()));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Validate that a user-provided argument doesn't start with '-' (flag injection prevention).
fn validate_no_flag(arg: &str, label: &str) -> Result<(), GitError> {
    if arg.starts_with('-') {
        return Err(GitError::InvalidArgument(format!(
            "{} must not start with '-': {}",
            label, arg
        )));
    }
    Ok(())
}

/// Validate that a file_path is contained within the repository working directory.
/// Rejects absolute paths, parent traversal (`..`), and paths that escape via symlinks.
fn validate_repo_containment(repo: &Repository, file_path: &str) -> Result<PathBuf, GitError> {
    let path = Path::new(file_path);

    // Reject absolute paths — file_path must be relative to the repo workdir
    if path.is_absolute() {
        return Err(GitError::InvalidArgument(format!(
            "file path must be relative, not absolute: {}",
            file_path
        )));
    }

    // Reject any `..` components before joining (prevents traversal before canonicalize)
    for component in path.components() {
        if let std::path::Component::ParentDir = component {
            return Err(GitError::InvalidArgument(format!(
                "file path must not contain '..': {}",
                file_path
            )));
        }
    }

    let workdir = repo
        .workdir()
        .ok_or_else(|| GitError::NotARepo("bare repository".to_string()))?;

    let full_path = workdir.join(file_path);

    // Canonicalize both paths and verify containment.
    // For the target, if it doesn't exist yet (e.g. deleted file), canonicalize the parent.
    let canonical_workdir = workdir
        .canonicalize()
        .map_err(|e| GitError::InvalidArgument(format!("failed to resolve repo workdir: {}", e)))?;

    let canonical_target = if full_path.exists() {
        full_path
            .canonicalize()
            .map_err(|e| GitError::InvalidArgument(format!("failed to resolve file path: {}", e)))?
    } else {
        // For non-existent files, canonicalize the parent and append the file name
        let parent = full_path.parent().ok_or_else(|| {
            GitError::InvalidArgument(format!("invalid file path: {}", file_path))
        })?;
        let file_name = full_path.file_name().ok_or_else(|| {
            GitError::InvalidArgument(format!("invalid file path: {}", file_path))
        })?;
        let canonical_parent = parent.canonicalize().map_err(|e| {
            GitError::InvalidArgument(format!("failed to resolve file path parent: {}", e))
        })?;
        canonical_parent.join(file_name)
    };

    if !canonical_target.starts_with(&canonical_workdir) {
        return Err(GitError::InvalidArgument(format!(
            "file path escapes repository: {}",
            file_path
        )));
    }

    Ok(full_path)
}

fn is_image_extension(path: &str) -> bool {
    let lower = path.to_lowercase();
    matches!(
        lower.rsplit('.').next(),
        Some("png" | "jpg" | "jpeg" | "gif" | "svg" | "webp" | "bmp" | "ico")
    )
}

fn index_status_to_string(status: git2::Status) -> &'static str {
    if status.is_index_new() {
        "added"
    } else if status.is_index_modified() {
        "modified"
    } else if status.is_index_deleted() {
        "deleted"
    } else if status.is_index_renamed() {
        "renamed"
    } else {
        "unknown"
    }
}

fn wt_status_to_string(status: git2::Status) -> &'static str {
    if status.is_wt_new() {
        "added"
    } else if status.is_wt_modified() {
        "modified"
    } else if status.is_wt_deleted() {
        "deleted"
    } else if status.is_wt_renamed() {
        "renamed"
    } else {
        "unknown"
    }
}

#[tauri::command]
pub async fn get_git_root(path: String) -> Result<Option<String>, GitError> {
    spawn_blocking(move || match Repository::discover(&path) {
        Ok(repo) => Ok(repo.workdir().map(|p| p.to_string_lossy().to_string())),
        Err(_) => Ok(None),
    })
    .await
    .map_err(|e| GitError::TaskJoin(e.to_string()))?
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitRepoInfo {
    pub git_root: String,
    pub repo_name: String,
    pub main_repo_root: String,
    pub worktree_name: Option<String>,
    pub current_branch: Option<String>,
}

#[tauri::command]
pub async fn get_git_repo_info(path: String) -> Result<Option<GitRepoInfo>, GitError> {
    spawn_blocking(move || {
        let repo = match Repository::discover(&path) {
            Ok(r) => r,
            Err(_) => return Ok(None),
        };
        let git_root = match repo.workdir() {
            Some(p) => p.to_string_lossy().to_string(),
            None => return Ok(None),
        };
        let git_root_normalized = git_root.trim_end_matches('/').to_string();

        // --git-common-dir returns ".git" (relative) in main worktree, or
        // absolute /path/to/main/.git in a linked worktree
        let common_dir = run_git_command(&git_root_normalized, &["rev-parse", "--git-common-dir"])?;
        let common_dir = common_dir.trim();

        let main_repo_root = if Path::new(common_dir).is_absolute() {
            Path::new(common_dir)
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| git_root_normalized.clone())
        } else {
            git_root_normalized.clone()
        };

        let repo_name = Path::new(&main_repo_root)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        let worktree_name = if git_root_normalized != main_repo_root {
            Some(
                Path::new(&git_root_normalized)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default(),
            )
        } else {
            None
        };

        let current_branch = repo.head().ok().and_then(|head| {
            if head.is_branch() {
                head.shorthand().map(|s| s.to_string())
            } else {
                // Detached HEAD — use short SHA
                head.target().map(|oid| oid.to_string()[..7].to_string())
            }
        });

        Ok(Some(GitRepoInfo {
            git_root,
            repo_name,
            main_repo_root,
            worktree_name,
            current_branch,
        }))
    })
    .await
    .map_err(|e| GitError::TaskJoin(e.to_string()))?
}

#[tauri::command]
pub async fn is_git_repository(path: String) -> bool {
    spawn_blocking(move || Repository::discover(&path).is_ok())
        .await
        .unwrap_or(false)
}

#[tauri::command]
pub async fn get_git_status(repo_path: String) -> Result<GitStatus, GitError> {
    spawn_blocking(move || get_git_status_sync(&repo_path))
        .await
        .map_err(|e| GitError::TaskJoin(e.to_string()))?
}

fn get_git_status_sync(repo_path: &str) -> Result<GitStatus, GitError> {
    let repo = Repository::discover(repo_path)?;

    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false);

    let statuses = repo.statuses(Some(&mut opts))?;

    let mut result = GitStatus {
        staged: Vec::new(),
        unstaged: Vec::new(),
        untracked: Vec::new(),
        conflicted: Vec::new(),
    };

    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("").to_string();
        let status = entry.status();

        if status.is_conflicted() {
            result.conflicted.push(path);
            continue;
        }

        if status.is_wt_new() {
            result.untracked.push(path);
        } else {
            // Check for staged changes
            if status.is_index_new()
                || status.is_index_modified()
                || status.is_index_deleted()
                || status.is_index_renamed()
            {
                result.staged.push(GitFileStatus {
                    path: path.clone(),
                    status: index_status_to_string(status).to_string(),
                });
            }

            // Check for unstaged changes
            if status.is_wt_modified() || status.is_wt_deleted() || status.is_wt_renamed() {
                result.unstaged.push(GitFileStatus {
                    path,
                    status: wt_status_to_string(status).to_string(),
                });
            }
        }
    }

    Ok(result)
}

#[tauri::command]
pub async fn get_file_diff(repo_path: String, file_path: String) -> Result<GitDiff, GitError> {
    spawn_blocking(move || get_file_diff_sync(&repo_path, &file_path))
        .await
        .map_err(|e| GitError::TaskJoin(e.to_string()))?
}

fn get_file_diff_sync(repo_path: &str, file_path: &str) -> Result<GitDiff, GitError> {
    let repo = Repository::discover(repo_path)?;
    let full_path = validate_repo_containment(&repo, file_path)?;
    let relative_path = Path::new(file_path);

    if is_image_extension(file_path) {
        // Read current file as base64
        let new_content = if full_path.exists() {
            let bytes = std::fs::read(&full_path).unwrap_or_default();
            STANDARD.encode(&bytes)
        } else {
            String::new()
        };

        // Read HEAD blob as base64
        let old_content = match repo.head() {
            Ok(head) => {
                let tree = head.peel_to_tree()?;
                match tree.get_path(relative_path) {
                    Ok(entry) => {
                        let blob = repo.find_blob(entry.id())?;
                        STANDARD.encode(blob.content())
                    }
                    Err(_) => String::new(),
                }
            }
            Err(_) => String::new(),
        };

        return Ok(GitDiff {
            old_path: file_path.to_string(),
            new_path: file_path.to_string(),
            old_content,
            new_content,
            is_binary: true,
        });
    }

    // Get current file content — detect binary files by UTF-8 validity
    let (new_content, is_binary) = if full_path.exists() {
        match std::fs::read_to_string(&full_path) {
            Ok(content) => (content, false),
            Err(_) => (String::new(), true),
        }
    } else {
        (String::new(), false)
    };

    if is_binary {
        // Non-image binary file — return early with binary flag
        return Ok(GitDiff {
            old_path: file_path.to_string(),
            new_path: file_path.to_string(),
            old_content: String::new(),
            new_content: String::new(),
            is_binary: true,
        });
    }

    // Get HEAD content
    let old_content = match repo.head() {
        Ok(head) => {
            let tree = head.peel_to_tree()?;
            match tree.get_path(relative_path) {
                Ok(entry) => {
                    let blob = repo.find_blob(entry.id())?;
                    String::from_utf8_lossy(blob.content()).to_string()
                }
                Err(_) => String::new(),
            }
        }
        Err(_) => String::new(),
    };

    Ok(GitDiff {
        old_path: file_path.to_string(),
        new_path: file_path.to_string(),
        old_content,
        new_content,
        is_binary: false,
    })
}

#[tauri::command]
pub async fn list_worktrees(repo_path: String) -> Result<Vec<GitWorktree>, GitError> {
    spawn_blocking(move || list_worktrees_sync(&repo_path))
        .await
        .map_err(|e| GitError::TaskJoin(e.to_string()))?
}

fn list_worktrees_sync(repo_path: &str) -> Result<Vec<GitWorktree>, GitError> {
    let stdout = run_git_command(repo_path, &["worktree", "list", "--porcelain"])?;
    let mut worktrees = Vec::new();
    let mut current_path: Option<String> = None;
    let mut current_branch: Option<String> = None;
    let mut is_bare = false;

    for line in stdout.lines() {
        if line.starts_with("worktree ") {
            // Save previous worktree if complete
            if let Some(path) = current_path.take() {
                if !is_bare {
                    worktrees.push(GitWorktree {
                        path: path.clone(),
                        branch: current_branch.take().unwrap_or_default(),
                        is_main: worktrees.is_empty(), // First worktree is main
                    });
                }
            }
            current_path = Some(line.trim_start_matches("worktree ").to_string());
            current_branch = None;
            is_bare = false;
        } else if line.starts_with("branch ") {
            let branch = line.trim_start_matches("branch refs/heads/").to_string();
            current_branch = Some(branch);
        } else if line == "bare" {
            is_bare = true;
        } else if line.starts_with("HEAD ") {
            // Detached HEAD - use short commit hash
            if current_branch.is_none() {
                let hash = line.trim_start_matches("HEAD ");
                current_branch = Some(format!("({})", &hash[..7.min(hash.len())]));
            }
        }
    }

    // Don't forget the last worktree
    if let Some(path) = current_path {
        if !is_bare {
            worktrees.push(GitWorktree {
                path,
                branch: current_branch.unwrap_or_default(),
                is_main: worktrees.is_empty(),
            });
        }
    }

    Ok(worktrees)
}

#[tauri::command]
pub async fn add_worktree(
    repo_path: String,
    worktree_path: String,
    branch: Option<String>,
    new_branch: Option<String>,
) -> Result<GitWorktree, GitError> {
    // Validate all user-provided arguments don't start with '-'
    validate_no_flag(&worktree_path, "worktree path")?;
    if let Some(ref b) = branch {
        validate_no_flag(b, "branch name")?;
    }
    if let Some(ref nb) = new_branch {
        validate_no_flag(nb, "new branch name")?;
    }

    spawn_blocking(move || {
        let mut args = vec!["worktree", "add"];

        // Build arguments based on options
        let new_branch_arg;
        if let Some(ref new_branch_name) = new_branch {
            args.push("-b");
            new_branch_arg = new_branch_name.clone();
            args.push(&new_branch_arg);
        }

        // Use -- to separate options from positional arguments
        args.push("--");
        args.push(&worktree_path);

        let branch_arg;
        if let Some(ref branch_name) = branch {
            branch_arg = branch_name.clone();
            args.push(&branch_arg);
        }

        run_git_command(&repo_path, &args)?;

        // Determine the branch name for the result
        let result_branch = new_branch.or(branch).unwrap_or_else(|| "HEAD".to_string());

        // Convert to absolute path if relative
        let absolute_path = if Path::new(&worktree_path).is_absolute() {
            worktree_path
        } else {
            Path::new(&repo_path)
                .join(&worktree_path)
                .to_string_lossy()
                .to_string()
        };

        Ok(GitWorktree {
            path: absolute_path,
            branch: result_branch,
            is_main: false,
        })
    })
    .await
    .map_err(|e| GitError::TaskJoin(e.to_string()))?
}

fn sanitize_branch_for_path(branch: &str) -> String {
    branch.replace('/', "-")
}

fn branch_exists_locally(repo_path: &str, branch_name: &str) -> Result<bool, GitError> {
    let output = run_git_command(repo_path, &["branch", "--list", "--", branch_name])?;
    Ok(!output.trim().is_empty())
}

fn detect_default_branch(repo_path: &str) -> String {
    // Try symbolic-ref for origin/HEAD
    if let Ok(output) = run_git_command(repo_path, &["symbolic-ref", "refs/remotes/origin/HEAD"]) {
        let trimmed = output.trim();
        if let Some(name) = trimmed.rsplit('/').next() {
            if !name.is_empty() {
                return name.to_string();
            }
        }
    }
    // Fallback: check if main or master exists locally
    if branch_exists_locally(repo_path, "main").unwrap_or(false) {
        return "main".to_string();
    }
    if branch_exists_locally(repo_path, "master").unwrap_or(false) {
        return "master".to_string();
    }
    // Last resort
    "HEAD".to_string()
}

#[tauri::command]
pub async fn get_default_branch(repo_path: String) -> Result<String, GitError> {
    spawn_blocking(move || Ok(detect_default_branch(&repo_path)))
        .await
        .map_err(|e| GitError::TaskJoin(e.to_string()))?
}

#[tauri::command]
pub async fn open_or_create_worktree(
    repo_path: String,
    branch_name: String,
    start_point: Option<String>,
) -> Result<GitWorktree, GitError> {
    validate_no_flag(&branch_name, "branch name")?;
    if branch_name.trim().is_empty() {
        return Err(GitError::InvalidArgument(
            "branch name must not be empty".to_string(),
        ));
    }
    if let Some(ref sp) = start_point {
        validate_no_flag(sp, "start point")?;
    }

    spawn_blocking(move || {
        // Return existing worktree if branch already has one
        let existing = list_worktrees_sync(&repo_path)?;
        if let Some(wt) = existing.iter().find(|w| w.branch == branch_name) {
            return Ok(wt.clone());
        }

        // Determine destination: ~/.amend/<project>/<sanitized_branch>
        let project_name = Path::new(&repo_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "project".to_string());
        let dir_name = sanitize_branch_for_path(&branch_name);
        let home = dirs::home_dir().ok_or_else(|| {
            GitError::CommandFailed("could not determine home directory".to_string())
        })?;
        let worktree_path = home.join(".amend").join(&project_name).join(&dir_name);

        // Ensure parent directory exists
        std::fs::create_dir_all(worktree_path.parent().unwrap())
            .map_err(|e| GitError::CommandFailed(e.to_string()))?;

        let worktree_path_str = worktree_path.to_string_lossy().to_string();

        if branch_exists_locally(&repo_path, &branch_name)? {
            // Check out existing branch into new worktree
            run_git_command(
                &repo_path,
                &["worktree", "add", "--", &worktree_path_str, &branch_name],
            )?;
        } else {
            // Create new branch and worktree, based off start_point (default: main branch)
            let resolved_start = start_point.unwrap_or_else(|| detect_default_branch(&repo_path));
            run_git_command(
                &repo_path,
                &[
                    "worktree",
                    "add",
                    "-b",
                    &branch_name,
                    "--",
                    &worktree_path_str,
                    &resolved_start,
                ],
            )?;
        }

        Ok(GitWorktree {
            path: worktree_path_str,
            branch: branch_name,
            is_main: false,
        })
    })
    .await
    .map_err(|e| GitError::TaskJoin(e.to_string()))?
}

#[tauri::command]
pub async fn remove_worktree(
    repo_path: String,
    worktree_path: String,
    force: bool,
) -> Result<(), GitError> {
    validate_no_flag(&worktree_path, "worktree path")?;
    spawn_blocking(move || {
        let mut args = vec!["worktree", "remove"];

        if force {
            args.push("--force");
        }

        // Use -- to separate options from positional arguments
        args.push("--");
        args.push(&worktree_path);

        run_git_command(&repo_path, &args)?;
        Ok(())
    })
    .await
    .map_err(|e| GitError::TaskJoin(e.to_string()))?
}

#[tauri::command]
pub async fn restore_file(repo_path: String, file_path: String) -> Result<(), GitError> {
    validate_no_flag(&file_path, "file path")?;
    spawn_blocking(move || {
        run_git_command(&repo_path, &["restore", "--", &file_path])?;
        Ok(())
    })
    .await
    .map_err(|e| GitError::TaskJoin(e.to_string()))?
}

#[tauri::command]
pub async fn unstage_file(repo_path: String, file_path: String) -> Result<(), GitError> {
    validate_no_flag(&file_path, "file path")?;
    spawn_blocking(move || {
        run_git_command(&repo_path, &["restore", "--staged", "--", &file_path])?;
        Ok(())
    })
    .await
    .map_err(|e| GitError::TaskJoin(e.to_string()))?
}

#[tauri::command]
pub async fn stage_file(repo_path: String, file_path: String) -> Result<(), GitError> {
    validate_no_flag(&file_path, "file path")?;
    spawn_blocking(move || {
        run_git_command(&repo_path, &["add", "--", &file_path])?;
        Ok(())
    })
    .await
    .map_err(|e| GitError::TaskJoin(e.to_string()))?
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DiffStats {
    pub additions: usize,
    pub deletions: usize,
    pub files_changed: usize,
}

#[tauri::command]
pub async fn get_diff_stats(repo_path: String) -> Result<DiffStats, GitError> {
    spawn_blocking(move || get_diff_stats_sync(&repo_path))
        .await
        .map_err(|e| GitError::TaskJoin(e.to_string()))?
}

fn get_diff_stats_sync(repo_path: &str) -> Result<DiffStats, GitError> {
    let repo = Repository::discover(repo_path)?;

    let mut total_additions = 0;
    let mut total_deletions = 0;
    let mut total_files = 0;

    // Unstaged changes: index → workdir
    let mut opts = DiffOptions::new();
    let unstaged_diff = repo.diff_index_to_workdir(None, Some(&mut opts))?;
    let unstaged_stats = unstaged_diff.stats()?;
    total_additions += unstaged_stats.insertions();
    total_deletions += unstaged_stats.deletions();
    total_files += unstaged_stats.files_changed();

    // Staged changes: HEAD tree → index
    if let Ok(head) = repo.head() {
        if let Ok(tree) = head.peel_to_tree() {
            let mut opts2 = DiffOptions::new();
            let staged_diff = repo.diff_tree_to_index(Some(&tree), None, Some(&mut opts2))?;
            let staged_stats = staged_diff.stats()?;
            total_additions += staged_stats.insertions();
            total_deletions += staged_stats.deletions();
            total_files += staged_stats.files_changed();
        }
    }

    // Count untracked files (file count only — no line reading for performance)
    let mut status_opts = StatusOptions::new();
    status_opts
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false);

    let statuses = repo.statuses(Some(&mut status_opts))?;
    for entry in statuses.iter() {
        if entry.status().is_wt_new() {
            total_files += 1;
        }
    }

    Ok(DiffStats {
        additions: total_additions,
        deletions: total_deletions,
        files_changed: total_files,
    })
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitPollData {
    pub status: GitStatus,
    pub diff_stats: DiffStats,
    /// Opaque fingerprint of .git/index mtime + HEAD ref. Callers can cache
    /// this and pass it to `git_quick_check` to detect changes cheaply.
    pub fingerprint: String,
    pub current_branch: Option<String>,
}

/// Lightweight change-detection: checks .git/index mtime and HEAD ref
/// without computing full status or diff stats. Returns true if the
/// fingerprint differs from the caller's cached value.
#[tauri::command]
pub async fn git_quick_check(
    repo_path: String,
    cached_fingerprint: String,
) -> Result<bool, GitError> {
    spawn_blocking(move || {
        let fp = compute_repo_fingerprint(&repo_path)?;
        Ok(fp != cached_fingerprint)
    })
    .await
    .map_err(|e| GitError::TaskJoin(e.to_string()))?
}

/// Build a fingerprint from .git/index mtime + HEAD target.
fn compute_repo_fingerprint(repo_path: &str) -> Result<String, GitError> {
    let repo = Repository::discover(repo_path)?;
    let git_dir = repo.path(); // .git directory

    // .git/index mtime (captures staging/unstaging/working-tree changes)
    let index_mtime = std::fs::metadata(git_dir.join("index"))
        .and_then(|m| m.modified())
        .map(|t| {
            t.duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        })
        .unwrap_or(0);

    // HEAD target (captures commits, branch switches)
    let head_target = repo
        .head()
        .ok()
        .and_then(|h| h.target().map(|oid| oid.to_string()))
        .unwrap_or_default();

    Ok(format!("{}:{}", index_mtime, head_target))
}

#[tauri::command]
pub async fn git_poll_data(repo_path: String) -> Result<GitPollData, GitError> {
    spawn_blocking(move || git_poll_data_sync(&repo_path))
        .await
        .map_err(|e| GitError::TaskJoin(e.to_string()))?
}

fn git_poll_data_sync(repo_path: &str) -> Result<GitPollData, GitError> {
    let fingerprint = compute_repo_fingerprint(repo_path)?;
    let repo = Repository::discover(repo_path)?;

    // Single statuses() call to derive both GitStatus and DiffStats
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false);

    let statuses = repo.statuses(Some(&mut opts))?;

    let mut status = GitStatus {
        staged: Vec::new(),
        unstaged: Vec::new(),
        untracked: Vec::new(),
        conflicted: Vec::new(),
    };

    let mut untracked_file_count: usize = 0;

    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("").to_string();
        let st = entry.status();

        if st.is_conflicted() {
            status.conflicted.push(path);
            continue;
        }

        if st.is_wt_new() {
            status.untracked.push(path);
            untracked_file_count += 1;
        } else {
            if st.is_index_new()
                || st.is_index_modified()
                || st.is_index_deleted()
                || st.is_index_renamed()
            {
                status.staged.push(GitFileStatus {
                    path: path.clone(),
                    status: index_status_to_string(st).to_string(),
                });
            }

            if st.is_wt_modified() || st.is_wt_deleted() || st.is_wt_renamed() {
                status.unstaged.push(GitFileStatus {
                    path,
                    status: wt_status_to_string(st).to_string(),
                });
            }
        }
    }

    // Compute diff stats from diffs (not statuses) for accurate line counts
    let mut total_additions = 0;
    let mut total_deletions = 0;
    let mut total_files = 0;

    // Unstaged changes: index → workdir
    let mut diff_opts = DiffOptions::new();
    let unstaged_diff = repo.diff_index_to_workdir(None, Some(&mut diff_opts))?;
    let unstaged_stats = unstaged_diff.stats()?;
    total_additions += unstaged_stats.insertions();
    total_deletions += unstaged_stats.deletions();
    total_files += unstaged_stats.files_changed();

    // Staged changes: HEAD tree → index
    if let Ok(head) = repo.head() {
        if let Ok(tree) = head.peel_to_tree() {
            let mut opts2 = DiffOptions::new();
            let staged_diff = repo.diff_tree_to_index(Some(&tree), None, Some(&mut opts2))?;
            let staged_stats = staged_diff.stats()?;
            total_additions += staged_stats.insertions();
            total_deletions += staged_stats.deletions();
            total_files += staged_stats.files_changed();
        }
    }

    // Count untracked files (just file count, no line reading)
    total_files += untracked_file_count;

    let diff_stats = DiffStats {
        additions: total_additions,
        deletions: total_deletions,
        files_changed: total_files,
    };

    let current_branch = repo.head().ok().and_then(|h| {
        if h.is_branch() {
            h.shorthand().map(|s| s.to_string())
        } else {
            // Detached HEAD — use short commit hash
            h.target().map(|oid| {
                let hex = oid.to_string();
                hex[..7.min(hex.len())].to_string()
            })
        }
    });

    Ok(GitPollData {
        status,
        diff_stats,
        fingerprint,
        current_branch,
    })
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
    pub name: String,
    pub is_remote: bool,
    pub is_current: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BranchDiffSummary {
    pub files: Vec<GitFileStatus>,
    pub diff_stats: DiffStats,
    pub merge_base: String,
}

#[tauri::command]
pub async fn get_branch_diff_files(
    repo_path: String,
    base_ref: String,
) -> Result<BranchDiffSummary, GitError> {
    validate_no_flag(&base_ref, "base ref")?;
    let rp = repo_path.clone();
    let br = base_ref.clone();
    spawn_blocking(move || get_branch_diff_files_sync(&rp, &br))
        .await
        .map_err(|e| GitError::TaskJoin(e.to_string()))?
}

fn get_branch_diff_files_sync(
    repo_path: &str,
    base_ref: &str,
) -> Result<BranchDiffSummary, GitError> {
    // Find the merge-base between base_ref and HEAD
    let merge_base_output = run_git_command(repo_path, &["merge-base", base_ref, "HEAD"])?;
    let merge_base = merge_base_output.trim().to_string();

    // Get changed files with name-status
    let name_status_output = run_git_command(repo_path, &["diff", "--name-status", &merge_base])?;

    let mut files = Vec::new();
    for line in name_status_output.lines() {
        if line.is_empty() {
            continue;
        }
        let mut parts = line.splitn(2, '\t');
        let status_code = parts.next().unwrap_or("").trim();
        let path = parts.next().unwrap_or("").trim();
        if path.is_empty() {
            continue;
        }

        let status = match status_code.chars().next() {
            Some('A') => "added",
            Some('M') => "modified",
            Some('D') => "deleted",
            Some('R') => "renamed",
            Some('C') => "copied",
            _ => "modified",
        };

        files.push(GitFileStatus {
            path: path.to_string(),
            status: status.to_string(),
        });
    }

    // Get numstat for aggregate counts
    let numstat_output = run_git_command(repo_path, &["diff", "--numstat", &merge_base])?;

    let mut additions: usize = 0;
    let mut deletions: usize = 0;
    for line in numstat_output.lines() {
        if line.is_empty() {
            continue;
        }
        let cols: Vec<&str> = line.split('\t').collect();
        if cols.len() >= 2 {
            // Binary files show "-" for additions/deletions
            additions += cols[0].parse::<usize>().unwrap_or(0);
            deletions += cols[1].parse::<usize>().unwrap_or(0);
        }
    }

    Ok(BranchDiffSummary {
        diff_stats: DiffStats {
            additions,
            deletions,
            files_changed: files.len(),
        },
        files,
        merge_base,
    })
}

#[tauri::command]
pub async fn get_branch_file_diff(
    repo_path: String,
    base_ref: String,
    file_path: String,
) -> Result<GitDiff, GitError> {
    validate_no_flag(&base_ref, "base ref")?;
    validate_no_flag(&file_path, "file path")?;
    spawn_blocking(move || get_branch_file_diff_sync(&repo_path, &base_ref, &file_path))
        .await
        .map_err(|e| GitError::TaskJoin(e.to_string()))?
}

fn get_branch_file_diff_sync(
    repo_path: &str,
    base_ref: &str,
    file_path: &str,
) -> Result<GitDiff, GitError> {
    let repo = Repository::discover(repo_path)?;
    let full_path = validate_repo_containment(&repo, file_path)?;

    if is_image_extension(file_path) {
        // Read current file as base64
        let new_content = if full_path.exists() {
            let bytes = std::fs::read(&full_path).unwrap_or_default();
            STANDARD.encode(&bytes)
        } else {
            String::new()
        };

        // Read base ref blob as raw bytes via git2 (not string conversion)
        let old_content = match repo.revparse_single(base_ref) {
            Ok(obj) => {
                let tree = obj.peel_to_tree().map_err(|e| {
                    GitError::CommandFailed(format!("Failed to peel to tree: {}", e))
                })?;
                match tree.get_path(Path::new(file_path)) {
                    Ok(entry) => {
                        let blob = repo.find_blob(entry.id())?;
                        STANDARD.encode(blob.content())
                    }
                    Err(_) => String::new(),
                }
            }
            Err(_) => String::new(),
        };

        return Ok(GitDiff {
            old_path: file_path.to_string(),
            new_path: file_path.to_string(),
            old_content,
            new_content,
            is_binary: true,
        });
    }

    // Read current working tree file — detect binary files by UTF-8 validity
    let (new_content, is_binary) = if full_path.exists() {
        match std::fs::read_to_string(&full_path) {
            Ok(content) => (content, false),
            Err(_) => (String::new(), true),
        }
    } else {
        (String::new(), false)
    };

    if is_binary {
        return Ok(GitDiff {
            old_path: file_path.to_string(),
            new_path: file_path.to_string(),
            old_content: String::new(),
            new_content: String::new(),
            is_binary: true,
        });
    }

    // Read old content from base ref via git2
    let old_content = match repo.revparse_single(base_ref) {
        Ok(obj) => match obj.peel_to_tree() {
            Ok(tree) => match tree.get_path(Path::new(file_path)) {
                Ok(entry) => {
                    let blob = repo.find_blob(entry.id())?;
                    String::from_utf8_lossy(blob.content()).to_string()
                }
                Err(_) => String::new(),
            },
            Err(_) => String::new(),
        },
        Err(_) => String::new(),
    };

    Ok(GitDiff {
        old_path: file_path.to_string(),
        new_path: file_path.to_string(),
        old_content,
        new_content,
        is_binary: false,
    })
}

#[tauri::command]
pub async fn list_branches(repo_path: String) -> Result<Vec<GitBranch>, GitError> {
    spawn_blocking(move || {
        // Get local branches
        let stdout = run_git_command(&repo_path, &["branch", "--format=%(refname:short)|%(HEAD)"])?;

        let mut branches: Vec<GitBranch> = stdout
            .lines()
            .filter(|line| !line.is_empty())
            .map(|line| {
                let parts: Vec<&str> = line.split('|').collect();
                let name = parts.first().unwrap_or(&"").to_string();
                let is_current = parts.get(1).map(|s| *s == "*").unwrap_or(false);
                GitBranch {
                    name,
                    is_remote: false,
                    is_current,
                }
            })
            .collect();

        // Get remote branches
        if let Ok(remote_stdout) =
            run_git_command(&repo_path, &["branch", "-r", "--format=%(refname:short)"])
        {
            for line in remote_stdout.lines() {
                if !line.is_empty() && !line.contains("HEAD") {
                    branches.push(GitBranch {
                        name: line.to_string(),
                        is_remote: true,
                        is_current: false,
                    });
                }
            }
        }

        Ok(branches)
    })
    .await
    .map_err(|e| GitError::TaskJoin(e.to_string()))?
}

// --- Agent Worktree Lifecycle ---

const AGENT_WORKTREE_PREFIX: &str = "amend-agent-";
const AGENT_BRANCH_PREFIX: &str = "amend/agent/";

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Extract agent_id from a branch name like "amend/agent/{id}".
fn agent_id_from_branch(branch: &str) -> Option<&str> {
    branch.strip_prefix(AGENT_BRANCH_PREFIX)
}

/// Determine the current branch of the repo at `repo_path`.
fn current_branch_name(repo_path: &str) -> Result<String, GitError> {
    let output = run_git_command(repo_path, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    let branch = output.trim().to_string();
    if branch == "HEAD" {
        // Detached HEAD — use short hash instead
        let hash_output = run_git_command(repo_path, &["rev-parse", "--short", "HEAD"])?;
        Ok(hash_output.trim().to_string())
    } else {
        Ok(branch)
    }
}

fn create_agent_worktree_sync(repo_path: &str, agent_id: &str) -> Result<AgentWorktree, GitError> {
    validate_no_flag(agent_id, "agent_id")?;
    if agent_id.trim().is_empty() {
        return Err(GitError::InvalidArgument(
            "agent_id must not be empty".to_string(),
        ));
    }

    let branch_name = format!("{}{}", AGENT_BRANCH_PREFIX, agent_id);
    let dir_name = format!("{}{}", AGENT_WORKTREE_PREFIX, agent_id);
    let worktree_path = Path::new(repo_path).join(".worktrees").join(&dir_name);

    let worktree_path_str = worktree_path.to_string_lossy().to_string();

    // Determine the parent branch before creating the worktree
    let parent_branch = current_branch_name(repo_path)?;

    // Ensure .worktrees directory exists
    let worktrees_dir = Path::new(repo_path).join(".worktrees");
    std::fs::create_dir_all(&worktrees_dir)
        .map_err(|e| GitError::CommandFailed(format!("Failed to create .worktrees dir: {}", e)))?;

    // Check if the branch/worktree already exists
    let existing = list_worktrees_sync(repo_path)?;
    if let Some(wt) = existing.iter().find(|w| w.branch == branch_name) {
        // Worktree already exists — return it as AgentWorktree
        return Ok(AgentWorktree {
            id: agent_id.to_string(),
            path: wt.path.clone(),
            branch: branch_name,
            parent_branch,
            created_at: current_timestamp(),
            status: "active".to_string(),
        });
    }

    // Create new branch + worktree from current HEAD
    run_git_command(
        repo_path,
        &[
            "worktree",
            "add",
            "-b",
            &branch_name,
            "--",
            &worktree_path_str,
            "HEAD",
        ],
    )?;

    Ok(AgentWorktree {
        id: agent_id.to_string(),
        path: worktree_path_str,
        branch: branch_name,
        parent_branch,
        created_at: current_timestamp(),
        status: "active".to_string(),
    })
}

fn merge_agent_worktree_sync(
    repo_path: &str,
    agent_id: &str,
    strategy: &MergeStrategy,
) -> Result<(), GitError> {
    validate_no_flag(agent_id, "agent_id")?;
    let branch_name = format!("{}{}", AGENT_BRANCH_PREFIX, agent_id);

    // Verify the agent branch exists
    if !branch_exists_locally(repo_path, &branch_name)? {
        return Err(GitError::CommandFailed(format!(
            "Agent branch not found: {}",
            branch_name
        )));
    }

    match strategy {
        MergeStrategy::FastForward => {
            // Try fast-forward merge
            run_git_command(repo_path, &["merge", "--ff-only", &branch_name])?;
        }
        MergeStrategy::Squash => {
            // Squash merge — stages all changes but does not commit
            run_git_command(repo_path, &["merge", "--squash", &branch_name])?;
            // Commit the squashed changes
            let msg = format!("feat: merge agent workspace {}", agent_id);
            run_git_command(repo_path, &["commit", "-m", &msg])?;
        }
        MergeStrategy::CherryPick => {
            // Find commits unique to the agent branch and cherry-pick them
            let log_output = run_git_command(
                repo_path,
                &[
                    "log",
                    "--format=%H",
                    "--reverse",
                    &format!("HEAD..{}", branch_name),
                ],
            )?;
            for sha in log_output.lines() {
                let sha = sha.trim();
                if !sha.is_empty() {
                    run_git_command(repo_path, &["cherry-pick", sha])?;
                }
            }
        }
    }

    Ok(())
}

fn discard_agent_worktree_sync(repo_path: &str, agent_id: &str) -> Result<(), GitError> {
    validate_no_flag(agent_id, "agent_id")?;
    let branch_name = format!("{}{}", AGENT_BRANCH_PREFIX, agent_id);
    let dir_name = format!("{}{}", AGENT_WORKTREE_PREFIX, agent_id);
    let worktree_path = Path::new(repo_path).join(".worktrees").join(&dir_name);
    let worktree_path_str = worktree_path.to_string_lossy().to_string();

    // Remove the worktree (force in case of uncommitted changes)
    if worktree_path.exists() {
        run_git_command(
            repo_path,
            &["worktree", "remove", "--force", "--", &worktree_path_str],
        )?;
    }

    // Delete the branch
    if branch_exists_locally(repo_path, &branch_name)? {
        run_git_command(repo_path, &["branch", "-D", &branch_name])?;
    }

    Ok(())
}

fn list_agent_worktrees_sync(repo_path: &str) -> Result<Vec<AgentWorktree>, GitError> {
    let all_worktrees = list_worktrees_sync(repo_path)?;
    let parent_branch = current_branch_name(repo_path).unwrap_or_else(|_| "unknown".to_string());

    let mut agent_worktrees = Vec::new();
    for wt in &all_worktrees {
        if let Some(aid) = agent_id_from_branch(&wt.branch) {
            agent_worktrees.push(AgentWorktree {
                id: aid.to_string(),
                path: wt.path.clone(),
                branch: wt.branch.clone(),
                parent_branch: parent_branch.clone(),
                created_at: 0, // We don't persist creation time, 0 means unknown
                status: "active".to_string(),
            });
        }
    }

    Ok(agent_worktrees)
}

fn get_agent_worktree_diff_sync(
    repo_path: &str,
    agent_id: &str,
) -> Result<Vec<GitFileStatus>, GitError> {
    validate_no_flag(agent_id, "agent_id")?;
    let branch_name = format!("{}{}", AGENT_BRANCH_PREFIX, agent_id);

    if !branch_exists_locally(repo_path, &branch_name)? {
        return Err(GitError::CommandFailed(format!(
            "Agent branch not found: {}",
            branch_name
        )));
    }

    // Find the merge-base between HEAD and the agent branch
    let merge_base_output = run_git_command(repo_path, &["merge-base", "HEAD", &branch_name])?;
    let merge_base = merge_base_output.trim();

    // Get changed files between merge-base and agent branch tip
    let name_status_output = run_git_command(
        repo_path,
        &["diff", "--name-status", merge_base, &branch_name],
    )?;

    let mut files = Vec::new();
    for line in name_status_output.lines() {
        if line.is_empty() {
            continue;
        }
        let mut parts = line.splitn(2, '\t');
        let status_code = parts.next().unwrap_or("").trim();
        let path = parts.next().unwrap_or("").trim();
        if path.is_empty() {
            continue;
        }

        let status = match status_code.chars().next() {
            Some('A') => "added",
            Some('M') => "modified",
            Some('D') => "deleted",
            Some('R') => "renamed",
            Some('C') => "copied",
            _ => "modified",
        };

        files.push(GitFileStatus {
            path: path.to_string(),
            status: status.to_string(),
        });
    }

    Ok(files)
}

#[tauri::command]
pub async fn create_agent_worktree(
    repo_path: String,
    agent_id: String,
) -> Result<AgentWorktree, GitError> {
    spawn_blocking(move || create_agent_worktree_sync(&repo_path, &agent_id))
        .await
        .map_err(|e| GitError::TaskJoin(e.to_string()))?
}

#[tauri::command]
pub async fn merge_agent_worktree(
    repo_path: String,
    agent_id: String,
    strategy: MergeStrategy,
) -> Result<(), GitError> {
    spawn_blocking(move || merge_agent_worktree_sync(&repo_path, &agent_id, &strategy))
        .await
        .map_err(|e| GitError::TaskJoin(e.to_string()))?
}

#[tauri::command]
pub async fn discard_agent_worktree(repo_path: String, agent_id: String) -> Result<(), GitError> {
    spawn_blocking(move || discard_agent_worktree_sync(&repo_path, &agent_id))
        .await
        .map_err(|e| GitError::TaskJoin(e.to_string()))?
}

#[tauri::command]
pub async fn list_agent_worktrees(repo_path: String) -> Result<Vec<AgentWorktree>, GitError> {
    spawn_blocking(move || list_agent_worktrees_sync(&repo_path))
        .await
        .map_err(|e| GitError::TaskJoin(e.to_string()))?
}

#[tauri::command]
pub async fn get_agent_worktree_diff(
    repo_path: String,
    agent_id: String,
) -> Result<Vec<GitFileStatus>, GitError> {
    spawn_blocking(move || get_agent_worktree_diff_sync(&repo_path, &agent_id))
        .await
        .map_err(|e| GitError::TaskJoin(e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;

    mod validate_no_flag {
        use super::*;

        #[test]
        fn rejects_flag_starting_with_dash() {
            let result = validate_no_flag("--exec", "branch name");
            assert!(result.is_err());
            let err = result.unwrap_err();
            assert!(
                matches!(err, GitError::InvalidArgument(_)),
                "Expected InvalidArgument, got {:?}",
                err
            );
        }

        #[test]
        fn rejects_single_dash_flag() {
            assert!(validate_no_flag("-v", "arg").is_err());
        }

        #[test]
        fn accepts_normal_branch_name() {
            assert!(validate_no_flag("main", "branch name").is_ok());
            assert!(validate_no_flag("feature/my-branch", "branch name").is_ok());
        }

        #[test]
        fn accepts_empty_string() {
            assert!(validate_no_flag("", "arg").is_ok());
        }

        #[test]
        fn accepts_path_like_strings() {
            assert!(validate_no_flag("src/lib/main.rs", "file path").is_ok());
            assert!(validate_no_flag("file.txt", "file path").is_ok());
        }
    }

    mod is_image_extension_tests {
        use super::*;

        #[test]
        fn detects_common_image_formats() {
            assert!(is_image_extension("photo.png"));
            assert!(is_image_extension("photo.jpg"));
            assert!(is_image_extension("photo.jpeg"));
            assert!(is_image_extension("photo.gif"));
            assert!(is_image_extension("icon.svg"));
            assert!(is_image_extension("photo.webp"));
            assert!(is_image_extension("photo.bmp"));
            assert!(is_image_extension("favicon.ico"));
        }

        #[test]
        fn case_insensitive() {
            assert!(is_image_extension("PHOTO.PNG"));
            assert!(is_image_extension("Photo.JPG"));
            assert!(is_image_extension("icon.SVG"));
        }

        #[test]
        fn rejects_non_image_extensions() {
            assert!(!is_image_extension("main.rs"));
            assert!(!is_image_extension("style.css"));
            assert!(!is_image_extension("data.json"));
            assert!(!is_image_extension("README.md"));
        }

        #[test]
        fn handles_paths_with_directories() {
            assert!(is_image_extension("src/assets/logo.png"));
            assert!(is_image_extension("/home/user/photo.jpg"));
            assert!(!is_image_extension("src/lib/main.ts"));
        }

        #[test]
        fn handles_no_extension() {
            assert!(!is_image_extension("Makefile"));
            assert!(!is_image_extension(""));
        }

        #[test]
        fn handles_multiple_dots() {
            assert!(is_image_extension("my.photo.backup.png"));
            assert!(!is_image_extension("archive.tar.gz"));
        }
    }

    mod index_status_to_string_tests {
        use super::*;

        #[test]
        fn maps_index_new() {
            assert_eq!(index_status_to_string(git2::Status::INDEX_NEW), "added");
        }

        #[test]
        fn maps_index_modified() {
            assert_eq!(
                index_status_to_string(git2::Status::INDEX_MODIFIED),
                "modified"
            );
        }

        #[test]
        fn maps_index_deleted() {
            assert_eq!(
                index_status_to_string(git2::Status::INDEX_DELETED),
                "deleted"
            );
        }

        #[test]
        fn maps_index_renamed() {
            assert_eq!(
                index_status_to_string(git2::Status::INDEX_RENAMED),
                "renamed"
            );
        }
    }

    mod wt_status_to_string_tests {
        use super::*;

        #[test]
        fn maps_wt_new() {
            assert_eq!(wt_status_to_string(git2::Status::WT_NEW), "added");
        }

        #[test]
        fn maps_wt_modified() {
            assert_eq!(wt_status_to_string(git2::Status::WT_MODIFIED), "modified");
        }

        #[test]
        fn maps_wt_deleted() {
            assert_eq!(wt_status_to_string(git2::Status::WT_DELETED), "deleted");
        }

        #[test]
        fn maps_wt_renamed() {
            assert_eq!(wt_status_to_string(git2::Status::WT_RENAMED), "renamed");
        }
    }

    mod validate_repo_containment_tests {
        use super::*;

        /// Helper: create a temp dir with a git repo initialized in it.
        fn setup_repo() -> (tempfile::TempDir, Repository) {
            let dir = tempfile::tempdir().expect("failed to create temp dir");
            let repo = Repository::init(dir.path()).expect("failed to init repo");
            (dir, repo)
        }

        #[test]
        fn accepts_simple_relative_path() {
            let (dir, repo) = setup_repo();
            // Create the file so canonicalize succeeds
            let file = dir.path().join("hello.txt");
            std::fs::write(&file, "content").unwrap();

            let result = validate_repo_containment(&repo, "hello.txt");
            assert!(result.is_ok(), "expected Ok, got {:?}", result);
        }

        #[test]
        fn accepts_nested_relative_path() {
            let (dir, repo) = setup_repo();
            let sub = dir.path().join("src");
            std::fs::create_dir(&sub).unwrap();
            std::fs::write(sub.join("main.rs"), "fn main(){}").unwrap();

            let result = validate_repo_containment(&repo, "src/main.rs");
            assert!(result.is_ok());
        }

        #[test]
        fn rejects_absolute_path() {
            let (_dir, repo) = setup_repo();
            let result = validate_repo_containment(&repo, "/etc/passwd");
            assert!(result.is_err());
            let err = result.unwrap_err().to_string();
            assert!(
                err.contains("must be relative"),
                "unexpected error: {}",
                err
            );
        }

        #[test]
        fn rejects_parent_traversal() {
            let (_dir, repo) = setup_repo();
            let result = validate_repo_containment(&repo, "../../../etc/passwd");
            assert!(result.is_err());
            let err = result.unwrap_err().to_string();
            assert!(
                err.contains("must not contain '..'"),
                "unexpected error: {}",
                err
            );
        }

        #[test]
        fn rejects_embedded_parent_traversal() {
            let (_dir, repo) = setup_repo();
            let result = validate_repo_containment(&repo, "src/../../etc/passwd");
            assert!(result.is_err());
            let err = result.unwrap_err().to_string();
            assert!(
                err.contains("must not contain '..'"),
                "unexpected error: {}",
                err
            );
        }

        #[test]
        fn rejects_symlink_escape() {
            let (dir, repo) = setup_repo();
            // Create a symlink inside the repo that points outside
            let link_path = dir.path().join("escape");
            #[cfg(unix)]
            std::os::unix::fs::symlink("/tmp", &link_path).unwrap();
            #[cfg(windows)]
            std::os::windows::fs::symlink_dir("C:\\Windows", &link_path).unwrap();

            // Create a target file outside the repo for the symlink to reach
            let outside_file = std::path::Path::new("/tmp/amend_test_containment.txt");
            std::fs::write(outside_file, "secret").ok();

            let result = validate_repo_containment(&repo, "escape/amend_test_containment.txt");
            assert!(result.is_err());
            let err = result.unwrap_err().to_string();
            assert!(
                err.contains("escapes repository"),
                "unexpected error: {}",
                err
            );

            // Clean up
            std::fs::remove_file(outside_file).ok();
        }

        #[test]
        fn allows_nonexistent_file_within_repo() {
            let (_dir, repo) = setup_repo();
            // File doesn't exist but parent (workdir root) does — should be OK
            let result = validate_repo_containment(&repo, "new_file.txt");
            assert!(result.is_ok(), "expected Ok, got {:?}", result);
        }
    }

    mod get_file_diff_containment_tests {
        use super::*;

        fn setup_repo_with_commit() -> (tempfile::TempDir, Repository) {
            let dir = tempfile::tempdir().expect("failed to create temp dir");
            let repo = Repository::init(dir.path()).expect("failed to init repo");

            // Create a file and make an initial commit so HEAD exists
            let file = dir.path().join("readme.txt");
            std::fs::write(&file, "initial content").unwrap();

            let mut index = repo.index().unwrap();
            index.add_path(std::path::Path::new("readme.txt")).unwrap();
            index.write().unwrap();
            let tree_oid = index.write_tree().unwrap();
            {
                let tree = repo.find_tree(tree_oid).unwrap();
                let sig = git2::Signature::now("test", "test@test.com").unwrap();
                repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[])
                    .unwrap();
            }

            (dir, repo)
        }

        #[test]
        fn rejects_absolute_path_through_diff() {
            let (dir, _repo) = setup_repo_with_commit();
            let repo_path = dir.path().to_str().unwrap();
            let result = get_file_diff_sync(repo_path, "/etc/passwd");
            assert!(result.is_err());
            let err = result.unwrap_err().to_string();
            assert!(
                err.contains("must be relative"),
                "unexpected error: {}",
                err
            );
        }

        #[test]
        fn rejects_parent_traversal_through_diff() {
            let (dir, _repo) = setup_repo_with_commit();
            let repo_path = dir.path().to_str().unwrap();
            let result = get_file_diff_sync(repo_path, "../../../etc/passwd");
            assert!(result.is_err());
            let err = result.unwrap_err().to_string();
            assert!(
                err.contains("must not contain '..'"),
                "unexpected error: {}",
                err
            );
        }

        #[test]
        #[cfg(unix)]
        fn rejects_symlink_escape_through_diff() {
            let (dir, _repo) = setup_repo_with_commit();
            let repo_path = dir.path().to_str().unwrap();

            // Create a symlink inside the repo that points outside
            let link_path = dir.path().join("escape");
            std::os::unix::fs::symlink("/tmp", &link_path).unwrap();

            let outside_file = std::path::Path::new("/tmp/amend_diff_test.txt");
            std::fs::write(outside_file, "secret").ok();

            let result = get_file_diff_sync(repo_path, "escape/amend_diff_test.txt");
            assert!(result.is_err());
            let err = result.unwrap_err().to_string();
            assert!(
                err.contains("escapes repository"),
                "unexpected error: {}",
                err
            );

            std::fs::remove_file(outside_file).ok();
        }

        #[test]
        fn accepts_valid_file_through_diff() {
            let (dir, _repo) = setup_repo_with_commit();
            let repo_path = dir.path().to_str().unwrap();

            // readme.txt was committed, so diff should succeed
            let result = get_file_diff_sync(repo_path, "readme.txt");
            assert!(result.is_ok(), "expected Ok, got {:?}", result);
            let diff = result.unwrap();
            assert_eq!(diff.new_content, "initial content");
        }
    }

    mod get_branch_file_diff_containment_tests {
        use super::*;

        fn setup_repo_with_commit() -> (tempfile::TempDir, Repository) {
            let dir = tempfile::tempdir().expect("failed to create temp dir");
            let repo = Repository::init(dir.path()).expect("failed to init repo");

            let file = dir.path().join("readme.txt");
            std::fs::write(&file, "initial").unwrap();

            let mut index = repo.index().unwrap();
            index.add_path(std::path::Path::new("readme.txt")).unwrap();
            index.write().unwrap();
            let tree_oid = index.write_tree().unwrap();
            {
                let tree = repo.find_tree(tree_oid).unwrap();
                let sig = git2::Signature::now("test", "test@test.com").unwrap();
                repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[])
                    .unwrap();
            }

            (dir, repo)
        }

        #[test]
        fn rejects_absolute_path_through_branch_diff() {
            let (dir, _repo) = setup_repo_with_commit();
            let repo_path = dir.path().to_str().unwrap();
            let result = get_branch_file_diff_sync(repo_path, "HEAD", "/etc/passwd");
            assert!(result.is_err());
            let err = result.unwrap_err().to_string();
            assert!(
                err.contains("must be relative"),
                "unexpected error: {}",
                err
            );
        }

        #[test]
        fn rejects_parent_traversal_through_branch_diff() {
            let (dir, _repo) = setup_repo_with_commit();
            let repo_path = dir.path().to_str().unwrap();
            let result = get_branch_file_diff_sync(repo_path, "HEAD", "../../etc/passwd");
            assert!(result.is_err());
            let err = result.unwrap_err().to_string();
            assert!(
                err.contains("must not contain '..'"),
                "unexpected error: {}",
                err
            );
        }
    }

    mod worktree_path_injection_tests {
        use super::*;

        #[test]
        fn rejects_worktree_path_with_double_dash_flag() {
            let result = validate_no_flag("--exec=evil", "worktree path");
            assert!(result.is_err());
            let err = result.unwrap_err().to_string();
            assert!(
                err.contains("must not start with '-'"),
                "unexpected error: {}",
                err
            );
        }

        #[test]
        fn rejects_worktree_path_with_single_dash_flag() {
            let result = validate_no_flag("-b", "worktree path");
            assert!(result.is_err());
        }

        #[test]
        fn rejects_worktree_path_with_force_flag() {
            let result = validate_no_flag("--force", "worktree path");
            assert!(result.is_err());
        }

        #[test]
        fn accepts_normal_worktree_path() {
            assert!(validate_no_flag("/home/user/worktrees/feature", "worktree path").is_ok());
            assert!(validate_no_flag("../worktrees/feature", "worktree path").is_ok());
            assert!(validate_no_flag("my-worktree", "worktree path").is_ok());
        }
    }
}
