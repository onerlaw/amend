use crate::terminal::TerminalManager;
use crate::terminal_buffer::OutputBufferRegistry;
use crate::terminal_metadata::TerminalMetadataStore;
use axum::extract::State as AxumState;
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::Json;
use futures_util::stream::Stream;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::convert::Infallible;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use tower_http::cors::CorsLayer;

const MAX_READ_LINES: usize = 10_000;

// --- JSON-RPC types ---

#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    #[allow(dead_code)]
    jsonrpc: String,
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Option<Value>,
}

#[derive(Debug, Serialize)]
struct JsonRpcResponse {
    jsonrpc: String,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize)]
struct JsonRpcError {
    code: i64,
    message: String,
}

impl JsonRpcResponse {
    fn success(id: Value, result: Value) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            result: Some(result),
            error: None,
        }
    }

    fn error(id: Value, code: i64, message: String) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            result: None,
            error: Some(JsonRpcError { code, message }),
        }
    }
}

// --- MCP Server State ---

#[derive(Clone)]
pub struct McpServerState {
    pub output_buffers: Arc<OutputBufferRegistry>,
    pub metadata_store: Arc<TerminalMetadataStore>,
    pub terminal_manager: Arc<TerminalManager>,
    pub response_tx: broadcast::Sender<String>,
}

// --- MCP Server ---

pub struct McpServer;

impl McpServer {
    pub async fn start(
        output_buffers: Arc<OutputBufferRegistry>,
        metadata_store: Arc<TerminalMetadataStore>,
        terminal_manager: Arc<TerminalManager>,
    ) -> Result<u16, Box<dyn std::error::Error + Send + Sync>> {
        let (response_tx, _) = broadcast::channel::<String>(256);

        let state = McpServerState {
            output_buffers,
            metadata_store,
            terminal_manager,
            response_tx,
        };

        let app = axum::Router::new()
            .route("/sse", get(sse_handler))
            .route("/message", post(message_handler))
            .layer(CorsLayer::permissive())
            .with_state(state);

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
        let addr = listener.local_addr()?;
        let port = addr.port();

        eprintln!("[MCP] Server started on port {}", port);

        // Write discovery file
        write_discovery_file(port);

        tokio::spawn(async move {
            if let Err(e) = axum::serve(listener, app).await {
                eprintln!("[MCP] Server error: {}", e);
            }
        });

        Ok(port)
    }
}

// --- SSE Handler ---

async fn sse_handler(
    AxumState(state): AxumState<McpServerState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let mut rx = state.response_tx.subscribe();

    let stream = async_stream::stream! {
        // Send the endpoint event so the client knows where to POST
        yield Ok(Event::default()
            .event("endpoint")
            .data("/message"));

        // Stream JSON-RPC responses
        loop {
            match rx.recv().await {
                Ok(data) => {
                    yield Ok(Event::default()
                        .event("message")
                        .data(data));
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    eprintln!("[MCP] SSE receiver lagged, skipped {} messages", n);
                    continue;
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    };

    Sse::new(stream).keep_alive(KeepAlive::default())
}

// --- Message Handler ---

async fn message_handler(
    AxumState(state): AxumState<McpServerState>,
    Json(req): Json<JsonRpcRequest>,
) -> impl IntoResponse {
    let id = req.id.clone().unwrap_or(Value::Null);

    let response = match req.method.as_str() {
        "initialize" => handle_initialize(id),
        "notifications/initialized" => {
            // No response needed for notifications
            return StatusCode::ACCEPTED.into_response();
        }
        "ping" => JsonRpcResponse::success(id, json!({})),
        "tools/list" => handle_tools_list(id),
        "tools/call" => handle_tools_call(id, req.params, &state).await,
        _ => JsonRpcResponse::error(id, -32601, format!("Method not found: {}", req.method)),
    };

    let json_str = serde_json::to_string(&response).unwrap_or_default();

    // Send via SSE channel
    let _ = state.response_tx.send(json_str);

    StatusCode::ACCEPTED.into_response()
}

// --- MCP Protocol Handlers ---

fn handle_initialize(id: Value) -> JsonRpcResponse {
    JsonRpcResponse::success(
        id,
        json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "tools": {}
            },
            "serverInfo": {
                "name": "amend-terminal-mcp",
                "version": "0.1.0"
            }
        }),
    )
}

