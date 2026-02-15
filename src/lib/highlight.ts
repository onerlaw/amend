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
  scala: 'scala',
  sc: 'scala',

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
