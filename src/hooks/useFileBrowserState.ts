import { useEffect, useState, useCallback, useRef } from 'react';
import { useFileStore } from '@/stores/fileStore';
import { readDirectory, readFile, writeFile, onFsChanged, FileEntry } from '@/lib/tauri';
import { openFileInBrowseMode } from '@/lib/fileUtils';

const AUTO_SAVE_DELAY = 1000;

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'error';

export function useFileBrowserState() {
  const { contextPath, fileTreeVersion, invalidateFileTree } = useFileStore();
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

  // Track paths we recently wrote to, so the watcher can ignore self-originated changes.
  // Maps file path -> timestamp of when we initiated the write.
  const recentSelfWrites = useRef<Map<string, number>>(new Map());

  const initialLoadDone = useRef(false);
  const loadGenerationRef = useRef(0);

  const loadDirectory = useCallback(async () => {
    if (!contextPath) return;
    const generation = ++loadGenerationRef.current;
    // Only show loading spinner on initial load, not on refreshes
    if (!initialLoadDone.current) {
      setIsLoading(true);
    }
    try {
      const contents = await readDirectory(contextPath);
      // Only apply results from the latest generation
      if (generation === loadGenerationRef.current) {
        setEntries(contents);
        initialLoadDone.current = true;
      }
    } catch (err) {
      console.error('Failed to read directory:', err);
    } finally {
      // Always clear loading state to prevent stuck spinner
      if (generation === loadGenerationRef.current) {
        setIsLoading(false);
      }
    }
  }, [contextPath]);

  useEffect(() => {
    initialLoadDone.current = false;
    loadDirectory();
  }, [loadDirectory]);

  // Refresh file tree when file operations occur (rename, delete, paste)
  useEffect(() => {
    if (fileTreeVersion > 0) {
      loadDirectory();
    }
  }, [fileTreeVersion, loadDirectory]);

  // File system watcher: auto-refresh on external changes
  const fsDebounceTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!contextPath) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;
    onFsChanged(() => {
      // Debounce the UI refresh on the frontend side to coalesce rapid events
      // (e.g. npm install generating hundreds of fs-changed events)
      if (fsDebounceTimer.current) {
        clearTimeout(fsDebounceTimer.current);
      }
      fsDebounceTimer.current = setTimeout(() => {
        fsDebounceTimer.current = null;
        useFileStore.getState().invalidateFileTree();

        const now = Date.now();
        // Expire self-write entries older than 5 seconds
        const SELF_WRITE_WINDOW = 5000;
        for (const [p, ts] of recentSelfWrites.current) {
          if (now - ts > SELF_WRITE_WINDOW) {
            recentSelfWrites.current.delete(p);
          }
        }

        // Re-read each open non-image file's content from disk — but only
        // if the buffer is not dirty and the change was not self-originated.
        const openFiles = useFileStore.getState().browseOpenFiles;
        for (const file of openFiles) {
          if (file.isImage) continue;

          // Skip files we recently wrote ourselves
          if (recentSelfWrites.current.has(file.path)) {
            recentSelfWrites.current.delete(file.path);
            continue;
          }

          // If the file has unsaved edits, don't overwrite — flag it instead
          if (file.isDirty) {
            useFileStore.getState().markExternalChange(file.path);
            continue;
          }

          readFile(file.path)
            .then((content) => {
              // Double-check the file is still clean before refreshing
              // (user may have started editing while the read was in-flight)
              const current = useFileStore
                .getState()
                .browseOpenFiles.find((f) => f.path === file.path);
              if (current && !current.isDirty) {
                useFileStore.getState().refreshBrowseFileContent(file.path, content);
              }
            })
            .catch((err) => {
              console.error(`[FileWatcher] Failed to re-read ${file.path}:`, err);
            });
        }
      }, 1000);
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
      if (fsDebounceTimer.current) {
        clearTimeout(fsDebounceTimer.current);
      }
    };
  }, [contextPath]);

  // Cleanup timers on unmount
  useEffect(() => {
    const timers = autoSaveTimers.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
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

  const handleSelectFile = useCallback(async (path: string) => {
    try {
      await openFileInBrowseMode(path);
    } catch (err) {
      console.error('Failed to read file:', err);
    }
  }, []);

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
        const saveInitiatedAt = Date.now();

        try {
          // Record self-write so the watcher knows to ignore the resulting event
          recentSelfWrites.current.set(path, saveInitiatedAt);
          await writeFile(path, newContent);
          // Only mark clean if no edits happened during the async write
          const current = useFileStore.getState().browseOpenFiles.find((f) => f.path === path);
          if (current && (!current.lastLocalEditAt || current.lastLocalEditAt <= saveInitiatedAt)) {
            markBrowseFileSaved(path);
            setSaveStatus(path, 'idle');
          } else {
            // Content changed during save — leave dirty, schedule next save
            setSaveStatus(path, 'pending');
          }
        } catch (err) {
          // If the write failed, remove from self-writes tracking
          recentSelfWrites.current.delete(path);
          console.error('Failed to auto-save file:', err);
          setSaveStatus(path, 'error');
        }
      }, AUTO_SAVE_DELAY);

      autoSaveTimers.current.set(path, timer);
    },
    [updateBrowseFileContent, markBrowseFileSaved, setSaveStatus]
  );

  const saveFile = useCallback(
    async (path: string) => {
      // Clear any pending auto-save timer
      const timer = autoSaveTimers.current.get(path);
      if (timer) {
        clearTimeout(timer);
        autoSaveTimers.current.delete(path);
      }

      const file = useFileStore.getState().browseOpenFiles.find((f) => f.path === path);
      if (!file || !file.isDirty) return;

      setSaveStatus(path, 'saving');
      try {
        recentSelfWrites.current.set(path, Date.now());
        await writeFile(path, file.content);
        markBrowseFileSaved(path);
        setSaveStatus(path, 'idle');
      } catch (err) {
        recentSelfWrites.current.delete(path);
        console.error('Failed to save file:', err);
        setSaveStatus(path, 'error');
      }
    },
    [markBrowseFileSaved, setSaveStatus]
  );

  // Get currently active file
  const activeFile = browseOpenFiles.find((f) => f.path === browseActiveFilePath) || null;

  return {
    contextPath,
    entries,
    isLoading,
    browseOpenFiles,
    browseActiveFilePath,
    activeFile,
    handleSelectFile,
    handleCloseFile,
    handleContentChange,
    handleRefresh: useCallback(() => {
      invalidateFileTree();
      loadDirectory();
    }, [invalidateFileTree, loadDirectory]),
    setBrowseActiveFile,
    getSaveStatus,
    saveFile,
  };
}
