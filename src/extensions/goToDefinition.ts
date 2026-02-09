import { EditorView, ViewPlugin, Decoration, DecorationSet } from '@codemirror/view';
import { Extension, StateEffect, StateField } from '@codemirror/state';
import {
  getSymbolAtPosition,
  getImportPathAtPosition,
  findDefinitionInFile,
  extractImportSource,
  hasGoToDefinitionModifier,
} from '@/lib/symbolNavigation';
import { findDefinition, SymbolDefinition, readFile } from '@/lib/tauri';
import { OpenFile } from '@/stores/fileStore';
import { getLanguageFromPath } from '@/lib/highlight';
import { getFileName } from '@/lib/fileUtils';

export interface GoToDefinitionConfig {
  currentFilePath: string;
  projectRoot: string;
  onNavigate: (file: OpenFile, line: number) => void;
  onLocalNavigate: (line: number) => void;
  onShowReferences: (symbolName: string) => void;
}

/**
 * Creates a go-to-definition extension using domEventHandlers (safer than ViewPlugin)
 */
export function goToDefinitionExtension(config: GoToDefinitionConfig): Extension {
  const { currentFilePath, projectRoot, onNavigate, onLocalNavigate, onShowReferences } = config;

  return EditorView.domEventHandlers({
    mousedown(event: MouseEvent, view: EditorView) {
      if (!hasGoToDefinitionModifier(event)) return false;

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;

      // Check import path FIRST — the regex fallback in getSymbolAtPosition
      // matches word segments inside strings (e.g. 'fileStore' in '@/stores/fileStore'),
      // which would prevent import path detection from ever running.
      const importPath = getImportPathAtPosition(view, pos);
      if (importPath) {
        event.preventDefault();
        handleImportPathNavigation(importPath.path, currentFilePath, projectRoot, onNavigate);
        return true;
      }

      // Then try symbol navigation (identifiers, variable names, etc.)
      const symbol = getSymbolAtPosition(view, pos);
      if (symbol) {
        event.preventDefault();
        handleNavigation(
          view,
          symbol.name,
          pos,
          currentFilePath,
          projectRoot,
          onNavigate,
          onLocalNavigate,
          onShowReferences
        );
        return true;
      }

      return false;
    },
  });
}

