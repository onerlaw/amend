import { useEffect, useState, useCallback, useRef } from 'react';
import { useFileStore, OpenFile } from '@/stores/fileStore';
import { readDirectory, readFile, writeFile, FileEntry } from '@/lib/tauri';
import { getLanguageFromPath } from '@/lib/highlight';

const AUTO_SAVE_DELAY = 1000;

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'error';

export function useFileBrowserState() {
  const { currentDirectory, activeWorktreePath } = useFileStore();
  const contextPath = activeWorktreePath ?? currentDirectory;
  const {
    browseOpenFiles,
    browseActiveFilePath,
    openBrowseFile,
    setBrowseActiveFile,
    closeBrowseFile,
    updateBrowseFileContent,
    markBrowseFileSaved,
  } = useFileStore();

  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
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
    const handleRefreshEvent = () => loadDirectory();
    window.addEventListener('file-tree-refresh', handleRefreshEvent);
    return () => window.removeEventListener('file-tree-refresh', handleRefreshEvent);
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
      // Check if file is already open
      const existingFile = browseOpenFiles.find((f) => f.path === path);
      if (existingFile) {
        setBrowseActiveFile(path);
        return;
      }

      // Load file content and open it
      setIsLoadingContent(true);
      try {
        const content = await readFile(path);
        const name = path.split('/').pop() || path;
        const language = getLanguageFromPath(path) || '';

        const newFile: OpenFile = {
          path,
          name,
          content,
          isDirty: false,
          language,
        };
        openBrowseFile(newFile);
      } catch (err) {
        console.error('Failed to read file:', err);
      }
      setIsLoadingContent(false);
    },
    [browseOpenFiles, openBrowseFile, setBrowseActiveFile]
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

  const handleRefresh = useCallback(() => {
    loadDirectory();
  }, [loadDirectory]);

  // Get currently active file
  const activeFile = browseOpenFiles.find((f) => f.path === browseActiveFilePath) || null;

  return {
    currentDirectory,
    contextPath,
    entries,
    isLoading,
    isLoadingContent,
    browseOpenFiles,
    browseActiveFilePath,
    activeFile,
    handleSelectFile,
    handleCloseFile,
    handleContentChange,
    handleRefresh,
    setBrowseActiveFile,
    getSaveStatus,
  };
}
