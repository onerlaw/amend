import type { Terminal, ILinkProvider, ILink, IBufferRange } from '@xterm/xterm';
import { openFileInBrowseMode } from '@/lib/fileUtils';
import { useFileStore, OpenFile } from '@/stores/fileStore';
import { readFile } from '@/lib/tauri';
import { getLanguageFromPath } from '@/lib/highlight';

// Known code/config file extensions for matching bare filenames (without /)
const KNOWN_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'mts',
  'cts',
  'rs',
  'py',
  'go',
  'rb',
  'sh',
  'bash',
  'zsh',
  'json',
  'yaml',
  'yml',
  'toml',
  'xml',
  'csv',
  'md',
  'mdx',
  'txt',
  'log',
  'css',
  'scss',
  'less',
  'sass',
  'html',
  'htm',
  'vue',
  'svelte',
  'astro',
  'c',
  'cpp',
  'cc',
  'h',
  'hpp',
  'java',
  'kt',
  'swift',
  'zig',
  'sql',
  'graphql',
  'gql',
  'prisma',
  'env',
  'conf',
  'cfg',
  'ini',
  'diff',
  'patch',
  'lock',
  'svg',
]);

// Match file paths with optional :line:col suffix
const FILE_PATH_REGEX =
  /((?:\.{0,2}\/)?(?:[\w@.+-]+\/)*[\w@.+-]+\.[a-zA-Z][\w]{0,10})(?::(\d+)(?::(\d+))?)?/g;

function getExtension(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot >= 0 ? path.slice(dot + 1).toLowerCase() : '';
}

function normalizePath(path: string): string {
  const parts = path.split('/');
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === '..') {
      normalized.pop();
    } else if (part !== '.' && part !== '') {
      normalized.push(part);
    }
  }
  return '/' + normalized.join('/');
}

/**
 * Custom xterm.js link provider that detects file paths in terminal output
 * and opens them in the editor on Cmd+Click.
 */
export class FileLinkProvider implements ILinkProvider {
  constructor(
    private terminal: Terminal,
    private getWorkingDirectory: () => string | null
  ) {}

  provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
    const line = this.terminal.buffer.active.getLine(bufferLineNumber - 1);
    if (!line) {
      callback(undefined);
      return;
    }

    const text = line.translateToString(true);
    if (!text.trim()) {
      callback(undefined);
      return;
    }

    const links: ILink[] = [];
    FILE_PATH_REGEX.lastIndex = 0;

    let match;
    while ((match = FILE_PATH_REGEX.exec(text)) !== null) {
      const filePath = match[1];
      const lineStr = match[2];
      const fullMatch = match[0];

      // Skip if this looks like part of a URL
      const before = text.slice(Math.max(0, match.index - 10), match.index);
      if (/https?:\/\/\S*$/.test(before)) continue;

      // For bare filenames (no /), require a known extension
      if (!filePath.includes('/')) {
        const ext = getExtension(filePath);
        if (!KNOWN_EXTENSIONS.has(ext)) continue;
      }

      // Skip node_modules paths
      if (filePath.includes('node_modules/')) continue;

      const startX = match.index + 1; // xterm uses 1-based columns
      const endX = match.index + fullMatch.length;

      const range: IBufferRange = {
        start: { x: startX, y: bufferLineNumber },
        end: { x: endX, y: bufferLineNumber },
      };

      const lineNum = lineStr ? parseInt(lineStr, 10) : undefined;

      links.push({
        range,
        text: fullMatch,
        activate: () => {
          this.openFile(filePath, lineNum);
        },
      });
    }

    callback(links.length > 0 ? links : undefined);
  }

  private async openFile(filePath: string, line?: number): Promise<void> {
    const workDir = this.getWorkingDirectory();

    let fullPath: string;
    if (filePath.startsWith('/')) {
      fullPath = filePath;
    } else if (workDir) {
      fullPath = `${workDir}/${filePath}`;
    } else {
      return;
    }

    fullPath = normalizePath(fullPath);

    try {
      if (line !== undefined) {
        const content = await readFile(fullPath);
        const name = fullPath.split('/').pop() || fullPath;
        const language = getLanguageFromPath(fullPath) || '';
        const file: OpenFile = { path: fullPath, name, content, isDirty: false, language };
        useFileStore.getState().openBrowseFileAtLine(file, line);
      } else {
        await openFileInBrowseMode(fullPath);
      }
    } catch {
      // File doesn't exist or can't be read
    }
  }
}
