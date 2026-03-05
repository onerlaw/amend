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

/// Represents a call relationship between two functions
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallRelation {
    pub caller: String,
    pub caller_file: String,
    pub caller_line: u32,
    pub callee: String,
}

/// Represents an import statement in a file
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportInfo {
    pub file_path: String,
    pub imported_name: String,
    pub source: String,
    pub line: u32,
}

/// Represents a node in a call graph tree
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallGraphNode {
    pub name: String,
    pub file_path: String,
    pub line: u32,
    pub calls: Vec<CallGraphNode>,
}

/// Result from a semantic search query
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticSearchResult {
    pub symbol: SymbolDefinition,
    pub caller_count: usize,
    pub callee_count: usize,
    pub importer_count: usize,
}

/// Index of all symbols in the project
#[derive(Clone)]
pub struct SymbolIndex {
    /// Map from symbol name to list of definitions
    symbols: Arc<RwLock<HashMap<String, Vec<SymbolDefinition>>>>,
    /// Map from file path to list of symbol names defined in that file
    file_symbols: Arc<RwLock<HashMap<String, Vec<String>>>>,
    /// Map from caller function → list of callee function names
    calls: Arc<RwLock<HashMap<String, Vec<CallRelation>>>>,
    /// Map from file → list of imports
    imports: Arc<RwLock<HashMap<String, Vec<ImportInfo>>>>,
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
            calls: Arc::new(RwLock::new(HashMap::new())),
            imports: Arc::new(RwLock::new(HashMap::new())),
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

        // Extract call relations and imports
        let (call_relations, import_infos) = match lang {
            "javascript" | "typescript" | "javascriptreact" | "typescriptreact" => {
                let calls = self.extract_calls_js_ts(path, content, lang, &definitions);
                let imports = self.extract_imports_js_ts(path, content, lang);
                (calls, imports)
            }
            "rust" => {
                let calls = self.extract_calls_rust(path, content, &definitions);
                let imports = self.extract_imports_rust(path, content);
                (calls, imports)
            }
            "python" => {
                let calls = self.extract_calls_python(path, content, &definitions);
                let imports = self.extract_imports_python(path, content);
                (calls, imports)
            }
            _ => (Vec::new(), Vec::new()),
        };

        // Store imports for this file
        if !import_infos.is_empty() {
            let mut imports = self.imports.write();
            imports.insert(path.to_string(), import_infos);
        }

