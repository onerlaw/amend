import { EditorView, ViewPlugin } from '@codemirror/view';
import { Extension } from '@codemirror/state';
import {
  getSymbolAtPosition,
  findDefinitionInFile,
  extractImportSource,
  hasGoToDefinitionModifier,
} from '@/lib/symbolNavigation';
import { findDefinition, SymbolDefinition, readFile } from '@/lib/tauri';
import { OpenFile } from '@/stores/fileStore';
import { getLanguageFromPath } from '@/lib/highlight';
import { getFileName } from '@/lib/fileUtils';
import { isMac } from '@/lib/platform';

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
        const fileName = getFileName(targetDef.filePath);
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

    // Fall back: try to resolve import path and navigate to the source file
    const importDefs = localDefs.filter((d) => d.line !== cursorLine && d.kind === 'import');
    if (importDefs.length > 0) {
      const docText = view.state.doc.toString();
      const importSource = extractImportSource(docText, symbolName);

      if (importSource && (importSource.startsWith('./') || importSource.startsWith('../'))) {
        const resolved = await resolveImportPath(currentFilePath, importSource);
        if (resolved) {
          try {
            const content = await readFile(resolved);
            const fileName = getFileName(resolved);
            const language = getLanguageFromPath(resolved) || 'plaintext';
            onNavigate({ path: resolved, name: fileName, content, isDirty: false, language }, 1);
            return;
          } catch {
            // File read failed, fall through to local jump
          }
        }
      }

      // Last resort: jump to the import line itself
      onLocalNavigate(importDefs[0].line);
    }
  } catch (err) {
    console.error('Navigation error:', err);
  }
}

const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/**
 * Resolve a relative import path to an absolute file path by trying common extensions and /index.* variants.
 */
async function resolveImportPath(
  currentFilePath: string,
  importSource: string
): Promise<string | null> {
  // Get directory of the current file
  const lastSlash = currentFilePath.lastIndexOf('/');
  const currentDir = lastSlash >= 0 ? currentFilePath.slice(0, lastSlash) : '';

  // Resolve the relative path
  const segments = (`${currentDir}/${importSource}`).split('/');
  const resolved: string[] = [];
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      resolved.pop();
    } else {
      resolved.push(seg);
    }
  }
  const basePath = '/' + resolved.join('/');

  // Try the exact path first (in case the import already has an extension)
  const candidates = [basePath];

  // Try with extensions
  for (const ext of RESOLVE_EXTENSIONS) {
    candidates.push(basePath + ext);
  }

  // Try index variants
  for (const ext of RESOLVE_EXTENSIONS) {
    candidates.push(basePath + '/index' + ext);
  }

  for (const candidate of candidates) {
    try {
      await readFile(candidate);
      return candidate;
    } catch {
      // File doesn't exist, try next
    }
  }

  return null;
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

/**
 * Extension that toggles a pointer cursor on the editor when Cmd (Mac) / Ctrl (other) is held.
 * Uses the existing `.cm-go-to-definition-active` CSS class defined in codemirror.ts.
 */
export function cmdHeldCursorExtension(): Extension {
  const modKey = isMac ? 'Meta' : 'Control';

  return ViewPlugin.fromClass(
    class {
      private editorDom: HTMLElement;
      private handleKeyDown: (e: KeyboardEvent) => void;
      private handleKeyUp: (e: KeyboardEvent) => void;
      private handleBlur: () => void;

      constructor(view: EditorView) {
        this.editorDom = view.dom;

        this.handleKeyDown = (e: KeyboardEvent) => {
          if (e.key === modKey) {
            this.editorDom.classList.add('cm-go-to-definition-active');
          }
        };

        this.handleKeyUp = (e: KeyboardEvent) => {
          if (e.key === modKey) {
            this.editorDom.classList.remove('cm-go-to-definition-active');
          }
        };

        this.handleBlur = () => {
          this.editorDom.classList.remove('cm-go-to-definition-active');
        };

        document.addEventListener('keydown', this.handleKeyDown);
        document.addEventListener('keyup', this.handleKeyUp);
        window.addEventListener('blur', this.handleBlur);
      }

      destroy() {
        document.removeEventListener('keydown', this.handleKeyDown);
        document.removeEventListener('keyup', this.handleKeyUp);
        window.removeEventListener('blur', this.handleBlur);
        this.editorDom.classList.remove('cm-go-to-definition-active');
      }
    }
  );
}