fn handle_tools_list(id: Value) -> JsonRpcResponse {
    JsonRpcResponse::success(
        id,
        json!({
            "tools": [
                {
                    "name": "list_terminals",
                    "description": "List all open terminals with their metadata (id, cwd, title, gitRoot, repoName, worktreeName, isBusy, lastLine preview).",
                    "inputSchema": {
                        "type": "object",
                        "properties": {},
                        "required": []
                    }
                },
                {
                    "name": "read_terminal_output",
                    "description": "Read the last N lines of ANSI-stripped output from a terminal's ring buffer.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "terminal_id": {
                                "type": "string",
                                "description": "The terminal ID to read output from."
                            },
                            "lines": {
                                "type": "integer",
                                "description": "Number of lines to return (default 200, max 10000).",
                                "default": 200
                            }
                        },
                        "required": ["terminal_id"]
                    }
                },
                {
                    "name": "is_terminal_busy",
                    "description": "Check whether a terminal has a foreground child process running.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "terminal_id": {
                                "type": "string",
                                "description": "The terminal ID to check."
                            }
                        },
                        "required": ["terminal_id"]
                    }
                },
                {
                    "name": "write_to_terminal",
                    "description": "Send raw input to a terminal's PTY. Include \\n to execute a command.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "terminal_id": {
                                "type": "string",
                                "description": "The terminal ID to write to."
                            },
                            "input": {
                                "type": "string",
                                "description": "The input string to send. Include \\n to press Enter."
                            }
                        },
                        "required": ["terminal_id", "input"]
                    }
                },
                {
                    "name": "create_isolated_workspace",
                    "description": "Create an isolated git worktree for agent work. Returns the workspace path and branch name.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "repo_path": {
                                "type": "string",
                                "description": "Path to the git repository."
                            },
                            "agent_id": {
                                "type": "string",
                                "description": "Optional agent identifier. Auto-generated if not provided."
                            }
                        },
                        "required": ["repo_path"]
                    }
                },
                {
                    "name": "get_workspace_status",
                    "description": "Get the status of all agent workspaces for a repository, including changed files.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "repo_path": {
                                "type": "string",
                                "description": "Path to the git repository."
                            }
                        },
                        "required": ["repo_path"]
                    }
                },
                {
                    "name": "complete_workspace",
                    "description": "Signal that agent work in an isolated workspace is complete. Does not merge — just marks the workspace as completed.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "repo_path": {
                                "type": "string",
                                "description": "Path to the git repository."
                            },
                            "agent_id": {
                                "type": "string",
                                "description": "The agent identifier for the workspace to complete."
                            }
                        },
                        "required": ["repo_path", "agent_id"]
                    }
                }
            ]
        }),
    )
}

async fn handle_tools_call(
    id: Value,
    params: Option<Value>,
    state: &McpServerState,
) -> JsonRpcResponse {
    let params = match params {
        Some(p) => p,
        None => {
            return JsonRpcResponse::error(id, -32602, "Missing params".to_string());
        }
    };

    let tool_name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");

    let arguments = params.get("arguments").cloned().unwrap_or(json!({}));

    match tool_name {
        "list_terminals" => tool_list_terminals(id, state).await,
        "read_terminal_output" => tool_read_terminal_output(id, &arguments, state).await,
        "is_terminal_busy" => tool_is_terminal_busy(id, &arguments, state).await,
        "write_to_terminal" => tool_write_to_terminal(id, &arguments, state).await,
        "create_isolated_workspace" => tool_create_isolated_workspace(id, &arguments).await,
        "get_workspace_status" => tool_get_workspace_status(id, &arguments).await,
        "complete_workspace" => tool_complete_workspace(id, &arguments).await,
        _ => JsonRpcResponse::error(id, -32602, format!("Unknown tool: {}", tool_name)),
    }
}

// --- Tool Implementations ---

