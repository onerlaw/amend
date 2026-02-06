import { EditorView } from '@codemirror/view';
import { Extension } from '@codemirror/state';
import { getSymbolAtPosition, findDefinitionInFile, hasGoToDefinitionModifier } from '@/lib/symbolNavigation';
import { findDefinition, SymbolDefinition, readFile } from '@/lib/tauri';
import { OpenFile } from '@/stores/fileStore';
import { getLanguageFromPath } from '@/lib/highlight';

export interface GoToDefinitionConfig {
  currentFilePath: string;
  onNavigate: (file: OpenFile, line: number) => void;
  onLocalNavigate: (line: number) => void;
}

/**
 * Creates a go-to-definition extension using domEventHandlers (safer than ViewPlugin)
 */
export function goToDefinitionExtension(config: GoToDefinitionConfig): Extension {
  const { currentFilePath, onNavigate, onLocalNavigate } = config;

  return EditorView.domEventHandlers({
    mousedown(event: MouseEvent, view: EditorView) {
      if (!hasGoToDefinitionModifier(event)) return false;

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;

      const symbol = getSymbolAtPosition(view, pos);
      if (!symbol) return false;

      // Prevent text selection
      event.preventDefault();

      // Handle navigation asynchronously without blocking
      handleNavigation(view, symbol.name, pos, currentFilePath, onNavigate, onLocalNavigate);

      return true; // Event handled
    },
  });
}

async function handleNavigation(
  view: EditorView,
  symbolName: string,
  pos: number,
  currentFilePath: string,
  onNavigate: (file: OpenFile, line: number) => void,
  onLocalNavigate: (line: number) => void
) {
  try {
    // Check local definitions first
    const localDefs = findDefinitionInFile(view, symbolName);
    const cursorLine = view.state.doc.lineAt(pos).number;

    // Filter out cursor line and separate real defs from imports
    const realLocalDefs = localDefs.filter((d) => d.line !== cursorLine && d.kind !== 'import');

    // If we have a real local definition, go there
    if (realLocalDefs.length > 0) {
      onLocalNavigate(realLocalDefs[0].line);
      return;
    }

    // Try cross-file definitions from backend
    let crossFileDefs: SymbolDefinition[] = [];
    try {
      crossFileDefs = await findDefinition(symbolName, currentFilePath);
    } catch {
      // Backend not available
    }

    // Find external definitions
    const externalDefs = crossFileDefs.filter((d) => d.filePath !== currentFilePath);
    if (externalDefs.length > 0) {
      const targetDef = externalDefs[0];
      try {
        const content = await readFile(targetDef.filePath);
        const fileName = targetDef.filePath.split('/').pop() || targetDef.filePath;
        const language = getLanguageFromPath(targetDef.filePath) || 'plaintext';

        onNavigate(
          {
            path: targetDef.filePath,
            name: fileName,
            content,
            isDirty: false,
            language,
          },
          targetDef.line
        );
      } catch (err) {
        console.error('Failed to read target file:', err);
      }
      return;
    }

    // Fall back to import statement if nothing else found
    const importDefs = localDefs.filter((d) => d.line !== cursorLine && d.kind === 'import');
    if (importDefs.length > 0) {
      onLocalNavigate(importDefs[0].line);
    }
  } catch (err) {
    console.error('Navigation error:', err);
  }
}

/**
 * Scroll to a specific line in the editor
 */
export function scrollToLine(view: EditorView, line: number): void {
  const doc = view.state.doc;
  if (line < 1 || line > doc.lines) return;

  const lineInfo = doc.line(line);
  view.dispatch({
    selection: { anchor: lineInfo.from },
    scrollIntoView: true,
  });
}
