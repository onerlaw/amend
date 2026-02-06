import { readFile, readFileBase64 } from '@/lib/tauri';
import { getLanguageFromPath } from '@/lib/highlight';
import { useFileStore, OpenFile } from '@/stores/fileStore';

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
  ts: 'text-blue-400', tsx: 'text-blue-400',
  js: 'text-yellow-400', jsx: 'text-yellow-400',
  rs: 'text-orange-400',
  py: 'text-green-400',
  json: 'text-yellow-300',
  md: 'text-blue-300',
  css: 'text-pink-400', scss: 'text-pink-400',
  html: 'text-orange-300',
};

export function getFileIconColor(fileName: string, defaultColor = 'text-tertiary'): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return FILE_ICON_COLORS[ext] ?? defaultColor;
}

/**
 * Open a file in browse mode. If the file is already open, just activate it.
 * Otherwise, read the file content and open it as a new browse tab.
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
  } else {
    const content = await readFile(fullPath);
    const language = getLanguageFromPath(fullPath) || '';
    const newFile: OpenFile = {
      path: fullPath,
      name,
      content,
      isDirty: false,
      language,
    };
    openBrowseFile(newFile);
  }
}

/**
 * Extract the file name from a path string.
 */
export function getFileName(path: string): string {
  return path.split('/').pop() || path;
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
 * Sort entries with directories first, then alphabetically by name.
 */
export function sortDirectoriesFirst<T extends { isDirectory: boolean; name: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });
}
