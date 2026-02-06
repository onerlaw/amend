import { EditorView, ViewPlugin, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { tags } from '@lezer/highlight';
import { javascript } from '@codemirror/lang-javascript';
import { rust } from '@codemirror/lang-rust';
import { python } from '@codemirror/lang-python';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { markdown } from '@codemirror/lang-markdown';
import { Extension } from '@codemirror/state';

// Custom syntax highlighting theme - colors stay consistent across light/dark
const customHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: '#c084fc' }, // Purple
  { tag: tags.controlKeyword, color: '#c084fc' },
  { tag: tags.operatorKeyword, color: '#c084fc' },
  { tag: tags.definitionKeyword, color: '#c084fc' },
  { tag: tags.moduleKeyword, color: '#c084fc' },
  { tag: tags.comment, color: '#6b7280', fontStyle: 'italic' },
  { tag: tags.lineComment, color: '#6b7280', fontStyle: 'italic' },
  { tag: tags.blockComment, color: '#6b7280', fontStyle: 'italic' },
  { tag: tags.docComment, color: '#6b7280', fontStyle: 'italic' },
  { tag: tags.string, color: '#22c55e' }, // Green
  { tag: tags.special(tags.string), color: '#22c55e' },
  { tag: tags.number, color: '#f97316' }, // Orange
  { tag: tags.integer, color: '#f97316' },
  { tag: tags.float, color: '#f97316' },
  { tag: tags.bool, color: '#f97316' },
  { tag: tags.null, color: '#f97316' },
  { tag: tags.function(tags.variableName), color: '#3b82f6' }, // Blue
  { tag: tags.function(tags.propertyName), color: '#3b82f6' },
  { tag: tags.typeName, color: '#06b6d4' }, // Cyan
  { tag: tags.className, color: '#06b6d4' },
  { tag: tags.labelName, color: '#06b6d4' },
  { tag: tags.namespace, color: '#06b6d4' },
  { tag: tags.macroName, color: '#06b6d4' },
  { tag: tags.variableName, color: 'var(--text-primary)' },
  { tag: tags.propertyName, color: '#06b6d4' },
  { tag: tags.attributeName, color: '#06b6d4' },
  { tag: tags.operator, color: 'var(--text-primary)' },
  { tag: tags.punctuation, color: 'var(--text-secondary)' },
  { tag: tags.bracket, color: 'var(--text-secondary)' },
  { tag: tags.angleBracket, color: 'var(--text-secondary)' },
  { tag: tags.squareBracket, color: 'var(--text-secondary)' },
  { tag: tags.paren, color: 'var(--text-secondary)' },
  { tag: tags.brace, color: 'var(--text-secondary)' },
  { tag: tags.tagName, color: '#ec4899' }, // Pink
  { tag: tags.self, color: '#c084fc' },
  { tag: tags.atom, color: '#f97316' },
  { tag: tags.unit, color: '#f97316' },
  { tag: tags.regexp, color: '#ec4899' },
  { tag: tags.escape, color: '#f97316' },
  { tag: tags.link, color: '#3b82f6', textDecoration: 'underline' },
  { tag: tags.url, color: '#3b82f6', textDecoration: 'underline' },
  { tag: tags.heading, color: '#3b82f6', fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.invalid, color: '#fca5a5' },
]);