async fn tool_list_terminals(id: Value, state: &McpServerState) -> JsonRpcResponse {
    let all_metadata = state.metadata_store.all().await;

    let mut terminals = Vec::new();
    for (terminal_id, meta) in &all_metadata {
        let is_busy = state.terminal_manager.is_busy(terminal_id);
        let last_line = match state.output_buffers.get(terminal_id).await {
            Some(buf) => buf.read().await.last_line(),
            None => None,
        };

        terminals.push(json!({
            "id": terminal_id,
            "cwd": meta.cwd,
            "title": meta.title,
            "gitRoot": meta.git_root,
            "repoName": meta.repo_name,
            "mainRepoRoot": meta.main_repo_root,
            "worktreeName": meta.worktree_name,
            "branchName": meta.branch_name,
            "isBusy": is_busy,
            "lastLine": last_line,
        }));
    }

    JsonRpcResponse::success(
        id,
        json!({
            "content": [{
                "type": "text",
                "text": serde_json::to_string_pretty(&terminals).unwrap_or_default()
            }]
        }),
    )
}

async fn tool_read_terminal_output(
    id: Value,
    args: &Value,
    state: &McpServerState,
) -> JsonRpcResponse {
    let terminal_id = match args.get("terminal_id").and_then(|v| v.as_str()) {
        Some(id) => id,
        None => {
            return JsonRpcResponse::error(id, -32602, "Missing terminal_id".to_string());
        }
    };

    let lines = args.get("lines").and_then(|v| v.as_u64()).unwrap_or(200) as usize;
    let lines = lines.min(MAX_READ_LINES);

    let buf = match state.output_buffers.get(terminal_id).await {
        Some(buf) => buf,
        None => {
            return JsonRpcResponse::error(
                id,
                -32602,
                format!("Terminal not found: {}", terminal_id),
            );
        }
    };

    let output = buf.read().await.last_lines(lines);
    let text = output.join("\n");

    JsonRpcResponse::success(
        id,
        json!({
            "content": [{
                "type": "text",
                "text": text
            }]
        }),
    )
}

async fn tool_is_terminal_busy(id: Value, args: &Value, state: &McpServerState) -> JsonRpcResponse {
    let terminal_id = match args.get("terminal_id").and_then(|v| v.as_str()) {
        Some(id) => id,
        None => {
            return JsonRpcResponse::error(id, -32602, "Missing terminal_id".to_string());
        }
    };

    let busy = state.terminal_manager.is_busy(terminal_id);

    JsonRpcResponse::success(
        id,
        json!({
            "content": [{
                "type": "text",
                "text": busy.to_string()
            }]
        }),
    )
}

async fn tool_write_to_terminal(
    id: Value,
    args: &Value,
    state: &McpServerState,
) -> JsonRpcResponse {
    let terminal_id = match args.get("terminal_id").and_then(|v| v.as_str()) {
        Some(tid) => tid,
        None => {
            return JsonRpcResponse::error(id, -32602, "Missing terminal_id".to_string());
        }
    };

    let input = match args.get("input").and_then(|v| v.as_str()) {
        Some(i) => i,
        None => {
            return JsonRpcResponse::error(id, -32602, "Missing input".to_string());
        }
    };

    match state.terminal_manager.write_to_terminal(terminal_id, input) {
        Ok(()) => JsonRpcResponse::success(
            id,
            json!({
                "content": [{
                    "type": "text",
                    "text": "ok"
                }]
            }),
        ),
        Err(e) => JsonRpcResponse::error(id, -32603, format!("Write failed: {}", e)),
    }
}

// --- Agent Workspace Tool Implementations ---

