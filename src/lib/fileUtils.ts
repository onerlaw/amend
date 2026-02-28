import { readFile, readFileBase64, getFileSize } from '@/lib/tauri';
import { ask, message } from '@tauri-apps/plugin-dialog';
import { basename } from '@/lib/pathUtils';
import { getLanguageFromPath } from '@/lib/highlight';
import { useFileStore, OpenFile } from '@/stores/fileStore';

// Size thresholds for large file handling
const LARGE_FILE_THRESHOLD = 1_000_000; // 1 MB — lightweight mode
const WARN_FILE_THRESHOLD = 10_000_000; // 10 MB — confirmation dialog
const MAX_FILE_THRESHOLD = 50_000_000; // 50 MB — refuse to open

// Platform detection
export const isMac = navigator.platform.toUpperCase().includes('MAC');
export const isWindows = navigator.platform.toUpperCase().includes('WIN');
export const modifierKey = isMac ? '\u2318' : 'Ctrl';
export const modifierKeyName = isMac ? 'Cmd' : 'Ctrl';
export const revealLabel = isMac
  ? 'Reveal in Finder'
  : isWindows
    ? 'Reveal in File Explorer'
    : 'Open Containing Folder';

/**
 * Format a shortcut string with the platform-appropriate modifier.
 * Uses ⌘ on macOS, Ctrl on Windows/Linux.
 * e.g. formatShortcut('Mod+P') => '⌘P' (macOS) or 'Ctrl+P' (Windows/Linux)
 *      formatShortcut('Mod+Shift+N') => '⌘Shift+N' (macOS) or 'Ctrl+Shift+N' (Windows/Linux)
 */
export function formatShortcut(shortcut: string): string {
  return shortcut.replace(/Mod\+/g, isMac ? '\u2318' : 'Ctrl+');
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico']);

const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
};

export function isImageFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS.has(ext);
}

export function getImageMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

export function buildImageDataUrl(base64: string, path: string): string {
  const mime = getImageMimeType(path);
  return `data:${mime};base64,${base64}`;
}

/**
 * Get the CSS color class for a file icon based on file extension.
 */
const FILE_ICON_COLORS: Record<string, string> = {
  ts: 'text-blue-400',
  tsx: 'text-blue-400',
  js: 'text-yellow-400',
  jsx: 'text-yellow-400',
  rs: 'text-orange-400',
  py: 'text-green-400',
  json: 'text-yellow-300',
  md: 'text-blue-300',
  css: 'text-pink-400',
  scss: 'text-pink-400',
  html: 'text-orange-300',
};

export function getFileIconColor(fileName: string, defaultColor = 'text-tertiary'): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return FILE_ICON_COLORS[ext] ?? defaultColor;
}

/**
 * Format a byte count into a human-readable string (e.g. "2.4 MB").
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

/**
 * Open a file in browse mode. If the file is already open, just activate it.
 * Otherwise, read the file content and open it as a new browse tab.
 *
 * Performs size checks before reading:
 * - > 50 MB: refuse to open
 * - > 10 MB: show confirmation dialog
 * - > 1 MB: open in lightweight mode (no syntax highlighting, no LSP)
 */
export async function openFileInBrowseMode(fullPath: string, displayName?: string): Promise<void> {
  const { browseOpenFiles, openBrowseFile, setBrowseActiveFile } = useFileStore.getState();

  const existingFile = browseOpenFiles.find((f) => f.path === fullPath);
  if (existingFile) {
    setBrowseActiveFile(fullPath);
    return;
  }

  const name = displayName || getFileName(fullPath);
  const isImage = isImageFile(fullPath);

  if (isImage) {
    const base64 = await readFileBase64(fullPath);
    const newFile: OpenFile = {
      path: fullPath,
      name,
      content: base64,
      isDirty: false,
      language: '',
      isImage: true,
    };
    openBrowseFile(newFile);
    return;
  }

  // Check file size before reading content
  let fileSize: number;
  try {
    fileSize = await getFileSize(fullPath);
  } catch {
    // If we can't get the size, proceed normally
    fileSize = 0;
  }

  if (fileSize > MAX_FILE_THRESHOLD) {
    await message(
      `This file is ${formatFileSize(fileSize)}, which exceeds the 50 MB limit. It cannot be opened in the editor.`,
      { title: 'File Too Large', kind: 'error' }
    );
    return;
  }

  if (fileSize > WARN_FILE_THRESHOLD) {
    const confirmed = await ask(
      `This file is ${formatFileSize(fileSize)}. Opening large files may affect performance.\n\nSyntax highlighting, code folding, and LSP features will be disabled.\n\nOpen anyway?`,
      { title: 'Large File', kind: 'warning' }
    );
    if (!confirmed) return;
  }

  const isLargeFile = fileSize > LARGE_FILE_THRESHOLD;
  const content = await readFile(fullPath);
  const language = getLanguageFromPath(fullPath) || '';
  const newFile: OpenFile = {
    path: fullPath,
    name,
    content,
    isDirty: false,
    language,
    isLargeFile,
  };
  openBrowseFile(newFile);
}

/**
 * Extract the file name from a path string.
 */
export function getFileName(path: string): string {
  return basename(path) || path;
}

/**
 * Toggle an item in a Set, returning a new Set.
 */
export function toggleSetItem<T>(set: Set<T>, item: T): Set<T> {
  const newSet = new Set(set);
  if (newSet.has(item)) newSet.delete(item);
  else newSet.add(item);
  return newSet;
}

/**
 * Reorder an array by moving an item from one index to another.
 */
export function reorderArray<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  const result = [...items];
  const [moved] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, moved);
  return result;
}

/**
 * Sort entries with directories first, then alphabetically by name.
 */
export function sortDirectoriesFirst<T extends { isDirectory: boolean; name: string }>(
  entries: T[]
): T[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });
}
