import {
  EditorView,
  ViewPlugin,
  keymap,
  lineNumbers,
  highlightActiveLine,
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

// Legacy modes (languages without native CodeMirror packages)
import { scala, kotlin, csharp, dart, objectiveC, objectiveCpp } from '@codemirror/legacy-modes/mode/clike';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { perl } from '@codemirror/legacy-modes/mode/perl';
import { r } from '@codemirror/legacy-modes/mode/r';
import { julia } from '@codemirror/legacy-modes/mode/julia';
import { haskell } from '@codemirror/legacy-modes/mode/haskell';
import { erlang } from '@codemirror/legacy-modes/mode/erlang';
import { clojure } from '@codemirror/legacy-modes/mode/clojure';
import { scheme } from '@codemirror/legacy-modes/mode/scheme';
import { commonLisp } from '@codemirror/legacy-modes/mode/commonlisp';
import { oCaml, fSharp, sml } from '@codemirror/legacy-modes/mode/mllike';
import { elm } from '@codemirror/legacy-modes/mode/elm';
import { coffeeScript } from '@codemirror/legacy-modes/mode/coffeescript';
import { liveScript } from '@codemirror/legacy-modes/mode/livescript';
import { groovy } from '@codemirror/legacy-modes/mode/groovy';
import { crystal } from '@codemirror/legacy-modes/mode/crystal';
import { d as dLang } from '@codemirror/legacy-modes/mode/d';
import { fortran } from '@codemirror/legacy-modes/mode/fortran';
import { pascal } from '@codemirror/legacy-modes/mode/pascal';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { nginx } from '@codemirror/legacy-modes/mode/nginx';
import { cmake } from '@codemirror/legacy-modes/mode/cmake';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { protobuf } from '@codemirror/legacy-modes/mode/protobuf';
import { verilog } from '@codemirror/legacy-modes/mode/verilog';
import { vhdl } from '@codemirror/legacy-modes/mode/vhdl';
import { gas } from '@codemirror/legacy-modes/mode/gas';
import { z80 } from '@codemirror/legacy-modes/mode/z80';
import { diff } from '@codemirror/legacy-modes/mode/diff';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { troff } from '@codemirror/legacy-modes/mode/troff';
import { sass } from '@codemirror/legacy-modes/mode/sass';
import { stylus } from '@codemirror/legacy-modes/mode/stylus';
import { pug } from '@codemirror/legacy-modes/mode/pug';
import { jinja2 } from '@codemirror/legacy-modes/mode/jinja2';
import { velocity } from '@codemirror/legacy-modes/mode/velocity';
import { textile } from '@codemirror/legacy-modes/mode/textile';
import { xQuery } from '@codemirror/legacy-modes/mode/xquery';
import { sparql } from '@codemirror/legacy-modes/mode/sparql';
import { turtle } from '@codemirror/legacy-modes/mode/turtle';
import { ntriples } from '@codemirror/legacy-modes/mode/ntriples';
import { cypher } from '@codemirror/legacy-modes/mode/cypher';
import { gherkin } from '@codemirror/legacy-modes/mode/gherkin';
import { http } from '@codemirror/legacy-modes/mode/http';
import { apl } from '@codemirror/legacy-modes/mode/apl';
import { brainfuck } from '@codemirror/legacy-modes/mode/brainfuck';
import { cobol } from '@codemirror/legacy-modes/mode/cobol';
import { eiffel } from '@codemirror/legacy-modes/mode/eiffel';
import { factor } from '@codemirror/legacy-modes/mode/factor';
import { forth } from '@codemirror/legacy-modes/mode/forth';
import { mathematica } from '@codemirror/legacy-modes/mode/mathematica';
import { modelica } from '@codemirror/legacy-modes/mode/modelica';
import { mumps } from '@codemirror/legacy-modes/mode/mumps';
import { smalltalk } from '@codemirror/legacy-modes/mode/smalltalk';
import { tcl } from '@codemirror/legacy-modes/mode/tcl';
import { vb } from '@codemirror/legacy-modes/mode/vb';
import { vbScript } from '@codemirror/legacy-modes/mode/vbscript';
import { sas } from '@codemirror/legacy-modes/mode/sas';
import { puppet } from '@codemirror/legacy-modes/mode/puppet';
import { octave } from '@codemirror/legacy-modes/mode/octave';
import { dylan } from '@codemirror/legacy-modes/mode/dylan';
import { oz } from '@codemirror/legacy-modes/mode/oz';
import { yacas } from '@codemirror/legacy-modes/mode/yacas';
import { webIDL } from '@codemirror/legacy-modes/mode/webidl';
import { idl } from '@codemirror/legacy-modes/mode/idl';
import { solr } from '@codemirror/legacy-modes/mode/solr';
import { sieve } from '@codemirror/legacy-modes/mode/sieve';
import { nsis } from '@codemirror/legacy-modes/mode/nsis';
import { pig } from '@codemirror/legacy-modes/mode/pig';
import { q } from '@codemirror/legacy-modes/mode/q';
import { ecl } from '@codemirror/legacy-modes/mode/ecl';
import { fcl } from '@codemirror/legacy-modes/mode/fcl';
import { ebnf } from '@codemirror/legacy-modes/mode/ebnf';

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
    highlightActiveLine(),
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
    getLanguageExtension(language),
    tooltips({ parent: document.body }),
  ];
}