async fn tool_create_isolated_workspace(id: Value, args: &Value) -> JsonRpcResponse {
    let repo_path = match args.get("repo_path").and_then(|v| v.as_str()) {
        Some(p) => p.to_string(),
        None => {
            return JsonRpcResponse::error(id, -32602, "Missing repo_path".to_string());
        }
    };

    let agent_id = args
        .get("agent_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()[..8].to_string());

    match crate::git::create_agent_worktree(repo_path, agent_id).await {
        Ok(wt) => JsonRpcResponse::success(
            id,
            json!({
                "content": [{
                    "type": "text",
                    "text": serde_json::to_string_pretty(&wt).unwrap_or_default()
                }]
            }),
        ),
        Err(e) => JsonRpcResponse::error(id, -32603, format!("Failed to create workspace: {}", e)),
    }
}

async fn tool_get_workspace_status(id: Value, args: &Value) -> JsonRpcResponse {
    let repo_path = match args.get("repo_path").and_then(|v| v.as_str()) {
        Some(p) => p.to_string(),
        None => {
            return JsonRpcResponse::error(id, -32602, "Missing repo_path".to_string());
        }
    };

    match crate::git::list_agent_worktrees(repo_path).await {
        Ok(workspaces) => JsonRpcResponse::success(
            id,
            json!({
                "content": [{
                    "type": "text",
                    "text": serde_json::to_string_pretty(&workspaces).unwrap_or_default()
                }]
            }),
        ),
        Err(e) => {
            JsonRpcResponse::error(id, -32603, format!("Failed to list workspaces: {}", e))
        }
    }
}

async fn tool_complete_workspace(id: Value, args: &Value) -> JsonRpcResponse {
    let repo_path = match args.get("repo_path").and_then(|v| v.as_str()) {
        Some(p) => p.to_string(),
        None => {
            return JsonRpcResponse::error(id, -32602, "Missing repo_path".to_string());
        }
    };

    let agent_id = match args.get("agent_id").and_then(|v| v.as_str()) {
        Some(a) => a.to_string(),
        None => {
            return JsonRpcResponse::error(id, -32602, "Missing agent_id".to_string());
        }
    };

    // Verify the workspace exists
    match crate::git::list_agent_worktrees(repo_path).await {
        Ok(workspaces) => {
            if workspaces.iter().any(|w| w.id == agent_id) {
                JsonRpcResponse::success(
                    id,
                    json!({
                        "content": [{
                            "type": "text",
                            "text": format!("Workspace {} marked as completed. Use the Amend UI to review and merge changes.", agent_id)
                        }]
                    }),
                )
            } else {
                JsonRpcResponse::error(
                    id,
                    -32602,
                    format!("Agent workspace not found: {}", agent_id),
                )
            }
        }
        Err(e) => JsonRpcResponse::error(
            id,
            -32603,
            format!("Failed to check workspace status: {}", e),
        ),
    }
}

// --- Discovery file ---

fn discovery_file_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|h| h.join(".amend").join("mcp.json"))
}

// --- Multi-tool MCP registration ---

struct JsonMcpTool {
    name: &'static str,
    config_path: fn() -> Option<std::path::PathBuf>,
    url_field: &'static str,
    extra_fields: Option<Value>,
}

const MCP_SERVER_KEY: &str = "amend-terminal";

fn json_mcp_tools() -> Vec<JsonMcpTool> {
    vec![
        JsonMcpTool {
            name: "Claude Code",
            config_path: || dirs::home_dir().map(|h| h.join(".claude.json")),
            url_field: "url",
            extra_fields: Some(json!({"type": "sse"})),
        },
        JsonMcpTool {
            name: "Cursor",
            config_path: || dirs::home_dir().map(|h| h.join(".cursor").join("mcp.json")),
            url_field: "url",
            extra_fields: None,
        },
        JsonMcpTool {
            name: "Windsurf",
            config_path: || {
                dirs::home_dir()
                    .map(|h| h.join(".codeium").join("windsurf").join("mcp_config.json"))
            },
            url_field: "serverUrl",
            extra_fields: None,
        },
        JsonMcpTool {
            name: "Cline",
            config_path: || {
                dirs::home_dir().map(|h| {
                    h.join("Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json")
                })
            },
            url_field: "url",
            extra_fields: None,
        },
        JsonMcpTool {
            name: "Gemini CLI",
            config_path: || dirs::home_dir().map(|h| h.join(".gemini").join("settings.json")),
            url_field: "url",
            extra_fields: None,
        },
    ]
}

fn sse_url(port: u16) -> String {
    format!("http://127.0.0.1:{}/sse", port)
}

