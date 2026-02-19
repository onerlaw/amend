import {
  EditorView,
  ViewPlugin,
  keymap,
  lineNumbers,
  tooltips,
  drawSelection,
  dropCursor,
} from '@codemirror/view';
import {
  HighlightStyle,
  StreamLanguage,
  syntaxHighlighting,
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
} from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { search, searchKeymap, highlightSelectionMatches, gotoLine } from '@codemirror/search';
import { tags } from '@lezer/highlight';
import { indentationMarkers } from '@replit/codemirror-indentation-markers';
import { javascript } from '@codemirror/lang-javascript';
import { rust } from '@codemirror/lang-rust';
import { python } from '@codemirror/lang-python';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { xml } from '@codemirror/lang-xml';
import { css } from '@codemirror/lang-css';
import { less } from '@codemirror/lang-less';
import { markdown } from '@codemirror/lang-markdown';
import { java } from '@codemirror/lang-java';
import { go } from '@codemirror/lang-go';
import { sql } from '@codemirror/lang-sql';
import { yaml } from '@codemirror/lang-yaml';
import { cpp } from '@codemirror/lang-cpp';
import { php } from '@codemirror/lang-php';
import { vue } from '@codemirror/lang-vue';
import { wast } from '@codemirror/lang-wast';
import { liquid } from '@codemirror/lang-liquid';

import { Compartment, Extension } from '@codemirror/state';

const languageCompartment = new Compartment();

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
      fontSize: 'var(--editor-font-size, 13px)',
    },
    '.cm-cursor': {
      borderLeftColor: 'var(--text-primary)',
    },
    // The stickyGutters plugin inserts a wrapper between .cm-editor and
    // .cm-scroller, breaking CodeMirror's direct-child selectors for
    // cursor/selection visibility. Re-declare them without `>`.
    '&.cm-focused .cm-cursorLayer': {
      animation: 'steps(1) cm-blink 1.2s infinite',
    },
    '&.cm-focused .cm-cursorLayer .cm-cursor': {
      display: 'block',
    },
    '&.cm-focused .cm-selectionLayer .cm-selectionBackground': {
      background: 'var(--accent)',
      opacity: '0.3',
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
      fontSize: 'var(--editor-font-size, 13px)',
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
    '.cm-go-to-definition-link': {
      textDecoration: 'underline',
      textDecorationColor: 'var(--accent)',
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
    // Bracket matching
    '&.cm-focused .cm-matchingBracket': {
      backgroundColor: 'rgba(59, 130, 246, 0.15)',
      outline: '1px solid rgba(59, 130, 246, 0.4)',
      borderRadius: '2px',
    },
    '&.cm-focused .cm-nonmatchingBracket': {
      backgroundColor: 'rgba(239, 68, 68, 0.15)',
      outline: '1px solid rgba(239, 68, 68, 0.4)',
      borderRadius: '2px',
    },
    // Fold gutter
    '.cm-foldGutter': {
      width: '12px',
    },
    '.cm-foldGutter .cm-gutterElement': {
      color: 'var(--text-tertiary)',
      cursor: 'pointer',
      textAlign: 'center',
      lineHeight: 'inherit',
    },
    '.cm-foldGutter .cm-gutterElement:hover': {
      color: 'var(--text-primary)',
    },
    '.cm-foldPlaceholder': {
      backgroundColor: 'var(--surface-2)',
      border: '1px solid var(--border)',
      borderRadius: '3px',
      padding: '0 4px',
      margin: '0 2px',
      color: 'var(--text-tertiary)',
      cursor: 'pointer',
    },
    // Go-to-line dialog (reuses search panel container)
    '.cm-gotoLine': {
      padding: '4px 8px',
      fontSize: '12px',
    },
    '.cm-gotoLine input': {
      backgroundColor: 'var(--surface-0)',
      border: '1px solid var(--border)',
      borderRadius: '4px',
      color: 'var(--text-primary)',
      padding: '2px 6px',
      fontSize: '12px',
      outline: 'none',
    },
    '.cm-gotoLine input:focus': {
      borderColor: 'var(--accent)',
    },
    '.cm-gotoLine button': {
      backgroundColor: 'var(--surface-2)',
      border: '1px solid var(--border)',
      borderRadius: '4px',
      color: 'var(--text-secondary)',
      padding: '2px 8px',
      fontSize: '12px',
      cursor: 'pointer',
    },
    '.cm-gotoLine button:hover': {
      backgroundColor: 'var(--surface-3)',
      color: 'var(--text-primary)',
    },
    '.cm-gotoLine label': {
      color: 'var(--text-secondary)',
      fontSize: '12px',
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
      wrapper.style.cssText = 'display:flex;flex-direction:row;flex:1;min-height:0;';
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

      // Make the scroller fill the remaining width after the gutter
      scroller.style.flex = '1';
      scroller.style.minWidth = '0';

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
      if (this.gutters && this.gutterClip) {
        // CodeMirror's syncGutters(detach=true) can rip the gutters out of
        // the gutterClip and re-append them to the scroller. Detect this
        // and move them back.
        if (this.gutters.parentElement !== this.gutterClip) {
          this.gutterClip.appendChild(this.gutters);
        }
        // CodeMirror's gutter extension re-applies position:sticky on updates;
        // clear it every time so the gutter stays in our flex wrapper column.
        this.gutters.style.position = '';
      }
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
    foldGutter(),
    lineNumbers(),
    history(),
    search(),
    highlightSelectionMatches(),
    closeBrackets(),
    bracketMatching(),
    indentOnInput(),
    drawSelection(),
    dropCursor(),
    indentationMarkers({ highlightActiveBlock: true }),

    // High-priority keymap: Mod-g → gotoLine (overrides searchKeymap's findNext)
    keymap.of([{ key: 'Mod-g', run: gotoLine }]),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      ...foldKeymap,
    ]),

    darkTheme,
    stickyGutters,
    syntaxHighlighting(customHighlightStyle),
    languageCompartment.of(getNativeLanguageExtension(language) ?? []),
    tooltips({ parent: document.body }),
  ];
}

