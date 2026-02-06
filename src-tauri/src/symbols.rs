use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use streaming_iterator::StreamingIterator;
use tree_sitter::{Node, Parser, Query, QueryCursor};

/// Represents a symbol definition in the codebase
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SymbolDefinition {
    pub name: String,
    pub kind: String,
    pub file_path: String,
    pub line: u32,
    pub column: u32,
    pub signature: Option<String>,
}

/// Index of all symbols in the project
pub struct SymbolIndex {
    /// Map from symbol name to list of definitions
    symbols: RwLock<HashMap<String, Vec<SymbolDefinition>>>,
    /// Map from file path to list of symbol names defined in that file
    file_symbols: RwLock<HashMap<String, Vec<String>>>,
}

impl Default for SymbolIndex {
    fn default() -> Self {
        Self::new()
    }
}

impl SymbolIndex {
    pub fn new() -> Self {
        Self {
            symbols: RwLock::new(HashMap::new()),
            file_symbols: RwLock::new(HashMap::new()),
        }
    }

    /// Index a file and add its symbols to the index
    pub fn index_file(&self, path: &str, content: &str, lang: &str) {
        // Remove old symbols from this file first
        self.remove_file(path);

        // Parse based on language
        let definitions = match lang {
            "javascript" | "typescript" | "javascriptreact" | "typescriptreact" => {
                self.parse_js_ts(path, content, lang)
            }
            _ => Vec::new(),
        };

        if !definitions.is_empty() {
            eprintln!(
                "[symbols] Indexed {} symbols from {}",
                definitions.len(),
                path.split('/').next_back().unwrap_or(path)
            );
        }

        if definitions.is_empty() {
            return;
        }

        // Track which symbols are in this file
        let symbol_names: Vec<String> = definitions.iter().map(|d| d.name.clone()).collect();

        // Add symbols to the index
        let mut symbols = self.symbols.write();
        for def in definitions {
            symbols.entry(def.name.clone()).or_default().push(def);
        }

        // Track file -> symbols mapping
        let mut file_symbols = self.file_symbols.write();
        file_symbols.insert(path.to_string(), symbol_names);
    }

    /// Remove all symbols from a file
    pub fn remove_file(&self, path: &str) {
        let mut file_symbols = self.file_symbols.write();
        if let Some(symbol_names) = file_symbols.remove(path) {
            let mut symbols = self.symbols.write();
            for name in symbol_names {
                if let Some(defs) = symbols.get_mut(&name) {
                    defs.retain(|d| d.file_path != path);
                    if defs.is_empty() {
                        symbols.remove(&name);
                    }
                }
            }
        }
    }

    /// Find all definitions of a symbol
    pub fn find_definition(&self, name: &str) -> Vec<SymbolDefinition> {
        let symbols = self.symbols.read();
        let result = symbols.get(name).cloned().unwrap_or_default();
        eprintln!(
            "[symbols] find_definition('{}') -> {} results",
            name,
            result.len()
        );
        result
    }

    /// Parse JavaScript/TypeScript file and extract symbol definitions
    fn parse_js_ts(&self, path: &str, content: &str, lang: &str) -> Vec<SymbolDefinition> {
        let mut definitions = Vec::new();
        let filename = path.split('/').next_back().unwrap_or(path);
        let is_typescript = matches!(lang, "typescript" | "typescriptreact");

        // Get the appropriate language
        let language = match lang {
            "typescript" | "typescriptreact" => {
                if path.ends_with(".tsx") {
                    tree_sitter_typescript::LANGUAGE_TSX.into()
                } else {
                    tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()
                }
            }
            _ => tree_sitter_javascript::LANGUAGE.into(),
        };

        let mut parser = Parser::new();
        if parser.set_language(&language).is_err() {
            eprintln!("[symbols] Failed to set language for {}", filename);
            return definitions;
        }

        let tree = match parser.parse(content, None) {
            Some(t) => t,
            None => {
                eprintln!("[symbols] Failed to parse {}", filename);
                return definitions;
            }
        };

        // Use different queries for JavaScript vs TypeScript
        // JavaScript doesn't have interface, type alias, or enum declarations
        let query_source = if is_typescript {
            r#"
                ; Function declarations
                (function_declaration
                    name: (identifier) @function.name) @function.def

                ; Arrow functions assigned to variables
                (lexical_declaration
                    (variable_declarator
                        name: (identifier) @arrow.name
                        value: (arrow_function))) @arrow.def

                ; Variable declarations with call expressions (like React hooks)
                (lexical_declaration
                    (variable_declarator
                        name: (identifier) @variable.name
                        value: (call_expression))) @variable.def

                ; Interface declarations
                (interface_declaration
                    name: (type_identifier) @interface.name) @interface.def

                ; Type alias declarations
                (type_alias_declaration
                    name: (type_identifier) @type.name) @type.def
            "#
        } else {
            r#"
                ; Function declarations
                (function_declaration
                    name: (identifier) @function.name) @function.def

                ; Arrow functions assigned to variables
                (lexical_declaration
                    (variable_declarator
                        name: (identifier) @arrow.name
                        value: (arrow_function))) @arrow.def

                ; Variable declarations with call expressions
                (lexical_declaration
                    (variable_declarator
                        name: (identifier) @variable.name
                        value: (call_expression))) @variable.def
            "#
        };

        let query = match Query::new(&language, query_source) {
            Ok(q) => q,
            Err(e) => {
                eprintln!("[symbols] Query error for {}: {:?}", path, e);
                return definitions;
            }
        };

        let mut cursor = QueryCursor::new();
        let mut matches = cursor.matches(&query, tree.root_node(), content.as_bytes());

        while let Some(m) = matches.next() {
            for capture in m.captures {
                let capture_name = &query.capture_names()[capture.index as usize];

                // Only process name captures
                if !capture_name.ends_with(".name") {
                    continue;
                }

                let node = capture.node;
                let name: String = match node.utf8_text(content.as_bytes()) {
                    Ok(n) => n.to_string(),
                    Err(_) => continue,
                };

                // Skip if it's a common/built-in name
                if is_common_name(&name) {
                    continue;
                }

                let start_pos = node.start_position();
                let kind = get_kind_from_capture(capture_name);

                // Get the parent definition node for signature
                let def_capture_name = capture_name.replace(".name", ".def");
                let def_node: Option<Node> = m
                    .captures
                    .iter()
                    .find(|c| query.capture_names()[c.index as usize] == def_capture_name)
                    .map(|c| c.node);

                let signature = def_node.and_then(|node: Node| {
                    let text = node.utf8_text(content.as_bytes()).ok()?;
                    // Get first line and truncate
                    let first_line = text.lines().next()?;
                    let sig = first_line.trim();
                    if sig.len() > 100 {
                        Some(format!("{}...", &sig[..100]))
                    } else {
                        Some(sig.to_string())
                    }
                });

                definitions.push(SymbolDefinition {
                    name,
                    kind: kind.to_string(),
                    file_path: path.to_string(),
                    line: start_pos.row as u32 + 1, // 1-indexed
                    column: start_pos.column as u32,
                    signature,
                });
            }
        }

        // Deduplicate by (name, line)
        let mut seen = std::collections::HashSet::new();
        definitions.retain(|d| seen.insert((d.name.clone(), d.line)));

        definitions
    }
}

