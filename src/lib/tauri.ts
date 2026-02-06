import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

// Terminal types
export interface TerminalSession {
  id: string;
  title: string;
}

// Terminal commands
export async function createTerminal(cwd?: string): Promise<string> {
  return invoke('create_terminal', { cwd });
}

export async function writeToTerminal(id: string, data: string): Promise<void> {
  return invoke('write_to_terminal', { id, data });
}

export async function resizeTerminal(id: string, cols: number, rows: number): Promise<void> {
  return invoke('resize_terminal', { id, cols, rows });
}

export async function closeTerminal(id: string): Promise<void> {
  return invoke('close_terminal', { id });
}

export async function onTerminalOutput(
  callback: (event: { id: string; data: number[] }) => void
): Promise<UnlistenFn> {
  return listen('terminal-output', (event) => {
    callback(event.payload as { id: string; data: number[] });
  });
}

// File system types
export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink: boolean;
  children?: FileEntry[];
}

export interface SearchResult {
  path: string;
  name: string;
  matchType: 'filename' | 'content';
  lineNumber?: number;
  lineContent?: string;
}

// File system commands
export async function readDirectory(path: string): Promise<FileEntry[]> {
  return invoke('read_directory', { path });
}

export async function readFile(path: string): Promise<string> {
  return invoke('read_file', { path });
}

export async function writeFile(path: string, contents: string): Promise<void> {
  return invoke('write_file', { path, contents });
}

export async function searchFiles(
  rootPath: string,
  query: string,
  searchContent: boolean
): Promise<SearchResult[]> {
  return invoke('search_files', { rootPath, query, searchContent });
}

export async function renameEntry(oldPath: string, newPath: string): Promise<void> {
  return invoke('rename_entry', { oldPath, newPath });
}

export async function deleteFile(path: string): Promise<void> {
  return invoke('delete_file', { path });
}

export async function deleteDirectory(path: string): Promise<void> {
  return invoke('delete_directory', { path });
}

export async function revealInFileManager(path: string): Promise<void> {
  return invoke('reveal_in_file_manager', { path });
}

export async function copyEntry(src: string, dest: string): Promise<void> {
  return invoke('copy_entry', { src, dest });
}

export async function moveEntry(src: string, dest: string): Promise<void> {
  return invoke('move_entry', { src, dest });
}

// Git types
export interface GitStatus {
  staged: GitFileStatus[];
  unstaged: GitFileStatus[];
  untracked: string[];
}

export interface GitFileStatus {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied';
}

export interface GitDiff {
  oldPath: string;
  newPath: string;
  oldContent: string;
  newContent: string;
}

export interface GitWorktree {
  path: string;
  branch: string;
  isMain: boolean;
}

// Git commands
export async function getGitStatus(repoPath: string): Promise<GitStatus> {
  return invoke('get_git_status', { repoPath });
}

export async function getFileDiff(repoPath: string, filePath: string): Promise<GitDiff> {
  return invoke('get_file_diff', { repoPath, filePath });
}

export async function isGitRepository(path: string): Promise<boolean> {
  return invoke('is_git_repository', { path });
}

export async function listWorktrees(repoPath: string): Promise<GitWorktree[]> {
  return invoke('list_worktrees', { repoPath });
}

export async function addWorktree(
  repoPath: string,
  worktreePath: string,
  branch?: string,
  newBranch?: string
): Promise<GitWorktree> {
  return invoke('add_worktree', { repoPath, worktreePath, branch, newBranch });
}

export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  force: boolean = false
): Promise<void> {
  return invoke('remove_worktree', { repoPath, worktreePath, force });
}

export interface GitBranch {
  name: string;
  isRemote: boolean;
  isCurrent: boolean;
}

export async function listBranches(repoPath: string): Promise<GitBranch[]> {
  return invoke('list_branches', { repoPath });
}

export async function restoreFile(repoPath: string, filePath: string): Promise<void> {
  return invoke('restore_file', { repoPath, filePath });
}

export async function unstageFile(repoPath: string, filePath: string): Promise<void> {
  return invoke('unstage_file', { repoPath, filePath });
}

export interface DiffStats {
  additions: number;
  deletions: number;
  filesChanged: number;
}

export async function getDiffStats(repoPath: string): Promise<DiffStats> {
  return invoke('get_diff_stats', { repoPath });
}

// Symbol navigation types
export interface SymbolDefinition {
  name: string;
  kind: string; // "function", "class", "variable", "type", "interface", etc.
  filePath: string;
  line: number;
  column: number;
  signature?: string;
}

// Symbol navigation commands
export async function indexProject(rootPath: string): Promise<void> {
  return invoke('index_project', { rootPath });
}

export async function findDefinition(
  symbol: string,
  currentFile: string
): Promise<SymbolDefinition[]> {
  return invoke('find_definition', { symbol, currentFile });
}

export async function reindexFile(path: string, content: string): Promise<void> {
  return invoke('reindex_file', { path, content });
}
