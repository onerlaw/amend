import { hoverTooltip, Tooltip, EditorView } from '@codemirror/view';
import { Extension } from '@codemirror/state';
import { getSymbolAtPosition, findDefinitionInFile, LocalDefinition } from '@/lib/symbolNavigation';

export interface HoverTooltipConfig {
  currentFilePath: string;
  delay?: number;
}

/**
 * Creates a hover tooltip extension that shows symbol information
 * Only uses local (in-file) definitions to avoid async issues
 */
export function symbolHoverTooltip(config: HoverTooltipConfig): Extension {
  const { delay = 300 } = config;

  return hoverTooltip(
    (view: EditorView, pos: number): Tooltip | null => {
      const symbol = getSymbolAtPosition(view, pos);
      if (!symbol) return null;

      // Only use local definitions (synchronous) for hover
      const localDefs = findDefinitionInFile(view, symbol.name);

      // If no local definitions, don't show tooltip
      if (localDefs.length === 0) {
        return null;
      }

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
 * Create the DOM content for the tooltip
 */
function createTooltipContent(
  symbolName: string,
  localDefs: LocalDefinition[]
): HTMLElement {
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
      sig.textContent = localDef.signature;
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
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  hint.textContent = `${isMac ? 'Cmd' : 'Ctrl'}+Click to go to definition`;
  container.appendChild(hint);

  return container;
}