fn write_json_tool_config(tool: &JsonMcpTool, port: u16) {
    let Some(path) = (tool.config_path)() else {
        return;
    };

    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let mut config: Value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| json!({}));

    let obj = match config.as_object_mut() {
        Some(o) => o,
        None => return,
    };

    let servers = obj.entry("mcpServers").or_insert_with(|| json!({}));

    if let Some(servers_obj) = servers.as_object_mut() {
        let mut entry = json!({});
        entry[tool.url_field] = json!(sse_url(port));
        if let Some(extra) = &tool.extra_fields {
            if let (Some(entry_obj), Some(extra_obj)) = (entry.as_object_mut(), extra.as_object()) {
                for (k, v) in extra_obj {
                    entry_obj.insert(k.clone(), v.clone());
                }
            }
        }
        servers_obj.insert(MCP_SERVER_KEY.to_string(), entry);
    }

    match serde_json::to_string_pretty(&config) {
        Ok(json_str) => {
            if let Err(e) = std::fs::write(&path, json_str) {
                eprintln!("[MCP] Failed to write {} config: {}", tool.name, e);
            }
        }
        Err(e) => eprintln!("[MCP] Failed to serialize {} config: {}", tool.name, e),
    }
}

fn remove_json_tool_config(tool: &JsonMcpTool, port: u16) {
    let Some(path) = (tool.config_path)() else {
        return;
    };

    let content = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return,
    };

    let mut config: Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return,
    };

    let obj = match config.as_object_mut() {
        Some(o) => o,
        None => return,
    };

    let should_remove_servers = {
        let servers = match obj.get_mut("mcpServers").and_then(|v| v.as_object_mut()) {
            Some(s) => s,
            None => return,
        };

        let expected_url = sse_url(port);
        if let Some(entry) = servers.get(MCP_SERVER_KEY) {
            if entry.get(tool.url_field).and_then(|u| u.as_str()) == Some(&expected_url) {
                servers.remove(MCP_SERVER_KEY);
            }
        }

        servers.is_empty()
    };

    if should_remove_servers {
        obj.remove("mcpServers");
    }

    match serde_json::to_string_pretty(&config) {
        Ok(json_str) => {
            if let Err(e) = std::fs::write(&path, json_str) {
                eprintln!("[MCP] Failed to write {} config: {}", tool.name, e);
            }
        }
        Err(e) => eprintln!("[MCP] Failed to serialize {} config: {}", tool.name, e),
    }
}

fn check_json_tool_registered(tool: &JsonMcpTool, port: u16) -> bool {
    let Some(path) = (tool.config_path)() else {
        return false;
    };

    let content = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return false,
    };

    let config: Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return false,
    };

    let expected_url = sse_url(port);
    config
        .get("mcpServers")
        .and_then(|s| s.get(MCP_SERVER_KEY))
        .and_then(|e| e.get(tool.url_field))
        .and_then(|u| u.as_str())
        == Some(&expected_url)
}

// --- Codex CLI (TOML) ---

fn codex_config_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|h| h.join(".codex").join("config.toml"))
}

fn write_codex_config(port: u16) {
    let Some(path) = codex_config_path() else {
        return;
    };

    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let mut config: toml::Table = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or_default();

    let servers = config
        .entry("mcp_servers")
        .or_insert_with(|| toml::Value::Table(toml::Table::new()));

    if let toml::Value::Table(servers_tbl) = servers {
        let mut entry = toml::Table::new();
        entry.insert("url".to_string(), toml::Value::String(sse_url(port)));
        servers_tbl.insert(MCP_SERVER_KEY.to_string(), toml::Value::Table(entry));
    }

    match toml::to_string_pretty(&config) {
        Ok(toml_str) => {
            if let Err(e) = std::fs::write(&path, toml_str) {
                eprintln!("[MCP] Failed to write Codex CLI config: {}", e);
            }
        }
        Err(e) => eprintln!("[MCP] Failed to serialize Codex CLI config: {}", e),
    }
}

