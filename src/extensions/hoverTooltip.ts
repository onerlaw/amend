import { hoverTooltip, Tooltip, EditorView } from '@codemirror/view';
import { Extension } from '@codemirror/state';
import { getSymbolAtPosition, findDefinitionInFile, LocalDefinition } from '@/lib/symbolNavigation';
import { findDefinition, SymbolDefinition } from '@/lib/tauri';
import { getFileName } from '@/lib/fileUtils';
import { isMac } from '@/lib/platform';

export interface HoverTooltipConfig {
  currentFilePath: string;
  delay?: number;
}

/**
 * Creates a hover tooltip extension that shows symbol information.
 * Supports async cross-file definition lookups when local defs are only imports.
 */
export function symbolHoverTooltip(config: HoverTooltipConfig): Extension {
  const { currentFilePath, delay = 300 } = config;

  return hoverTooltip(
    async (view: EditorView, pos: number): Promise<Tooltip | null> => {
      const symbol = getSymbolAtPosition(view, pos);
      if (!symbol) return null;

      const localDefs = findDefinitionInFile(view, symbol.name);
      if (localDefs.length === 0) return null;

      // Check if we have real (non-import) local definitions
      const realDefs = localDefs.filter((d) => d.kind !== 'import');

      if (realDefs.length > 0) {
        // Show local definition tooltip
        return {
          pos: symbol.start,
          end: symbol.end,
          above: true,
          create() {
            const dom = createTooltipContent(symbol.name, realDefs);
            return { dom };
          },
        };
      }

      // Only imports found locally — try cross-file lookup
      let crossFileDef: SymbolDefinition | null = null;
      try {
        const defs = await findDefinition(symbol.name, currentFilePath);
        const external = defs.find((d) => d.filePath !== currentFilePath);
        if (external) {
          crossFileDef = external;
        }
      } catch {
        // Backend not available
      }

      if (crossFileDef) {
        return {
          pos: symbol.start,
          end: symbol.end,
          above: true,
          create() {
            const dom = createCrossFileTooltipContent(symbol.name, crossFileDef!);
            return { dom };
          },
        };
      }

      // Fall back to showing the import definition
      return {
        pos: symbol.start,
        end: symbol.end,
        above: true,
        create() {
          const dom = createTooltipContent(symbol.name, localDefs);
          return { dom };
        },
      };
    },
    { hideOnChange: true, hoverTime: delay }
  );
}

/**
 * Create the DOM content for a local definition tooltip with multi-line code
 */
function createTooltipContent(symbolName: string, localDefs: LocalDefinition[]): HTMLElement {
  const container = document.createElement('div');
  container.className = 'cm-tooltip-signature';

  if (localDefs.length > 0) {
    const localDef = localDefs[0];
    const header = document.createElement('div');
    header.className = 'cm-tooltip-signature-header';

    const kindBadge = document.createElement('span');
    kindBadge.className = `cm-tooltip-signature-kind cm-tooltip-kind-${localDef.kind}`;
    kindBadge.textContent = localDef.kind;
    header.appendChild(kindBadge);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'cm-tooltip-signature-name';
    nameSpan.textContent = symbolName;
    header.appendChild(nameSpan);

    container.appendChild(header);

    if (localDef.signature) {
      const sig = document.createElement('div');
      sig.className = 'cm-tooltip-signature-code';
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = localDef.signature;
      pre.appendChild(code);
      sig.appendChild(pre);
      container.appendChild(sig);
    }

    const location = document.createElement('div');
    location.className = 'cm-tooltip-signature-location';
    location.textContent = `Line ${localDef.line}`;
    container.appendChild(location);
  }

  // Add hint for go-to-definition
  const hint = document.createElement('div');
  hint.className = 'cm-tooltip-signature-hint';
  hint.textContent = `${isMac ? 'Cmd' : 'Ctrl'}+Click to go to definition`;
  container.appendChild(hint);

  return container;
}

/**
 * Create tooltip content for a cross-file definition with multi-line code preview
 */
function createCrossFileTooltipContent(
  symbolName: string,
  def: SymbolDefinition
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'cm-tooltip-signature';

  const header = document.createElement('div');
  header.className = 'cm-tooltip-signature-header';

  const kindBadge = document.createElement('span');
  kindBadge.className = `cm-tooltip-signature-kind cm-tooltip-kind-${def.kind}`;
  kindBadge.textContent = def.kind;
  header.appendChild(kindBadge);

  const nameSpan = document.createElement('span');
  nameSpan.className = 'cm-tooltip-signature-name';
  nameSpan.textContent = symbolName;
  header.appendChild(nameSpan);

  container.appendChild(header);

  if (def.signature) {
    const sig = document.createElement('div');
    sig.className = 'cm-tooltip-signature-code';
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = def.signature;
    pre.appendChild(code);
    sig.appendChild(pre);
    container.appendChild(sig);
  }

  const location = document.createElement('div');
  location.className = 'cm-tooltip-signature-location';
  location.textContent = `${getFileName(def.filePath)}:${def.line}`;
  container.appendChild(location);

  // Add hint for go-to-definition
  const hint = document.createElement('div');
  hint.className = 'cm-tooltip-signature-hint';
  hint.textContent = `${isMac ? 'Cmd' : 'Ctrl'}+Click to go to definition`;
  container.appendChild(hint);

  return container;
}
