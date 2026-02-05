import { useEffect, useState } from 'react';
import { useFileStore } from '@/stores/fileStore';
import { readDirectory, FileEntry } from '@/lib/tauri';
import { FileTreeItem } from './FileTreeItem';

export function FileTree() {
  const { currentDirectory, setCurrentDirectory, fileTree, setFileTree } = useFileStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDirectory = async (path: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const entries = await readDirectory(path);
      setFileTree(entries);
      setCurrentDirectory(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load directory');
    }
    setIsLoading(false);
  };

  const handleOpenFolder = async () => {
    // Use a simple prompt for now - could integrate with Tauri dialog later
    const path = prompt('Enter directory path:');
    if (path) {
      loadDirectory(path);
    }
  };

  useEffect(() => {
    // Don't auto-load - wait for user to open a folder
  }, [currentDirectory]);

  return (
    <div className="flex h-full flex-col bg-editor-sidebar">
      {/* Header */}
      <div className="flex items-center justify-end border-b border-editor-border px-3 py-2">
        <button
          onClick={handleOpenFolder}
          className="rounded p-1 text-editor-text hover:bg-editor-border"
          title="Open Folder"
        >
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
            <path d="M14.5 3H7.707l-.853-.854L6.5 2h-5l-.5.5v11l.5.5h13l.5-.5v-10l-.5-.5zM14 13H2V3h4.293l.853.854.354.146H14v9z" />
          </svg>
        </button>
        <span className="ml-2 text-xs font-semibold uppercase tracking-wide text-editor-text">
          Explorer
        </span>
      </div>

      {/* Current directory */}
      {currentDirectory && (
        <div className="border-b border-editor-border px-3 py-1.5 text-right">
          <span className="text-xs text-gray-500 truncate block" title={currentDirectory}>
            {currentDirectory.split('/').pop() || currentDirectory}
          </span>
        </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-y-auto py-1">
        {isLoading && (
          <div className="px-3 py-2 text-sm text-gray-500 text-right">Loading...</div>
        )}

        {error && (
          <div className="px-3 py-2 text-sm text-red-400 text-right">{error}</div>
        )}

        {!isLoading && !error && (!fileTree || fileTree.length === 0) && (
          <div className="px-3 py-2 text-sm text-gray-500 text-right">No files found</div>
        )}

        {!isLoading && !error && fileTree?.map((entry: FileEntry) => (
          <FileTreeItem key={entry.path} entry={entry} depth={0} align="right" />
        ))}
      </div>
    </div>
  );
}
