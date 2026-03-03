export interface LspServerConfig {
  /** Display name for logging */
  name: string;
  /** LSP language IDs this server handles */
  languageIds: string[];
  /** File extensions this server handles (without dot) */
  fileExtensions: string[];
  /** Whether to use the bundled Node.js runtime */
  useBundledNode: boolean;
  /** Path to server script relative to resources/lsp-servers/ (when useBundledNode is true) */
  serverScript?: string;
  /** Direct command to run (when useBundledNode is false) */
  command?: string;
  /** Arguments passed to the server */
  args: string[];
}

export const serverConfigs: LspServerConfig[] = [
  {
    name: 'TypeScript',
    languageIds: ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'],
    fileExtensions: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'],
    useBundledNode: true,
    serverScript: 'lsp-servers/typescript/node_modules/typescript-language-server/lib/cli.mjs',
    args: ['--stdio'],
  },
];

/** Map a CodeMirror/editor language name to an LSP language ID */
export function editorLanguageToLspId(language: string): string | null {
  const map: Record<string, string> = {
    typescript: 'typescript',
    javascript: 'javascript',
  };
  return map[language] ?? null;
}

/** Map a file extension to an LSP language ID */
export function extensionToLspLanguageId(ext: string): string | null {
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescriptreact',
    js: 'javascript',
    jsx: 'javascriptreact',
    mjs: 'javascript',
    cjs: 'javascript',
  };
  return map[ext] ?? null;
}

/** Find the server config that handles a given file extension */
export function getServerConfigForExtension(ext: string): LspServerConfig | null {
  return serverConfigs.find((c) => c.fileExtensions.includes(ext)) ?? null;
}

/** Find the server config that handles a given LSP language ID */
export function getServerConfigForLanguageId(languageId: string): LspServerConfig | null {
  return serverConfigs.find((c) => c.languageIds.includes(languageId)) ?? null;
}