// Theme that uses CSS variables for colors
const darkTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'var(--surface-0)',
      color: 'var(--text-primary)',
      height: '100%',
    },
    '.cm-content': {
      caretColor: 'var(--text-primary)',
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: '13px',
    },
    '.cm-cursor': {
      borderLeftColor: 'var(--text-primary)',
    },
    '.cm-activeLine': {
      backgroundColor: 'var(--surface-1)',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: 'var(--accent)',
      opacity: '0.3',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--surface-1)',
      color: 'var(--text-tertiary)',
      border: 'none',
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: '13px',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--surface-2)',
      color: 'var(--text-secondary)',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 8px 0 16px',
    },
    // Go-to-definition cursor style
    '&.cm-go-to-definition-active': {
      cursor: 'pointer',
    },
    // Hover tooltip styles
    '.cm-tooltip-signature': {
      backgroundColor: 'var(--surface-2)',
      border: '1px solid var(--border)',
      borderRadius: '6px',
      padding: '8px 12px',
      maxWidth: '400px',
      fontSize: '12px',
      lineHeight: '1.4',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
    },
    '.cm-tooltip-signature-header': {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      marginBottom: '4px',
    },
    '.cm-tooltip-signature-kind': {
      fontSize: '10px',
      padding: '2px 6px',
      borderRadius: '3px',
      backgroundColor: 'var(--surface-3)',
      color: 'var(--text-secondary)',
      textTransform: 'uppercase',
      fontWeight: '500',
    },
    '.cm-tooltip-kind-function': {
      backgroundColor: 'rgba(59, 130, 246, 0.2)',
      color: '#3b82f6',
    },
    '.cm-tooltip-kind-class': {
      backgroundColor: 'rgba(6, 182, 212, 0.2)',
      color: '#06b6d4',
    },
    '.cm-tooltip-kind-type, .cm-tooltip-kind-interface': {
      backgroundColor: 'rgba(6, 182, 212, 0.2)',
      color: '#06b6d4',
    },
    '.cm-tooltip-kind-variable': {
      backgroundColor: 'rgba(34, 197, 94, 0.2)',
      color: '#22c55e',
    },
    '.cm-tooltip-kind-import': {
      backgroundColor: 'rgba(192, 132, 252, 0.2)',
      color: '#c084fc',
    },
    '.cm-tooltip-signature-name': {
      fontWeight: '600',
      color: 'var(--text-primary)',
    },
    '.cm-tooltip-signature-code': {
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: '11px',
      color: 'var(--text-secondary)',
      backgroundColor: 'var(--surface-1)',
      padding: '4px 8px',
      borderRadius: '4px',
      marginTop: '4px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
    '.cm-tooltip-signature-location': {
      fontSize: '11px',
      color: 'var(--text-tertiary)',
      marginTop: '4px',
    },
    '.cm-tooltip-signature-separator': {
      border: 'none',
      borderTop: '1px solid var(--border)',
      margin: '8px 0',
    },
    '.cm-tooltip-signature-ext-header': {
      fontSize: '11px',
      color: 'var(--text-tertiary)',
      marginBottom: '4px',
    },
    '.cm-tooltip-signature-ext-item': {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '2px 0',
    },
    '.cm-tooltip-signature-file': {
      fontSize: '11px',
      color: 'var(--text-secondary)',
    },
    '.cm-tooltip-signature-more': {
      fontSize: '11px',
      color: 'var(--text-tertiary)',
      fontStyle: 'italic',
      marginTop: '4px',
    },
    '.cm-tooltip-signature-hint': {
      fontSize: '10px',
      color: 'var(--text-tertiary)',
      marginTop: '8px',
      paddingTop: '8px',
      borderTop: '1px solid var(--border)',
    },
    // Search panel styles
    '.cm-panels': {
      backgroundColor: 'var(--surface-1)',
      borderBottom: '1px solid var(--border)',
      color: 'var(--text-primary)',
    },
    '.cm-search': {
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: '4px',
      padding: '4px 8px',
      fontSize: '12px',
    },
    '.cm-search input': {
      backgroundColor: 'var(--surface-0)',
      border: '1px solid var(--border)',
      borderRadius: '4px',
      color: 'var(--text-primary)',
      padding: '2px 6px',
      fontSize: '12px',
      outline: 'none',
    },
    '.cm-search input:focus': {
      borderColor: 'var(--accent)',
    },
    '.cm-search button': {
      backgroundColor: 'var(--surface-2)',
      border: '1px solid var(--border)',
      borderRadius: '4px',
      color: 'var(--text-secondary)',
      padding: '2px 8px',
      fontSize: '12px',
      cursor: 'pointer',
    },
    '.cm-search button:hover': {
      backgroundColor: 'var(--surface-3)',
      color: 'var(--text-primary)',
    },
    '.cm-search label': {
      color: 'var(--text-secondary)',
      fontSize: '12px',
    },
    '.cm-searchMatch': {
      backgroundColor: 'rgba(250, 204, 21, 0.3)',
      borderRadius: '2px',
    },
    '.cm-searchMatch-selected': {
      backgroundColor: 'rgba(250, 204, 21, 0.6)',
    },
  },
  { dark: false } // Set to false so it adapts to CSS variables
);

