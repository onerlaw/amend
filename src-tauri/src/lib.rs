mod error;
mod filesystem;
mod git;
mod lsp;
mod mcp;
mod session;
mod snapshot;
mod symbols;
mod terminal;
mod terminal_buffer;
mod terminal_metadata;
mod watcher;

use filesystem::{FileSystemManager, SearchGeneration};
use lsp::LspManager;
use mcp::{McpServer, McpServerHandle};
use session::SessionCapture;
use std::sync::Arc;
use symbols::{
    CallGraphNode, CallRelation, ImportInfo, SemanticSearchResult, SymbolDefinition, SymbolIndex,
    SymbolReference,
};
use tauri::{Emitter, Manager, State};
use terminal::TerminalManager;
use terminal_buffer::OutputBufferRegistry;
use terminal_metadata::TerminalMetadataStore;
use tokio::task::spawn_blocking;
use watcher::FileWatcher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let terminal_manager = Arc::new(TerminalManager::new());
    let output_buffers = Arc::new(OutputBufferRegistry::new());
    let metadata_store = Arc::new(TerminalMetadataStore::new());
    let mcp_handle = McpServerHandle::new();
    let session_capture = SessionCapture::new();

    // Clone Arcs for the setup hook
    let tm_for_mcp = Arc::clone(&terminal_manager);
    let ob_for_mcp = Arc::clone(&output_buffers);
    let ms_for_mcp = Arc::clone(&metadata_store);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(terminal_manager)
        .manage(output_buffers)
        .manage(metadata_store)
        .manage(mcp_handle)
        .manage(session_capture)
        .manage(LspManager::new())
        .manage(FileSystemManager::new())
        .manage(SearchGeneration::new())
        .manage(SymbolIndex::new())
        .manage(FileWatcher::new())
        .setup(move |app| {
            // Initialize session capture data directory and load persisted sessions
            let session_state: tauri::State<'_, SessionCapture> = app.state();
            if let Ok(app_data_dir) = app.path().app_data_dir() {
                session_state.set_data_dir(app_data_dir);
                if let Err(e) = session_state.load_sessions() {
                    eprintln!("[session] Failed to load sessions: {}", e);
                }
            }

            let mcp_handle: tauri::State<'_, McpServerHandle> = app.state();
            let mcp_handle_inner = mcp_handle.inner().clone();

            // Spawn MCP server on the async runtime
            tauri::async_runtime::spawn(async move {
                match McpServer::start(ob_for_mcp, ms_for_mcp, tm_for_mcp).await {
                    Ok(port) => {
                        mcp_handle_inner.set_port(port).await;
                    }
                    Err(e) => {
                        eprintln!("[MCP] Failed to start server: {}", e);
                    }
                }
            });

            Ok(())
        })
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
            // MCP commands
            mcp::get_mcp_server_port,
            mcp::register_mcp_server,
            mcp::check_mcp_registrations,
            // Terminal metadata commands
            terminal_metadata::sync_terminal_metadata,
            terminal_metadata::remove_terminal_metadata,
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
            // Session timeline commands
            session::start_session_recording,
            session::stop_session_recording,
            session::list_sessions,
            session::get_session,
            session::delete_session,
            session::record_session_event,
            // Snapshot commands
            snapshot::create_snapshot,
            snapshot::list_snapshots,
            snapshot::restore_snapshot,
            snapshot::delete_snapshot,
            snapshot::diff_snapshot,
            snapshot::get_snapshot_file_diff,
            // Watcher commands
            watcher::start_watching_directory,
            watcher::stop_watching_directory,
            // Symbol navigation commands
            index_project,
            remove_file_from_index,
            find_definition,
            find_references,
            // Semantic search commands
            find_callers,
            find_callees,
            find_importers,
            get_call_graph,
            semantic_search,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
async fn force_quit(
    app: tauri::AppHandle,
    mcp_handle: State<'_, McpServerHandle>,
) -> Result<(), String> {
    let port = mcp_handle.get_port().await;
    mcp::remove_discovery_file(port);
    app.exit(0);
    Ok(())
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

// Semantic search commands

#[tauri::command]
async fn find_callers(
    symbol: String,
    index: State<'_, SymbolIndex>,
) -> Result<Vec<CallRelation>, String> {
    let idx = index.inner().clone();
    let result = spawn_blocking(move || idx.find_callers(&symbol))
        .await
        .map_err(|e| format!("Task failed: {}", e))?;
    Ok(result)
}

#[tauri::command]
async fn find_callees(
    symbol: String,
    index: State<'_, SymbolIndex>,
) -> Result<Vec<CallRelation>, String> {
    let idx = index.inner().clone();
    let result = spawn_blocking(move || idx.find_callees(&symbol))
        .await
        .map_err(|e| format!("Task failed: {}", e))?;
    Ok(result)
}

#[tauri::command]
async fn find_importers(
    symbol: String,
    index: State<'_, SymbolIndex>,
) -> Result<Vec<ImportInfo>, String> {
    let idx = index.inner().clone();
    let result = spawn_blocking(move || idx.find_importers(&symbol))
        .await
        .map_err(|e| format!("Task failed: {}", e))?;
    Ok(result)
}

#[tauri::command]
async fn get_call_graph(
    symbol: String,
    max_depth: Option<usize>,
    index: State<'_, SymbolIndex>,
) -> Result<Option<CallGraphNode>, String> {
    let idx = index.inner().clone();
    let depth = max_depth.unwrap_or(3);
    let result = spawn_blocking(move || idx.get_call_graph(&symbol, depth))
        .await
        .map_err(|e| format!("Task failed: {}", e))?;
    Ok(result)
}

#[tauri::command]
async fn semantic_search(
    query: String,
    limit: Option<usize>,
    index: State<'_, SymbolIndex>,
) -> Result<Vec<SemanticSearchResult>, String> {
    let idx = index.inner().clone();
    let max = limit.unwrap_or(50);
    let result = spawn_blocking(move || idx.semantic_search(&query, max))
        .await
        .map_err(|e| format!("Task failed: {}", e))?;
    Ok(result)
}
