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
#[derive(Clone)]
pub struct SymbolIndex {
    /// Map from symbol name to list of definitions
    symbols: Arc<RwLock<HashMap<String, Vec<SymbolDefinition>>>>,
    /// Map from file path to list of symbol names defined in that file
    file_symbols: Arc<RwLock<HashMap<String, Vec<String>>>>,
}

impl Default for SymbolIndex {
    fn default() -> Self {
        Self::new()
    }
}

impl SymbolIndex {
    pub fn new() -> Self {
        Self {
            symbols: Arc::new(RwLock::new(HashMap::new())),
            file_symbols: Arc::new(RwLock::new(HashMap::new())),
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
            "rust" => self.parse_rust(path, content),
            "python" => self.parse_python(path, content),
            "java" => self.parse_java(path, content),
            "scala" => self.parse_scala(path, content),
            _ => Vec::new(),
        };

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
        symbols.get(name).cloned().unwrap_or_default()
    }

    /// Generic helper: parse a file with a tree-sitter language and query, extracting symbol definitions.
    fn parse_with_query(
        &self,
        path: &str,
        content: &str,
        language: tree_sitter::Language,
        query_source: &str,
    ) -> Vec<SymbolDefinition> {
        let mut definitions = Vec::new();

        let mut parser = Parser::new();
        if parser.set_language(&language).is_err() {
            return definitions;
        }

        let tree = match parser.parse(content, None) {
            Some(t) => t,
            None => return definitions,
        };

        let query = match Query::new(&language, query_source) {
            Ok(q) => q,
            Err(_) => return definitions,
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
                    // Take up to 8 lines / 500 chars of the definition
                    let max_lines = 8;
                    let max_chars = 500;
                    let mut sig = String::new();
                    for (line_count, line) in text.lines().enumerate() {
                        if line_count >= max_lines || sig.len() + line.len() > max_chars {
                            sig.push_str("...");
                            break;
                        }
                        if line_count > 0 {
                            sig.push('\n');
                        }
                        sig.push_str(line);
                    }
                    if sig.is_empty() {
                        None
                    } else {
                        Some(sig)
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

    /// Parse JavaScript/TypeScript file and extract symbol definitions
    fn parse_js_ts(&self, path: &str, content: &str, lang: &str) -> Vec<SymbolDefinition> {
        let is_typescript = matches!(lang, "typescript" | "typescriptreact");

        let language: tree_sitter::Language = match lang {
            "typescript" | "typescriptreact" => {
                if path.ends_with(".tsx") {
                    tree_sitter_typescript::LANGUAGE_TSX.into()
                } else {
                    tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()
                }
            }
            _ => tree_sitter_javascript::LANGUAGE.into(),
        };

        let query_source = if is_typescript {
            r#"
                (function_declaration name: (identifier) @function.name) @function.def
                (lexical_declaration (variable_declarator name: (identifier) @arrow.name value: (arrow_function))) @arrow.def
                (lexical_declaration (variable_declarator name: (identifier) @variable.name value: (call_expression))) @variable.def
                (interface_declaration name: (type_identifier) @interface.name) @interface.def
                (type_alias_declaration name: (type_identifier) @type.name) @type.def
                (class_declaration name: (type_identifier) @class.name) @class.def
                (enum_declaration name: (identifier) @enum.name) @enum.def
            "#
        } else {
            r#"
                (function_declaration name: (identifier) @function.name) @function.def
                (lexical_declaration (variable_declarator name: (identifier) @arrow.name value: (arrow_function))) @arrow.def
                (lexical_declaration (variable_declarator name: (identifier) @variable.name value: (call_expression))) @variable.def
                (class_declaration name: (identifier) @class.name) @class.def
            "#
        };

        self.parse_with_query(path, content, language, query_source)
    }

    /// Parse Rust file and extract symbol definitions
    fn parse_rust(&self, path: &str, content: &str) -> Vec<SymbolDefinition> {
        let language: tree_sitter::Language = tree_sitter_rust::LANGUAGE.into();
        let query_source = r#"
            (function_item name: (identifier) @function.name) @function.def
            (struct_item name: (type_identifier) @struct.name) @struct.def
            (enum_item name: (type_identifier) @enum.name) @enum.def
            (trait_item name: (type_identifier) @trait.name) @trait.def
            (impl_item type: (type_identifier) @impl.name) @impl.def
            (type_item name: (type_identifier) @type.name) @type.def
            (const_item name: (identifier) @const.name) @const.def
            (static_item name: (identifier) @static.name) @static.def
            (mod_item name: (identifier) @mod.name) @mod.def
            (macro_definition name: (identifier) @macro.name) @macro.def
        "#;
        self.parse_with_query(path, content, language, query_source)
    }

    /// Parse Python file and extract symbol definitions
    fn parse_python(&self, path: &str, content: &str) -> Vec<SymbolDefinition> {
        let language: tree_sitter::Language = tree_sitter_python::LANGUAGE.into();
        let query_source = r#"
            (function_definition name: (identifier) @function.name) @function.def
            (class_definition name: (identifier) @class.name) @class.def
            (assignment left: (identifier) @variable.name) @variable.def
        "#;
        self.parse_with_query(path, content, language, query_source)
    }

    /// Parse Java file and extract symbol definitions
    fn parse_java(&self, path: &str, content: &str) -> Vec<SymbolDefinition> {
        let language: tree_sitter::Language = tree_sitter_java::LANGUAGE.into();
        let query_source = r#"
            (class_declaration name: (identifier) @class.name) @class.def
            (interface_declaration name: (identifier) @interface.name) @interface.def
            (method_declaration name: (identifier) @method.name) @method.def
            (enum_declaration name: (identifier) @enum.name) @enum.def
            (field_declaration declarator: (variable_declarator name: (identifier) @field.name)) @field.def
            (annotation_type_declaration name: (identifier) @annotation.name) @annotation.def
            (constructor_declaration name: (identifier) @constructor.name) @constructor.def
        "#;
        self.parse_with_query(path, content, language, query_source)
    }

    /// Parse Scala file and extract symbol definitions
    fn parse_scala(&self, path: &str, content: &str) -> Vec<SymbolDefinition> {
        let language: tree_sitter::Language = tree_sitter_scala::LANGUAGE.into();
        let query_source = r#"
            (function_definition name: (identifier) @function.name) @function.def
            (val_definition pattern: (identifier) @val.name) @val.def
            (var_definition pattern: (identifier) @var.name) @var.def
            (class_definition name: (identifier) @class.name) @class.def
            (object_definition name: (identifier) @object.name) @object.def
            (trait_definition name: (identifier) @trait.name) @trait.def
            (type_definition name: (type_identifier) @type.name) @type.def
        "#;
        self.parse_with_query(path, content, language, query_source)
    }
}

/// Determine the kind of symbol from the capture name
fn get_kind_from_capture(capture_name: &str) -> &str {
    if capture_name.contains("function")
        || capture_name.contains("arrow")
        || capture_name.contains("funcexpr")
        || capture_name.contains("exportfunc")
        || capture_name.contains("method")
    {
        "function"
    } else if capture_name.contains("class") || capture_name.contains("exportclass") {
        "class"
    } else if capture_name.contains("interface") {
        "interface"
    } else if capture_name.contains("type") {
        "type"
    } else if capture_name.contains("enum") {
        "enum"
    } else if capture_name.contains("struct") {
        "struct"
    } else if capture_name.contains("trait") {
        "trait"
    } else if capture_name.contains("impl") {
        "impl"
    } else if capture_name.contains("object") {
        "object"
    } else if capture_name.contains("mod") {
        "module"
    } else if capture_name.contains("macro") {
        "macro"
    } else if capture_name.contains("constructor") {
        "constructor"
    } else if capture_name.contains("annotation") {
        "annotation"
    } else if capture_name.contains("const") || capture_name.contains("static") {
        "constant"
    } else {
        "variable"
    }
}

/// Check if a path is in a common build/dependency directory that should be skipped
fn is_skippable_path(path: &str) -> bool {
    const SKIP_DIRS: &[&str] = &[
        "/node_modules/",
        "/dist/",
        "/build/",
        "/.git/",
        "/target/",
        "/__pycache__/",
        "/venv/",
        "/.venv/",
        "/.metals/",
        "/.bloop/",
    ];
    SKIP_DIRS.iter().any(|dir| path.contains(dir))
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
            | "self"
            | "Self"
            | "cls"
            | "this"
            | "super"
            | "args"
            | "kwargs"
            | "ok"
            | "_"
    )
}

/// Get language string from file extension.
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
        "rs" => Some("rust"),
        "py" | "pyi" => Some("python"),
        "java" => Some("java"),
        "scala" | "sc" => Some("scala"),
        _ => None,
    }
}