// Returns a native CodeMirror language extension synchronously, or null for legacy modes.
function getNativeLanguageExtension(language: string | undefined): Extension | null {
  if (!language) return null;

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
      return html();
    case 'xml':
      return xml();
    case 'css':
      return css();
    case 'less':
      return less();
    case 'markdown':
      return markdown();
    case 'java':
      return java();
    case 'go':
      return go();
    case 'sql':
      return sql();
    case 'yaml':
      return yaml();
    case 'c':
    case 'cpp':
      return cpp();
    case 'php':
      return php();
    case 'vue':
      return vue();
    case 'wast':
      return wast();
    case 'liquid':
      return liquid();
    default:
      return null;
  }
}

// Dynamically imports a legacy mode and returns a StreamLanguage extension.
async function getLegacyLanguageExtension(language: string): Promise<Extension | null> {
  switch (language) {
    // --- clike family ---
    case 'scala':
      return import('@codemirror/legacy-modes/mode/clike').then((m) =>
        StreamLanguage.define(m.scala)
      );
    case 'kotlin':
      return import('@codemirror/legacy-modes/mode/clike').then((m) =>
        StreamLanguage.define(m.kotlin)
      );
    case 'csharp':
      return import('@codemirror/legacy-modes/mode/clike').then((m) =>
        StreamLanguage.define(m.csharp)
      );
    case 'dart':
      return import('@codemirror/legacy-modes/mode/clike').then((m) =>
        StreamLanguage.define(m.dart)
      );
    case 'objectivec':
      return import('@codemirror/legacy-modes/mode/clike').then((m) =>
        StreamLanguage.define(m.objectiveC)
      );
    case 'objectivecpp':
      return import('@codemirror/legacy-modes/mode/clike').then((m) =>
        StreamLanguage.define(m.objectiveCpp)
      );

    // --- scripting ---
    case 'bash':
      return import('@codemirror/legacy-modes/mode/shell').then((m) =>
        StreamLanguage.define(m.shell)
      );
    case 'ruby':
      return import('@codemirror/legacy-modes/mode/ruby').then((m) =>
        StreamLanguage.define(m.ruby)
      );
    case 'swift':
      return import('@codemirror/legacy-modes/mode/swift').then((m) =>
        StreamLanguage.define(m.swift)
      );
    case 'lua':
      return import('@codemirror/legacy-modes/mode/lua').then((m) => StreamLanguage.define(m.lua));
    case 'perl':
      return import('@codemirror/legacy-modes/mode/perl').then((m) =>
        StreamLanguage.define(m.perl)
      );
    case 'r':
      return import('@codemirror/legacy-modes/mode/r').then((m) => StreamLanguage.define(m.r));
    case 'julia':
      return import('@codemirror/legacy-modes/mode/julia').then((m) =>
        StreamLanguage.define(m.julia)
      );
    case 'groovy':
      return import('@codemirror/legacy-modes/mode/groovy').then((m) =>
        StreamLanguage.define(m.groovy)
      );
    case 'coffeescript':
      return import('@codemirror/legacy-modes/mode/coffeescript').then((m) =>
        StreamLanguage.define(m.coffeeScript)
      );
    case 'livescript':
      return import('@codemirror/legacy-modes/mode/livescript').then((m) =>
        StreamLanguage.define(m.liveScript)
      );
    case 'crystal':
      return import('@codemirror/legacy-modes/mode/crystal').then((m) =>
        StreamLanguage.define(m.crystal)
      );
    case 'tcl':
      return import('@codemirror/legacy-modes/mode/tcl').then((m) => StreamLanguage.define(m.tcl));
    case 'puppet':
      return import('@codemirror/legacy-modes/mode/puppet').then((m) =>
        StreamLanguage.define(m.puppet)
      );

    // --- functional ---
    case 'haskell':
      return import('@codemirror/legacy-modes/mode/haskell').then((m) =>
        StreamLanguage.define(m.haskell)
      );
    case 'erlang':
      return import('@codemirror/legacy-modes/mode/erlang').then((m) =>
        StreamLanguage.define(m.erlang)
      );
    case 'clojure':
      return import('@codemirror/legacy-modes/mode/clojure').then((m) =>
        StreamLanguage.define(m.clojure)
      );
    case 'scheme':
      return import('@codemirror/legacy-modes/mode/scheme').then((m) =>
        StreamLanguage.define(m.scheme)
      );
    case 'commonlisp':
      return import('@codemirror/legacy-modes/mode/commonlisp').then((m) =>
        StreamLanguage.define(m.commonLisp)
      );
    case 'ocaml':
      return import('@codemirror/legacy-modes/mode/mllike').then((m) =>
        StreamLanguage.define(m.oCaml)
      );
    case 'fsharp':
      return import('@codemirror/legacy-modes/mode/mllike').then((m) =>
        StreamLanguage.define(m.fSharp)
      );
    case 'sml':
      return import('@codemirror/legacy-modes/mode/mllike').then((m) =>
        StreamLanguage.define(m.sml)
      );
    case 'elm':
      return import('@codemirror/legacy-modes/mode/elm').then((m) => StreamLanguage.define(m.elm));
    case 'factor':
      return import('@codemirror/legacy-modes/mode/factor').then((m) =>
        StreamLanguage.define(m.factor)
      );
    case 'forth':
      return import('@codemirror/legacy-modes/mode/forth').then((m) =>
        StreamLanguage.define(m.forth)
      );
    case 'smalltalk':
      return import('@codemirror/legacy-modes/mode/smalltalk').then((m) =>
        StreamLanguage.define(m.smalltalk)
      );
    case 'apl':
      return import('@codemirror/legacy-modes/mode/apl').then((m) => StreamLanguage.define(m.apl));
    case 'oz':
      return import('@codemirror/legacy-modes/mode/oz').then((m) => StreamLanguage.define(m.oz));

    // --- systems/compiled ---
    case 'd':
      return import('@codemirror/legacy-modes/mode/d').then((m) => StreamLanguage.define(m.d));
    case 'fortran':
      return import('@codemirror/legacy-modes/mode/fortran').then((m) =>
        StreamLanguage.define(m.fortran)
      );
    case 'pascal':
      return import('@codemirror/legacy-modes/mode/pascal').then((m) =>
        StreamLanguage.define(m.pascal)
      );
    case 'verilog':
      return import('@codemirror/legacy-modes/mode/verilog').then((m) =>
        StreamLanguage.define(m.verilog)
      );
    case 'vhdl':
      return import('@codemirror/legacy-modes/mode/vhdl').then((m) =>
        StreamLanguage.define(m.vhdl)
      );
    case 'gas':
      return import('@codemirror/legacy-modes/mode/gas').then((m) => StreamLanguage.define(m.gas));
    case 'z80':
      return import('@codemirror/legacy-modes/mode/z80').then((m) => StreamLanguage.define(m.z80));
    case 'cobol':
      return import('@codemirror/legacy-modes/mode/cobol').then((m) =>
        StreamLanguage.define(m.cobol)
      );
    case 'eiffel':
      return import('@codemirror/legacy-modes/mode/eiffel').then((m) =>
        StreamLanguage.define(m.eiffel)
      );
    case 'modelica':
      return import('@codemirror/legacy-modes/mode/modelica').then((m) =>
        StreamLanguage.define(m.modelica)
      );

    // --- DevOps/config ---
    case 'dockerfile':
      return import('@codemirror/legacy-modes/mode/dockerfile').then((m) =>
        StreamLanguage.define(m.dockerFile)
      );
    case 'nginx':
      return import('@codemirror/legacy-modes/mode/nginx').then((m) =>
        StreamLanguage.define(m.nginx)
      );
    case 'cmake':
      return import('@codemirror/legacy-modes/mode/cmake').then((m) =>
        StreamLanguage.define(m.cmake)
      );
    case 'powershell':
      return import('@codemirror/legacy-modes/mode/powershell').then((m) =>
        StreamLanguage.define(m.powerShell)
      );
    case 'properties':
      return import('@codemirror/legacy-modes/mode/properties').then((m) =>
        StreamLanguage.define(m.properties)
      );
    case 'toml':
      return import('@codemirror/legacy-modes/mode/toml').then((m) =>
        StreamLanguage.define(m.toml)
      );
    case 'protobuf':
      return import('@codemirror/legacy-modes/mode/protobuf').then((m) =>
        StreamLanguage.define(m.protobuf)
      );
    case 'nsis':
      return import('@codemirror/legacy-modes/mode/nsis').then((m) =>
        StreamLanguage.define(m.nsis)
      );

    // --- web/template ---
    case 'sass':
      return import('@codemirror/legacy-modes/mode/sass').then((m) =>
        StreamLanguage.define(m.sass)
      );
    case 'stylus':
      return import('@codemirror/legacy-modes/mode/stylus').then((m) =>
        StreamLanguage.define(m.stylus)
      );
    case 'pug':
      return import('@codemirror/legacy-modes/mode/pug').then((m) => StreamLanguage.define(m.pug));
    case 'jinja2':
      return import('@codemirror/legacy-modes/mode/jinja2').then((m) =>
        StreamLanguage.define(m.jinja2)
      );
    case 'velocity':
      return import('@codemirror/legacy-modes/mode/velocity').then((m) =>
        StreamLanguage.define(m.velocity)
      );
    case 'textile':
      return import('@codemirror/legacy-modes/mode/textile').then((m) =>
        StreamLanguage.define(m.textile)
      );

    // --- data/query ---
    case 'xquery':
      return import('@codemirror/legacy-modes/mode/xquery').then((m) =>
        StreamLanguage.define(m.xQuery)
      );
    case 'sparql':
      return import('@codemirror/legacy-modes/mode/sparql').then((m) =>
        StreamLanguage.define(m.sparql)
      );
    case 'turtle':
      return import('@codemirror/legacy-modes/mode/turtle').then((m) =>
        StreamLanguage.define(m.turtle)
      );
    case 'ntriples':
      return import('@codemirror/legacy-modes/mode/ntriples').then((m) =>
        StreamLanguage.define(m.ntriples)
      );
    case 'cypher':
      return import('@codemirror/legacy-modes/mode/cypher').then((m) =>
        StreamLanguage.define(m.cypher)
      );
    case 'solr':
      return import('@codemirror/legacy-modes/mode/solr').then((m) =>
        StreamLanguage.define(m.solr)
      );
    case 'pig':
      return import('@codemirror/legacy-modes/mode/pig').then((m) => StreamLanguage.define(m.pig));
    case 'q':
      return import('@codemirror/legacy-modes/mode/q').then((m) => StreamLanguage.define(m.q));
    case 'ecl':
      return import('@codemirror/legacy-modes/mode/ecl').then((m) => StreamLanguage.define(m.ecl));

    // --- document/markup ---
    case 'diff':
      return import('@codemirror/legacy-modes/mode/diff').then((m) =>
        StreamLanguage.define(m.diff)
      );
    case 'latex':
      return import('@codemirror/legacy-modes/mode/stex').then((m) =>
        StreamLanguage.define(m.stex)
      );
    case 'troff':
      return import('@codemirror/legacy-modes/mode/troff').then((m) =>
        StreamLanguage.define(m.troff)
      );
    case 'gherkin':
      return import('@codemirror/legacy-modes/mode/gherkin').then((m) =>
        StreamLanguage.define(m.gherkin)
      );
    case 'http':
      return import('@codemirror/legacy-modes/mode/http').then((m) =>
        StreamLanguage.define(m.http)
      );

    // --- math/science ---
    case 'mathematica':
      return import('@codemirror/legacy-modes/mode/mathematica').then((m) =>
        StreamLanguage.define(m.mathematica)
      );
    case 'octave':
      return import('@codemirror/legacy-modes/mode/octave').then((m) =>
        StreamLanguage.define(m.octave)
      );
    case 'sas':
      return import('@codemirror/legacy-modes/mode/sas').then((m) => StreamLanguage.define(m.sas));
    case 'dylan':
      return import('@codemirror/legacy-modes/mode/dylan').then((m) =>
        StreamLanguage.define(m.dylan)
      );
    case 'yacas':
      return import('@codemirror/legacy-modes/mode/yacas').then((m) =>
        StreamLanguage.define(m.yacas)
      );
    case 'fcl':
      return import('@codemirror/legacy-modes/mode/fcl').then((m) => StreamLanguage.define(m.fcl));

    // --- other ---
    case 'brainfuck':
      return import('@codemirror/legacy-modes/mode/brainfuck').then((m) =>
        StreamLanguage.define(m.brainfuck)
      );
    case 'mumps':
      return import('@codemirror/legacy-modes/mode/mumps').then((m) =>
        StreamLanguage.define(m.mumps)
      );
    case 'vb':
      return import('@codemirror/legacy-modes/mode/vb').then((m) => StreamLanguage.define(m.vb));
    case 'vbscript':
      return import('@codemirror/legacy-modes/mode/vbscript').then((m) =>
        StreamLanguage.define(m.vbScript)
      );
    case 'webidl':
      return import('@codemirror/legacy-modes/mode/webidl').then((m) =>
        StreamLanguage.define(m.webIDL)
      );
    case 'idl':
      return import('@codemirror/legacy-modes/mode/idl').then((m) => StreamLanguage.define(m.idl));
    case 'sieve':
      return import('@codemirror/legacy-modes/mode/sieve').then((m) =>
        StreamLanguage.define(m.sieve)
      );
    case 'ebnf':
      return import('@codemirror/legacy-modes/mode/ebnf').then((m) =>
        StreamLanguage.define(m.ebnf)
      );

    default:
      return null;
  }
}

/**
 * Asynchronously loads a legacy language extension into an existing editor view.
 * No-ops for native languages (already loaded synchronously) and unknown languages.
 * Guards against destroyed views to prevent stale dispatches.
 */
export async function loadLanguageExtension(
  view: EditorView,
  language: string | undefined
): Promise<void> {
  if (!language) return;
  // Native languages are already loaded in the compartment
  if (getNativeLanguageExtension(language) !== null) return;

  const ext = await getLegacyLanguageExtension(language);
  if (!ext) return;
  // Guard against the view being destroyed while we were loading
  if (!view.dom.parentNode) return;

  view.dispatch({
    effects: languageCompartment.reconfigure(ext),
  });
}