// Map language names to CodeMirror language extensions.
// Language names come from getLanguageFromPath() in highlight.ts.
function getLanguageExtension(language: string | undefined): Extension {
  if (!language) return [];

  switch (language) {
    // --- Native CodeMirror packages ---
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

    // --- Legacy modes (clike family) ---
    case 'scala':
      return StreamLanguage.define(scala);
    case 'kotlin':
      return StreamLanguage.define(kotlin);
    case 'csharp':
      return StreamLanguage.define(csharp);
    case 'dart':
      return StreamLanguage.define(dart);
    case 'objectivec':
      return StreamLanguage.define(objectiveC);
    case 'objectivecpp':
      return StreamLanguage.define(objectiveCpp);

    // --- Legacy modes (scripting) ---
    case 'bash':
      return StreamLanguage.define(shell);
    case 'ruby':
      return StreamLanguage.define(ruby);
    case 'swift':
      return StreamLanguage.define(swift);
    case 'lua':
      return StreamLanguage.define(lua);
    case 'perl':
      return StreamLanguage.define(perl);
    case 'r':
      return StreamLanguage.define(r);
    case 'julia':
      return StreamLanguage.define(julia);
    case 'groovy':
      return StreamLanguage.define(groovy);
    case 'coffeescript':
      return StreamLanguage.define(coffeeScript);
    case 'livescript':
      return StreamLanguage.define(liveScript);
    case 'crystal':
      return StreamLanguage.define(crystal);
    case 'tcl':
      return StreamLanguage.define(tcl);
    case 'puppet':
      return StreamLanguage.define(puppet);

    // --- Legacy modes (functional) ---
    case 'haskell':
      return StreamLanguage.define(haskell);
    case 'erlang':
      return StreamLanguage.define(erlang);
    case 'clojure':
      return StreamLanguage.define(clojure);
    case 'scheme':
      return StreamLanguage.define(scheme);
    case 'commonlisp':
      return StreamLanguage.define(commonLisp);
    case 'ocaml':
      return StreamLanguage.define(oCaml);
    case 'fsharp':
      return StreamLanguage.define(fSharp);
    case 'sml':
      return StreamLanguage.define(sml);
    case 'elm':
      return StreamLanguage.define(elm);
    case 'factor':
      return StreamLanguage.define(factor);
    case 'forth':
      return StreamLanguage.define(forth);
    case 'smalltalk':
      return StreamLanguage.define(smalltalk);
    case 'apl':
      return StreamLanguage.define(apl);
    case 'oz':
      return StreamLanguage.define(oz);

    // --- Legacy modes (systems/compiled) ---
    case 'd':
      return StreamLanguage.define(dLang);
    case 'fortran':
      return StreamLanguage.define(fortran);
    case 'pascal':
      return StreamLanguage.define(pascal);
    case 'verilog':
      return StreamLanguage.define(verilog);
    case 'vhdl':
      return StreamLanguage.define(vhdl);
    case 'gas':
      return StreamLanguage.define(gas);
    case 'z80':
      return StreamLanguage.define(z80);
    case 'cobol':
      return StreamLanguage.define(cobol);
    case 'eiffel':
      return StreamLanguage.define(eiffel);
    case 'modelica':
      return StreamLanguage.define(modelica);

    // --- Legacy modes (DevOps/config) ---
    case 'dockerfile':
      return StreamLanguage.define(dockerFile);
    case 'nginx':
      return StreamLanguage.define(nginx);
    case 'cmake':
      return StreamLanguage.define(cmake);
    case 'powershell':
      return StreamLanguage.define(powerShell);
    case 'properties':
      return StreamLanguage.define(properties);
    case 'toml':
      return StreamLanguage.define(toml);
    case 'protobuf':
      return StreamLanguage.define(protobuf);
    case 'nsis':
      return StreamLanguage.define(nsis);

    // --- Legacy modes (web/template) ---
    case 'sass':
      return StreamLanguage.define(sass);
    case 'stylus':
      return StreamLanguage.define(stylus);
    case 'pug':
      return StreamLanguage.define(pug);
    case 'jinja2':
      return StreamLanguage.define(jinja2);
    case 'velocity':
      return StreamLanguage.define(velocity);
    case 'textile':
      return StreamLanguage.define(textile);

    // --- Legacy modes (data/query) ---
    case 'xquery':
      return StreamLanguage.define(xQuery);
    case 'sparql':
      return StreamLanguage.define(sparql);
    case 'turtle':
      return StreamLanguage.define(turtle);
    case 'ntriples':
      return StreamLanguage.define(ntriples);
    case 'cypher':
      return StreamLanguage.define(cypher);
    case 'solr':
      return StreamLanguage.define(solr);
    case 'pig':
      return StreamLanguage.define(pig);
    case 'q':
      return StreamLanguage.define(q);
    case 'ecl':
      return StreamLanguage.define(ecl);

    // --- Legacy modes (document/markup) ---
    case 'diff':
      return StreamLanguage.define(diff);
    case 'latex':
      return StreamLanguage.define(stex);
    case 'troff':
      return StreamLanguage.define(troff);
    case 'gherkin':
      return StreamLanguage.define(gherkin);
    case 'http':
      return StreamLanguage.define(http);

    // --- Legacy modes (math/science) ---
    case 'mathematica':
      return StreamLanguage.define(mathematica);
    case 'octave':
      return StreamLanguage.define(octave);
    case 'sas':
      return StreamLanguage.define(sas);
    case 'dylan':
      return StreamLanguage.define(dylan);
    case 'yacas':
      return StreamLanguage.define(yacas);
    case 'fcl':
      return StreamLanguage.define(fcl);

    // --- Legacy modes (other) ---
    case 'brainfuck':
      return StreamLanguage.define(brainfuck);
    case 'mumps':
      return StreamLanguage.define(mumps);
    case 'vb':
      return StreamLanguage.define(vb);
    case 'vbscript':
      return StreamLanguage.define(vbScript);
    case 'webidl':
      return StreamLanguage.define(webIDL);
    case 'idl':
      return StreamLanguage.define(idl);
    case 'sieve':
      return StreamLanguage.define(sieve);
    case 'ebnf':
      return StreamLanguage.define(ebnf);

    default:
      return [];
  }
}