        // Store call relations keyed by caller
        if !call_relations.is_empty() {
            let mut calls = self.calls.write();
            for rel in &call_relations {
                calls
                    .entry(rel.caller.clone())
                    .or_default()
                    .push(rel.clone());
            }
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

        // Remove call relations originating from this file
        {
            let mut calls = self.calls.write();
            // Remove entries where the caller is from this file
            let callers_to_clean: Vec<String> = calls
                .iter()
                .filter(|(_, rels)| rels.iter().any(|r| r.caller_file == path))
                .map(|(k, _)| k.clone())
                .collect();
            for caller in callers_to_clean {
                if let Some(rels) = calls.get_mut(&caller) {
                    rels.retain(|r| r.caller_file != path);
                    if rels.is_empty() {
                        calls.remove(&caller);
                    }
                }
            }
        }

        // Remove imports for this file
        {
            let mut imports = self.imports.write();
            imports.remove(path);
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

    /// Find the enclosing function name for a given node by walking up the tree
    fn find_enclosing_function<'a>(node: Node<'a>, content: &[u8]) -> Option<(String, u32)> {
        let mut current = node.parent();
        while let Some(n) = current {
            match n.kind() {
                "function_declaration"
                | "function_item"
                | "function_definition"
                | "method_declaration"
                | "method_definition" => {
                    // Look for the name child
                    if let Some(name_node) = n.child_by_field_name("name") {
                        if let Ok(name) = name_node.utf8_text(content) {
                            return Some((
                                name.to_string(),
                                name_node.start_position().row as u32 + 1,
                            ));
                        }
                    }
                }
                "lexical_declaration" | "variable_declaration" => {
                    // Arrow functions: const foo = () => ...
                    for i in 0..n.named_child_count() {
                        if let Some(child) = n.named_child(i) {
                            if child.kind() == "variable_declarator" {
                                if let Some(val) = child.child_by_field_name("value") {
                                    if val.kind() == "arrow_function" {
                                        if let Some(name_node) = child.child_by_field_name("name") {
                                            if let Ok(name) = name_node.utf8_text(content) {
                                                return Some((
                                                    name.to_string(),
                                                    name_node.start_position().row as u32 + 1,
                                                ));
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
            current = n.parent();
        }
        None
    }

    /// Extract call expressions from a JS/TS file
    fn extract_calls_js_ts(
        &self,
        path: &str,
        content: &str,
        lang: &str,
        _definitions: &[SymbolDefinition],
    ) -> Vec<CallRelation> {
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

        let query_source = r#"
            (call_expression function: (identifier) @call.name)
            (call_expression function: (member_expression property: (property_identifier) @call.name))
        "#;

        self.extract_calls_with_query(path, content, language, query_source)
    }

    /// Extract call expressions from a Rust file
    fn extract_calls_rust(
        &self,
        path: &str,
        content: &str,
        _definitions: &[SymbolDefinition],
    ) -> Vec<CallRelation> {
        let language: tree_sitter::Language = tree_sitter_rust::LANGUAGE.into();
        let query_source = r#"
            (call_expression function: (identifier) @call.name)
            (call_expression function: (scoped_identifier name: (identifier) @call.name))
        "#;

        self.extract_calls_with_query(path, content, language, query_source)
    }

    /// Extract call expressions from a Python file
    fn extract_calls_python(
        &self,
        path: &str,
        content: &str,
        _definitions: &[SymbolDefinition],
    ) -> Vec<CallRelation> {
        let language: tree_sitter::Language = tree_sitter_python::LANGUAGE.into();
        let query_source = r#"
            (call function: (identifier) @call.name)
            (call function: (attribute attribute: (identifier) @call.name))
        "#;

        self.extract_calls_with_query(path, content, language, query_source)
    }

    /// Generic helper to extract call relations using a tree-sitter query
    fn extract_calls_with_query(
        &self,
        path: &str,
        content: &str,
        language: tree_sitter::Language,
        query_source: &str,
    ) -> Vec<CallRelation> {
        let mut relations = Vec::new();

        let mut parser = Parser::new();
        if parser.set_language(&language).is_err() {
            return relations;
        }

        let tree = match parser.parse(content, None) {
            Some(t) => t,
            None => return relations,
        };

        let query = match Query::new(&language, query_source) {
            Ok(q) => q,
            Err(_) => return relations,
        };

        let mut cursor = QueryCursor::new();
        let content_bytes = content.as_bytes();
        let mut matches = cursor.matches(&query, tree.root_node(), content_bytes);

        while let Some(m) = matches.next() {
            for capture in m.captures {
                let capture_name = &query.capture_names()[capture.index as usize];
                if *capture_name != "call.name" {
                    continue;
                }

                let node = capture.node;
                let callee_name = match node.utf8_text(content_bytes) {
                    Ok(n) => n.to_string(),
                    Err(_) => continue,
                };

                // Skip common built-in names
                if is_common_call_name(&callee_name) {
                    continue;
                }

                // Find the enclosing function
                if let Some((caller_name, caller_line)) =
                    Self::find_enclosing_function(node, content_bytes)
                {
                    relations.push(CallRelation {
                        caller: caller_name,
                        caller_file: path.to_string(),
                        caller_line,
                        callee: callee_name,
                    });
                }
            }
        }

        // Deduplicate by (caller, callee, line)
        let mut seen = std::collections::HashSet::new();
        relations.retain(|r| seen.insert((r.caller.clone(), r.callee.clone(), r.caller_line)));

        relations
    }

    /// Extract imports from a JS/TS file
    fn extract_imports_js_ts(&self, path: &str, content: &str, lang: &str) -> Vec<ImportInfo> {
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

        let query_source = r#"
            (import_statement
                source: (string) @import.source
                (import_clause
                    (named_imports
                        (import_specifier name: (identifier) @import.name))))
            (import_statement
                source: (string) @import.default_source
                (import_clause (identifier) @import.default_name))
        "#;

        self.extract_imports_with_query(path, content, language, query_source)
    }

    /// Extract imports from a Rust file
    fn extract_imports_rust(&self, path: &str, content: &str) -> Vec<ImportInfo> {
        let language: tree_sitter::Language = tree_sitter_rust::LANGUAGE.into();
        let query_source = r#"
            (use_declaration argument: (scoped_identifier name: (identifier) @import.name path: (identifier) @import.source))
            (use_declaration argument: (scoped_identifier name: (identifier) @import.name path: (scoped_identifier) @import.source))
        "#;

        self.extract_imports_with_query(path, content, language, query_source)
    }

    /// Extract imports from a Python file
    fn extract_imports_python(&self, path: &str, content: &str) -> Vec<ImportInfo> {
        let language: tree_sitter::Language = tree_sitter_python::LANGUAGE.into();
        let query_source = r#"
            (import_from_statement
                module_name: (dotted_name) @import.source
                name: (dotted_name (identifier) @import.name))
            (import_statement
                name: (dotted_name (identifier) @import.name))
        "#;

        self.extract_imports_with_query(path, content, language, query_source)
    }

    /// Generic helper to extract imports using a tree-sitter query
    fn extract_imports_with_query(
        &self,
        path: &str,
        content: &str,
        language: tree_sitter::Language,
        query_source: &str,
    ) -> Vec<ImportInfo> {
        let mut imports = Vec::new();

        let mut parser = Parser::new();
        if parser.set_language(&language).is_err() {
            return imports;
        }

        let tree = match parser.parse(content, None) {
            Some(t) => t,
            None => return imports,
        };

        let query = match Query::new(&language, query_source) {
            Ok(q) => q,
            Err(_) => return imports,
        };

        let mut cursor = QueryCursor::new();
        let content_bytes = content.as_bytes();
        let mut matches = cursor.matches(&query, tree.root_node(), content_bytes);

        while let Some(m) = matches.next() {
            let mut name: Option<String> = None;
            let mut source: Option<String> = None;
            let mut line: u32 = 0;

            for capture in m.captures {
                let capture_name = &query.capture_names()[capture.index as usize];
                let text = match capture.node.utf8_text(content_bytes) {
                    Ok(t) => t.to_string(),
                    Err(_) => continue,
                };

                if capture_name.contains("name") {
                    name = Some(text);
                    line = capture.node.start_position().row as u32 + 1;
                } else if capture_name.contains("source") {
                    // Strip quotes from import source strings
                    source = Some(text.trim_matches('"').trim_matches('\'').to_string());
                }
            }

            match (name, source) {
                (Some(imported_name), Some(source_str)) => {
                    imports.push(ImportInfo {
                        file_path: path.to_string(),
                        imported_name,
                        source: source_str,
                        line,
                    });
                }
                (Some(imported_name), None) => {
                    // For imports without an explicit source (e.g. Python `import foo`)
                    imports.push(ImportInfo {
                        file_path: path.to_string(),
                        imported_name: imported_name.clone(),
                        source: imported_name,
                        line,
                    });
                }
                _ => {}
            }
        }

        imports
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

/// Check if a call target name is too common / built-in to track
fn is_common_call_name(name: &str) -> bool {
    matches!(
        name,
        "log"
            | "warn"
            | "error"
            | "info"
            | "debug"
            | "trace"
            | "console"
            | "println"
            | "eprintln"
            | "print"
            | "format"
            | "write"
            | "writeln"
            | "toString"
            | "valueOf"
            | "parseInt"
            | "parseFloat"
            | "String"
            | "Number"
            | "Boolean"
            | "Array"
            | "Object"
            | "Date"
            | "Math"
            | "JSON"
            | "require"
            | "define"
            | "setTimeout"
            | "setInterval"
            | "clearTimeout"
            | "clearInterval"
            | "Promise"
            | "then"
            | "catch"
            | "finally"
            | "map"
            | "filter"
            | "reduce"
            | "forEach"
            | "push"
            | "pop"
            | "shift"
            | "unshift"
            | "splice"
            | "slice"
            | "concat"
            | "join"
            | "split"
            | "trim"
            | "replace"
            | "includes"
            | "indexOf"
            | "find"
            | "some"
            | "every"
            | "keys"
            | "values"
            | "entries"
            | "from"
            | "of"
            | "len"
            | "unwrap"
            | "expect"
            | "clone"
            | "into"
            | "iter"
            | "collect"
            | "ok"
            | "err"
            | "is_ok"
            | "is_err"
            | "as_ref"
            | "as_mut"
            | "to_string"
            | "to_owned"
            | "default"
            | "new"
            | "append"
            | "extend"
            | "insert"
            | "remove"
            | "get"
            | "set"
            | "range"
            | "enumerate"
            | "zip"
            | "sorted"
            | "isinstance"
            | "type"
            | "hasattr"
            | "getattr"
            | "setattr"
    )
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
    /// Index all supported files in a project directory.
    /// After indexing, removes stale entries for files that no longer exist on disk.
    pub fn index_project(&self, root_path: &str) -> Result<(), String> {
        use ignore::WalkBuilder;
        use std::collections::HashSet;

        let walker = WalkBuilder::new(root_path)
            .hidden(false)
            .git_ignore(true)
            .git_global(true)
            .git_exclude(true)
            .build();

        let mut seen_files = HashSet::new();

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

            seen_files.insert(path_str.clone());
            self.index_file(&path_str, &content, lang);
        }

        // Remove stale entries for files that were previously indexed but no longer exist
        let stale_files: Vec<String> = {
            let file_symbols = self.file_symbols.read();
            file_symbols
                .keys()
                .filter(|path| !seen_files.contains(path.as_str()))
                .cloned()
                .collect()
        };

        for path in stale_files {
            self.remove_file(&path);
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

    /// Find all functions that call the given symbol
    pub fn find_callers(&self, symbol: &str) -> Vec<CallRelation> {
        let calls = self.calls.read();
        let mut callers = Vec::new();
        for (_caller_name, rels) in calls.iter() {
            for rel in rels {
                if rel.callee == symbol {
                    callers.push(rel.clone());
                }
            }
        }
        callers
    }

    /// Find all functions that the given symbol calls
    pub fn find_callees(&self, symbol: &str) -> Vec<CallRelation> {
        let calls = self.calls.read();
        calls.get(symbol).cloned().unwrap_or_default()
    }

    /// Find all files that import the given symbol
    pub fn find_importers(&self, symbol: &str) -> Vec<ImportInfo> {
        let imports = self.imports.read();
        let mut importers = Vec::new();
        for (_file, file_imports) in imports.iter() {
            for imp in file_imports {
                if imp.imported_name == symbol {
                    importers.push(imp.clone());
                }
            }
        }
        importers
    }

    /// Build a call graph starting from a symbol, up to max_depth levels
    pub fn get_call_graph(&self, symbol: &str, max_depth: usize) -> Option<CallGraphNode> {
        let symbols = self.symbols.read();
        let defs = symbols.get(symbol)?;
        let def = defs.first()?;

        let mut visited = std::collections::HashSet::new();
        Some(self.build_call_graph_node(symbol, &def.file_path, def.line, max_depth, &mut visited))
    }

    /// Recursively build a call graph node
    fn build_call_graph_node(
        &self,
        symbol: &str,
        file_path: &str,
        line: u32,
        depth: usize,
        visited: &mut std::collections::HashSet<String>,
    ) -> CallGraphNode {
        let mut children = Vec::new();

        if depth > 0 && visited.insert(symbol.to_string()) {
            let calls = self.calls.read();
            if let Some(rels) = calls.get(symbol) {
                // Collect unique callees
                let mut seen_callees = std::collections::HashSet::new();
                for rel in rels {
                    if seen_callees.insert(rel.callee.clone()) {
                        // Try to find the callee's definition for file/line info
                        let symbols = self.symbols.read();
                        let (callee_file, callee_line) =
                            if let Some(callee_defs) = symbols.get(&rel.callee) {
                                if let Some(callee_def) = callee_defs.first() {
                                    (callee_def.file_path.clone(), callee_def.line)
                                } else {
                                    (rel.caller_file.clone(), rel.caller_line)
                                }
                            } else {
                                (rel.caller_file.clone(), rel.caller_line)
                            };
                        drop(symbols);

                        children.push(self.build_call_graph_node(
                            &rel.callee,
                            &callee_file,
                            callee_line,
                            depth - 1,
                            visited,
                        ));
                    }
                }
            }
            visited.remove(symbol);
        }

        CallGraphNode {
            name: symbol.to_string(),
            file_path: file_path.to_string(),
            line,
            calls: children,
        }
    }

    /// Semantic search: search symbols by name with fuzzy matching and relationship context
    pub fn semantic_search(&self, query: &str, limit: usize) -> Vec<SemanticSearchResult> {
        let query_lower = query.to_lowercase();
        let symbols = self.symbols.read();

        let mut results: Vec<SemanticSearchResult> = Vec::new();

        for (name, defs) in symbols.iter() {
            let name_lower = name.to_lowercase();

            // Fuzzy match: contains substring or abbreviation match
            let matches =
                name_lower.contains(&query_lower) || fuzzy_match(&query_lower, &name_lower);

            if !matches {
                continue;
            }

            for def in defs {
                let caller_count = {
                    let calls = self.calls.read();
                    calls
                        .values()
                        .flat_map(|rels| rels.iter())
                        .filter(|r| r.callee == *name)
                        .count()
                };

                let callee_count = {
                    let calls = self.calls.read();
                    calls.get(name.as_str()).map_or(0, |v| v.len())
                };

                let importer_count = {
                    let imports = self.imports.read();
                    imports
                        .values()
                        .flat_map(|imps| imps.iter())
                        .filter(|imp| imp.imported_name == *name)
                        .count()
                };

                results.push(SemanticSearchResult {
                    symbol: def.clone(),
                    caller_count,
                    callee_count,
                    importer_count,
                });
            }
        }

        // Sort by relevance: exact prefix match first, then by relationship count (more connected = more relevant)
        results.sort_by(|a, b| {
            let a_exact = a.symbol.name.to_lowercase().starts_with(&query_lower);
            let b_exact = b.symbol.name.to_lowercase().starts_with(&query_lower);
            b_exact
                .cmp(&a_exact)
                .then_with(|| {
                    let a_score = a.caller_count + a.callee_count + a.importer_count;
                    let b_score = b.caller_count + b.callee_count + b.importer_count;
                    b_score.cmp(&a_score)
                })
                .then_with(|| a.symbol.name.len().cmp(&b.symbol.name.len()))
        });

        results.truncate(limit);
        results
    }
}

/// Simple fuzzy match: check if query chars appear in order in the target
fn fuzzy_match(query: &str, target: &str) -> bool {
    let mut target_chars = target.chars();
    for query_char in query.chars() {
        let found = loop {
            match target_chars.next() {
                Some(c) if c == query_char => break true,
                Some(_) => continue,
                None => break false,
            }
        };
        if !found {
            return false;
        }
    }
    true
}
