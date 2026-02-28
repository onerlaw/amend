import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

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
  id: string,
  callback: (base64Data: string) => void
): Promise<UnlistenFn> {
  return listen(`terminal-output-${id}`, (event) => {
    callback(event.payload as string);
  });
}

export async function onTerminalExit(id: string, callback: () => void): Promise<UnlistenFn> {
  return listen(`terminal-exit-${id}`, () => {
    callback();
  });
}

export async function isTerminalBusy(id: string): Promise<boolean> {
  return invoke<boolean>('is_terminal_busy', { id });
}

export async function forceQuitApp(): Promise<void> {
  return invoke('force_quit');
}

export async function onWindowCloseRequested(callback: () => void): Promise<UnlistenFn> {
  return listen('window-close-requested', () => {
    callback();
  });
}

// File system types
export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink: boolean;
  isGitignored: boolean;
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

export async function readDirectories(paths: string[]): Promise<FileEntry[][]> {
  return invoke('read_directories', { paths });
}

export async function readFile(path: string): Promise<string> {
  return invoke('read_file', { path });
}

export async function readFileBase64(path: string): Promise<string> {
  return invoke('read_file_base64', { path });
}

export async function getFileSize(path: string): Promise<number> {
  return invoke('get_file_size', { path });
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

export async function createDirectory(path: string): Promise<void> {
  return invoke('create_directory', { path });
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

export async function getClipboardFilePaths(): Promise<string[]> {
  return invoke('get_clipboard_file_paths');
}

// File watcher commands
export async function startWatchingDirectory(path: string): Promise<void> {
  return invoke('start_watching_directory', { path });
}

export async function stopWatchingDirectory(): Promise<void> {
  return invoke('stop_watching_directory');
}

export async function onFsChanged(callback: () => void): Promise<UnlistenFn> {
  return listen('fs-changed', () => {
    callback();
  });
}

// Git types
export interface GitStatus {
  staged: GitFileStatus[];
  unstaged: GitFileStatus[];
  untracked: string[];
  conflicted: string[];
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
  isBinary: boolean;
}

export interface GitWorktree {
  path: string;
  branch: string;
  isMain: boolean;
}

// Git commands
export async function getGitRoot(path: string): Promise<string | null> {
  return invoke('get_git_root', { path });
}

export interface GitRepoInfo {
  gitRoot: string;
  repoName: string;
  mainRepoRoot: string;
  worktreeName: string | null;
}

export async function getGitRepoInfo(path: string): Promise<GitRepoInfo | null> {
  return invoke('get_git_repo_info', { path });
}

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

export async function openOrCreateWorktree(
  repoPath: string,
  branchName: string,
  startPoint?: string
): Promise<GitWorktree> {
  return invoke('open_or_create_worktree', { repoPath, branchName, startPoint });
}

export async function getDefaultBranch(repoPath: string): Promise<string> {
  return invoke('get_default_branch', { repoPath });
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

export async function stageFile(repoPath: string, filePath: string): Promise<void> {
  return invoke('stage_file', { repoPath, filePath });
}

export interface DiffStats {
  additions: number;
  deletions: number;
  filesChanged: number;
}

export async function getDiffStats(repoPath: string): Promise<DiffStats> {
  return invoke('get_diff_stats', { repoPath });
}

export interface BranchDiffSummary {
  files: GitFileStatus[];
  diffStats: DiffStats;
  mergeBase: string;
}

export async function getBranchDiffFiles(
  repoPath: string,
  baseRef: string
): Promise<BranchDiffSummary> {
  return invoke('get_branch_diff_files', { repoPath, baseRef });
}

export async function getBranchFileDiff(
  repoPath: string,
  baseRef: string,
  filePath: string
): Promise<GitDiff> {
  return invoke('get_branch_file_diff', { repoPath, baseRef, filePath });
}

export interface GitPollData {
  status: GitStatus;
  diffStats: DiffStats;
  fingerprint: string;
}

export async function gitPollData(repoPath: string): Promise<GitPollData> {
  return invoke('git_poll_data', { repoPath });
}

export async function gitQuickCheck(repoPath: string, cachedFingerprint: string): Promise<boolean> {
  return invoke('git_quick_check', { repoPath, cachedFingerprint });
}

// LSP commands
export interface LspStartParams {
  serverId: string;
  command?: string;
  args: string[];
  rootPath?: string;
  useBundledNode?: boolean;
  serverScript?: string;
}

export async function lspStartServer(params: LspStartParams): Promise<void> {
  return invoke('lsp_start_server', { params });
}

export async function lspSendMessage(serverId: string, message: string): Promise<void> {
  return invoke('lsp_send_message', { serverId, message });
}

export async function lspStopServer(serverId: string): Promise<void> {
  return invoke('lsp_stop_server', { serverId });
}

export async function onLspMessage(
  serverId: string,
  callback: (json: string) => void
): Promise<UnlistenFn> {
  return listen(`lsp-message-${serverId}`, (event) => {
    callback(event.payload as string);
  });
}

export async function onLspExit(serverId: string, callback: () => void): Promise<UnlistenFn> {
  return listen(`lsp-exit-${serverId}`, () => {
    callback();
  });
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

export interface SymbolReference {
  filePath: string;
  line: number;
  column: number;
  lineContent: string;
}

// Symbol navigation commands
export async function indexProject(rootPath: string): Promise<void> {
  return invoke('index_project', { rootPath });
}

export async function removeFileFromIndex(filePath: string): Promise<void> {
  return invoke('remove_file_from_index', { filePath });
}

export async function findDefinition(symbol: string): Promise<SymbolDefinition[]> {
  return invoke('find_definition', { symbol });
}

export async function findReferences(symbol: string, rootPath: string): Promise<SymbolReference[]> {
  return invoke('find_references', { symbol, rootPath });
}
