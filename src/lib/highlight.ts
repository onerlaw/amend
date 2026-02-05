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

// Map file extensions to highlight.js language names
const extensionMap: Record<string, string> = {
  // JavaScript/TypeScript
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  mjs: 'javascript',
  cjs: 'javascript',

  // Web
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'css',
  sass: 'css',
  less: 'css',

  // Data formats
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'yaml',
  xml: 'xml',
  svg: 'xml',

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

  // Scripting
  py: 'python',
  rb: 'python', // Ruby uses similar syntax
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',

  // JVM
  java: 'java',
  kt: 'java', // Kotlin
  scala: 'java',

  // Database
  sql: 'sql',

  // Documentation
  md: 'markdown',
  markdown: 'markdown',
};

export function getLanguageFromPath(filePath: string): string | undefined {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (!ext) return undefined;
  return extensionMap[ext];
}

export function highlightCode(code: string, language?: string): string {
  if (!language) {
    return escapeHtml(code);
  }

  try {
    const result = hljs.highlight(code, { language });
    return result.value;
  } catch {
    // If highlighting fails, return escaped HTML
    return escapeHtml(code);
  }
}

export function highlightLine(line: string, language?: string): string {
  return highlightCode(line, language);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export { hljs };