fn remove_codex_config(port: u16) {
    let Some(path) = codex_config_path() else {
        return;
    };

    let content = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return,
    };

    let mut config: toml::Table = match content.parse() {
        Ok(t) => t,
        Err(_) => return,
    };

    let should_remove_servers = {
        let servers = match config.get_mut("mcp_servers") {
            Some(toml::Value::Table(t)) => t,
            _ => return,
        };

        let expected_url = sse_url(port);
        if let Some(toml::Value::Table(entry)) = servers.get(MCP_SERVER_KEY) {
            if entry.get("url").and_then(|u| u.as_str()) == Some(expected_url.as_str()) {
                servers.remove(MCP_SERVER_KEY);
            }
        }

        servers.is_empty()
    };

    if should_remove_servers {
        config.remove("mcp_servers");
    }

    match toml::to_string_pretty(&config) {
        Ok(toml_str) => {
            if let Err(e) = std::fs::write(&path, toml_str) {
                eprintln!("[MCP] Failed to write Codex CLI config: {}", e);
            }
        }
        Err(e) => eprintln!("[MCP] Failed to serialize Codex CLI config: {}", e),
    }
}

fn check_codex_registered(port: u16) -> bool {
    let Some(path) = codex_config_path() else {
        return false;
    };

    let content = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return false,
    };

    let config: toml::Table = match content.parse() {
        Ok(t) => t,
        Err(_) => return false,
    };

    let expected_url = sse_url(port);
    config
        .get("mcp_servers")
        .and_then(|s| s.get(MCP_SERVER_KEY))
        .and_then(|e| e.get("url"))
        .and_then(|u| u.as_str())
        == Some(expected_url.as_str())
}

// --- Aggregate write/remove/check ---

fn write_all_tool_configs(port: u16) {
    for tool in &json_mcp_tools() {
        write_json_tool_config(tool, port);
    }
    write_codex_config(port);
}

fn remove_all_tool_configs(port: u16) {
    for tool in &json_mcp_tools() {
        remove_json_tool_config(tool, port);
    }
    remove_codex_config(port);
}

#[derive(Debug, Serialize, Clone)]
pub struct McpToolRegistration {
    pub name: String,
    pub registered: bool,
}

fn check_all_tool_registrations(port: u16) -> Vec<McpToolRegistration> {
    let mut results: Vec<McpToolRegistration> = json_mcp_tools()
        .iter()
        .map(|tool| McpToolRegistration {
            name: tool.name.to_string(),
            registered: check_json_tool_registered(tool, port),
        })
        .collect();

    results.push(McpToolRegistration {
        name: "Codex CLI".to_string(),
        registered: check_codex_registered(port),
    });

    results
}

fn write_discovery_file(port: u16) {
    if let Some(path) = discovery_file_path() {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let content = json!({
            "url": sse_url(port)
        });
        if let Err(e) = std::fs::write(&path, serde_json::to_string_pretty(&content).unwrap()) {
            eprintln!("[MCP] Failed to write discovery file: {}", e);
        }
    }

    write_all_tool_configs(port);
}

pub fn remove_discovery_file(port: Option<u16>) {
    if let Some(path) = discovery_file_path() {
        let _ = std::fs::remove_file(path);
    }

    if let Some(port) = port {
        remove_all_tool_configs(port);
    }
}

// --- McpServerHandle ---

#[derive(Clone)]
pub struct McpServerHandle {
    port: Arc<RwLock<Option<u16>>>,
}

impl McpServerHandle {
    pub fn new() -> Self {
        Self {
            port: Arc::new(RwLock::new(None)),
        }
    }

    pub async fn set_port(&self, port: u16) {
        *self.port.write().await = Some(port);
    }

    pub async fn get_port(&self) -> Option<u16> {
        *self.port.read().await
    }
}

#[tauri::command]
pub async fn get_mcp_server_port(
    state: tauri::State<'_, McpServerHandle>,
) -> Result<Option<u16>, String> {
    Ok(state.get_port().await)
}

#[tauri::command]
pub async fn register_mcp_server(state: tauri::State<'_, McpServerHandle>) -> Result<(), String> {
    let port = state.get_port().await.ok_or("MCP server not running")?;
    write_all_tool_configs(port);
    Ok(())
}

#[tauri::command]
pub async fn check_mcp_registrations(
    state: tauri::State<'_, McpServerHandle>,
) -> Result<Vec<McpToolRegistration>, String> {
    let port = state.get_port().await.ok_or("MCP server not running")?;
    Ok(check_all_tool_registrations(port))
}
