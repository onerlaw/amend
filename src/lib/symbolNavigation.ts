import { EditorView } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { SyntaxNode } from '@lezer/common';
import { isMac } from '@/lib/platform';

/**
 * Information about a symbol at a position
 */
export interface SymbolInfo {
  name: string;
  start: number;
  end: number;
  kind?: string;
}

/**
 * Definition location found in the file
 */
export interface LocalDefinition {
  name: string;
  line: number;
  column: number;
  kind: string;
  signature?: string;
}

// Node types that represent identifiers in various languages
const IDENTIFIER_TYPES = new Set([
  'Identifier',
  'VariableName',
  'PropertyName',
  'VariableDefinition',
  'PropertyDefinition',
  'TypeName',
  'TypeDefinition',
  'FunctionName',
  'ClassName',
  'Label',
  'identifier',
  'type_identifier',
  'property_identifier',
]);

// Node types that represent definitions
const DEFINITION_TYPES = new Set([
  'VariableDefinition',
  'PropertyDefinition',
  'TypeDefinition',
  'FunctionDeclaration',
  'ClassDeclaration',
  'MethodDeclaration',
  'ArrowFunction',
  'FunctionExpression',
  'VariableDeclaration',
  'ImportDeclaration',
  'ExportDeclaration',
]);

// Parent node types that indicate a definition context
const DEFINITION_CONTEXT_TYPES = new Set([
  'FunctionDeclaration',
  'ClassDeclaration',
  'MethodDefinition',
  'VariableDeclaration',
  'LetDeclaration',
  'ConstDeclaration',
  'Property',
  'ImportSpecifier',
  'ImportDeclaration',
  'TypeAliasDeclaration',
  'InterfaceDeclaration',
  'EnumDeclaration',
]);

/**
 * Get the identifier node at a given position in the editor
 */
export function getSymbolAtPosition(view: EditorView, pos: number): SymbolInfo | null {
  const tree = syntaxTree(view.state);
  let node: SyntaxNode | null = tree.resolveInner(pos, 0);

  // Walk up to find an identifier node
  while (node) {
    if (IDENTIFIER_TYPES.has(node.name)) {
      const name = view.state.doc.sliceString(node.from, node.to);
      // Validate that it's a reasonable identifier (not too long, no spaces)
      if (name.length > 0 && name.length < 100 && /^[\w$]+$/.test(name)) {
        return {
          name,
          start: node.from,
          end: node.to,
          kind: getSymbolKind(node),
        };
      }
    }
    node = node.parent;
  }

  // Fallback: try to extract word at position using regex
  const line = view.state.doc.lineAt(pos);
  const lineText = line.text;
  const linePos = pos - line.from;

  // Find word boundaries
  let start = linePos;
  let end = linePos;

  while (start > 0 && /[\w$]/.test(lineText[start - 1])) {
    start--;
  }
  while (end < lineText.length && /[\w$]/.test(lineText[end])) {
    end++;
  }

  if (start < end) {
    const name = lineText.slice(start, end);
    if (/^[a-zA-Z_$][\w$]*$/.test(name)) {
      return {
        name,
        start: line.from + start,
        end: line.from + end,
      };
    }
  }

  return null;
}

/**
 * Determine the kind of symbol from its AST context
 */
function getSymbolKind(node: SyntaxNode): string | undefined {
  const parent = node.parent;
  if (!parent) return undefined;

  const parentName = parent.name;

  if (parentName.includes('Function') || parentName.includes('Method')) {
    return 'function';
  }
  if (parentName.includes('Class')) {
    return 'class';
  }
  if (parentName.includes('Type') || parentName.includes('Interface')) {
    return 'type';
  }
  if (
    parentName.includes('Variable') ||
    parentName.includes('Const') ||
    parentName.includes('Let')
  ) {
    return 'variable';
  }
  if (parentName.includes('Property')) {
    return 'property';
  }
  if (parentName.includes('Import')) {
    return 'import';
  }

  return undefined;
}

/**
 * Find all definitions of a symbol in the current file
 */
