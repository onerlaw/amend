mod filesystem;
mod git;
mod symbols;
mod terminal;

use filesystem::FileSystemManager;
use symbols::{SymbolDefinition, SymbolManager};
use terminal::TerminalManager;
use tauri::State;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(TerminalManager::new())
        .manage(FileSystemManager::new())
        .manage(SymbolManager::new())
        .invoke_handler(tauri::generate_handler![
            // Terminal commands
            terminal::create_terminal,
            terminal::write_to_terminal,
            terminal::resize_terminal,
            terminal::close_terminal,
            // File system commands
            filesystem::read_directory,
            filesystem::read_file,
            filesystem::write_file,
            filesystem::watch_directory,
            filesystem::unwatch_directory,
            filesystem::search_files,
            filesystem::rename_entry,
            filesystem::delete_file,
            filesystem::delete_directory,
            filesystem::reveal_in_file_manager,
            filesystem::copy_entry,
            filesystem::move_entry,
            // Git commands
            git::is_git_repository,
            git::get_git_status,
            git::get_file_diff,
            git::get_staged_diff,
            git::list_worktrees,
            git::add_worktree,
            git::remove_worktree,
            git::list_branches,
            git::restore_file,
            git::unstage_file,
            // Symbol navigation commands
            index_project,
            find_definition,
            reindex_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// Symbol navigation commands

#[tauri::command]
fn index_project(root_path: String, manager: State<SymbolManager>) -> Result<(), String> {
    manager.index_project(&root_path)
}

#[tauri::command]
fn find_definition(
    symbol: String,
    current_file: String,
    manager: State<SymbolManager>,
) -> Vec<SymbolDefinition> {
    manager.find_definition(&symbol, &current_file)
}

#[tauri::command]
fn reindex_file(path: String, content: String, manager: State<SymbolManager>) -> Result<(), String> {
    manager.reindex_file(&path, &content)
}