/// Represents a reference to a symbol in the codebase
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SymbolReference {
    pub file_path: String,
    pub line: u32,
    pub column: u32,
    pub line_content: String,
}

impl SymbolIndex {
    /// Index all supported files in a project directory
    pub fn index_project(&self, root_path: &str) -> Result<(), String> {
        use ignore::WalkBuilder;

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

            if is_skippable_path(&path_str) {
                continue;
            }

            let content = match std::fs::read_to_string(path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            self.index_file(&path_str, &content, lang);
        }

        Ok(())
    }

    /// Find all references to a symbol across the project by scanning files for whole-word matches.
    pub fn find_references(&self, symbol: &str, root_path: &str) -> Vec<SymbolReference> {
        use ignore::WalkBuilder;

        let mut references = Vec::new();
        let max_results = 100;

        let walker = WalkBuilder::new(root_path)
            .hidden(false)
            .git_ignore(true)
            .git_global(true)
            .git_exclude(true)
            .build();

        for entry in walker {
            if references.len() >= max_results {
                break;
            }

            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };

            let path = entry.path();
            if !path.is_file() {
                continue;
            }

            let path_str = path.to_string_lossy().to_string();

            // Skip unsupported files and common build/dependency directories
            if get_language_from_path(&path_str).is_none() {
                continue;
            }
            if is_skippable_path(&path_str) {
                continue;
            }

            let content = match std::fs::read_to_string(path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            for (line_idx, line_content) in content.lines().enumerate() {
                if references.len() >= max_results {
                    break;
                }

                // Find all whole-word matches of the symbol in this line
                let mut search_from = 0;
                while let Some(pos) = line_content[search_from..].find(symbol) {
                    let abs_pos = search_from + pos;
                    let before_ok = abs_pos == 0
                        || !line_content.as_bytes()[abs_pos - 1].is_ascii_alphanumeric()
                            && line_content.as_bytes()[abs_pos - 1] != b'_'
                            && line_content.as_bytes()[abs_pos - 1] != b'$';
                    let after_pos = abs_pos + symbol.len();
                    let after_ok = after_pos >= line_content.len()
                        || !line_content.as_bytes()[after_pos].is_ascii_alphanumeric()
                            && line_content.as_bytes()[after_pos] != b'_'
                            && line_content.as_bytes()[after_pos] != b'$';

                    if before_ok && after_ok {
                        references.push(SymbolReference {
                            file_path: path_str.clone(),
                            line: (line_idx + 1) as u32,
                            column: abs_pos as u32,
                            line_content: line_content.trim().to_string(),
                        });
                    }

                    search_from = abs_pos + symbol.len();
                    if search_from >= line_content.len() {
                        break;
                    }
                }
            }
        }

        references
    }
}
