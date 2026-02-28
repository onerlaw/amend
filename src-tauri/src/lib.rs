mod error;
mod filesystem;
mod git;
mod lsp;
mod symbols;
mod terminal;
mod watcher;

use filesystem::{FileSystemManager, SearchGeneration};
use lsp::LspManager;
use symbols::{SymbolDefinition, SymbolIndex, SymbolReference};
use tauri::{Emitter, State};
use terminal::TerminalManager;
use tokio::task::spawn_blocking;
use watcher::FileWatcher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(TerminalManager::new())
        .manage(LspManager::new())
        .manage(FileSystemManager::new())
        .manage(SearchGeneration::new())
        .manage(SymbolIndex::new())
        .manage(FileWatcher::new())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("window-close-requested", ());
            }
        })
        .invoke_handler(tauri::generate_handler![
            // Terminal commands
            terminal::create_terminal,
            terminal::write_to_terminal,
            terminal::resize_terminal,
            terminal::close_terminal,
            terminal::is_terminal_busy,
            force_quit,
            // LSP commands
            lsp::lsp_start_server,
            lsp::lsp_send_message,
            lsp::lsp_stop_server,
            // File system commands
            filesystem::read_directory,
            filesystem::read_directories,
            filesystem::read_file,
            filesystem::read_file_base64,
            filesystem::get_file_size,
            filesystem::write_file,
            filesystem::search_files,
            filesystem::rename_entry,
            filesystem::delete_file,
            filesystem::delete_directory,
            filesystem::create_directory,
            filesystem::reveal_in_file_manager,
            filesystem::copy_entry,
            filesystem::move_entry,
            filesystem::get_clipboard_file_paths,
            // Git commands
            git::get_git_root,
            git::get_git_repo_info,
            git::is_git_repository,
            git::get_git_status,
            git::get_file_diff,
            git::git_poll_data,
            git::git_quick_check,
            git::list_worktrees,
            git::add_worktree,
            git::open_or_create_worktree,
            git::get_default_branch,
            git::remove_worktree,
            git::list_branches,
            git::get_branch_diff_files,
            git::get_branch_file_diff,
            git::restore_file,
            git::unstage_file,
            git::stage_file,
            git::get_diff_stats,
            // Watcher commands
            watcher::start_watching_directory,
            watcher::stop_watching_directory,
            // Symbol navigation commands
            index_project,
            remove_file_from_index,
            find_definition,
            find_references,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn force_quit(app: tauri::AppHandle) {
    app.exit(0);
}

// Symbol navigation commands

#[tauri::command]
async fn index_project(root_path: String, index: State<'_, SymbolIndex>) -> Result<(), String> {
    let idx = index.inner().clone();
    spawn_blocking(move || idx.index_project(&root_path))
        .await
        .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
fn remove_file_from_index(file_path: String, index: State<'_, SymbolIndex>) {
    index.remove_file(&file_path);
}

#[tauri::command]
async fn find_definition(
    symbol: String,
    index: State<'_, SymbolIndex>,
) -> Result<Vec<SymbolDefinition>, String> {
    let idx = index.inner().clone();
    let result = spawn_blocking(move || idx.find_definition(&symbol))
        .await
        .map_err(|e| format!("Task failed: {}", e))?;
    Ok(result)
}

#[tauri::command]
async fn find_references(
    symbol: String,
    root_path: String,
    index: State<'_, SymbolIndex>,
) -> Result<Vec<SymbolReference>, String> {
    let idx = index.inner().clone();
    let result = spawn_blocking(move || idx.find_references(&symbol, &root_path))
        .await
        .map_err(|e| format!("Task failed: {}", e))?;
    Ok(result)
}
