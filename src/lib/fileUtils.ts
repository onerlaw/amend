import { readFile } from '@/lib/tauri';
import { getLanguageFromPath } from '@/lib/highlight';
import { useFileStore, OpenFile } from '@/stores/fileStore';

/**
 * Get the CSS color class for a file icon based on file extension.
 */
export function getFileIconColor(fileName: string, defaultColor = 'text-tertiary'): string {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (['ts', 'tsx'].includes(ext || '')) return 'text-blue-400';
  if (['js', 'jsx'].includes(ext || '')) return 'text-yellow-400';
  if (['rs'].includes(ext || '')) return 'text-orange-400';
  if (['py'].includes(ext || '')) return 'text-green-400';
  if (['json'].includes(ext || '')) return 'text-yellow-300';
  if (['md'].includes(ext || '')) return 'text-blue-300';
  if (['css', 'scss'].includes(ext || '')) return 'text-pink-400';
  if (['html'].includes(ext || '')) return 'text-orange-300';
  return defaultColor;
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

  const content = await readFile(fullPath);
  const name = displayName || fullPath.split('/').pop() || fullPath;
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
