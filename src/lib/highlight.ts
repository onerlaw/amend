import hljs from 'highlight.js/lib/core';

// Import only the languages we need to reduce bundle size
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import rust from 'highlight.js/lib/languages/rust';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml'; // For HTML
import markdown from 'highlight.js/lib/languages/markdown';
import bash from 'highlight.js/lib/languages/bash';
import yaml from 'highlight.js/lib/languages/yaml';
import sql from 'highlight.js/lib/languages/sql';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import scala from 'highlight.js/lib/languages/scala';

// Register languages
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('python', python);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', css);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('go', go);
hljs.registerLanguage('java', java);
hljs.registerLanguage('c', c);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('scala', scala);

// Map file extensions to language names used by both highlight.js (diff viewer)
// and CodeMirror (editor). Names must match getLanguageExtension() in codemirror.ts.
const extensionMap: Record<string, string> = {
  // JavaScript/TypeScript
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  mjs: 'javascript',
  cjs: 'javascript',

  // Web markup/style
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'css',
  sass: 'sass',
  less: 'less',
  styl: 'stylus',
  pug: 'pug',
  jade: 'pug',
  vue: 'vue',
  liquid: 'liquid',

  // Data formats
  json: 'json',
  json5: 'json',
  jsonc: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  svg: 'xml',
  xsl: 'xml',
  xslt: 'xml',
  properties: 'properties',
  ini: 'properties',
  conf: 'properties',

  // Documentation/markup
  md: 'markdown',
  markdown: 'markdown',
  tex: 'latex',
  latex: 'latex',
  sty: 'latex',
  textile: 'textile',
  diff: 'diff',
  patch: 'diff',

  // Systems languages
  rs: 'rust',
  go: 'go',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hxx: 'cpp',
  d: 'd',
  f: 'fortran',
  f90: 'fortran',
  f95: 'fortran',
  for: 'fortran',
  pas: 'pascal',
  pp: 'pascal',
  v: 'verilog',
  sv: 'verilog',
  vhd: 'vhdl',
  vhdl: 'vhdl',
  s: 'gas',
  asm: 'gas',
  z80: 'z80',

  // Scripting
  py: 'python',
  pyw: 'python',
  rb: 'ruby',
  erb: 'ruby',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  lua: 'lua',
  pl: 'perl',
  pm: 'perl',
  r: 'r',
  R: 'r',
  jl: 'julia',
  tcl: 'tcl',
  coffee: 'coffeescript',
  ls: 'livescript',
  cr: 'crystal',
  pp2: 'puppet',

  // JVM
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  scala: 'scala',
  sc: 'scala',
  groovy: 'groovy',
  gradle: 'groovy',
  clj: 'clojure',
  cljs: 'clojure',
  cljc: 'clojure',
  edn: 'clojure',

  // .NET / Microsoft
  cs: 'csharp',
  vb: 'vb',
  vbs: 'vbscript',
  ps1: 'powershell',
  psm1: 'powershell',
  psd1: 'powershell',

  // Apple / Mobile
  swift: 'swift',
  m: 'objectivec',
  mm: 'objectivecpp',
  dart: 'dart',

  // Functional
  hs: 'haskell',
  lhs: 'haskell',
  erl: 'erlang',
  hrl: 'erlang',
  ex: 'erlang',
  exs: 'erlang',
  elm: 'elm',
  ml: 'ocaml',
  mli: 'ocaml',
  fs: 'fsharp',
  fsi: 'fsharp',
  fsx: 'fsharp',
  sml: 'sml',
  sig: 'sml',
  scm: 'scheme',
  rkt: 'scheme',
  ss: 'scheme',
  lisp: 'commonlisp',
  cl: 'commonlisp',
  el: 'commonlisp',

  // Web server / PHP
  php: 'php',

  // Database / query
  sql: 'sql',
  xq: 'xquery',
  xquery: 'xquery',
  sparql: 'sparql',
  rq: 'sparql',
  ttl: 'turtle',
  nt: 'ntriples',
  cypher: 'cypher',
  cql: 'cypher',

  // DevOps / config
  dockerfile: 'dockerfile',
  cmake: 'cmake',
  proto: 'protobuf',
  nginx: 'nginx',
  feature: 'gherkin',

  // WebAssembly
  wast: 'wast',
  wat: 'wast',

  // Math / science
  m2: 'mathematica',
  wl: 'mathematica',
  nb: 'mathematica',
  mat: 'octave',
  sas: 'sas',

  // Other
  cob: 'cobol',
  cbl: 'cobol',
  bf: 'brainfuck',
  apl: 'apl',
  e: 'eiffel',
  factor: 'factor',
  fth: 'forth',
  '4th': 'forth',
  mo: 'modelica',
  st: 'smalltalk',
  nsi: 'nsis',
  nsh: 'nsis',
  ebnf: 'ebnf',
  dyl: 'dylan',
};

// Map full filenames (no extension) to language names
const filenameMap: Record<string, string> = {
  Dockerfile: 'dockerfile',
  'docker-compose.yml': 'yaml',
  'docker-compose.yaml': 'yaml',
  Makefile: 'bash',
  'CMakeLists.txt': 'cmake',
  Gemfile: 'ruby',
  Rakefile: 'ruby',
  Vagrantfile: 'ruby',
  Podfile: 'ruby',
};

export function getLanguageFromPath(filePath: string): string | undefined {
  // Check full filename first (for extensionless files like Dockerfile)
  const filename = filePath.split('/').pop() ?? '';
  const byName = filenameMap[filename];
  if (byName) return byName;

  const ext = filename.split('.').pop()?.toLowerCase();
  if (!ext || ext === filename.toLowerCase()) return undefined;
  return extensionMap[ext];
}

// LRU cache for highlighted output to avoid re-highlighting identical lines
const HIGHLIGHT_CACHE_MAX = 2000;
const highlightCache = new Map<string, string>();

export function highlightCode(code: string, language?: string): string {
  if (!language) {
    return escapeHtml(code);
  }

  const cacheKey = `${language}:${code}`;
  const cached = highlightCache.get(cacheKey);
  if (cached !== undefined) {
    // Move to end for LRU behavior
    highlightCache.delete(cacheKey);
    highlightCache.set(cacheKey, cached);
    return cached;
  }

  let result: string;
  try {
    result = hljs.highlight(code, { language }).value;
  } catch {
    result = escapeHtml(code);
  }

  // Evict oldest entries when cache is full
  if (highlightCache.size >= HIGHLIGHT_CACHE_MAX) {
    const firstKey = highlightCache.keys().next().value!;
    highlightCache.delete(firstKey);
  }
  highlightCache.set(cacheKey, result);

  return result;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