// Fixed gutters — move the gutter element OUT of the horizontal scroll
// container so it never scrolls sideways. Vertical scroll is synced via
// scrollTop on a clipping wrapper. This avoids WebKit bugs with
// position:sticky in flex scroll containers and the one-frame lag of
// JS transform workarounds.
const stickyGutters = ViewPlugin.fromClass(
  class {
    private wrapper: HTMLDivElement | null = null;
    private gutterClip: HTMLDivElement | null = null;
    private gutters: HTMLElement | null = null;

    constructor(private view: EditorView) {
      const scroller = view.scrollDOM;
      const gutters = scroller.querySelector('.cm-gutters') as HTMLElement | null;
      if (!gutters) return;
      this.gutters = gutters;

      // Remove CodeMirror's inline sticky (no longer needed)
      gutters.style.position = '';

      // Create a flex-row wrapper that sits where the scroller was
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'display:flex;flex:1;min-height:0;';
      this.wrapper = wrapper;

      // Gutter clip container — clips vertical overflow, never scrolls horizontally
      const gutterClip = document.createElement('div');
      gutterClip.style.cssText = 'overflow:hidden;flex-shrink:0;';
      this.gutterClip = gutterClip;

      // Move gutters from scroller into the clip container
      gutterClip.appendChild(gutters);

      // Insert wrapper where scroller was, then nest gutter-clip + scroller
      const editor = view.dom;
      editor.insertBefore(wrapper, scroller);
      wrapper.appendChild(gutterClip);
      wrapper.appendChild(scroller);

      // Sync vertical scroll
      scroller.addEventListener('scroll', this.syncScroll, { passive: true });
      this.syncScroll();
    }

    syncScroll = () => {
      if (this.gutterClip) {
        this.gutterClip.scrollTop = this.view.scrollDOM.scrollTop;
      }
    };

    update() {
      this.syncScroll();
    }

    destroy() {
      this.view.scrollDOM.removeEventListener('scroll', this.syncScroll);
      // Restore the original DOM so CodeMirror can tear down cleanly
      if (this.wrapper && this.gutters) {
        const scroller = this.view.scrollDOM;
        const editor = this.view.dom;
        scroller.insertBefore(this.gutters, scroller.firstChild);
        editor.insertBefore(scroller, this.wrapper);
        this.wrapper.remove();
      }
    }
  }
);

/**
 * Creates the base set of CodeMirror extensions shared across all editor instances.
 */
export function createBaseExtensions(language: string | undefined): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLine(),
    history(),
    search(),
    highlightSelectionMatches(),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    darkTheme,
    stickyGutters,
    syntaxHighlighting(customHighlightStyle),
    getLanguageExtension(language),
  ];
}

// Map language names to CodeMirror language extensions
// Supports languages from getLanguageFromPath() in highlight.ts
function getLanguageExtension(language: string | undefined): Extension {
  if (!language) return [];

  switch (language) {
    case 'javascript':
      return javascript({ jsx: true });
    case 'typescript':
      return javascript({ typescript: true, jsx: true });
    case 'rust':
      return rust();
    case 'python':
      return python();
    case 'json':
      return json();
    case 'html':
    case 'xml':
      return html();
    case 'css':
      return css();
    case 'markdown':
      return markdown();
    // Languages without CodeMirror support fall through to plain text
    case 'yaml':
    case 'bash':
    case 'sql':
    case 'go':
    case 'java':
    case 'c':
    case 'cpp':
    default:
      return [];
  }
}
