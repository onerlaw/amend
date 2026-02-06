import { useEffect, useState, useCallback, useRef } from 'react';
import { useFileStore } from '@/stores/fileStore';
import { readDirectory, writeFile, FileEntry } from '@/lib/tauri';
import { openFileInBrowseMode } from '@/lib/fileUtils';

const AUTO_SAVE_DELAY = 1000;

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'error';

export function useFileBrowserState() {
  const { currentDirectory, contextPath } = useFileStore();
  const {
    browseOpenFiles,
    browseActiveFilePath,
    setBrowseActiveFile,
    closeBrowseFile,
    updateBrowseFileContent,
    markBrowseFileSaved,
  } = useFileStore();

  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [saveStatuses, setSaveStatuses] = useState<Map<string, SaveStatus>>(new Map());

  const autoSaveTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const loadDirectory = useCallback(async () => {
    if (!contextPath) return;
    setIsLoading(true);
    try {
      const contents = await readDirectory(contextPath);
      setEntries(contents);
    } catch (err) {
      console.error('Failed to read directory:', err);
    }
    setIsLoading(false);
  }, [contextPath]);

  useEffect(() => {
    loadDirectory();
  }, [loadDirectory]);

  // Refresh file tree when file operations occur (rename, delete, paste)
  useEffect(() => {
    window.addEventListener('file-tree-refresh', loadDirectory);
    return () => window.removeEventListener('file-tree-refresh', loadDirectory);
  }, [loadDirectory]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      autoSaveTimers.current.forEach((timer) => clearTimeout(timer));
      autoSaveTimers.current.clear();
    };
  }, []);

  const setSaveStatus = useCallback((path: string, status: SaveStatus) => {
    setSaveStatuses((prev) => new Map(prev).set(path, status));
  }, []);

  const getSaveStatus = useCallback(
    (path: string): SaveStatus => {
      return saveStatuses.get(path) || 'idle';
    },
    [saveStatuses]
  );

  const handleSelectFile = useCallback(
    async (path: string) => {
      try {
        await openFileInBrowseMode(path);
      } catch (err) {
        console.error('Failed to read file:', err);
      }
    },
    []
  );

  const handleCloseFile = useCallback(
    (path: string) => {
      // Clear any pending auto-save timer
      const timer = autoSaveTimers.current.get(path);
      if (timer) {
        clearTimeout(timer);
        autoSaveTimers.current.delete(path);
      }
      // Clear save status
      setSaveStatuses((prev) => {
        const next = new Map(prev);
        next.delete(path);
        return next;
      });
      closeBrowseFile(path);
    },
    [closeBrowseFile]
  );

  const handleContentChange = useCallback(
    (path: string, newContent: string) => {
      updateBrowseFileContent(path, newContent);
      setSaveStatus(path, 'pending');

      // Clear existing timer for this file
      const existingTimer = autoSaveTimers.current.get(path);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      // Set new auto-save timer
      const timer = setTimeout(async () => {
        autoSaveTimers.current.delete(path);
        setSaveStatus(path, 'saving');

        try {
          await writeFile(path, newContent);
          markBrowseFileSaved(path);
          setSaveStatus(path, 'idle');
        } catch (err) {
          console.error('Failed to auto-save file:', err);
          setSaveStatus(path, 'error');
        }
      }, AUTO_SAVE_DELAY);

      autoSaveTimers.current.set(path, timer);
    },
    [updateBrowseFileContent, markBrowseFileSaved, setSaveStatus]
  );

  // Get currently active file
  const activeFile = browseOpenFiles.find((f) => f.path === browseActiveFilePath) || null;

  return {
    currentDirectory,
    contextPath,
    entries,
    isLoading,
    browseOpenFiles,
    browseActiveFilePath,
    activeFile,
    handleSelectFile,
    handleCloseFile,
    handleContentChange,
    handleRefresh: loadDirectory,
    setBrowseActiveFile,
    getSaveStatus,
  };
}