export function findDefinitionInFile(view: EditorView, symbolName: string): LocalDefinition[] {
  const definitions: LocalDefinition[] = [];
  const tree = syntaxTree(view.state);
  const doc = view.state.doc;

  // Traverse the syntax tree looking for definitions
  tree.iterate({
    enter(node) {
      // Check if this is a definition context
      if (DEFINITION_CONTEXT_TYPES.has(node.name) || DEFINITION_TYPES.has(node.name)) {
        // Look for identifiers within this definition
        const innerTree = node.node;
        let cursor = innerTree.cursor();
        let depth = 0;
        const maxDepth = 5; // Don't go too deep

        do {
          if (IDENTIFIER_TYPES.has(cursor.name)) {
            const name = doc.sliceString(cursor.from, cursor.to);
            if (name === symbolName) {
              const line = doc.lineAt(cursor.from);
              const signature = extractSignature(doc, node.node);
              definitions.push({
                name,
                line: line.number,
                column: cursor.from - line.from,
                kind: inferDefinitionKind(node.name),
                signature,
              });
              return; // Found in this definition, move on
            }
          }

          // Track depth — check before entering to avoid enter-then-back-out infinite loop
          if (depth < maxDepth && cursor.firstChild()) {
            depth++;
          } else if (!cursor.nextSibling()) {
            while (depth > 0 && !cursor.nextSibling()) {
              cursor.parent();
              depth--;
            }
          }
        } while (depth > 0 || cursor.nextSibling());
      }
    },
  });

  // Remove duplicates (same line)
  const seen = new Set<number>();
  return definitions.filter((d) => {
    if (seen.has(d.line)) return false;
    seen.add(d.line);
    return true;
  });
}

/**
 * Extract a signature string from a definition node
 */
function extractSignature(
  doc: { sliceString: (from: number, to: number) => string },
  node: SyntaxNode
): string | undefined {
  // Get the first line of the definition
  const text = doc.sliceString(node.from, Math.min(node.to, node.from + 200));
  const firstLine = text.split('\n')[0];

  // Clean up and truncate if needed
  let signature = firstLine.trim();
  if (signature.length > 100) {
    signature = signature.slice(0, 100) + '...';
  }

  // Remove body start for functions/classes
  signature = signature.replace(/\s*\{.*$/, '');

  return signature || undefined;
}

/**
 * Infer definition kind from AST node type
 */
function inferDefinitionKind(nodeType: string): string {
  if (nodeType.includes('Function')) return 'function';
  if (nodeType.includes('Class')) return 'class';
  if (nodeType.includes('Method')) return 'method';
  if (nodeType.includes('Interface')) return 'interface';
  if (nodeType.includes('Type')) return 'type';
  if (nodeType.includes('Enum')) return 'enum';
  if (nodeType.includes('Import')) return 'import';
  if (nodeType.includes('Const') || nodeType.includes('Let') || nodeType.includes('Variable')) {
    return 'variable';
  }
  if (nodeType.includes('Property')) return 'property';
  return 'definition';
}

/**
 * Check if the click position has the modifier key held (Cmd on Mac, Ctrl otherwise)
 */
export function hasGoToDefinitionModifier(event: MouseEvent): boolean {
  return isMac ? event.metaKey : event.ctrlKey;
}

/**
 * Extract the import source path for a given symbol name from document text.
 * Handles named imports, default imports, and aliased imports.
 *
 * Examples matched:
 *   import { foo } from './bar'           -> './bar'
 *   import { foo as baz } from './bar'    -> './bar'  (for symbolName 'baz')
 *   import foo from './bar'               -> './bar'
 *   import * as foo from './bar'           -> './bar'
 */
export function extractImportSource(docText: string, symbolName: string): string | null {
  const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const patterns = [
    // Named import: import { symbolName } from '...' or import { symbolName, ... } from '...'
    // Also handles aliased: import { original as symbolName } from '...'
    new RegExp(
      `import\\s+\\{[^}]*\\b(?:\\w+\\s+as\\s+)?${escaped}\\b[^}]*\\}\\s+from\\s+['"]([^'"]+)['"]`
    ),
    // Default import: import symbolName from '...'
    new RegExp(`import\\s+${escaped}\\s+from\\s+['"]([^'"]+)['"]`),
    // Namespace import: import * as symbolName from '...'
    new RegExp(`import\\s+\\*\\s+as\\s+${escaped}\\s+from\\s+['"]([^'"]+)['"]`),
  ];

  for (const pattern of patterns) {
    const match = docText.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}
