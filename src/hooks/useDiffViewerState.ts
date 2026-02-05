import { useEffect, useMemo, useCallback, useRef } from 'react';
import { VirtuosoHandle } from 'react-virtuoso';
import { useFileStore, OpenFile } from '@/stores/fileStore';
import { useUIStore } from '@/stores/uiStore';
import { useGitStatus } from '@/hooks/useGit';
import { useMultiFileDiff } from '@/hooks/useMultiFileDiff';
import { readFile } from '@/lib/tauri';
import { getLanguageFromPath } from '@/lib/highlight';

export interface FileWithCategory {
  path: string;
  category: 'staged' | 'unstaged' | 'untracked';
}

export function useDiffViewerState() {
  const { currentDirectory, activeWorktreePath, browseOpenFiles, openBrowseFile, setBrowseActiveFile } =
    useFileStore();
  const contextPath = activeWorktreePath ?? currentDirectory;
  const {
    collapsedDiffFiles,
    toggleDiffFileCollapse,
    scrollTargetFile,
    setScrollTargetFile,
    setPanelMode,
  } = useUIStore();
  const { status, isLoading: statusLoading, refresh } = useGitStatus(contextPath);
  const { diffs, loadDiff, clearDiffs } = useMultiFileDiff(contextPath);

  const virtuosoRef = useRef<VirtuosoHandle>(null);

  // Build ordered list of all changed files with their categories
  const allFiles = useMemo((): FileWithCategory[] => {
    if (!status) return [];

    const files: FileWithCategory[] = [];

    status.staged.forEach((f) => {
      files.push({ path: f.path, category: 'staged' });
    });

    status.unstaged.forEach((f) => {
      files.push({ path: f.path, category: 'unstaged' });
    });

    status.untracked.forEach((path) => {
      files.push({ path, category: 'untracked' });
    });

    return files;
  }, [status]);

  // Load all diffs when files change (expanded by default)
  useEffect(() => {
    if (allFiles.length > 0) {
      allFiles.forEach((file) => {
        loadDiff(file.path);
      });
    }
  }, [allFiles, loadDiff]);

  // Reset when context path changes
  useEffect(() => {
    clearDiffs();
  }, [contextPath, clearDiffs]);

  useEffect(() => {
    if (contextPath) {
      refresh();
    }
  }, [contextPath, refresh]);

  // Handle scroll-to-file using Virtuoso
  useEffect(() => {
    if (scrollTargetFile && virtuosoRef.current) {
      const index = allFiles.findIndex((f) => f.path === scrollTargetFile);
      if (index !== -1) {
        virtuosoRef.current.scrollToIndex({
          index,
          behavior: 'smooth',
          align: 'start',
        });
      }
      setScrollTargetFile(null);
    }
  }, [scrollTargetFile, setScrollTargetFile, allFiles]);

  const handleRefresh = useCallback(() => {
    refresh();
    clearDiffs();
  }, [refresh, clearDiffs]);

  const handleEditFile = useCallback(
    async (filePath: string) => {
      if (!contextPath) return;
      const fullPath = `${contextPath}/${filePath}`;

      // Check if file is already open
      const existingFile = browseOpenFiles.find((f) => f.path === fullPath);
      if (existingFile) {
        setBrowseActiveFile(fullPath);
      } else {
        // Load file and open it
        try {
          const content = await readFile(fullPath);
          const name = filePath.split('/').pop() || filePath;
          const language = getLanguageFromPath(fullPath) || '';
          const newFile: OpenFile = {
            path: fullPath,
            name,
            content,
            isDirty: false,
            language,
          };
          openBrowseFile(newFile);
        } catch (err) {
          console.error('Failed to open file:', err);
        }
      }
      setPanelMode('browse');
    },
    [contextPath, browseOpenFiles, setBrowseActiveFile, openBrowseFile, setPanelMode]
  );

  const handleScrollToFile = useCallback(
    (path: string) => {
      // If collapsed, expand it first
      if (collapsedDiffFiles.has(path)) {
        toggleDiffFileCollapse(path);
      }
      setScrollTargetFile(path);
    },
    [collapsedDiffFiles, toggleDiffFileCollapse, setScrollTargetFile]
  );

  return {
    currentDirectory,
    contextPath,
    status,
    statusLoading,
    allFiles,
    diffs,
    collapsedDiffFiles,
    virtuosoRef,
    toggleDiffFileCollapse,
    handleRefresh,
    handleEditFile,
    handleScrollToFile,
  };
}