async function handleNavigation(
  view: EditorView,
  symbolName: string,
  pos: number,
  currentFilePath: string,
  projectRoot: string,
  onNavigate: (file: OpenFile, line: number) => void,
  onLocalNavigate: (line: number) => void,
  onShowReferences: (symbolName: string) => void
) {
  try {
    // Check local definitions first
    const localDefs = findDefinitionInFile(view, symbolName);
    const cursorLine = view.state.doc.lineAt(pos).number;

    // Check if clicking on a definition itself — show references instead
    const allRealDefs = localDefs.filter((d) => d.kind !== 'import');
    const isOnDefinition = allRealDefs.some((d) => d.line === cursorLine);
    if (isOnDefinition) {
      onShowReferences(symbolName);
      return;
    }

    // Filter out cursor line to find other local definitions to jump to
    const realLocalDefs = allRealDefs.filter((d) => d.line !== cursorLine);

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
    const importDefs = localDefs.filter((d) => d.kind === 'import');
    if (importDefs.length > 0) {
      const docText = view.state.doc.toString();
      const importSource = extractImportSource(docText, symbolName);

      if (importSource) {
        const resolved = await resolveImportOrAlias(importSource, currentFilePath, projectRoot);
        if (resolved) {
          const isNodeModules = resolved.includes('/node_modules/');

          // For node_modules, try to find a .d.ts types file for better navigation
          let targetFile = resolved;
          if (isNodeModules) {
            const typesFile = await resolveTypesForPackage(importSource, projectRoot);
            if (typesFile) targetFile = typesFile;
          }

          try {
            const content = await readFile(targetFile);

            // Try backend index first (works for project files)
            let targetLine = 1;
            if (!isNodeModules) {
              try {
                const defs = await findDefinition(symbolName, targetFile);
                const defInFile = defs.find((d) => d.filePath === targetFile);
                if (defInFile) targetLine = defInFile.line;
              } catch {
                // Backend not available
              }
            }

            // Fall back to text-based search (works for .d.ts and unindexed files)
            if (targetLine === 1) {
              targetLine = findSymbolLineInContent(content, symbolName);
            }

            const fileName = getFileName(targetFile);
            const language = getLanguageFromPath(targetFile) || 'plaintext';
            onNavigate(
              { path: targetFile, name: fileName, content, isDirty: false, language },
              targetLine
            );
            return;
          } catch {
            // Types file unreadable — try the original resolved file
            if (targetFile !== resolved) {
              try {
                const content = await readFile(resolved);
                const targetLine = findSymbolLineInContent(content, symbolName);
                const fileName = getFileName(resolved);
                const language = getLanguageFromPath(resolved) || 'plaintext';
                onNavigate(
                  { path: resolved, name: fileName, content, isDirty: false, language },
                  targetLine
                );
                return;
              } catch {
                // File read failed, fall through to local jump
              }
            }
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

/**
 * Handle Cmd+click on an import path string (not a symbol identifier).
 * Resolves the path and opens the target file.
 */
async function handleImportPathNavigation(
  importPath: string,
  currentFilePath: string,
  projectRoot: string,
  onNavigate: (file: OpenFile, line: number) => void
) {
  try {
    const resolved = await resolveImportOrAlias(importPath, currentFilePath, projectRoot);
    if (resolved) {
      const content = await readFile(resolved);
      const fileName = getFileName(resolved);
      const language = getLanguageFromPath(resolved) || 'plaintext';
      onNavigate({ path: resolved, name: fileName, content, isDirty: false, language }, 1);
    }
  } catch (err) {
    console.error('Import path navigation error:', err);
  }
}

/**
 * Resolve an import path: relative (./, ../), project alias (@/), or bare node_modules specifier.
 */
async function resolveImportOrAlias(
  importSource: string,
  currentFilePath: string,
  projectRoot: string
): Promise<string | null> {
  if (importSource.startsWith('./') || importSource.startsWith('../')) {
    return resolveImportPath(currentFilePath, importSource);
  }
  if (importSource.startsWith('@/')) {
    return resolveAliasPath(importSource, projectRoot);
  }
  // Bare specifier — try node_modules
  return resolveNodeModulePath(importSource, projectRoot);
}

const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/**
 * Try resolving a base path by appending common extensions and /index.* variants.
 */
async function tryResolveWithExtensions(basePath: string): Promise<string | null> {
  const candidates = [basePath];

  for (const ext of RESOLVE_EXTENSIONS) {
    candidates.push(basePath + ext);
  }

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
 * Resolve a relative import path to an absolute file path.
 */
async function resolveImportPath(
  currentFilePath: string,
  importSource: string
): Promise<string | null> {
  const lastSlash = currentFilePath.lastIndexOf('/');
  const currentDir = lastSlash >= 0 ? currentFilePath.slice(0, lastSlash) : '';

  const segments = `${currentDir}/${importSource}`.split('/');
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

  return tryResolveWithExtensions(basePath);
}

/**
 * Resolve a @/ alias import path to an absolute file path.
 * @/ maps to ${projectRoot}/src/
 */
async function resolveAliasPath(importSource: string, projectRoot: string): Promise<string | null> {
  const relativePath = importSource.replace(/^@\//, '');
  const basePath = `${projectRoot}/src/${relativePath}`;
  return tryResolveWithExtensions(basePath);
}

/**
 * Resolve a bare module specifier to a file inside node_modules.
 * Handles scoped packages (@scope/pkg) and subpath imports (pkg/subpath).
 */
async function resolveNodeModulePath(
  importSource: string,
  projectRoot: string
): Promise<string | null> {
  let packageName: string;
  let subpath: string;

  if (importSource.startsWith('@')) {
    // Scoped package: @scope/name or @scope/name/subpath
    const parts = importSource.split('/');
    if (parts.length < 2) return null;
    packageName = parts[0] + '/' + parts[1];
    subpath = parts.slice(2).join('/');
  } else {
    const slashIndex = importSource.indexOf('/');
    if (slashIndex === -1) {
      packageName = importSource;
      subpath = '';
    } else {
      packageName = importSource.slice(0, slashIndex);
      subpath = importSource.slice(slashIndex + 1);
    }
  }

  const packageDir = `${projectRoot}/node_modules/${packageName}`;

  // If there's a subpath, try to resolve it directly
  if (subpath) {
    const basePath = `${packageDir}/${subpath}`;
    const candidates = [basePath];
    for (const ext of RESOLVE_EXTENSIONS) {
      candidates.push(basePath + ext);
    }
    for (const ext of RESOLVE_EXTENSIONS) {
      candidates.push(basePath + '/index' + ext);
    }
    for (const candidate of candidates) {
      try {
        await readFile(candidate);
        return candidate;
      } catch {
        // try next
      }
    }
  }

  // Try package.json to find the entry point
  try {
    const pkgJsonStr = await readFile(`${packageDir}/package.json`);
    const pkgJson = JSON.parse(pkgJsonStr);

    // Prefer types/module/main in that order
    const entryFields = ['types', 'typings', 'module', 'main'];
    for (const field of entryFields) {
      if (pkgJson[field] && typeof pkgJson[field] === 'string') {
        const entryPath = `${packageDir}/${pkgJson[field]}`;
        try {
          await readFile(entryPath);
          return entryPath;
        } catch {
          // try next field
        }
      }
    }
  } catch {
    // no package.json or parse error
  }

  // Last resort: try index files
  for (const ext of RESOLVE_EXTENSIONS) {
    try {
      const candidate = `${packageDir}/index${ext}`;
      await readFile(candidate);
      return candidate;
    } catch {
      // try next
    }
  }

  return null;
}

/**
 * Resolve the best types file for a node_modules package.
 * Checks the package's own types/typings field, then falls back to @types/<pkg>.
 */
async function resolveTypesForPackage(
  importSource: string,
  projectRoot: string
): Promise<string | null> {
  let packageName: string;

  if (importSource.startsWith('@')) {
    const parts = importSource.split('/');
    if (parts.length < 2) return null;
    packageName = parts[0] + '/' + parts[1];
  } else {
    const slashIndex = importSource.indexOf('/');
    packageName = slashIndex === -1 ? importSource : importSource.slice(0, slashIndex);
  }

  const packageDir = `${projectRoot}/node_modules/${packageName}`;

  // 1. Check the package's own types/typings field
  try {
    const pkgJsonStr = await readFile(`${packageDir}/package.json`);
    const pkgJson = JSON.parse(pkgJsonStr);

    for (const field of ['types', 'typings']) {
      if (pkgJson[field] && typeof pkgJson[field] === 'string') {
        const typesPath = `${packageDir}/${pkgJson[field]}`;
        try {
          await readFile(typesPath);
          return typesPath;
        } catch {
          // try next
        }
      }
    }
  } catch {
    // no package.json
  }

  // 2. Check @types/<packageName>
  // Scoped packages: @scope/name -> @types/scope__name
  const atTypesName = packageName.startsWith('@')
    ? packageName.slice(1).replace('/', '__')
    : packageName;
  const atTypesDir = `${projectRoot}/node_modules/@types/${atTypesName}`;

  try {
    const typesPkgStr = await readFile(`${atTypesDir}/package.json`);
    const typesPkg = JSON.parse(typesPkgStr);

    for (const field of ['types', 'typings']) {
      if (typesPkg[field] && typeof typesPkg[field] === 'string') {
        const typesPath = `${atTypesDir}/${typesPkg[field]}`;
        try {
          await readFile(typesPath);
          return typesPath;
        } catch {
          // try next
        }
      }
    }
  } catch {
    // no @types package
  }

  // 3. Try index.d.ts directly
  try {
    const candidate = `${atTypesDir}/index.d.ts`;
    await readFile(candidate);
    return candidate;
  } catch {
    // not found
  }

  return null;
}

/**
 * Find the line number of a symbol's declaration in file content using text patterns.
 * Works for .d.ts type declarations, ES modules, and CommonJS.
 * Returns 1 if no match is found.
 */
function findSymbolLineInContent(content: string, symbolName: string): number {
  const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lines = content.split('\n');

  // Patterns ordered by specificity — first match across all lines wins
  const patterns = [
    // export (declare) function/const/class/interface/type/enum
    new RegExp(`^\\s*export\\s+(?:declare\\s+)?function\\s+${escaped}\\s*[<(]`),
    new RegExp(`^\\s*export\\s+(?:declare\\s+)?(?:const|let|var)\\s+${escaped}\\s*[=:<]`),
    new RegExp(`^\\s*export\\s+(?:declare\\s+)?class\\s+${escaped}\\b`),
    new RegExp(`^\\s*export\\s+(?:declare\\s+)?interface\\s+${escaped}\\b`),
    new RegExp(`^\\s*export\\s+(?:declare\\s+)?type\\s+${escaped}\\b`),
    new RegExp(`^\\s*export\\s+(?:declare\\s+)?enum\\s+${escaped}\\b`),
    // declare function/const/etc (inside namespace blocks in .d.ts)
    new RegExp(`^\\s*(?:declare\\s+)?function\\s+${escaped}\\s*[<(]`),
    new RegExp(`^\\s*(?:const|let|var)\\s+${escaped}\\s*[=:<]`),
    new RegExp(`^\\s*class\\s+${escaped}\\b`),
    new RegExp(`^\\s*interface\\s+${escaped}\\b`),
    new RegExp(`^\\s*type\\s+${escaped}\\b`),
    // CommonJS exports
    new RegExp(`^\\s*exports\\.${escaped}\\s*=`),
  ];

  for (const pattern of patterns) {
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        return i + 1; // 1-indexed
      }
    }
  }

  return 1;
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

// --- Cmd+Hover underline decoration ---

const setUnderlineEffect = StateEffect.define<{ from: number; to: number } | null>();

const underlineField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setUnderlineEffect)) {
        if (effect.value) {
          return Decoration.set([
            Decoration.mark({ class: 'cm-go-to-definition-link' }).range(
              effect.value.from,
              effect.value.to
            ),
          ]);
        }
        return Decoration.none;
      }
    }
    return decorations.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * Extension that underlines symbols and shows pointer cursor when Cmd (Mac) / Ctrl (other) is held.
 * Uses `.cm-go-to-definition-active` for the pointer cursor and
 * `.cm-go-to-definition-link` for the underline decoration.
 */
export function cmdHeldCursorExtension(): Extension {
  return [
    underlineField,
    ViewPlugin.fromClass(
      class {
        private editorDom: HTMLElement;
        private lastMouseX = 0;
        private lastMouseY = 0;
        private modHeld = false;
        private handleKeyDown: (e: KeyboardEvent) => void;
        private handleKeyUp: (e: KeyboardEvent) => void;
        private handleBlur: () => void;
        private handleMouseMove: (e: MouseEvent) => void;

        constructor(private view: EditorView) {
          this.editorDom = view.dom;

          this.handleMouseMove = (e: MouseEvent) => {
            this.lastMouseX = e.clientX;
            this.lastMouseY = e.clientY;
            if (this.modHeld) {
              this.updateUnderline();
            }
          };

          this.handleKeyDown = (e: KeyboardEvent) => {
            if (hasGoToDefinitionModifier(e) && !this.modHeld) {
              this.modHeld = true;
              this.editorDom.classList.add('cm-go-to-definition-active');
              this.updateUnderline();
            }
          };

          this.handleKeyUp = (e: KeyboardEvent) => {
            if (!hasGoToDefinitionModifier(e) && this.modHeld) {
              this.modHeld = false;
              this.editorDom.classList.remove('cm-go-to-definition-active');
              this.clearUnderline();
            }
          };

          this.handleBlur = () => {
            this.modHeld = false;
            this.editorDom.classList.remove('cm-go-to-definition-active');
            this.clearUnderline();
          };

          this.editorDom.addEventListener('mousemove', this.handleMouseMove);
          document.addEventListener('keydown', this.handleKeyDown);
          document.addEventListener('keyup', this.handleKeyUp);
          window.addEventListener('blur', this.handleBlur);
        }

        private updateUnderline() {
          const pos = this.view.posAtCoords({ x: this.lastMouseX, y: this.lastMouseY });
          if (pos === null) {
            this.clearUnderline();
            return;
          }

          // Check import path FIRST so the full string is underlined,
          // not just individual word segments matched by the regex fallback.
          const importPath = getImportPathAtPosition(this.view, pos);
          if (importPath) {
            this.view.dispatch({
              effects: setUnderlineEffect.of({ from: importPath.from, to: importPath.to }),
            });
            return;
          }

          const symbol = getSymbolAtPosition(this.view, pos);
          if (symbol) {
            this.view.dispatch({
              effects: setUnderlineEffect.of({ from: symbol.start, to: symbol.end }),
            });
            return;
          }

          this.clearUnderline();
        }

        private clearUnderline() {
          this.view.dispatch({ effects: setUnderlineEffect.of(null) });
        }

        destroy() {
          this.editorDom.removeEventListener('mousemove', this.handleMouseMove);
          document.removeEventListener('keydown', this.handleKeyDown);
          document.removeEventListener('keyup', this.handleKeyUp);
          window.removeEventListener('blur', this.handleBlur);
          this.editorDom.classList.remove('cm-go-to-definition-active');
        }
      }
    ),
  ];
}
