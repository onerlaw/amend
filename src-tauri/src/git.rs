use crate::error::impl_serialize_as_string;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use git2::{DiffOptions, Repository, StatusOptions};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;
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
pub async fn is_git_repository(path: String) -> bool {
    spawn_blocking(move || Repository::discover(&path).is_ok())
        .await
        .unwrap_or(false)
}

#[tauri::command]
pub async fn get_git_status(repo_path: String) -> Result<GitStatus, GitError> {
    spawn_blocking(move || get_git_status_sync(&repo_path))
        .await
        .unwrap()
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
        .unwrap()
}

fn get_file_diff_sync(repo_path: &str, file_path: &str) -> Result<GitDiff, GitError> {
    let repo = Repository::discover(repo_path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| GitError::NotARepo(repo_path.to_string()))?;

    let full_path = workdir.join(file_path);
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
        old_path: file_path.to_string(),
        new_path: file_path.to_string(),
        old_content,
        new_content,
        is_binary: false,
    })
}

#[tauri::command]
pub fn list_worktrees(repo_path: String) -> Result<Vec<GitWorktree>, GitError> {
    let stdout = run_git_command(&repo_path, &["worktree", "list", "--porcelain"])?;
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
    // Validate branch names don't start with '-'
    if let Some(ref b) = branch {
        validate_no_flag(b, "branch name")?;
    }
    if let Some(ref nb) = new_branch {
        validate_no_flag(nb, "new branch name")?;
    }

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

    run_git_command(&repo_path, &args)?;
    Ok(())
}

#[tauri::command]
pub fn restore_file(repo_path: String, file_path: String) -> Result<(), GitError> {
    validate_no_flag(&file_path, "file path")?;
    run_git_command(&repo_path, &["restore", "--", &file_path])?;
    Ok(())
}

#[tauri::command]
pub fn unstage_file(repo_path: String, file_path: String) -> Result<(), GitError> {
    validate_no_flag(&file_path, "file path")?;
    run_git_command(&repo_path, &["restore", "--staged", "--", &file_path])?;
    Ok(())
}

#[tauri::command]
pub fn stage_file(repo_path: String, file_path: String) -> Result<(), GitError> {
    validate_no_flag(&file_path, "file path")?;
    run_git_command(&repo_path, &["add", "--", &file_path])?;
    Ok(())
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
        .unwrap()
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
}

#[tauri::command]
pub async fn git_poll_data(repo_path: String) -> Result<GitPollData, GitError> {
    spawn_blocking(move || git_poll_data_sync(&repo_path))
        .await
        .unwrap()
}

fn git_poll_data_sync(repo_path: &str) -> Result<GitPollData, GitError> {
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

    Ok(GitPollData { status, diff_stats })
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
        .unwrap()
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
        .unwrap()
}

fn get_branch_file_diff_sync(
    repo_path: &str,
    base_ref: &str,
    file_path: &str,
) -> Result<GitDiff, GitError> {
    let repo = Repository::discover(repo_path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| GitError::NotARepo(repo_path.to_string()))?;

    let full_path = workdir.join(file_path);

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

    // Read current working tree file
    let new_content = if full_path.exists() {
        std::fs::read_to_string(&full_path).unwrap_or_default()
    } else {
        String::new()
    };

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
pub fn list_branches(repo_path: String) -> Result<Vec<GitBranch>, GitError> {
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
}
