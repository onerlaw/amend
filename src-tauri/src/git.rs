use git2::{DiffOptions, Repository, StatusOptions};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum GitError {
    #[error("Git error: {0}")]
    Git(#[from] git2::Error),
    #[error("Repository not found at: {0}")]
    NotARepo(String),
    #[error("Command failed: {0}")]
    CommandFailed(String),
}

impl Serialize for GitError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
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

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitStatus {
    pub staged: Vec<GitFileStatus>,
    pub unstaged: Vec<GitFileStatus>,
    pub untracked: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitDiff {
    pub old_path: String,
    pub new_path: String,
    pub old_content: String,
    pub new_content: String,
}

fn status_to_string(status: git2::Status) -> &'static str {
    if status.is_index_new() || status.is_wt_new() {
        "added"
    } else if status.is_index_modified() || status.is_wt_modified() {
        "modified"
    } else if status.is_index_deleted() || status.is_wt_deleted() {
        "deleted"
    } else if status.is_index_renamed() || status.is_wt_renamed() {
        "renamed"
    } else {
        "unknown"
    }
}

#[tauri::command]
pub fn is_git_repository(path: String) -> bool {
    Repository::discover(&path).is_ok()
}

#[tauri::command]
pub fn get_git_status(repo_path: String) -> Result<GitStatus, GitError> {
    let repo = Repository::discover(&repo_path)?;

    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false);

    let statuses = repo.statuses(Some(&mut opts))?;

    let mut result = GitStatus {
        staged: Vec::new(),
        unstaged: Vec::new(),
        untracked: Vec::new(),
    };

    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("").to_string();
        let status = entry.status();

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
                    status: status_to_string(status).to_string(),
                });
            }

            // Check for unstaged changes
            if status.is_wt_modified() || status.is_wt_deleted() || status.is_wt_renamed() {
                result.unstaged.push(GitFileStatus {
                    path,
                    status: status_to_string(status).to_string(),
                });
            }
        }
    }

    Ok(result)
}

#[tauri::command]
pub fn get_file_diff(repo_path: String, file_path: String) -> Result<GitDiff, GitError> {
    let repo = Repository::discover(&repo_path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| GitError::NotARepo(repo_path.clone()))?;

    let full_path = workdir.join(&file_path);
    let relative_path = Path::new(&file_path);

    // Get current file content
    let new_content = if full_path.exists() {
        std::fs::read_to_string(&full_path).unwrap_or_default()
    } else {
        String::new()
    };

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
        old_path: file_path.clone(),
        new_path: file_path,
        old_content,
        new_content,
    })
}

#[tauri::command]
pub fn get_staged_diff(repo_path: String) -> Result<Vec<GitDiff>, GitError> {
    let repo = Repository::discover(&repo_path)?;

    let mut diffs = Vec::new();

    // Get diff between HEAD and index (staged changes)
    let head = repo.head()?.peel_to_tree()?;
    let mut opts = DiffOptions::new();
    let diff = repo.diff_tree_to_index(Some(&head), None, Some(&mut opts))?;

    for delta in diff.deltas() {
        let old_path = delta
            .old_file()
            .path()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        let new_path = delta
            .new_file()
            .path()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        // Get old content from HEAD
        let old_content = if let Ok(entry) = head.get_path(Path::new(&old_path)) {
            if let Ok(blob) = repo.find_blob(entry.id()) {
                String::from_utf8_lossy(blob.content()).to_string()
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        // Get new content from index
        let index = repo.index()?;
        let new_content = if let Some(entry) = index.get_path(Path::new(&new_path), 0) {
            if let Ok(blob) = repo.find_blob(entry.id) {
                String::from_utf8_lossy(blob.content()).to_string()
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        diffs.push(GitDiff {
            old_path,
            new_path,
            old_content,
            new_content,
        });
    }

    Ok(diffs)
}

#[tauri::command]
pub fn list_worktrees(repo_path: String) -> Result<Vec<GitWorktree>, GitError> {
    let output = Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| GitError::CommandFailed(e.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitError::CommandFailed(stderr.to_string()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
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
pub fn add_worktree(
    repo_path: String,
    worktree_path: String,
    branch: Option<String>,
    new_branch: Option<String>,
) -> Result<GitWorktree, GitError> {
    let mut args = vec!["worktree", "add"];

    // Build arguments based on options
    let new_branch_arg;
    if let Some(ref new_branch_name) = new_branch {
        args.push("-b");
        new_branch_arg = new_branch_name.clone();
        args.push(&new_branch_arg);
    }

    args.push(&worktree_path);

    let branch_arg;
    if let Some(ref branch_name) = branch {
        branch_arg = branch_name.clone();
        args.push(&branch_arg);
    }

    let output = Command::new("git")
        .args(&args)
        .current_dir(&repo_path)
        .output()
        .map_err(|e| GitError::CommandFailed(e.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitError::CommandFailed(stderr.to_string()));
    }

    // Determine the branch name for the result
    let result_branch = new_branch
        .or(branch)
        .unwrap_or_else(|| "HEAD".to_string());

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
}

#[tauri::command]
pub fn remove_worktree(
    repo_path: String,
    worktree_path: String,
    force: bool,
) -> Result<(), GitError> {
    let mut args = vec!["worktree", "remove"];

    if force {
        args.push("--force");
    }

    args.push(&worktree_path);

    let output = Command::new("git")
        .args(&args)
        .current_dir(&repo_path)
        .output()
        .map_err(|e| GitError::CommandFailed(e.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitError::CommandFailed(stderr.to_string()));
    }

    Ok(())
}