/// Determine the kind of symbol from the capture name
fn get_kind_from_capture(capture_name: &str) -> &str {
    if capture_name.contains("function")
        || capture_name.contains("arrow")
        || capture_name.contains("funcexpr")
    {
        "function"
    } else if capture_name.contains("class") {
        "class"
    } else if capture_name.contains("interface") {
        "interface"
    } else if capture_name.contains("type") {
        "type"
    } else if capture_name.contains("enum") {
        "enum"
    } else {
        "variable"
    }
}

/// Check if a name is too common to index
fn is_common_name(name: &str) -> bool {
    matches!(
        name,
        "i" | "j"
            | "k"
            | "x"
            | "y"
            | "z"
            | "n"
            | "m"
            | "a"
            | "b"
            | "c"
            | "e"
            | "err"
            | "error"
            | "data"
            | "result"
            | "res"
            | "req"
            | "ctx"
            | "val"
            | "value"
            | "item"
            | "el"
            | "elem"
            | "tmp"
            | "temp"
    )
}

/// Get language string from file extension.
/// Intentionally limited to tree-sitter-supported languages (JS/TS only).
pub fn get_language_from_path(path: &str) -> Option<&'static str> {
    let ext = Path::new(path).extension()?.to_str()?;
    match ext {
        "js" => Some("javascript"),
        "jsx" => Some("javascriptreact"),
        "ts" => Some("typescript"),
        "tsx" => Some("typescriptreact"),
        "mjs" => Some("javascript"),
        "mts" => Some("typescript"),
        "cjs" => Some("javascript"),
        "cts" => Some("typescript"),
        _ => None,
    }
}

/// Manager for symbol indexing operations
pub struct SymbolManager {
    index: Arc<SymbolIndex>,
}

impl Default for SymbolManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SymbolManager {
    pub fn new() -> Self {
        Self {
            index: Arc::new(SymbolIndex::new()),
        }
    }

    /// Index all supported files in a project directory
    pub fn index_project(&self, root_path: &str) -> Result<(), String> {
        use ignore::WalkBuilder;

        eprintln!("[symbols] Starting project indexing: {}", root_path);
        let mut file_count = 0;

        let walker = WalkBuilder::new(root_path)
            .hidden(false)
            .git_ignore(true)
            .git_global(true)
            .git_exclude(true)
            .build();

        for entry in walker {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };

            let path = entry.path();
            if !path.is_file() {
                continue;
            }

            let path_str = path.to_string_lossy().to_string();
            let lang = match get_language_from_path(&path_str) {
                Some(l) => l,
                None => continue,
            };

            // Skip node_modules, dist, build directories
            if path_str.contains("/node_modules/")
                || path_str.contains("/dist/")
                || path_str.contains("/build/")
                || path_str.contains("/.git/")
            {
                continue;
            }

            let content = match std::fs::read_to_string(path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            self.index.index_file(&path_str, &content, lang);
            file_count += 1;
        }

        let symbol_count = self.index.symbols.read().len();
        eprintln!(
            "[symbols] Indexing complete: {} files, {} unique symbols",
            file_count, symbol_count
        );

        Ok(())
    }

    /// Re-index a single file
    pub fn reindex_file(&self, path: &str, content: &str) -> Result<(), String> {
        let lang = get_language_from_path(path).ok_or("Unsupported file type")?;
        self.index.index_file(path, content, lang);
        Ok(())
    }

    /// Find definitions for a symbol.
    /// `_current_file` is accepted for future use (e.g., ranking results by proximity)
    /// but is not currently used for filtering.
    pub fn find_definition(&self, symbol: &str, _current_file: &str) -> Vec<SymbolDefinition> {
        self.index.find_definition(symbol)
    }
}
